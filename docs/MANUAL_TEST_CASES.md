# Manual Test Cases

For a quick manual check of the live site by a person. Cases are ordered by priority, so you can stop after any section:

| Priority | Meaning | Count | Rough time |
|---|---|---|---|
| **Must have** | The product is not usable or not safe if one fails | 15 | 20 to 25 minutes |
| **Should have** | Important rules and everyday behaviour | 28 | 35 minutes |
| **Nice to have** | Polish, accessibility and edge behaviour | 17 | 25 minutes |

Mark each result in the **Result** column: `P` pass, `F` fail, `-` skipped. Write failures down with the case ID and what you saw.

## Before you start

- **Site:** https://asa-challenge.fibosolutions.com (or `http://localhost:5173` when run locally; Vite prints the port). The production data was reset after the last deploy, so the starting state is the seeded one.
- **Accounts** (case sensitive, password equals the username): `JoinWick` (customer), `JamesBond` (customer), `Winston` (staff).
- **Use two browser windows when a case says so**: a normal window and a private/incognito window, so two people can be signed in at once.
- **Pick a test day:** choose a weekday (Monday to Saturday) one to three weeks ahead. Use the same day in every case so bookings collide on purpose. Called **DAY** below.
- **Clean-up:** cancel the bookings you create. Seeded bookings can stay.

### Reference data

| Dealership | Hours (Mon to Sat) | Bays | Notes |
|---|---|---|---|
| Kensington Motor Works (London) | 08:00 to 18:00 | 2 | 5 technicians |
| Brum Auto Centre (Birmingham) | 08:00 to 17:30 | 2 | Only one tyre specialist |
| Northern Quarter Garage (Manchester) | 08:30 to 17:30 | **1** | Best place to force a conflict |

| Customer | Vehicles |
|---|---|
| JoinWick | 2011 Dodge Charger, 1970 Chevrolet Chevelle SS, 1969 Ford Mustang Mach 1 |
| JamesBond | 1967 Toyota 2000GT, 1964 Aston Martin DB5, 2006 Aston Martin DBS, 1977 Lotus Esprit S1 |

Services used below: **Oil & Filter Change** (60 min, Oil & Fluids), **Fluid Top-up & Check** (30 min), **Front Brake Pads** (120 min), **Full Service** (240 min).

---

## 1. Must have

### Customer

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| C-M01 | Sign in as a customer (happy) | Open the site. Sign in as `JoinWick` / `JoinWick`. | Dashboard shows "John Wick", tabs **Upcoming / Completed / Cancelled** with counts, and John's own bookings with car pictures. | |
| C-M02 | Username is case sensitive (negative) | Sign in as `joinwick` / `JoinWick`. | Red message "Incorrect username or password." You stay on the login page. | |
| C-M03 | Wrong password (negative) | Sign in as `JoinWick` / `wrong`. | Rejected with "Incorrect username or password". No dashboard. |
| C-M03b | Password with a space (negative) | Sign in as `JoinWick` with the password `Join Wick` (with a space). | The form stops you with "Password cannot contain spaces"; nothing is sent and you stay on the login page. The hint under the box says "Up to 32 characters, no spaces". | |
| C-M04 | Book a service (happy) | As `JoinWick`: **Book a service**. Choose the Mustang, **Oil & Filter Change**, **Kensington**, date DAY, a free time (for example 10:00), **Confirm booking**. | "Booking confirmed" with a reference (ASA-xxxxxxxx), the service, vehicle, date and time, bay and technician (with photo). | |
| C-M05 | New booking shows on the dashboard | Click **View my bookings** after C-M04. | The booking is under **Upcoming** with the same time, bay and technician. | |
| C-M06 | Taken time is blocked (negative) | As `JamesBond`: book **Oil & Filter Change**, **Northern Quarter Garage**, DAY, 10:00 and confirm. Then as `JoinWick`: same service, same dealership, DAY. | For John, 10:00 is greyed out and cannot be selected. Neighbouring times that would overlap (09:30) are greyed too. | |
| C-M07 | Two people book the same last slot (race, negative) | Window A: `JoinWick`, window B (private): `JamesBond`. Both choose **Oil & Filter Change**, **Northern Quarter Garage**, DAY, **12:00**, and stop before confirming. Click **Confirm booking** in A, then in B. | A: confirmed. B: red message that no bay and technician are free, with **Nearest free times** buttons. B is not booked. | |
| C-M08 | Use a suggested time | Continue C-M07 in B: click one of the nearest times. | Date and time are filled in. **Confirm booking** now succeeds. | |
| C-M09 | Cancel a booking (happy) | As `JoinWick`, open **Upcoming**, click **Cancel booking** on the C-M04 booking, then **Yes, cancel**. | Booking disappears from Upcoming and appears under **Cancelled**; counts update. | |
| C-M10 | Cancelling frees the slot | After C-M09, book the same dealership, DAY and time with `JamesBond` (any car). | The time is selectable again and the booking succeeds. | |
| C-M11 | Customers cannot see each other's bookings | Sign in as `JamesBond`. Compare with `JoinWick`'s list. | Each sees only their own cars and bookings. | |

