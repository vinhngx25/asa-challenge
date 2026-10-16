# Out of Scope for This Version

The core requirements of the brief are three: book a service for a vehicle, service type, dealership and time (resource-constrained booking); check that a service bay and a qualified technician are both free for the whole duration (real-time availability check); and store a confirmed appointment linking customer, vehicle, technician and bay. **Anything beyond those three is treated as out of scope for this version, to avoid over-engineering, and will be discussed further.**

The points below were found during design, build, testing and review. They are **acknowledged and deliberately not addressed in this version**. Nothing here is a known defect in the delivered behaviour. The list shows what a next version would look at first.

Related: the design assumptions in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) section 11.

## 1. Security and abuse

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 1 | The API throttle (50 requests per second, burst 100) is shared by all callers, so one client flooding the API slows everyone. Measured: 79 of 400 requests in 4 seconds were throttled and the site recovered at once | A demo with a handful of users; the throttle still protects the database and the bill | Add a per-IP rate rule with AWS WAF |
| 2 | The demo passwords are published and there is no per-account lockout or back-off. Failed sign-ins are logged, not blocked or alarmed | The login is an access gate for a public repository, not user management (stated in the README) | Use a managed identity provider (for example Cognito) with lockout, MFA and password reset |
| 3 | The access token is kept in `localStorage` | Mitigated by a strict content security policy and no third-party scripts | Use an HttpOnly cookie session |
| 4 | A token stays valid for 8 hours even if the user were removed | Users are fixed demo accounts | Check the user on each request or shorten the lifetime with refresh tokens |

## 2. Data and scale

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 5 | Lock items of completed bookings are never removed, so storage grows slowly with every booking | Cost is negligible at demo volume | Add a DynamoDB TTL on locks (end of booking plus 30 days) |
| 6 | The staff list is not paginated and loads every booking in the chosen filter | Fine for hundreds of bookings | Paginate, and default to a date window |
| 7 | The staff summary tiles ignore the filters and count all bookings | They are labelled as totals | Label them "all bookings" or follow the filter |
| 8 | Seed dates are relative to the day of the last seed, so demo data ages | Re-seeding is one command | Seed on a schedule, or keep fixed demo dates |
| 9 | No load or soak test beyond a 400-request burst | Not part of the brief | Run a load test against the booking path |

## 3. Booking behaviour

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 10 | The technician is always the first free one in id order, so workload is uneven | The brief asks for a qualified technician, not fair allocation | Assign the least loaded qualified technician |
| 11 | Services are listed by duration, so MOT, Interim and Full Service sit far down the list | All 24 are reachable and filterable by category | Show popular services first or group by category |
| 12 | A booking cannot be rescheduled; the customer cancels and books again | Keeps the transactional rule simple and safe | Move a booking in one transaction |
| 13 | Staff cannot create bookings, block a bay for maintenance or mark a technician absent | The brief is about customers booking against available resources | Add resource calendars for staff |
| 14 | No e-mail, SMS or calendar-file confirmation | Notifications were not requested | Send a confirmation with an `.ics` attachment |
| 15 | Opening hours are fixed per dealership: no holidays, breaks or multi-day jobs; every dealership uses UK time | Stated in the design assumptions (section 11) | Hours as data, with exceptions |
| 16 | No payments, deposits, waiting list or customer registration | Not part of the brief | Product decisions for later |

