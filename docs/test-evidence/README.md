# Test evidence

Screenshots of the current build (production build, local API on DynamoDB Local), taken through Claude in Chrome. Phone shots show the app in a 390 px wide frame. Commands and the latest results are in [../TESTING.md](../TESTING.md); the checklist is [../MANUAL_TEST_CASES.md](../MANUAL_TEST_CASES.md).

| Screenshot | Shows |
|---|---|
| `01-login.jpg` | Sign-in page: the username and password rules once, under their boxes, and the Sign-in help |
| `02-login-password-rules.jpg` | A password containing a space: live warning, Show password ticked |
| `03-customer-dashboard.jpg` | Customer dashboard |
| `04-booking-times.jpg` | Booking page: choices made, free times, the booking summary |
| `05-conflict-with-alternatives.jpg` | Another person took the time: message and the four nearest free times |
| `06-booking-confirmed.jpg` | Confirmation with reference, bay and technician |
| `07-staff-all-bookings.jpg` | Staff overview with totals, dealership tiles and filters |
| `08-phone-login.jpg` | Sign-in on a phone, with the portrait banner |
| `09-phone-dashboard.jpg` | Phone dashboard and header |
| `10-phone-booking-confirm-bar.jpg` | Phone booking page: summary and Confirm pinned to the bottom |
| `11-phone-conflict-in-bar.jpg` | Phone: the conflict message and nearest times inside the pinned bar |
| `12-phone-staff.jpg` | Phone staff filters and list |

Signing in on the deployed site is done by a person; the deployed site is verified by the Python suites and the smoke test.
