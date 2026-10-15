// Real-browser UI regression of the manual test cases (docs/MANUAL_TEST_CASES.md), driven by Playwright.
//   node ui-run.mjs [base-url] [screenshot-dir]        default: http://localhost:5173 and ./shots
//   CHROME_PATH=<chrome.exe>  use an installed Chrome/Chromium instead of the one from "npx playwright install chromium"
// Two browser contexts act as two people (the booking race). Bookings made by the run are cancelled again at the end.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const OUT = process.argv[3] ?? './shots';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || undefined;

const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${!ok && detail ? '  [' + detail + ']' : ''}`);
};

// A Wednesday at least 10 days ahead, as YYYY-MM-DD (the booking page treats it as the dealership's local date).
function testDay() {
  const d = new Date(Date.now() + 10 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const nextSunday = (day) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4); return d.toISOString().slice(0, 10); };
const DAY = testDay();

/** Cancel every upcoming booking this run may have left on the test day, through the API. */
async function cleanup(api) {
  let cancelled = 0;
  for (const user of ['JoinWick', 'JamesBond']) {
    const login = await api.post(BASE + '/api/auth/login', { data: { username: user, password: user } });
    const token = (await login.json()).token;
    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await api.get(BASE + '/api/appointments', { headers })).json();
    for (const a of list.filter((x) => x.status === 'BOOKED' && x.startTime.slice(0, 10) === DAY)) {
      const r = await api.post(`${BASE}/api/appointments/${a.id}/cancel`, { headers });
      cancelled += r.ok() ? 1 : 0;
    }
  }
  return cancelled;
}

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), headless: true });
const newPage = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  return { ctx, page };
};
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });

async function signIn(page, user, pass = user) {
  await page.goto(BASE + '/login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const signOut = (page) => page.getByRole('button', { name: 'Sign out' }).click();
const times = (page) => page.getByRole('group', { name: 'Available start times' }).getByRole('button');
const timeBtn = (page, t) => page.getByRole('group', { name: 'Available start times' }).getByRole('button', { name: t, exact: true });

async function startBooking(page, { vehicle, service, dealership, date = DAY }) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
  await page.getByRole('button', { name: new RegExp(vehicle) }).click();
  await page.getByRole('button', { name: new RegExp(service) }).first().click();
  await page.getByRole('button', { name: new RegExp(dealership) }).click();
  await page.locator('#date').fill(date);
  await times(page).first().waitFor();
}

try {
  { const { ctx } = await newPage(); await cleanup(ctx.request); await ctx.close(); } // start from a clean test day
  /* ---------- Customer: sign in ---------- */
  {
    const { ctx, page } = await newPage();
    await page.goto(BASE + '/login');
    await shot(page, '01-login');
    await signIn(page, 'joinwick', 'JoinWick');
    await page.getByRole('alert').waitFor();
    check('C-M02', 'wrong-case username rejected', /Incorrect username or password/.test(await page.getByRole('alert').innerText()) && page.url().endsWith('/login'));
    await signIn(page, 'JoinWick', 'wrong');
    await page.getByRole('alert').waitFor();
    check('C-M03a', 'wrong password rejected', /Incorrect/.test(await page.getByRole('alert').innerText()));
    await signIn(page, 'JoinWick', 'Join Wick');
    await page.getByRole('alert').waitFor();
    check('C-M03b', 'password with a space rejected', /Incorrect/.test(await page.getByRole('alert').innerText()));
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    check('C-M01', 'John signs in and sees his dashboard', true);
    const tabs = await page.getByRole('tab').allInnerTexts();
    check('C-M01b', 'dashboard shows Upcoming / Completed / Cancelled tabs', tabs.length === 3, tabs.join(' | '));
    const own = await page.locator('article').allInnerTexts();
    check('C-M11a', 'John sees only his own cars', own.length > 0 && own.every((t) => /JW\d\d/.test(t)));
    await shot(page, '02-customer-dashboard');
    check('C-S03', 'session survives a reload', await (async () => { await page.reload(); await page.getByRole('heading', { name: 'John Wick' }).waitFor(); return true; })());
    await ctx.close();
  }

  /* ---------- Customer: book, then keep for later ---------- */
  const john = await newPage();
  await signIn(john.page, 'JoinWick');
  await john.page.getByRole('heading', { name: 'John Wick' }).waitFor();
  await startBooking(john.page, { vehicle: 'Mustang', service: 'Oil & Filter Change', dealership: 'Northern Quarter Garage' });
  const confirmBtn = john.page.getByRole('button', { name: 'Confirm booking' });
  check('C-S10', 'Confirm is disabled until a time is chosen', await confirmBtn.isDisabled());
  const allTimes = await times(john.page).allInnerTexts();
  check('C-S07', 'Manchester 60 minute service: first 08:30, last 16:30', allTimes[0] === '08:30' && allTimes.at(-1) === '16:30', allTimes.join(','));
  await shot(john.page, '03-booking-times', true);
  await timeBtn(john.page, '10:00').click();
  await confirmBtn.click();
  await john.page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
  const conf = await john.page.locator('main').innerText();
  check('C-M04', 'booking confirmed with reference, bay and technician', /ASA-[0-9A-F]{8}/.test(conf) && /Bay 1/.test(conf) && /Declan Murphy|Megan Doyle|Lewis Fletcher|Sophie Hargreaves/.test(conf), conf.replace(/\n+/g, ' | ').slice(0, 200));
  await shot(john.page, '04-booking-confirmed');
  await john.page.getByRole('link', { name: 'View my bookings' }).click();
  await john.page.getByRole('heading', { name: 'John Wick' }).waitFor();
  await john.page.locator('article').filter({ hasText: /10:00 to 11:00/ }).first().waitFor();
  check('C-M05', 'new booking is on the dashboard under Upcoming', (await john.page.locator('article').allInnerTexts()).some((t) => /10:00 to 11:00/.test(t) && /Northern Quarter Garage/.test(t)));

  /* ---------- Two people race for one slot ---------- */
  const james = await newPage();
  await signIn(james.page, 'JamesBond');
  await james.page.getByRole('heading', { name: 'James Bond' }).waitFor();
  const jv = (await james.page.locator('article').allInnerTexts());
  check('C-M11b', 'James sees only his own cars', jv.length > 0 && jv.every((t) => /JB\d\d/.test(t)));
  await startBooking(james.page, { vehicle: 'Toyota 2000GT', service: 'Oil & Filter Change', dealership: 'Northern Quarter Garage' });
  check('C-M06', "John's 10:00 is greyed out for James, and 09:30 (would overlap) too", await timeBtn(james.page, '10:00').isDisabled() && await timeBtn(james.page, '09:30').isDisabled());
  check('C-S12', 'back-to-back times (09:00 and 11:00) stay available', !(await timeBtn(james.page, '09:00').isDisabled()) && !(await timeBtn(james.page, '11:00').isDisabled()));
  // James stops on 12:00 without confirming. John takes 12:00 first in his own window.
  await timeBtn(james.page, '12:00').click();
  await john.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
  await john.page.getByRole('button', { name: /Chevelle/ }).click();
  await john.page.getByRole('button', { name: /Oil & Filter Change/ }).first().click();
  await john.page.getByRole('button', { name: /Northern Quarter Garage/ }).click();
  await john.page.locator('#date').fill(DAY);
  await timeBtn(john.page, '12:00').click();
  await john.page.getByRole('button', { name: 'Confirm booking' }).click();
  await john.page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
  check('C-M07a', 'John (window A) wins the 12:00 slot', true);
  await james.page.getByRole('button', { name: 'Confirm booking' }).click();
  const conflict = james.page.getByRole('alert');
  await conflict.waitFor();
  const ctext = await conflict.innerText();
  check('C-M07b', 'James (window B) is told the slot is gone and is offered nearest times', /No Northern Quarter Garage bay and qualified technician/.test(ctext) && /Nearest free times/.test(ctext));
  check('C-M07c', 'James is not booked and stays on the booking page', new URL(james.page.url()).pathname === '/book' && !(await james.page.getByRole('heading', { name: 'Booking confirmed' }).count()));
  await shot(james.page, '05-conflict-with-alternatives');
  const alts = await conflict.getByRole('button').allInnerTexts();
  check('C-M08a', 'four nearest alternatives are offered', alts.length === 4, alts.join(' / '));
  await conflict.getByRole('button').first().click();
  await james.page.getByRole('button', { name: 'Confirm booking' }).click();
  await james.page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
  check('C-M08b', 'James books one of the suggested times', true);
  await james.page.getByRole('link', { name: 'View my bookings' }).click();

  /* ---------- Cancel and release ---------- */
  await john.page.getByRole('link', { name: 'View my bookings' }).click();
  await john.page.getByRole('heading', { name: 'John Wick' }).waitFor();
  await john.page.waitForTimeout(1000); // let the list refetch after the second booking
  const before = await john.page.getByRole('tab').allInnerTexts();
  const card = john.page.locator('article').filter({ hasText: '10:00 to 11:00' }).filter({ hasText: 'Northern Quarter' }).first();
  await card.getByRole('button', { name: 'Cancel booking' }).click();
  check('C-M09a', 'cancel asks for confirmation first', await card.getByText(/release the bay and technician/).isVisible());
  await card.getByRole('button', { name: 'Yes, cancel' }).click();
  await john.page.getByRole('tab', { name: /Cancelled/ }).waitFor();
  await john.page.waitForTimeout(600);
  const after = await john.page.getByRole('tab').allInnerTexts();
  const num = (arr, label) => Number((arr.find((t) => t.startsWith(label)) ?? '').replace(/\D/g, ''));
  check('C-M09b', 'Upcoming goes down by one and Cancelled up by one', num(after, 'Upcoming') === num(before, 'Upcoming') - 1 && num(after, 'Cancelled') === num(before, 'Cancelled') + 1, `${before.join(',')} -> ${after.join(',')}`);
  await john.page.getByRole('tab', { name: /Cancelled/ }).click();
  check('C-M09c', 'the booking shows under Cancelled with no cancel button', await john.page.locator('article').filter({ hasText: '10:00 to 11:00' }).filter({ hasText: 'Cancelled' }).count() > 0);
  await james.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
  await james.page.getByRole('button', { name: /Aston Martin DBS/ }).click();
  await james.page.getByRole('button', { name: /Oil & Filter Change/ }).first().click();
  await james.page.getByRole('button', { name: /Northern Quarter Garage/ }).click();
  await james.page.locator('#date').fill(DAY);
  await times(james.page).first().waitFor();
  check('C-M10a', 'the cancelled 10:00 slot is selectable again', !(await timeBtn(james.page, '10:00').isDisabled()));
  await timeBtn(james.page, '10:00').click();
  await james.page.getByRole('button', { name: 'Confirm booking' }).click();
  await james.page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
  check('C-M10b', 'James can book the released slot', true);

  /* ---------- Should-have booking rules (James) ---------- */
  await james.page.getByRole('button', { name: 'Book another' }).click();
  await james.page.getByRole('button', { name: /Toyota 2000GT/ }).click();
  await james.page.getByRole('button', { name: /^Brakes/ }).click();
  const brakeServices = await james.page.locator('button[aria-pressed]').filter({ hasText: /\d+ min|\d h/ }).allInnerTexts();
  check('C-S08a', 'Brakes filter narrows the list to the 3 brake services', brakeServices.length === 3, JSON.stringify(brakeServices.map((s) => s.split('\n')[0])));
  await james.page.getByRole('button', { name: 'All', exact: true }).click();
  check('C-S08b', 'All shows the 24 services again', (await james.page.locator('button[aria-pressed]').filter({ hasText: /\d+ min|\d h/ }).count()) === 24);
  const dateInput = james.page.locator('#date');
  check('C-S05', 'date picker runs from today to 60 days ahead', (await dateInput.getAttribute('min')) <= new Date().toISOString().slice(0, 10) && Math.round((Date.parse(await dateInput.getAttribute('max')) - Date.parse(await dateInput.getAttribute('min'))) / 86_400_000) === 60);
  await james.page.getByRole('button', { name: /Full Service/ }).click();
  await james.page.getByRole('button', { name: /Kensington Motor Works/ }).click();
  await james.page.locator('#date').fill(DAY);
  await times(james.page).first().waitFor();
  const fs4 = await times(james.page).allInnerTexts();
  check('C-S06', 'Full Service (4 h) at Kensington: first 08:00, last 14:00', fs4[0] === '08:00' && fs4.at(-1) === '14:00', `${fs4[0]}..${fs4.at(-1)}`);
  await timeBtn(james.page, '14:00').click();
  await james.page.locator('#date').fill(nextSunday(DAY));
  await james.page.getByText(/is closed on this day/).waitFor();
  check('C-S04', 'Sunday shows a closed message and no times', (await times(james.page).count()) === 0);
  await james.page.locator('#date').fill(DAY);
  await times(james.page).first().waitFor();
  await james.page.getByRole('button', { name: /Aston Martin DBS/ }).click();
  await james.page.getByRole('button', { name: /Oil & Filter Change/ }).first().click();
  await james.page.locator('#date').fill(DAY);
  await times(james.page).first().waitFor();
  check('C-S09', 'changing vehicle or service clears the chosen time', await james.page.getByRole('button', { name: 'Confirm booking' }).isDisabled());
  const busy = await Promise.all(['09:00', '09:30', '10:00', '10:30', '11:00'].map((t) => timeBtn(james.page, t).isDisabled()));
  check('C-S11', 'DBS booked in Manchester 10:00-11:00 is greyed at Kensington 09:30-10:30 only', JSON.stringify(busy) === '[false,true,true,true,false]', JSON.stringify(busy));
  await shot(james.page, '06-booking-page-vehicle-busy', true);

  /* ---------- Staff ---------- */
  const staff = await newPage();
  await signIn(staff.page, 'Winston');
  await staff.page.getByRole('heading', { name: 'All bookings' }).waitFor();
  check('S-M01', 'staff sees All bookings with summary and dealership tiles', (await staff.page.locator('section[aria-label="Summary"] > div').count()) === 4 && (await staff.page.locator('section[aria-label="Dealerships"] button').count()) === 3);
  const who = new Set((await staff.page.locator('article').allInnerTexts()).map((t) => (t.match(/CUSTOMER\n(.+)/) ?? [])[1]));
  check('S-M01b', 'staff sees both customers', who.has('John Wick') && who.has('James Bond'));
  check('S-M02a', 'staff has no Book a service menu item', (await staff.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).count()) === 0);
  await staff.page.goto(BASE + '/book');
  await staff.page.getByRole('heading', { name: 'All bookings' }).waitFor();
  check('S-M02b', 'staff opening /book is sent back to All bookings', new URL(staff.page.url()).pathname === '/');
  await shot(staff.page, '07-staff-all-bookings');
  const total = await staff.page.locator('article').count();
  await staff.page.locator('section[aria-label="Dealerships"] button').first().click();
  await staff.page.waitForTimeout(700);
  const filtered = await staff.page.locator('article').allInnerTexts();
  check('S-S01', 'dealership tile filters the list and Clear restores it', filtered.length > 0 && filtered.length < total && filtered.every((t) => /Brum Auto Centre/.test(t)));
  await staff.page.locator('section[aria-label="Dealerships"] button').first().click();
  await staff.page.waitForTimeout(700);
  await staff.page.getByLabel('Status').selectOption('CANCELLED');
  await staff.page.waitForTimeout(700);
  const canc = await staff.page.locator('article').allInnerTexts();
  check('S-S02', 'status filter Cancelled shows only cancelled bookings', canc.length > 0 && canc.every((t) => /Cancelled/.test(t)));
  check('S-S05', 'cancelled bookings have no Cancel button', canc.every((t) => !/Cancel booking/.test(t)));
  await staff.page.getByLabel('Status').selectOption('');
  await staff.page.getByLabel('From', { exact: true }).fill('2000-01-01');
  await staff.page.getByLabel('To', { exact: true }).fill('2000-01-31');
  await staff.page.getByText('No bookings match').waitFor();
  check('S-S04a', 'a range without bookings shows "No bookings match"', true);
  await staff.page.getByRole('button', { name: 'Clear filters' }).click();
  await staff.page.waitForTimeout(700);
  check('S-S04b', 'Clear filters restores the full list', (await staff.page.locator('article').count()) === total);
  const jamesCard = staff.page.locator('article').filter({ hasText: 'James Bond' }).filter({ hasText: 'Upcoming' }).first();
  const jamesRef = (await jamesCard.innerText()).match(/ASA-[0-9A-F]{8}/)[0];
  await jamesCard.getByRole('button', { name: 'Cancel booking' }).click();
  await jamesCard.getByRole('button', { name: 'Yes, cancel' }).click();
  await staff.page.waitForTimeout(1000);
  await james.page.getByRole('link', { name: 'My bookings' }).click();
  await james.page.getByRole('tab', { name: /Cancelled/ }).click();
  check('S-M03', "a booking cancelled by staff shows as Cancelled for its customer", (await james.page.locator('article').allInnerTexts()).some((t) => t.includes(jamesRef) && /Cancelled/.test(t)), jamesRef);

  /* ---------- Sign out, direct links, errors ---------- */
  await signOut(james.page);
  await james.page.getByLabel('Username').waitFor();
  await james.page.goBack();
  check('C-S02', 'after sign out, Back does not reveal bookings', new URL(james.page.url()).pathname === '/login' || (await james.page.locator('article').count()) === 0);
  await james.page.goto(BASE + '/book');
  await james.page.waitForURL('**/login');
  check('C-S01', 'signed out, /book goes to the login page', new URL(james.page.url()).pathname === '/login');
  await james.page.goto(BASE + '/nothing-here');
  await james.page.waitForURL('**/login');
  check('N-04', 'unknown address lands on login when signed out', new URL(james.page.url()).pathname === '/login');
  const apiNo = await james.page.request.get(BASE + '/api/appointments');
  const apiBody = await apiNo.json();
  check('N-05', 'API without a token returns 401 UNAUTHENTICATED', apiNo.status() === 401 && apiBody.error.code === 'UNAUTHENTICATED');
  const health = await (await james.page.request.get(BASE + '/api/health')).json();
  check('N-06', 'health endpoint is public', health.status === 'ok');
  await james.page.evaluate(() => localStorage.setItem('asa.token', 'invalid.token.value'));
  await james.page.goto(BASE + '/');
  await james.page.getByLabel('Username').waitFor();
  check('N-12', 'an invalid or expired token returns to login without an error screen', (await james.page.evaluate(() => localStorage.getItem('asa.token'))) === null);

  /* ---------- Deep link, keyboard, images ---------- */
  const kb = await newPage();
  await kb.page.goto(BASE + '/login');
  await kb.page.keyboard.press('Tab');
  await kb.page.keyboard.type('JoinWick');
  await kb.page.keyboard.press('Tab');
  await kb.page.keyboard.type('JoinWick');
  await kb.page.keyboard.press('Tab');
  await kb.page.keyboard.press('Enter');
  await kb.page.getByRole('heading', { name: 'John Wick' }).waitFor();
  check('N-02', 'sign in with the keyboard only (Tab, type, Enter)', true);
  await kb.page.goto(BASE + '/book');
  await kb.page.getByRole('heading', { name: 'Book a service' }).waitFor();
  check('N-03', 'reloading /book while signed in stays on the booking page', true);
  await kb.page.locator('img').first().waitFor();
  await kb.page.waitForTimeout(1500);
  const broken = await kb.page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  const imgCount = await kb.page.evaluate(() => document.images.length);
  check('N-09', `all ${imgCount} images on the booking page load (no broken images)`, broken.length === 0 && imgCount > 10, broken.join(','));
  await kb.ctx.close();

  /* ---------- Phone layout ---------- */
  const phone = await newPage({ width: 390, height: 844 });
  await phone.page.goto(BASE + '/login');
  await shot(phone.page, '08-mobile-login');
  const overflowReport = [];
  const overflow = async (label = '') => { const r = await phone.page.evaluate(() => { const w = window.innerWidth; const bad = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 60) + ' right=' + Math.round(e.getBoundingClientRect().right)); return { scrollWidth: document.documentElement.scrollWidth, w, bad }; }); if (r.scrollWidth > r.w + 1) overflowReport.push(label + ' ' + JSON.stringify(r)); return r.scrollWidth > r.w + 1; };
  let noOverflow = !(await overflow('login'));
  await signIn(phone.page, 'JoinWick');
  await phone.page.getByRole('heading', { name: 'John Wick' }).waitFor();
  await phone.page.waitForTimeout(800);
  noOverflow = noOverflow && !(await overflow('dashboard'));
  await shot(phone.page, '09-mobile-dashboard');
  await phone.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
  await phone.page.getByRole('heading', { name: 'Book a service' }).waitFor();
  await phone.page.waitForTimeout(800);
  noOverflow = noOverflow && !(await overflow('booking'));
  await shot(phone.page, '10-mobile-booking');
  await signOut(phone.page);
  await signIn(phone.page, 'Winston');
  await phone.page.getByRole('heading', { name: 'All bookings' }).waitFor();
  await phone.page.waitForTimeout(800);
  noOverflow = noOverflow && !(await overflow('staff'));
  await shot(phone.page, '11-mobile-staff');
  check('N-01', 'phone width (390 px): no sideways scrolling on login, dashboard, booking and staff pages', noOverflow, overflowReport.join(' ; '));
} catch (err) {
  console.log('FAIL  RUN  script stopped:', err.message.split('\n')[0]);
  results.push({ id: 'RUN', name: 'script completed', ok: false, detail: err.message.split('\n')[0] });
} finally {
  try { const { ctx } = await newPage(); const n = await cleanup(ctx.request); console.log(`\nCleaned up ${n} test booking(s).`); await ctx.close(); } catch {}
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} UI checks passed (day under test: ${DAY})`);
  process.exit(failed ? 1 : 0);
}
