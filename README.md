# ASA Challenge: Unified Service Scheduler

An appointment scheduler for car dealerships that replaces manual booking. A customer requests a service for a vehicle at a dealership and time. The system confirms the booking only when a **service bay** and a **qualified technician** are both free for the whole service duration, then stores an appointment linking customer, vehicle, technician and bay.

- Live: https://asa-challenge.fibosolutions.com
- Design: [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) (architecture diagram, components, data flow, technology choices, observability)
- Plan and progress: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- Implementation results (what was built, differences from the design, test results, known limits): [docs/IMPLEMENTATION_RESULTS.md](docs/IMPLEMENTATION_RESULTS.md)

> Status: built, tested and deployed. Test results and screenshots are in [docs/test-evidence/](docs/test-evidence/).

## What you can do

| Role | Capabilities |
|---|---|
| Customer | Log in, see a dashboard of their own bookings, book a service (vehicle, service type, dealership, date and time), see why a slot is unavailable and which times are free, cancel a booking and release its resources |
| Staff | Log in, see every booking across all dealerships, filter by dealership, date and status, cancel any booking |

### Demo accounts (case sensitive)

| Username | Password | Role |
|---|---|---|
| `JoinWick` | `JoinWick` | customer (John Wick) |
| `JamesBond` | `JamesBond` | customer (James Bond) |
| `Winston` | `Winston` | staff (Winston Scott) |

The login keeps the public API closed to casual visitors. It suits a demo; a production product would use a managed identity provider.

### Demo data

3 dealerships in England (London, Birmingham, Manchester), 5 service bays, 13 technicians, 24 service types (30, 60, 120 and 240 minutes, including MOT, Interim Service and Full Service), 2 customers with 3 and 4 classic and film-famous cars, and a spread of past, upcoming and cancelled bookings. People, places and cars carry illustrated thumbnails.

## Repository layout

```
backend/    Hono API (TypeScript) and booking service, runs on Node or AWS Lambda
frontend/   React + Vite single-page app
shared/     Zod schemas and types shared by backend and frontend
infra/      AWS CDK stacks (S3, CloudFront, API Gateway, Lambda, DynamoDB, monitoring)
scripts/    Python API tests, race-condition simulation, deploy smoke test
docs/       System design, implementation plan, test evidence
```

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | current LTS (22 or newer) and npm 10+ | build, run, test |
| Docker Desktop | any recent | DynamoDB Local for development |
| Python | 3.9+ (standard library only, nothing to install) | black-box API and race tests |
| AWS CLI v2 | 2.x | deploy only |
| An AWS account and a configured CLI profile | | deploy only |

## Run locally

```bash
npm install                 # installs all workspaces
npm run db:up               # starts DynamoDB Local in Docker
npm run seed:local          # creates the table and demo data
npm run dev                 # API on http://localhost:3000, web app on http://localhost:5173 (Vite prints the URL if 5173 is busy)
```

Open http://localhost:5173 and sign in with a demo account.

## Build

```bash
npm run build               # type-checks and builds shared, backend and frontend
```

## Test

```bash
npm test                    # unit tests (Vitest)
npm run test:integration    # booking and cancel against DynamoDB Local, includes the parallel-booking test
python scripts/api_tests.py --base-url http://localhost:3000     # roles, validation, cancel frees slots
python scripts/race_booking.py --base-url http://localhost:3000  # two customers, same slot, same moment
```

### UI test checklist (manual or driven by a browser agent)

1. Log in as `JoinWick`; the dashboard lists only JoinWick's bookings.
2. Wrong case (`joinwick`) is rejected.
3. Book a 120-minute service; the new booking appears with technician and bay.
4. Book the same vehicle at an overlapping time; the app explains the conflict and offers free times.
5. Cancel the booking; the same slot becomes bookable again.
6. Log in as `JamesBond`; JoinWick's bookings are not visible.
7. Log in as `Winston`; all bookings appear and filters work.
8. Resize to phone width; layout stays usable.

