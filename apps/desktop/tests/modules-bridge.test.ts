// The fifth bridge, `bowerloomModules`: its table (shared/api/modules.ts), the contract package and the golden file that name the same calls, the preload that exposes it, the client that checks it, the shape
// rules main applies to each argument, and the rules that keep the page pure. The 42 calls of the reader and the engine, the 39 engine calls, the local calls and the runs calls are not touched here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { API_CALLS, API_CHANNELS, refusalCode } from '../shared/api/calls.js';
import { LOCAL_CALLS } from '../shared/api/local.js';
import { RUN_CALLS } from '../shared/api/runs.js';
import { MODULE_ARITY, MODULE_CALLS, MODULE_CHANNELS, MODULE_PATH_LIMIT, MODULE_PICK_REFUSALS, MODULE_REFUSALS } from '../shared/api/modules.js';
import { isModuleId, isPathText, isPlaceId, modulesCode } from '../shared/api/modules-shape.js';
import { ENGINE_CALLS } from '../shared/engine/types.js';
import { REAL_CALLS } from '../shared/real/types.js';
import { createApiClient, modulesCodeOf } from '../renderer/api/client.js';
import { pageTransport } from '../renderer/api/transport.js';
import { DESKTOP } from './support.js';

const ROOT = join(DESKTOP, '..', '..');
const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const noop = (): Promise<never> => new Promise(() => undefined);
const fullModules = (): Record<string, unknown> => Object.fromEntries(MODULE_CALLS.map(call => [call, noop]));

// ---- the table

test('the modules table holds four calls with their argument counts and their own channels in the bowerloom-modules namespace', () => {
  assert.deepEqual([...MODULE_CALLS], ['listModulePlaces', 'approveModulePlace', 'revokeModulePlace', 'readModuleFile']);
  assert.equal(Object.isFrozen(MODULE_CALLS), true);
  assert.deepEqual(MODULE_ARITY, { listModulePlaces: 1, approveModulePlace: 1, revokeModulePlace: 2, readModuleFile: 3 });
  for (const call of MODULE_CALLS) assert.equal(MODULE_CHANNELS[call], `bowerloom-modules:${call}`);
  assert.equal(new Set(Object.values(MODULE_CHANNELS)).size, 4);
  assert.equal(MODULE_PATH_LIMIT, 512);
});

test('the modules calls are not part of the 42 calls of the reader and the engine, nor of the local or runs calls', () => {
  assert.equal(API_CALLS.length, 42); assert.equal(ENGINE_CALLS.length, 39); assert.equal(REAL_CALLS.length, 3); assert.equal(LOCAL_CALLS.length, 2); assert.equal(RUN_CALLS.length, 5);
  for (const call of MODULE_CALLS) {
    for (const list of [API_CALLS, LOCAL_CALLS, RUN_CALLS] as readonly (readonly string[])[]) assert.equal(list.includes(call), false, call);
    assert.equal(Object.values(API_CHANNELS).includes(MODULE_CHANNELS[call]), false, MODULE_CHANNELS[call]);
  }
});

test('the table of the page equals the contract package and its golden file, call for call and code for code', () => {
  const golden = JSON.parse(readFileSync(join(ROOT, 'packages', 'engine-api', 'golden', 'module-calls.json'), 'utf8')) as { moduleCalls: { name: string; arity: number; channel: string }[]; moduleCallRefusals: string[] };
  assert.deepEqual(golden.moduleCalls.map(c => [c.name, c.arity, c.channel]), MODULE_CALLS.map(call => [call, MODULE_ARITY[call], MODULE_CHANNELS[call]]));
  assert.deepEqual(golden.moduleCallRefusals, MODULE_REFUSALS.filter(code => code !== 'FAILED'));
});

test('the frozen engine golden file is not changed by this bridge: still one base file, d4c8a478', () => {
  const names = readdirSync(join(ROOT, 'packages', 'engine-api', 'golden'));
  assert.deepEqual(names.filter(n => /^base-/.test(n)), ['base-d4c8a478.json']);
});

