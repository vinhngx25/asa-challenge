# Test evidence

Results from the author's run (Alice, with Claude in Chrome for the UI). Re-run everything with the commands in the root README.

## Automated results

| Suite | Where | Result |
|---|---|---|
| Unit tests (`npm test`) | local | 13 passed (time zones including both clock changes, slot maths, password hashing) |
| Integration tests (`npm run test:integration`) | DynamoDB Local | 38 passed (booking, boundaries, resource limits, **parallel bookings**, cancel, availability, roles) |
| `scripts/api_tests.py` | local and live | 38 of 38 checks |
| `scripts/race_booking.py` | local and live | 11 of 11 checks |
| `scripts/smoke_test.py` | live | 10 of 10 checks |

"Live" is `https://asa-challenge.fibosolutions.com` on AWS (CloudFront, API Gateway, Lambda, DynamoDB).

### What the race script proves (also on the live DynamoDB table)

| Scenario | Requests fired at the same instant | Outcome |
|---|---|---|
| One bay, one slot | 7 vehicles | exactly 1 booking; 6 receive 409 |
| Two bays, two qualified technicians | 7 vehicles | exactly 2 bookings, on different bays and technicians |
| Same vehicle submitted | 5 times | exactly 1 booking |
| Long and short job overlapping in one bay | 2 | exactly 1 booking |
| Slot freed by a cancel | 4 rivals | exactly 1 takes it |

## UI checks (browser, driven by an AI agent)

| Check | Result |
|---|---|
| Login rejects wrong case (`joinwick`) | passed |
| `JoinWick` sees only their own bookings | passed |
| Booking flow: vehicle, service, dealership, date, time, confirm; shows technician and bay | passed |
| Cancel flow with inline confirmation; counts update | passed |
| `JamesBond` sees only their own bookings (see `customer-dashboard-jamesbond.jpg`) | passed |
| `Winston` (staff) sees every booking, with summary, dealership tiles and filters (see `staff-all-bookings.jpg`) | passed |
| Phone width (390 px) layout | passed |
| Live site served over HTTPS with the login page (see `live-login.jpg`) | passed |

Sign-in on the live site was verified through the API scripts above; the browser run used the local copy.
