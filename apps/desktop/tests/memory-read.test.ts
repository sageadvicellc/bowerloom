// The Memory explorer reads notes through the read scope of lane 2 and nothing else: the person approves a folder for the module `memory-explorer` (main's own chooser), the module lists its markdown files
// (`listModuleFiles`) and reads them one by one (`readModuleFile`). Main is the real one (main/modules-ipc.ts) over the real package, a made-up home folder, and the real manifest folder of the app.
// The parity tests hold every count on the screen to a count of files made without the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'node:fs';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CHANNELS } from '../shared/api/modules.js';
import type { MemoryState } from '../shared/memory/read-flow.js';
import type { ModuleApproval, ModuleCall, ModuleFile, ModuleFileList, ModulePlace, ModulePlaces, ModulesBridge } from '../shared/api/modules.js';
import { registerModulesIpc } from '../main/modules-ipc.js';
import { startExtensions } from '../main/extension-host.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { MEMORY_MODULE_ID, createMemoryReader, readAllMemory, readPlaceMemory } from '../shared/memory/read-flow.js';
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
/** A count of notes made without the code under test: the visible, non-hidden, non-link markdown files. A name with a control, format or bidirectional character, a path over 512 characters and a folder over 6 deep are not counted: main leaves them out. */
function directCount(dir: string, rel: string[] = []): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(entry.name) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (rel.length < 6) n += directCount(join(dir, entry.name), [...rel, entry.name]); }
    else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name) && [...rel, entry.name].join('/').length <= 512) n += 1;
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
  const html = renderToStaticMarkup(createElement(MemoryView, { ...viewProps(), memory: { status: 'ready', places: results, code: null } }));
  for (const [i, name] of Object.keys(vaults).entries()) {
    const direct = directCount(join(r.home, 'Documents', name));
    assert.deepEqual(attr(html, 'notes', places[i]!.id), [String(direct)], `${name}: on screen`);
    assert.equal(results[i]!.listed, direct, `${name}: listed`);
  }
  assert.deepEqual(attr(html, 'total-notes'), [String(Object.keys(vaults).reduce((sum, name) => sum + directCount(join(r.home, 'Documents', name)), 0))]);
});

test('parity: the links, tags and missing links on the screen are the numbers worked out by hand', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const html = renderToStaticMarkup(createElement(MemoryView, { ...viewProps(), memory: { status: 'ready', places: await readAllMemory(r.bridge, MEMORY_MODULE_ID, [place]), code: null } }));
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
  const bridge = fake({ listModuleFiles: async () => listing(files), readModuleFile: async () => { reads += 1; return { text: '[[n00000]] #t' }; } });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE);
  assert.equal(REAL_LIMITS.pagesPerPlace, 2000);
  assert.equal(reads, REAL_LIMITS.pagesPerPlace);
  assert.equal(got.listed, files.length);
  assert.equal(got.notShown, 600);
  assert.equal(got.analytics.notes, files.length, 'the notes are every listed note, not only those read');
  assert.equal(got.read, REAL_LIMITS.pagesPerPlace);
});

test('a smaller cap of the test holds the same way, and a list that main cut is told as cut', async () => {
  const bridge = fake({ listModuleFiles: async () => listing(['a.md', 'b.md', 'c.md', 'd.md'], true) });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE, { cap: 3 });
  assert.equal(got.read, 3); assert.equal(got.notShown, 1); assert.equal(got.truncated, true);
});

test('no more than the number of reads in flight at once are asked of main', async () => {
  let live = 0, peak = 0;
  const bridge = fake({ listModuleFiles: async () => listing(Array.from({ length: 100 }, (_, i) => `n${i}.md`)), readModuleFile: async () => { live += 1; peak = Math.max(peak, live); await new Promise(resolve => setImmediate(resolve)); live -= 1; return { text: 'x' }; } });
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

test('M2: a place removed while it is read is a failed place with the code of the refusal, and the workers stop', async t => {
  const r = rig(t), place = await approved(r, 'Documents/vault', BASIC);
  const first = r.bridge.readModuleFile;
  let n = 0;
  const bridge: ModulesBridge = { ...r.bridge, readModuleFile: async (...args) => { n += 1; if (n === 2) await r.bridge.revokeModulePlace(MEMORY_MODULE_ID, place.id); return first(...args); } };
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, place, { parallel: 1 });
  assert.equal(got.status, 'failed');
  assert.equal(got.code, 'NOT_APPROVED');
  assert.ok(n <= 3, `reads went on after the refusal: ${n}`);
});

test('M2: every place-level code stops the read the same way', async () => {
  for (const code of ['NOT_APPROVED', 'PLACE_CHANGED', 'RECORD_DAMAGED', 'RECORD_BLOCKED', 'HOME_UNREADABLE']) {
    let reads = 0;
    const bridge = fake({ listModuleFiles: async () => listing(Array.from({ length: 50 }, (_, i) => `n${i}.md`)), readModuleFile: async () => { reads += 1; throw new Error(`Error: ${code}`); } });
    const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE, { parallel: 2 });
    assert.equal(got.status, 'failed', code); assert.equal(got.code, code);
    assert.ok(reads <= 4, `${code}: ${reads} reads`);
  }
});

