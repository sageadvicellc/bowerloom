// The Memory explorer reads notes through the read scope of lane 2 and nothing else: the person approves a folder for the module `memory-explorer` (main's own chooser), the module lists its markdown files
// (`listModuleFiles`) and reads them one by one (`readModuleFile`). Main is the real one (main/modules-ipc.ts) over the real package, a made-up home folder, and the real manifest folder of the app.
// The parity tests hold every count on the screen to a count of files made without the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CHANNELS } from '../shared/api/modules.js';
import type { ModuleApproval, ModuleCall, ModuleFile, ModuleFileList, ModulePlace, ModulePlaces, ModulesBridge } from '../shared/api/modules.js';
import { registerModulesIpc } from '../main/modules-ipc.js';
import { startExtensions } from '../main/extension-host.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { MEMORY_MODULE_ID, readAllMemory, readPlaceMemory } from '../shared/memory/read-flow.js';
import { memoryRows } from '../shared/memory/view-model.js';
import { MemoryView } from '../renderer/harness/memory/MemoryExplorer.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import { BASIC, BASIC_FACTS, chain, writeVault } from './memory-fixtures.js';
import { DESKTOP, tempDir } from './support.js';

type Handler = (event: RealEvent, ...args: unknown[]) => unknown;
const GOOD: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };

interface Rig { readonly home: string; readonly state: string; readonly bridge: ModulesBridge; readonly picks: (string | null)[]; readonly calls: string[]; readonly handlers: Map<string, Handler> }
/** The real main over a made-up home folder. The bridge here is the preload's job done in the test: each call is the handler of its channel, called from the page. */
function rig(t: TestContext): Rig {
  const base = tempDir(t, 'bowerloom-memory-'), home = join(base, 'home'), state = join(home, 'Library', 'state');
  const handlers = new Map<string, Handler>(), picks: (string | null)[] = [], calls: string[] = [];
  writeVault(join(home, 'Library', 'state'), {});
  registerModulesIpc({
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener as Handler); } },
    appIndexUrl: APP_INDEX, home, stateRoot: state, extensionHost: () => startExtensions(DESKTOP), tell: () => undefined, choosePlace: async () => picks.shift() ?? null,
  });
  const call = (name: ModuleCall, ...args: unknown[]): Promise<unknown> => { calls.push(name); return Promise.resolve((handlers.get(MODULE_CHANNELS[name]) as Handler)(GOOD, ...args)); };
  const bridge: ModulesBridge = {
    listModulePlaces: id => call('listModulePlaces', id) as Promise<ModulePlaces>, approveModulePlace: id => call('approveModulePlace', id) as Promise<ModuleApproval>,
    revokeModulePlace: (id, place) => call('revokeModulePlace', id, place) as Promise<ModulePlaces>, readModuleFile: (id, place, path) => call('readModuleFile', id, place, path) as Promise<ModuleFile>,
    listModuleFiles: (id, place) => call('listModuleFiles', id, place) as Promise<ModuleFileList>,
  };
  return { home, state, bridge, picks, calls, handlers };
}
async function approved(r: Rig, folder: string, vault: Readonly<Record<string, string>>, moduleId = MEMORY_MODULE_ID): Promise<ModulePlace> {
  writeVault(join(r.home, ...folder.split('/')), vault);
  r.picks.push(join(r.home, ...folder.split('/')));
  const done = await r.bridge.approveModulePlace(moduleId);
  assert.equal(done.status, 'kept');
  return (done as { place: ModulePlace }).place;
}
/** A count of notes made without the code under test: every file below the folder whose name ends .md or .markdown, with no hidden part. */
function directCount(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) n += directCount(join(dir, entry.name));
    else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) n += 1;
  }
  return n;
}
const treeHash = (dir: string): string => {
  const h = createHash('sha256');
  const walk = (at: string): void => { for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = join(at, e.name); if (e.isDirectory()) walk(p); else h.update(`${e.name}\0${readFileSync(p, 'utf8')}\0${statSync(p).mtimeMs}\0`); } };
  walk(dir);
  return h.digest('hex');
};
const attr = (html: string, name: string, place?: string): string[] => [...html.matchAll(new RegExp(`<[^>]*data-count="${name}"[^>]*>`, 'g'))].map(m => m[0]).filter(tag => place === undefined || tag.includes(`data-place="${place}"`)).map(tag => /data-value="([^"]*)"/.exec(tag)![1]!);

