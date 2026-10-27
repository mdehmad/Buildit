/* Builds app.html from src/.
 *
 * The app is one page with one script, which is what makes it deployable as a
 * static file with no server. The sources are split only so they can be read
 * and unit-tested; this concatenates them back in a fixed order, because they
 * share a single scope and a const used above its definition would not run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCES = [
  'solver.js',
  'plan-edit.js',
  'state.js',
  'site.js',
  'render3d.js',
  'plans.js',
  'schedule.js',
  'planner.js',
  'feasibility.js',
  'lifesafety.js',
  'parking.js',
  'cashflow.js',
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

writeFileSync(join(root, 'app.html'), out);
console.log(`built app.html  ${(out.length / 1024).toFixed(0)} KB  from ${SOURCES.length} sources`);