test('a modules refusal code is read on its own side, and any other text is FAILED', () => {
  for (const code of MODULE_REFUSALS) assert.equal(modulesCodeOf(new Error(`Error invoking remote method 'bowerloom-modules:readModuleFile': Error: ${code}`)), code);
  for (const code of ['HOST_NOT_STARTED', 'UNKNOWN_PLACE', 'BUSY', 'NO_HOME', 'UNKNOWN_FOLDER', 'STORE_DAMAGED']) assert.equal(modulesCodeOf(new Error(code)), 'FAILED', code);
  for (const odd of ['whatever', '', null, undefined, 5, {}, new Error('/home/person/secret exploded'), 'xNOT_APPROVEDx']) assert.equal(modulesCodeOf(odd), 'FAILED', String(odd));
  assert.equal(refusalCode(new Error('NOT_APPROVED'), 'modules'), 'NOT_APPROVED');
  assert.equal(modulesCode(new Error('PLACE_CHANGED')), 'PLACE_CHANGED');
  assert.deepEqual([...MODULE_PICK_REFUSALS], ['NOT_A_FOLDER', 'HOME_UNREADABLE', 'NOT_IN_HOME', 'HIDDEN_PART', 'BAD_NAME', 'PATH_TOO_LONG', 'STATE_FOLDER', 'LIBRARY_FOLDER', 'FULL', 'RECORD_BLOCKED', 'RECORD_NOT_MOVED', 'RECORD_RESET_FAILED', 'FAILED']);
});

// ---- the shape of an argument

test('a module id, a place id and a path text have only the shapes main accepts', () => {
  for (const id of ['memory', 'local-models', 'a', '0x', 'a'.repeat(64)]) assert.equal(isModuleId(id), true, id);
  for (const id of ['', 'Memory', '-a', 'a b', 'a/b', '../a', 'a'.repeat(65), 'a\n', 7, null, undefined, {}]) assert.equal(isModuleId(id), false, String(id));
  for (const id of ['place-0123456789ab']) assert.equal(isPlaceId(id), true, id);
  for (const id of ['place-', 'place-0123456789a', 'place-0123456789abc', 'place-0123456789AB', 'Place-0123456789ab', 'place-0123456789ab\n', '../place-0123456789ab', 4, null, undefined]) assert.equal(isPlaceId(id), false, String(id));
  for (const p of ['a.md', 'sub/b.md', '../x', 'x'.repeat(MODULE_PATH_LIMIT)]) assert.equal(isPathText(p), true, p);
  for (const p of ['', 'x'.repeat(MODULE_PATH_LIMIT + 1), 'a\0b', 5, null, undefined, [], {}]) assert.equal(isPathText(p), false, String(p));
});

// ---- the preload

function builtPreload(): { exposed: Map<string, Record<string, unknown>>; sent: [string, unknown[]][]; failWith: (error: Error | null) => void } {
  const script = "import { build } from 'esbuild'; const o = await build({ entryPoints: ['preload/real-preload.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], logLevel: 'silent' }); process.stdout.write(o.outputFiles[0].text);";
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: DESKTOP, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const exposed = new Map<string, Record<string, unknown>>(), sent: [string, unknown[]][] = [];
  let fail: Error | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: Record<string, unknown>) => { exposed.set(name, api); } },
    ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => { sent.push([channel, args]); return fail === null ? Promise.resolve('ok') : Promise.reject(fail); } },
  };
  new Function('require', 'module', 'exports', built.stdout)((id: string) => { assert.equal(id, 'electron'); return electron; }, { exports: {} }, {});
  return { exposed, sent, failWith: error => { fail = error; } };
}

test('the preload exposes bowerloomModules with exactly the modules calls, frozen', () => {
  const { exposed } = builtPreload();
  const modules = exposed.get('bowerloomModules');
  assert.ok(modules !== undefined);
  assert.deepEqual(Object.keys(modules).sort(), [...MODULE_CALLS].sort());
  assert.equal(Object.isFrozen(modules), true);
});

test('each modules call sends exactly its arity of arguments on its own channel, and drops the rest', async () => {
  const { exposed, sent } = builtPreload();
  const modules = exposed.get('bowerloomModules') as Record<string, (...a: unknown[]) => Promise<unknown>>;
  await modules.listModulePlaces!('memory', 'extra');
  await modules.approveModulePlace!('memory', '/Users/someone/Documents', 'extra');
  await modules.revokeModulePlace!('memory', 'place-0123456789ab', 'extra');
  await modules.readModuleFile!('memory', 'place-0123456789ab', 'a.md', 'extra');
  assert.deepEqual(sent, [[MODULE_CHANNELS.listModulePlaces, ['memory']], [MODULE_CHANNELS.approveModulePlace, ['memory']], [MODULE_CHANNELS.revokeModulePlace, ['memory', 'place-0123456789ab']], [MODULE_CHANNELS.readModuleFile, ['memory', 'place-0123456789ab', 'a.md']]]);
});

