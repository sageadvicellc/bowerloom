// "No process, no network" is shown two ways. (1) The bundled main file is scanned: nothing may start a process, and the only
// modules that can open a connection or listen are the ones listed here, which belong to Bowerloom's own write and fetch code that
// the viewer never calls. (2) The real read path runs in a child process where every such call is denied and logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP, tempDir } from './support.js';

const NETWORK = /^(net|https?|http2|dns|dns\/promises|tls|dgram)$/;
/** Modules of the bundle that import a network module, with what they import. A new entry here must be argued for. */
const ALLOWED_NETWORK_MODULES: Record<string, string[]> = {
  '../../packages/project-context/src/index.ts': ['net'],
  '../../packages/skill-sources/src/npm.ts': ['dns/promises', 'https', 'net'],
  '../../packages/skill-sources/src/public-address.ts': ['net'],
  '../../packages/skill-sources/src/git.ts': ['dns/promises', 'https', 'net'],
  '../../packages/managed-skills/src/v2-transaction.ts': ['net'],
};

/**
 * Modules of the bundle that may start a process, with what they import. Two:
 *  - the problem report asks each engine for its version (`claude --version`), with execFile and no shell, a 3 second limit, and a minimal environment
 *    (packages/diagnostics/src/report.ts);
 *  - the notes source runs git (spec 6.9: every notes folder is a git repository, and Bowerloom starts one with a preview): one module, git found by fixed
 *    path only, five fixed argument forms, no shell, a minimal environment with no HOME and no git config, a timeout and an output cap, and only after
 *    main's own dialog or for the Notes panel's read of the last commit time (packages/notes-source/src/git.ts).
 * Nothing else of the bundle starts a process.
 */
const ALLOWED_PROCESS_MODULES: Record<string, string[]> = { '../../packages/diagnostics/src/report.ts': ['child_process'], '../../packages/notes-source/src/git.ts': ['child_process'] };

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
  assert.equal(loads.filter(name => WORKERS.test(name)).length, Object.values(ALLOWED_PROCESS_MODULES).flat().length, 'only the listed module loads a process module');
  const starters: Record<string, string[]> = {};
  for (const [module, imports] of byModule) { const found = [...imports].filter(i => WORKERS.test(i)).sort(); if (found.length) starters[module] = found; }
  assert.deepEqual(starters, ALLOWED_PROCESS_MODULES, 'a module that can start a process is new: argue for it, then list it');
  const probe = readFileSync(join(DESKTOP, '..', '..', 'packages', 'diagnostics', 'src', 'report.ts'), 'utf8');
  assert.match(probe, /import \{ execFile \} from 'node:child_process';/, 'the report uses execFile only');
  assert.doesNotMatch(probe.replace(/\/\/.*$/gm, ''), /(?<![.\w])(spawn|exec|fork|execSync|spawnSync)\s*\(/, 'never a shell');
  // The notes git runner: one spawn, with no shell, of the git it found by fixed path. Nothing else in it starts a process.
  const git = readFileSync(join(DESKTOP, '..', '..', 'packages', 'notes-source', 'src', 'git.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.match(git, /import \{ spawn \} from 'node:child_process';/, 'the notes runner imports spawn only');
  assert.equal([...git.matchAll(/(?<![.\w])spawn\s*\(/g)].length, 1, 'one place starts git');
  assert.match(git, /spawn\(file, \[\.\.\.argv\], \{ cwd, env, shell: false,/, 'git runs with no shell');
  assert.doesNotMatch(git, /(?<![.\w])(exec|execFile|fork|execSync|spawnSync|execFileSync)\s*\(/, 'nothing else starts a process');
  assert.doesNotMatch(code, /(?<![.\w])(?:globalThis|global|self|window)\.fetch\(|(?<![.\w])fetch\(|new WebSocket\(|XMLHttpRequest|new EventSource\(/, 'no fetch, web socket or event source call');
  // A network module loaded in any form other than a plain top-level import (a require() or import() call) is never expected.
  const calls = [...code.matchAll(new RegExp(`(?:require|import)\\(\\s*["']${BARE}([a-z_\\/0-9]+)["']`, 'g'))].map(m => m[1]!).filter(name => NETWORK.test(name) || WORKERS.test(name));
  assert.deepEqual(calls, [], 'no network or process module is loaded by a call');
  const found: Record<string, string[]> = {};
  for (const [module, imports] of byModule) { const net = [...imports].filter(i => NETWORK.test(i)).sort(); if (net.length) found[module] = net; }
  assert.deepEqual(found, ALLOWED_NETWORK_MODULES, 'a module that can reach the network is new: check that the viewer cannot call it, then list it');
  for (const module of Object.keys(found)) assert.ok(module.startsWith('../../packages/'), module);
  assert.equal([...code.matchAll(/electron-updater/g)].length, 0, 'the app loads no updater: updates are not part of this build');
});

test('the scan itself sees every way of loading: bare names, require(), import(), and fetch', () => {
  const sample = ['import net from "net";', 'import { request } from "node:https";', 'import "http2";', 'const x = require("child_process");', 'const y = await import("node:dgram");', 'globalThis.fetch("x");', 'const z = fetch("y");'].join('\n');
  const loads = [...sample.matchAll(new RegExp(`(?:from|import|require)\\s*\\(?\\s*["']${BARE}([a-z_\\/0-9]+)["']`, 'g'))].map(m => m[1]);
  assert.deepEqual(loads, ['net', 'https', 'http2', 'child_process', 'dgram']);
  assert.match(sample, /(?<![.\w])(?:globalThis|global|self|window)\.fetch\(/); assert.match(sample.split('\n')[6]!, /(?<![.\w])fetch\(/);
});

test('the denial really denies: a process start, a connection, a server, a lookup, and a fetch are caught, by require', t => {
  const log = join(tempDir(t, 'bowerloom-deny-log-'), 'hits.log');
  const code = "const cp = require('node:child_process'); const net = require('node:net'); const dns = require('node:dns'); let n = 0; for (const f of [() => cp.spawnSync('ls'), () => net.connect(80, 'localhost'), () => net.createServer().listen(0), () => fetch('http://localhost'), () => dns.promises.lookup('localhost'), () => require('node:dgram').createSocket('udp4'), () => require('node:http2').connect('http://localhost')]) { try { f(); } catch { n++; } } console.log('CAUGHT ' + n);";
  const r = spawnSync(process.execPath, ['--import', join(DESKTOP, 'tests', 'helpers', 'deny.mjs'), '-e', code], { encoding: 'utf8', env: { ...process.env, DENY_LOG: log } });
  assert.match(r.stdout, /CAUGHT 7/); assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 7);
});

test('the denial also catches a NAMED import, which a patch of the default object alone would miss', t => {
  const log = join(tempDir(t, 'bowerloom-deny-log-'), 'hits.log');
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
