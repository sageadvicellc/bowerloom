// The third bridge, `bowerloomLocal`: its table (shared/api/local.ts), the preload that exposes it, the client that checks it, and the rules that keep the page pure.
// The 42 calls of the reader and the engine and the 39 engine calls with their golden file are not touched here: tests/api-call-layer.test.ts and the engine-api tests hold them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { API_CALLS, API_CHANNELS, refusalCode } from '../shared/api/calls.js';
import { LOCAL_ARITY, LOCAL_CALLS, LOCAL_CHANNELS, LOCAL_REFUSALS } from '../shared/api/local.js';
import { ENGINE_CALLS } from '../shared/engine/types.js';
import { REAL_CALLS } from '../shared/real/types.js';
import { createApiClient, localCodeOf } from '../renderer/api/client.js';
import { pageTransport } from '../renderer/api/transport.js';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const noop = (): Promise<never> => new Promise(() => undefined);
const fullLocal = (): Record<string, unknown> => Object.fromEntries(LOCAL_CALLS.map(call => [call, noop]));

// ---- the table

test('the local table holds two calls, each with no argument and its own channel in the bowerloom-local namespace', () => {
  assert.deepEqual([...LOCAL_CALLS], ['localModels', 'listExtensions']);
  assert.equal(Object.isFrozen(LOCAL_CALLS), true);
  assert.deepEqual(Object.keys(LOCAL_ARITY).sort(), [...LOCAL_CALLS].sort());
  assert.deepEqual(Object.keys(LOCAL_CHANNELS).sort(), [...LOCAL_CALLS].sort());
  for (const call of LOCAL_CALLS) { assert.equal(LOCAL_ARITY[call], 0, call); assert.equal(LOCAL_CHANNELS[call], `bowerloom-local:${call}`); }
  assert.equal(new Set(Object.values(LOCAL_CHANNELS)).size, 2);
  assert.deepEqual([...LOCAL_REFUSALS], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'HOST_NOT_STARTED', 'FAILED']);
});

test('the local calls are not part of the 42 calls of the reader and the engine: that list, its channels and the engine golden stay as they were', () => {
  assert.equal(API_CALLS.length, 42);
  assert.equal(ENGINE_CALLS.length, 39); assert.equal(REAL_CALLS.length, 3);
  for (const call of LOCAL_CALLS) {
    assert.equal((API_CALLS as readonly string[]).includes(call), false, `${call} is not in API_CALLS`);
    assert.equal(Object.values(API_CHANNELS).includes(LOCAL_CHANNELS[call]), false, `${LOCAL_CHANNELS[call]} is not an API channel`);
  }
});

