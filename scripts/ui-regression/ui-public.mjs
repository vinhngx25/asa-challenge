// Browser checks that need no sign-in, safe to run against the deployed site.
//   node ui-public.mjs [base-url]     default: http://localhost:5173
//   CHROME_PATH=<chrome.exe>          use an installed Chrome/Chromium
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || undefined;
const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${!ok && detail ? '  [' + detail + ']' : ''}`);
};

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`));

  // Login page
  const started = Date.now();
  const res = await page.goto(BASE + '/login', { waitUntil: 'load' });
  const loadMs = Date.now() - started;
  await page.getByRole('heading', { name: 'Service Scheduler' }).waitFor();
  check('P-01', 'login page loads and shows the title, username, password and Sign in', (await page.getByLabel('Username', { exact: true }).isVisible()) && (await page.getByLabel('Password', { exact: true }).isVisible()) && (await page.getByRole('button', { name: 'Sign in' }).isVisible()));
  check('P-02', `login page loads quickly (${loadMs} ms, limit 5000)`, loadMs < 5000);
  const pageText = await page.locator('body').innerText();
  check('P-22', 'the login page explains the rules: 32 characters, case sensitive, no spaces in a password, who signs in, session length, demo note',
    /Up to 32 characters\. Case sensitive\./.test(pageText) && /Up to 32 characters, no spaces\. Case sensitive\./.test(pageText) && /Customers and staff sign in on this page/.test(pageText) && /8 hours/.test(pageText) && /demo/i.test(pageText), pageText.slice(0, 300));
  check('P-03', 'page title is "Service Scheduler"', (await page.title()) === 'Service Scheduler');

  // Security headers and transport
  const h = res.headers();
  // These headers are added by CloudFront, so they are only expected on a deployed https site.
  if (BASE.startsWith('https://')) check('P-04', 'security headers: HSTS, CSP, X-Frame-Options DENY, nosniff', /max-age=\d+/.test(h['strict-transport-security'] ?? '') && /default-src 'self'/.test(h['content-security-policy'] ?? '') && h['x-frame-options'] === 'DENY' && h['x-content-type-options'] === 'nosniff', JSON.stringify(h));
  if (BASE.startsWith('https://')) {
    const plain = BASE.replace('https://', 'http://');
    const r = await ctx.request.get(plain + '/', { maxRedirects: 0 });
    check('P-05', 'http:// redirects to https://', [301, 302, 308].includes(r.status()) && (r.headers()['location'] ?? '').startsWith('https://'), `${r.status()} ${r.headers()['location']}`);
  }

  // Images, console, requests
  await page.waitForTimeout(1200);
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  const imgCount = await page.evaluate(() => document.images.length);
  check('P-06', `all ${imgCount} images on the login page load (logo and hero)`, imgCount >= 2 && broken.length === 0, broken.join(','));
  check('P-07', 'no console errors or CSP violations while loading', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('P-08', 'no failed requests while loading (4xx or 5xx)', failedRequests.length === 0, failedRequests.join(', '));

  // Accessibility and keyboard
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  check('P-09', 'no WCAG 2.1 A/AA violations on the login page', axe.violations.length === 0, axe.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
  const focused = async () => page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('autocomplete') || (el instanceof HTMLInputElement && el.type === 'checkbox' ? 'show-password' : el?.textContent?.trim());
  });
  const order = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    order.push(await focused());
  }
  check('P-10', 'keyboard order: username, password, Show password, Sign in', JSON.stringify(order) === JSON.stringify(['username', 'current-password', 'show-password', 'Sign in']), order.join(' / '));

  // Redirects for signed-out visitors
  for (const [id, path] of [['P-11', '/book'], ['P-12', '/nothing-here'], ['P-13', '/']]) {
    await page.goto(BASE + path);
    await page.waitForURL('**/login');
    check(id, `signed out, ${path} goes to the login page`, new URL(page.url()).pathname === '/login');
  }
  await page.evaluate(() => localStorage.setItem('asa.token', 'invalid.token.value'));
  await page.goto(BASE + '/');
  await page.getByLabel('Username', { exact: true }).waitFor();
  check('P-14', 'an invalid saved token returns to the login page and is cleared', (await page.evaluate(() => localStorage.getItem('asa.token'))) === null);

  // API through the browser's network stack
  const api = (p, o) => ctx.request.get(BASE + '/api' + p, o);
  const health = await api('/health');
  check('P-15', 'GET /api/health is public and returns a request id', health.ok() && (await health.json()).status === 'ok' && Boolean(health.headers()['x-request-id']));
  for (const p of ['/catalog', '/appointments', '/vehicles', '/me', '/availability?dealershipId=x&serviceTypeId=y&date=2026-10-28']) {
    const r = await api(p);
    const body = await r.json();
    check('P-16', `GET /api${p.split('?')[0]} without a token is 401 UNAUTHENTICATED`, r.status() === 401 && body.error?.code === 'UNAUTHENTICATED' && Boolean(body.error?.requestId));
  }
  const forged = await api('/appointments', { headers: { Authorization: 'Bearer forged.token.value' } });
  check('P-17', 'a forged bearer token is rejected (401)', forged.status() === 401);
  const bad = await ctx.request.post(BASE + '/api/auth/login', { data: '{not json', headers: { 'content-type': 'application/json' } });
  check('P-18', 'malformed login body is 400 INVALID_INPUT, not a server error', bad.status() === 400 && (await bad.json()).error.code === 'INVALID_INPUT');
  const post = await ctx.request.post(BASE + '/api/appointments', { data: {} });
  check('P-19', 'POST /api/appointments without a token is 401', post.status() === 401);
  check('P-20', 'API responses are not cacheable (cache-control: no-store)', (health.headers()['cache-control'] ?? '').includes('no-store'));

  // Phone width
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/login');
  await pp.getByRole('heading', { name: 'Service Scheduler' }).waitFor();
  await pp.waitForTimeout(500);
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('P-21', 'phone width (390 px): the login page does not scroll sideways', !overflow);
  await phone.close();
  await ctx.close();
} catch (err) {
  console.log('FAIL  RUN  script stopped:', String(err.message).split('\n')[0]);
  results.push({ id: 'RUN', ok: false });
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} public UI checks passed (${BASE})`);
  process.exit(failed ? 1 : 0);
}