### Staff and security

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| S-M01 | Staff sign in (happy) | Sign in as `Winston` / `Winston`. | **All bookings** page with Total / Upcoming / Completed / Cancelled tiles, three dealership tiles and bookings from both customers. | |
| S-M02 | Staff cannot book | As `Winston`, look at the menu, then type `/book` after the site address. | No "Book a service" menu item. `/book` returns you to All bookings. | |
| S-M03 | Staff can cancel a customer booking | As `Winston`, **Cancel booking** on an upcoming booking, confirm. Then sign in as the owner. | The booking shows as Cancelled for the customer. | |

---

## 2. Should have

### Customer

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| C-S01 | Pages need a sign-in (negative) | Signed out, open `/book` and `/` directly. | Both show the login page. | |
| C-S02 | Sign out | Click **Sign out**, then the browser Back button. | Login page; Back does not reveal any bookings. | |
| C-S03 | Session survives a reload | Signed in, press reload (F5). | Still signed in on the same page. | |
| C-S04 | Closed on Sunday | In the booking page choose any service and dealership, set the date to a Sunday. | Message that the dealership is closed; no times listed. | |
| C-S05 | Date limits | Open the date picker. Try a past date and a date more than 60 days ahead. | Past dates cannot be picked. Anything beyond about 60 days is not allowed (picker limit, or no free times). | |
| C-S06 | First and last times of the day | Choose **Full Service** (240 min) at Kensington on DAY. | First time 08:00; **last start is 14:00** (it must end by 18:00). No later times. | |
| C-S07 | Half-hour opening | Choose **Fluid Top-up & Check** (30 min) at Northern Quarter Garage. | First time 08:30; last 17:00. | |
| C-S08 | Service category filter | On step 2 click **Brakes**, then **All**. | List narrows to brake services, then back to all 24. | |
| C-S09 | Changing a choice clears the time | Pick a time, then change the vehicle, service, dealership or date. | The chosen time is cleared and the summary shows "Not chosen yet" for When. | |
| C-S10 | Confirm is disabled until complete | Open the booking page; select only some steps. | **Confirm booking** is disabled until vehicle, service, dealership and time are all chosen. | |
| C-S11 | One vehicle cannot be in two places (negative) | Book the Mustang at Kensington DAY 10:00 (60 min). Start a second booking for the Mustang at Birmingham DAY the same time. | When the Mustang is selected, 10:00 is greyed out. | |
| C-S12 | Overlap with a longer job | Book Front Brake Pads (120 min) at Northern Quarter DAY 09:00 (09:00 to 11:00). Then try Oil & Filter Change at 10:00 and at 11:00. | 10:00 is unavailable; **11:00 is available** (back to back is allowed). | |
| C-S13 | Capacity difference | Book one service at Kensington DAY 14:00 with John, then book the same service and time with James. Repeat at Northern Quarter. | Kensington (2 bays) accepts both bookings. Northern Quarter (1 bay) refuses the second. | |
| C-S14 | Qualified technician limit | Choose **Wheel Alignment** at Brum Auto Centre. Book it at DAY 10:00 with John, then try **Tyre Rotation & Balancing** at 10:00 with James. | The second is refused: Brum has only one tyre specialist, even though a bay is free. | |
| C-S15 | Completed tab | Open the **Completed** tab. | Past bookings are listed with a "Completed" badge and no Cancel button. | |
| C-S16 | Book another | After a confirmation, click **Book another**. | The vehicle stays selected (people often book a second job for the same car); service, dealership, date and time are cleared and the steps below the vehicle start again from step 2. | |
| C-S21 | Confirm bar on a phone | On a phone (or a window under 1024 px wide) open the booking page and scroll through the steps. Choose a vehicle, a service, a dealership, a date and a time. | A bar stays at the bottom of the screen the whole time: it first says which step is next, then shows the service, dealership and time with a full-width **Confirm booking** button. You never have to scroll to the end to confirm. On a wide screen the summary is a card on the right instead. | |
| C-S20 | Return to the page you asked for | Signed out, type the address of the booking page (`/book`) in the browser. Sign in as a customer. | After signing in you land on the booking page. After pressing **Sign out** yourself and signing in again you land on My bookings. | |
| C-S19 | Sign-in help and live feedback | On the login page read the **Sign-in help** panel. Type a few characters in each box. Type a space in the password box, then delete it. Tick **Show password**. | Each box shows a counter such as `5 / 32` and its rule underneath. A red message appears as soon as the password has a space and goes when you remove it. Show password reveals the text and un-ticking hides it. The panel says who signs in, the 8 hour session and that this is a demo; the username and password rules appear once, under their boxes (not repeated in the panel). | |
| C-S18 | Username and password limit (negative) | On the login page type 40 characters into Username, then into Password. Then type exactly 32 characters in each and sign in. | Each box stops at 32 characters. With 32 characters in each the page answers "Incorrect username or password" (not an error screen). | |
| C-S17 | Date suggestion skips closed days | On a Saturday, open the booking page and choose a vehicle, a service and a dealership without touching the date. | The date moves from Sunday to the next open day (Monday). If you pick a date yourself it is never changed for you. | |

