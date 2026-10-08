// `up --team` and `apply` start no process (build plan 01, M6): not `claude`, not `codex`, not anything.
// 1. Static: no module reachable from up.js or apply.js loads child_process, worker_threads or cluster, and none holds a
//    load the walk cannot follow (support/module-walk.ts: a syntax tree, Node's own resolution, review M6 finding 2).
// 2. In process: every way to start a process or a thread is replaced by a spy that records and throws, then the whole
//    up chain and apply run, from a fresh folder to "prepared, workers held". The spy records zero calls.
// 3. The real binary: main.js runs the up chain to exit 4 under a preload that denies and logs every spawn and network
//    call (support/deny-spawn.ts), with `claude` and `codex` shims on PATH. Nothing is logged and no shim runs.
import { testHome } from './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import cluster from 'node:cluster';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import workerThreads from 'node:worker_threads';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { runUpCommand } from '../apps/cli/src/up.js';
import { runApplyCommand } from '../apps/cli/src/apply.js';
import { runCreateCommand } from '../apps/cli/src/create.js';
import type { Walk } from './support/module-walk.js';

const ENTRIES = ['../apps/cli/src/up.js', '../apps/cli/src/apply.js'].map(p => fileURLToPath(new URL(p, import.meta.url)));
const MAIN = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const WALKER = fileURLToPath(new URL('./support/module-walk.js', import.meta.url));
const DENY = pathToFileURL(fileURLToPath(new URL('./support/deny-spawn.js', import.meta.url))).href;
const SPAWNERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';
const realSpawnSync = childProcess.spawnSync;

/** Runs the walker in a child with the flag that gives import.meta.resolve its parent argument. */
function walk(entries: readonly string[]): Walk {
  const r = realSpawnSync(process.execPath, ['--experimental-import-meta-resolve', '--no-warnings', WALKER, ...entries], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout) as Walk;
}

test('no module reachable from up.js or apply.js loads child_process, worker_threads or cluster, or a load the walk cannot follow', () => {
  for (const entry of ENTRIES) {
    const { files, builtins, opaque, mentions } = walk([entry]);
    assert.ok(files.length > 150, `${entry} reaches ${files.length} modules`);
    assert.deepEqual(opaque, [], 'a computed load or a native entry point could start a process');
    for (const name of ['child_process', 'worker_threads', 'cluster']) {
      assert.equal(builtins[name], undefined, `${entry} loads ${name} through ${builtins[name]?.join(', ')}`);
      assert.equal(mentions[name], undefined, `${entry} reaches a file that names ${name}: ${mentions[name]?.join(', ')}`);
    }
  }
});

