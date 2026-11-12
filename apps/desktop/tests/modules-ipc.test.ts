// The four calls of the bowerloomModules bridge, answered in main (main/modules-ipc.ts): the channels, the sender check, the argument count and shape, the module lookup, the answers, and the rule of the read scope:
// a module reads only a place the person approved for it. The package is real over a made-up home and state folder, and the chooser is a fake that gives the folder the test says the person picked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { revokePlace, scopeFileOf } from '../../../packages/module-scope/src/index.js';
import { MODULE_CALLS, MODULE_CHANNELS } from '../shared/api/modules.js';
import type { ModuleApproval, ModuleFile, ModulePlaces } from '../shared/api/modules.js';
import { registerModulesIpc } from '../main/modules-ipc.js';
import { startExtensions } from '../main/extension-host.js';
import type { ExtensionHost } from '../main/extension-host.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { tempDir } from './support.js';

type Handler = (event: RealEvent, ...args: unknown[]) => unknown;
const GOOD: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };
const BAD_SENDERS: Record<string, RealEvent> = {
  'no frame': { senderFrame: null }, 'a foreign page': { senderFrame: { url: 'https://example.com/', parent: null } },
  'a file page': { senderFrame: { url: 'file:///etc/hosts', parent: null } }, 'a child frame of the app page': { senderFrame: { url: APP_INDEX, parent: {} } },
};
const manifestText = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ id, title: id, kind: 'ui', routes: [`${id}-route`], protected: false, ...extra });
const ARGS: Record<(typeof MODULE_CALLS)[number], unknown[]> = { listModulePlaces: ['memory'], approveModulePlace: ['memory'], revokeModulePlace: ['memory', 'place-0123456789ab'], readModuleFile: ['memory', 'place-0123456789ab', 'a.md'], listModuleFiles: ['memory', 'place-0123456789ab'] };

interface Rig { readonly titles: string[]; readonly home: string; readonly state: string; readonly handlers: Map<string, Handler>; readonly told: string[]; readonly picks: (string | null)[]; readonly asked: { count: number } }
/** A real extension host over a made-up bundle with two stock extensions, "memory" and "engines", over a made-up home folder. */
function rig(t: TestContext, host: ExtensionHost | null | undefined = undefined, revoke?: typeof revokePlace): Rig {
  const base = tempDir(t), home = join(base, 'home'), state = join(home, 'Library', 'state'), bundle = join(base, 'bundle');
  for (const d of ['Documents/notes', 'Documents/other', '.secret', 'Library/state']) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, 'Documents/notes/a.md'), '# A\n');
  writeFileSync(join(home, 'Documents/other/o.md'), 'other');
  writeFileSync(join(home, '.secret/key.txt'), 'secret');
  const TITLES: Record<string, string> = { memory: 'Memory notes', engines: 'engines', odd: 'Odd\u202e\nname' };
  for (const name of ['memory', 'engines', 'odd']) { mkdirSync(join(bundle, 'extensions', name), { recursive: true }); writeFileSync(join(bundle, 'extensions', name, 'manifest.json'), manifestText(name, { title: TITLES[name] })); }
  const handlers = new Map<string, Handler>(), told: string[] = [], picks: (string | null)[] = [], asked = { count: 0 }, titles: string[] = [];
  registerModulesIpc({
    ipc: { handle: (channel, listener) => { assert.equal(handlers.has(channel), false, `${channel} registered twice`); handlers.set(channel, listener as Handler); } },
    appIndexUrl: APP_INDEX, home, stateRoot: state, extensionHost: () => (host === undefined ? startExtensions(bundle) : host), tell: line => { told.push(line); },
    choosePlace: async title => { asked.count += 1; titles.push(title); return picks.shift() ?? null; },
    ...(revoke === undefined ? {} : { revoke }),
  });
  return { titles, home, state, handlers, told, picks, asked };
}
const call = (r: Rig, name: (typeof MODULE_CALLS)[number], event: RealEvent, ...args: unknown[]): Promise<unknown> => Promise.resolve((r.handlers.get(MODULE_CHANNELS[name]) as Handler)(event, ...args));
const code = async (promise: Promise<unknown>): Promise<string> => { try { await promise; return 'RESOLVED'; } catch (error) { return error instanceof Error ? error.message : String(error); } };
const approve = async (r: Rig, moduleId: string, folder: string): Promise<ModuleApproval> => { r.picks.push(join(r.home, folder)); return (await call(r, 'approveModulePlace', GOOD, moduleId)) as ModuleApproval; };

