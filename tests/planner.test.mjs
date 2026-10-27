/* The planner's invariants, swept across plate sizes.
 *
 * These are the properties the whole tool rests on: a plate always gets a
 * plan, every unit can be reached from circulation, no two rooms share floor,
 * the floor is completely used, circulation stays reasonable, and the two
 * stairs are far enough apart to count as separate exits.
 *
 * Run in a browser because the source is one script in one scope rather than
 * ES modules; the page is the unit under test.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'file://' + join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'app.html');
let browser, page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.options.length > 0, { timeout: 90000 });
  assert.deepEqual(errs, [], 'the page must boot without errors');
});
after(async () => { await browser?.close(); });

test('every plate gets a usable plan', async () => {
  const r = await page.evaluate(() => {
    const bad = { none:0, access:0, overlap:0, fill:0, circ:0, stairs:0, narrow:0 };
    const examples = [];
    let n = 0;
    for (let w = 46; w <= 205; w += 3)
      for (let d = 40; d <= 205; d += 3)
        for (const kind of ['residential', 'retail']){
          const p = planStorey({ x:0, y:0, w, d }, kind, { lifts:2, stairs:2 });
          n++;
          const note = m => { if (examples.length < 5) examples.push(`${w}x${d} ${kind}: ${m}`); };
          if (p.typology === 'none'){ bad.none++; note('no plan'); continue; }
          if (!checkAccess(p).ok){ bad.access++; note('unit with no way out'); }
          if (!checkOverlap(p).ok){ bad.overlap++; note('rooms overlap'); }

          const area = w * d;
          const circ = p.corridor.reduce((a, c) => a + c.w * c.d, 0);
          const court = p.court ? p.court.w * p.court.d : 0;
          const used = p.rooms.reduce((a, r) => a + r.area, 0) + circ + court;
          if (Math.abs(used / area - 1) > 0.01){ bad.fill++; note(`fills ${(used/area*100).toFixed(0)}%`); }
          if (circ / area > 0.21){ bad.circ++; note(`circulation ${(circ/area*100).toFixed(0)}%`); }

          const st = p.rooms.filter(r => r.isCore && r.label === 'Stair');
          if (st.length === 2){
            const sep = Math.hypot(st[0].x - st[1].x, st[0].y - st[1].y);
            if (sep < Math.hypot(w, d) / 3){ bad.stairs++; note('stairs too close to be separate exits'); }
          }
          for (const r of p.rooms)
            if (!r.isCore && Math.min(r.w, r.d) < 10) bad.narrow++;
        }
    return { n, bad, examples };
  });

  assert.ok(r.n > 6000, `expected a broad sweep, got ${r.n} plates`);
  assert.deepEqual(r.bad,
    { none:0, access:0, overlap:0, fill:0, circ:0, stairs:0, narrow:0 },
    `failures across ${r.n} plates\n` + r.examples.join('\n'));
});

test('unit areas land near their target', async () => {
  const r = await page.evaluate(() => {
    const err = [];
    for (let w = 60; w <= 200; w += 7)
      for (let d = 50; d <= 200; d += 7){
        const p = planStorey({ x:0, y:0, w, d }, 'residential', { lifts:2, stairs:2 });
        for (const room of p.rooms)
          if (!room.isCore && room.target)
            err.push(Math.abs(room.area - room.target) / room.target);
      }
    err.sort((a, b) => a - b);
    return { median: err[Math.floor(err.length / 2)], p90: err[Math.floor(err.length * 0.9)], n: err.length };
  });
  assert.ok(r.median < 0.10, `median unit area error ${(r.median*100).toFixed(1)}% should stay under 10%`);
  assert.ok(r.p90 < 0.25, `90th percentile ${(r.p90*100).toFixed(1)}% should stay under 25%`);
});
