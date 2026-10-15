# Implementation Results

What was built, how it differs from the design, what was tested and what was not. This is the record to read after [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) (intent) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (milestones). Raw test output and screenshots are in [test-evidence/](test-evidence/).

- **Live:** https://asa-challenge.fibosolutions.com (AWS ap-southeast-1)
- **Delivered:** 2026-10-15, in 6 commits on `main`
- **Status:** all milestones M0 to M8 complete

## 1. Summary

| Requirement | Result |
|---|---|
| Resource-constrained booking (vehicle, service type, dealership, time) | Built. `POST /api/appointments`, booking wizard in the UI |
| Real-time availability check (bay and qualified technician free for the whole duration) | Built. Checked on every request with consistent reads, and enforced by the database at commit |
| Confirmed appointment record (customer, vehicle, technician, bay) | Built. Persisted in DynamoDB, returned on booking and listed on dashboards |
| Login gate, customer dashboard, staff view | Built (3 accounts, case-sensitive, JWT) |
| Cancel and free resources | Built, transactional |
| Demo data: 5 bays, 13 technicians, 24 services, 3 dealerships | Built, matches exactly |
| Generated illustrations | 37 cinematic images, 745 KB total as WebP |
| Frontend and backend separate | `frontend/` and `backend/` with a shared contract package |
| One environment on AWS with SSL at `asa-challenge.fibosolutions.com` | Deployed, CloudFront with the wildcard certificate, HTTP redirects to HTTPS |
| Observability | Structured logs, custom metrics, X-Ray tracing, dashboard, 5 alarms |
| Reviewer can follow the README to build, run, test and deploy | Rehearsed from a fresh clone up to seeding and tests (see section 6) |

## 2. Milestone log

| Milestone | Outcome | Commit |
|---|---|---|
| M0 Design | README, system design and plan written and reviewed before any code | `f35a8a9` |
| M1 Foundation | npm workspaces, TypeScript, shared Zod contracts, DynamoDB Local in Docker | `4272114` |
| M2 Backend core | Slot-lock booking service, cancel, auth, routes, seed data, Lambda and Node adapters | `4272114` |
| M3 Backend tests | 13 unit tests and 38 integration tests, Python API and race scripts | `4272114`, `2aac2e9` |
| M4 Frontend | Login, customer dashboard, booking flow, staff view | `c9b43b5` |
| M5 Visuals | 37 images generated with Alice's Gemini image skill and converted to WebP. First set was flat vector; replaced by a cinematic poster set after review (see section 9) | `c9b43b5`, then the cinematic set |
| M6 Infrastructure and deploy | CDK stack, bootstrap, deploy, seed, smoke test | `2aac2e9` |
| M7 Verification | Python suites against the live site, browser checks, evidence | `2aac2e9` |
| M8 Hand-over | README checked, fresh-clone rehearsal, plan closed | `754f6bb` |

## 3. What was built

### Size

| Area | Files | Lines (TypeScript, Python, CSS) |
|---|---|---|
| `shared/` contracts | 1 | 188 |
| `backend/src` | 16 | 1,364 |
| `backend/test` | 4 | 479 |
| `frontend/src` | 13 | 1,179 |
| `infra/` | 2 | 390 |
| `scripts/` (Python) | 4 | 301 |

Production build: JavaScript 544 KB (gzip about 166 KB), CSS 23 KB. Lambda bundle about 1.2 MB, minified, with the AWS SDK bundled.

### Versions installed (latest at the time)

Hono 4.13.13, Zod 4.6.7, jose 6.2.12, Powertools for AWS Lambda 2.36.0, React 19.3.1, React Router 7.18.4, TanStack Query 5.104, Vite 8.3.4, Tailwind CSS 4.3.3, Vitest 5.0.4, TypeScript 7.0.2, AWS CDK library 2.273.0, Node.js 22.

### AWS resources created (stack `AsaChallenge`, 36 resources)

| Group | Resources |
|---|---|
| Web | S3 bucket (private), CloudFront distribution with origin access control, security-headers policy, SPA rewrite function, bucket deployment with cache invalidation |
| API | HTTP API with throttling (50 requests per second, burst 100) and access logs, Lambda function (Node.js 22, arm64, 512 MB, X-Ray active) |
| Data | DynamoDB table `asa-challenge` (on-demand, point-in-time recovery, two GSIs), Secrets Manager secret for the token key |
| DNS | Route 53 A and AAAA aliases for the domain |
| Monitoring | CloudWatch dashboard `asa-challenge`, 5 alarms, SNS topic (no subscribers), two log groups with 30-day retention |