test('main registers one handler on the channel of each modules call and on no other channel', t => {
  const r = rig(t);
  assert.deepEqual([...r.handlers.keys()].sort(), Object.values(MODULE_CHANNELS).sort());
});

test('a call from any sender but the main frame of the app page is refused NOT_ALLOWED, and no chooser opens and nothing is read', async t => {
  const r = rig(t);
  for (const [label, event] of Object.entries(BAD_SENDERS)) for (const name of MODULE_CALLS) assert.equal(await code(call(r, name, event, ...ARGS[name])), 'NOT_ALLOWED', `${name} from ${label}`);
  assert.equal(r.asked.count, 0, 'the chooser never opened');
  for (const name of MODULE_CALLS) assert.equal(await code(call(r, name, BAD_SENDERS['a foreign page']!, 'x', 'y', 'z', 'w')), 'NOT_ALLOWED', `${name} sender before argument count`);
});

test('a call with the wrong number of arguments is BAD_ARGUMENT, and the chooser does not open', async t => {
  const r = rig(t);
  for (const name of MODULE_CALLS) {
    assert.equal(await code(call(r, name, GOOD)), 'BAD_ARGUMENT', `${name} with none`);
    assert.equal(await code(call(r, name, GOOD, ...ARGS[name], 'extra')), 'BAD_ARGUMENT', `${name} with one too many`);
  }
  assert.equal(r.asked.count, 0);
});

test('an argument of the wrong shape is BAD_ARGUMENT, and a module main does not hold is UNKNOWN_MODULE', async t => {
  const r = rig(t);
  for (const bad of ['', 'Memory', '../memory', 7, null, undefined, {}]) assert.equal(await code(call(r, 'listModulePlaces', GOOD, bad)), 'BAD_ARGUMENT', String(bad));
  assert.equal(await code(call(r, 'listModulePlaces', GOOD, 'nothing-here')), 'UNKNOWN_MODULE');
  assert.equal(await code(call(r, 'approveModulePlace', GOOD, 'nothing-here')), 'UNKNOWN_MODULE');
  assert.equal(r.asked.count, 0, 'an unknown module opens no chooser');
  for (const place of ['', 'place-1', 7, null, '../place-0123456789ab']) assert.equal(await code(call(r, 'revokeModulePlace', GOOD, 'memory', place)), 'BAD_ARGUMENT', String(place));
  for (const p of ['', 7, null, 'a\0b', 'x'.repeat(513)]) assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', 'place-0123456789ab', p)), 'BAD_ARGUMENT', String(p));
});

test('a protected default extension is not a module, and a host that has not started answers UNKNOWN_MODULE', async t => {
  const r = rig(t);
  for (const id of ['overview', 'library', 'first-run']) assert.equal(await code(call(r, 'listModulePlaces', GOOD, id)), 'UNKNOWN_MODULE', id);
  const early = rig(t, null);
  assert.equal(await code(call(early, 'listModulePlaces', GOOD, 'memory')), 'UNKNOWN_MODULE');
  assert.equal(early.asked.count, 0);
});

test('a module with no approval has no places, and cannot read a file', async t => {
  const r = rig(t);
  assert.deepEqual(await call(r, 'listModulePlaces', GOOD, 'memory'), { places: [] });
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', 'place-0123456789ab', 'a.md')), 'NOT_APPROVED');
});

