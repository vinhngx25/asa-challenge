# Implementation Plan and Progress

Legend: [ ] not started, [~] in progress, [x] done. Update this file at the end of each milestone.

## Milestones

### M0 Design (this document set)
- [x] SYSTEM_DESIGN.md
- [x] README.md (target form)
- [x] IMPLEMENTATION_PLAN.md
- [ ] Reviewer approval

### M1 Foundation
- [ ] npm workspaces: shared, backend, frontend, infra; TypeScript, ESLint, Prettier
- [ ] Confirm latest stable versions with `npm view` before pinning
- [ ] `docker-compose.yml` for DynamoDB Local; `npm run db:up`
- [ ] `shared/`: Zod schemas and types for every API contract

### M2 Backend core
- [ ] DynamoDB table definition (single table, GSI1, GSI2) and repository interface
- [ ] Seed script: 3 English dealerships (Europe/London), 5 bays, 13 British-named technicians, 24 services, 3 users, 7 vehicles, appointments (`seed:local`, `seed:aws`)
- [ ] Slot and interval utilities (30-minute slots, half-open intervals, timezone handling)
- [ ] Booking service: candidate search, transactional commit with slot locks, bounded retry, alternatives on conflict
- [ ] Cancel service: transactional lock release
- [ ] Auth: scrypt hashes, JWT middleware, role guards
- [ ] Routes from design section 7, uniform error shape, request id
- [ ] Lambda and Node adapters for the same Hono app

### M3 Backend tests
- [ ] Vitest unit tests: slots, overlap, candidates, opening hours, roles
- [ ] Integration tests on DynamoDB Local, including N parallel bookings of one slot (exactly one wins)
- [ ] Python: `api_tests.py`, `race_booking.py`

### M4 Frontend
- [ ] App shell, routing, auth guard, login page
- [ ] Customer dashboard (upcoming, past, cancelled), cancel action
- [ ] Booking wizard: vehicle, service category and type, dealership, date, free time slots, confirmation
- [ ] Conflict state with alternative times
- [ ] Staff overview with filters
- [ ] Responsive layout, loading and error states

### M5 Visuals
- [ ] Check remaining Gemini prepaid credit before generating
- [ ] Fix one style prompt (flat vector, navy and amber palette) and test it on 3 images before the full set
- [ ] Generate about 37 images with the Alice image skill: 16 portraits (2 customers, 1 staff, 13 technicians), 3 dealerships, 1 service bay, 7 vehicles, 7 service categories, logo, login hero, empty state
- [ ] Optimize to WebP, place in `frontend/src/assets/`

### M6 Infrastructure and deploy
- [ ] CDK: DynamoDB, Lambda (arm64), HTTP API, Secrets Manager, S3 + CloudFront (OAC, `/api/*` behavior, security headers, HTTP to HTTPS), optional domain and certificate
- [ ] Observability: Powertools logs, metrics, tracing; dashboard; alarms; optional SNS topic
- [ ] Deploy to ap-southeast-1 with alias `asa-challenge.fibosolutions.com`, reusing the existing wildcard certificate
- [ ] `seed:aws`, `scripts/smoke_test.py`

### M7 Verification
- [ ] Browser run through the UI checklist as each role, local and live; screenshots into `docs/test-evidence/`
- [ ] Python race and API tests against the live URL
- [ ] Fresh-clone rehearsal: follow the README from scratch in an empty folder

### M8 Hand-over
- [ ] README commands checked against reality, status banner removed
- [ ] Final commit, tag, confirm the repository is public

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
