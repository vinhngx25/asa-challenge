# Testing Guide

How the project is tested, how to run every suite, the latest results, and how to test the API by hand. The person-run checklist is [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md); screenshots are in [test-evidence/](test-evidence/).

## 1. Tools

| Job | Tool | Notes |
|---|---|---|
| Backend unit and integration | **Vitest** with DynamoDB Local in Docker | Includes the parallel-booking, boundary and pairwise tests |
| Frontend state | **Vitest** with React Testing Library (jsdom), API mocked | Booking page resets, staff filters, sign-in and sign-out, times shown in the dealership time zone |
| Continuous integration | **GitHub Actions** (`.github/workflows/ci.yml`) | On every push and pull request: build, unit, frontend and integration tests |
| API black-box and concurrency | **Python scripts** (standard library only) in `scripts/` | Roles, validation, boundaries, pairwise, concurrency, every text input, post-deploy smoke test. Run against local or the live site |
| UI | The manual sheet, run by hand or through **Claude in Chrome** (driven by Alice) | Real browser, real clicks; screenshots in `docs/test-evidence/` |
| Images | Google "nano banana" (Gemini image models) through Alice's image skill | 38 WebP files; one shared style prompt keeps the set consistent |
| Manual API calls | `curl` or PowerShell `Invoke-RestMethod` | Examples in section 4 |

## 2. What runs where

| Suite | Command | Needs | Runs on the live site? |
|---|---|---|---|
| Unit (backend) | `npm test` | nothing | n/a |
| Frontend state | `npm run test:frontend` | nothing | n/a |
| Integration (booking, API, boundary, pairwise) | `npm run db:up` then `npm run test:integration` | Docker | n/a (uses its own table `asa-challenge-test`) |
| API tests | `python scripts/api_tests.py --base-url <url>` | seeded data | yes |
| Race (concurrent requests) | `python scripts/race_booking.py --base-url <url>` | seeded data | yes |
| Boundary over HTTP | `python scripts/boundary_tests.py --base-url <url>` | seeded data | yes |
| Input sweep (every text field and parameter) | `python scripts/input_tests.py --base-url <url>` | seeded data | yes (creates no bookings) |
| Pairwise over HTTP | `python scripts/pairwise_tests.py --base-url <url>` | seeded data | yes |
| Post-deploy smoke | `python scripts/smoke_test.py --base-url <url>` | deployed site | yes |
| UI | [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md) | local app or the deployed site | yes, with a sign-in typed by a person |

`<url>` is `http://localhost:3000` for the API on your machine, or the site address. Every script cancels the bookings it makes. All Python scripts exit with code 1 when a check fails, so they can run in CI. `npm run seed:local` and `npm run seed:aws` wipe the table and load the demo data, so a run starts from the same state; if a run is interrupted, re-seed.

## 3. Latest results

All suites pass.

| Suite | Result |
|---|---|
| Type check (all workspaces) | clean |
| Backend unit tests | 20 passed |
| Frontend tests | 15 passed (booking page 7, staff overview 2, sign-in and sign-out 2, time zone display 4) |
| Integration tests | 105 passed (booking and cancel 26, API and roles 13, boundary values 28, pairwise 38) |
| `api_tests.py` | 41 of 41 |
| `race_booking.py` | 11 of 11 |
| `boundary_tests.py` | 57 of 57 |
| `input_tests.py` | 55 of 55 |
| `pairwise_tests.py` | 39 of 39 |
| `smoke_test.py` (live site) | 10 of 10 |

