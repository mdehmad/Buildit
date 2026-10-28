/* The application: that it boots, that the pieces agree with each other, and
 * that the appraisal arithmetic is self-consistent. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(DIR, '..', 'dist', 'app.html');

async function boot(opts = {}){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for (const pat of opts.block || []) await page.route(pat, r => r.abort());
  if (opts.noWebGL) await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(t, s, a){ return /webgl/i.test(a[0]) ? null : Reflect.apply(t, s, a); } });
  });
  if (opts.noStorage) await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } });
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.options.length > 0, { timeout: 90000 });
  return { browser, page, errs };
}

let b, p, e;
before(async () => { ({ browser: b, page: p, errs: e } = await boot()); });
after(async () => { await b?.close(); });

test('boots without errors', () => assert.deepEqual(e, []));

/* Generation used to run the annealer five times with five seeds and call the
   results five options. Once space planning moved off the bay grid the seeds
   stopped changing anything that gets drawn, so all five came back as the same
   building and the only number that differed was a score nothing read. This
   fails if that ever becomes true again. */
test('each option is a different building', async () => {
  const r = await p.evaluate(() => {
    const plans = [], stats = [];
    for (let i = 0; i < state.options.length; i++){
      applyOption(i);
      stats.push(schemeStats(state.options[i]));
      plans.push(JSON.stringify((state.plan || []).filter(Boolean).map(
        q => q.rooms.map(m => [m.x|0, m.y|0, m.w|0, m.d|0, m.label]))));
    }
    applyOption(0);
    return {
      n: plans.length,
      distinctPlans: new Set(plans).size,
      distinctNames: new Set(stats.map(s => s.name)).size,
      units: stats.map(s => s.units),
      nets:  stats.map(s => Math.round(s.net)),
      empty: stats.filter(s => !s.units).map(s => s.name),
    };
  });
  assert.ok(r.n >= 2, `expected several options, got ${r.n}`);
  assert.equal(r.distinctPlans, r.n, 'every option must lay out differently');
  assert.equal(r.distinctNames, r.n, 'every option must name a different scheme');
  assert.deepEqual(r.empty, [], 'no scheme may come back with nothing in it');
  // the spread has to be worth looking at, not a rounding difference
  const span = (a) => (Math.max(...a) - Math.min(...a)) / Math.max(...a);
  assert.ok(span(r.units) > 0.08,
    `unit counts ${r.units.join('/')} are too close to be distinct options`);
  assert.ok(span(r.nets) > 0.03,
    `lettable areas ${r.nets.join('/')} are too close to be distinct options`);
});

test('every generated storey is sound', async () => {
  const r = await p.evaluate(() => {
    const out = { levels: 0, access: 0, overlap: 0, fill: 0 };
    for (const plan of (state.plan || []).filter(Boolean)){
      out.levels++;
      if (!checkAccess(plan).ok) out.access++;
      if (!checkOverlap(plan).ok) out.overlap++;
      const used = plan.rooms.reduce((a, r) => a + r.area, 0) + plan.circ + plan.voidA;
      if (Math.abs(used / plan.gross - 1) > 0.01) out.fill++;
    }
    return out;
  });
  assert.ok(r.levels > 0, 'a scheme should have been generated');
  assert.equal(r.access, 0, 'every unit must be reachable from circulation');
  assert.equal(r.overlap, 0, 'no two rooms may share floor area');
  assert.equal(r.fill, 0, 'every floor must be completely used');
});

test('basements are costed but kept out of the floor area ratio', async () => {
  const r = await p.evaluate(() => {
    const s = schedule(), f = feasibility();
    return { gfa: s.gfa, basement: s.park ? s.park.gross : 0,
             costed: !!f.lines.find(l => l.use === 'parking'),
             byFloor: s.byFloor.reduce((a, x) => a + x.gfa, 0) };
  });
  assert.ok(r.basement > 0, 'the scheme should have basements');
  assert.ok(r.costed, 'the basement must appear in the cost stack');
  assert.ok(Math.abs(r.gfa - r.byFloor) < 1,
    'gross floor area must be the above-grade storeys only');
});

test('the residual appraisal is self-consistent', async () => {
  const r = await p.evaluate(() => {
    feasibility();
    const checks = [];
    for (const target of [15, 20, 25, 30]){
      state.feas.target = target; state.feas.landMode = 'persqft';
      const a = feasibility();
      state.feas.landMode = 'lump'; state.feas.landLump = a.resid;
      checks.push({ target, got: feasibility().onCost * 100 });
    }
    state.feas.target = 20; state.feas.landMode = 'persqft';

    const base = feasibility();
    const keep = JSON.parse(JSON.stringify(state.feas.sale));
    for (const k in state.feas.sale) state.feas.sale[k] = base.breakeven;
    const atBreakeven = feasibility().profit;
    state.feas.sale = keep;
    return { checks, atBreakeven };
  });
  for (const c of r.checks)
    assert.ok(Math.abs(c.got - c.target) < 0.01,
      `paying the residual land value should return the ${c.target}% target, got ${c.got.toFixed(2)}%`);
  assert.ok(Math.abs(r.atBreakeven) < 1,
    `selling at the breakeven rate should return nothing, got ${r.atBreakeven}`);
});

