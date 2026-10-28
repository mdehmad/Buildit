/* Builds app.html from src/.
 *
 * The app is one page with one script, which is what makes it deployable as a
 * static file with no server. The sources are split only so they can be read
 * and unit-tested; this concatenates them back in a fixed order, because they
 * share a single scope and a const used above its definition would not run.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCES = [
  'help.js',
  'solver.js',
  'plan-edit.js',
  'state.js',
  'site.js',
  'render3d.js',
  'plans.js',
  'schedule.js',
  'planner.js',
  'feasibility.js',
  'pages.js',
  'brief.js',
  'lifesafety.js',
  'parking.js',
  'cashflow.js',
  'schemes.js',
  'boot.js',
];

const body = SOURCES
  .map(f => readFileSync(join(root, 'src', f), 'utf8'))
  .join('\n');

/* The replacement is a function on purpose. Passing the sources as a string
   lets $ sequences in them be interpreted: the code contains sym:'$', and $'
   means "everything after the match", which spliced the end of the template
   into the middle of the script. */
const out = readFileSync(join(root, 'src/template.html'), 'utf8')
  .replace('/*__BUILDIT_SOURCES__*/', () => body);

/* Everything that ships goes to dist/, and nothing else does.
 *
 * Deploying the repository root was uploading the sources, the tests and,
 * once there was a package.json for Cloudflare to install, node_modules --
 * far past the asset limits. dist/ holds exactly the three pages and the
 * screenshots the landing page uses. */
const dist = join(root, 'dist');
mkdirSync(join(dist, 'docs'), { recursive: true });

writeFileSync(join(dist, 'app.html'), out);
copyFileSync(join(root, 'src/landing.html'),  join(dist, 'landing.html'));
copyFileSync(join(root, 'src/redirect.html'), join(dist, 'index.html'));

const shots = readdirSync(join(root, 'docs')).filter(f => f.endsWith('.png'));
for (const f of shots) copyFileSync(join(root, 'docs', f), join(dist, 'docs', f));

console.log(`built dist/app.html  ${(out.length / 1024).toFixed(0)} KB  `
  + `from ${SOURCES.length} sources, plus 2 pages and ${shots.length} images`);
