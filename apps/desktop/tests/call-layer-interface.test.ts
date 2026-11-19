// The call layer as one interface (renderer/api/call-layer.ts): what it holds, that the Electron implementation passes each call through unchanged, that a second
// implementation plugs in without a renderer change, and that nothing outside the Electron implementation reads the old window globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { API_CALLS } from '../shared/api/calls.js';
import type { ApiCall, ReaderCall } from '../shared/api/calls.js';
import { REAL_CALLS } from '../shared/real/types.js';
import type { RealBridge } from '../shared/real/types.js';
import { ENGINE_ARITY, ENGINE_CALLS } from '../shared/engine/types.js';
import type { EngineBridge, EngineCall } from '../shared/engine/types.js';
import { LOCAL_CALLS } from '../shared/api/local.js';
import type { LocalBridge } from '../shared/api/local.js';
import { RUN_ARITY, RUN_CALLS } from '../shared/api/runs.js';
import type { RunsBridge } from '../shared/api/runs.js';
import { MODULE_ARITY, MODULE_CALLS } from '../shared/api/modules.js';
import type { ModulesBridge } from '../shared/api/modules.js';
import type { CallTransport, RawBridges } from '../renderer/api/call-layer.js';
import { createApiClient, getApiClient } from '../renderer/api/client.js';
import type { ApiClient, CallLayer } from '../renderer/api/client.js';
import { electronTransport, pageTransport, resetCallTransport, samplePreviewEngines, useCallTransport } from '../renderer/api/transport.js';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

// ---- 1. the shape, pinned at compile time (the typecheck gate fails if any line here is false)

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false) : false;
type Expect<T extends true> = T;

type _LayerSides = Expect<Same<keyof CallLayer, 'reader' | 'engine' | 'local' | 'runs' | 'modules'>>;
type _Reader = Expect<Same<CallLayer['reader'], RealBridge>>;
type _Engine = Expect<Same<CallLayer['engine'], EngineBridge>>;
type _Local = Expect<Same<CallLayer['local'], LocalBridge>>;
type _Runs = Expect<Same<CallLayer['runs'], RunsBridge>>;
type _Modules = Expect<Same<CallLayer['modules'], ModulesBridge>>;
// The client holds each side or null, and nothing else: the interface and the client cannot drift apart.
type _Client = Expect<Same<ApiClient, { readonly [K in keyof CallLayer]: CallLayer[K] | null }>>;
// Every one of the 42 calls is on the interface, under its name, and only those: the reader calls on `reader`, the engine calls on `engine`.
type _ReaderCalls = Expect<Same<keyof CallLayer['reader'], ReaderCall>>;
type _EngineCalls = Expect<Same<Exclude<keyof CallLayer['engine'], 'mode'>, EngineCall>>;
// Each call keeps its argument list and its result, call by call.
type _Args = Expect<Same<{ [K in EngineCall]: Parameters<CallLayer['engine'][K]> }, { [K in EngineCall]: Parameters<EngineBridge[K]> }>>;
type _Results = Expect<Same<{ [K in EngineCall]: ReturnType<CallLayer['engine'][K]> }, { [K in EngineCall]: ReturnType<EngineBridge[K]> }>>;
type _ReaderArgs = Expect<Same<{ [K in ReaderCall]: Parameters<CallLayer['reader'][K]> }, { [K in ReaderCall]: Parameters<RealBridge[K]> }>>;
type _ReaderResults = Expect<Same<{ [K in ReaderCall]: ReturnType<CallLayer['reader'][K]> }, { [K in ReaderCall]: ReturnType<RealBridge[K]> }>>;
// A few signatures spelled out, so the pin does not rest on the source types alone.
type _ReadSelected = Expect<Same<Parameters<CallLayer['reader']['readSelected']>, [placeIds: readonly string[]]>>;
type _PickFolder = Expect<Same<Parameters<CallLayer['reader']['pickFolder']>, []>>;
type _EveryCallIsAsync = Expect<Same<{ [K in ApiCall]: (K extends ReaderCall ? ReturnType<CallLayer['reader'][K]> : K extends EngineCall ? ReturnType<CallLayer['engine'][K]> : never) extends Promise<unknown> ? true : false }[ApiCall], true>>;
// A transport hands back raw, unchecked bridges and says whether the page is the sample launch.
type _Transport = Expect<Same<ReturnType<CallTransport['bridges']>, RawBridges>>;
type _TransportSample = Expect<Same<ReturnType<CallTransport['samplePreviewEngines']>, boolean>>;
export type Pins = [_LayerSides, _Reader, _Engine, _Local, _Runs, _Modules, _Client, _ReaderCalls, _EngineCalls, _Args, _Results, _ReaderArgs, _ReaderResults, _ReadSelected, _PickFolder, _EveryCallIsAsync, _Transport, _TransportSample];

