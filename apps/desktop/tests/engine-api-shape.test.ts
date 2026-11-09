// The shape suite (tests/helpers-engine/engine-api-shape.ts) run on the sample engine, and the proof that the suite and the no-port spy can fail.
// A second implementation joins by calling defineShapeSuite with its own factory.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { ENGINE_API_CALLS } from '../../../packages/engine-api/src/index.js';
import type { CallSpec } from '../../../packages/engine-api/src/index.js';
import { SAMPLE_FOLDERS, SAMPLE_NOTES, createSampleEngine } from '../shared/engine/sample.js';
import type { EngineBridge } from '../shared/engine/types.js';
import { ENGINE_ARITY, ENGINE_CHANNELS } from '../shared/engine/types.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { REAL_BASE } from '../shared/harness/route.js';
import {
  answerProblems, bridgeProblems, declaredCountProblems, defineShapeSuite, goodArguments, isStrict, parameterTestName, returnProblems, settle, settledProblems, successProblems,
} from './helpers-engine/engine-api-shape.js';
import { NAMED_IMPORT_ROUTES, SPIED_LABELS, installPortSpy, namedBindings } from './helpers-engine/no-port-spy.js';

const IDS = { folder: SAMPLE_FOLDERS.defined, notes: SAMPLE_NOTES.use };

// The sample ignores the arguments it does not use and declares fewer parameters than the contract (`recordCheck: () => ...`), so it takes the loose count on purpose.
// A real implementation leaves the option out and is held to the exact count.
defineShapeSuite({ label: 'the sample engine', make: () => createSampleEngine(), ids: IDS, declaresEveryParameter: false });

// ---- the suite can fail: negative self-tests

const spec = (name: string): CallSpec => ENGINE_API_CALLS.find(c => c.name === name)!;

test('the answer check rejects what is not an Answer', () => {
  assert.deepEqual(answerProblems({ ok: true, value: 1 }), []);
  assert.deepEqual(answerProblems({ ok: false, refusal: { code: 'SAVE_STALE', message: 'words', paths: [] } }), []);
  for (const bad of [null, undefined, 3, 'x', [], {}, { ok: 'yes' }, { ok: true }, { ok: false }, { ok: false, refusal: null },
    { ok: false, refusal: { code: 'lower', message: 'm', paths: [] } }, { ok: false, refusal: { code: 'SAVE_STALE', message: '', paths: [] } },
    { ok: false, refusal: { code: 'SAVE_STALE', message: 'm', paths: 'x' } }, { ok: false, refusal: { code: 'SAVE_STALE', message: 'm', paths: [1] } }, { ok: false, refusal: { message: 'm', paths: [] } }]) {
    assert.notDeepEqual(answerProblems(bad), [], JSON.stringify(bad));
  }
});

test('the return check holds each kind to its own shape', () => {
  assert.deepEqual(returnProblems('answer-or-null', null), []);
  assert.notDeepEqual(returnProblems('answer', null), []);
  assert.deepEqual(returnProblems('list', []), []);
  assert.notDeepEqual(returnProblems('list', {}), []);
  assert.deepEqual(returnProblems('boolean', false), []);
  assert.notDeepEqual(returnProblems('boolean', 'yes'), []);
  assert.deepEqual(returnProblems('saved-scan', { status: 'none' }), []);
  assert.notDeepEqual(returnProblems('saved-scan', { state: 'none' }), []);
  assert.deepEqual(returnProblems('saved-scan-check', 'same'), []);
  assert.notDeepEqual(returnProblems('saved-scan-check', ''), []);
  assert.notDeepEqual(returnProblems('nonsense' as never, 1), []);
});

test('a call that throws a code outside the contract, or answers the wrong shape, is a problem', () => {
  assert.deepEqual(settledProblems(spec('planSave'), { code: 'BAD_ARGUMENT' }), []);
  assert.notDeepEqual(settledProblems(spec('planSave'), { code: 'EXPLODED' }), []);
  assert.notDeepEqual(settledProblems(spec('planSave'), { value: 'text' }), []);
  assert.notDeepEqual(settledProblems(spec('discardBundle'), { value: { ok: true, value: true } }), []);
});