// ---- the read, through main

test('a person approves a folder and the explorer reads the basic vault through the real main: the analytics are the ones worked out by hand', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const got = await readPlaceMemory(r.bridge, MEMORY_MODULE_ID, place);
  assert.equal(got.status, 'ok');
  assert.equal(got.listed, BASIC_FACTS.notes);
  assert.equal(got.analytics.notes, BASIC_FACTS.notes);
  assert.equal(got.analytics.links, BASIC_FACTS.links);
  assert.equal(got.analytics.tags, BASIC_FACTS.tags);
  assert.equal(got.analytics.missingLinks, BASIC_FACTS.missingLinks);
  assert.deepEqual(got.unreadable, []);
  assert.equal(got.truncated, false);
  assert.equal(got.notShown, 0);
  assert.equal(got.label, '~/Documents/vault');
});

test('parity: the count of notes on the screen is the count of files in the folder, for the folders of the fixtures', async t => {
  const r = rig(t);
  const vaults: Record<string, Readonly<Record<string, string>>> = { basic: BASIC, chain: chain(37), empty: {}, nested: { 'a/b/c/d.md': 'x', 'a/e.md': '[[d]]', 'z.markdown': '#t' } };
  const places: ModulePlace[] = [];
  for (const [name, vault] of Object.entries(vaults)) places.push(await approved(r, `Documents/${name}`, vault));
  const results = await readAllMemory(r.bridge, MEMORY_MODULE_ID, places);
  const html = renderToStaticMarkup(createElement(MemoryView, { ...viewProps(), memory: { status: 'ready', places: results } }));
  for (const [i, name] of Object.keys(vaults).entries()) {
    const direct = directCount(join(r.home, 'Documents', name));
    assert.deepEqual(attr(html, 'notes', places[i]!.id), [String(direct)], `${name}: on screen`);
    assert.equal(results[i]!.listed, direct, `${name}: listed`);
  }
  assert.deepEqual(attr(html, 'total-notes'), [String(Object.keys(vaults).reduce((sum, name) => sum + directCount(join(r.home, 'Documents', name)), 0))]);
});

test('parity: the links, tags and missing links on the screen are the numbers worked out by hand', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const html = renderToStaticMarkup(createElement(MemoryView, { ...viewProps(), memory: { status: 'ready', places: await readAllMemory(r.bridge, MEMORY_MODULE_ID, [place]) } }));
  assert.deepEqual(attr(html, 'links'), [String(BASIC_FACTS.links)]);
  assert.deepEqual(attr(html, 'tags'), [String(BASIC_FACTS.tags)]);
  assert.deepEqual(attr(html, 'missing-links'), [String(BASIC_FACTS.missingLinks)]);
});

test('the read changes no file of the folder and no record: the folder and the record of approvals hold the same bytes after', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const folder = join(r.home, 'Documents', 'vault'), record = join(r.state, 'module-scope', 'approved.json');
  const before = [treeHash(folder), readFileSync(record, 'utf8')];
  await readAllMemory(r.bridge, MEMORY_MODULE_ID, [place]);
  assert.deepEqual([treeHash(folder), readFileSync(record, 'utf8')], before);
  assert.ok(r.calls.every(c => c === 'approveModulePlace' || c === 'listModuleFiles' || c === 'readModuleFile'), `only these calls: ${[...new Set(r.calls)].join(', ')}`);
});