Deployment time: 865 seconds (CloudFront dominates). Region: ap-southeast-1. Certificate: the existing wildcard certificate for `*.fibosolutions.com`.

### Demo data (verified by tests)

3 dealerships, 5 bays (2, 2, 1), 13 technicians (5, 4, 4), 24 services (6 x 30, 8 x 60, 6 x 120, 4 x 240 minutes, 7 skill categories), 3 users, 7 vehicles, 10 appointments (4 completed, 4 upcoming, 2 cancelled at seed time).

## 4. Differences from the design

| Area | Design said | As built | Why |
|---|---|---|---|
| Local DynamoDB port | 8000 | 8100 | Port 8000 was taken by another container on the author's machine; 8100 avoids a clash |
| Duplicate protection | `ClientRequestToken` on the transaction | Vehicle lock | The vehicle lock already stops a double submit with `VEHICLE_BUSY`; a token added nothing |
| Time rule errors | `400` | `422 INVALID_START_TIME` | Separates a malformed body (`400`) from a valid body that breaks a business rule |
| Extra error codes | not listed | `VEHICLE_BUSY`, `CANNOT_CANCEL_PAST` | Needed for clear messages |
| Dev launcher | concurrently | `scripts/dev.mjs` | `concurrently` pulled in a dependency with critical advisories |
| Python tests | `requests` | standard library only | Reviewers install nothing |
| Cache policy | not specified | 5 minutes for site files plus a full invalidation on every deploy | Simple and always fresh after a deploy |
| CloudFront price class | not specified | Price class 200 (includes Asia) | Singapore and UK audiences |
| CDK bootstrap | default | optional `CDK_QUALIFIER` | The account's default `CDKToolkit` stack was broken (`UPDATE_ROLLBACK_FAILED`); the live deploy uses its own bootstrap |
| Alarm e-mail | optional | not configured | No subscriber was requested |
| UI testing of the live site | Claude in Chrome | local copy in Chrome, live site by API scripts | Signing in on the deployed site stays with the author |

## 5. Results by area

### 5.1 Unit tests: 13 passed

| File | Tests | Covers |
|---|---|---|
| `time.test.ts` | 10 | UTC offsets in winter and summer, both clock changes (27/28 March 2027 and 24/25 October 2026), local date vs UTC date, opening windows, Sunday closed, Saturday open, slot splitting, half-open end |
| `auth.test.ts` | 3 | Password check is case sensitive, salts differ, malformed hash rejected |

### 5.2 Integration tests on DynamoDB Local: 38 passed

`booking.integration.test.ts` (25 tests)

| Group | Tests | What is proved |
|---|---|---|
| Happy path | 2 | Bay and a qualified technician assigned; second parallel booking uses the other bay and technician; a third is refused |
| Time boundaries | 4 | Back-to-back bookings do not conflict; overlaps in either direction do; off-grid, outside-hours, Sunday and too-soon starts are rejected; a 30-minute job may end exactly at closing |
| Resource constraints | 5 | No qualified technician free blocks the booking though a bay is free; no bay free blocks it though technicians are free; alternatives are offered and bookable; one vehicle cannot be in two places; customers book only their own vehicles |
| Concurrency | 4 | 7 requests for one bay: exactly 1 wins. 7 requests for 2 bays and 2 technicians: exactly 2 win on different bays and technicians. Same vehicle 5 times: 1 booking. Long and short overlapping jobs: 1 booking |
| Cancel | 5 | Frees bay, technician and vehicle; not repeatable; owner only, staff may cancel any; started appointments cannot be cancelled; unknown id is 404 |
| Availability | 4 | Booked and neighbouring times are marked unavailable and are released on cancel; last start fits before closing; Sunday is closed; a busy vehicle shows unavailable |
| Listing and roles | 1 | Customers see only their own; staff see all and can filter by dealership, status and date range |

`api.integration.test.ts` (13 tests): case-sensitive login, uniform error for wrong user and wrong password, body validation, `/me`, closed API without or with a bad token, only `/health` public, per-customer isolation, staff overview and filter, staff cannot book, 403 on another customer's booking, booking returns 201 with the full record, 409 with alternatives and rebooking after cancel, request validation, catalog counts.

### 5.3 Black-box Python tests (local and live)

| Script | Local | Live |
|---|---|---|
| `api_tests.py` | 38 of 38 | 38 of 38 |
| `race_booking.py` | 11 of 11 | 11 of 11 |
| `smoke_test.py` | not applicable | 10 of 10 |

The race script fires every scenario at the same instant with a barrier. On the live table: 7 requests for one bay gave exactly 1 booking and 6 conflicts; 2 bays and 2 technicians gave exactly 2; the same vehicle 5 times gave 1; an overlapping long and short job gave 1; four rivals for a freed slot gave 1. It cancels everything it creates.

