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
import { electronTransport, pageTransport, samplePreviewEngines, useCallTransport } from '../renderer/api/transport.js';
import * as transportModule from '../renderer/api/transport.js';
import { resetCallTransport } from './helpers-engine/transport-reset.js';
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

const SIDES: readonly { readonly side: keyof CallLayer; readonly global: string; readonly calls: readonly string[] }[] = [
  { side: 'reader', global: 'bowerloomReal', calls: REAL_CALLS },
  { side: 'engine', global: 'bowerloomEngine', calls: ENGINE_CALLS },
  { side: 'local', global: 'bowerloomLocal', calls: LOCAL_CALLS },
  { side: 'runs', global: 'bowerloomRuns', calls: RUN_CALLS },
  { side: 'modules', global: 'bowerloomModules', calls: MODULE_CALLS },
];
const sideOf = (calls: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...extra, ...Object.fromEntries(calls.map(call => [call, () => Promise.resolve(null)])) });

test('a refusal from the window comes out of the client as the same error, for every call of every side', async () => {
  const boom = new Error('NOT_ALLOWED');
  const rejecting = (calls: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...extra, ...Object.fromEntries(calls.map(call => [call, () => Promise.reject(boom)])) });
  const found = Object.fromEntries(SIDES.map(s => [s.global, rejecting(s.calls, s.side === 'engine' ? { mode: 'real' } : {})]));
  let api: ApiClient | undefined;
  withWindow(found, () => { api = getApiClient(); });
  for (const { side, calls } of SIDES) {
    const bridge = api![side] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>> | null;
    assert.ok(bridge, `${side} is whole`);
    for (const call of calls) await assert.rejects(() => bridge[call]!(), (error: unknown) => error === boom, `${side}.${call}`);
  }
});

// ---- 2b. a side that is present but not whole is null, and it is told

const captureErrors = (body: () => void): string[] => {
  const lines: string[] = [], original = console.error;
  console.error = (...args: unknown[]): void => { lines.push(args.map(String).join(' ')); };
  try { body(); } finally { console.error = original; }
  return lines;
};
const rawWith = (replace: Partial<Record<keyof CallLayer, unknown>>): RawBridges => {
  const whole = Object.fromEntries(SIDES.map(s => [s.side, sideOf(s.calls, s.side === 'engine' ? { mode: 'real' } : {})]));
  return { ...whole, ...replace } as RawBridges;
};

test('every side: one call missing or not a function gives null, and the console names the transport, the side and the call', () => {
  for (const { side, calls } of SIDES) {
    for (const call of calls) {
      const missing = sideOf(calls, side === 'engine' ? { mode: 'real' } : {}); delete missing[call];
      const lines = captureErrors(() => { assert.equal(createApiClient(rawWith({ [side]: missing }), 'second')[side], null, `${side}.${call} missing`); });
      assert.equal(lines.length, 1, `${side}.${call}: one line`);
      assert.match(lines[0]!, /second/); assert.match(lines[0]!, new RegExp(`\\b${side}\\b`)); assert.match(lines[0]!, new RegExp(`\\b${call}\\b`));
      const wrongType = { ...sideOf(calls, side === 'engine' ? { mode: 'real' } : {}), [call]: 'x' };
      captureErrors(() => assert.equal(createApiClient(rawWith({ [side]: wrongType }), 'second')[side], null, `${side}.${call} not a function`));
    }
  }
});

test('every side: a value that is not an object gives null and is told', () => {
  for (const { side } of SIDES) {
    for (const odd of [null, 5, 'x', true]) {
      const lines = captureErrors(() => { assert.equal(createApiClient(rawWith({ [side]: odd }), 'second')[side], null); });
      assert.equal(lines.length, 1, `${side} ${String(odd)}`);
    }
  }
});

test('the engine side with a mode other than real gives null and the console names the mode', () => {
  for (const mode of ['sample', '', 'Real', undefined, 5]) {
    const lines = captureErrors(() => { assert.equal(createApiClient(rawWith({ engine: sideOf(ENGINE_CALLS, { mode }) }), 'second').engine, null, String(mode)); });
    assert.equal(lines.length, 1, String(mode));
    assert.match(lines[0]!, /\bmode\b/); assert.match(lines[0]!, /second/); assert.match(lines[0]!, /engine/);
  }
});

