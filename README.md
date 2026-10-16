# ASA Challenge: Unified Service Scheduler

An appointment scheduler for car dealerships. A customer requests a service for a vehicle at a dealership and time. The system confirms the booking only when a **service bay** and a **qualified technician** are both free for the whole service duration, then stores an appointment linking customer, vehicle, technician and bay.

- Live: https://asa-challenge.fibosolutions.com
- [System design](docs/SYSTEM_DESIGN.md): architecture, components, data flow, data model, technology choices, observability
- [Testing guide](docs/TESTING.md): every suite, latest results, API testing manually
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

The sign-in is an access gate for a demo with fixed accounts; a production product would use a managed identity provider. Demo data: 3 dealerships in England, 5 bays, 13 technicians, 24 services, 7 cars and a spread of past, upcoming and cancelled bookings (details in the design document). The seed data is code (`backend/src/seed/data.ts`) and all 37 images, thumbnails and avatars are committed in `frontend/public/images/`, so nothing needs to be generated or downloaded beyond the packages below.

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
| Node.js | 22 or newer, with npm 10+ | build, run, test, deploy |
| Docker | Docker Desktop or Engine with Compose v2 (`docker compose`) | DynamoDB Local |
| Python | 3.9+ (standard library only, nothing to install) | black-box API tests |
| AWS account and credentials (CLI profile, SSO or environment variables) | | deploy only |

Commands below use `python`; on macOS and Linux use `python3` if `python` is not found. On Windows PowerShell set variables with `$env:NAME = "value"` instead of `export NAME=value`.

## Run locally

```bash
git clone https://github.com/vinhngx25/asa-challenge.git
cd asa-challenge
npm install                 # all workspaces, run once from the repository root
npm run db:up               # DynamoDB Local in Docker (port 8100)
npm run seed:local          # waits for the database, creates the table and the demo data
npm run dev                 # API on http://localhost:3000, web app on http://localhost:5173
```

Open http://localhost:5173 (Vite prints the address if that port is busy) and sign in with a demo account. Stop with Ctrl+C and `npm run db:down`. `npm run build` type-checks every workspace and builds the frontend.

## Test

```bash
npm test                    # 20 backend unit tests
npm run test:frontend       # 15 frontend tests (booking page, staff filters, sign-in, time display)
npm run test:integration    # 105 tests on DynamoDB Local (needs npm run db:up)

# Black-box scripts (Python standard library, seeded data required, each cancels what it books)
python scripts/api_tests.py      --base-url http://localhost:3000
python scripts/race_booking.py   --base-url http://localhost:3000
python scripts/boundary_tests.py --base-url http://localhost:3000
python scripts/pairwise_tests.py --base-url http://localhost:3000
python scripts/input_tests.py    --base-url http://localhost:3000
```

The Python scripts run unchanged against a deployed site (`--base-url https://<your-url>`). The UI is checked with the [manual test cases](docs/MANUAL_TEST_CASES.md). Details and API examples are in the [testing guide](docs/TESTING.md).

## Deploy to AWS

One environment, in **ap-southeast-1 (Singapore)**, served over HTTPS (CloudFront; HTTP redirects to HTTPS).

One-time setup (run `npm install` first, from the repository root):

```bash
aws configure --profile <your-profile>        # or use an existing SSO profile
export AWS_PROFILE=<your-profile>
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1
# only if you use a custom domain and let CDK create its certificate (CloudFront certificates live in us-east-1):
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

The stack creates a DynamoDB table named `asa-challenge`, so the deploy fails if the account already has one with that name in the region.

If the account's default CDK bootstrap is broken or shared, bootstrap separately and tell the deploy about it:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --qualifier asa --toolkit-stack-name CDKToolkit-asa
export CDK_QUALIFIER=asa
```

Deploy with the default CloudFront URL:

```bash
npm run deploy
npm run seed:aws
```