test('the cashflow conserves money', async () => {
  const r = await p.evaluate(() => {
    const c = cashflow();
    const inn = c.series.reduce((a, x) => a + x.in, 0);
    const out = c.series.reduce((a, x) => a + x.out, 0);
    const cost = c.r.land + c.r.soft + c.r.build + c.r.cont + c.r.mkt;
    return { inn, gdv: c.r.gdv, out, cost };
  });
  assert.ok(Math.abs(r.inn - r.gdv) < 1, 'receipts must add up to the gross development value');
  assert.ok(Math.abs(r.out - r.cost) < 1, 'outflows must add up to the cost stack');
});

test('means of escape is checked and met', async () => {
  const r = await p.evaluate(() => {
    const g = egressReport();
    return { ok: g.ok, floors: g.per.length, fails: g.bad.map(x => `L${x.lvl}: ${x.fails.join(', ')}`) };
  });
  assert.ok(r.floors > 0);
  assert.ok(r.ok, 'every storey should pass egress\n' + r.fails.join('\n'));
});

test('an edit cannot strand a room', async () => {
  const r = await p.evaluate(() => {
    const plan = state.plan[1];
    const before = plan.rooms.length;
    // ask for a split across the depth, which would cut a unit off the corridor
    const i = plan.rooms.findIndex(x => !x.isCore);
    const room = plan.rooms[i];
    tryEdit(plan, () => splitRoom(plan, i, room.x + room.w / 2, 'residential'));
    return { access: checkAccess(plan).ok, overlap: checkOverlap(plan).ok,
             grew: plan.rooms.length >= before };
  });
  assert.ok(r.access, 'editing must never leave a room without a way out');
  assert.ok(r.overlap, 'editing must never overlap two rooms');
});

for (const [name, opts] of [
  ['with both CDNs unreachable', { block: ['**cdnjs.cloudflare.com/**', '**unpkg.com/**'] }],
  ['with WebGL switched off',    { noWebGL: true }],
  ['with local storage blocked', { noStorage: true }],
]){
  test(`still works ${name}`, async () => {
    const s = await boot(opts);
    try {
      assert.deepEqual(s.errs, [], 'should boot without errors');
      const ok = await s.page.evaluate(() =>
        (state.plan || []).filter(Boolean).every(p => checkAccess(p).ok));
      assert.ok(ok, 'plans should still be sound');
    } finally { await s.browser.close(); }
  });
}

/* The help layer is the only part of the app that can fail quietly: if it
   throws on load, nothing else notices and the tool simply loses its guide.
   These check that it mounted, that every FAQ an error path points at exists,
   and that the fixes a pop-up offers actually recover the scheme. */
test('the help layer loads and its FAQ library is sound', async () => {
  const r = await p.evaluate(() => {
    const H = window.BuildITHelp;
    if (!H) return { missing: true };
    const ans = f => typeof f.a === 'function' ? f.a() : f.a;
    const screens = ['dash', 'site', 'mass', 'render', 'plans', 'inv', 'feas'];
    return {
      n: H.FAQ.length,
      dupIds: H.FAQ.length - new Set(H.FAQ.map(f => f.id)).size,
      badCat: H.FAQ.filter(f => !H.CATS[f.cat]).map(f => f.id),
      thin: H.FAQ.filter(f => !f.q || String(ans(f)).length < 80).map(f => f.id),
      noTip: H.FAQ.filter(f => !f.tip).map(f => f.id),
      // every screen must have at least one question of its own to rotate
      bareScreens: screens.filter(s => !H.FAQ.some(f => f.screens.includes(s))),
      // ids the error pop-ups reference
      missingRefs: ['nobuild', 'setbacks', 'irregular', 'fewopts']
        .filter(id => !H.byId[id]),
      guideMounted: !!document.getElementById('mimar'),
    };
  });
  assert.ok(!r.missing, 'window.BuildITHelp must be defined');
  assert.ok(r.n >= 20, `expected a real FAQ library, got ${r.n} entries`);
  assert.equal(r.dupIds, 0, 'FAQ ids must be unique');
  assert.deepEqual(r.badCat, [], 'every FAQ must sit in a declared category');
  assert.deepEqual(r.thin, [], 'every FAQ needs a question and a real answer');
  assert.deepEqual(r.noTip, [], 'every FAQ needs a tip for Mimar to say');
  assert.deepEqual(r.bareScreens, [], 'every screen needs questions of its own');
  assert.deepEqual(r.missingRefs, [], 'error pop-ups reference FAQs that exist');
  assert.ok(r.guideMounted, 'the guide should mount itself');
});

test('an unbuildable plot explains itself and offers a fix that works', async () => {
  const r = await p.evaluate(async () => {
    const keep = state.site.setbacks.slice();
    state.site.setbacks = state.site.setbacks.map(() => 62);
    paintEdgeRows(); resize2();
    await generate(false);
    const box = document.getElementById('oops');
    const out = {
      shown: !!box,
      fixes: box ? [...box.querySelectorAll('[data-fix]')].length : 0,
      faqs: box ? [...box.querySelectorAll('.oops-faq summary')].length : 0,
    };
    // take the setback fix and check it actually recovers
    // the dialog closes first and runs the fix a moment later, on purpose
    if (box) box.querySelector('[data-fix="1"]').click();
    await new Promise(r => setTimeout(r, 400));
    await generate(false);
    out.recovered = state.options.length;
    state.site.setbacks = keep; paintEdgeRows(); resize2();
    await generate(false);
    return out;
  });
  assert.ok(r.shown, 'an unbuildable plot must say why, not just flag a strip');
  assert.ok(r.fixes >= 2, 'the pop-up should offer something to try');
  assert.ok(r.faqs >= 1, 'the pop-up should link the questions behind it');
  assert.ok(r.recovered > 0, 'the offered fix must actually produce a scheme');
});