test('M3: a failure of the parser is its own code and is not told as a refusal', async () => {
  const bridge = fake({ listModuleFiles: async () => listing(['a.md', 'b.md']), readModuleFile: async () => ({ text: 'x' }) });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE, { parse: () => { throw new Error('bug'); } });
  assert.equal(got.status, 'ok');
  assert.deepEqual(got.unreadable, [{ code: 'PARSE_FAILED', count: 2 }]);
  assert.equal(got.read, 0);
});

test('C3: an answer of the wrong shape, or a throw outside the calls, is a failed place and never a read that does not end', async () => {
  for (const list of [{}, null, { files: 'no' }, { files: [1, 2] }, undefined] as unknown[]) {
    const got = await readPlaceMemory(fake({ listModuleFiles: async () => list as ModuleFileList }), MEMORY_MODULE_ID, PLACE);
    assert.equal(got.status, 'failed', JSON.stringify(list)); assert.equal(got.code, 'FAILED');
  }
  const noText = await readPlaceMemory(fake({ listModuleFiles: async () => listing(['a.md']), readModuleFile: async () => ({}) as never }), MEMORY_MODULE_ID, PLACE);
  assert.deepEqual(noText.unreadable, [{ code: 'FAILED', count: 1 }]);
});

test('C1: 2,500 notes with a link to a note past the cap: no missing link, and the notes are the file count', async () => {
  const files = Array.from({ length: 2500 }, (_, i) => `n${String(i).padStart(4, '0')}.md`);
  const bridge = fake({ listModuleFiles: async () => listing(files), readModuleFile: async (_i, _p, path) => ({ text: path === 'n0000.md' ? '[[n2400]]' : '' }) });
  const got = await readPlaceMemory(bridge, MEMORY_MODULE_ID, PLACE);
  assert.equal(got.analytics.notes, 2500);
  assert.equal(got.analytics.missingLinks, 0);
  assert.equal(got.notShown, 500);
  assert.equal(got.read, 2000);
});

test('C2: the folders and entries main could not list are carried to the result', async () => {
  const got = await readPlaceMemory(fake({ listModuleFiles: async () => listing(['a.md'], false, 2, 3) }), MEMORY_MODULE_ID, PLACE);
  assert.deepEqual(got.skipped, { folders: 2, entries: 3 });
});

test('M6: parity through the screen for a duplicate-named pair, a hidden name, an odd-character name, a link, a long path and a note past the cap', async t => {
  const r = rig(t);
  const long = 'l'.repeat(120);
  const vault: Record<string, string> = {
    'a/Same.md': '[[Same]]', 'b/Same.md': 'x', '.hidden/h.md': 'x', '.dot.md': 'x', 'bad\u202ename.md': 'x', 'tab\tname.md': 'x', 'plain.md': 'x', 'UP.MARKDOWN': 'x',
    [`${long}/${long}/${long}/${long}/${long}/${long}.md`]: 'x', 'short/deep.md': 'x',
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`past/p${String(i).padStart(2, '0')}.md`, `#t${i}`])),
  };
  const place = await approved(r, 'Documents/odd', vault);
  fs.symlinkSync(join(r.home, 'Documents/odd/plain.md'), join(r.home, 'Documents/odd/link.md'));
  const results = await readAllMemory(r.bridge, MEMORY_MODULE_ID, [place], { cap: 5 });
  const direct = directCount(join(r.home, 'Documents', 'odd'));
  assert.equal(results[0]!.analytics.notes, direct, 'Notes equals the visible file count, though only 5 are read');
  assert.deepEqual(results[0]!.skipped, { folders: 0, entries: 3 }, 'the odd-name file, the tab-name file and the long path are told as skipped; the hidden ones are not');
  assert.equal(results[0]!.notShown, direct - 5);
  const html = renderToStaticMarkup(createElement(MemoryView, { ...viewProps(), memory: { status: 'ready', places: results, code: null } }));
  assert.deepEqual(attr(html, 'notes', place.id), [String(direct)]);
  assert.match(html, /data-count="notes"[^>]*data-partial/, 'skipped notes make Notes a lower bound');
  assert.equal(direct, 17, 'Same twice, plain, UP, deep and the 12 past notes: the hidden, odd-name, link and long-path files are not counted');
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
  assert.deepEqual(memoryRows({ notes: 1, links: 2, tags: 3, tagUses: 4, missingLinks: 5, missingTargets: 5, capped: false, topTags: [], missing: [] }).map(r => [r.key, r.value]), [['notes', 1], ['links', 2], ['tags', 3], ['missing-links', 5]]);
});

