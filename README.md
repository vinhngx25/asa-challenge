# ASA Challenge: Unified Service Scheduler

An appointment scheduler for car dealerships. A customer requests a service for a vehicle at a dealership and time. The system confirms the booking only when a **service bay** and a **qualified technician** are both free for the whole service duration, then stores an appointment linking customer, vehicle, technician and bay.

- Live: https://asa-challenge.fibosolutions.com
- [System design](docs/SYSTEM_DESIGN.md): architecture, components, data flow, data model, technology choices, observability
- [Testing guide](docs/TESTING.md): every suite, latest results, API testing by hand
- [Manual test cases](docs/MANUAL_TEST_CASES.md): a person-run checklist by priority; screenshots in [docs/test-evidence/](docs/test-evidence/)
- [Out of scope](docs/OUT_OF_SCOPE.md): weak points that are acknowledged and deliberately not addressed in this version

## What you can do

| Role | Capabilities |
|---|---|
| Customer | Sign in, see a dashboard of their own bookings, book a service (vehicle, service, dealership, date, time), see which times are free and the nearest alternatives when one is taken, cancel a booking and release its resources |
| Staff | Sign in, see every booking across all dealerships, search and filter by dealership, date and status, cancel any booking |

Demo accounts (case sensitive; username and password are at most 32 characters; a password has no spaces):

| Username | Password | Role |
|---|---|---|
| `JoinWick` | `JoinWick` | customer (John Wick) |
| `JamesBond` | `JamesBond` | customer (James Bond) |
| `Winston` | `Winston` | staff (Winston Scott) |

The sign-in is an access gate for a demo with fixed accounts; a production product would use a managed identity provider. Demo data: 3 dealerships in England, 5 bays, 13 technicians, 24 services, 7 cars and a spread of past, upcoming and cancelled bookings (details in the design document).

## Repository layout

```
backend/    Hono API (TypeScript) and booking service; runs on Node or AWS Lambda
frontend/   React + Vite single-page app
shared/     Zod schemas and types used by backend and frontend
infra/      AWS CDK stack (S3, CloudFront, API Gateway, Lambda, DynamoDB, monitoring)
scripts/    Python API, race, boundary, pairwise and input tests; deploy smoke test; dev launcher
docs/       Design, testing guide, manual test cases, out-of-scope list, test evidence
```

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22 or newer, npm 10+ | build, run, test |
| Docker | any recent | DynamoDB Local |
| Python | 3.9+ (standard library only) | black-box API tests |
| AWS CLI v2 and an account with a configured profile | | deploy only |

## Run locally

```bash
npm install                 # all workspaces
npm run db:up               # DynamoDB Local in Docker
npm run seed:local          # creates the table and the demo data
npm run dev                 # API on http://localhost:3000, web app on http://localhost:5173
```

Open http://localhost:5173 and sign in with a demo account. `npm run build` type-checks every workspace and builds the frontend.

## Test

```bash
npm test                    # 20 backend unit tests
npm run test:frontend       # 11 frontend tests (booking page, staff filters, sign-in)
npm run test:integration    # 104 tests on DynamoDB Local (needs npm run db:up)

# Black-box scripts (Python standard library, seeded data required, each cancels what it books)
python scripts/api_tests.py      --base-url http://localhost:3000
python scripts/race_booking.py   --base-url http://localhost:3000
python scripts/boundary_tests.py --base-url http://localhost:3000
python scripts/pairwise_tests.py --base-url http://localhost:3000
python scripts/input_tests.py    --base-url http://localhost:3000
```

The Python scripts run unchanged against a deployed site (`--base-url https://<your-url>`). GitHub Actions runs the build, unit, frontend and integration tests on every push. The UI is checked with the [manual test cases](docs/MANUAL_TEST_CASES.md). Details and API examples are in the [testing guide](docs/TESTING.md).

## Deploy to AWS

One environment, in **ap-southeast-1 (Singapore)**, served over HTTPS (CloudFront; HTTP redirects to HTTPS).

One-time setup:

```bash
aws configure --profile <your-profile>        # or use an existing SSO profile
export AWS_PROFILE=<your-profile>
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1     # only with a custom domain (CloudFront certificates live there)
```

If the account's default CDK bootstrap is broken or shared, bootstrap separately and tell the deploy about it:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --qualifier asa --toolkit-stack-name CDKToolkit-asa
export CDK_QUALIFIER=asa
```

On PowerShell, set variables with `$env:NAME = "value"`.

Deploy with the default CloudFront URL:

```bash
npm run deploy
npm run seed:aws
```

The command prints the `https://dxxxxxxxxxxxx.cloudfront.net` address. The first deploy takes 5 to 10 minutes because CloudFront must propagate.

Deploy with your own domain (its DNS must be in a Route 53 hosted zone in the same account):

```bash
export DOMAIN_NAME=asa-challenge.example.com
export HOSTED_ZONE_ID=<route53-zone-id>
export HOSTED_ZONE_NAME=example.com
# optional: reuse a us-east-1 certificate that covers the domain (otherwise CDK creates one)
# export CERTIFICATE_ARN=arn:aws:acm:us-east-1:...
# optional: e-mail address for alarm notifications
# export ALARM_EMAIL=you@example.com
npm run deploy
npm run seed:aws
```

Verify and remove:

```bash
python scripts/smoke_test.py --base-url https://<your-url>
npm run destroy
```

The deploy creates structured logs, metrics, X-Ray traces, a CloudWatch dashboard (`asa-challenge`) and alarms. All services are pay-per-use, so the demo costs cents per month when idle.

## About Alice, the assistant that built this

This project was built with **Alice**, a personal AI engineering assistant created by **Vinh**. Alice runs on Claude Code and treats a single `CLAUDE.md` file as her operating manual.

**How Alice organizes herself**

- **Skills** are Python modules, one per repeatable job (build and deploy a site, generate images, research a company, and more). Alice picks the skill that best matches each request using a routing graph built from all her skills, memories and rules.
- **Memories** hold facts that must not be rediscovered, such as AWS account layout, hosting recipes and tool settings.
- **Knowledge and working rules** record decisions and lessons as current facts, with git history as the timeline.
- **Agents** are promoted from sub-tasks that keep recurring.
- Each request follows a Plan, Do, Check, Act loop. If Alice finds a gap in a skill or a stale fact, she repairs it before ending the session.

**How Alice handles many projects.** Her workspace separates her own knowledge from client and personal work. Every code project lives under `workspace/projects/<name>/` as its own git repository with its own remote (this repository is one of them). Alice finds which repository owns a changed file before every commit and commits each repository separately.

**What Alice did on this project**

- **Planned first.** She wrote the design and waited for review before coding.
- **Cloud operations.** She uses the AWS CLI with a dedicated profile to create and update infrastructure, deploy the frontend and backend, seed data and read logs.
- **UI testing through a real browser.** She drives Chrome through the Claude in Chrome extension: signing in as each role, booking, cancelling, reading the rendered page and capturing screenshots as evidence, including the phone layout and a second customer taking the same slot.
- **API and rare-case testing.** She writes Python scripts that call the API directly, including two customers booking the same slot at the same moment, the same vehicle double-submitted, and cancel-then-rebook. She designs boundary-value and pairwise (all-pairs) tests and checks that they fail when the code is deliberately broken.
- **Visuals.** She generates every image and thumbnail (38: portraits, dealerships, cars, service categories, logo, desktop and mobile hero, empty state) with Google's "nano banana" Gemini image models through her image skill, using one shared bright, modern style prompt.

## License

MIT