### 5.4 Browser checks (Claude in Chrome, local copy)

| Check | Result |
|---|---|
| Login with wrong case rejected, message shown | passed |
| `JoinWick`: dashboard shows own bookings, tabs and counts | passed |
| Booking flow end to end; confirmation shows technician and bay | passed (booked Oil & Filter Change, Kensington, Bay 1, Oliver Hughes) |
| Cancel with inline confirmation; counts update | passed |
| `JamesBond`: sees only own bookings | passed |
| `Winston`: all bookings, summary tiles, dealership tiles, filters; upcoming first | passed |
| Phone width (390 px): header wraps, cards stack | passed |
| Live site: HTTPS login page renders | passed |

A defect found and fixed during this run: the "Sign out" text was too faint against the header. The staff list was also reordered so upcoming bookings come first.

### 5.5 Performance on the live site (single client, warm path)

| Call | Time |
|---|---|
| `GET /api/health` first call (cold start) | about 1.3 s |
| `GET /api/health` warm | 90 to 150 ms |
| `POST /api/auth/login` | about 0.8 s (scrypt hashing is deliberate) |
| `GET /api/catalog` warm | 75 to 100 ms |
| `GET /api/appointments` | 117 to 145 ms |

No load test was run.

## 6. Fresh-clone rehearsal

A new clone of the public repository, with `npm install`, `npm run build`, `npm test`, `npm run seed:local` and `npm run test:integration`, completed with no manual steps: build succeeded, 13 unit tests passed, seed created 10 appointments, 38 integration tests passed. The AWS deployment steps were exercised by the real deploy rather than from the clone.

## 7. Problems met and how they were solved

| Problem | Cause | Fix |
|---|---|---|
| Vitest and tsx failed with "cannot find native binding" | npm dropped native optional packages when dependencies were added one workspace at a time | Declare all dependencies, delete `node_modules` and the lockfile, run one `npm install`. The committed lockfile now contains the platform binaries |
| `concurrently` reported critical advisories | transitive `shell-quote` | Replaced with a 25-line launcher script |
| Local DynamoDB container would not start | Port 8000 in use | Moved to 8100 |
| CDK deploy blocked | Account's `CDKToolkit` stack in `UPDATE_ROLLBACK_FAILED` (roles deleted by hand) | Separate bootstrap with its own qualifier; the stack was not modified |
| Dev server moved to port 5175 | 5173 and 5174 in use | Documented in the README; Vite prints the URL |
| A browser tab stopped answering screenshots once | Transient renderer stall | Re-opened a tab; no app defect |

## 8. Known limitations and not verified

- **Not verified:** CloudWatch dashboard layout, X-Ray trace content and alarm firing were created by the deploy but not inspected or triggered. No load or soak test. No real-device phone test. No accessibility audit beyond semantic markup and keyboard-reachable controls.
- **Browser sign-in on the live site** was not performed by the agent; it was verified through the API scripts.
- **Frontend has no automated component tests.** UI behaviour is covered by the browser checklist.
- **JavaScript bundle is one 544 KB file.** No code splitting; acceptable for this size of app.
- **Staff list is not paginated.** Fine for demo volumes.
- **Login gate is not production authentication.** Fixed users, no lockout beyond API throttling and an alarm.
- **Out of scope as agreed:** payments, notifications, rescheduling, waitlists, registration, multi-day jobs, holidays.
- **Demo data is reset by every `seed` run**, which wipes the table first.

## 9. Visual direction change

The first image set used a flat vector illustration style, chosen by the agent without samples. On review the author asked for a cinematic poster look, so every image was regenerated and the old files removed from the working tree (earlier versions remain in git history).

| Item | Before | After |
|---|---|---|
| Style | flat vector illustration, navy and amber | cinematic neo-noir poster look, teal and navy shadows, amber highlights, haze and grain |
| People | stylised avatars | fictional painterly portraits, each in a themed scene |
| Cars and places | studio side views, flat | each car on its own road or street, dealerships at dusk or night |
| Service categories | flat icons | dramatic macro shots (glowing brake disc, pouring oil, electrical arcs) |
| Size | 401 KB for 37 files | 745 KB for 37 files |
| Process | one 3-image style test, then the full set | 6-image sample for review of the look, then the remaining 31 |

Changes outside the images: the empty-state picture now fills its frame instead of being contained. File names are unchanged, so no component code depends on the style. Browser checks were repeated for login, booking, customer dashboard and staff view; screenshots in `docs/test-evidence/` show the new look.
