# Out of Scope for This Version

These points were found during design, build, testing and a cross-check review. They are **acknowledged and deliberately not addressed in this version**: the brief asks for a working, correct appointment scheduler, and this version delivers that. Nothing here is a known defect in the delivered behaviour, and none of it is open for discussion in this version. The list shows what a next version would look at first.

Where they came from: [IMPLEMENTATION_RESULTS.md](IMPLEMENTATION_RESULTS.md) section 12 (review), the design assumptions in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) section 14, and the questions raised at the end of the review.

## 1. Security and abuse

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 1 | The API throttle (50 requests per second, burst 100) is shared by all callers, so one client flooding the API slows everyone. Measured: 79 of 400 requests in 4 seconds were throttled and the site recovered at once | A demo with a handful of users; the throttle still protects the database and the bill | Add a per-IP rate rule with AWS WAF |
| 2 | The demo passwords are published and there is no per-account lockout or back-off. Failed sign-ins are counted and alarmed, not blocked | The login is an access gate for a public repository, not user management (stated in the README) | Use a managed identity provider (for example Cognito) with lockout, MFA and password reset |
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
| 15 | Opening hours are fixed per dealership: no holidays, breaks or multi-day jobs; every dealership uses UK time | Stated in the design assumptions | Hours as data, with exceptions |
| 16 | No payments, deposits, waiting list or customer registration | Not part of the brief | Product decisions for later |

## 4. Presentation and test coverage

| # | Point | Why it is out of scope now | A next version would |
|---|---|---|---|
| 17 | Accounts, cars and portraits refer to film characters (the images are fictional and generated, but evocative) | A deliberate theme for this demo | Use neutral names and cars for a formal audience |
| 18 | The date picker follows the browser's locale format | Native control, works everywhere | A custom date picker |
| 19 | X-Ray traces start at Lambda because API Gateway HTTP APIs do not support tracing | A platform limit; logs carry the request id for correlation | Use a REST API or add a gateway log correlation |
| 20 | The CloudWatch dashboard layout was not reviewed visually and no alarm was triggered | The dashboard, metrics and alarms exist and were confirmed through the AWS API | Walk the dashboard and fire each alarm in a game day |
| 21 | The frontend has no component-level unit tests | End-to-end browser tests cover its behaviour | Add component tests |
| 22 | No screen-reader or real-device phone testing | Automated accessibility scans, keyboard-only sign-in and a 390 px layout check were done | Manual accessibility audit and device lab runs |

## What this list is not

- It is not a backlog with dates, and no item here is a promise for a later version.
- It does not describe the behaviour of the delivered application: the requirements in the brief (book against a free bay and a qualified technician, check the whole duration, store a confirmed appointment with customer, vehicle, technician and bay) are met and tested.