test('the declared parameter count may be lower than the contract for a loose bridge, never higher, and must match for a strict one', () => {
  assert.deepEqual(declaredCountProblems(spec('planSave'), 2, true), []);
  assert.deepEqual(declaredCountProblems(spec('planSave'), 0, false), []);
  assert.notDeepEqual(declaredCountProblems(spec('planSave'), 0, true), []);
  assert.notDeepEqual(declaredCountProblems(spec('planSave'), 3, false), []);
  assert.notDeepEqual(declaredCountProblems(spec('planSave'), 3, true), []);
  assert.deepEqual(declaredCountProblems(spec('chooseFolder'), 0, true), []);
  assert.deepEqual(declaredCountProblems(spec('chooseFolder'), 1, true), []);
  assert.notDeepEqual(declaredCountProblems(spec('chooseFolder'), 2, true), []);
});

test('the suite counts every parameter unless the subject says otherwise, and names the loose test for what it checks', () => {
  assert.equal(isStrict({}), true);
  assert.equal(isStrict({ declaresEveryParameter: true }), true);
  assert.equal(isStrict({ declaresEveryParameter: false }), false);
  assert.equal(parameterTestName(spec('planSave'), true), 'planSave declares 2 parameters');
  assert.equal(parameterTestName(spec('folders'), true), 'folders declares 0 parameters');
  assert.equal(parameterTestName(spec('listVersions'), true), 'listVersions declares 1 parameter');
  assert.equal(parameterTestName(spec('chooseFolder'), true), 'chooseFolder declares 0 to 1 parameters');
  assert.equal(parameterTestName(spec('planSave'), false), 'planSave takes at most 2 arguments');
  assert.equal(parameterTestName(spec('listVersions'), false), 'listVersions takes at most 1 argument');
  assert.equal(parameterTestName(spec('chooseFolder'), false), 'chooseFolder takes at most 1 argument');
});

test('a bridge that is missing a call, or throws a stray error, is caught by settle', async () => {
  const bridge = { mode: 'sample', folders: async () => { throw new Error('boom'); }, planSave: () => { throw new Error('UNKNOWN_FOLDER'); } } as never;
  assert.deepEqual(await settle(bridge, 'folders', []), { code: 'boom' });
  assert.deepEqual(await settle(bridge, 'planSave', ['x', []]), { code: 'UNKNOWN_FOLDER' });
  const out = await settle(bridge, 'runSave', []);
  assert.ok('code' in out, 'a missing call is a thrown error, never a value');
});

// ---- the bridge is found by call name, so a class works as well as an object

/** A class-based bridge: every call is a method of the prototype, so `Object.entries` of an instance would find none of them. */
function classBridge(inner: EngineBridge, leave: readonly string[] = [], add: readonly string[] = []): EngineBridge {
  class Impl {
    readonly mode: 'sample' | 'real' = 'sample';
  }
  const methods = ENGINE_API_CALLS.map(c => c.name).filter(name => !leave.includes(name)).concat(add);
  for (const name of methods) {
    Object.defineProperty(Impl.prototype, name, { value(this: Impl, ...a: unknown[]) { return (inner as unknown as Record<string, (...x: unknown[]) => unknown>)[name]?.(...a); }, writable: true, configurable: true });
  }
  return new Impl() as unknown as EngineBridge;
}

test('a class-based bridge with every call passes the bridge check, and a missing, extra or mode-less one does not', () => {
  assert.deepEqual(Object.entries(classBridge(createSampleEngine())).filter(([, v]) => typeof v === 'function'), [], 'the instance holds no call of its own');
  assert.deepEqual(bridgeProblems(classBridge(createSampleEngine())), []);
  assert.deepEqual(bridgeProblems(createSampleEngine()), []);
  assert.match(bridgeProblems(classBridge(createSampleEngine(), ['runSave'])).join('\n'), /runSave/);
  assert.match(bridgeProblems(classBridge(createSampleEngine(), [], ['extraCall'])).join('\n'), /extraCall/);
  assert.notDeepEqual(bridgeProblems({ ...createSampleEngine(), mode: 'other' } as never), []);
});

test('a class-based bridge is called with its own this, and the success check finds its calls by name', async () => {
  const bridge = classBridge(createSampleEngine());
  const outcome = await settle(bridge, 'listVersions', goodArguments(IDS)['listVersions']!);
  assert.ok('value' in outcome);
  assert.deepEqual(await successProblems(bridge, IDS), []);
});

// ---- the success path

/** A bridge whose every call fails as the contract allows: a thrown call refusal. It is shaped like the contract and does nothing. */
function failingBridge(how: 'throws' | 'refuses'): EngineBridge {
  const calls: Record<string, unknown> = { mode: 'sample' };
  for (const c of ENGINE_API_CALLS) {
    calls[c.name] = how === 'throws' ? async () => { throw new Error('FAILED'); } : async () => (c.returns === 'answer' || c.returns === 'answer-or-null'
      ? { ok: false, refusal: { code: 'FAILED', message: 'It failed.', paths: [] } } : c.returns === 'list' ? [] : c.returns === 'boolean' ? false : c.returns === 'saved-scan' ? { status: 'none' } : 'same');
  }
  return calls as unknown as EngineBridge;
}

