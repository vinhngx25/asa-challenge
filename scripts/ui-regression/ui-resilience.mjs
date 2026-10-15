// Resilience checks in a real browser (local app, signs in with the demo accounts):
//   A  time zones and locales   the browser in Singapore, New York, Auckland, London and Ho Chi Minh City
//   B  network failures         server errors, aborted calls, offline, slow double clicks, slow 3G
//   C  session and navigation   expired token, deep links, sign-out in another tab, role switch, back and forward
//   D  random clicking          a seeded "monkey" that clicks, types hostile text and resizes, watching for crashes
//   node ui-resilience.mjs [base-url]      (works best against a production build: npm run build && npm run preview -w frontend)
import { BASE, checker, cleanup, launch, newPage, signIn, testDay, timesGroup } from './lib.mjs';

const { check, finish } = checker('resilience');
const DAY = testDay();

function londonToUtcIso(dateStr, hh) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, 0);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const off = (ms) => { const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value])); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000; };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t).toISOString();
}

async function pickBooking(page, { vehicle = /Mustang/, service = /MOT Test/, dealership = /Kensington Motor Works/, date = DAY } = {}) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
  await page.getByRole('button', { name: vehicle }).click();
  await page.getByRole('button', { name: service }).first().click();
  await page.getByRole('button', { name: dealership }).click();
  await page.locator('#date').fill(date);
  await timesGroup(page).first().waitFor();
}
const timeBtn = (page, t) => page.getByRole('group', { name: 'Available start times' }).getByRole('button', { name: t, exact: true });
const johnToken = async (request) => (await (await request.post(BASE + '/api/auth/login', { data: { username: 'JoinWick', password: 'JoinWick' } })).json()).token;
const myBooked = async (request, token) => (await (await request.get(BASE + '/api/appointments', { headers: { Authorization: `Bearer ${token}` } })).json()).filter((a) => a.status === 'BOOKED');

