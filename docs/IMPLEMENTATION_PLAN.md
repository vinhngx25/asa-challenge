# Implementation Plan and Progress

Legend: [ ] not started, [~] in progress, [x] done. Update this file at the end of each milestone.

## Milestones

### M0 Design (this document set)
- [x] SYSTEM_DESIGN.md
- [x] README.md (target form)
- [x] IMPLEMENTATION_PLAN.md
- [x] Reviewer approval

### M1 Foundation
- [x] npm workspaces: shared, backend, frontend, infra; TypeScript, ESLint, Prettier
- [x] Confirm latest stable versions with `npm view` before pinning
- [x] `docker-compose.yml` for DynamoDB Local; `npm run db:up`
- [x] `shared/`: Zod schemas and types for every API contract

### M2 Backend core
- [x] DynamoDB table definition (single table, GSI1, GSI2) and repository interface
- [x] Seed script: 3 English dealerships (Europe/London), 5 bays, 13 British-named technicians, 24 services, 3 users, 7 vehicles, appointments (`seed:local`, `seed:aws`)
- [x] Slot and interval utilities (30-minute slots, half-open intervals, timezone handling)
- [x] Booking service: candidate search, transactional commit with slot locks, bounded retry, alternatives on conflict
- [x] Cancel service: transactional lock release
- [x] Auth: scrypt hashes, JWT middleware, role guards
- [x] Routes from design section 7, uniform error shape, request id
- [x] Lambda and Node adapters for the same Hono app

### M3 Backend tests
- [x] Vitest unit tests: slots, overlap, candidates, opening hours, roles
- [x] Integration tests on DynamoDB Local, including N parallel bookings of one slot (exactly one wins)
- [x] Python: `api_tests.py`, `race_booking.py`

### M4 Frontend
- [x] App shell, routing, auth guard, login page
- [x] Customer dashboard (upcoming, past, cancelled), cancel action
- [x] Booking wizard: vehicle, service category and type, dealership, date, free time slots, confirmation
- [x] Conflict state with alternative times
- [x] Staff overview with filters
- [x] Responsive layout, loading and error states

### M5 Visuals
- [x] Check remaining Gemini prepaid credit before generating
- [x] Fix one style prompt (flat vector, navy and amber palette) and test it on 3 images before the full set
- [x] Generate about 37 images with the Alice image skill: 16 portraits (2 customers, 1 staff, 13 technicians), 3 dealerships, 1 service bay, 7 vehicles, 7 service categories, logo, login hero, empty state
- [x] Optimize to WebP, place in `frontend/src/assets/`

### M6 Infrastructure and deploy
- [x] CDK: DynamoDB, Lambda (arm64), HTTP API, Secrets Manager, S3 + CloudFront (OAC, `/api/*` behavior, security headers, HTTP to HTTPS), optional domain and certificate
- [x] Observability: Powertools logs, metrics, tracing; dashboard; alarms; optional SNS topic
- [x] Deploy to ap-southeast-1 with alias `asa-challenge.fibosolutions.com`, reusing the existing wildcard certificate
- [x] `seed:aws`, `scripts/smoke_test.py`

### M7 Verification
- [x] Browser run through the UI checklist as each role, local and live; screenshots into `docs/test-evidence/`
- [x] Python race and API tests against the live URL
- [x] Fresh-clone rehearsal: follow the README from scratch in an empty folder

### M8 Hand-over
- [x] README commands checked against reality, status banner removed
- [x] Final commit, tag, confirm the repository is public

## Working agreements

- Commit after each milestone to `asa-challenge`, one repository per commit.
- A secret never enters the repository. The README names no account ids.
- The design document changes before the code does when a decision changes.
- Every claim in the README has been executed at least once before the status banner is removed.

## Decision log

| Decision | Reason |
|---|---|
| Serverless (Lambda + DynamoDB) | Atomic transactions deliver the booking guarantee; one-command deploy; near-zero idle cost |
| Slot-lock items in one transaction | The database, not application code, prevents double booking |
| 30-minute slot grain | All durations (30, 60, 120, 240) are whole multiples |
| Vehicle lock beside bay and technician locks | Blocks double submission and overlapping bookings of one vehicle |
| Same-origin API through CloudFront | No CORS, one certificate, one URL |
| `shared/` contracts package | Frontend and backend cannot drift; deployables stay separate |
| Claude in Chrome for UI tests, no Playwright | Matches how the author works; manual checklist keeps results reproducible |
| 3 users: 2 customers, 1 staff | Demonstrates role-based access with minimal surface |