test('the walk sees through strings and comments, flags every load it cannot follow, and resolves as Node does', t => {
  const dir = mkdtempSync(join(testHome, 'walk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
  put('package.json', '{"type":"module"}');
  // The old comment stripper took the first string for the start of a comment and removed this import.
  put('strings.mjs', "const open = '/*';\nimport './hidden.mjs';\nconst close = '*/';\nexport { open, close };\n");
  put('hidden.mjs', "import { spawn } from 'node:child_process';\nexport { spawn };\n");
  put('comments.mjs', "/* import('./missing.js') */\n// require('./absent.cjs')\nexport const quiet = 1;\n");
  put('computed.cjs', "const name = 'child' + '_process';\nmodule.exports = require(name);\n");
  put('dynamic.mjs', "const name = './x.mjs';\nexport const later = () => import(name);\n");
  put('native.mjs', "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);\nexport const a = () => process.binding('spawn_sync');\nexport const b = () => process['dlopen'];\nexport const c = () => process.execve;\n");
  put('threads.mjs', "import { Worker } from 'node:worker_threads';\nimport cluster from 'node:cluster';\nexport { Worker, cluster };\n");
  put('node_modules/dual/package.json', '{"name":"dual","exports":{"import":"./esm.mjs","require":"./cjs.cjs"}}');
  put('node_modules/dual/esm.mjs', 'export const kind = "esm";\n');
  put('node_modules/dual/cjs.cjs', 'module.exports = { kind: "cjs" };\n');
  put('uses-dual.mjs', "import { kind } from 'dual';\nexport { kind };\n");
  put('uses-dual.cjs', "module.exports = require('dual');\n");
  put('index.mjs', ['strings', 'comments', 'dynamic', 'native', 'threads', 'uses-dual'].map(n => `import './${n}.mjs';`).join('\n') + "\nimport './computed.cjs';\nimport './uses-dual.cjs';\n");
  const w = walk([join(dir, 'index.mjs')]), rel = (f: string) => f.slice(dir.length + 1);
  assert.ok(w.files.map(rel).includes('hidden.mjs'), 'an import between two strings is seen');
  assert.deepEqual(w.builtins.child_process?.map(rel), ['hidden.mjs']);
  assert.deepEqual(w.builtins.worker_threads?.map(rel), ['threads.mjs']); assert.deepEqual(w.builtins.cluster?.map(rel), ['threads.mjs']);
  assert.deepEqual(w.mentions.worker_threads?.map(rel), ['threads.mjs']); assert.deepEqual(w.mentions.cluster?.map(rel), ['threads.mjs']);
  assert.ok(w.files.map(rel).includes('node_modules/dual/esm.mjs'), 'an import resolves with the import condition');
  assert.ok(w.files.map(rel).includes('node_modules/dual/cjs.cjs'), 'a require resolves with the require condition');
  const flagged = new Set(w.opaque.map(o => `${rel(o.split(': ')[0]!)}: ${o.split(': ')[1]}`));
  for (const expected of ['computed.cjs: computed require()', 'dynamic.mjs: computed import()', 'native.mjs: createRequire', 'native.mjs: process.binding', 'native.mjs: process.dlopen', 'native.mjs: process.execve']) assert.ok(flagged.has(expected), expected);
  assert.ok(![...flagged].some(f => f.startsWith('comments.mjs')), 'a comment is not a load');
});

/**
 * Every child_process entry point, ChildProcess.prototype.spawn, process.execve, worker_threads.Worker and cluster.fork
 * record and throw; the network is denied too. Restored after the test.
 */
function spies(t: TestContext): { spawned: string[]; network: string[] } {
  const spawned: string[] = [], network: string[] = [];
  const cp = childProcess as unknown as Record<string, unknown>;
  const refuse = (name: string) => (...args: unknown[]) => { spawned.push(`${name} ${String(args[0])}`); throw new Error('TEST_CHILD_PROCESS_DENIED'); };
  for (const name of SPAWNERS) t.mock.method(cp, name, refuse(name) as never);
  type Spawnable = { spawn(options: unknown): unknown };
  t.mock.method(childProcess.ChildProcess.prototype as unknown as Spawnable, 'spawn', refuse('ChildProcess.prototype.spawn') as never);
  t.mock.method(process, 'execve', refuse('process.execve') as never);
  t.mock.method(cluster, 'fork', refuse('cluster.fork') as never);
  const RealWorker = workerThreads.Worker;
  (workerThreads as { Worker: unknown }).Worker = class DeniedWorker { constructor(file: unknown) { refuse('worker_threads.Worker')(file); } };
  t.after(() => { (workerThreads as { Worker: unknown }).Worker = RealWorker; syncBuiltinESMExports(); });
  const deny = (name: string) => (...args: unknown[]) => { network.push(`${name} ${String(args[0])}`); throw new Error('TEST_NETWORK_DENIED'); };
  const realLookup = dns.lookup;
  t.mock.method(dns, 'lookup', ((host: string, ...rest: unknown[]) => host === '127.0.0.1' ? (realLookup as (...a: unknown[]) => unknown)(host, ...rest) : deny('dns.lookup')(host)) as never);
  t.mock.method(dnsPromises, 'lookup', deny('dns.promises.lookup') as never);
  for (const [mod, name] of [[https, 'https'], [http, 'http']] as const) { t.mock.method(mod, 'request', deny(`${name}.request`) as never); t.mock.method(mod, 'get', deny(`${name}.get`) as never); }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  // The spy is live for code that imported a named binding as well as for the module object.
  assert.throws(() => childProcess.spawnSync('claude', ['--version']), /TEST_CHILD_PROCESS_DENIED/);
  assert.throws(() => (new childProcess.ChildProcess() as unknown as Spawnable).spawn({ file: 'codex', args: ['codex'] }), /TEST_CHILD_PROCESS_DENIED/);
  assert.throws(() => process.execve!('/usr/bin/true'), /TEST_CHILD_PROCESS_DENIED/);
  assert.throws(() => new workerThreads.Worker('data:text/javascript,0', { eval: false }), /TEST_CHILD_PROCESS_DENIED/);
  assert.throws(() => cluster.fork(), /TEST_CHILD_PROCESS_DENIED/);
  assert.equal(spawned.length, 5); spawned.length = 0;
  return { spawned, network };
}
const quietIo = { interactive: false, ask: async (): Promise<string> => { throw new Error('TEST_NO_TERMINAL'); } };
const revisionIn = (text: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(text); assert.ok(m, text); return m[1]!; };

test('the up chain and apply run in process with zero child_process calls', async t => {
  const { spawned, network } = spies(t);
  const base = mkdtempSync(join(testHome, 'no-spawn-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, 'studio'); mkdirSync(dir);
  const env = { XDG_STATE_HOME: join(base, 'state') }, up = ['up', '--team', 'Studio crew', '--goal', GOAL];
  let out = ''; const write = (text: string) => { out += text; };
  const step = async (args: string[]) => { out = ''; return runUpCommand(args, dir, testHome, write, quietIo, env); };
  const held = async (args: string[]) => {
    out = ''; await assert.rejects(runUpCommand(args, dir, testHome, write, quietIo, env), (e: { code?: string }) => e.code === 'WORKERS_HELD');
    assert.match(out, /^prepared, workers held$/m);
  };
  assert.equal(await step(up), 3); assert.match(out, /^Next step: init\./m);
  await held([...up, '--approve', revisionIn(out)]);
  for (const args of [['prompt', 'create', 'weekly-update'], ['skill', 'create', 'house-style']]) {
    out = ''; assert.equal(await runCreateCommand(args, dir, testHome, write, quietIo), 3);
    const revision = revisionIn(out);
    out = ''; assert.equal(await runCreateCommand([...args, '--approve', revision], dir, testHome, write, quietIo), 0);
  }
  assert.equal(await step(up), 3); assert.match(out, /^Next step: sync\./m);
  assert.equal(await step([...up, '--approve', revisionIn(out)]), 3); assert.match(out, /^Next step: apply\./m);
  await held([...up, '--approve', revisionIn(out)]);
  assert.ok(existsSync(join(dir, '.claude/commands/weekly-update.md')));
  out = ''; assert.equal(await runApplyCommand(['apply'], dir, testHome, write, quietIo, env), 0); assert.match(out, /Nothing to change\./);
  out = ''; assert.equal(await runApplyCommand(['apply', '--harness', 'claude', '--json'], dir, testHome, write, quietIo, env), 0);
  assert.deepEqual(spawned, []); assert.deepEqual(network, []);
});

test('the real main.js runs the up chain to exit 4 with no spawn, thread or network call, and no claude or codex shim runs', t => {
  const base = mkdtempSync(join(testHome, 'no-spawn-main-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), dir = join(home, 'studio'), shims = join(base, 'shims'), sent = join(base, 'sent'), log = join(base, 'deny.log');
  for (const d of [dir, shims, sent]) mkdirSync(d, { recursive: true });
  writeFileSync(log, '');
  for (const name of ['claude', 'codex']) { writeFileSync(join(shims, name), `#!/bin/sh\ntouch '${join(sent, name)}'\n`); chmodSync(join(shims, name), 0o755); }
  writeFileSync(join(dir, 'AGENTS.md'), 'Synthetic agent rules.\n'); writeFileSync(join(dir, 'CLAUDE.md'), 'Synthetic memory.\n');
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state'), PATH: `${shims}:${process.env.PATH ?? ''}`, DENY_SPAWN_LOG: log };
  const run = (args: string[]) => { const r = realSpawnSync(process.execPath, ['--import', DENY, MAIN, ...args], { cwd: dir, encoding: 'utf8', timeout: 120000, env }); assert.equal(r.error, undefined); return r; };
  const revision = (stdout: string) => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
  const up = ['up', '--team', 'Studio crew', '--goal', GOAL];
  const first = run(up); assert.equal(first.status, 3, first.stderr); assert.match(first.stdout, /^Next step: init\./m);
  const init = run([...up, '--approve', revision(first.stdout)]); assert.equal(init.status, 4, init.stderr); assert.match(init.stdout, /^prepared, workers held$/m);
  for (const args of [['prompt', 'create', 'weekly-update'], ['skill', 'create', 'house-style']]) {
    const planned = run([...args, '--json']); assert.equal(planned.status, 3, planned.stderr);
    assert.equal(run([...args, '--approve', JSON.parse(planned.stdout).revision]).status, 0);
  }
  const sync = run(up); assert.equal(sync.status, 3, sync.stderr); assert.match(sync.stdout, /^Next step: sync\./m);
  const apply = run([...up, '--approve', revision(sync.stdout)]); assert.equal(apply.status, 3, apply.stderr); assert.match(apply.stdout, /^Next step: apply\./m);
  const held = run([...up, '--approve', revision(apply.stdout)]); assert.equal(held.status, 4, held.stderr); assert.match(held.stdout, /^prepared, workers held$/m);
  assert.ok(existsSync(join(dir, '.claude/commands/weekly-update.md')));
  assert.equal(readFileSync(log, 'utf8'), '', 'no spawn, thread or network call was attempted');
  assert.deepEqual(readdirSync(sent), [], 'no claude or codex shim ran');
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'Synthetic agent rules.\n'); assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), 'Synthetic memory.\n');
});

test('the deny-spawn preload is live: a spawn, a thread and a network call under it are logged and refused', t => {
  const base = mkdtempSync(join(testHome, 'deny-live-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const log = join(base, 'deny.log'); writeFileSync(log, '');
  const probe = "import cp from 'node:child_process'; import wt from 'node:worker_threads'; import { spawnSync } from 'node:child_process';"
    + "for (const f of [() => spawnSync('true'), () => cp.execFileSync('true'), () => new wt.Worker('x'), () => process.execve('/usr/bin/true'), () => fetch('https://example.invalid/')]) { try { await f(); } catch {} }";
  const r = realSpawnSync(process.execPath, ['--import', DENY, '--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 60000, env: { ...process.env, DENY_SPAWN_LOG: log } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => l.split(' ')[0]), ['child_process.spawnSync', 'child_process.execFileSync', 'worker_threads.Worker', 'process.execve', 'fetch']);
});
