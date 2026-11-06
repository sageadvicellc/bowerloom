// The worker thread of export and import (dist/bundle-worker.mjs) decodes bundles from other people and writes a project, so it gets the scans that dist/main.mjs gets in
// tests/no-network.test.ts, with its own lists. And main.mjs must not hold the work itself: the heavy code is in the worker file only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP, tempDir } from './support.js';

const NETWORK = /^(net|https?|http2|dns|dns\/promises|tls|dgram)$/;
const PROCESS = /^(child_process|worker_threads|cluster)$/;

/** Each module of a bundle with the node modules it imports, from the module headers esbuild writes. */
function importsOf(file: string): { byModule: Map<string, Set<string>>; code: string } {
  assert.ok(existsSync(file), `${file} is missing: run npm run bundle first (npm test builds it)`);
  const text = readFileSync(file, 'utf8'), byModule = new Map<string, Set<string>>();
  let current = '(unknown)';
  for (const line of text.split('\n')) {
    const header = /^\/\/ (\S+\.(?:ts|js|mjs))$/.exec(line); if (header) { current = header[1]!; continue; }
    const imp = /^import (?:.*? from )?"(?:node:)?([a-z_\/0-9]+)";/.exec(line);
    if (imp) { if (!byModule.has(current)) byModule.set(current, new Set()); byModule.get(current)!.add(imp[1]!); }
  }
  return { byModule, code: text.replace(/^\s*\/\/.*$/gm, '') };
}
const pick = (byModule: Map<string, Set<string>>, re: RegExp): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [module, imports] of byModule) { const found = [...imports].filter(i => re.test(i)).sort(); if (found.length) out[module] = found; }
  return out;
};

test('the worker bundle starts no process and links one network module, for the loopback project lock', () => {
  const { byModule, code } = importsOf(join(DESKTOP, 'dist', 'bundle-worker.mjs'));
  // Its own entry reads messages from the main thread (worker_threads). Nothing else starts a process or a thread.
  assert.deepEqual(pick(byModule, PROCESS), { 'main/engine-bundle-worker.ts': ['worker_threads'] });
  // The project lock listens on 127.0.0.1 only, with an exclusive port (packages/project-context/src/index.ts). No other module of the worker links a network module: the
  // save points are imported from the version store itself (main/engine-save.ts), not from the barrel that links the skill installer.
  assert.deepEqual(pick(byModule, NETWORK), { '../../packages/project-context/src/index.ts': ['net'] });
  const lock = readFileSync(join(DESKTOP, '..', '..', 'packages', 'project-context', 'src', 'index.ts'), 'utf8');
  assert.deepEqual([...lock.matchAll(/\.listen\(\{ host: '([^']+)'/g)].map(m => m[1]), ['127.0.0.1', '127.0.0.1']);
  assert.doesNotMatch(code, /(?<![.\w])(?:globalThis|global|self|window)\.fetch\(|(?<![.\w])fetch\(|new WebSocket\(|XMLHttpRequest|new EventSource\(/, 'no fetch, web socket or event source call');
  assert.doesNotMatch(code, /(?:require|import)\(\s*["'](?:node:)?(?:child_process|net|https?|dns|tls|dgram|cluster|worker_threads)["']/, 'no module of that kind is loaded by a call');
});

test('main.mjs holds none of the work of export and import: not the codec, not the held bundles, not the empty harness', () => {
  const { code } = importsOf(join(DESKTOP, 'dist', 'main.mjs'));
  assert.doesNotMatch(code, /function makeEmptyHarness|async function decodeBundle|async function encodeBundle|emptyHarnessHooks|function emptyHarnessFile|function strictParse/);
  const worker = importsOf(join(DESKTOP, 'dist', 'bundle-worker.mjs')).code;
  assert.match(worker, /function makeEmptyHarness/);
  assert.match(worker, /decodeBundle/);
});

test('one export and one import, on the real worker, with every process start and every network call except the loopback of the project lock denied, make no hit', { timeout: 120_000 }, t => {
  const log = join(tempDir(t, 'bowerloom-deny-log-'), 'hits.log');
  const work = tempDir(t, 'bowerloom-deny-work-');
  const runner = join(DESKTOP, '.build', 'helpers', 'share-run.mjs');
  assert.ok(existsSync(runner), 'the runner is built with the tests');
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny-share.mjs'), runner, work], { encoding: 'utf8', timeout: 100_000, env: { PATH: process.env.PATH ?? '', DENY_LOG: log } });
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  const counts = JSON.parse(r.stdout) as { exported: number; imported: number };
  assert.ok(counts.exported > 0 && counts.imported === 3, JSON.stringify(counts));
  assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'no denied call was made');
  // The denial itself works for the worker: a run that tries to reach a host is denied and logged.
  const probe = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny-share.mjs'), '--input-type=module', '-e', "import net from 'node:net'; try { net.connect({ host: '93.184.216.34', port: 80 }); } catch {}"], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DENY_LOG: log } });
  assert.equal(probe.status, 0);
  assert.match(readFileSync(log, 'utf8'), /net\.connect/);
});
