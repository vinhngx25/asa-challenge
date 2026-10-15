# Implementation Results

What was built, how it differs from the design, what was tested and what was not. This is the record to read after [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) (intent) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (milestones). Raw test output and screenshots are in [test-evidence/](test-evidence/).

- **Live:** https://asa-challenge.fibosolutions.com (AWS ap-southeast-1)
- **Delivered:** 2026-10-15; hardened with boundary, pairwise and browser tests, then redeployed the same day
- **Status:** all milestones M0 to M9 complete; the latest full run of every suite is green (section 5)

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
| Reviewer can follow the README to build, run, test and deploy | Rehearsed from a fresh clone: install, build, unit tests, seed, integration tests (section 6) |
| Boundary and pairwise testing | Done: 26 boundary tests and 38 pairwise rows in the integration suite, plus 55 boundary and 39 pairwise HTTP checks that also run on the live site (sections 5.2 and 5.3) |
| Real UI testing | Claude in Chrome for exploratory runs, plus a repeatable Playwright run of 51 checks (section 5.4) |
| Manual test cases for a person, by priority | [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md): 14 must have, 21 should have, 12 nice to have |
| Tools recorded | Google nano banana for images, Claude in Chrome and Playwright for the UI, Python and curl for the API (section 10, [TESTING.md](TESTING.md)) |

## 2. Milestone log

| Milestone | Outcome | Commit |
|---|---|---|
| M0 Design | README, system design and plan written and reviewed before any code | `f35a8a9` |
| M1 Foundation | npm workspaces, TypeScript, shared Zod contracts, DynamoDB Local in Docker | `4272114` |
| M2 Backend core | Slot-lock booking service, cancel, auth, routes, seed data, Lambda and Node adapters | `4272114` |
| M3 Backend tests | 13 unit tests and 38 integration tests, Python API and race scripts (extended in M9) | `4272114`, `2aac2e9` |
| M4 Frontend | Login, customer dashboard, booking flow, staff view | `c9b43b5` |
| M5 Visuals | 37 images generated with Alice's Gemini image skill and converted to WebP. First set was flat vector; replaced by a cinematic poster set after review (see section 9) | `c9b43b5`, then the cinematic set |
| M6 Infrastructure and deploy | CDK stack, bootstrap, deploy, seed, smoke test | `2aac2e9` |
| M7 Verification | Python suites against the live site, browser checks, evidence | `2aac2e9` |
| M8 Hand-over | README checked, fresh-clone rehearsal, plan closed | `754f6bb` |
| M9 Hardening and test depth | Boundary and pairwise tests, mutation checks, Playwright UI regression, testing guide, manual test cases, three defects fixed, redeploy and live re-test | `4569a79` and the results commit that follows |

## 3. What was built

### Size

| Area | Files | Lines (TypeScript, Python, CSS) |
|---|---|---|
| `shared/` contracts | 1 | 227 |
| `backend/src` | 16 | 1,526 |
| `backend/test` | 8 | 1,164 |
| `frontend/src` | 13 | 1,301 |
| `infra/` | 2 | 427 |
| `scripts/` (Python and the Playwright run) | 9 | 983 |

Production build: JavaScript 548 KB (gzip about 167 KB), CSS 23 KB. Lambda bundle about 1.2 MB, minified, with the AWS SDK bundled.

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

### 5.1 Unit tests: 16 passed

| File | Tests | Covers |
|---|---|---|
| `time.test.ts` | 10 | UTC offsets in winter and summer, both clock changes (27/28 March 2027 and 24/25 October 2026), local date vs UTC date, opening windows, Sunday closed, Saturday open, slot splitting, half-open end |
| `auth.test.ts` | 3 | Password check is case sensitive, salts differ, malformed hash rejected |
| `pairwise.test.ts` | 3 | The all-pairs generator covers every pair with far fewer rows than the full product, is deterministic, and handles one or two parameters |

### 5.2 Integration tests on DynamoDB Local: 102 passed (4 files)

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

`boundary.integration.test.ts` (26 tests): the value just inside, exactly on and just outside each limit.

