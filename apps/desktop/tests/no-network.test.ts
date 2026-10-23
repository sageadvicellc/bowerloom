// "No process, no network" is shown two ways. (1) The bundled main file is scanned: nothing may start a process, and the only
// modules that can open a connection or listen are the ones listed here, which belong to Bowerloom's own write and fetch code that
// the viewer never calls. (2) The real read path runs in a child process where every such call is denied and logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESKTOP, SAMPLE_DIR } from './support.js';

const NETWORK = /^(net|https?|http2|dns|dns\/promises|tls|dgram)$/;
/** Modules of the bundle that import a network module, with what they import. A new entry here must be argued for. */
const ALLOWED_NETWORK_MODULES: Record<string, string[]> = {
  '../../packages/project-context/src/index.ts': ['net'],
  '../../packages/skill-sources/src/npm.ts': ['dns/promises', 'https', 'net'],
  '../../packages/skill-sources/src/public-address.ts': ['net'],
  '../../packages/skill-sources/src/git.ts': ['dns/promises', 'https', 'net'],
  '../../packages/managed-skills/src/v2-transaction.ts': ['net'],
};

function bundledImports(): { byModule: Map<string, Set<string>>; text: string } {
  const file = join(DESKTOP, 'dist', 'main.mjs');
  assert.ok(existsSync(file), 'run npm run bundle first (npm test builds it)');
  const text = readFileSync(file, 'utf8'), byModule = new Map<string, Set<string>>();
  let current = '(unknown)';
  for (const line of text.split('\n')) {
    const header = /^\/\/ (\S+\.(?:ts|js|mjs))$/.exec(line); if (header) { current = header[1]!; continue; }
    const imp = /^import .*? from "node:([a-z_\/0-9]+)";/.exec(line); if (imp) { if (!byModule.has(current)) byModule.set(current, new Set()); byModule.get(current)!.add(imp[1]!); }
  }
  return { byModule, text };
}

test('the bundled main file never loads child_process, worker_threads, or cluster, and never calls fetch or opens a socket outside the listed modules', () => {
  const { byModule, text } = bundledImports();
  for (const name of ['child_process', 'worker_threads', 'cluster']) assert.doesNotMatch(text, new RegExp(`["']node:${name}["']|require\\(["']${name}["']\\)`), name);
  assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /(?<![.\w])fetch\(|new WebSocket\(|XMLHttpRequest/, 'no fetch or web socket call in the bundle');
  const found: Record<string, string[]> = {};
  for (const [module, imports] of byModule) { const net = [...imports].filter(i => NETWORK.test(i)).sort(); if (net.length) found[module] = net; }
  assert.deepEqual(found, ALLOWED_NETWORK_MODULES, 'a module that can reach the network is new: check that the viewer cannot call it, then list it');
  // Outside the listed modules and the updater, nothing else may import them, in particular not the app's own files.
  for (const module of Object.keys(found)) assert.ok(module.startsWith('../../packages/'), module);
  assert.equal([...text.matchAll(/import\("electron-updater"\)/g)].length, 1, 'the updater is loaded in one place, and only when updates are on');
});

test('reading the sample, as the app does, starts no process and opens no connection or server', t => {
  const log = join(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-log-')), 'hits.log');
  t.after(() => rmSync(join(log, '..'), { recursive: true, force: true }));
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), join(DESKTOP, '.build', 'helpers', 'read-sample.mjs'), SAMPLE_DIR], { encoding: 'utf8', timeout: 120000, env: { ...process.env, DENY_LOG: log } });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /READ 3 projects/);
  assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'nothing was denied, so nothing was tried');
});

test('the denial really denies: a process start, a connection, and a server are caught', t => {
  const log = join(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-log-')), 'hits.log');
  t.after(() => rmSync(join(log, '..'), { recursive: true, force: true }));
  const code = "const cp = require('node:child_process'); const net = require('node:net'); let n = 0; for (const f of [() => cp.spawnSync('ls'), () => net.connect(80, 'localhost'), () => net.createServer().listen(0), () => fetch('http://localhost')]) { try { f(); } catch { n++; } } console.log('CAUGHT ' + n);";
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), '-e', code], { encoding: 'utf8', env: { ...process.env, DENY_LOG: log } });
  assert.match(r.stdout, /CAUGHT 4/); assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 4);
});
