// The two read-only calls of the bowerloomLocal bridge, answered in main (main/local-models-ipc.ts): the channels, the sender check, the argument count, the answers,
// and the rule that a server that is down is a state in the report and never a refusal. No real socket and no real server: the package gets a fake read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalModels, CONFIG_FILE_NAME } from '../../../packages/local-models/src/index.js';
import type { BoundGet, LocalModels, LocalModelsReport } from '../../../packages/local-models/src/index.js';
import { LOCAL_CALLS, LOCAL_CHANNELS } from '../shared/api/local.js';
import type { ExtensionsListing } from '../shared/api/local.js';
import { extensionsBundleRoot, listingOf, registerLocalModelsIpc } from '../main/local-models-ipc.js';
import type { LoadResult } from '../main/extension-loader.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { tempDir } from './support.js';

type Handler = (event: RealEvent, ...args: unknown[]) => unknown;
const GOOD: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };
const BAD_SENDERS: Record<string, RealEvent> = {
  'no frame': { senderFrame: null },
  'a foreign page': { senderFrame: { url: 'https://example.com/', parent: null } },
  'a file page': { senderFrame: { url: 'file:///etc/hosts', parent: null } },
  'a child frame of the app page': { senderFrame: { url: APP_INDEX, parent: {} } },
};

const REPORT: LocalModelsReport = Object.freeze({ sampledAt: '2026-01-01T00:00:00.000Z', models: Object.freeze([]), endpointsConfigured: 0, notes: Object.freeze([]) });
const LOADED: LoadResult = { manifests: [{ id: 'alpha', title: 'Alpha', kind: 'ui', routes: ['alpha-route'], protected: false }], skipped: [{ name: 'beta', code: 'NOT_JSON', message: 'The manifest.json of "beta" is not valid JSON (at position 3). /Users/someone/secret' }] };

interface Rig { readonly handlers: Map<string, Handler>; readonly asked: string[]; readonly loaded: string[] }
function rig(overrides: { models?: LocalModels; loadExtensions?: (root: string) => LoadResult } = {}): Rig {
  const handlers = new Map<string, Handler>(), asked: string[] = [], loaded: string[] = [];
  const models: LocalModels = overrides.models ?? { localModels: async () => { asked.push('localModels'); return REPORT; } };
  registerLocalModelsIpc({
    ipc: { handle: (channel, listener) => { assert.equal(handlers.has(channel), false, `${channel} registered twice`); handlers.set(channel, listener as Handler); } },
    appIndexUrl: APP_INDEX, stateRoot: '/nonexistent-state', bundleRoot: '/nonexistent-bundle', models,
    loadExtensions: overrides.loadExtensions ?? (root => { loaded.push(root); return LOADED; }),
  });
  return { handlers, asked, loaded };
}
const call = (r: Rig, name: (typeof LOCAL_CALLS)[number], event: RealEvent, ...args: unknown[]): Promise<unknown> => Promise.resolve((r.handlers.get(LOCAL_CHANNELS[name]) as Handler)(event, ...args));
const code = async (promise: Promise<unknown>): Promise<string> => { try { await promise; return 'RESOLVED'; } catch (error) { return error instanceof Error ? error.message : String(error); } };

test('main registers one handler on the channel of each local call and on no other channel', () => {
  const r = rig();
  assert.deepEqual([...r.handlers.keys()].sort(), Object.values(LOCAL_CHANNELS).sort());
  assert.equal(r.handlers.size, 2);
});

test('a call from any sender but the main frame of the app page is refused NOT_ALLOWED, and nothing is read', async () => {
  const r = rig();
  for (const name of LOCAL_CALLS) {
    for (const [label, event] of Object.entries(BAD_SENDERS)) assert.equal(await code(call(r, name, event)), 'NOT_ALLOWED', `${name} from ${label}`);
  }
  assert.deepEqual(r.asked, [], 'the report was never asked for');
  assert.deepEqual(r.loaded, [], 'no manifest was read');
});

test('the sender check comes before the argument check: a foreign sender with an argument is NOT_ALLOWED, not BAD_ARGUMENT', async () => {
  const r = rig();
  for (const name of LOCAL_CALLS) assert.equal(await code(call(r, name, BAD_SENDERS['a foreign page']!, 'x')), 'NOT_ALLOWED', name);
});

test('a call with any argument is refused BAD_ARGUMENT and reads nothing', async () => {
  const r = rig();
  for (const name of LOCAL_CALLS) {
    for (const args of [['x'], [undefined], [null], [0], [{}], ['a', 'b']]) assert.equal(await code(call(r, name, GOOD, ...args)), 'BAD_ARGUMENT', `${name}(${args.length} args)`);
  }
  assert.deepEqual(r.asked, []); assert.deepEqual(r.loaded, []);
});