test('a side that is undefined is quiet, and a whole window is quiet', () => {
  assert.deepEqual(captureErrors(() => { createApiClient({ reader: undefined, engine: undefined }, 'second'); }), []);
  assert.deepEqual(captureErrors(() => { createApiClient({ reader: undefined, engine: undefined, local: undefined, runs: undefined, modules: undefined }, 'second'); }), []);
  assert.deepEqual(captureErrors(() => { const api = createApiClient(rawWith({}), 'second'); for (const { side } of SIDES) assert.ok(api[side], side); }), []);
});

test('the good sides stay when one side is bad', () => {
  const bad = sideOf(RUN_CALLS); delete bad.listRuns;
  captureErrors(() => {
    const api = createApiClient(rawWith({ runs: bad }), 'second');
    assert.equal(api.runs, null); assert.ok(api.reader && api.engine && api.local && api.modules);
  });
});

// ---- 2c. the engine signatures, spelled out by hand (independent of the source types)

type EngineCalls = CallLayer['engine'];
type _PlanImportShape = Expect<Same<ReturnType<EngineCalls['planImport']> extends Promise<unknown> ? true : false, true>>;
type _PlanImportHead = Expect<Same<Parameters<EngineCalls['planImport']> extends [folderId: string, bundleId: string, choices: unknown] ? true : false, true>>;
type _EngineHasNoExtraCall = Expect<Same<Exclude<keyof EngineCalls, 'mode'> extends EngineCall ? true : false, true>>;
type _EngineMode = Expect<Same<EngineCalls['mode'], 'sample' | 'real'>>;
type _DiscoverPlaces = Expect<Same<Parameters<CallLayer['reader']['discoverPlaces']>, []>>;
export type SpelledPins = [_PlanImportShape, _PlanImportHead, _EngineHasNoExtraCall, _EngineMode, _DiscoverPlaces];

