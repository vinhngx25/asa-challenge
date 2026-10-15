// Performance budgets measured in a real browser.
//   node ui-perf.mjs https://asa-challenge.fibosolutions.com          sign-in page only (no sign-in needed, safe on the deployed site)
//   node ui-perf.mjs http://localhost:4173 --signed-in                 also the dashboard, booking and staff screens (local production build)
// Two conditions: a normal desktop connection, and a mid-range phone (390 px wide, CPU 4x slower, "Fast 3G": 1.6 Mbit/s, 150 ms).
// Measured: first contentful paint, largest contentful paint, layout shift, bytes and requests, script size, picture size.
import { BASE, checker, launch, newPage, signIn, timesGroup, testDay } from './lib.mjs';

const SIGNED_IN = process.argv.includes('--signed-in');
const { check, finish } = checker('performance');

const BUDGET = {
  desktop: { lcp: 2500, fcp: 1800, cls: 0.1, bytes: 1_500_000 },
  phone: { lcp: 4500, fcp: 3000, cls: 0.1, bytes: 1_500_000 },
};

const PROBE = () => {
  window.__perf = { lcp: 0, cls: 0, fcp: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
};

async function measure(page) {
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const kb = (n) => Math.round(n / 1024);
    const sum = (f) => res.filter(f).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
    return {
      ...window.__perf,
      requests: res.length,
      bytes: sum(() => true),
      scriptBytes: sum((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name)),
      imageBytes: sum((r) => r.initiatorType === 'img' || /\.(webp|png|jpg)(\?|$)/.test(r.name)),
      kb,
    };
  });
}

const fmt = (m) => `FCP ${Math.round(m.fcp)} ms, LCP ${Math.round(m.lcp)} ms, CLS ${m.cls.toFixed(3)}, ${m.requests} requests, ${Math.round(m.bytes / 1024)} KB (scripts ${Math.round(m.scriptBytes / 1024)} KB, pictures ${Math.round(m.imageBytes / 1024)} KB)`;

const browser = await launch();
try {
  for (const cond of ['desktop', 'phone']) {
    const opts = cond === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
    const { ctx, page } = await newPage(browser, opts);
    await page.addInitScript(PROBE);
    const cdp = await ctx.newCDPSession(page);
    if (cond === 'phone') {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    }
    const b = BUDGET[cond];

    await page.goto(BASE + '/login', { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Service Scheduler' }).waitFor({ timeout: 30_000 });
    const m = await measure(page);
    console.log(`INFO  ${cond} sign-in page: ${fmt(m)}`);
    check('PF1', `${cond}: sign-in page first contentful paint under ${b.fcp} ms`, m.fcp > 0 && m.fcp < b.fcp, `${Math.round(m.fcp)} ms`);
    check('PF2', `${cond}: sign-in page largest contentful paint under ${b.lcp} ms`, m.lcp > 0 && m.lcp < b.lcp, `${Math.round(m.lcp)} ms`);
    check('PF3', `${cond}: sign-in page layout shift under ${b.cls}`, m.cls < b.cls, m.cls.toFixed(3));
    check('PF4', `${cond}: sign-in page transfers under ${Math.round(b.bytes / 1000)} KB and under 30 requests`, m.bytes < b.bytes && m.requests < 30, `${Math.round(m.bytes / 1024)} KB, ${m.requests} requests`);
    check('PF5', `${cond}: the phone does not download the large desktop photo (pictures under 250 KB on the sign-in page)`, cond !== 'phone' || m.imageBytes < 250_000, `${Math.round(m.imageBytes / 1024)} KB of pictures`);

    if (SIGNED_IN) {
      const t0 = Date.now();
      await signIn(page, 'JoinWick');
      await page.getByRole('heading', { name: 'John Wick' }).waitFor({ timeout: 60_000 });
      await page.locator('article').first().waitFor({ timeout: 60_000 });
      const dash = Date.now() - t0;
      console.log(`INFO  ${cond} sign in to dashboard with bookings: ${dash} ms`);
      check('PF6', `${cond}: from pressing Sign in to the bookings on screen under ${cond === 'phone' ? 6000 : 2500} ms`, dash < (cond === 'phone' ? 6000 : 2500), `${dash} ms`);
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
      await page.getByRole('button', { name: /Mustang/ }).click();
      await page.getByRole('button', { name: /MOT Test/ }).first().click();
      await page.getByRole('button', { name: /Kensington Motor Works/ }).click();
      const t1 = Date.now();
      await page.locator('#date').fill(testDay());
      await timesGroup(page).first().waitFor({ timeout: 30_000 });
      const avail = Date.now() - t1;
      console.log(`INFO  ${cond} choosing a date to the times on screen: ${avail} ms`);
      check('PF7', `${cond}: choosing a date to the free times on screen under ${cond === 'phone' ? 3000 : 1500} ms`, avail < (cond === 'phone' ? 3000 : 1500), `${avail} ms`);
      const after = await measure(page);
      check('PF8', `${cond}: the booking page keeps layout shift under ${b.cls}`, after.cls < b.cls, after.cls.toFixed(3));
      check('PF9', `${cond}: all pictures loaded so far weigh under 2 MB`, after.imageBytes < 2_000_000, `${Math.round(after.imageBytes / 1024)} KB`);
    }
    await ctx.close();
  }
} catch (err) {
  console.log('FAIL  RUN  script stopped:', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(finish() || process.exitCode || 0);
}