test('the sample succeeds at least once in every family of calls', async () => {
  assert.deepEqual(await successProblems(createSampleEngine(), IDS), []);
});

test('an engine whose calls all throw, or all refuse, fails the success check in every family', async () => {
  for (const how of ['throws', 'refuses'] as const) {
    const problems = await successProblems(failingBridge(how), IDS);
    assert.equal(problems.length, 4, `${how}: ${problems.join(' | ')}`);
    for (const family of ['plan', 'read', 'save', 'export']) assert.match(problems.join('\n'), new RegExp(`the ${family} calls`), how);
  }
});

test('an engine that succeeds in three families and fails in one is told which', async () => {
  const sample = createSampleEngine() as unknown as Record<string, unknown>;
  const noExport = { ...sample, planExport: async () => { throw new Error('FAILED'); } } as unknown as EngineBridge;
  const problems = await successProblems(noExport, IDS);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /the export calls/);
});

// ---- the wire holds the argument count

type Handler = (event: { senderFrame: { url: string; parent: unknown } | null }, ...args: unknown[]) => unknown;
const page = { senderFrame: { url: `${APP_INDEX}${REAL_BASE}`, parent: null } };

function wire(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerEngineIpc({
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener as Handler); } }, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom',
    chooseFolder: async () => null, confirm: async () => false, who: 't',
  });
  return handlers;
}
async function reason(handlers: Map<string, Handler>, name: string, ...args: unknown[]): Promise<string> {
  try { await handlers.get(spec(name).channel)!(page, ...args); return 'answered'; } catch (e) { return (e as Error).message; }
}

test('the wire registers one handler per call of the contract, on the channel of the contract', () => {
  const handlers = wire();
  assert.deepEqual([...handlers.keys()].sort(), ENGINE_API_CALLS.map(c => c.channel).sort());
  for (const c of ENGINE_API_CALLS) assert.equal(c.arity, ENGINE_ARITY[c.name as keyof typeof ENGINE_ARITY]);
  for (const c of ENGINE_API_CALLS) assert.equal(c.channel, ENGINE_CHANNELS[c.name as keyof typeof ENGINE_CHANNELS]);
});

test('the wire refuses one argument too many and one too few with BAD_ARGUMENT, for every call', async () => {
  const handlers = wire();
  const args = goodArguments(IDS);
  for (const c of ENGINE_API_CALLS) {
    const tooMany = [...args[c.name]!, ...new Array(c.optionalArgs + 1).fill('x')];
    assert.equal(tooMany.length, c.arity + c.optionalArgs + 1);
    assert.equal(await reason(handlers, c.name, ...tooMany), 'BAD_ARGUMENT', `${c.name}: too many`);
    if (c.arity > 0) assert.equal(await reason(handlers, c.name, ...args[c.name]!.slice(0, -1)), 'BAD_ARGUMENT', `${c.name}: too few`);
  }
});

test('the wire takes the one extra argument of chooseFolder, and no other call takes one', async () => {
  const handlers = wire();
  assert.notEqual(await reason(handlers, 'chooseFolder'), 'BAD_ARGUMENT');
  assert.equal(await reason(handlers, 'chooseFolder', 'Projects/demo'), 'answered');
  assert.equal(await reason(handlers, 'chooseFolder', 'Projects/demo', 'two'), 'BAD_ARGUMENT');
  assert.deepEqual(ENGINE_API_CALLS.filter(c => c.optionalArgs > 0).map(c => c.name), ['chooseFolder']);
  for (const name of ['savedScan', 'checkSavedScan']) {
    assert.equal(await reason(handlers, name), 'answered', `${name} takes none`);
    assert.equal(await reason(handlers, name, 'x'), 'BAD_ARGUMENT', `${name} takes none`);
  }
});

// ---- the spy can fail

/** Calls a method of a prototype with an empty object as `this`, so the wrapper of the spy fires and no handle is ever made. */
const onPrototype = (proto: object, key: string, ...args: unknown[]): unknown => (proto as Record<string, (...a: unknown[]) => unknown>)[key]!.call({}, ...args);

