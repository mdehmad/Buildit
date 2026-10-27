/* Regenerate the screenshots in docs/.
 *
 * These are used by the landing page and the README, so when the interface
 * changes they stop describing the product and start misrepresenting it --
 * the landing page carried shots of a theme the application no longer used.
 * Run `npm run shots` after any visual change, then rebuild.
 *
 * Usage: node scripts/shots.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR  = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const APP  = 'file://' + join(ROOT, 'dist', 'app.html');
const OUT  = join(ROOT, 'docs');

/* view key -> file name. 'site' needs no generated scheme; the rest do. */
const SHOTS = [
  ['dash',   'dashboard'],
  ['site',   'plot'],
  ['mass',   'massing'],
  ['render', 'render'],
  ['plans',  'plans'],
  ['inv',    'schedule'],
  ['feas',   'feasibility'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof state !== 'undefined' && state.options.length > 0, { timeout: 90000 });

// a named scheme reads better in a screenshot than "Untitled"
await page.evaluate(() => {
  const el = document.getElementById('projName');
  if (el) { el.value = 'Gulberg Mixed-Use'; el.dispatchEvent(new Event('input')); }
  const loc = document.getElementById('locName');
  if (loc) { loc.value = 'Plot 42, Gulberg Greens'; loc.dispatchEvent(new Event('input')); }
});

for (const [view, name] of SHOTS) {
  await page.evaluate(v => showView(v), view);
  // the 3D views need a frame or two of orbit settling before they are drawn
  await page.waitForTimeout(view === 'mass' || view === 'render' ? 2600 : 900);
  await page.screenshot({ path: join(OUT, name + '.png') });
  process.stdout.write(`docs/${name}.png\n`);
}

/* the plan editor is a modal, not a view */
await page.evaluate(() => { if (typeof openPlan === 'function') openPlan(1); });
await page.waitForTimeout(900);
if (await page.locator('#planModal.on').count()) {
  await page.screenshot({ path: join(OUT, 'editor.png') });
  process.stdout.write('docs/editor.png\n');
}

await browser.close();
if (errs.length) { console.error('page errors:', errs); process.exit(1); }
