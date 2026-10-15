import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface DomainSettings {
  domainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
}

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/** Stack in us-east-1 that owns the CloudFront certificate when no existing one is supplied. */
export class AsaCertificateStack extends cdk.Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: cdk.StackProps & { domain: DomainSettings }) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.domain.hostedZoneId,
      zoneName: props.domain.hostedZoneName,
    });
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domain.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}

export interface AsaStackProps extends cdk.StackProps {
  domain?: DomainSettings | undefined;
  certificateArn?: string | undefined;
  certificate?: acm.ICertificate | undefined;
  alarmEmail?: string | undefined;
}

export class AsaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AsaStackProps) {
    super(scope, id, props);

    const frontendDist = here('../../frontend/dist');
    if (!existsSync(frontendDist)) {
      throw new Error('frontend/dist is missing. Run "npm run build" from the repository root first (npm run deploy does this).');
    }

    /* ------------------------------------------------------------ */
    /* Data                                                          */
    /* ------------------------------------------------------------ */

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'asa-challenge',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // demo environment: "npm run destroy" removes everything
    });
    for (const n of [1, 2]) {
      table.addGlobalSecondaryIndex({
        indexName: `GSI${n}`,
        partitionKey: { name: `GSI${n}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `GSI${n}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    const jwtSecret = new secrets.Secret(this, 'JwtSecret', {
      description: 'Signing key for ASA access tokens',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    /* ------------------------------------------------------------ */
    /* API: Lambda behind an HTTP API                                */
    /* ------------------------------------------------------------ */

    const apiLogs = new logs.LogGroup(this, 'ApiFunctionLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'ApiFunction', {
      entry: here('../../backend/src/lambda.ts'),
      projectRoot: here('../..'),
      depsLockFilePath: here('../../package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: apiLogs,
      environment: {
        TABLE_NAME: table.tableName,
        JWT_SECRET_ARN: jwtSecret.secretArn,
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: 'asa-api',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        // Bundle everything, including the AWS SDK, so the deployed code matches the lockfile exactly.
        externalModules: [],
      },
    });
    table.grantReadWriteData(fn);
    jwtSecret.grantRead(fn);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'asa-challenge',
      createDefaultStage: false,
    });
    const stageLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      // First line of defence against abuse of the public URL.
      throttle: { rateLimit: 50, burstLimit: 100 },
      accessLogSettings: { destination: new apigwv2.LogGroupLogDestination(stageLogs) },
    });
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', fn),
    });

    /* ------------------------------------------------------------ */
    /* Web: S3 + CloudFront, API on the same origin                  */
    /* ------------------------------------------------------------ */

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        contentSecurityPolicy: {
          contentSecurityPolicy:
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          override: true,
        },
      },
    });

    // Deep links such as /book are served by the single-page app. Only the web behavior gets this rewrite,
    // so a missing /api route still answers with a real 404 from the API.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
      ),
    });

    const certificate: acm.ICertificate | undefined = props.domain
      ? (props.certificate ??
        (props.certificateArn ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn) : undefined))
      : undefined;

    const apiOrigin = new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint)), {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'ASA Challenge: web app and API',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      ...(props.domain && certificate ? { domainNames: [props.domain.domainName], certificate } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(frontendDist)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=300')],
    });

    if (props.domain) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.domain.hostedZoneId,
        zoneName: props.domain.hostedZoneName,
      });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      const recordName = props.domain.domainName;
      new route53.ARecord(this, 'AliasA', { zone, recordName, target });
      new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName, target });
    }

    /* ------------------------------------------------------------ */
    /* Observability: dashboard and alarms                           */
    /* ------------------------------------------------------------ */

    const five = cdk.Duration.minutes(5);
    const app = (metricName: string, statistic = 'Sum') =>
      new cw.Metric({ namespace: 'ASA', metricName, dimensionsMap: { service: 'asa-api' }, statistic, period: five });
    const api = (metricName: string, statistic = 'Sum') =>
      new cw.Metric({
        namespace: 'AWS/ApiGateway',
        metricName,
        dimensionsMap: { ApiId: httpApi.apiId },
        statistic,
        period: five,
      });
    const dynamo = (metricName: string) =>
      new cw.Metric({
        namespace: 'AWS/DynamoDB',
        metricName,
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
        period: five,
      });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'ASA Challenge alarms' });
    if (props.alarmEmail) alarmTopic.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    const alarmAction = new cwActions.SnsAction(alarmTopic);

    const alarms: cw.Alarm[] = [
      new cw.Alarm(this, 'AlarmApi5xx', {
        alarmDescription: 'API Gateway returned server errors',
        metric: api('5xx'),
        threshold: 5,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'AlarmLambdaErrors', {
        alarmDescription: 'The API function threw errors',
        metric: fn.metricErrors({ period: five }),
        threshold: 3,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'AlarmLatencyP95', {
        alarmDescription: 'p95 API latency above 3 seconds',
        metric: api('Latency', 'p95'),
        threshold: 3000,
        evaluationPeriods: 3,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'AlarmDynamoThrottle', {
        alarmDescription: 'DynamoDB throttled reads or writes',
        metric: new cw.MathExpression({
          expression: 'r + w',
          usingMetrics: { r: dynamo('ReadThrottleEvents'), w: dynamo('WriteThrottleEvents') },
          period: five,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'AlarmLoginFailures', {
        alarmDescription: 'Spike of failed sign-ins (possible password guessing)',
        metric: app('LoginFailed'),
        threshold: 20,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarm of alarms) alarm.addAlarmAction(alarmAction);

    const dashboard = new cw.Dashboard(this, 'Dashboard', { dashboardName: 'asa-challenge' });
    dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'Requests and server errors',
        left: [api('Count'), api('5xx'), api('4xx')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'API latency (ms)',
        left: [api('Latency', 'p50'), api('Latency', 'p95'), api('Latency', 'p99')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Bookings, conflicts and cancellations',
        left: [app('BookingCreated'), app('BookingConflict'), app('BookingCancelled')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Sign-ins',
        left: [app('LoginSucceeded'), app('LoginFailed')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Lambda invocations, errors, throttles',
        left: [fn.metricInvocations({ period: five }), fn.metricErrors({ period: five }), fn.metricThrottles({ period: five })],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Booking latency (ms)',
        left: [app('BookingLatency', 'p50'), app('BookingLatency', 'p95')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'DynamoDB throttling',
        left: [dynamo('ReadThrottleEvents'), dynamo('WriteThrottleEvents')],
        width: 12,
      }),
      new cw.AlarmStatusWidget({ title: 'Alarms', alarms, width: 12 }),
    );

    /* ------------------------------------------------------------ */
    /* Outputs                                                       */
    /* ------------------------------------------------------------ */

    const siteUrl = props.domain && certificate ? `https://${props.domain.domainName}` : `https://${distribution.distributionDomainName}`;
    new cdk.CfnOutput(this, 'SiteUrl', { value: siteUrl, description: 'Open this address in the browser' });
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName, description: 'Used by npm run seed:aws' });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
    });
  }
}
