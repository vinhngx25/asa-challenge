# Testing Guide

How the project is tested, which tools were used, how to run every suite, and how to test the API by hand. Results are in [IMPLEMENTATION_RESULTS.md](IMPLEMENTATION_RESULTS.md); the person-run checklist is [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md).

## 1. Tools used to build and test

| Job | Tool | Notes |
|---|---|---|
| Images and thumbnails (37 portraits, places, cars, service art, logo, hero) | **Google "nano banana" (Gemini image models, `gemini-3.1-flash-image`)** through Alice's image skill | One shared cinematic style prompt keeps the set consistent. Each image is checked by eye on a contact sheet, then converted to WebP. File names are fixed, so changing the art needs no code change |
| Real UI testing | **Claude in Chrome**, driven by Alice | Opens the real app in the author's Chrome, signs in as each role, books, cancels, reads the page and captures screenshots. Used on the local app. Browser sign-in on the deployed site is left to the author |
| Repeatable UI regression | **Playwright** (headless Chromium), `scripts/ui-regression/` | 64 checks that mirror the manual cases, including two browser windows racing for one slot, phone width, keyboard-only sign-in, a broken-image check, a throttled-request message and an automated accessibility scan (axe, WCAG 2.1 A and AA). Optional, with its own `package.json` |
| API black-box and rare cases | **Python scripts** (standard library only) in `scripts/` | Login, roles, validation, boundaries, pairwise, concurrency, post-deploy smoke test. Run against local or live |
| Unit and integration | **Vitest** with DynamoDB Local in Docker | Includes the parallel-booking tests, boundary tests and pairwise tests |
| Manual API calls | `curl` or PowerShell `Invoke-RestMethod` | Examples below |

## 2. What runs where

| Suite | Command | Needs | Runs on live site? |
|---|---|---|---|
| Unit | `npm test` | nothing | n/a |
| Integration (booking, API, boundary, pairwise) | `npm run db:up` then `npm run test:integration` | Docker | n/a (uses its own table) |
| API tests | `python scripts/api_tests.py --base-url <url>` | seeded data | yes |
| Race (concurrent requests) | `python scripts/race_booking.py --base-url <url>` | seeded data | yes |
| Boundary over HTTP | `python scripts/boundary_tests.py --base-url <url>` | seeded data | yes |
| Pairwise over HTTP | `python scripts/pairwise_tests.py --base-url <url>` | seeded data | yes |
| Post-deploy smoke | `python scripts/smoke_test.py --base-url <url>` | deployed site | yes |
| UI regression | see section 6 | local app running | no (signs in through the browser; use locally) |

`<url>` is `http://localhost:3000` for the API on your machine, or the site address. Every script cancels the bookings it makes. All Python scripts exit with code 1 when a check fails, so they can run in CI.

## 3. Testing the API by hand

The API is under `/api`. Every route except `/api/health` and `/api/auth/login` needs a token.

### With curl (Git Bash, macOS, Linux)

```bash
BASE=https://asa-challenge.fibosolutions.com        # or http://localhost:3000

# 1. Health (no token)
curl -s $BASE/api/health

# 2. Sign in and keep the token
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"JoinWick","password":"JoinWick"}' | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 3. See what is free on a date (any Monday to Saturday, up to 60 days ahead)
curl -s "$BASE/api/availability?dealershipId=manchester&serviceTypeId=oil-change&date=2026-10-28" \
  -H "Authorization: Bearer $TOKEN"

# 4. Book (startTime is an ISO UTC instant on a 30 minute boundary)
curl -s -X POST $BASE/api/appointments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"vehicleId":"wick-mustang","serviceTypeId":"oil-change","dealershipId":"manchester","startTime":"2026-10-28T10:00:00.000Z"}'

# 5. List mine, then cancel by id
curl -s $BASE/api/appointments -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/appointments/<id>/cancel -H "Authorization: Bearer $TOKEN"
```

### With PowerShell

