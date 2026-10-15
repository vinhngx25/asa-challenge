# Testing Guide

How the project is tested, which tools were used, how to run every suite, and how to test the API by hand. Results are in [IMPLEMENTATION_RESULTS.md](IMPLEMENTATION_RESULTS.md); the person-run checklist is [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md).

## 1. Tools used to build and test

| Job | Tool | Notes |
|---|---|---|
| Images and thumbnails (38: portraits, places, cars, service art, logo, desktop and mobile hero) | **Google "nano banana" (Gemini image models, `gemini-3.1-flash-image`)** through Alice's image skill | One shared bright, modern style prompt keeps the set consistent. Each image is checked by eye on a contact sheet, then converted to WebP. File names are fixed, so changing the art needs no code change |
| Real UI testing | **Claude in Chrome**, driven by Alice | Opens the real app in the author's Chrome, signs in as each role, books, cancels, reads the page and captures screenshots. Used on the local app. Browser sign-in on the deployed site is left to the author |
| Repeatable UI regression | **Playwright** (headless Chromium), `scripts/ui-regression/` | 102 checks that mirror the manual cases, including two browser windows racing for one slot, phone width, keyboard-only sign-in, a broken-image check, a throttled-request message and an automated accessibility scan (axe, WCAG 2.1 A and AA). Optional, with its own `package.json` |
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
| Input sweep (every text field and parameter) | `python scripts/input_tests.py --base-url <url>` | seeded data | yes (creates no bookings) |
| Pairwise over HTTP | `python scripts/pairwise_tests.py --base-url <url>` | seeded data | yes |
| Post-deploy smoke | `python scripts/smoke_test.py --base-url <url>` | deployed site | yes |
| UI regression, full (102 checks) | see section 6 | local app running, or the deployed site run by you | local by the agent; production by the author (section 6) |
| UI layout audit (221 checks), resilience (46), visual regression (11), performance (18; 10 on the deployed sign-in page) | see section 6a | local app; performance and the sign-in page also on the deployed site | local by the agent; performance of the sign-in page on production |
| UI public (29 checks, no sign-in) | `node scripts/ui-regression/ui-public.mjs <url>` | nothing | yes |

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
| Login field lengths | 0, 1, 31, 32, 33 (username); 0, 1, 31, 32, 33 (password); 32 and 33 emoji | `boundary_tests.py`, `boundary.integration.test.ts`, UI T-01 to T-12 |
| Record id lengths | 64 (looked up) and 65 (refused) in every position: booking body, availability query, list filter, URL path; 1,500 and 3,000 characters | `boundary.integration.test.ts`, `input_tests.py` |
| Request body shapes | malformed JSON, array, null, wrong types, missing field, extra fields | same |
| Calendar dates | 29 Feb in leap and non-leap years, month 13, month 00, 31 April, `0000`, wrong format, empty, far past, far future | same |
| Start time formats | empty, word, date only, no zone, offset instead of Z, number, null | same |

## 4a. Every text box and string input

Every place a person can type, or a client can send text, with its limit and the tests that cover it. The limits live in one place (`LIMITS` in `shared/src/index.ts`) and are used by the API schemas and by the `maxlength` of the boxes.

| Input | Where | Rule | Tests |
|---|---|---|---|
| Username | login box; `POST /api/auth/login` | 1 to 32 characters, case sensitive, no trimming | UI T-01 to T-12; `boundary_tests.py`; `input_tests.py`; `boundary.integration` |
| Password | login box (with live counter, "no spaces" warning as you type, show-password option and a Sign-in help panel); `POST /api/auth/login` | 1 to 32 characters, **no white space** (space, tab, new line, non-breaking space). The form stops it with "Password cannot contain spaces" and sends nothing; the API answers 400 `INVALID_INPUT` with the same message | same, plus UI C-M03b, T-22 and `boundary.integration` |
| Search | staff All bookings | up to 100 characters, searched as plain text, words combined, extra spaces ignored | UI T-15 to T-21, S-S06 |
| Date | booking page date box; `GET /api/availability?date=` | a real calendar day `YYYY-MM-DD`; the picker allows today to 60 days ahead; any other real date is answered with "nothing free" | UI T-13 to T-16b; `boundary_tests.py`; `boundary.integration` |
| From, To | staff date boxes; `GET /api/appointments?from&to` | ISO 8601 instants or dates from the boxes | UI S-S03, S-S04; `boundary_tests.py` |
| Status, Dealership | staff drop-downs; `status` and `dealershipId` query | fixed lists; the id is capped at 64 characters on the API | UI S-S01, S-S02; `input_tests.py` |
| `vehicleId`, `serviceTypeId`, `dealershipId` | booking body; availability query | 1 to 64 characters, then looked up (404 if unknown) | `boundary.integration`; `input_tests.py`; `pairwise_tests.py` |
| Appointment id | `GET /api/appointments/{id}`, `POST .../{id}/cancel` | 1 to 64 characters, then looked up | same |
| `startTime` | booking body | ISO 8601 UTC instant on a 30 minute boundary | boundary and pairwise suites |
| `Authorization` header | every protected call | `Bearer <token>`; missing, empty, wrong scheme, garbage and up to 7 KB values are refused | `input_tests.py`; UI-public P-16, P-17 |