test('the interface names every one of the 42 calls once, at run time too', () => {
  assert.equal(API_CALLS.length, 42);
  assert.deepEqual([...REAL_CALLS].sort(), ['discoverPlaces', 'pickFolder', 'readSelected']);
  assert.equal(ENGINE_CALLS.length, 39);
  assert.equal(new Set([...REAL_CALLS, ...ENGINE_CALLS]).size, 42);
});

// ---- 2. the Electron implementation passes every call through unchanged

interface Seen { readonly call: string; readonly args: readonly unknown[] }
const everyCall = (side: string, calls: readonly string[], seen: Seen[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...extra,
  ...Object.fromEntries(calls.map(call => [call, (...args: unknown[]) => { seen.push({ call: `${side}.${call}`, args }); return Promise.resolve({ answer: `${side}.${call}`, args }); }])),
});
const argsFor = (count: number): unknown[] => Array.from({ length: count }, (_, i) => ({ marker: i }));
const withWindow = (found: Record<string, unknown> | undefined, body: () => void): void => {
  const global = globalThis as unknown as { window?: unknown };
  const before = global.window;
  try {
    if (found === undefined) delete global.window; else global.window = found;
    body();
  } finally {
    if (before === undefined) delete global.window; else global.window = before;
  }
};

test('the Electron implementation hands the window bridges over as they are: the same objects, nothing wrapped', () => {
  const seen: Seen[] = [];
  const found = { bowerloomReal: everyCall('reader', REAL_CALLS, seen), bowerloomEngine: everyCall('engine', ENGINE_CALLS, seen, { mode: 'real' }), bowerloomLocal: everyCall('local', LOCAL_CALLS, seen), bowerloomRuns: everyCall('runs', RUN_CALLS, seen), bowerloomModules: everyCall('modules', MODULE_CALLS, seen) };
  withWindow(found, () => {
    const raw = electronTransport.bridges();
    assert.equal(raw.reader, found.bowerloomReal); assert.equal(raw.engine, found.bowerloomEngine); assert.equal(raw.local, found.bowerloomLocal); assert.equal(raw.runs, found.bowerloomRuns); assert.equal(raw.modules, found.bowerloomModules);
    const api = getApiClient();
    assert.equal(api.reader, found.bowerloomReal as never); assert.equal(api.engine, found.bowerloomEngine as never); assert.equal(api.local, found.bowerloomLocal as never); assert.equal(api.runs, found.bowerloomRuns as never); assert.equal(api.modules, found.bowerloomModules as never);
  });
});

test('each of the 42 calls through the client reaches the window with the same arguments, and its answer comes back untouched', async () => {
  const seen: Seen[] = [];
  const found = { bowerloomReal: everyCall('reader', REAL_CALLS, seen), bowerloomEngine: everyCall('engine', ENGINE_CALLS, seen, { mode: 'real' }) };
  const arity: Record<string, number> = { discoverPlaces: 0, pickFolder: 0, readSelected: 1, ...ENGINE_ARITY };
  let api: ApiClient | undefined;
  withWindow(found, () => { api = getApiClient(); });
  assert.ok(api?.reader && api.engine);
  const sides: [string, Record<string, (...a: unknown[]) => Promise<unknown>>, readonly string[]][] = [['reader', api.reader as never, REAL_CALLS], ['engine', api.engine as never, ENGINE_CALLS]];
  let count = 0;
  for (const [side, bridge, calls] of sides) {
    for (const call of calls) {
      const args = argsFor(arity[call]!);
      const before = seen.length;
      const answer = await bridge[call]!(...args) as { answer: string; args: unknown[] };
      assert.equal(seen.length, before + 1, `${call} reached the window once`);
      const hit = seen[before]!;
      assert.equal(hit.call, `${side}.${call}`);
      assert.equal(hit.args.length, args.length, `${call} argument count`);
      hit.args.forEach((arg, i) => assert.equal(arg, args[i], `${call} argument ${i} is the same object`));
      assert.equal(answer.answer, `${side}.${call}`);
      count += 1;
    }
  }
  assert.equal(count, 42);
});

test('the other three bridges pass through unchanged too, with their argument counts', async () => {
  const seen: Seen[] = [];
  const found = { bowerloomLocal: everyCall('local', LOCAL_CALLS, seen), bowerloomRuns: everyCall('runs', RUN_CALLS, seen), bowerloomModules: everyCall('modules', MODULE_CALLS, seen) };
  let api: ApiClient | undefined;
  withWindow(found, () => { api = getApiClient(); });
  const sides: [string, Record<string, (...a: unknown[]) => Promise<unknown>> | null | undefined, readonly string[], Record<string, number>][] = [
    ['local', api?.local as never, LOCAL_CALLS, Object.fromEntries(LOCAL_CALLS.map(call => [call, 0]))],
    ['runs', api?.runs as never, RUN_CALLS, RUN_ARITY],
    ['modules', api?.modules as never, MODULE_CALLS, MODULE_ARITY],
  ];
  for (const [side, bridge, calls, arity] of sides) {
    assert.ok(bridge, `${side} bridge is whole`);
    for (const call of calls) {
      const args = argsFor(arity[call]!);
      const before = seen.length;
      await bridge[call]!(...args);
      assert.equal(seen.length, before + 1, `${side}.${call}`);
      seen[before]!.args.forEach((arg, i) => assert.equal(arg, args[i], `${side}.${call} argument ${i}`));
    }
  }
});

