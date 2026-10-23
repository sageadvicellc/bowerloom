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

const BARE = '(?:node:)?';
const WORKERS = /^(child_process|worker_threads|cluster)$/;
function bundledImports(): { byModule: Map<string, Set<string>>; text: string; code: string } {
  const file = join(DESKTOP, 'dist', 'main.mjs');
  assert.ok(existsSync(file), 'run npm run bundle first (npm test builds it)');
  const text = readFileSync(file, 'utf8'), byModule = new Map<string, Set<string>>();
  let current = '(unknown)';
  for (const line of text.split('\n')) {
    const header = /^\/\/ (\S+\.(?:ts|js|mjs))$/.exec(line); if (header) { current = header[1]!; continue; }
    // `import x from "node:net"`, `import { y } from "net"`, and `import "net"`: with or without the node: prefix.
    const imp = new RegExp(`^import (?:.*? from )?"${BARE}([a-z_\\/0-9]+)";`).exec(line); if (imp) { if (!byModule.has(current)) byModule.set(current, new Set()); byModule.get(current)!.add(imp[1]!); }
  }
  return { byModule, text, code: text.replace(/^\s*\/\/.*$/gm, '') };
}

test('the bundled main file never loads child_process, worker_threads, or cluster in any form, never calls fetch or opens a socket outside the listed modules', () => {
  const { byModule, code } = bundledImports();
  // Every way to load a module: import ... from, bare import, require(), and import(): with or without the node: prefix.
  const loads = [...code.matchAll(new RegExp(`(?:from|import|require)\\s*\\(?\\s*["']${BARE}([a-z_\\/0-9]+)["']`, 'g'))].map(m => m[1]!);
  assert.ok(loads.length > 50, 'the scan sees the imports');
  assert.deepEqual(loads.filter(name => WORKERS.test(name)), [], 'no process or thread is started from the bundle');
  assert.doesNotMatch(code, /(?<![.\w])(?:globalThis|global|self|window)\.fetch\(|(?<![.\w])fetch\(|new WebSocket\(|XMLHttpRequest|new EventSource\(/, 'no fetch, web socket or event source call');
  // A network module loaded in any form other than a plain top-level import (a require() or import() call) is never expected.
  const calls = [...code.matchAll(new RegExp(`(?:require|import)\\(\\s*["']${BARE}([a-z_\\/0-9]+)["']`, 'g'))].map(m => m[1]!).filter(name => NETWORK.test(name) || WORKERS.test(name));
  assert.deepEqual(calls, [], 'no network or process module is loaded by a call');
  const found: Record<string, string[]> = {};
  for (const [module, imports] of byModule) { const net = [...imports].filter(i => NETWORK.test(i)).sort(); if (net.length) found[module] = net; }
  assert.deepEqual(found, ALLOWED_NETWORK_MODULES, 'a module that can reach the network is new: check that the viewer cannot call it, then list it');
  for (const module of Object.keys(found)) assert.ok(module.startsWith('../../packages/'), module);
  assert.equal([...code.matchAll(/import\("electron-updater"\)/g)].length, 1, 'the updater is loaded in one place, and only when updates are on');
});

test('the scan itself sees every way of loading: bare names, require(), import(), and fetch', () => {
  const sample = ['import net from "net";', 'import { request } from "node:https";', 'import "http2";', 'const x = require("child_process");', 'const y = await import("node:dgram");', 'globalThis.fetch("x");', 'const z = fetch("y");'].join('\n');
  const loads = [...sample.matchAll(new RegExp(`(?:from|import|require)\\s*\\(?\\s*["']${BARE}([a-z_\\/0-9]+)["']`, 'g'))].map(m => m[1]);
  assert.deepEqual(loads, ['net', 'https', 'http2', 'child_process', 'dgram']);
  assert.match(sample, /(?<![.\w])(?:globalThis|global|self|window)\.fetch\(/); assert.match(sample.split('\n')[6]!, /(?<![.\w])fetch\(/);
});

for (const mode of ['sample', 'real'] as const) {
  test(`reading the ${mode} data, as the app does, starts no process and opens no connection or server`, t => {
    const log = join(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-log-')), 'hits.log');
    t.after(() => rmSync(join(log, '..'), { recursive: true, force: true }));
    const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), join(DESKTOP, '.build', 'helpers', 'read-sample.mjs'), SAMPLE_DIR, mode], { encoding: 'utf8', timeout: 120000, env: { ...process.env, DENY_LOG: log } });
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, new RegExp(`READ 3 projects \\(${mode}\\)`));
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'nothing was denied, so nothing was tried');
  });
}

test('the denial really denies: a process start, a connection, a server, a lookup, and a fetch are caught, by require', t => {
  const log = join(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-log-')), 'hits.log');
  t.after(() => rmSync(join(log, '..'), { recursive: true, force: true }));
  const code = "const cp = require('node:child_process'); const net = require('node:net'); const dns = require('node:dns'); let n = 0; for (const f of [() => cp.spawnSync('ls'), () => net.connect(80, 'localhost'), () => net.createServer().listen(0), () => fetch('http://localhost'), () => dns.promises.lookup('localhost'), () => require('node:dgram').createSocket('udp4'), () => require('node:http2').connect('http://localhost')]) { try { f(); } catch { n++; } } console.log('CAUGHT ' + n);";
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), '-e', code], { encoding: 'utf8', env: { ...process.env, DENY_LOG: log } });
  assert.match(r.stdout, /CAUGHT 7/); assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 7);
});

test('the denial also catches a NAMED import, which a patch of the default object alone would miss', t => {
  const log = join(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-log-')), 'hits.log');
  t.after(() => rmSync(join(log, '..'), { recursive: true, force: true }));
  const code = [
    "import { spawn, execFileSync } from 'node:child_process';", "import { request } from 'node:https';", "import { get } from 'node:http';", "import { connect, createServer } from 'node:net';",
    "import { lookup } from 'node:dns';", "import { promises } from 'node:dns';", "import { createSocket } from 'node:dgram';", "import { connect as h2 } from 'node:http2';",
    "let n = 0; for (const f of [() => spawn('ls'), () => execFileSync('ls'), () => request('https://x'), () => get('http://x'), () => connect(80), () => createServer(), () => lookup('x', () => {}), () => promises.lookup('x'), () => createSocket('udp4'), () => h2('http://x')]) { try { f(); } catch { n++; } }",
    "console.log('CAUGHT ' + n);"].join('\n');
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), '--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, DENY_LOG: log } });
  assert.match(r.stdout, /CAUGHT 10/, r.stderr); assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 10);
  // Without the sync step the named imports would be the real ones: the harness itself proves the sync is what catches them.
  assert.match(readFileSync(join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), 'utf8'), /syncBuiltinESMExports\(\);\s*$/);
});
