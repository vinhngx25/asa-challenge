// Layout audit: measures every main screen at seven screen sizes. Local app (it signs in).
//   node ui-layout.mjs [base-url] [screenshot-dir]
// Rules (measured, not eyeballed):
//   L1 no sideways scrolling
//   L2 header: items in one row share a vertical centre (within 4 px); at most 2 rows and at most 130 px tall on phones
//   L3 header items never overlap each other
//   L4 touch targets (buttons, links, tabs, chips, time slots) are at least 36 px high on screens up to 768 px wide
//   L5 no visible text under 12 px
//   L6 pictures keep their proportions (no stretching)
//   L7 main text blocks are not cut off by their container (overflow that is not a deliberate scroller or ellipsis)
import fs from 'node:fs';
import path from 'node:path';
import { BASE, checker, launch, newPage, signIn, timesGroup, testDay } from './lib.mjs';

const OUT = process.argv[3] ?? './layout';
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = checker('layout');
const SIZES = [[320, 640], [360, 740], [390, 844], [414, 896], [768, 1024], [1024, 768], [1440, 900]];
const DAY = testDay();

/** Runs in the page: returns measurements for the rules above. */
function measure() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2, r: r.right, b: r.bottom }; };
  const w = window.innerWidth;
  const out = { overflow: document.documentElement.scrollWidth > w + 1, scrollWidth: document.documentElement.scrollWidth, w };

  // header
  const header = document.querySelector('header');
  if (header) {
    const hr = header.getBoundingClientRect();
    const items = [...header.querySelectorAll('a, button, img, span.font-bold, div.leading-tight, nav')].filter(vis).filter((e) => !e.closest('nav') || e.tagName === 'NAV');
    const boxes = items.map((e) => ({ name: (e.tagName + ' ' + (e.getAttribute('alt') ?? e.innerText ?? '')).trim().slice(0, 28), ...rect(e) }));
    const rows = [];
    for (const b of [...boxes].sort((a, b) => a.y - b.y)) {
      const row = rows.find((r) => Math.abs(r.cy - b.cy) < b.h * 0.6 + 6);
      if (row) { row.items.push(b); row.cy = row.items.reduce((s, i) => s + i.cy, 0) / row.items.length; } else rows.push({ cy: b.cy, items: [b] });
    }
    out.header = { height: hr.height, rows: rows.length, misaligned: rows.filter((r) => Math.max(...r.items.map((i) => i.cy)) - Math.min(...r.items.map((i) => i.cy)) > 4).map((r) => r.items.map((i) => `${i.name}@${Math.round(i.cy)}`).join(' | ')) };
    out.overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const inter = Math.min(a.r, b.r) - Math.max(a.x, b.x) > 2 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 2;
      if (inter && !(items[i].contains(items[j]) || items[j].contains(items[i]))) out.overlaps.push(`${a.name} x ${b.name}`);
    }
  }

  // touch targets
  out.small = [...document.querySelectorAll('a[href], button, [role=tab], select, input:not([type=hidden])')].filter(vis)
    .filter((e) => !e.closest('[aria-hidden=true]') && !(e.tagName === 'INPUT' && (e.type === 'checkbox')))
    .map((e) => ({ name: (e.tagName + ' ' + (e.innerText || e.getAttribute('aria-label') || e.getAttribute('alt') || '')).trim().replace(/\s+/g, ' ').slice(0, 30), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
    .filter((e) => e.h < 36);

  // text under 12 px
  const tiny = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) tiny.add(`${fs}px "${n.textContent.trim().slice(0, 24)}"`);
  }
  out.tiny = [...tiny];

  // stretched pictures
  out.stretched = [...document.images].filter(vis).filter((i) => i.naturalWidth > 0).filter((i) => getComputedStyle(i).objectFit === 'fill')
    .map((i) => ({ src: i.src.split('/').pop(), ratio: +(i.getBoundingClientRect().width / i.getBoundingClientRect().height / (i.naturalWidth / i.naturalHeight)).toFixed(2) }))
    .filter((i) => Math.abs(i.ratio - 1) > 0.05);

  // clipped text (not scrollers, not ellipsis)
  out.clipped = [...document.querySelectorAll('main *, header *')].filter(vis).filter((e) => {
    const s = getComputedStyle(e);
    if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.textOverflow === 'ellipsis' || e.closest('.truncate,[class*="overflow-x-auto"]')) return false;
    return e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && e.children.length === 0;
  }).map((e) => (e.innerText || '').trim().slice(0, 30)).filter(Boolean);
  return out;
}