test('a refusal becomes one short code on the page, and a long message with a path becomes FAILED', async () => {
  const { exposed, failWith } = builtPreload();
  const modules = exposed.get('bowerloomModules') as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const code of MODULE_REFUSALS.filter(c => c !== 'FAILED')) {
    failWith(new Error(`Error invoking remote method 'bowerloom-modules:readModuleFile': Error: ${code}`));
    await assert.rejects(modules.readModuleFile!('memory', 'place-0123456789ab', 'a.md'), (e: Error) => e.message === code, code);
  }
  failWith(new Error('/Users/someone/secret exploded'));
  for (const call of MODULE_CALLS) await assert.rejects(modules[call]!(), (e: Error) => e.message === 'FAILED', call);
});

test('the other four bridges are unchanged by the fifth: their names and their key sets are as before', () => {
  const { exposed } = builtPreload();
  assert.deepEqual([...exposed.keys()].sort(), ['bowerloomEngine', 'bowerloomLocal', 'bowerloomModules', 'bowerloomReal', 'bowerloomRuns']);
  assert.deepEqual(Object.keys(exposed.get('bowerloomReal')!).sort(), [...REAL_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomEngine')!).filter(name => name !== 'mode').sort(), [...ENGINE_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomLocal')!).sort(), [...LOCAL_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomRuns')!).sort(), [...RUN_CALLS].sort());
});

// ---- the client

test('the client gives the modules bridge of a window that has all four calls', () => {
  const modules = fullModules();
  assert.equal(createApiClient({ reader: undefined, engine: undefined, modules }).modules, modules as never);
});

test('the client gives null for no modules bridge, a value that is not an object, or a partial bridge', () => {
  for (const modules of [undefined, null, 5, 'x', true, []]) assert.equal(createApiClient({ reader: undefined, engine: undefined, modules }).modules, null, String(modules));
  assert.equal(createApiClient({ reader: undefined, engine: undefined }).modules, null);
  for (const call of MODULE_CALLS) {
    const missing = fullModules(); delete missing[call];
    assert.equal(createApiClient({ reader: undefined, engine: undefined, modules: missing }).modules, null, `${call} missing`);
    assert.equal(createApiClient({ reader: undefined, engine: undefined, modules: { ...fullModules(), [call]: 'x' } }).modules, null, `${call} not a function`);
  }
});

test('the transport reads bowerloomModules from the window by name, and nothing when there is no window', () => {
  const global = globalThis as unknown as { window?: unknown };
  const before = global.window;
  try {
    delete global.window;
    assert.equal(pageTransport().modules, undefined);
    const modules = fullModules();
    global.window = { bowerloomModules: modules };
    assert.equal(pageTransport().modules, modules);
  } finally {
    if (before === undefined) delete global.window; else global.window = before;
  }
});

// ---- the page stays pure

test('only the transport names bowerloomModules in the page', () => {
  assert.deepEqual(sourcesUnder('renderer').filter(file => /bowerloomModules/.test(strip(read(file)))), ['renderer/api/transport.ts']);
});

test('the shared table of the modules calls imports nothing, so the preload that loads it pulls in no code; the shape rules are a separate file the preload does not load', () => {
  const code = strip(read('shared/api/modules.ts'));
  assert.doesNotMatch(code, /['"`]electron['"`]|['"`]node:[a-z]/);
  assert.equal(code.split('\n').filter(l => /^import /.test(l)).length, 0);
  const shape = strip(read('shared/api/modules-shape.ts'));
  assert.doesNotMatch(shape, /['"`]electron['"`]|['"`]node:[a-z]/);
  assert.doesNotMatch(strip(read('preload/real-preload.ts')), /modules-shape/);
});

test('no call of the bridge takes a path to approve: the table has no argument for a folder', () => {
  assert.equal(MODULE_ARITY.approveModulePlace, 1, 'the module id only; main opens its own chooser');
  assert.doesNotMatch(strip(read('shared/api/modules.ts')), /approveModulePlace\([^)]*,/);
});
