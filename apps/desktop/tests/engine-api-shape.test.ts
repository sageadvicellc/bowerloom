// The shape suite (tests/helpers-engine/engine-api-shape.ts) run on the sample engine, and the proof that the suite and the no-port spy can fail.
// A second implementation joins by calling defineShapeSuite with its own factory.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { ENGINE_API_CALLS } from '../../../packages/engine-api/src/index.js';
import type { CallSpec } from '../../../packages/engine-api/src/index.js';
import { SAMPLE_FOLDERS, SAMPLE_NOTES, createSampleEngine } from '../shared/engine/sample.js';
import { answerProblems, declaredCountProblems, defineShapeSuite, returnProblems, settle, settledProblems } from './helpers-engine/engine-api-shape.js';
import { installPortSpy } from './helpers-engine/no-port-spy.js';

defineShapeSuite({ label: 'the sample engine', make: () => createSampleEngine(), ids: { folder: SAMPLE_FOLDERS.defined, notes: SAMPLE_NOTES.use } });

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

test('a bridge that is missing a call, or throws a stray error, is caught by settle', async () => {
  const bridge = { mode: 'sample', folders: async () => { throw new Error('boom'); }, planSave: () => { throw new Error('UNKNOWN_FOLDER'); } } as never;
  assert.deepEqual(await settle(bridge, 'folders', []), { code: 'boom' });
  assert.deepEqual(await settle(bridge, 'planSave', ['x', []]), { code: 'UNKNOWN_FOLDER' });
  const out = await settle(bridge, 'runSave', []);
  assert.ok('code' in out, 'a missing call is a thrown error, never a value');
});

// ---- the spy can fail

test('the no-port spy fires on each call it wraps, records it, and puts everything back', () => {
  const originals = [net.Server.prototype.listen, http.createServer, https.createServer, dgram.createSocket, net.connect, net.createConnection];
  const spy = installPortSpy();
  try {
    assert.throws(() => net.createServer().listen(0), /NO_PORT/);
    assert.throws(() => http.createServer(), /NO_PORT/);
    assert.throws(() => https.createServer(), /NO_PORT/);
    assert.throws(() => dgram.createSocket('udp4'), /NO_PORT/);
    assert.throws(() => net.connect(9), /NO_PORT/);
    assert.throws(() => net.createConnection(9), /NO_PORT/);
    assert.deepEqual(spy.hits, ['net.Server.prototype.listen', 'http.createServer', 'https.createServer', 'dgram.createSocket', 'net.connect', 'net.createConnection']);
  } finally {
    spy.restore();
  }
  assert.deepEqual([net.Server.prototype.listen, http.createServer, https.createServer, dgram.createSocket, net.connect, net.createConnection], originals);
  spy.restore();
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
