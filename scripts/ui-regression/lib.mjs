// Helpers shared by the additional browser checks (resilience, layout, visual, performance).
import { chromium } from 'playwright';

export const CHROME = process.env.CHROME_PATH || undefined;
export const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');

export const launch = () => chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), headless: true });

export function checker(label = '') {
  const results = [];
  const check = (id, name, ok, detail = '') => {
    results.push({ id, name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${!ok && detail ? '  [' + detail + ']' : ''}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} ${label} checks passed (${BASE})`);
    return failed ? 1 : 0;
  };
  return { check, finish, results };
}

export async function newPage(browser, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  return { ctx, page };
}

export async function signIn(page, user, pass = user) {
  await page.goto(BASE + '/login');
  await page.getByLabel('Username', { exact: true }).fill(user);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A Wednesday at least 10 days ahead as YYYY-MM-DD. */
export function testDay(minDays = 10) {
  const d = new Date(Date.now() + minDays * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

export const timesGroup = (page) => page.getByRole('group', { name: 'Available start times' }).getByRole('button');

/** Cancel every upcoming booking of the two demo customers on a day, through the API (keeps repeated runs clean). */
export async function cleanup(request, day) {
  let cancelled = 0;
  for (const user of ['JoinWick', 'JamesBond']) {
    const login = await request.post(BASE + '/api/auth/login', { data: { username: user, password: user } });
    const token = (await login.json()).token;
    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await request.get(BASE + '/api/appointments', { headers })).json();
    for (const a of list.filter((x) => x.status === 'BOOKED' && x.startTime.slice(0, 10) === day)) {
      cancelled += (await request.post(`${BASE}/api/appointments/${a.id}/cancel`, { headers })).ok() ? 1 : 0;
    }
  }
  return cancelled;
}