test('the person picks a folder: the approval is recorded once for that module, the page sees a label and no full path, and the file is read', async t => {
  const r = rig(t);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  assert.equal(kept.place.label, '~/Documents/notes');
  assert.doesNotMatch(JSON.stringify(kept), new RegExp(r.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no full path reaches the page');
  assert.deepEqual(Object.keys(kept.place).sort(), ['approvedAt', 'id', 'label']);
  assert.deepEqual(await call(r, 'listModulePlaces', GOOD, 'memory'), { places: [kept.place] });
  assert.deepEqual(await call(r, 'readModuleFile', GOOD, 'memory', kept.place.id, 'a.md') as ModuleFile, { text: '# A\n' });
  const record = readFileSync(scopeFileOf(r.state), 'utf8');
  assert.match(record, /"memory"/);
  assert.doesNotMatch(record, new RegExp(r.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the record holds no full path either');
});

test('the approval of one module is not the approval of another: "engines" cannot read a place only "memory" was approved for', async t => {
  const r = rig(t);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'engines', kept.place.id, 'a.md')), 'NOT_APPROVED');
  assert.deepEqual(await call(r, 'listModulePlaces', GOOD, 'engines'), { places: [] });
  assert.equal(await code(call(r, 'revokeModulePlace', GOOD, 'engines', kept.place.id)), 'NOT_APPROVED');
  assert.equal((await call(r, 'listModulePlaces', GOOD, 'memory') as ModulePlaces).places.length, 1, 'the refused removal changed nothing');
});

test('a module cannot read an unapproved place: a sibling folder, a path that climbs out, an absolute path, a hidden folder and a link out are all refused', async t => {
  const r = rig(t);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  symlinkSync(join(r.home, 'Documents', 'other', 'o.md'), join(r.home, 'Documents', 'notes', 'link.md'));
  const id = kept.place.id;
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', id, '../other/o.md')), 'BAD_PATH');
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', id, join(r.home, 'Documents', 'other', 'o.md'))), 'BAD_PATH');
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', id, '../../.secret/key.txt')), 'BAD_PATH');
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', id, 'link.md')), 'OUTSIDE_PLACE');
  // a place id the person never approved: another folder of the same home, even when its label is guessed
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', 'place-aaaaaaaaaaaa', 'o.md')), 'NOT_APPROVED');
});

test('a pick that is refused by main\'s chooser rules is an answer with a reason, records nothing, and is told on the log without a path', async t => {
  const r = rig(t);
  for (const [folder, why] of [['.secret', 'HIDDEN_PART'], ['Library/state', 'STATE_FOLDER'], ['Documents/notes/a.md', 'NOT_A_FOLDER']] as const) {
    assert.deepEqual(await approve(r, 'memory', folder), { status: 'refused', code: why }, folder);
  }
  r.picks.push(join(r.home, '..'));
  assert.deepEqual(await call(r, 'approveModulePlace', GOOD, 'memory'), { status: 'refused', code: 'NOT_IN_HOME' });
  assert.deepEqual(await call(r, 'listModulePlaces', GOOD, 'memory'), { places: [] });
  assert.equal(r.told.length, 4);
  for (const line of r.told) assert.match(line, /^Bowerloom could not approve a folder for a module \([A-Z_]+(?:, [A-Za-z0-9_]+)?\)\.$/, line);
});

test('a cancelled chooser records nothing', async t => {
  const r = rig(t);
  assert.deepEqual(await call(r, 'approveModulePlace', GOOD, 'memory'), { status: 'cancelled' });
  assert.deepEqual(await call(r, 'listModulePlaces', GOOD, 'memory'), { places: [] });
});

test('removing a place answers the places that are left, and the module can no longer read it; the files stay', async t => {
  const r = rig(t);
  const a = await approve(r, 'memory', 'Documents/notes'), b = await approve(r, 'memory', 'Documents/other');
  assert.ok(a.status === 'kept' && b.status === 'kept');
  if (a.status !== 'kept' || b.status !== 'kept') return;
  assert.deepEqual(await call(r, 'revokeModulePlace', GOOD, 'memory', a.place.id), { places: [b.place] });
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', a.place.id, 'a.md')), 'NOT_APPROVED');
  assert.equal(readFileSync(join(r.home, 'Documents/notes/a.md'), 'utf8'), '# A\n');
  assert.equal(await code(call(r, 'revokeModulePlace', GOOD, 'memory', a.place.id)), 'NOT_APPROVED', 'a second removal finds nothing');
});

test('a damaged record is RECORD_DAMAGED on a list, a removal and a read; the next pick starts a new list and says so', async t => {
  const r = rig(t);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  writeFileSync(scopeFileOf(r.state), '{ not json');
  assert.equal(await code(call(r, 'listModulePlaces', GOOD, 'memory')), 'RECORD_DAMAGED');
  assert.equal(await code(call(r, 'revokeModulePlace', GOOD, 'memory', kept.place.id)), 'RECORD_DAMAGED');
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', kept.place.id, 'a.md')), 'RECORD_DAMAGED');
  const again = await approve(r, 'memory', 'Documents/other');
  assert.equal(again.status, 'kept');
  assert.equal(again.status === 'kept' && again.listReset, true, 'the page is told the old list was set aside');
  assert.ok(r.told.includes('Bowerloom set aside a damaged list of approved folders and started a new one.'), 'and the log says so');
  assert.equal((await call(r, 'listModulePlaces', GOOD, 'memory') as ModulePlaces).places.length, 1);
});

test('an unexpected failure is FAILED and is logged by call name and error class only, never by message', async t => {
  const handlers = new Map<string, Handler>(), told: string[] = [];
  const throwing = { registry: { list: () => { throw Object.assign(new Error('/Users/someone/secret exploded'), { name: 'WeirdError' }); } } } as unknown as ExtensionHost;
  registerModulesIpc({
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener as Handler); } }, appIndexUrl: APP_INDEX, home: tempDir(t), stateRoot: tempDir(t),
    extensionHost: () => throwing, choosePlace: async () => null, tell: line => { told.push(line); },
  });
  assert.equal(await code(Promise.resolve((handlers.get(MODULE_CHANNELS.listModulePlaces) as Handler)(GOOD, 'memory'))), 'FAILED');
  assert.deepEqual(told, ['Bowerloom: the modules call listModulePlaces failed (WeirdError).']);
});