// ---- helpers

const listing = (files: string[], truncated = false, folders = 0, entries = 0): ModuleFileList => ({ files, truncated, skipped: { folders, entries } });
const PLACE: ModulePlace = { id: 'place-0123456789ab', label: '~/Documents/vault', approvedAt: '2026-11-12T10:00:00.000Z' };
function fake(over: Partial<ModulesBridge>): ModulesBridge {
  return {
    listModulePlaces: async () => ({ places: [PLACE] }), approveModulePlace: async () => ({ status: 'cancelled' }), revokeModulePlace: async () => ({ places: [] }),
    readModuleFile: async () => ({ text: '' }), listModuleFiles: async () => listing([]), ...over,
  };
}
function viewProps(): Parameters<typeof MemoryView>[0] {
  return {
    hasBridge: true, sample: false, missing: false, places: { status: 'ready', places: [], code: null, busy: false, notice: null }, memory: { status: 'idle', places: [], code: null },
    context: { status: 'ok', agents: 0, skills: 0, tools: 0, sets: [] }, onApprove: () => undefined, onRemove: () => undefined, onRefresh: () => undefined,
  };
}

// ---- round 2

test('M-a: Refresh reads again, a second read happens, and a failure that repeats stays on screen as failed', async () => {
  let reads = 0;
  const states: MemoryState[] = [];
  const reader = createMemoryReader({ bridge: fake({}), moduleId: MEMORY_MODULE_ID, onState: s => states.push(s), read: async () => { reads += 1; return []; } });
  await reader.run([PLACE]);
  await reader.run([PLACE]);
  assert.equal(reads, 2);
  assert.deepEqual(states.map(s => s.status), ['loading', 'ready', 'loading', 'ready']);
  const failing: MemoryState[] = [];
  const bad = createMemoryReader({ bridge: fake({}), moduleId: MEMORY_MODULE_ID, onState: s => failing.push(s), read: async () => { throw new Error('boom'); } });
  await bad.run([PLACE]);
  await bad.run([PLACE]);
  assert.deepEqual(failing.map(s => s.status), ['loading', 'failed', 'loading', 'failed']);
  assert.equal(failing.at(-1)!.code, 'FAILED');
});

test('L-a: a read that was cancelled stops its workers, and its answer is not told', async () => {
  let reads = 0, release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bridge = fake({ listModuleFiles: async () => listing(Array.from({ length: 200 }, (_, i) => `n${i}.md`)), readModuleFile: async () => { reads += 1; await gate; return { text: 'x' }; } });
  const states: MemoryState[] = [];
  const reader = createMemoryReader({ bridge, moduleId: MEMORY_MODULE_ID, onState: s => states.push(s) });
  const pending = reader.run([PLACE]);
  await new Promise(resolve => setImmediate(resolve));
  reader.cancel();
  release();
  await pending;
  assert.ok(reads <= 16, `${reads} reads started: only the ones in flight when the read was cancelled`);
  assert.deepEqual(states.map(s => s.status), ['loading'], 'a cancelled read tells nothing more');
  let more = 0;
  await readPlaceMemory(fake({ listModuleFiles: async () => listing(['a.md', 'b.md', 'c.md']), readModuleFile: async () => { more += 1; return { text: '' }; } }), MEMORY_MODULE_ID, PLACE, { cancelled: () => true });
  assert.equal(more, 0);
});

test('L-a: main keeps one list in flight for a module and place, and shares it with a caller that comes while it runs', async t => {
  const base = tempDir(t, 'bowerloom-memory-'), home = join(base, 'home'), state = join(home, 'Library', 'state');
  writeVault(state, {});
  let runs = 0;
  const handlers = new Map<string, Handler>();
  registerModulesIpc({
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener as Handler); } }, appIndexUrl: APP_INDEX, home, stateRoot: state, extensionHost: () => startExtensions(DESKTOP), tell: () => undefined, choosePlace: async () => null,
    list: () => { runs += 1; return { ok: true, files: ['a.md'], truncated: false, skipped: { folders: 0, entries: 0 } }; },
  });
  const call = (): Promise<unknown> => Promise.resolve((handlers.get(MODULE_CHANNELS.listModuleFiles) as Handler)(GOOD, MEMORY_MODULE_ID, 'place-0123456789ab'));
  const [a, b] = await Promise.all([call(), call()]);
  assert.equal(runs, 1);
  assert.deepEqual(a, b);
  await call();
  assert.equal(runs, 2, 'once the first has finished, a new call runs again');
});
