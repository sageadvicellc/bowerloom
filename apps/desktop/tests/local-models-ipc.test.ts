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
import { listingOf, registerLocalModelsIpc } from '../main/local-models-ipc.js';
import { extensionsBundleRoot, startExtensions } from '../main/extension-host.js';
import type { ExtensionHost } from '../main/extension-host.js';
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
const manifestText = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ id, title: id, kind: 'ui', routes: [`${id}-route`], protected: false, ...extra });
/** A real extension host over a real bundle folder: an accepted extension, a skipped folder with a noisy message, and a refused one. */
function hostOf(t: Parameters<typeof tempDir>[0]): ExtensionHost {
  const root = tempDir(t);
  const put = (name: string, text: string): void => { mkdirSync(join(root, 'extensions', name), { recursive: true }); writeFileSync(join(root, 'extensions', name, 'manifest.json'), text); };
  put('alpha', manifestText('alpha'));
  put('beta', '{ not json /Users/someone/secret');
  put('claims', manifestText('claims', { protected: true }));
  return startExtensions(root);
}

interface Rig { readonly handlers: Map<string, Handler>; readonly asked: string[]; readonly host: ExtensionHost | null; readonly told: string[] }
function rig(t: Parameters<typeof tempDir>[0], overrides: { models?: LocalModels; host?: ExtensionHost | null } = {}): Rig {
  const handlers = new Map<string, Handler>(), asked: string[] = [], told: string[] = [];
  const models: LocalModels = overrides.models ?? { localModels: async () => { asked.push('localModels'); return REPORT; } };
  const host = overrides.host === undefined ? hostOf(t) : overrides.host;
  registerLocalModelsIpc({
    ipc: { handle: (channel, listener) => { assert.equal(handlers.has(channel), false, `${channel} registered twice`); handlers.set(channel, listener as Handler); } },
    appIndexUrl: APP_INDEX, stateRoot: '/nonexistent-state', extensionHost: () => host, models, tell: line => { told.push(line); },
  });
  return { handlers, asked, host, told };
}
const call = (r: Rig, name: (typeof LOCAL_CALLS)[number], event: RealEvent, ...args: unknown[]): Promise<unknown> => Promise.resolve((r.handlers.get(LOCAL_CHANNELS[name]) as Handler)(event, ...args));
const code = async (promise: Promise<unknown>): Promise<string> => { try { await promise; return 'RESOLVED'; } catch (error) { return error instanceof Error ? error.message : String(error); } };

test('main registers one handler on the channel of each local call and on no other channel', t => {
  const r = rig(t);
  assert.deepEqual([...r.handlers.keys()].sort(), Object.values(LOCAL_CHANNELS).sort());
  assert.equal(r.handlers.size, 2);
});

test('a call from any sender but the main frame of the app page is refused NOT_ALLOWED, and nothing is read', async t => {
  const r = rig(t);
  for (const name of LOCAL_CALLS) {
    for (const [label, event] of Object.entries(BAD_SENDERS)) assert.equal(await code(call(r, name, event)), 'NOT_ALLOWED', `${name} from ${label}`);
  }
  assert.deepEqual(r.asked, [], 'the report was never asked for');
});

test('the sender check comes before the argument check: a foreign sender with an argument is NOT_ALLOWED, not BAD_ARGUMENT', async t => {
  const r = rig(t);
  for (const name of LOCAL_CALLS) assert.equal(await code(call(r, name, BAD_SENDERS['a foreign page']!, 'x')), 'NOT_ALLOWED', name);
});

test('a call with any argument is refused BAD_ARGUMENT and reads nothing', async t => {
  const r = rig(t);
  for (const name of LOCAL_CALLS) {
    for (const args of [['x'], [undefined], [null], [0], [{}], ['a', 'b']]) assert.equal(await code(call(r, name, GOOD, ...args)), 'BAD_ARGUMENT', `${name}(${args.length} args)`);
  }
  assert.deepEqual(r.asked, []);
});

test('localModels answers the report of the package, with no argument', async t => {
  const r = rig(t);
  assert.equal(await call(r, 'localModels', GOOD), REPORT);
  assert.deepEqual(r.asked, ['localModels']);
});

test('a server that is down is a state in the report, never a refusal: the call resolves with a down row', async t => {
  const state = tempDir(t);
  writeFileSync(join(state, CONFIG_FILE_NAME), JSON.stringify({ endpoints: [{ provider: 'llama-server', port: 8091 }] }));
  const refused: BoundGet = async () => ({ ok: false, code: 'CONNECTION_REFUSED' });
  const r = rig(t, { models: createLocalModels({ stateRoot: state, makeGet: () => refused, ttlMs: 0 }) });
  const report = await call(r, 'localModels', GOOD) as LocalModelsReport;
  assert.equal(report.endpointsConfigured, 1);
  const row = report.models.find(m => m.port === 8091);
  assert.ok(row !== undefined);
  assert.equal(row.state, 'down'); assert.equal(row.stateReason, 'CONNECTION_REFUSED');
  assert.equal(row.processMemoryBytes, null, 'memory is not reported in this version'); assert.equal(row.uptimeSeconds, null);
});