test('a blocked record is RECORD_BLOCKED on a read as well as on a list', async t => {
  const r = rig(t);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  chmodSync(join(r.state, 'module-scope'), 0o777);
  assert.equal(await code(call(r, 'listModulePlaces', GOOD, 'memory')), 'RECORD_BLOCKED');
  assert.equal(await code(call(r, 'readModuleFile', GOOD, 'memory', kept.place.id, 'a.md')), 'RECORD_BLOCKED');
});

test('every FAILED answer is logged, also one that is a refusal of the call itself: a removal that could not be written is FAILED with its cause class in the log', async t => {
  const failing = ((): ReturnType<typeof revokePlace> => ({ status: 'failed', cause: 'EROFS' })) as unknown as typeof revokePlace;
  const r = rig(t, undefined, failing);
  const kept = await approve(r, 'memory', 'Documents/notes');
  assert.equal(kept.status, 'kept');
  if (kept.status !== 'kept') return;
  assert.equal(await code(call(r, 'revokeModulePlace', GOOD, 'memory', kept.place.id)), 'FAILED');
  assert.deepEqual(r.told, ['Bowerloom: the modules call revokeModulePlace failed (EROFS).']);
});

test('the chooser is told the title of the module from main\'s own registry, cleaned of control and bidirectional characters, and the page gives no title', async t => {
  const r = rig(t);
  await call(r, 'approveModulePlace', GOOD, 'memory');
  await call(r, 'approveModulePlace', GOOD, 'odd');
  assert.deepEqual(r.titles, ['Memory notes', 'Odd name']);
  // a page that tries to give a title or a folder as a second argument is refused before the chooser opens
  assert.equal(await code(call(r, 'approveModulePlace', GOOD, 'memory', 'Fake title')), 'BAD_ARGUMENT');
  assert.equal(r.titles.length, 2);
});
