import * as cdk from 'aws-cdk-lib';
import { AsaCertificateStack, AsaStack } from '../lib/stack.js';

/**
 * Deployment settings come from environment variables so the same code serves every reviewer.
 *
 *   DOMAIN_NAME        optional  custom domain, e.g. asa-challenge.example.com
 *   HOSTED_ZONE_ID     with DOMAIN_NAME  Route 53 hosted zone id that holds the domain
 *   HOSTED_ZONE_NAME   with DOMAIN_NAME  zone name, e.g. example.com
 *   CERTIFICATE_ARN    optional  existing us-east-1 ACM certificate covering the domain;
 *                      without it, a certificate is created and validated through the hosted zone
 *   ALARM_EMAIL        optional  e-mail address that receives CloudWatch alarm notifications
 *   CDK_QUALIFIER      optional  bootstrap qualifier when you use a non-default CDK bootstrap
 */
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

const domainName = env('DOMAIN_NAME');
const hostedZoneId = env('HOSTED_ZONE_ID');
const hostedZoneName = env('HOSTED_ZONE_NAME');
const certificateArn = env('CERTIFICATE_ARN');
const alarmEmail = env('ALARM_EMAIL');

if (domainName && !(hostedZoneId && hostedZoneName)) {
  throw new Error('DOMAIN_NAME needs HOSTED_ZONE_ID and HOSTED_ZONE_NAME as well.');
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = env('ASA_REGION') ?? 'ap-southeast-1';

// Optional: use a separate CDK bootstrap (cdk bootstrap --qualifier <q> --toolkit-stack-name CDKToolkit-<q>),
// for example when the account's default CDKToolkit stack is broken or shared with other projects.
const qualifier = env('CDK_QUALIFIER');
const app = new cdk.App(
  qualifier ? { defaultStackSynthesizer: new cdk.DefaultStackSynthesizer({ qualifier }) } : {},
);
const domain = domainName && hostedZoneId && hostedZoneName ? { domainName, hostedZoneId, hostedZoneName } : undefined;

let certificate: AsaCertificateStack | undefined;
if (domain && !certificateArn) {
  // CloudFront only accepts certificates from us-east-1.
  certificate = new AsaCertificateStack(app, 'AsaChallengeCertificate', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
    domain,
  });
}

const main = new AsaStack(app, 'AsaChallenge', {
  env: { account, region },
  crossRegionReferences: Boolean(certificate),
  description: 'ASA Challenge: appointment scheduler (CloudFront, S3, API Gateway, Lambda, DynamoDB)',
  domain,
  certificateArn,
  certificate: certificate?.certificate,
  alarmEmail,
});
if (certificate) main.addDependency(certificate);
