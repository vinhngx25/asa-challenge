# Test evidence

Results from the author's runs (Alice). Full detail, tool notes and method: [../TESTING.md](../TESTING.md). Outcomes, differences from the design and known gaps: [../IMPLEMENTATION_RESULTS.md](../IMPLEMENTATION_RESULTS.md). Re-run everything with the commands in the root README.

## Automated results (latest full run)

| Suite | Where | Result |
|---|---|---|
| Type check (all workspaces) | local | clean |
| Unit tests (`npm test`) | local | 20 passed (time zones including both clock changes, slot maths, password hashing, pairwise generator, appointment phase boundaries) |
| Integration tests (`npm run test:integration`) | DynamoDB Local | 104 passed: booking and cancel 25, API and roles 13, **boundary values 28**, **pairwise 38** |
| `scripts/api_tests.py` | local and live | 41 of 41 |
| `scripts/race_booking.py` | local and live | 11 of 11 |
| `scripts/boundary_tests.py` | local and live | 57 of 57 |
| `scripts/input_tests.py` (every text field and parameter) | local and live | 55 of 55 |
| `scripts/pairwise_tests.py` | local and live | 39 of 39 |
| `scripts/smoke_test.py` | live | 10 of 10 |
| `scripts/ui-regression/ui-public.mjs` (browser, no sign-in) | **live** 29 of 29 after the final deploy; local 27 of 27 |
| Playwright UI regression (`scripts/ui-regression`) | local app | 102 of 102 (includes the light-interface measurement, the sign-in help, live password feedback, the text box limits and hostile input, staff search, date suggestion, throttled message and WCAG 2.1 AA scans of four screens) |

"Live" is `https://asa-challenge.fibosolutions.com` on AWS (CloudFront, API Gateway, Lambda, DynamoDB).

### What the race script proves (also on the live DynamoDB table)

| Scenario | Requests fired at the same instant | Outcome |
|---|---|---|
| One bay, one slot | 7 vehicles | exactly 1 booking; 6 receive 409 |
| Two bays, two qualified technicians | 7 vehicles | exactly 2 bookings, on different bays and technicians |
| Same vehicle submitted | 5 times | exactly 1 booking |
| Long and short job overlapping in one bay | 2 | exactly 1 booking |
| Slot freed by a cancel | 4 rivals | exactly 1 takes it |

### Boundary and pairwise

- Boundary values: opening hours for each service length, the 30 minute grid, 60 minute lead time, 60 day horizon, cancel cut-off, clock changes, a full one-bay day, lock counts, field lengths, body shapes, calendar dates and time formats. The list is in [TESTING.md section 4](../TESTING.md).
- Pairwise: 3,150 booking-decision combinations covered by 37 rows, and 648 booking-request combinations covered by 39 rows (24 pairwise, 1 baseline, 14 one-factor-at-a-time).
- Mutation checks: breaking the lock writing made 6 tests fail; breaking the overlap search made 1 fail (the database locks still protected the data).

## UI checks (real browser)

Two tools: **Claude in Chrome** (Alice driving the author's Chrome) and **Playwright** (repeatable script). The screenshots below come from the Playwright run on the local app.

| Check | Result |
|---|---|
| Wrong-case username, wrong password and a password with a space are rejected with one message | passed |
| `JoinWick` sees only their own cars and bookings; `JamesBond` only theirs | passed |
| Booking flow; confirmation shows reference, bay and technician | passed |
| Times for a taken slot, and for overlapping starts, are greyed out; back-to-back times stay open | passed |
| **Two windows race for the same slot**: the second person is refused with the four nearest times and books one of them | passed (`05-conflict-with-alternatives.jpg`) |
| Cancel with confirmation; counts update; the freed slot can be booked by someone else | passed |
| Staff: all bookings, summary, dealership tiles, filters, empty state, Clear filters, cancel; no booking menu; `/book` returns to the list | passed |
| Booking rules in the UI: Sunday closed, 240 minute service last starts at 14:00, 30 and 60 minute start times, date limits, a busy vehicle is greyed everywhere | passed |
| Signed out: `/book` and unknown addresses go to the login; Back shows nothing; an invalid token returns to the login | passed |
| API without a token returns 401; health is public | passed |
| Keyboard-only sign-in; reload on `/book`; all 39 images on the booking page load | passed |
| Phone width (390 px): no sideways scrolling on login, dashboard, booking and staff pages | passed after a fix (the booking page was 708 px wide) |

| Screenshot | Shows |
|---|---|
| `01-login.jpg` | Login page |
| `02-customer-dashboard.jpg` | Customer dashboard |
| `03-booking-times.jpg` | Booking page with times |
| `04-booking-confirmed.jpg` | Confirmation |
| `05-conflict-with-alternatives.jpg` | Second person refused, nearest times offered |
| `06-booking-page-vehicle-busy.jpg` | Greyed times for a vehicle booked elsewhere |
| `07-staff-all-bookings.jpg` | Staff overview |
| `08` to `11` `-mobile-*.jpg` | Phone width: login, dashboard, booking, staff |
| `12-login-help.jpg` | Login page with the rules and the Sign-in help panel |
| `13-login-space-warning.jpg` | Live warning when a password contains a space; Show password ticked |
| `14-mobile-login-help.jpg` | The same page at phone width, with the portrait banner |
| `15-tablet-login.jpg` | The same page at tablet width |

Browser sign-in on the deployed site is performed by the author; the deployed site was verified by the Python scripts and the post-deploy smoke test.