For each text input the sweeps try: empty, one character, one below the limit, exactly the limit, one over, 300 and 3,000 characters, HTML (`<script>`, `<img onerror>`), SQL-like text, path traversal, encoded and raw control characters, new lines, accented and Arabic and Japanese text, emoji, spaces only and quote characters. The rules checked are: no server error for any value, every client error from the application has the JSON error shape with a request id, the limit is accepted as well formed and one over is refused with 400, and nothing sent is reflected back unescaped.

Notes:

- The API stores no free text from users (only ids that must match existing records and the username of an existing account), so there is no stored-injection surface. React escapes everything it shows; the HTML test confirms a payload is never executed.
- The browser counts characters in UTF-16 units and the server counts code points, so the box is the stricter of the two for emoji (16 fit in the box, 32 are accepted by the API).
- Requests with oversized headers or URLs, and URL paths containing `../` or control characters, are refused by the platform (CloudFront or API Gateway: HTTP 400, 403, 413, 414 or 431) before the application sees them. Those answers are not in the application's JSON shape and expose nothing. This was found by running the sweep on production: locally the same paths reach the API, which answers 404.

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

### On the deployed site

- **Without a sign-in** (the agent runs this on production): `cd scripts/ui-regression && npm install && node ui-public.mjs https://asa-challenge.fibosolutions.com`. 29 checks: the login page loads and is quick, explains the password and username rules, HSTS, CSP and the other security headers, `http://` redirects to `https://`, no console errors, no failed requests, all images load, no accessibility violations, keyboard order, signed-out redirects for `/`, `/book` and unknown addresses, an invalid saved token, every protected API route answers 401, a forged token is refused, malformed input is a 400, the phone-width layout, and that phones and tablets get the portrait banner while wide screens get the large photo.
- **With a sign-in** (run by the author): the full 102-check run needs the demo passwords typed into the login form, which the agent does not do on a deployed site. Run it yourself from the same folder: `node ui-run.mjs https://asa-challenge.fibosolutions.com ./shots` (set `CHROME_PATH` if you do not want to download a browser). It cancels what it books, can be repeated straight away (the staff-cancel step books and cancels its own appointment instead of using seeded data) and takes about two minutes. The manual sheet [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md) covers the same ground by hand.
- **API** on the deployed site: all five Python suites are run by the agent (section 2); they call the API directly and do not use the login form.

### With Playwright (repeatable)

```bash
# the app must be running: npm run db:up, npm run seed:local, npm run dev
cd scripts/ui-regression
npm install
npx playwright install chromium        # once
node ui-run.mjs http://localhost:5173 ./shots
```

Optional: `CHROME_PATH=<chrome.exe>` uses an existing browser instead of the downloaded one. The run prints PASS or FAIL per case id (the same ids as the manual sheet), writes screenshots and `results.json` to the folder, cancels the bookings it created and exits 1 on any failure. It can be run repeatedly.

What the 102 checks include: every Must-have customer and staff case, most Should-have cases, keyboard-only sign-in (Tab, type, Enter), deep-link reload, an invalid token, a check that every image on the booking page loads, no sideways scrolling at 390 px on four pages, and a **two-window race**: window A and window B both reach the last free slot, A confirms first, B then sees the conflict message with the four nearest times and books one of them.

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
| Probe of every string parameter | An over-long id (about 1,100 characters or more) sent as a query value or as an appointment id in the URL made DynamoDB refuse the key and the API answered **500** instead of 400 | Ids are capped at 64 characters in every schema and in the URL path; `input_tests.py` and the boundary tests guard it |
| Review of text boxes | The login and search boxes had no length limit, and the username and password limits were 64 and 128 | Username and password are limited to 32 characters on the API and in the boxes; search to 100; one shared definition |
| Accessibility scan (axe) | Colour contrast below WCAG AA on tabs, duration badges, small grey text and cancelled cards | Darker text tokens; cancelled cards use a greyscale photo instead of 75% opacity |

## 8. Test data and clean-up

- `npm run seed:local` / `npm run seed:aws` wipe the table and load the demo data, so a run always starts from the same state.
- Integration tests use their own table (`asa-challenge-test`), so the demo data is untouched.
- The Python and Playwright runs cancel what they create. If a run is interrupted, re-seed.

## 6a. More kinds of UI testing