### Staff

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| S-S01 | Dealership filter tile | Click a dealership tile (for example Brum Auto Centre). | Only that dealership's bookings show; tile is highlighted. Click again to clear. | |
| S-S02 | Status filter | Set **Status** to Cancelled, then Booked. | The list shows only that status. | |
| S-S03 | Date range filter | Set **From** and **To** around one booking. | Only bookings in that range. | |
| S-S04 | Clear filters and empty result | Choose a range with no bookings (for example in the past, before any data), then **Clear filters**. | "No bookings match" message, then the full list after clearing. | |
| S-S05 | Cancel only for upcoming | Look at Completed and Cancelled bookings. | No **Cancel booking** button on them. | |
| S-S07 | Search with unusual text | In **Search** type `.*[(`, then `<b>x</b>`, then 100 letters without spaces, then an emoji. | The page never breaks: it shows "No bookings match", nothing is rendered as bold or executed, the layout does not scroll sideways, and the box stops at 100 characters. | |
| S-S06 | Search | Type a booking reference, a number plate (for example `JB77 LTS`), a customer name, or two words such as `wick mustang` into **Search**. | Only matching bookings stay; a message says how many match; a search with no result shows "No bookings match"; **Clear filters** empties the search. | |

---

## 3. Nice to have

| ID | Role | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| N-01 | Both | Phone layout | Use a phone, or make the browser window narrow (about 400 px). Check login, dashboard, booking page, staff page. | No sideways scrolling; cards stack; buttons stay tappable; header wraps. | |
| N-02 | Both | Keyboard only | Sign in using only Tab, Space, Enter. | Every control can be reached and the focus ring is visible. | |
| N-03 | Customer | Deep link | Reload while on `/book`. | The booking page loads (signed in) without a "not found" page. | |
| N-04 | Both | Unknown address | Open `/nothing-here`. | You land on the dashboard (or login when signed out). | |
| N-05 | Customer | API is closed without a token | In a new tab open `/api/appointments`. | JSON error "Sign in to continue" (code UNAUTHENTICATED). No data. | |
| N-06 | Both | Public health check | Open `/api/health`. | `{"status":"ok", ...}`. | |
| N-07 | Both | HTTPS | On the live site check the address bar. Try `http://asa-challenge.fibosolutions.com`. | Padlock shown; http redirects to https. | |
| N-08 | Customer | Many bookings | Make 3 bookings on different days, then check ordering. | Upcoming is soonest first; Completed is most recent first. | |
| N-09 | Customer | Pictures | Look at login, vehicles, dealerships, technicians. | Bright, modern images load; no broken image icons. | |
| N-17 | Customer | Network down | On the booking page choose a time, turn the network off (aeroplane mode, or the browser's Offline option), press **Confirm booking**. Turn the network on and press it again. | A clear "You appear to be offline" message at once, no endless "Confirming...", nothing booked. After reconnecting the second press books it. | |
| N-16 | Both | Phone header | Open the site on a phone (or a 390 px window). Look at the top bar on every page. | Row one: logo and title on the left, your picture and Sign out on the right, on one line. Row two: the menu as equal-width buttons. Nothing overlaps or is cut off. | |
| N-15 | Both | Light interface | Look at the navigation bar and the dashboard welcome card on a customer account. | White navigation bar with dark text and a light turquoise-to-warm gradient welcome card with dark text; no dark blocks. | |
| N-14 | Both | Phone and desktop pictures | Open the login page on a phone (or a narrow window) and on a wide screen. | Phone: a portrait banner of a mechanic above the form. Wide screen: the large workshop photo on the left, no banner. | |
| N-10 | Customer | Long service end time | Book Full Service (240 min). | Confirmation shows start to end four hours later in local time. | |
| N-11 | Staff | Customer names and photos | Check the Customer column on All bookings. | Correct name and portrait for each booking. | |
| N-13 | Customer | Date box extremes | On the booking page type the year 9999, then the year 0001, in the date box. | A message that nothing is free, no error screen. | |
| N-12 | Both | Token expiry | Sign in, then delete the site's saved data in your browser (or wait 8 hours) and reload. | You are returned to the login page, no error screen. | |

---

## Where automated tests cover the same ground

| Manual case | Automated cover |
|---|---|
| C-M06, C-M07, C-S11 to C-S14 | `backend/test/booking.integration.test.ts`, `scripts/race_booking.py` |
| C-M09, C-M10, S-M03 | integration cancel tests, `scripts/api_tests.py` |
| C-M02, C-M03, C-S01, N-05 | `backend/test/api.integration.test.ts`, `scripts/api_tests.py` |
| C-S04 to C-S07 | `backend/test/boundary.integration.test.ts`, `scripts/boundary_tests.py` |
| S-S01 to S-S03 | listing and filter tests |

Alice ran the cases through Claude in Chrome using these same ids (C-M01, S-M03, N-04 and so on); the cases that need a person are mainly the visual and device ones (N-07 padlock and redirect, N-08 ordering with several bookings, N-10, N-11). See [TESTING.md](TESTING.md) for the automated suites.