```powershell
$base = "https://asa-challenge.fibosolutions.com"
$login = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType application/json `
  -Body (@{ username = "JoinWick"; password = "JoinWick" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod "$base/api/catalog" -Headers $h
Invoke-RestMethod -Method Post "$base/api/appointments" -Headers $h -ContentType application/json `
  -Body (@{ vehicleId = "wick-mustang"; serviceTypeId = "oil-change"; dealershipId = "manchester"; startTime = "2026-10-28T10:00:00.000Z" } | ConvertTo-Json)
```

### Reference

| Call | Who | Success | Typical failures |
|---|---|---|---|
| `POST /api/auth/login` | public | 200 with `token`, `user` | 400 bad body, 401 `INVALID_CREDENTIALS` |
| `GET /api/me`, `/catalog` | any signed-in user | 200 | 401 |
| `GET /api/vehicles` | customer | 200 | 403 for staff |
| `GET /api/availability?dealershipId&serviceTypeId&date[&vehicleId]` | customer | 200, list of slots with `available` | 400 invalid date or ids, 404 unknown dealership or service |
| `POST /api/appointments` | customer | 201 appointment | 400, 401, 403 (staff), 404, 409 `SLOT_UNAVAILABLE` (with `alternatives`) or `VEHICLE_BUSY`, 422 `INVALID_START_TIME` |
| `GET /api/appointments[?dealershipId&from&to&status]` | customer (own), staff (all) | 200 | 400 bad filter |
| `GET /api/appointments/{id}` | owner or staff | 200 | 403, 404 |
| `POST /api/appointments/{id}/cancel` | owner or staff | 200, status `CANCELLED` | 403, 404, 409 `ALREADY_CANCELLED` or `CANNOT_CANCEL_PAST` |

Every error has the same shape, `{"error":{"code","message","requestId"}}`, and every response carries an `X-Request-Id` header. Quote that id when reporting a problem: it finds the matching log line in CloudWatch.

### Writing another API test

`scripts/asa_client.py` gives `Api(base_url)` with `login()` and `call(method, path, token, body)` (returns `(status, json)`), `find_free_start()` to locate a free slot, and `Results` to print PASS/FAIL and set the exit code. Copy `scripts/api_tests.py` as a starting point.

## 4. Boundary value testing

For each rule the tests touch the value just inside, exactly on, and just outside the limit.

| Rule | Values tested | Where |
|---|---|---|
| Opening hours (30, 60, 120, 240 minute services) | first start; one slot before; last start that fits; one slot after; closing time itself | `boundary.integration.test.ts` |
| Different opening times (08:00, 08:30) and Saturday vs Sunday | open edge and close edge on each | same |
| 30 minute grid | on grid; ±1 ms; ±1 min; ±29 min | same, and `boundary_tests.py` |
| Lead time (60 minutes) | exactly 60; 30; exactly 60 with 1 ms already passed; in the past | same |
| Horizon (60 days) | exactly 60 days; one slot beyond | same, and `boundary_tests.py` |
| Cancel cut-off | 1 ms before the start; exactly at the start; after | same |
| Clock changes (24/26 Oct 2026, 27/29 Mar 2027) | opening time in UTC on each side; slot counts equal | same, `time.test.ts`, `boundary_tests.py` |
| Capacity | one-bay day filled slot by slot (18 jobs), then the 19th and an after-close start | same |
| Locks written | 1, 2, 4 and 8 slots, three resources each, and removed on cancel | same |
| Login field lengths | 0, 1, 64, 65 (username); 0, 1, 128, 129 (password) | `boundary_tests.py`, `boundary.integration.test.ts` |
| Request body shapes | malformed JSON, array, null, wrong types, missing field, extra fields | same |
| Calendar dates | 29 Feb in leap and non-leap years, month 13, month 00, 31 April, `0000`, wrong format, empty, far past, far future | same |
| Start time formats | empty, word, date only, no zone, offset instead of Z, number, null | same |

## 5. Pairwise (all-pairs) testing

Two pairwise designs, each with a hand-written expected result:

| Design | Parameters (values) | Full combinations | Rows run | Where |
|---|---|---|---|---|
| Booking decision | dealership (3), service (7: 30 to 240 minutes, 6 skills), day (Mon, Sat, Sun), start position (first, middle, last fit, after close, before open), contention (none, one bay taken, all qualified technicians taken, all bays taken, vehicle taken), customer (2) | 3,150 | 37 | `pairwise.integration.test.ts` |
| Booking request | caller (customer, staff, anonymous), vehicle (own, someone else's, unknown, empty), service (valid, unknown, empty), dealership (valid, unknown, empty), start (valid, malformed, missing, off-grid, past, beyond horizon) | 648 | 24 pairwise + 1 baseline + 14 one-factor-at-a-time = 39 | `pairwise_tests.py` |

- A generator picks rows greedily until every pair of values from any two parameters appears at least once; a test proves the coverage and that the output is deterministic.
- The **booking decision** run arranges the contention directly in the table, executes the booking, and also checks the availability endpoint gives the same answer for the same slot.
- The **booking request** run follows the documented precedence: no token 401, wrong role 403, malformed body 400, bad start time 422, unknown record 404.
- Pairwise rarely yields the all-valid row and isolates no single fault, so the request design adds a baseline and every one-factor-at-a-time variation.
- **Mutation check:** I deliberately broke the code twice and confirmed the suites fail. Locking only the first slot of a booking failed 6 tests (overlap, capacity, lock count). Checking only the first slot when searching failed 1 test, because the transaction locks still stop the double booking and only the availability read was wrong. That is the intended defence in depth.

## 6. UI testing

### With Claude in Chrome (what Alice did)

Alice opened the app in real Chrome, signed in as John Wick, James Bond and Winston, and performed the manual cases: wrong-case sign-in, booking, conflict, nearest times, cancel, staff filters, `/book` for staff. She read the rendered page and took screenshots. Notes from practice:

- Chrome slows background-tab timers and stops rendering them, so keep one tab in front. If screenshots time out, wait or bring the window forward.
- Run it against the local app. Entering demo passwords into the deployed site through the browser is left to the human.

### With Playwright (repeatable)

```bash
# the app must be running: npm run db:up, npm run seed:local, npm run dev
cd scripts/ui-regression
npm install
npx playwright install chromium        # once
node ui-run.mjs http://localhost:5173 ./shots
```

Optional: `CHROME_PATH=<chrome.exe>` uses an existing browser instead of the downloaded one. The run prints PASS or FAIL per case id (the same ids as the manual sheet), writes screenshots and `results.json` to the folder, cancels the bookings it created and exits 1 on any failure. It can be run repeatedly.

What the 64 checks include: every Must-have customer and staff case, most Should-have cases, keyboard-only sign-in (Tab, type, Enter), deep-link reload, an invalid token, a check that every image on the booking page loads, no sideways scrolling at 390 px on four pages, and a **two-window race**: window A and window B both reach the last free slot, A confirms first, B then sees the conflict message with the four nearest times and books one of them.

## 7. Defects found by testing

| Found by | Defect | Fix |
|---|---|---|
| Boundary test | `GET /availability?date=2026-02-30` (and other impossible dates) returned 200 with the hours of a different day | Dates are validated as real calendar days (400 otherwise) |
| Playwright at 390 px | The booking page was 708 px wide on a phone and scrolled sideways: service cards and the category chips widened their grid column | `min-w-0` on the column and on the service cards; the page now fits |
| Browser review | "Sign out" text was too faint in the header | Own button style with higher contrast |
| Browser review | "Times shown in Manchester time" for a UK-wide time zone | Reads "UK local time" |
| Review of design against code | `RATE_LIMITED` (429) was in the design but nothing produced it; API Gateway's own 429 body is not the API error shape and the page showed a generic error. Observed live: 79 of 400 requests in a 4 second burst were throttled | The web app maps 429 to "Too many requests" (checked by a UI test) |
| Persona walkthrough as a customer | The suggested booking date could be a Sunday, when every dealership is closed | The suggestion moves to the next open day until the customer picks a date |
| Persona walkthrough as staff | No way to find a booking from a reference, plate or name | Search box on All bookings |
| Persona walkthrough | A booking that had started was labelled "Upcoming" with no Cancel button | Labelled "In progress"; the phase logic is shared and boundary-tested |
| Accessibility scan (axe) | Colour contrast below WCAG AA on tabs, duration badges, small grey text and cancelled cards | Darker text tokens; cancelled cards use a greyscale photo instead of 75% opacity |

## 8. Test data and clean-up

- `npm run seed:local` / `npm run seed:aws` wipe the table and load the demo data, so a run always starts from the same state.
- Integration tests use their own table (`asa-challenge-test`), so the demo data is untouched.
- The Python and Playwright runs cancel what they create. If a run is interrupted, re-seed.