async function audit(page, label, w) {
  await page.waitForTimeout(500);
  const m = await page.evaluate(measure);
  const phone = w <= 430;
  check(`L1 ${label} @${w}`, 'no sideways scrolling', !m.overflow, `scrollWidth ${m.scrollWidth}`);
  if (m.header) {
    check(`L2 ${label} @${w}`, `header: rows share a centre line${phone ? ', at most 2 rows, at most 130 px tall' : ''}`,
      m.header.misaligned.length === 0 && (!phone || (m.header.rows <= 2 && m.header.height <= 130)), `${m.header.rows} rows, ${Math.round(m.header.height)} px, misaligned: ${m.header.misaligned.join(' ;; ')}`);
    check(`L3 ${label} @${w}`, 'header items do not overlap', m.overlaps.length === 0, m.overlaps.join(', '));
  }
  if (w <= 768) check(`L4 ${label} @${w}`, 'touch targets are at least 36 px high', m.small.length === 0, m.small.slice(0, 5).map((s) => `${s.name} ${s.w}x${s.h}`).join(' ; '));
  check(`L5 ${label} @${w}`, 'no text under 12 px', m.tiny.length === 0, m.tiny.slice(0, 4).join(' ; '));
  check(`L6 ${label} @${w}`, 'pictures keep their proportions', m.stretched.length === 0, JSON.stringify(m.stretched));
  check(`L7 ${label} @${w}`, 'no text cut off by its container', m.clipped.length === 0, m.clipped.slice(0, 4).join(' ; '));
}

const browser = await launch();
try {
  for (const [w, h] of SIZES) {
    const { ctx, page } = await newPage(browser, { viewport: { width: w, height: h } });
    // login
    await page.goto(BASE + '/login');
    await page.getByRole('heading', { name: 'Service Scheduler' }).waitFor();
    await audit(page, 'login', w);
    await page.screenshot({ path: path.join(OUT, `login-${w}.png`), fullPage: true });

    // customer pages
    await signIn(page, 'JoinWick');
    await page.getByRole('heading', { name: 'John Wick' }).waitFor();
    await page.locator('article').first().waitFor();
    await audit(page, 'dashboard', w);
    await page.screenshot({ path: path.join(OUT, `dashboard-${w}.png`), fullPage: true });
    await page.getByRole('tab', { name: /Cancelled/ }).click();
    await audit(page, 'dashboard-cancelled', w);

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a service' }).click();
    await page.getByRole('button', { name: /Mustang/ }).click();
    await page.getByRole('button', { name: /MOT Test/ }).click();
    await page.getByRole('button', { name: /Kensington Motor Works/ }).click();
    await page.locator('#date').fill(DAY);
    await timesGroup(page).first().waitFor();
    await timesGroup(page).nth(3).click();
    await audit(page, 'booking', w);
    await page.screenshot({ path: path.join(OUT, `booking-${w}.png`), fullPage: true });
    await ctx.close();

    // staff
    const s = await newPage(browser, { viewport: { width: w, height: h } });
    await signIn(s.page, 'Winston');
    await s.page.getByRole('heading', { name: 'All bookings' }).waitFor();
    await s.page.locator('article').first().waitFor();
    await audit(s.page, 'staff', w);
    await s.page.screenshot({ path: path.join(OUT, `staff-${w}.png`), fullPage: true });
    await s.ctx.close();
  }
} catch (err) {
  console.log('FAIL  RUN  script stopped:', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(finish() || process.exitCode || 0);
}