## 4. Presentation and test coverage

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 17 | Accounts, cars and portraits refer to film characters (the images are fictional and generated, but evocative) | A deliberate theme for this demo | Use neutral names and cars for a formal audience |
| 18 | The date picker follows the browser's locale format | Native control, works everywhere | A custom date picker |
| 19 | Observability is deliberately basic: logs and AWS's built-in metrics only. There are no business metrics (bookings, conflicts, cancellations, sign-ins), no latency metric for the booking itself, no alarm on failed sign-ins, no X-Ray tracing (so no view of time spent finding free resources versus committing the transaction) and no API Gateway access log, and log lines for one request are tied together only by the request line's id, not by a field on every line | A proof of concept with a handful of users; the request line, the booking event lines and the built-in metrics answer "is it up and what failed" | Add business metrics through CloudWatch Embedded Metric Format, tracing on the booking path, a failed-sign-in alarm and a request id on every log line |
| 20 | The infrastructure is not tested automatically. Nothing asserts the CDK stack, so a change could drop or weaken these without any test failing: the 4 alarms (API 5xx at 5 or more in 5 minutes; Lambda errors at 3 or more; p95 latency above 3 seconds for 3 periods; DynamoDB read or write throttling), their SNS topic and the optional e-mail subscription, the CloudWatch dashboard `asa-challenge` and its widgets, the API Gateway throttle (50 requests per second, burst 100), the Lambda settings (Node.js 24, arm64, 512 MB, 15 s), 30-day log retention, the CloudFront security headers (HSTS, CSP, no-sniff, frame and referrer rules) and TLS 1.2 minimum, the private S3 bucket with origin access control, point-in-time recovery on the table, and the least-privilege Lambda role. No alarm has been fired on purpose, and the dashboard has not been reviewed visually. The post-deploy smoke test checks headers, the redirect, login and one booking only | The resources were created by the stack and confirmed through the AWS API; a CDK assertions suite and a game day are extra work for a proof of concept | Add CDK assertion tests for each resource above, run `cdk synth` in CI, and fire every alarm once in a game day |
| 21 | Frontend tests cover state logic only (booking page resets, staff filter message, sign-in and sign-out cache clearing, double click), with the API mocked. They do not render real layouts, so spacing, alignment, colour, images and the phone bar are checked only by the manual cases | jsdom has no layout engine; a browser test tool was set aside to keep the repository small | Add browser-driven end-to-end tests with screenshot comparison, run in CI |
| 22 | No screen-reader or real-device phone testing | Keyboard-only sign-in and the 390 px layout are checked in Chrome | Manual accessibility audit and device lab runs |
| 23 | The browser counts characters in UTF-16 units and the server counts code points, so for emoji the box holds 16 and the API accepts 32 | The box is the stricter side, so nothing over the limit can be sent from the page | Count the same way on both sides |
| 24 | Usernames and passwords are not trimmed, so a leading or trailing space is a different (wrong) account | Case and exact text matter by design | Trim the username before sign-in |
| 25 | UI testing is done in Chrome only; Firefox and Safari are not tested | Set aside for this version | Run the manual cases in Firefox and Safari |
| 26 | No manual accessibility or usability sessions: screen reader (NVDA, VoiceOver), 200% zoom, high-contrast mode, first-time-user walkthrough | Keyboard-only sign-in and layout checks are done; a human session is set aside for this version | Run a moderated accessibility and usability session |
| 27 | No test with heavy data: very long names, hundreds of bookings per customer or per dealership | Demo volumes only | Add large-data fixtures and measure the lists |
| 28 | Requests with oversized headers or URLs, or URL paths containing `../` or control characters, are refused by the platform (CloudFront or API Gateway: 400, 403, 413, 414, 431) in its own format, not the API's JSON error | Happens before the application is reached | Add a gateway response template |
| 29 | Two cancels of the same booking at the same moment are not tested, and neither is a cancel racing a new booking for the freed slot beyond the single scenario in the race script (four rivals for a freed slot). The code uses one transaction with a condition, so the outcome should be one success and one `ALREADY_CANCELLED`, but no test proves it | Cancel is a single conditional transaction and the race script covers the case that matters most (a freed slot taken by exactly one person) | Add a double-cancel and cancel-versus-book case to `race_booking.py` |
| 30 | There is no code coverage measurement, and the mutation checks (breaking the lock writes and the overlap search on purpose) were run manually, not automated | The tests were written against the rules and boundaries directly, and the manual mutation checks showed they fail when the code is wrong | Report coverage in CI and run an automated mutation tool on the booking service |
| 31 | There is no automated test of the deployed site through the browser with a sign-in; a person types the demo passwords and runs the manual cases | Browser sign-in on the deployed site is left to a human; the live API is covered by the Python suites | Run a browser suite against a staging copy with throw-away credentials |
| 32 | There is no CI/CD pipeline. Nothing runs the build, the unit, frontend and integration tests, or the Python suites automatically on a push or a pull request, and nothing deploys automatically: tests are run manually and the deployment is the manual `npm run deploy` followed by `npm run seed:aws` | A proof of concept with one author and one environment; the commands are short, documented and rehearsed from a fresh clone | Add a pipeline that runs the build and the tests with DynamoDB Local on every push, then deploys to a staging stack and runs the Python suites and the smoke test against it before production |

## What this list is not

- It is not a backlog with dates, and no item here is a promise for a later version.
- It does not describe the behaviour of the delivered application: the requirements in the brief (book against a free bay and a qualified technician, check the whole duration, store a confirmed appointment with customer, vehicle, technician and bay) are met and tested.