The same four steps (build, unit, frontend, integration) run in GitHub Actions. The Python suites pass locally and on the live site (https://asa-challenge.fibosolutions.com). The manual sheet is run in Chrome on the local app; signing in on the deployed site is done by a person.

What the race script proves, also on the live DynamoDB table:

| Scenario | Requests fired at the same instant | Outcome |
|---|---|---|
| One bay, one slot | 7 vehicles | exactly 1 booking; 6 receive 409 |
| Two bays, two qualified technicians | 7 vehicles | exactly 2 bookings, on different bays and technicians |
| Same vehicle submitted | 5 times | exactly 1 booking |
| Long and short job overlapping in one bay | 2 | exactly 1 booking |
| Slot freed by a cancel | 4 rivals | exactly 1 takes it |

## 4. Testing the API by hand

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

## 5. Boundary value testing

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
| Login field lengths | 0, 1, 31, 32, 33 (username); 0, 1, 31, 32, 33 (password); 32 and 33 emoji | `boundary_tests.py`, `boundary.integration.test.ts`, manual C-M02, C-S18 |
| Record id lengths | 64 (looked up) and 65 (refused) in every position: booking body, availability query, list filter, URL path; 1,500 and 3,000 characters | `boundary.integration.test.ts`, `input_tests.py` |
| Request body shapes | malformed JSON, array, null, wrong types, missing field, extra fields | same |
| Calendar dates | 29 Feb in leap and non-leap years, month 13, month 00, 31 April, `0000`, wrong format, empty, far past, far future | same |
| Start time formats | empty, word, date only, no zone, offset instead of Z, number, null | same |

## 6. Every text box and string input

Every place a person can type, or a client can send text, with its limit and the tests that cover it. The limits live in one place (`LIMITS` in `shared/src/index.ts`) and are used by the API schemas and by the `maxlength` of the boxes.

| Input | Where | Rule | Tests |
|---|---|---|---|
| Username | login box; `POST /api/auth/login` | 1 to 32 characters, case sensitive, no trimming | manual C-M02, C-S18; `boundary_tests.py`; `input_tests.py`; `boundary.integration` |
| Password | login box (with live counter, "no spaces" warning as you type, show-password option and a Sign-in help panel); `POST /api/auth/login` | 1 to 32 characters, **no white space** (space, tab, new line, non-breaking space). The form stops it with "Password cannot contain spaces" and sends nothing; the API answers 400 `INVALID_INPUT` with the same message | same, plus manual C-M03b, C-S19 and `boundary.integration` |
| Search | staff All bookings | up to 100 characters, searched as plain text, words combined, extra spaces ignored | manual S-S06, S-S07 |
| Date | booking page date box; `GET /api/availability?date=` | a real calendar day `YYYY-MM-DD`; the picker allows today to 60 days ahead; any other real date is answered with "nothing free" | manual C-S04, C-S05, C-S17; `boundary_tests.py`; `boundary.integration` |
| From, To | staff date boxes; `GET /api/appointments?from&to` | ISO 8601 instants or dates from the boxes | manual S-S03, S-S04; `boundary_tests.py` |
| Status, Dealership | staff drop-downs; `status` and `dealershipId` query | fixed lists; the id is capped at 64 characters on the API | manual S-S01, S-S02; `input_tests.py` |
| `vehicleId`, `serviceTypeId`, `dealershipId` | booking body; availability query | 1 to 64 characters, then looked up (404 if unknown) | `boundary.integration`; `input_tests.py`; `pairwise_tests.py` |
| Appointment id | `GET /api/appointments/{id}`, `POST .../{id}/cancel` | 1 to 64 characters, then looked up | same |
| `startTime` | booking body | ISO 8601 UTC instant on a 30 minute boundary | boundary and pairwise suites |
| `Authorization` header | every protected call | `Bearer <token>`; missing, empty, wrong scheme, garbage and up to 7 KB values are refused | `input_tests.py` |

For each text input the sweeps try: empty, one character, one below the limit, exactly the limit, one over, 300 and 3,000 characters, HTML (`<script>`, `<img onerror>`), SQL-like text, path traversal, encoded and raw control characters, new lines, accented and Arabic and Japanese text, emoji, spaces only and quote characters. The rules checked are: no server error for any value, every client error from the application has the JSON error shape with a request id, the limit is accepted as well formed and one over is refused with 400, and nothing sent is reflected back unescaped.

Notes:

- The API stores no free text from users (only ids that must match existing records and the username of an existing account), so there is no stored-injection surface. React escapes everything it shows; the HTML test confirms a payload is never executed.
- The browser counts characters in UTF-16 units and the server counts code points, so the box is the stricter of the two for emoji (16 fit in the box, 32 are accepted by the API).
- Requests with oversized headers or URLs, and URL paths containing `../` or control characters, are refused by the platform (CloudFront or API Gateway: HTTP 400, 403, 413, 414 or 431) before the application sees them. Those answers are not in the application's JSON shape and expose nothing. Locally the same paths reach the API, which answers 404.

## 7. Pairwise (all-pairs) testing

Two pairwise designs, each with a hand-written expected result:

| Design | Parameters (values) | Full combinations | Rows run | Where |
|---|---|---|---|---|
| Booking decision | dealership (3), service (7: 30 to 240 minutes, 6 skills), day (Mon, Sat, Sun), start position (first, middle, last fit, after close, before open), contention (none, one bay taken, all qualified technicians taken, all bays taken, vehicle taken), customer (2) | 3,150 | 37 | `pairwise.integration.test.ts` |
| Booking request | caller (customer, staff, anonymous), vehicle (own, someone else's, unknown, empty), service (valid, unknown, empty), dealership (valid, unknown, empty), start (valid, malformed, missing, off-grid, past, beyond horizon) | 648 | 24 pairwise + 1 baseline + 14 one-factor-at-a-time = 39 | `pairwise_tests.py` |

- A generator picks rows greedily until every pair of values from any two parameters appears at least once; a test proves the coverage and that the output is deterministic.
- The **booking decision** run arranges the contention directly in the table, executes the booking, and also checks the availability endpoint gives the same answer for the same slot.
- The **booking request** run follows the documented precedence: no token 401, wrong role 403, malformed body 400, bad start time 422, unknown record 404.
- Pairwise rarely yields the all-valid row and isolates no single fault, so the request design adds a baseline and every one-factor-at-a-time variation.
- **Mutation check:** locking only the first slot of a booking makes 6 integration tests fail (overlap, capacity, lock count); checking only the first slot when searching makes 1 fail, because the transaction locks still stop the double booking and only the availability read is wrong. That is the intended defence in depth.

## 8. UI testing

Run the cases in [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md) in your own browser, or have Claude in Chrome (the browser extension) run them. They cover sign-in rules, booking, a conflict with nearest times, cancelling, the staff view, search and filters, session handling, and the phone layout.

- **Without signing in** (safe on the deployed site): the sign-in page loads, explains the username and password rules, redirects `http://` to `https://`, has no console errors and loads every image; `/`, `/book` and unknown addresses send a signed-out visitor to the sign-in page. The security headers, 401 on every protected route, forged-token and malformed-input checks are covered by the Python suites.
- **With a sign-in**: type the demo passwords yourself; the Must-have section takes about 15 minutes.
- **Phone layout**: the Claude in Chrome extension cannot resize the window, so phone width is shown by loading the app in a 390 px wide frame; the page's own media queries apply inside it. On a real phone, or a narrow desktop window, the booking page shows the summary and Confirm button as a bar pinned to the bottom.
- Chrome slows hidden tabs, so keep one tab in front; if a screenshot times out, bring the window forward.