test('a local refusal code is read on its own side: BAD_ARGUMENT, NOT_ALLOWED and HOST_NOT_STARTED are found, the codes of the other sides are not', () => {
  for (const code of LOCAL_REFUSALS) assert.equal(localCodeOf(new Error(`Error invoking remote method 'bowerloom-local:localModels': Error: ${code}`)), code);
  for (const code of ['UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE', 'UNKNOWN_PLACE', 'BUSY', 'NO_HOME', 'TOO_MANY']) assert.equal(localCodeOf(new Error(code)), 'FAILED', code);
  for (const odd of ['whatever', '', null, undefined, 5, {}, new Error('/home/person/secret exploded'), 'xBAD_ARGUMENTx']) assert.equal(localCodeOf(odd), 'FAILED', String(odd));
  assert.equal(refusalCode(new Error('BAD_ARGUMENT'), 'local'), 'BAD_ARGUMENT');
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

test('the preload exposes bowerloomLocal with exactly the local calls, frozen, and no mode word', () => {
  const { exposed } = builtPreload();
  const local = exposed.get('bowerloomLocal');
  assert.ok(local !== undefined);
  assert.deepEqual(Object.keys(local).sort(), [...LOCAL_CALLS].sort());
  assert.equal(Object.isFrozen(local), true);
});

test('each local call sends one message on its own channel with no argument, whatever the page passed, and a refusal becomes a short code', async () => {
  const { exposed, sent, failWith } = builtPreload();
  const local = exposed.get('bowerloomLocal') as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const call of LOCAL_CALLS) await local[call]!('a path the page tried to pass', { host: 'example.com' });
  assert.deepEqual(sent, LOCAL_CALLS.map(call => [LOCAL_CHANNELS[call], []]), 'the page cannot send an argument to main');
  failWith(new Error("Error invoking remote method 'bowerloom-local:localModels': Error: BAD_ARGUMENT"));
  await assert.rejects(local.localModels!(), (e: Error) => e.message === 'BAD_ARGUMENT');
  failWith(new Error("Error invoking remote method 'bowerloom-local:listExtensions': Error: NOT_ALLOWED"));
  await assert.rejects(local.listExtensions!(), (e: Error) => e.message === 'NOT_ALLOWED');
  failWith(new Error("Error invoking remote method 'bowerloom-local:listExtensions': Error: HOST_NOT_STARTED"));
  await assert.rejects(local.listExtensions!(), (e: Error) => e.message === 'HOST_NOT_STARTED');
  failWith(new Error('/Users/someone/secret exploded'));
  for (const call of LOCAL_CALLS) await assert.rejects(local[call]!(), (e: Error) => e.message === 'FAILED', call);
});

test('the reader and engine bridges are unchanged by the third: their names and their key sets are as before', () => {
  const { exposed } = builtPreload();
  assert.deepEqual([...exposed.keys()].sort(), ['bowerloomEngine', 'bowerloomLocal', 'bowerloomReal', 'bowerloomRuns']);
  assert.deepEqual(Object.keys(exposed.get('bowerloomReal')!).sort(), [...REAL_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomEngine')!).filter(name => name !== 'mode').sort(), [...ENGINE_CALLS].sort());
});

// ---- the client

test('the client gives the local bridge of a window that has both calls', () => {
  const local = fullLocal();
  assert.equal(createApiClient({ reader: undefined, engine: undefined, local }).local, local as never);
});

test('the client gives null for a window with no local bridge, an absent one, or a value that is not an object', () => {
  for (const local of [undefined, null, 5, 'x', true, []]) assert.equal(createApiClient({ reader: undefined, engine: undefined, local }).local, null, String(local));
  assert.equal(createApiClient({ reader: undefined, engine: undefined }).local, null, 'a transport that gave no local key');
});

test('the client gives null for a partial local bridge, either call missing or not a function', () => {
  for (const call of LOCAL_CALLS) {
    const missing = fullLocal(); delete missing[call];
    assert.equal(createApiClient({ reader: undefined, engine: undefined, local: missing }).local, null, `${call} missing`);
    assert.equal(createApiClient({ reader: undefined, engine: undefined, local: { ...fullLocal(), [call]: 'x' } }).local, null, `${call} not a function`);
  }
  assert.equal(createApiClient({ reader: undefined, engine: undefined, local: {} }).local, null);
});

test('the three sides are checked on their own: a good local bridge with no reader keeps the local bridge only', () => {
  const local = fullLocal();
  const api = createApiClient({ reader: undefined, engine: undefined, local });
  assert.equal(api.reader, null); assert.equal(api.engine, null); assert.equal(api.local, local as never);
});

test('the transport reads bowerloomLocal from the window by name, and nothing when there is no window', () => {
  const global = globalThis as unknown as { window?: unknown };
  const before = global.window;
  try {
    delete global.window;
    assert.equal(pageTransport().local, undefined);
    const local = fullLocal();
    global.window = { bowerloomLocal: local };
    assert.equal(pageTransport().local, local);
    assert.equal(createApiClient(pageTransport()).local, local as never);
  } finally {
    if (before === undefined) delete global.window; else global.window = before;
  }
});

// ---- the page stays pure

test('only the transport names bowerloomLocal in the page, and no renderer file reaches a network or Node name', () => {
  const files = sourcesUnder('renderer');
  assert.ok(files.length > 50, `${files.length} files`);
  assert.deepEqual(files.filter(file => /bowerloomLocal/.test(strip(read(file)))), ['renderer/api/transport.ts']);
  for (const file of files) assert.doesNotMatch(strip(read(file)), /\bfetch\(|XMLHttpRequest|new WebSocket\(|new EventSource\(|sendBeacon|127\.0\.0\.1|localhost/, `${file} reaches for the network`);
});

test('the page policy still allows no connection: connect-src is none', () => {
  const html = read('renderer/index.html');
  assert.match(html, /connect-src 'none'/);
});

test('the shared table of the local calls imports only types, and no Electron and no Node module', () => {
  const code = strip(read('shared/api/local.ts'));
  assert.doesNotMatch(code, /['"`]electron['"`]|['"`]node:[a-z]/);
  for (const line of code.split('\n').filter(l => /^import /.test(l))) assert.match(line, /^import type /, line);
});