test('a source that throws gives the one short code FAILED, and its words never reach the page', async t => {
  const throwing = { registry: { list: () => { throw new Error('/Users/someone/secret exploded'); } }, skipped: [], refused: [], uninstall: () => { throw new Error('x'); } } as unknown as ExtensionHost;
  const r = rig(t, { models: { localModels: async () => { throw new Error('/Users/someone/secret exploded'); } }, host: throwing });
  for (const name of LOCAL_CALLS) assert.equal(await code(call(r, name, GOOD)), 'FAILED', name);
});

test('a source that throws is logged in main by call name and error class only, never by its message', async t => {
  const throwing = { registry: { list: () => { throw new RangeError('/Users/someone/secret exploded'); } }, skipped: [], refused: [], uninstall: () => { throw new Error('x'); } } as unknown as ExtensionHost;
  const r = rig(t, { models: { localModels: async () => { throw new TypeError('/Users/someone/secret exploded'); } }, host: throwing });
  for (const name of LOCAL_CALLS) assert.equal(await code(call(r, name, GOOD)), 'FAILED', name);
  assert.equal(r.told.length, 2);
  assert.ok(r.told[0]!.includes('localModels') && r.told[0]!.includes('TypeError'), r.told[0]);
  assert.ok(r.told[1]!.includes('listExtensions') && r.told[1]!.includes('RangeError'), r.told[1]);
  assert.ok(!r.told.join('\n').includes('secret') && !r.told.join('\n').includes('someone'));
  const odd = rig(t, { models: { localModels: async () => { throw '/Users/someone/secret'; } } });
  assert.equal(await code(call(odd, 'localModels', GOOD)), 'FAILED');
  assert.ok(odd.told[0]!.includes('localModels') && !odd.told[0]!.includes('secret'));
});

test('a refusal of the sender or the argument is not logged as a failure', async t => {
  const r = rig(t);
  await code(call(r, 'localModels', BAD_SENDERS['a foreign page']!));
  await code(call(r, 'localModels', GOOD, 'x'));
  assert.deepEqual(r.told, []);
});

test('listExtensions answers from the state of the real extension host: the accepted extensions, and the skipped folders by name and code only', async t => {
  const r = rig(t);
  const listing = await call(r, 'listExtensions', GOOD) as ExtensionsListing;
  assert.deepEqual(listing, { extensions: [{ id: 'alpha', title: 'alpha', kind: 'ui', routes: ['alpha-route'], protected: false }], skipped: [{ name: 'beta', code: 'NOT_JSON' }] });
  assert.doesNotMatch(JSON.stringify(listing), /position|secret|Users/, 'no loader message reaches the page');
  assert.equal(listing.extensions.some(m => m.id === 'claims'), false, 'a manifest the registry refused is not listed');
  assert.equal(listing.extensions.some(m => m.protected), false, 'the six protected defaults are not listed: the page has them');
});

test('listExtensions follows the registry as it is now: an extension that is uninstalled after the start is gone from the next answer', async t => {
  const r = rig(t);
  assert.deepEqual(((await call(r, 'listExtensions', GOOD)) as ExtensionsListing).extensions.map(m => m.id), ['alpha']);
  assert.equal(r.host!.uninstall('alpha').ok, true);
  assert.deepEqual(((await call(r, 'listExtensions', GOOD)) as ExtensionsListing).extensions, []);
});

test('listExtensions answers HOST_NOT_STARTED while main has not started the extension host, and never a made-up empty list', async t => {
  const r = rig(t, { host: null });
  assert.equal(await code(call(r, 'listExtensions', GOOD)), 'HOST_NOT_STARTED');
  assert.deepEqual(r.told, [], 'a host that has not started is a state, not a crash to log');
  assert.equal(await call(r, 'localModels', GOOD), REPORT, 'the report does not wait for the host');
});

test('listingOf copies each field by name, freezes the answer, and keeps a bundle with no extension empty', t => {
  const noisy = { registry: { list: () => [{ id: 'a', title: 'A', kind: 'ui', routes: ['r'], protected: false, mount: 'code', extra: 1 }] }, skipped: [{ name: 'b', code: 'NOT_JSON', message: '/Users/someone/secret' }], refused: [], uninstall: () => { throw new Error('x'); } } as unknown as ExtensionHost;
  const out = listingOf(noisy);
  assert.deepEqual(out.extensions[0], { id: 'a', title: 'A', kind: 'ui', routes: ['r'], protected: false });
  assert.deepEqual(out.skipped, [{ name: 'b', code: 'NOT_JSON' }]);
  assert.equal(Object.isFrozen(out), true); assert.equal(Object.isFrozen(out.extensions), true); assert.equal(Object.isFrozen(out.extensions[0]), true); assert.equal(Object.isFrozen(out.skipped[0]), true);
  assert.deepEqual(listingOf(startExtensions(tempDir(t))), { extensions: [], skipped: [] });
});

test('the bundle root is the resources folder in a packaged build and apps/desktop in development', () => {
  assert.equal(extensionsBundleRoot({ packaged: true, resourcesPath: '/app/Resources', appRoot: '/repo/apps/desktop/dist' }), '/app/Resources');
  assert.equal(extensionsBundleRoot({ packaged: false, resourcesPath: '/app/Resources', appRoot: '/repo/apps/desktop/dist' }), '/repo/apps/desktop');
});
