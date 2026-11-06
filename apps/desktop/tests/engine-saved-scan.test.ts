// The two calls of the kept read, on the engine channel: they are answered for the app's own page only, take no argument, and give back what main/scan-session.ts gives. Without a
// kept read the launch gets `none`. The sample, which keeps nothing, answers the same calls from memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEngineIpc } from '../main/engine-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { REAL_BASE } from '../shared/harness/route.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import type { SavedScanAnswer, SavedScanCheck } from '../shared/real/saved-scan.js';

type Handler = (event: { senderFrame: { url: string; parent: unknown } | null }, ...args: unknown[]) => unknown;
const page = { senderFrame: { url: `${APP_INDEX}${REAL_BASE}`, parent: null } };
const make = (saved?: { savedScan(): Promise<SavedScanAnswer>; checkSavedScan(): Promise<SavedScanCheck> }): Map<string, Handler> => {
  const handlers = new Map<string, Handler>();
  registerEngineIpc({ ipc: { handle: (c, l) => { handlers.set(c, l as Handler); } }, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom', chooseFolder: async () => null, confirm: async () => false, who: 't', ...(saved === undefined ? {} : { saved }) });
  return handlers;
};
const reason = async (handlers: Map<string, Handler>, call: 'savedScan' | 'checkSavedScan', event: Parameters<Handler>[0], ...args: unknown[]): Promise<string> => {
  try { await handlers.get(ENGINE_CHANNELS[call])!(event, ...args); return 'answered'; } catch (e) { return (e as Error).message; }
};

test('both calls are on the engine bridge with no argument', () => {
  for (const call of ['savedScan', 'checkSavedScan'] as const) {
    assert.ok((ENGINE_CALLS as readonly string[]).includes(call), call);
    assert.equal(ENGINE_ARITY[call], 0);
    assert.equal(ENGINE_CHANNELS[call], `bowerloom-engine:${call}`);
  }
});

test('the calls give back what the kept read gives, and nothing is added', async () => {
  const kept: SavedScanAnswer = { status: 'damaged', why: 'bad-shape' };
  const handlers = make({ savedScan: async () => kept, checkSavedScan: async () => 'same' });
  assert.deepEqual(await handlers.get(ENGINE_CHANNELS.savedScan)!(page), kept);
  assert.equal(await handlers.get(ENGINE_CHANNELS.checkSavedScan)!(page), 'same');
});

test('another page, a sub-frame, no frame and any argument are refused with a short code', async () => {
  const handlers = make({ savedScan: async () => ({ status: 'none' }), checkSavedScan: async () => 'same' });
  for (const call of ['savedScan', 'checkSavedScan'] as const) {
    for (const bad of [null, { url: 'https://example.com/', parent: null }, { url: `${APP_INDEX}${REAL_BASE}`, parent: {} }, { url: 'file:///etc/hosts', parent: null }]) assert.equal(await reason(handlers, call, { senderFrame: bad }), 'NOT_ALLOWED', `${call} ${JSON.stringify(bad)}`);
    assert.equal(await reason(handlers, call, page, 'x'), 'BAD_ARGUMENT');
    assert.equal(await reason(handlers, call, page, {}, []), 'BAD_ARGUMENT');
  }
});

test('a kept read that throws is a short FAILED, and with no kept read a launch gets none', async () => {
  const broken = make({ savedScan: async () => { throw new Error('/secret/path'); }, checkSavedScan: async () => { throw new Error('x'); } });
  assert.equal(await reason(broken, 'savedScan', page), 'FAILED');
  assert.equal(await reason(broken, 'checkSavedScan', page), 'FAILED');
  const none = make();
  assert.deepEqual(await none.get(ENGINE_CHANNELS.savedScan)!(page), { status: 'none' });
  assert.equal(await none.get(ENGINE_CHANNELS.checkSavedScan)!(page), 'unchecked');
});

test('the sample keeps no read', async () => {
  const sample = createSampleEngine({ previewEngines: false });
  assert.deepEqual(await sample.savedScan(), { status: 'none' });
  assert.equal(await sample.checkSavedScan(), 'same');
});
