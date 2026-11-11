// The one call layer of the page: the list of the 42 calls (3 reader calls and 39 engine calls), the preload that exposes them, the handlers in main that answer them,
// the refusal codes, and the client in renderer/api that is the only reader of the window globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { API_CALLS, API_CHANNELS, ENGINE_REFUSALS, READER_REFUSALS, refusalCode } from '../shared/api/calls.js';
import type { EngineApi } from '../shared/api/calls.js';
import { REAL_CALLS, REAL_CHANNELS } from '../shared/real/types.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CALL_REFUSALS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import { registerRealIpc } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { createApiClient, engineCodeOf, getApiClient, readerCodeOf } from '../renderer/api/client.js';
import { pageTransport } from '../renderer/api/transport.js';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

// ---- 1. the list

test('API_CALLS holds the 3 reader calls and the 39 engine calls, once each', () => {
  assert.equal(API_CALLS.length, 42);
  assert.equal(new Set(API_CALLS).size, 42, 'no call twice');
  assert.deepEqual(API_CALLS.slice(0, 3), [...REAL_CALLS]);
  assert.deepEqual(API_CALLS.slice(3), [...ENGINE_CALLS]);
  assert.equal(REAL_CALLS.length, 3);
  assert.equal(ENGINE_CALLS.length, 39);
  assert.equal(Object.isFrozen(API_CALLS), true);
});

test('every call has one channel, and the channels are the existing tables', () => {
  assert.deepEqual(Object.keys(API_CHANNELS).sort(), [...API_CALLS].sort());
  assert.equal(new Set(Object.values(API_CHANNELS)).size, 42, 'no channel twice');
  for (const call of REAL_CALLS) assert.equal(API_CHANNELS[call], REAL_CHANNELS[call]);
  for (const call of ENGINE_CALLS) assert.equal(API_CHANNELS[call], ENGINE_CHANNELS[call]);
});

test('EngineApi is the reader calls and the engine calls together', () => {
  const names: (keyof EngineApi)[] = [...API_CALLS];
  assert.equal(names.length, 42);
});

// ---- 2. the preload exposes exactly API_CALLS

test('the preload exposes exactly API_CALLS: no call missing and no extra call', () => {
  const script = "import { build } from 'esbuild'; const o = await build({ entryPoints: ['preload/real-preload.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], logLevel: 'silent' }); process.stdout.write(o.outputFiles[0].text);";
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: DESKTOP, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const exposed = new Map<string, Record<string, unknown>>();
  const electron = { contextBridge: { exposeInMainWorld: (name: string, api: Record<string, unknown>) => { exposed.set(name, api); } }, ipcRenderer: { invoke: () => Promise.resolve(null) } };
  new Function('require', 'module', 'exports', built.stdout)((id: string) => { assert.equal(id, 'electron'); return electron; }, { exports: {} }, {});
  assert.deepEqual([...exposed.keys()].sort(), ['bowerloomEngine', 'bowerloomLocal', 'bowerloomReal']);
  const reader = Object.keys(exposed.get('bowerloomReal')!), engine = Object.keys(exposed.get('bowerloomEngine')!).filter(name => name !== 'mode');
  assert.deepEqual(reader.sort(), [...REAL_CALLS].sort());
  assert.deepEqual(engine.sort(), [...ENGINE_CALLS].sort());
  assert.deepEqual([...reader, ...engine].sort(), [...API_CALLS].sort());
});

// ---- 3. main answers every call