| Group | Tests | What is proved |
|---|---|---|
| Opening hours | 6 | For 30, 60, 120 and 240 minute services: first start and last start that fits are booked; one slot before opening, one slot too late and the closing time itself are refused. Saturday follows the same hours, Sunday is closed from first to last minute, Manchester opens on the half hour |
| 30 minute grid | 1 | Only exact slot starts are accepted; plus or minus 1 ms, 1 min and 29 min are refused |
| Lead time and horizon | 4 | Exactly 60 minutes ahead is allowed, one slot or one millisecond less is not; exactly 60 days is allowed, one slot more is not; a start in the past is refused |
| Cancel cut-off | 1 | Allowed 1 ms before the start, refused exactly at the start and after |
| Clock changes | 3 | Opening time in UTC moves by one hour between Saturday 24 and Monday 26 Oct 2026 and between 27 and 29 Mar 2027; the day lists the same number of slots on both sides |
| Capacity | 1 | A one-bay day takes exactly 18 thirty-minute jobs, then refuses the 19th and a start after closing; availability shows none free |
| Locks written | 5 | 1, 2, 4 and 8 slots write exactly slots x 3 locks, all removed on cancel; lock partitions hold the right slot keys in order |
| HTTP inputs | 5 | Login field lengths (0, 1, 64, 65 and 0, 1, 128, 129), malformed JSON, array, null, wrong types, extra fields; 11 invalid and 5 valid calendar dates; 8 invalid start time formats; bad list filters |

`pairwise.integration.test.ts` (38 tests: 1 coverage check and 37 rows): 3,150 combinations of dealership (3), service (7), day (Monday, Saturday, Sunday), start position (first, middle, last fit, after close, before open), contention (none, one bay taken, all qualified technicians taken, all bays taken, vehicle taken) and customer (2) are reduced to 37 rows. Each row arranges the contention in the table, books, and compares the result with an oracle written from the rules. Rows inside opening hours also compare the availability endpoint with the booking result. All 37 pass.

**Mutation checks** show the tests can fail. Locking only the first slot of a booking failed 6 tests. Searching only the first slot failed 1 test, because the transaction locks still stop the double booking (defence in depth).

### 5.3 Black-box Python tests (local and live)

| Script | Local | Live (after the final deploy) |
|---|---|---|
| `api_tests.py` | 38 of 38 | 38 of 38 |
| `race_booking.py` | 11 of 11 | 11 of 11 |
| `boundary_tests.py` | 55 of 55 | 55 of 55 |
| `pairwise_tests.py` | 39 of 39 | 39 of 39 |
| `smoke_test.py` | not applicable | 10 of 10 |

`pairwise_tests.py` covers the booking request (caller, vehicle, service, dealership, start): 648 combinations reduced to 24 pairwise rows, plus a baseline and 14 one-factor-at-a-time rows, 39 in all.

The race script fires every scenario at the same instant with a barrier. On the live table: 7 requests for one bay gave exactly 1 booking and 6 conflicts; 2 bays and 2 technicians gave exactly 2; the same vehicle 5 times gave 1; an overlapping long and short job gave 1; four rivals for a freed slot gave 1. It cancels everything it creates.

### 5.4 Browser checks (Claude in Chrome and Playwright, local app)

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

A defect found and fixed during the first run: the "Sign out" text was too faint against the header. The staff list was also reordered so upcoming bookings come first.

**Playwright regression, 51 of 51 passed** (`scripts/ui-regression/ui-run.mjs`, run twice to prove it cleans up after itself). It uses the case ids of the manual sheet: every Must-have customer and staff case, most Should-have cases and several Nice-to-have cases. Highlights:

- Two browser windows act as two people. Both reach the last free slot; window A confirms; window B is refused with the message and the four nearest times and books one of them.
- Taken and overlapping times are greyed out while back-to-back times stay open; a vehicle booked elsewhere is greyed everywhere.
- Staff: summary, dealership tiles, status and date filters, the empty state, Clear filters, cancelling a customer's booking (the customer then sees it as Cancelled), no booking menu, `/book` returns to the list.
- Signed out: deep links and unknown addresses go to the login, Back reveals nothing, an invalid token returns to the login, the API answers 401.
- Keyboard-only sign-in, reload on `/book`, all 39 images on the booking page load, and no sideways scrolling at 390 px on four pages.