test('localModels answers the report of the package, with no argument', async () => {
  const r = rig();
  assert.equal(await call(r, 'localModels', GOOD), REPORT);
  assert.deepEqual(r.asked, ['localModels']);
});

test('a server that is down is a state in the report, never a refusal: the call resolves with a down row', async t => {
  const state = tempDir(t);
  writeFileSync(join(state, CONFIG_FILE_NAME), JSON.stringify({ endpoints: [{ provider: 'llama-server', port: 8091 }] }));
  const refused: BoundGet = async () => ({ ok: false, code: 'CONNECTION_REFUSED' });
  const r = rig({ models: createLocalModels({ stateRoot: state, makeGet: () => refused, ttlMs: 0 }) });
  const report = await call(r, 'localModels', GOOD) as LocalModelsReport;
  assert.equal(report.endpointsConfigured, 1);
  const row = report.models.find(m => m.port === 8091);
  assert.ok(row !== undefined);
  assert.equal(row.state, 'down'); assert.equal(row.stateReason, 'CONNECTION_REFUSED');
  assert.equal(row.processMemoryBytes, null, 'memory is not reported in this version'); assert.equal(row.uptimeSeconds, null);
});

test('a source that throws gives the one short code FAILED, and its words never reach the page', async () => {
  const r = rig({ models: { localModels: async () => { throw new Error('/Users/someone/secret exploded'); } }, loadExtensions: () => { throw new Error('/Users/someone/secret exploded'); } });
  for (const name of LOCAL_CALLS) assert.equal(await code(call(r, name, GOOD)), 'FAILED', name);
});

test('listExtensions reads the bundle root main was given, and answers the manifests and the skipped folders by name and code only', async () => {
  const r = rig();
  const listing = await call(r, 'listExtensions', GOOD) as ExtensionsListing;
  assert.deepEqual(r.loaded, ['/nonexistent-bundle']);
  assert.deepEqual(listing, { extensions: [{ id: 'alpha', title: 'Alpha', kind: 'ui', routes: ['alpha-route'], protected: false }], skipped: [{ name: 'beta', code: 'NOT_JSON' }] });
  assert.doesNotMatch(JSON.stringify(listing), /position|secret|Users/, 'no loader message reaches the page');
});

test('listingOf copies each field by name, freezes the answer, and keeps an empty bundle empty', () => {
  const noisy = { manifests: [{ id: 'a', title: 'A', kind: 'ui', routes: ['r'], protected: true, mount: 'code', extra: 1 }], skipped: [] } as unknown as LoadResult;
  const out = listingOf(noisy);
  assert.deepEqual(out.extensions[0], { id: 'a', title: 'A', kind: 'ui', routes: ['r'], protected: true });
  assert.equal(Object.isFrozen(out), true); assert.equal(Object.isFrozen(out.extensions), true); assert.equal(Object.isFrozen(out.extensions[0]), true);
  assert.deepEqual(listingOf({ manifests: [], skipped: [] }), { extensions: [], skipped: [] });
});

test('listExtensions on a real bundle folder answers an empty list when there is no extensions folder, and the manifest when there is one', async t => {
  const root = tempDir(t);
  const handlers = new Map<string, Handler>();
  registerLocalModelsIpc({ ipc: { handle: (channel, listener) => { handlers.set(channel, listener as Handler); } }, appIndexUrl: APP_INDEX, stateRoot: root, bundleRoot: root, models: { localModels: async () => REPORT } });
  const ask = async (): Promise<ExtensionsListing> => (await (handlers.get(LOCAL_CHANNELS.listExtensions) as Handler)(GOOD)) as ExtensionsListing;
  assert.deepEqual(await ask(), { extensions: [], skipped: [] });
  mkdirSync(join(root, 'extensions', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'extensions', 'alpha', 'manifest.json'), JSON.stringify({ id: 'alpha', title: 'Alpha', kind: 'ui', routes: ['alpha-route'], protected: false }));
  const listing = await ask();
  assert.deepEqual(listing.extensions.map(m => m.id), ['alpha']);
  assert.deepEqual(listing.skipped, []);
});

test('the bundle root is the resources folder in a packaged build and apps/desktop in development', () => {
  assert.equal(extensionsBundleRoot({ packaged: true, resourcesPath: '/app/Resources', appRoot: '/repo/apps/desktop/dist' }), '/app/Resources');
  assert.equal(extensionsBundleRoot({ packaged: false, resourcesPath: '/app/Resources', appRoot: '/repo/apps/desktop/dist' }), '/repo/apps/desktop');
});