test('main registers a handler on the channel of every call in API_CALLS, and on no other channel', () => {
  const handled: string[] = [];
  const ipc = { handle: (channel: string) => { handled.push(channel); } };
  registerRealIpc({ ipc, appIndexUrl: APP_INDEX, home: '/nonexistent-home', chooseFolder: async () => null });
  registerEngineIpc({ ipc, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom', chooseFolder: async () => null, confirm: async () => false, who: 't' });
  assert.equal(new Set(handled).size, handled.length, 'no channel registered twice');
  for (const call of API_CALLS) assert.ok(handled.includes(API_CHANNELS[call]), `main has no handler for ${call}`);
  assert.deepEqual([...handled].sort(), Object.values(API_CHANNELS).sort(), 'main answers no channel that API_CALLS does not name');
});

// ---- 4. argument counts and refusal codes

test('ENGINE_ARITY still covers all 39 engine calls, each with a count', () => {
  assert.deepEqual(Object.keys(ENGINE_ARITY).sort(), [...ENGINE_CALLS].sort());
  assert.equal(Object.keys(ENGINE_ARITY).length, 39);
  for (const call of ENGINE_CALLS) assert.ok(Number.isInteger(ENGINE_ARITY[call]) && ENGINE_ARITY[call] >= 0, call);
});

test('the refusal code sets are the ones the page knows, and the engine set is the existing table', () => {
  assert.deepEqual([...READER_REFUSALS], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME', 'FAILED']);
  assert.deepEqual([...ENGINE_REFUSALS], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE', 'FAILED']);
  assert.equal(ENGINE_REFUSALS, ENGINE_CALL_REFUSALS, 'one table, not a copy');
});

test('refusalCode maps a message to the short code of its side, and to FAILED for anything else', () => {
  for (const code of READER_REFUSALS) assert.equal(refusalCode(new Error(`Error invoking remote method 'bowerloom-real:x': Error: ${code}`), 'reader'), code);
  for (const code of ENGINE_REFUSALS) assert.equal(refusalCode(new Error(`Error invoking remote method 'bowerloom-engine:x': Error: ${code}`), 'engine'), code);
  // A code of the other side is not a code of this one.
  for (const code of ['UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME']) assert.equal(refusalCode(new Error(code), 'engine'), 'FAILED', code);
  for (const code of ['UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE']) assert.equal(refusalCode(new Error(code), 'reader'), 'FAILED', code);
  for (const side of ['reader', 'engine'] as const) {
    for (const odd of ['whatever', '', null, undefined, 5, {}, new Error('/home/person/secret exploded'), 'xBUSYx', 'NOT_ALLOWEDX', 'busy']) assert.equal(refusalCode(odd, side), 'FAILED', String(odd));
    assert.equal(refusalCode('BAD_ARGUMENT', side), 'BAD_ARGUMENT', 'a plain string counts too');
  }
  // The first code in the text wins, as before.
  assert.equal(refusalCode(new Error('BUSY then NOT_ALLOWED'), 'reader'), 'BUSY');
  assert.equal(refusalCode(new Error('NOT_ALLOWED then BUSY'), 'reader'), 'NOT_ALLOWED');
});

test('the reader side also reads the page\'s own no-bridge word, as the old reader helper did', () => {
  assert.equal(readerCodeOf(new Error('NO_BRIDGE')), 'NO_BRIDGE');
  assert.equal(engineCodeOf(new Error('NO_BRIDGE')), 'FAILED');
  assert.equal(readerCodeOf(new Error("Error invoking remote method 'x': Error: BUSY")), 'BUSY');
  assert.equal(readerCodeOf('whatever'), 'FAILED');
  assert.equal(readerCodeOf(null), 'FAILED');
  assert.equal(engineCodeOf(new Error("Error invoking remote method 'bowerloom-engine:planImport': Error: UNKNOWN_BUNDLE")), 'UNKNOWN_BUNDLE');
  assert.equal(engineCodeOf(new Error('BUSY')), 'FAILED');
});

// ---- 5. static: one reader of the window globals, no electron and no node: module in the renderer

test('only the transport adapter names window.bowerloomReal, window.bowerloomEngine or window.bowerloomLocal', () => {
  const files = sourcesUnder('renderer');
  assert.ok(files.length > 50, `${files.length} files`);
  const naming = files.filter(file => /bowerloomReal|bowerloomEngine|bowerloomLocal/.test(strip(read(file))));
  assert.deepEqual(naming, ['renderer/api/transport.ts']);
  const transport = strip(read('renderer/api/transport.ts'));
  assert.match(transport, /bowerloomReal/); assert.match(transport, /bowerloomEngine/); assert.match(transport, /bowerloomLocal/);
});

test('no renderer file imports electron or a node: module', () => {
  for (const file of sourcesUnder('renderer')) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /(?:from|import|require\()\s*\(?\s*['"`]electron['"`]/, `${file} imports electron`);
    assert.doesNotMatch(code, /['"`]node:[a-z]/, `${file} uses a node: module`);
    assert.doesNotMatch(code, /\brequire\(/, `${file} calls require`);
  }
  for (const file of sourcesUnder('shared/api')) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /['"`]electron['"`]|['"`]node:[a-z]/, file);
  }
});

test('the old seams are gone: no file keeps getBridge, getEngineBridge or the two window readers', () => {
  for (const file of sourcesUnder('renderer')) assert.doesNotMatch(strip(read(file)), /\bgetBridge\b|\bgetEngineBridge\b/, file);
});

// ---- 6. the client

const noop = (): Promise<never> => new Promise(() => undefined);
const fullReader = (): Record<string, unknown> => Object.fromEntries(REAL_CALLS.map(call => [call, noop]));
const fullEngine = (...mode: unknown[]): Record<string, unknown> => ({ mode: mode.length === 0 ? 'real' : mode[0], ...Object.fromEntries(ENGINE_CALLS.map(call => [call, noop])) });

test('the client gives the reader and the engine bridge of a window that has both, in real mode', () => {
  const reader = fullReader(), engine = fullEngine();
  const api = createApiClient({ reader, engine });
  assert.equal(api.reader, reader as never);
  assert.equal(api.engine, engine as never);
});

test('the client gives null for a window with no bridge', () => {
  for (const raw of [{ reader: undefined, engine: undefined }, { reader: null, engine: null }, { reader: 5, engine: 'x' }]) {
    const api = createApiClient(raw);
    assert.equal(api.reader, null); assert.equal(api.engine, null);
  }
});

test('the client gives null for a partial reader bridge, one call missing or not a function', () => {
  for (const call of REAL_CALLS) {
    const missing = fullReader(); delete missing[call];
    assert.equal(createApiClient({ reader: missing, engine: undefined }).reader, null, `${call} missing`);
    assert.equal(createApiClient({ reader: { ...fullReader(), [call]: 'x' }, engine: undefined }).reader, null, `${call} not a function`);
  }
  assert.equal(createApiClient({ reader: {}, engine: undefined }).reader, null);
});

test('the client gives null for a partial engine bridge, any one of the 39 calls missing or not a function', () => {
  for (const call of ENGINE_CALLS) {
    const missing = fullEngine(); delete missing[call];
    assert.equal(createApiClient({ reader: undefined, engine: missing }).engine, null, `${call} missing`);
    assert.equal(createApiClient({ reader: undefined, engine: { ...fullEngine(), [call]: null } }).engine, null, `${call} not a function`);
  }
});

test('the client gives null for an engine bridge whose mode is not real', () => {
  for (const mode of ['sample', '', 'Real', undefined, 5]) assert.equal(createApiClient({ reader: undefined, engine: fullEngine(mode) }).engine, null, String(mode));
  const noMode = fullEngine(); delete noMode.mode;
  assert.equal(createApiClient({ reader: undefined, engine: noMode }).engine, null);
});

test('the reader and the engine side are checked on their own: a good reader with a bad engine keeps the reader', () => {
  const reader = fullReader();
  const api = createApiClient({ reader, engine: fullEngine('sample') });
  assert.equal(api.reader, reader as never); assert.equal(api.engine, null);
  const engine = fullEngine();
  const other = createApiClient({ reader: { discoverPlaces: noop }, engine });
  assert.equal(other.reader, null); assert.equal(other.engine, engine as never);
});

test('the transport reads the two globals of the window by name, and nothing when there is no window', () => {
  const global = globalThis as unknown as { window?: unknown };
  const before = global.window;
  try {
    delete global.window;
    assert.deepEqual(pageTransport(), { reader: undefined, engine: undefined, local: undefined });
    const api = getApiClient();
    assert.equal(api.reader, null); assert.equal(api.engine, null);
    const reader = fullReader(), engine = fullEngine();
    global.window = { bowerloomReal: reader, bowerloomEngine: engine, bowerloom: { other: noop } };
    assert.deepEqual(pageTransport(), { reader, engine, local: undefined });
    const live = getApiClient();
    assert.equal(live.reader, reader as never); assert.equal(live.engine, engine as never);
    global.window = {};
    assert.deepEqual(pageTransport(), { reader: undefined, engine: undefined, local: undefined });
  } finally {
    if (before === undefined) delete global.window; else global.window = before;
  }
});