/** One way to reach a port, for every label the spy wraps. Written out by hand, so a wrapper added to the spy with no test here fails the label check below. */
const ROUTES: Record<string, () => unknown> = {
  'net.Server.prototype.listen': () => onPrototype(net.Server.prototype, 'listen', 0),
  'net.Socket.prototype.connect': () => onPrototype(net.Socket.prototype, 'connect', 9),
  'net.connect': () => net.connect(9),
  'net.createConnection': () => net.createConnection(9),
  'net.createServer': () => net.createServer(),
  'tls.connect': () => tls.connect(9),
  'http.createServer': () => http.createServer(),
  'http.request': () => http.request('http://localhost:9/'),
  'http.get': () => http.get('http://localhost:9/'),
  'https.createServer': () => https.createServer(),
  'https.request': () => https.request('https://localhost:9/'),
  'https.get': () => https.get('https://localhost:9/'),
  'http2.connect': () => http2.connect('http://localhost:9'),
  'http2.createServer': () => http2.createServer(),
  'http2.createSecureServer': () => http2.createSecureServer(),
  'dgram.createSocket': () => dgram.createSocket('udp4'),
  'dgram.Socket.prototype.bind': () => onPrototype(dgram.Socket.prototype, 'bind', 0),
  'dgram.Socket.prototype.send': () => onPrototype(dgram.Socket.prototype, 'send', 'x', 9),
  'dgram.Socket.prototype.connect': () => onPrototype(dgram.Socket.prototype, 'connect', 9),
  'fetch': () => fetch('http://localhost:9/'),
  'WebSocket': () => new WebSocket('ws://localhost:9/'),
  ...Object.fromEntries(['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse'].flatMap(name => [
    [`dns.${name}`, () => (dns as unknown as Record<string, () => unknown>)[name]!()],
    [`dns.promises.${name}`, () => (dns.promises as unknown as Record<string, () => unknown>)[name]!()],
  ])),
};

test('every route the spy wraps has a self-test, and every self-test names a route the spy wraps', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), [...SPIED_LABELS].sort());
  assert.equal(new Set(SPIED_LABELS).size, SPIED_LABELS.length);
});

test('each wrapped route fires the spy on its own, records its label, and opens nothing', () => {
  for (const label of SPIED_LABELS) {
    const spy = installPortSpy();
    try {
      assert.throws(ROUTES[label]!, /NO_PORT/, label);
      assert.deepEqual(spy.hits, [label], label);
    } finally {
      spy.restore();
    }
  }
});

test('a named import sees the spy as well as a default import, and sees the real function again after restore', () => {
  const real = namedBindings();
  assert.deepEqual(Object.keys(NAMED_IMPORT_ROUTES).sort(), ['dgram.createSocket', 'dns.lookup', 'http.createServer', 'http.get', 'http.request', 'http2.connect', 'https.createServer', 'net.connect', 'net.createConnection', 'net.createServer', 'tls.connect']);
  const spy = installPortSpy();
  try {
    const during = namedBindings();
    for (const key of Object.keys(real) as (keyof typeof real)[]) assert.notEqual(during[key], real[key], `${key} is wrapped`);
    for (const [label, route] of Object.entries(NAMED_IMPORT_ROUTES)) {
      const before = spy.hits.length;
      assert.throws(route, /NO_PORT/, label);
      assert.deepEqual(spy.hits.slice(before), [label], label);
    }
  } finally {
    spy.restore();
  }
  assert.deepEqual(namedBindings(), real);
});

test('the spy puts every function back, also when it is restored twice, and a second spy after the first works', () => {
  const originals = [net.Server.prototype.listen, net.Socket.prototype.connect, http.createServer, http.request, https.get, dgram.createSocket, dgram.Socket.prototype.bind, net.connect, tls.connect, http2.connect, dns.lookup, dns.promises.lookup, globalThis.fetch];
  const read = (): unknown[] => [net.Server.prototype.listen, net.Socket.prototype.connect, http.createServer, http.request, https.get, dgram.createSocket, dgram.Socket.prototype.bind, net.connect, tls.connect, http2.connect, dns.lookup, dns.promises.lookup, globalThis.fetch];
  const first = installPortSpy();
  assert.notDeepEqual(read(), originals);
  first.restore();
  first.restore();
  assert.deepEqual(read(), originals);
  const second = installPortSpy();
  assert.throws(() => http.createServer(), /NO_PORT/);
  assert.deepEqual(second.hits, ['http.createServer']);
  second.restore();
  assert.deepEqual(read(), originals);
});

test('a call that swallows the spy error still leaves a hit, so the suite would fail', () => {
  const spy = installPortSpy();
  try {
    try { http.createServer(); } catch { /* swallowed, as careless code might */ }
    assert.equal(spy.hits.length, 1);
  } finally {
    spy.restore();
  }
});
