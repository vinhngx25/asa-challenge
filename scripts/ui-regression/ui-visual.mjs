// Visual regression: screenshots of the main screens compared with saved baselines (local app, signs in).
//   node ui-visual.mjs [base-url] --update      save the current look as the baseline (do this on a build you trust)
//   node ui-visual.mjs [base-url]               compare with the baseline; differences are saved to ./diffs
// Dynamic text (dates, counts, references) is hidden before the picture is taken, so only layout, colour and images are compared.
// Baselines depend on the machine's fonts and browser, so they are not committed: create them once, then run after each change.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { BASE, checker, launch, newPage, signIn, timesGroup, testDay } from './lib.mjs';

const UPDATE = process.argv.includes('--update');
const DIR = path.resolve('baselines');
const DIFFS = path.resolve('diffs');
const ALLOWED_DIFF = 0.004; // share of pixels that may differ (font smoothing)
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(DIFFS, { recursive: true });
const { check, finish } = checker('visual');

const MASK = `
  article dl, article .font-mono, [role=tab], section[aria-label="Summary"], h1 + p, #date, aside dd,
  section[aria-label="Dealerships"] .text-brand-700, article h3 + p { color: transparent !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`;

async function settle(page) {
  await page.addStyleTag({ content: MASK });
  await page.evaluate(() => document.fonts.ready);
  // Only pictures on screen are waited for; pictures far below the fold are loaded lazily and never needed here.
  await page.waitForFunction(() => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0; }).every((i) => i.complete));
  await page.waitForTimeout(250);
}

async function compare(page, name) {
  await settle(page);
  const file = path.join(DIR, `${name}.png`);
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  if (UPDATE) { fs.writeFileSync(file, shot); check('V1', `${name}: baseline saved`, true); return; }
  if (!fs.existsSync(file)) { check('V1', `${name}: matches the baseline`, false, 'no baseline yet: run with --update first'); return; }
  const a = PNG.sync.read(fs.readFileSync(file));
  const b = PNG.sync.read(shot);
  if (a.width !== b.width || a.height !== b.height) { check('V1', `${name}: matches the baseline`, false, `size ${a.width}x${a.height} became ${b.width}x${b.height}`); return; }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
  const ratio = n / (a.width * a.height);
  if (ratio > ALLOWED_DIFF) fs.writeFileSync(path.join(DIFFS, `${name}.png`), PNG.sync.write(diff));
  check('V1', `${name}: matches the baseline (${(ratio * 100).toFixed(2)}% of pixels differ, limit ${(ALLOWED_DIFF * 100).toFixed(1)}%)`, ratio <= ALLOWED_DIFF, `${n} pixels differ; picture saved in diffs/${name}.png`);
}

const browser = await launch();
try {
  for (const [w, h, tag] of [[1440, 800, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'phone']]) {
    const login = await newPage(browser, { viewport: { width: w, height: h } });
    await login.page.goto(BASE + '/login');
    await login.page.getByRole('heading', { name: 'Service Scheduler' }).waitFor();
    await compare(login.page, `login-${tag}`);
    await login.ctx.close();
  }
  for (const [w, h, tag] of [[1440, 800, 'desktop'], [390, 844, 'phone']]) {
    const c = await newPage(browser, { viewport: { width: w, height: h } });
    await signIn(c.page, 'JoinWick');
    await c.page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await c.page.locator('article').first().waitFor();
    await compare(c.page, `dashboard-${tag}`);
    await c.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
    await c.page.getByRole('heading', { name: 'Book a service' }).waitFor();
    await compare(c.page, `booking-start-${tag}`);
    await c.page.getByRole('button', { name: /Mustang/ }).click();
    await c.page.getByRole('button', { name: /MOT Test/ }).first().click();
    await c.page.getByRole('button', { name: /Kensington Motor Works/ }).click();
    await c.page.locator('#date').fill(testDay());
    await timesGroup(c.page).first().waitFor();
    await timesGroup(c.page).nth(4).click();
    await c.page.locator('#date').scrollIntoViewIfNeeded();
    await compare(c.page, `booking-times-${tag}`);
    await c.ctx.close();

    const s = await newPage(browser, { viewport: { width: w, height: h } });
    await signIn(s.page, 'Winston');
    await s.page.getByRole('heading', { name: 'All bookings' }).waitFor();
    await s.page.locator('article').first().waitFor();
    await compare(s.page, `staff-${tag}`);
    await s.ctx.close();
  }
} catch (err) {
  console.log('FAIL  RUN  script stopped:', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(finish() || process.exitCode || 0);
}