`npm run deploy` type-checks, builds the frontend, bundles the API and deploys the stack. It prints `SiteUrl` (the `https://dxxxxxxxxxxxx.cloudfront.net` address) at the end. The first deploy takes 5 to 10 minutes because CloudFront must propagate. `npm run seed:aws` loads the demo data into the new table; run it again at any time to reset the data.

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

The deploy creates JSON logs in CloudWatch, a dashboard (`asa-challenge`) and four alarms. All services are pay-per-use, so the demo costs cents per month when idle.

## About Alice, the assistant that built this

This project was built with **Alice**, a personal AI engineering assistant created by **Vinh**. Alice runs on Claude Code and treats a single `CLAUDE.md` file as her operating manual.

**How Alice is organized.** Alice is one git repository. This is its structure (the `asa-challenge` repository you are reading lives inside `workspace/projects/` and is not part of it):

```
alice/
  CLAUDE.md        Operating manual Claude Code reads at the start of every session: paths, shell rules,
                   working rules and the Plan, Do, Check, Act loop
  architecture.md  How the parts fit together, written as current facts
  capabilities.md  Generated index of every skill, agent and tool; the fallback when routing finds no match
  skills/          One Python module per repeatable job (deploy a site, generate images, AWS operations,
                   browser automation, research). The docstring says when to use it and the steps to follow
  agents/          Sub-agents promoted from sub-tasks that keep recurring, for example a fullstack
                   developer agent that turns a requirement into a tested, committed change
  memories/        Typed facts as Python classes: who the user is, where systems and APIs live, core rules
  knowledge/       Narrative knowledge: working rules, current context, an optimization log, and the
                   generated routing and dependency graphs
  mcp/             Notes on tool servers and the bridge that lets Alice drive the user's Chrome
  setup/           Maintenance scripts: build and query the routing graph, sync everything after a
                   change, session hooks, the Chrome extension
  tests/           Tests for the tooling
  credentials/     Alice's own API keys (gitignored)
  data/, tmp/      Runtime state (the routing hint for the current request, execution log) and scratch
                   files (gitignored)
  workspace/       Everything Alice works on, kept apart from Alice herself
    projects/<name>/   One git repository per code project, each with its own remote
    (other folders)    Client, research and personal working material, organized by topic
```

**How a request flows.** Alice extracts keywords from the request and queries the routing graph, which scores skills, memories and rules and writes a hint file. She follows the best-matching skill (or `capabilities.md` when nothing scores high enough), shows a plan for multi-step work, acts, then checks whether the intent was covered. If a skill has a gap or a memory is stale, she repairs it before the session ends and re-syncs the graphs, so she improves with use. Facts live in `memories/` and `knowledge/` as current state, with git history as the timeline; a project's own credentials stay inside that project, outside git.

**How Alice handles many projects.** Every code project under `workspace/projects/` is its own git repository with its own remote. Alice finds which repository owns a changed file before every commit and commits each repository separately, so work on several projects never mixes.

**What Alice did on this project**

- **Planned first.** She wrote the design and waited for review before coding.
- **Cloud operations.** She uses the AWS CLI with a dedicated profile to create and update infrastructure, deploy the frontend and backend, seed data and read logs.
- **UI testing through a real browser.** She drives Chrome through the Claude in Chrome extension: signing in as each role, booking, cancelling, reading the rendered page and capturing screenshots as evidence, including the phone layout and a second customer taking the same slot.
- **API and rare-case testing.** She writes Python scripts that call the API directly, including two customers booking the same slot at the same moment, the same vehicle double-submitted, and cancel-then-rebook. She designs boundary-value and pairwise (all-pairs) tests and checks that they fail when the code is deliberately broken.
- **Visuals.** She generates every image and thumbnail (37: portraits, dealerships, cars, service categories, logo, desktop and mobile hero, empty state) with Google's "nano banana" Gemini image models through her image skill, using one shared bright, modern style prompt.

## License

MIT