const browser = await launch();
try {
  const adm = await newPage(browser);
  await cleanup(adm.ctx.request, DAY);

  /* ============ A. Time zones and locales ============ */
  const zones = [['Asia/Singapore', 'en-SG'], ['America/New_York', 'en-US'], ['Pacific/Auckland', 'en-NZ'], ['Europe/London', 'en-GB'], ['Asia/Ho_Chi_Minh', 'vi-VN']];
  for (const [timezoneId, locale] of zones) {
    const { ctx, page } = await newPage(browser, { timezoneId, locale });
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await pickBooking(page);
    const first = (await timesGroup(page).first().innerText()).trim();
    check('A1', `${timezoneId} / ${locale}: Kensington's first start is 08:00 (dealership time, not the browser's)`, first === '08:00', first);
    // The clocks change on the last Sunday of October: Saturday and Monday must both open at 08:00 local.
    const satMon = [];
    for (const day of ['2026-10-24', '2026-10-26']) { await page.locator('#date').fill(day); await timesGroup(page).first().waitFor(); satMon.push((await timesGroup(page).first().innerText()).trim()); }
    check('A2', `${timezoneId}: opening time reads 08:00 on both sides of the clock change (24 and 26 Oct 2026)`, satMon.join() === '08:00,08:00', satMon.join());
    await page.locator('#date').fill(DAY);
    await timesGroup(page).first().waitFor();
    await timeBtn(page, '10:00').click();
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
    const text = await page.locator('main').innerText();
    check('A3', `${timezoneId}: the confirmation reads "10:00 to 11:00" and a UK-style date`, /10:00 to 11:00/.test(text) && /\b(Mon|Tue|Wed|Thu|Fri|Sat),\s+\d{1,2} \w{3} 20\d\d/.test(text), text.replace(/\n+/g, ' | ').slice(0, 160));
    const token = await johnToken(ctx.request);
    const stored = (await myBooked(ctx.request, token)).find((a) => a.startTime.slice(0, 10) === DAY || a.startTime.slice(0, 10) === DAY);
    check('A4', `${timezoneId}: the stored start is 10:00 London time as UTC (${londonToUtcIso(DAY, 10)})`, stored?.startTime === londonToUtcIso(DAY, 10), stored?.startTime);
    await cleanup(ctx.request, DAY);
    await ctx.close();
  }

  /* ============ B. Network failures ============ */
  {
    const { ctx, page } = await newPage(browser);
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    const token = await johnToken(ctx.request);
    const before = (await myBooked(ctx.request, token)).length;
    await pickBooking(page);

    // B1 availability call fails
    await page.route('**/api/availability*', (r) => r.abort('failed'));
    await page.locator('#date').fill(testDay(17));
    await page.getByText('Could not check availability').waitFor({ timeout: 15_000 });
    check('B1', 'availability call fails: a clear message, the page stays usable', await page.getByRole('heading', { name: 'Book a service' }).isVisible());
    await page.unroute('**/api/availability*');
    await page.locator('#date').fill(DAY);
    await timesGroup(page).first().waitFor();
    check('B2', 'the times come back once the network recovers', (await timesGroup(page).count()) > 3);

    // B3 booking call answers 500
    await timeBtn(page, '11:00').click();
    await page.route('**/api/appointments', (r) => r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"Something went wrong.","requestId":"test"}}' }) : r.continue());
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await page.getByRole('alert').waitFor();
    check('B3', 'a server error on booking shows "Something went wrong" and the Confirm button works again', /Something went wrong/.test(await page.getByRole('alert').innerText()) && (await page.getByRole('button', { name: 'Confirm booking' }).isEnabled()));
    await page.unroute('**/api/appointments');
    check('B4', 'nothing was booked by the failed attempt', (await myBooked(ctx.request, token)).length === before);

    // B5 slow booking call and a double click: one request only
    let posts = 0;
    await page.route('**/api/appointments', async (r) => { if (r.request().method() === 'POST') { posts++; await new Promise((res) => setTimeout(res, 1800)); } await r.continue(); });
    await page.getByRole('button', { name: 'Confirm booking' }).dblclick();
    await page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
    check('B5', 'a double click on a slow Confirm sends exactly one request and books once', posts === 1 && (await myBooked(ctx.request, token)).length === before + 1, `posts=${posts}`);
    await page.unroute('**/api/appointments');
    await cleanup(ctx.request, DAY);

    // B6 offline, then back online
    await page.getByRole('button', { name: 'Book another' }).click();
    await page.getByRole('button', { name: /Mustang/ }).click();
    await page.getByRole('button', { name: /MOT Test/ }).first().click();
    await page.getByRole('button', { name: /Kensington Motor Works/ }).click();
    await page.locator('#date').fill(DAY);
    await timesGroup(page).first().waitFor();
    await timeBtn(page, '12:00').click();
    await ctx.setOffline(true);
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await page.getByRole('alert').waitFor();
    check('B6', 'offline: a clear "You appear to be offline" message appears at once and the Confirm button works again', /offline|Cannot reach the server/.test(await page.getByRole('alert').innerText()) && (await page.getByRole('button', { name: 'Confirm booking' }).isEnabled()));
    await ctx.setOffline(false);
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await page.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
    check('B7', 'back online, the same Confirm click books it', true);
    await cleanup(ctx.request, DAY);

    // B8 dashboard list fails, then recovers
    await page.getByRole('link', { name: 'View my bookings' }).click();
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await page.route('**/api/appointments', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"Something went wrong.","requestId":"test"}}' }));
    await page.reload();
    await page.getByText('Could not load your bookings').waitFor({ timeout: 15_000 });
    check('B8', 'when the bookings list fails to load the page says so instead of staying blank', true);
    await page.unroute('**/api/appointments');
    await page.reload();
    await page.locator('article').first().waitFor();
    check('B9', 'and the list returns after a reload', true);
    await ctx.close();
  }
  {
    // B10 login while the API is unreachable
    const { page, ctx } = await newPage(browser);
    await page.route('**/api/auth/login', (r) => r.abort('failed'));
    await page.goto(BASE + '/login');
    await page.getByLabel('Username', { exact: true }).fill('JoinWick');
    await page.getByLabel('Password', { exact: true }).fill('JoinWick');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    check('B10', 'sign-in with the server unreachable shows "Cannot reach the server" and keeps the form', /Cannot reach the server/.test(await page.getByRole('alert').innerText()) && (await page.getByLabel('Username', { exact: true }).inputValue()) === 'JoinWick');
    await page.unroute('**/api/auth/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    check('B11', 'the same form signs in once the server is reachable', true);
    await ctx.close();
  }
  {
    // B12 slow connection (Fast 3G profile)
    const { page, ctx } = await newPage(browser);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    const t0 = Date.now();
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor({ timeout: 60_000 });
    await page.locator('article').first().waitFor({ timeout: 60_000 });
    const ms = Date.now() - t0;
    console.log(`INFO  signed in and saw the dashboard in ${ms} ms on a Fast 3G profile`);
    check('B12', 'on a Fast 3G connection the dashboard shows within 20 seconds of opening the sign-in page', ms < 20_000, `${ms} ms`);
    await ctx.close();
  }

  /* ============ C. Session and navigation ============ */
  {
    const { ctx, page } = await newPage(browser);
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await pickBooking(page);
    await timeBtn(page, '10:00').click();
    await page.evaluate(() => localStorage.setItem('asa.token', 'expired.or.invalid'));
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await page.waitForURL('**/login');
    check('C1', 'a session that expires mid-booking sends the person to the sign-in page (nothing is booked)', (await myBooked(ctx.request, await johnToken(ctx.request))).filter((a) => a.startTime.slice(0, 10) === DAY).length === 0);
    await page.getByLabel('Username', { exact: true }).fill('JoinWick');
    await page.getByLabel('Password', { exact: true }).fill('JoinWick');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Book a service' }).waitFor();
    check('C2', 'after signing in again they return to the booking page they were on', new URL(page.url()).pathname === '/book');

    // sign out on purpose, sign in again: back to the home page, not the old page
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
    await page.getByLabel('Username', { exact: true }).fill('JoinWick');
    await page.getByLabel('Password', { exact: true }).fill('JoinWick');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    check('C3', 'after a deliberate sign-out and sign-in the person lands on the home page', new URL(page.url()).pathname === '/');
    await ctx.close();
  }
  {
    // deep link while signed out
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE + '/book');
    await page.waitForURL('**/login');
    await page.getByLabel('Username', { exact: true }).fill('JoinWick');
    await page.getByLabel('Password', { exact: true }).fill('JoinWick');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Book a service' }).waitFor();
    check('C4', 'opening /book while signed out, then signing in, lands on /book', new URL(page.url()).pathname === '/book');
    await ctx.close();
    const s = await newPage(browser);
    await s.page.goto(BASE + '/book');
    await s.page.waitForURL('**/login');
    await s.page.getByLabel('Username', { exact: true }).fill('Winston');
    await s.page.getByLabel('Password', { exact: true }).fill('Winston');
    await s.page.getByRole('button', { name: 'Sign in' }).click();
    await s.page.getByRole('heading', { name: 'All bookings' }).waitFor();
    check('C5', 'staff who open /book are sent on to All bookings after sign-in', new URL(s.page.url()).pathname === '/');
    await s.ctx.close();
    // an address from outside is never followed
    const o = await newPage(browser);
    await o.page.goto(BASE + '/login');
    await o.page.evaluate(() => history.replaceState({ usr: { from: '//evil.example.com/x' } }, '', '/login'));
    await o.page.getByLabel('Username', { exact: true }).fill('JoinWick');
    await o.page.getByLabel('Password', { exact: true }).fill('JoinWick');
    await o.page.getByRole('button', { name: 'Sign in' }).click();
    await o.page.getByRole('heading', { name: 'John Wick' }).waitFor();
    check('C6', 'a redirect target pointing to another site is ignored', new URL(o.page.url()).origin === new URL(BASE).origin);
    await o.ctx.close();
  }
  {
    // two tabs, role switch, back and forward
    const { ctx, page: a } = await newPage(browser);
    await signIn(a, 'JoinWick');
    await a.getByRole('heading', { name: 'John Wick' }).waitFor();
    const b = await ctx.newPage();
    await b.goto(BASE + '/');
    await b.getByRole('heading', { name: 'John Wick' }).waitFor();
    await a.getByRole('button', { name: 'Sign out' }).click();
    await a.waitForURL('**/login');
    await b.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
    await b.waitForURL('**/login');
    check('C7', 'signing out in one tab: the other tab is sent to sign-in on its next action', true);
    await ctx.close();

    const r = await newPage(browser);
    await signIn(r.page, 'JoinWick');
    await r.page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await r.page.getByRole('button', { name: 'Sign out' }).click();
    await r.page.waitForURL('**/login');
    await r.page.getByLabel('Username', { exact: true }).fill('Winston');
    await r.page.getByLabel('Password', { exact: true }).fill('Winston');
    await r.page.getByRole('button', { name: 'Sign in' }).click();
    await r.page.getByRole('heading', { name: 'All bookings' }).waitFor();
    const staffText = await r.page.locator('main').innerText();
    check('C8', 'switching from customer to staff in one tab shows the staff data, no leftovers', /John Wick/.test(staffText) && /James Bond/.test(staffText) && (await r.page.locator('[role=tab]').count()) === 0);
    await r.page.getByRole('button', { name: 'Sign out' }).click();
    await r.page.waitForURL('**/login');
    await r.page.getByLabel('Username', { exact: true }).fill('JamesBond');
    await r.page.getByLabel('Password', { exact: true }).fill('JamesBond');
    await r.page.getByRole('button', { name: 'Sign in' }).click();
    await r.page.getByRole('heading', { name: 'James Bond' }).waitFor();
    await r.page.locator('article').first().waitFor();
    check('C9', 'switching to the other customer shows only that customer\'s bookings', !/John Wick|JW\d\d/.test(await r.page.locator('main').innerText()));

    // back and forward, refresh mid-wizard
    await r.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
    await r.page.getByRole('button', { name: /Toyota 2000GT/ }).click();
    await r.page.goBack();
    await r.page.getByRole('heading', { name: 'James Bond' }).waitFor();
    await r.page.goForward();
    await r.page.getByRole('heading', { name: 'Book a service' }).waitFor();
    await r.page.reload();
    await r.page.getByRole('heading', { name: 'Book a service' }).waitFor();
    check('C10', 'back, forward and a refresh in the middle of booking leave a working page', (await r.page.getByRole('button', { name: /Confirm booking/ }).isDisabled()) && (await r.page.getByRole('alert').count()) === 0);
    for (let i = 0; i < 6; i++) {
      await r.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My bookings' }).click();
      await r.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
    }
    check('C11', 'rapid switching between pages causes no error', (await r.page.getByRole('heading', { name: 'Book a service' }).isVisible()));
    await r.ctx.close();
  }

  /* ============ D. Random clicking ("monkey") ============ */
  let seed = 20261015;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const POOL = ['', ' ', 'a', 'JoinWick', '<img src=x onerror=__xss=1>', "' OR 1=1 --", '../../etc/passwd', '\u{1F697}'.repeat(20), 'x'.repeat(300), '.*[(\\', '日本語 العربية'];
  const sizes = [[390, 844], [768, 1024], [1280, 800], [320, 640]];
  for (const [label, user, startSize, steps] of [['customer on a desktop', 'JoinWick', [1280, 800], 220], ['customer on a phone', 'JamesBond', [390, 844], 220], ['staff', 'Winston', [1280, 800], 220]]) {
    const { ctx, page } = await newPage(browser, { viewport: { width: startSize[0], height: startSize[1] } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 4|status of 5|net::/.test(m.text()) && errors.push(m.text()));
    // Writes are answered with a conflict so random clicks never change the demo data.
    await page.route('**/api/appointments**', (r) => ['POST', 'PUT', 'DELETE'].includes(r.request().method()) ? r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"code":"SLOT_UNAVAILABLE","message":"Blocked in the random-click test.","requestId":"monkey","alternatives":[]}}' }) : r.continue());
    await signIn(page, user);
    await page.locator('h1').first().waitFor();
    let signedOut = 0;
    for (let i = 0; i < steps; i++) {
      try {
        if (new URL(page.url()).pathname === '/login') { await signIn(page, user); await page.locator('h1').first().waitFor(); signedOut++; continue; }
        if (i % 55 === 54) { const [w, h] = pick(sizes); await page.setViewportSize({ width: w, height: h }); }
        const kind = rnd();
        if (kind < 0.12) { await page.keyboard.press(pick(['Tab', 'Tab', 'Escape', 'Enter', 'ArrowDown', 'Space', 'Shift+Tab'])); continue; }
        if (kind < 0.16) { await (rnd() < 0.5 ? page.goBack() : page.goForward()).catch(() => {}); continue; }
        const targets = page.locator('main button:visible, main a:visible, [role=tab]:visible, main input:visible, main select:visible, header a:visible, header button:visible');
        const n = await targets.count();
        if (n === 0) continue;
        const el = targets.nth(Math.floor(rnd() * n));
        const tag = await el.evaluate((e) => e.tagName + ':' + (e.getAttribute('type') ?? '') + ':' + (e.innerText ?? '').slice(0, 20)).catch(() => '');
        if (/Sign out/.test(tag) && rnd() < 0.85) continue;
        if (tag.startsWith('INPUT:date')) { await el.fill(pick(['1900-01-01', '2026-12-31', '2100-06-15', '2026-10-28', '0001-01-01', '9999-12-31'])).catch(() => {}); }
        else if (tag.startsWith('INPUT')) { await el.fill(pick(POOL)).catch(() => {}); }
        else if (tag.startsWith('SELECT')) { const opts = await el.locator('option').count(); await el.selectOption({ index: Math.floor(rnd() * opts) }).catch(() => {}); }
        else await el.click({ timeout: 1500 }).catch(() => {});
        const alive = await page.evaluate(() => document.querySelector('#root')?.children.length > 0 && document.body.innerText.trim().length > 20).catch(() => false);
        if (!alive) { errors.push(`blank page after step ${i} (${tag})`); break; }
      } catch (err) { errors.push(`step ${i}: ${String(err.message).split('\n')[0]}`); }
    }
    const xss = await page.evaluate(() => window.__xss).catch(() => undefined);
    check('D1', `random clicks, typing, resizing and back/forward: ${label}, ${steps} steps, no uncaught error or blank page`, errors.length === 0 && xss === undefined, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await cleanup(adm.ctx.request, DAY);
  await adm.ctx.close();
} catch (err) {
  console.log('FAIL  RUN  script stopped:', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(finish() || process.exitCode || 0);
}