test('a note that cannot be read still counts as a note and is told with its code, and the others are read', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', { 'a.md': '[[b]] #x', 'b.md': 'plain' });
  writeFileSync(join(r.home, 'Documents/vault/big.md'), 'x'.repeat(300 * 1024));
  writeFileSync(join(r.home, 'Documents/vault/binary.md'), Buffer.from([104, 0, 105]));
  writeFileSync(join(r.home, 'Documents/vault/latin.md'), Buffer.from([0xff, 0xfe, 0x41]));
  const got = await readPlaceMemory(r.bridge, MEMORY_MODULE_ID, place);
  assert.equal(got.listed, 5);
  assert.equal(got.analytics.notes, 5);
  assert.equal(got.read, 2);
  assert.deepEqual(got.unreadable, [{ code: 'NOT_TEXT', count: 2 }, { code: 'TOO_LARGE', count: 1 }]);
  assert.equal(got.analytics.links, 1);
});

test('the pages cap of a place holds: at most pagesPerPlace notes are read, and the rest is told as not shown', async () => {
  const files = Array.from({ length: REAL_LIMITS.pagesPerPlace + 600 }, (_, i) => `n${String(i).padStart(5, '0')}.md`);
  let reads = 0;
  const bridge = fake({ listModuleFiles: async () => ({ files, truncated: false }), readModuleFile: async () => { reads += 1; return { text: '[[n00000]] #t' }; } });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE);
  assert.equal(REAL_LIMITS.pagesPerPlace, 2000);
  assert.equal(reads, REAL_LIMITS.pagesPerPlace);
  assert.equal(got.listed, files.length);
  assert.equal(got.notShown, 600);
  assert.equal(got.analytics.notes, REAL_LIMITS.pagesPerPlace);
});

test('a smaller cap of the test holds the same way, and a list that main cut is told as cut', async () => {
  const bridge = fake({ listModuleFiles: async () => ({ files: ['a.md', 'b.md', 'c.md', 'd.md'], truncated: true }) });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE, { cap: 3 });
  assert.equal(got.read, 3); assert.equal(got.notShown, 1); assert.equal(got.truncated, true);
});

test('no more than the number of reads in flight at once are asked of main', async () => {
  let live = 0, peak = 0;
  const bridge = fake({ listModuleFiles: async () => ({ files: Array.from({ length: 100 }, (_, i) => `n${i}.md`), truncated: false }), readModuleFile: async () => { live += 1; peak = Math.max(peak, live); await new Promise(resolve => setImmediate(resolve)); live -= 1; return { text: 'x' }; } });
  await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE, { parallel: 8 });
  assert.ok(peak > 1 && peak <= 8, `peak ${peak}`);
});

test('a refusal of the list is a failed place with its code, and every code of the modules calls is carried as it came', async () => {
  for (const code of ['NOT_APPROVED', 'PLACE_CHANGED', 'RECORD_DAMAGED', 'RECORD_BLOCKED', 'HOME_UNREADABLE', 'UNREADABLE', 'UNKNOWN_MODULE', 'NOT_ALLOWED']) {
    const bridge = fake({ listModuleFiles: async () => { throw new Error(`Error invoking remote method 'bowerloom-modules:listModuleFiles': Error: ${code}`); } });
    const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE);
    assert.equal(got.status, 'failed'); assert.equal(got.code, code); assert.equal(got.analytics.notes, 0);
  }
  const throwsAtOnce = fake({ listModuleFiles: () => { throw new Error('boom'); } });
  assert.equal((await readPlaceMemory(throwsAtOnce, MEMORY_MODULE_ID, PLACE)).code, 'FAILED');
});

test('a place that is removed while it is read gives notes that could not be read, never a thrown error', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const first = r.bridge.readModuleFile;
  let n = 0;
  const bridge: ModulesBridge = { ...r.bridge, readModuleFile: async (...args) => { n += 1; if (n === 2) await r.bridge.revokeModulePlace(MEMORY_MODULE_ID, place.id); return first(...args); } };
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, place, { parallel: 1 });
  assert.equal(got.status, 'ok');
  assert.equal(got.read, 1);
  assert.deepEqual(got.unreadable, [{ code: 'NOT_APPROVED', count: BASIC_FACTS.notes - 1 }]);
});