test('the engine calls take the argument counts the table records, through the interface', async () => {
  const seen: Seen[] = [];
  const found = { bowerloomEngine: everyCall('engine', ENGINE_CALLS, seen, { mode: 'real' }) };
  let api: ApiClient | undefined;
  withWindow(found, () => { api = getApiClient(); });
  const engine = api!.engine as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const call of ENGINE_CALLS) {
    const before = seen.length;
    await engine[call]!(...argsFor(ENGINE_ARITY[call]));
    assert.equal(seen[before]!.args.length, ENGINE_ARITY[call], call);
  }
  // Spelled out by hand: planImport takes a folder id, a bundle id and the note choices.
  assert.equal(ENGINE_ARITY.planImport, 3);
  assert.equal(ENGINE_CALLS.includes('planImport'), true);
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

const secondOf = (layer: CallLayer, sample = true): CallTransport => ({ id: 'second', bridges: () => ({ reader: layer.reader, engine: layer.engine, local: layer.local, runs: layer.runs, modules: layer.modules }), samplePreviewEngines: () => sample });

test('an installed transport feeds the client and the sample switch, with no window at all', async () => {
  const seen: Seen[] = [];
  const layer = stubLayer(seen);
  resetCallTransport();
  try {
    useCallTransport(secondOf(layer));
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
  withWindow(undefined, () => assert.equal(getApiClient().reader, null, 'a reset puts the Electron implementation back'));
});

test('the client still checks what a second transport hands it: a partial bridge is null, and the console names the transport', () => {
  const layer = stubLayer([]);
  const partial = { ...(layer.reader as unknown as Record<string, unknown>) }; delete partial.pickFolder;
  resetCallTransport();
  try {
    useCallTransport({ id: 'second', bridges: () => ({ reader: partial, engine: layer.engine }), samplePreviewEngines: () => false });
    const lines = captureErrors(() => { assert.equal(getApiClient().reader, null); });
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /second/); assert.match(lines[0]!, /pickFolder/);
  } finally {
    resetCallTransport();
  }
});

// ---- 3b. the seal

test('a second install throws', () => {
  resetCallTransport();
  try {
    const layer = stubLayer([]);
    useCallTransport(secondOf(layer));
    assert.throws(() => useCallTransport(secondOf(layer)), /ALREADY_INSTALLED/);
  } finally {
    resetCallTransport();
  }
});

test('an install after the first read of the bridges throws, and so does one after the first read of the sample switch', () => {
  const layer = stubLayer([]);
  resetCallTransport();
  try {
    withWindow(undefined, () => { pageTransport(); });
    assert.throws(() => useCallTransport(secondOf(layer)), /IN_USE/);
    resetCallTransport();
    withWindow({}, () => { try { samplePreviewEngines(); } catch { /* no document in this process: the read still counts */ } });
    assert.throws(() => useCallTransport(secondOf(layer)), /IN_USE/);
  } finally {
    resetCallTransport();
  }
});

test('the installed transport is a frozen copy: changing the original afterwards changes nothing', () => {
  const layer = stubLayer([]);
  const original: { id: string; bridges: () => RawBridges; samplePreviewEngines: () => boolean } = { id: 'second', bridges: () => ({ reader: layer.reader, engine: layer.engine }), samplePreviewEngines: () => true };
  resetCallTransport();
  try {
    useCallTransport(original);
    original.samplePreviewEngines = () => false;
    original.bridges = () => ({ reader: undefined, engine: undefined });
    assert.equal(samplePreviewEngines(), true);
    assert.equal(pageTransport().reader, layer.reader);
  } finally {
    resetCallTransport();
  }
});

test('the production transport module exports no reset, and the stored transport is frozen', () => {
  assert.deepEqual(Object.keys(transportModule).sort(), ['activeTransportId', 'electronTransport', 'pageTransport', 'samplePreviewEngines', 'useCallTransport']);
  assert.equal(Object.isFrozen(electronTransport), true);
});

test('no renderer file calls useCallTransport: the future shell bootstrap is the only allowed caller', () => {
  const calling = sourcesUnder('renderer').filter(file => /\buseCallTransport\s*\(/.test(strip(read(file))));
  assert.deepEqual(calling, ['renderer/api/transport.ts'], 'only the definition');
  const importing = sourcesUnder('renderer').filter(file => /\buseCallTransport\b/.test(strip(read(file))) && file !== 'renderer/api/transport.ts');
  assert.deepEqual(importing, []);
  const stateUsers = sourcesUnder('renderer').filter(file => /transport-state/.test(strip(read(file))));
  assert.deepEqual(stateUsers, ['renderer/api/transport.ts']);
});

test('the sample switch is quiet when there is no document', () => {
  const global = globalThis as unknown as { document?: unknown };
  const before = global.document;
  resetCallTransport();
  try {
    delete global.document;
    assert.equal(electronTransport.samplePreviewEngines(), false);
    global.document = {};
    assert.equal(electronTransport.samplePreviewEngines(), false, 'no body');
    global.document = { body: { getAttribute: () => '1' } };
    assert.equal(electronTransport.samplePreviewEngines(), true);
  } finally {
    if (before === undefined) delete global.document; else global.document = before;
    resetCallTransport();
  }
});

// ---- 4. the old globals are read by the Electron implementation alone

const BRIDGE_WORDS = /bowerloom(?:Real|Engine|Local|Runs|Modules)/;
/** The scan the checks below use: the names of the old globals, comments removed. */
const namesOldGlobal = (source: string): boolean => BRIDGE_WORDS.test(strip(source));
/** A window or globalThis cast or index, which is how a page reads a global by name. */
const readsGlobalByName = (source: string): boolean => /\b(?:window|globalThis)\s*\)?\s*(?:as\b|\[)|\bglobalThis\b/.test(strip(source));

test('the scanner flags a synthetic bad source, and passes a clean one', () => {
  const bad = [
    'export const a = (window as never as { bowerloomReal: unknown }).bowerloomReal;',
    "export const b = globalThis['bowerloomEngine'];",
    'export const { bowerloomRuns } = window as never;',
    'export const c = (window as unknown as Record<string, unknown>).bowerloomLocal;',
    "export const d = (window as never)['bowerloomModules'];",
  ];
  for (const source of bad) assert.equal(namesOldGlobal(source), true, source);
  for (const source of ['export const a = (window as never)[\'x\'];', 'export const globalName = globalThis;']) assert.equal(readsGlobalByName(source), true, source);
  for (const clean of ['export const a = 1; // bowerloomReal is read by the transport', '/** bowerloomEngine */ export const b = window.innerWidth;']) {
    assert.equal(namesOldGlobal(clean), false, clean);
    assert.equal(readsGlobalByName(clean), false, clean);
  }
});

test('no renderer file but the Electron implementation names a window bridge global', () => {
  const naming = sourcesUnder('renderer').filter(file => namesOldGlobal(read(file)));
  assert.deepEqual(naming, ['renderer/api/transport.ts']);
});

test('no renderer file but the Electron implementation reads window or globalThis by name', () => {
  const reading = sourcesUnder('renderer').filter(file => readsGlobalByName(read(file)));
  assert.deepEqual(reading, ['renderer/api/transport.ts']);
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

