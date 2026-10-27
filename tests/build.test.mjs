/* app.html is generated. If it has been edited by hand the sources no longer
   describe what ships, so rebuilding must leave the file untouched. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the built app matches its sources', () => {
  const before = readFileSync(join(root, 'dist/app.html'), 'utf8');
  execFileSync('node', [join(root, 'scripts/build.mjs')], { cwd: root });
  const after = readFileSync(join(root, 'dist/app.html'), 'utf8');
  assert.equal(after, before, 'app.html is stale — run npm run build and commit the result');
});

test('nothing declares a const the boot sequence needs before it runs', () => {
  const html = readFileSync(join(root, 'dist/app.html'), 'utf8');
  const body = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
  const boot = body.lastIndexOf('/* ================= boot ================= */');
  assert.ok(boot > 0, 'the boot section should be last');
  const after = body.slice(boot);
  const declared = [...after.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map(m => m[1]);
  const used = declared.filter(n => new RegExp(`\\b${n}\\b`).test(body.slice(0, boot)));
  assert.deepEqual(used, [],
    `these are declared after boot but used before it: ${used.join(', ')}`);
});