// ---- the limits of the scope still hold, through main

test('another module cannot list or read a place that was approved for the explorer, and an id that is no module is refused', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  await assert.rejects(() => r.bridge.listModuleFiles('modules', place.id), /NOT_APPROVED/);
  await assert.rejects(() => r.bridge.readModuleFile('modules', place.id, 'Home.md'), /NOT_APPROVED/);
  await assert.rejects(() => r.bridge.listModuleFiles('no-such-module', place.id), /UNKNOWN_MODULE/);
  await assert.rejects(() => r.bridge.listModuleFiles(MEMORY_MODULE_ID, 'bad'), /BAD_ARGUMENT/);
  await assert.rejects(() => r.bridge.readModuleFile(MEMORY_MODULE_ID, place.id, '../Home.md'), /BAD_PATH/);
  await assert.rejects(() => r.bridge.readModuleFile(MEMORY_MODULE_ID, place.id, '.obsidian/app.json'), /BAD_PATH/);
});

test('the list call has the sender check and the argument count of every modules call', async t => {
  const r = rig(t), handler = r.handlers.get(MODULE_CHANNELS.listModuleFiles) as Handler;
  await assert.rejects(async () => handler({ senderFrame: { url: 'https://example.com/', parent: null } }, MEMORY_MODULE_ID, 'place-0123456789ab'), /NOT_ALLOWED/);
  await assert.rejects(async () => handler({ senderFrame: null }, MEMORY_MODULE_ID, 'place-0123456789ab'), /NOT_ALLOWED/);
  await assert.rejects(async () => handler(GOOD, MEMORY_MODULE_ID), /BAD_ARGUMENT/);
  await assert.rejects(async () => handler(GOOD, MEMORY_MODULE_ID, 'place-0123456789ab', 'extra'), /BAD_ARGUMENT/);
  assert.equal(r.handlers.size, 5);
});

test('the explorer is a stock extension main loads from the app folder, not protected, with its own route', t => {
  const host = startExtensions(DESKTOP);
  assert.ok(host !== null);
  const found = host.registry.list().find(m => m.id === MEMORY_MODULE_ID);
  assert.deepEqual(found, { id: 'memory-explorer', title: 'Memory', kind: 'ui', routes: ['memory-explorer'], protected: false });
  void t;
});

// ---- the words

test('the rows of the view name each layer once, in the order notes, links, tags, missing links', () => {
  assert.deepEqual(memoryRows({ notes: 1, links: 2, tags: 3, tagUses: 4, missingLinks: 5, missingTargets: 5, topTags: [], missing: [] }).map(r => [r.key, r.value]), [['notes', 1], ['links', 2], ['tags', 3], ['missing-links', 5]]);
});

// ---- helpers

const PLACE: ModulePlace = { id: 'place-0123456789ab', label: '~/Documents/vault', approvedAt: '2026-11-12T10:00:00.000Z' };
function fake(over: Partial<ModulesBridge>): ModulesBridge {
  return {
    listModulePlaces: async () => ({ places: [PLACE] }), approveModulePlace: async () => ({ status: 'cancelled' }), revokeModulePlace: async () => ({ places: [] }),
    readModuleFile: async () => ({ text: '' }), listModuleFiles: async () => ({ files: [], truncated: false }), ...over,
  };
}
function viewProps(): Parameters<typeof MemoryView>[0] {
  return {
    hasBridge: true, sample: false, missing: false, places: { status: 'ready', places: [], code: null, busy: false, notice: null }, memory: { status: 'idle', places: [] },
    context: { agents: 0, skills: 0, tools: 0, sets: [] }, onApprove: () => undefined, onRemove: () => undefined,
  };
}
