#!/usr/bin/env node
// The release gate for the contract stubs of Task 1 (export and import) and Task 2 (the Overview). Each stub answers `throw new Error('not built')`
// until its lane builds it. This check fails while one is left in a file that ships, so a release never carries a feature that only pretends to work.
//   node tools/check-not-built.mjs          prints each file that still holds a stub, and exits 1 when there is one
//   npm run check:not-built                 the same
//   BOWERLOOM_RELEASE_GATE=1 npm test       the same check runs as a test (tools/test/check-not-built.test.mjs); without the variable that test is skipped
// Run it in the gate lane before the release pull request. It reads source files only and runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files and folders that must hold no stub when a release is cut, relative to the repository root. */
export const SHIPPED = Object.freeze([
  'packages/harness-bundle/src',
  'apps/desktop/main/engine-service.ts',
  'apps/desktop/main/engine-bundle.ts',
  'apps/desktop/shared/engine/sample.ts',
  'apps/desktop/shared/harness/overview.ts',
  'apps/desktop/shared/harness/overview-layout.ts',
]);
const STUB = /['"`]not built['"`]/;
const SOURCE = /\.(?:ts|tsx|mjs|js)$/;
const SKIP = new Set(['node_modules', 'dist', '.build', 'test', 'tests']);

function files(root, rel) {
  const at = path.join(root, rel);
  let stat;
  try { stat = fs.statSync(at); } catch { return []; }
  if (stat.isFile()) return [rel];
  return fs.readdirSync(at, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1)).flatMap(entry => {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : files(root, child);
    return entry.isFile() && SOURCE.test(entry.name) ? [child] : [];
  });
}

/** The lines (as `file:line`) that hold a `'not built'` stub under `root`. A file that is not there is skipped. */
export function findNotBuilt(root, list = SHIPPED) {
  const found = [];
  for (const rel of list) {
    for (const file of files(root, rel)) {
      fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => { if (STUB.test(line)) found.push(`${file}:${i + 1}`); });
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = findNotBuilt(root);
  if (found.length > 0) {
    process.stderr.write(`check-not-built: ${found.length} stub${found.length === 1 ? '' : 's'} left. A release does not carry one.\n${found.map(f => `  ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('check-not-built: no stub is left.\n');
}