Beyond functional, boundary and pairwise checks, six more kinds of browser test run against a production build of the app (`npm run build`, then `npm run preview -w frontend` with the API running). Each is its own script in `scripts/ui-regression/` and prints PASS or FAIL per check.

| Kind | Command (from `scripts/ui-regression`) | What it does | Result |
|---|---|---|---|
| **Layout audit** | `node ui-layout.mjs <url>` | Opens every main screen (sign-in, dashboard, cancelled tab, booking, staff) at seven sizes (320, 360, 390, 414, 768, 1024, 1440 px) and measures: no sideways scrolling; header items share one centre line and, on phones, at most two rows and 130 px; header items do not overlap; touch targets at least 36 px high; no text under 12 px; pictures not stretched; no text cut off | 221 of 221 after fixes (the first run found the phone header three rows and 153 px tall) |
| **Resilience** | `node ui-resilience.mjs <url>` | **Time zones and locales**: the browser set to Singapore, New York, Auckland, London and Ho Chi Minh City; **network failures**: errors, aborted calls, offline, a slow double click, a Fast 3G profile, sign-in with the server down; **session and navigation**: expired token mid-booking, deep links, sign-out in another tab, role switch, back and forward, refresh mid-flow; **random clicking**: 220 seeded random clicks, keystrokes of hostile text, resizes and back/forward for a customer on desktop, a customer on a phone and staff, with writes blocked so data stays intact | 46 of 46 after fixes |
| **Visual regression** | `npm run test:visual:update` once on a build you trust, then `node ui-visual.mjs <url>` after each change | Compares screenshots of the sign-in page (3 sizes), dashboard, booking start and booking times (desktop and phone) and staff overview with saved baselines; dates, counts and references are hidden first so only layout, colour and pictures count; differences are saved to `diffs/` | 11 of 11. Mutation check: changing one colour made the two dashboard comparisons fail; restoring it passed |
| **Performance** | `node ui-perf.mjs <url> [--signed-in]` | First and largest contentful paint, layout shift, bytes, requests and picture weight, on a normal desktop connection and on a mid-range phone (4x slower CPU, Fast 3G); with `--signed-in` also sign-in to dashboard, choosing a date to times on screen, and booking-page weight | Deployed sign-in page: desktop LCP 0.8 s, phone LCP 2.1 s, layout shift 0, 292 KB desktop and 225 KB phone, and the phone does not download the large desktop photo. Local build, signed in: dashboard in 0.2 s (desktop) and 1.4 s (phone), times in 0.07 s and 0.5 s |
| **Time zone and locale** (part of resilience) | as above | Confirms times are shown and stored in the dealership's time (London) for a browser anywhere, UK-style dates in every locale, and that opening time reads 08:00 on both sides of the clock change | passed for all five zones |
| **Random clicking** (part of resilience) | as above | Looks for crashes, blank pages and uncaught errors, not for expected results | no uncaught error in 660 steps |

### Testing through Claude in Chrome

The author prefers UI testing through Claude in Chrome (the browser extension). It is used for the phone Confirm bar and a re-run of the core cases (results in [IMPLEMENTATION_RESULTS.md](IMPLEMENTATION_RESULTS.md) section 18). Practical notes: the extension cannot resize the window, so phone width is shown in a 390 px wide frame (the page's own media queries apply inside it); Chrome often reports the tab as hidden, which makes real keystrokes and some screenshots unreliable, so clicks and form fills go through the page's scripts and screenshots are taken when the tab allows it; sign-in is typed or filled only on the local copy. The Playwright scripts remain as an optional repeatable extra.

### What these found

| Found by | Defect | Fix |
|---|---|---|
| Layout audit | On phones the header was three rows and 153 px tall: logo and title, then the menu, then the avatar and Sign out each on their own line, so the title, avatar and menu did not sit on one line | Redesigned: row one has the logo and title on the left and avatar and Sign out on the right on one centre line; row two has the menu as equal-width buttons; one row on wider screens; title fits at 320 px |
| Layout review | Staff filters on phones had different widths with a lone "To" box, and the search placeholder was cut off | One tidy grid of full-width controls; shorter placeholder |
| Resilience (network) | A fast double click on Confirm booking sent two requests (the database still booked once) | A guard that works on the first click; the same for Cancel and Sign in |
| Resilience (offline) | With the network down, Confirm booking sat on "Confirming..." for ever with no message: the data library silently pauses requests while offline, and there was no request timeout | Requests are always attempted so "You appear to be offline" shows at once; any request that gets no answer for 20 seconds is given up with a clear message |
| Resilience (session) | After an expired session or a deep link the person always landed on the home page after signing in | They now return to the page they asked for (only same-site paths are honoured); a deliberate sign-out returns to the home page |
| The tests themselves | The first version of the resilience script swallowed its own errors and stopped after 25 of its 46 checks without saying so | Errors are reported; the full 46 run and pass |