Claude in Chrome was used for exploratory runs of the same flows, including the race (the second person booked through the API while the first page waited on the time step). Screenshots are in [test-evidence/](test-evidence/).

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

A new clone of the public repository, with `npm install`, `npm run build`, `npm test`, `npm run seed:local` and `npm run test:integration`, completed with no manual steps (repeated after the final push): build succeeded, 16 unit tests passed, seed created 10 appointments, 102 integration tests passed. The optional `scripts/ui-regression` folder also installs and parses from a clone. The AWS deployment steps were exercised by the real deploy rather than from the clone.

## 7. Problems met and how they were solved

| Problem | Cause | Fix |
|---|---|---|
| Vitest and tsx failed with "cannot find native binding" | npm dropped native optional packages when dependencies were added one workspace at a time | Declare all dependencies, delete `node_modules` and the lockfile, run one `npm install`. The committed lockfile now contains the platform binaries |
| `concurrently` reported critical advisories | transitive `shell-quote` | Replaced with a 25-line launcher script |
| Local DynamoDB container would not start | Port 8000 in use | Moved to 8100 |
| CDK deploy blocked | Account's `CDKToolkit` stack in `UPDATE_ROLLBACK_FAILED` (roles deleted by hand) | Separate bootstrap with its own qualifier; the stack was not modified |
| Dev server moved to port 5175 | 5173 and 5174 in use | Documented in the README; Vite prints the URL |
| Screenshots and long scripts timed out in Chrome now and then | Chrome throttles timers and stops rendering a background tab | Keep one tab in front; use a message-channel wait inside page scripts; no app defect |
| `GET /availability?date=2026-02-30` returned 200 with another day's hours | The date check only matched the pattern `YYYY-MM-DD` | Dates are checked as real calendar days (400 otherwise). Found by the boundary tests |
| The booking page scrolled sideways on a phone (708 px wide) | Service cards and the category chip row widened their grid column | `min-w-0` on the column and cards. Found by the Playwright phone-width check |
| "Times shown in Manchester time" | The label used the city for a UK-wide zone | Now "UK local time" |

## 8. Known limitations and not verified

- **Not verified:** CloudWatch dashboard layout, X-Ray trace content and alarm firing were created by the deploy but not inspected or triggered. No load or soak test. No real-device phone test. No accessibility audit beyond semantic markup and keyboard-reachable controls.
- **Browser sign-in on the live site** was not performed by the agent; it was verified through the API scripts and the smoke test. The manual sheet is for the author to run there.
- **Frontend has no component-level tests.** UI behaviour is covered end to end by the Playwright run and the manual sheet.
- **The Playwright run was executed on the local app only.** It signs in with the demo accounts through a browser, so the agent did not point it at the live site.
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

## 10. Tools used

| Job | Tool |
|---|---|
| Images and thumbnails (37) | **Google "nano banana" (Gemini image models, `gemini-3.1-flash-image`)** through Alice's image skill, with one shared style prompt, contact-sheet review and WebP conversion |
| Real UI testing | **Claude in Chrome** (Alice driving the author's Chrome) and **Playwright** (headless Chromium, repeatable) |
| API testing | Python scripts (standard library only) against local or live; `curl` and PowerShell examples in [TESTING.md](TESTING.md) |
| Unit and integration | Vitest with DynamoDB Local in Docker |
| Cloud | AWS CLI and CDK, with the dedicated `aiadmin` profile |

## 11. Defects found by testing

| Found by | Defect | Status |
|---|---|---|
| First browser run | "Sign out" text too faint | Fixed |
| Boundary tests | Impossible calendar dates accepted by the availability endpoint | Fixed, covered by tests |
| Playwright, phone width | Booking page 708 px wide, scrolled sideways | Fixed, covered by the UI run |
| Browser review | "Manchester time" label | Fixed |
| Mutation checks | None: the tests fail when the code is broken, as intended | n/a |
