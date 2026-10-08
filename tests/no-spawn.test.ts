// `up --team` and `apply` start no process (build plan 01, M6): not `claude`, not `codex`, not anything.
// 1. Static: no module reachable from up.js or apply.js imports node:child_process.
// 2. In process: every child_process entry point is replaced by a spy that records and throws, then the whole
//    up chain and apply run, from a fresh folder to "prepared, workers held". The spy records zero calls.
import { testHome } from './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire, isBuiltin, syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { runUpCommand } from '../apps/cli/src/up.js';
import { runApplyCommand } from '../apps/cli/src/apply.js';
import { runCreateCommand } from '../apps/cli/src/create.js';

const ENTRIES = ['../apps/cli/src/up.js', '../apps/cli/src/apply.js'].map(p => fileURLToPath(new URL(p, import.meta.url)));
const SPAWNERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';

// Static import forms in emitted JavaScript: import/export ... from '...', import '...', import('...'), require('...').
const FORMS = [/\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
/** Every module reachable from `entry`, following relative, package and dynamic imports with literal names. */
function reachable(entry: string): { files: Map<string, string[]>; builtins: Map<string, string[]>; opaque: string[] } {
  const files = new Map<string, string[]>(), builtins = new Map<string, string[]>(), opaque: string[] = [], queue = [entry];
  while (queue.length) {
    const file = queue.pop()!; if (files.has(file)) continue;
    const raw = readFileSync(file, 'utf8'), specs = new Set<string>();
    // Stronger than the import check: the name child_process appears nowhere in a reachable file, comments included.
    if (/child_process/.test(raw)) builtins.set('child_process', [...builtins.get('child_process') ?? [], file]);
    // Imports are read with comments removed, so a JSDoc type such as import('./types') is not taken for one.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const form of FORMS) for (const m of text.matchAll(form)) specs.add(m[1]!);
    // A computed dynamic import could load anything; the check cannot follow it, so it fails the test.
    for (const m of text.matchAll(/\bimport\s*\(\s*([^'"\s)][^)]*)\)/g)) opaque.push(`${file}: import(${m[1]})`);
    files.set(file, [...specs]);
    for (const spec of specs) {
      if (isBuiltin(spec)) { const name = spec.replace(/^node:/, ''); builtins.set(name, [...builtins.get(name) ?? [], file]); continue; }
      const target = (spec.startsWith('.') || spec.startsWith('/')) && existsSync(resolve(dirname(file), spec)) && !statSync(resolve(dirname(file), spec)).isDirectory() ? resolve(dirname(file), spec) : packageFile(spec, file);
      assert.ok(existsSync(target), `${file} imports ${spec}, which does not resolve`); queue.push(target);
    }
  }
  return { files, builtins, opaque };
}
/** A package or a CommonJS relative name (`./core` for `./core.js`), resolved as Node would from `from`. */
function packageFile(spec: string, from: string): string {
  try { return createRequire(from).resolve(spec); } catch { return fileURLToPath(import.meta.resolve(spec)); }
}

test('no module reachable from up.js or apply.js imports node:child_process', () => {
  for (const entry of ENTRIES) {
    const { files, builtins, opaque } = reachable(entry);
    assert.ok(files.size > 20, `${entry} reaches ${files.size} modules`);
    assert.deepEqual(opaque, [], 'a computed dynamic import could load child_process');
    for (const name of ['child_process', 'worker_threads', 'cluster']) assert.equal(builtins.get(name), undefined, `${entry} reaches ${name} through ${builtins.get(name)?.join(', ')}`);
  }
});

/** Every child_process entry point records and throws; the network is denied too. Restored after the test. */
function spies(t: TestContext): { spawned: string[]; network: string[] } {
  const spawned: string[] = [], network: string[] = [];
  const cp = childProcess as unknown as Record<string, unknown>;
  for (const name of SPAWNERS) t.mock.method(cp, name, ((...args: unknown[]) => { spawned.push(`${name} ${String(args[0])}`); throw new Error('TEST_CHILD_PROCESS_DENIED'); }) as never);
  const deny = (name: string) => (...args: unknown[]) => { network.push(`${name} ${String(args[0])}`); throw new Error('TEST_NETWORK_DENIED'); };
  const realLookup = dns.lookup;
  t.mock.method(dns, 'lookup', ((host: string, ...rest: unknown[]) => host === '127.0.0.1' ? (realLookup as (...a: unknown[]) => unknown)(host, ...rest) : deny('dns.lookup')(host)) as never);
  t.mock.method(dnsPromises, 'lookup', deny('dns.promises.lookup') as never);
  for (const [mod, name] of [[https, 'https'], [http, 'http']] as const) { t.mock.method(mod, 'request', deny(`${name}.request`) as never); t.mock.method(mod, 'get', deny(`${name}.get`) as never); }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  // The spy is live for code that imported a named binding as well as for the module object.
  assert.throws(() => childProcess.spawnSync('claude', ['--version']), /TEST_CHILD_PROCESS_DENIED/); spawned.length = 0;
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