Evidence from the author's run lives in `docs/test-evidence/`.

## Deploy to AWS

One environment: production. The stack deploys to **ap-southeast-1 (Singapore)** and serves everything over HTTPS (CloudFront with TLS; HTTP redirects to HTTPS).

### One-time setup

```bash
aws configure --profile <your-profile>        # or use your existing SSO profile
export AWS_PROFILE=<your-profile>
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1
# only when you use a custom domain (CloudFront certificates live in us-east-1):
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

If the account already has a broken or shared default CDK bootstrap (stack `CDKToolkit` in a failed state), use a separate one instead:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --qualifier asa --toolkit-stack-name CDKToolkit-asa
export CDK_QUALIFIER=asa     # the deploy then uses that bootstrap
```

On Windows PowerShell, set variables with `$env:NAME = "value"` instead of `export NAME=value`.

### Deploy with the default CloudFront URL

```bash
npm run deploy
npm run seed:aws
```

The command prints the `https://dxxxxxxxxxxxx.cloudfront.net` address. First deploy takes 5 to 10 minutes because CloudFront must propagate.

### Deploy with your own domain (optional)

Your domain's DNS must be in a Route 53 hosted zone in the same account.

```bash
export DOMAIN_NAME=asa-challenge.example.com
export HOSTED_ZONE_ID=<route53-zone-id>
export HOSTED_ZONE_NAME=example.com
# optional: reuse an existing us-east-1 certificate that covers the domain
# export CERTIFICATE_ARN=arn:aws:acm:us-east-1:...
npm run deploy
npm run seed:aws
```

Without `CERTIFICATE_ARN`, CDK creates and validates a certificate through the hosted zone.

### Verify the deployment

```bash
python scripts/smoke_test.py --base-url https://<your-url>
```

### Remove everything

```bash
npm run destroy
```

## Observability

Structured JSON logs, business and technical metrics, X-Ray traces, a CloudWatch dashboard and alarms are created by the deploy. The dashboard name is printed at the end of `npm run deploy`. See section 8 of the design document.

## Cost

All services are pay-per-use (Lambda, DynamoDB on-demand, API Gateway, CloudFront, S3). The demo costs cents per month when idle.

## About Alice, the assistant that built this

This project was built with **Alice**, a personal AI engineering assistant created by **Vinh**. Alice runs on Claude Code and treats a single `CLAUDE.md` file as her operating manual.

**How Alice organizes herself**

- **Skills** are Python modules, one per repeatable job (build and deploy a site, generate images, research a company, and more). Alice picks the skill that best matches each request using a routing graph built from all her skills, memories and rules.
- **Memories** hold facts that must not be rediscovered, such as AWS account layout, hosting recipes and tool settings.
- **Knowledge and working rules** record decisions and lessons. They are written as current facts, with git history as the timeline.
- **Agents** are promoted from sub-tasks that keep recurring.
- Each request follows a Plan, Do, Check, Act loop. If Alice finds a gap in a skill or a stale fact, she repairs it before ending the session, so she improves with use.

**How Alice handles many projects**

Her workspace separates Alice's own knowledge from client and personal work. Every code project lives under `workspace/projects/<name>/` as its own git repository with its own remote (this repository is one of them). Alice finds which repository owns a changed file before every commit and commits each repository separately, so work on several projects never mixes.

**What Alice did on this project**

- **Planned first.** She wrote the design and plan documents and waited for review before coding.
- **Cloud operations.** She uses the AWS CLI with a dedicated profile to create and update infrastructure, deploy the frontend and backend, seed data and read logs.
- **UI testing through a real browser.** She drives Chrome through the Claude in Chrome extension: logging in as each role, booking, cancelling, checking layout at several widths and capturing screenshots as evidence.
- **API and rare-case testing.** She writes Python scripts that call the API directly, including simulations of rare cases such as two customers booking the same slot at the same moment, the same vehicle double-submitted, and cancel-then-rebook.
- **Visuals.** She generates the illustrations in the app with her Gemini image skill.

## License

MIT
