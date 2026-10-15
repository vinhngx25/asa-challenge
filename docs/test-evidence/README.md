# Test evidence

Screenshots from Claude in Chrome (Alice driving Chrome) on the app, with what each shows. Commands and the latest results are in [../TESTING.md](../TESTING.md); the checklist is [../MANUAL_TEST_CASES.md](../MANUAL_TEST_CASES.md).

| Screenshot | Shows |
|---|---|
| `01-login.jpg` | Sign-in page |
| `02-customer-dashboard.jpg` | Customer dashboard |
| `03-booking-times.jpg` | Booking page with free and taken times |
| `04-booking-confirmed.jpg` | Confirmation with reference, bay and technician |
| `05-conflict-with-alternatives.jpg` | A second person refused for the same slot, nearest times offered |
| `06-booking-page-vehicle-busy.jpg` | Times greyed out for a vehicle that is booked elsewhere |
| `07-staff-all-bookings.jpg` | Staff overview |
| `08` to `11` `-mobile-*.jpg` | Phone width: sign-in, dashboard, booking, staff |
| `12-login-help.jpg` | Sign-in page with the rules and the Sign-in help panel |
| `13-login-space-warning.jpg` | Live warning when a password contains a space; Show password ticked |
| `14-mobile-login-help.jpg` | Sign-in page at phone width, with the portrait banner |
| `15-tablet-login.jpg` | Sign-in page at tablet width |
| `16-phone-header-dashboard.jpg` | Phone header: logo, picture and Sign out on one line; menu as equal buttons below |
| `17-phone-staff-filters.jpg` | Staff filters as a grid on a phone |
| `18-phone-320-header.jpg` | The header at the narrowest size, 320 px |
| `19-phone-sticky-confirm-bar.jpg` | Phone booking page with the summary and Confirm pinned to the bottom |
| `20-phone-conflict-in-bar.jpg` | Phone: the conflict message and four nearest times inside the pinned bar |

Signing in on the deployed site is done by a person; the deployed site is verified by the Python suites and the smoke test.
