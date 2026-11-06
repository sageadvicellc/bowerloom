import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { imports } from '../pack.mjs';

// The root manifest ships through a `files` allow-list. This test reads what `npm pack` would put in the tarball, without
// writing one, and checks that nothing but the installed CLI is in it and that everything the CLI loads is.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
// Measured at 4.4 MB unpacked for 390 files; the ceiling leaves room for growth and stays far below the 98 MB that the
// unfiltered pack produced.
const MAX_UNPACKED_BYTES = 6 * 1024 * 1024;
const MAX_FILES = 700;
const FORBIDDEN = /(?:^|\/)(?:node_modules|tests?|fixtures|e2e|\.claude|\.bowerloom|\.impeccable|\.github|\.git|tools|experiments|examples|kits|ops|skills)(?:\/|$)|\.map$|\.d\.ts$|\.tsbuildinfo$|\.env|\.ts$|\.test\.[a-z]+$/;

function packList() {
  const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout)[0];
}

test('the root manifest declares a files allow-list', () => {
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
});

test('the tarball holds only what the installed CLI needs', () => {
  assert.ok(existsSync(join(repo, 'dist/apps/cli/src/main.js')), 'run npm run build first');
  const packed = packList();
  const paths = packed.files.map(file => file.path);
  const bad = paths.filter(path => FORBIDDEN.test(path));
  assert.deepEqual(paths.filter(path => /^(?:connections|apps|tools|tests|examples|experiments|kits|ops|skills)\//.test(path)), []);
  assert.deepEqual(bad, []);
  assert.deepEqual(paths.filter(path => path.startsWith('dist/apps/') && !/^dist\/apps\/(cli|mcp)\/src\/[a-z0-9-]+\.js$/.test(path)), []);
  assert.deepEqual(paths.filter(path => path.startsWith('dist/packages/') && !/^dist\/packages\/[a-z0-9-]+\/src\/.+\.js$/.test(path)), []);
  assert.ok(paths.includes('package.json') && paths.includes('README.md') && paths.includes('LICENSE'));
  assert.ok(packed.unpackedSize < MAX_UNPACKED_BYTES, `unpacked size ${packed.unpackedSize}`);
  assert.ok(packed.entryCount < MAX_FILES, `file count ${packed.entryCount}`);
});

test('every bin target and every file it loads is in the tarball', () => {
  const have = new Set(packList().files.map(file => file.path));
  const targets = Object.values(manifest.bin);
  assert.ok(targets.length > 0);
  const seen = new Set();
  const queue = [...targets];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    assert.ok(have.has(path), `missing from the tarball: ${path}`);
    for (const spec of imports(readFileSync(join(repo, path), 'utf8'), path)) {
      if (spec.startsWith('.')) queue.push(posix.normalize(posix.join(posix.dirname(path), spec)));
    }
  }
  // Files that compiled code reads by a path from the package root.
  for (const path of ['release/beta.json', 'packages/linux-browser/assets/runner.cjs', 'packages/linux-browser/assets/seccomp.json', 'packages/linux-browser/assets/runtime-manifest.json', 'packages/linux-browser/assets/craft-shop-contract.md']) {
    assert.ok(have.has(path), `missing from the tarball: ${path}`);
  }
  assert.ok(seen.size > 50);
});