test('a refusal from the window comes out of the client as the same error', async () => {
  const boom = new Error('NOT_ALLOWED');
  const reader = { discoverPlaces: () => Promise.reject(boom), pickFolder: () => Promise.reject(boom), readSelected: () => Promise.reject(boom) };
  let api: ApiClient | undefined;
  withWindow({ bowerloomReal: reader }, () => { api = getApiClient(); });
  await assert.rejects(() => api!.reader!.pickFolder(), (error: unknown) => error === boom);
});

// ---- 3. a second implementation plugs in with no renderer change

const stubLayer = (seen: Seen[]): CallLayer => ({
  reader: everyCall('reader', REAL_CALLS, seen) as never,
  engine: everyCall('engine', ENGINE_CALLS, seen, { mode: 'real' }) as never,
  local: everyCall('local', LOCAL_CALLS, seen) as never,
  runs: everyCall('runs', RUN_CALLS, seen) as never,
  modules: everyCall('modules', MODULE_CALLS, seen) as never,
});

test('the Electron implementation is the one in use until another is installed', () => {
  resetCallTransport();
  withWindow(undefined, () => {
    assert.deepEqual(pageTransport(), { reader: undefined, engine: undefined, local: undefined, runs: undefined, modules: undefined });
    assert.equal(getApiClient().reader, null);
  });
});

test('an installed transport feeds the client and the sample switch, with no window at all', async () => {
  const seen: Seen[] = [];
  const layer = stubLayer(seen);
  const second: CallTransport = { id: 'second', bridges: () => ({ reader: layer.reader, engine: layer.engine, local: layer.local, runs: layer.runs, modules: layer.modules }), samplePreviewEngines: () => true };
  try {
    useCallTransport(second);
    withWindow(undefined, () => {
      assert.equal(samplePreviewEngines(), true);
      const api = getApiClient();
      assert.equal(api.reader, layer.reader); assert.equal(api.engine, layer.engine); assert.equal(api.local, layer.local); assert.equal(api.runs, layer.runs); assert.equal(api.modules, layer.modules);
    });
    await getApiClient().reader!.pickFolder();
    assert.deepEqual(seen.map(s => s.call), ['reader.pickFolder']);
  } finally {
    resetCallTransport();
  }
  withWindow(undefined, () => assert.equal(getApiClient().reader, null, 'reset puts the Electron implementation back'));
});

test('the client still checks what a second transport hands it: a partial bridge is null', () => {
  const layer = stubLayer([]);
  const partial = { ...(layer.reader as unknown as Record<string, unknown>) }; delete partial.pickFolder;
  assert.equal(createApiClient({ reader: partial, engine: layer.engine }).reader, null);
});

// ---- 4. the old globals are read by the Electron implementation alone

const BRIDGE_WORDS = /bowerloom(?:Real|Engine|Local|Runs|Modules)/;

test('no renderer file but the Electron implementation names a window bridge global', () => {
  const naming = sourcesUnder('renderer').filter(file => BRIDGE_WORDS.test(strip(read(file))));
  assert.deepEqual(naming, ['renderer/api/transport.ts']);
});

test('the interface file is neutral: no bridge global, no window, no electron, no node: module', () => {
  const code = strip(read('renderer/api/call-layer.ts'));
  assert.doesNotMatch(code, BRIDGE_WORDS);
  assert.doesNotMatch(code, /\bwindow\b|\bglobalThis\b|\bdocument\b/);
  assert.doesNotMatch(code, /['"`]electron['"`]|['"`]node:[a-z]/);
});

test('only the client reads a transport, and only the Electron implementation reads the window', () => {
  const importers = sourcesUnder('renderer').filter(file => /api\/transport(?:\.js)?['"]|\.\/transport(?:\.js)?['"]/.test(strip(read(file))));
  assert.deepEqual(importers, ['renderer/api/client.ts']);
  const readsWindow = sourcesUnder('renderer').filter(file => /\bwindow\b\s*(?:as\b|\.|\[)|\bglobalThis\s*(?:as\b|\.|\[)/.test(strip(read(file))) && /bowerloom/.test(strip(read(file))));
  assert.deepEqual(readsWindow, ['renderer/api/transport.ts']);
});

test('a direct use of an old global outside the Electron implementation would be caught', () => {
  for (const bad of ["export const a = (window as never as { bowerloomReal: unknown }).bowerloomReal;", "export const b = globalThis['bowerloomEngine'];", 'export const { bowerloomRuns } = window as never;']) assert.match(bad, BRIDGE_WORDS);
});
