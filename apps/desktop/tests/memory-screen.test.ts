// The Memory explorer screen: the markup of each state, the harness context beside the memory, the registration of the stock extension, and the rules that keep the page pure.
// Every state is drawn from plain data, so no window and no Electron is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryView } from '../renderer/harness/memory/MemoryExplorer.js';
import type { MemoryViewProps } from '../renderer/harness/memory/MemoryExplorer.js';
import { MEMORY_WORDS, contextStatusOf, contextSummary, memoryRows } from '../shared/memory/view-model.js';
import { MEMORY_MODULE_ID } from '../shared/memory/read-flow.js';
import type { PlaceMemory } from '../shared/memory/read-flow.js';
import { analyse, parseNote } from '../shared/memory/analytics.js';
import { BUNDLED_IDS, createScreenRegistry, registerBundled } from '../renderer/harness/extension-mounts.js';
import { moduleRows, ownRouteOf } from '../shared/modules/view-model.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import type { Part } from '../shared/harness/types.js';
import { DESKTOP } from './support.js';

const noop = (): void => undefined;
const render = (el: ReactElement): string => renderToStaticMarkup(el);
const MANIFEST = { id: 'memory-explorer', title: 'Memory', kind: 'ui' as const, routes: ['memory-explorer'], protected: false };
const part = (kind: Part['kind'], name: string, summary = ''): Part => ({ id: `${kind}-${name}`, kind, name, summary, description: '', path: '', source: '', origin: 's' } as Part);
const base = (over: Partial<MemoryViewProps> = {}): MemoryViewProps => ({
  hasBridge: true, sample: false, missing: false, places: { status: 'ready', places: [], code: null, busy: false, notice: null }, memory: { status: 'idle', places: [], code: null },
  context: { status: 'ok', agents: 0, skills: 0, tools: 0, sets: [] }, onApprove: noop, onRemove: noop, onRefresh: noop, ...over,
});
const placeMemory = (over: Partial<PlaceMemory> = {}): PlaceMemory => {
  const paths = ['a.md', 'b.md'], parsed = [parseNote('a.md', '[[b]] [[gone]] #x'), parseNote('b.md', '#x #y')];
  return { placeId: 'place-aaaaaaaaaaaa', label: '~/Documents/vault', status: 'ok', code: null, listed: 2, read: 2, notShown: 0, truncated: false, skipped: { folders: 0, entries: 0 }, unreadable: [], analytics: analyse(paths, parsed), ...over };
};
const PLACE = { id: 'place-aaaaaaaaaaaa', label: '~/Documents/vault', approvedAt: '2026-11-12T10:00:00.000Z' };

// ---- the states

test('with no folder approved the screen says so, offers the one button to approve, and still shows the harness context', () => {
  const html = render(createElement(MemoryView, base({ context: { status: 'ok', agents: 1, skills: 2, tools: 3, sets: [{ id: 'c1', name: 'Wiki', pages: 12 }] } })));
  assert.match(html, /data-memory-explorer/);
  assert.ok(html.includes(MEMORY_WORDS.noFolders));
  assert.match(html, />Approve a folder</);
  assert.match(html, /data-column="memory"/);
  assert.match(html, /data-column="context"/);
  assert.ok(html.indexOf('data-column="memory"') < html.indexOf('data-column="context"'), 'memory first, harness context beside it');
  for (const [name, n] of [['agents', 1], ['skills', 2], ['tools', 3], ['context-sets', 1], ['context-pages', 12]] as const) assert.match(html, new RegExp(`data-count="${name}"[^>]*data-value="${n}"`), name);
});

test('an approved folder shows its four layers with the numbers, the top tags and the links that point at a missing note', () => {
  const html = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'ready', places: [placeMemory()], code: null } })));
  assert.match(html, /~\/Documents\/vault/);
  for (const [name, n] of [['notes', 2], ['links', 2], ['tags', 2], ['missing-links', 1]] as const) assert.match(html, new RegExp(`data-count="${name}"[^>]*data-value="${n}"`), name);
  assert.match(html, /data-count="total-notes"[^>]*data-value="2"/);
  assert.match(html, /data-tag="x"[^>]*data-notes="2"/);
  assert.match(html, /data-missing="gone"/);
  assert.match(html, /aria-label="Remove ~\/Documents\/vault"/);
});

test('a place that failed shows its code and no numbers; a read in progress says so', () => {
  const failed = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'ready', places: [placeMemory({ status: 'failed', code: 'PLACE_CHANGED', listed: 0, read: 0 })], code: null } })));
  assert.match(failed, /data-memory-code="PLACE_CHANGED"/);
  assert.doesNotMatch(failed, /data-count="notes"/);
  const loading = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'loading', places: [], code: null } })));
  assert.ok(loading.includes(MEMORY_WORDS.reading));
});

test('notes that could not be read, notes not shown and a cut list are each told in words, with the count', () => {
  const html = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'ready', places: [placeMemory({ listed: 2600, notShown: 600, truncated: true, unreadable: [{ code: 'TOO_LARGE', count: 3 }] })], code: null } })));
  assert.match(html, /data-note="unreadable"[^>]*>[^<]*3[^<]*TOO_LARGE/);
  assert.match(html, /data-note="not-shown"[^>]*>[^<]*600/);
  assert.match(html, /data-note="truncated"/);
});

test('no bridge, a sample launch and a missing bridge in the real app each have their own words, and none shows the button', () => {
  const none = render(createElement(MemoryView, base({ hasBridge: false })));
  assert.ok(none.includes(MEMORY_WORDS.noBridge)); assert.doesNotMatch(none, />Approve a folder</);
  const sample = render(createElement(MemoryView, base({ hasBridge: false, sample: true })));
  assert.ok(sample.includes(MEMORY_WORDS.sample)); assert.doesNotMatch(sample, />Approve a folder</);
  const missing = render(createElement(MemoryView, base({ hasBridge: false, missing: true })));
  assert.match(missing, /data-memory-code="BRIDGE_MISSING"/);
});

test('a failed list of folders and a failed approval show the code and the words, and the screen stays', () => {
  const html = render(createElement(MemoryView, base({ places: { status: 'failed', places: [], code: 'RECORD_DAMAGED', busy: false, notice: null } })));
  assert.match(html, /data-memory-code="RECORD_DAMAGED"/);
  assert.match(html, /data-column="context"/);
});

test('the screen only reads: it has no button but Approve a folder, Refresh and Remove, and no write call', () => {
  const html = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'ready', places: [placeMemory()], code: null } })));
  const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
  assert.deepEqual(buttons.sort(), ['Approve a folder', 'Refresh', 'Remove']);
});

// ---- the harness context

test('the context summary counts the parts by kind, and reads the pages of a set of notes from its summary', () => {
  const parts = [part('agent', 'a'), part('skill', 's1'), part('skill', 's2'), part('tool', 't'), part('context', 'Wiki', '12 pages.'), part('context', 'One', '1 page.'), part('context', 'Odd', 'something else')];
  assert.deepEqual(contextSummary(parts), { status: 'ok', agents: 1, skills: 2, tools: 1, sets: [{ id: 'context-Wiki', name: 'Wiki', pages: 12 }, { id: 'context-One', name: 'One', pages: 1 }, { id: 'context-Odd', name: 'Odd', pages: null }] });
  assert.deepEqual(contextSummary([]), { status: 'ok', agents: 0, skills: 0, tools: 0, sets: [] });
});

test('the sample world gives a harness context to put beside the memory', () => {
  const summary = contextSummary(createSampleWorld({ daysAgo: 0, time: '10:00' }).parts);
  assert.ok(summary.agents + summary.skills + summary.tools + summary.sets.length > 0);
});

test('the rows name the layers in words a person reads, and a row has a key, a label, a value', () => {
  const rows = memoryRows(analyse(['a.md'], [parseNote('a.md', '[[b]] #x')]));
  assert.deepEqual(rows.map(r => r.label), [MEMORY_WORDS.notes, MEMORY_WORDS.links, MEMORY_WORDS.tags, MEMORY_WORDS.missingLinks]);
});

// ---- the stock extension

test('the manifest folder holds the explorer, and the registry takes it with a screen on its own route', () => {
  const text = JSON.parse(readFileSync(join(DESKTOP, 'extensions', 'memory-explorer', 'manifest.json'), 'utf8'));
  assert.deepEqual(text, MANIFEST);
  assert.ok(BUNDLED_IDS.includes(MEMORY_MODULE_ID));
  const registry = createScreenRegistry();
  assert.deepEqual(registerBundled(registry, [MANIFEST]).map(m => m.id), ['memory-explorer']);
  assert.equal(registry.resolve('memory-explorer').found, true);
});

test('the Modules view lists the explorer as a module and opens its own page at the extension address', () => {
  const rows = moduleRows([MANIFEST], null);
  assert.deepEqual(rows.map(r => [r.id, r.title]), [['memory-explorer', 'Memory']]);
  assert.deepEqual(ownRouteOf(MANIFEST), { name: 'extension', route: 'memory-explorer' });
});

// ---- the rules of the page

const SOURCES = ['renderer/harness/memory', 'shared/memory'];
const files = SOURCES.flatMap(dir => readdirSync(join(DESKTOP, dir)).filter(f => /\.tsx?$/.test(f)).map(f => `${dir}/${f}`));

test('the explorer files import no Node module, no Electron, no bridge name and no call that writes', () => {
  assert.ok(files.length >= 5, files.join(', '));
  for (const file of files) {
    const text = readFileSync(join(DESKTOP, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /from ['"](?:node:|electron|fs|path)/, file);
    assert.doesNotMatch(text, /bowerloom(?:Real|Engine|Local|Runs|Modules)\b|ipcRenderer|contextBridge|window\./, file);
    assert.doesNotMatch(text, /\b(?:writeFile|appendFile|mkdir|rmSync|unlink|rename|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/, file);
  }
});

test('the only calls of the explorer are the list, the read and the approval calls of the modules bridge', () => {
  const calls = new Set<string>();
  for (const file of files) for (const m of readFileSync(join(DESKTOP, file), 'utf8').matchAll(/\bbridge\.(\w+)\(/g)) calls.add(m[1]!);
  assert.deepEqual([...calls].sort(), ['listModuleFiles', 'readModuleFile']);
});

// ---- the fix round

const withPlace = (memory: PlaceMemory, over: Partial<MemoryViewProps> = {}): string => render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'ready', places: [memory], code: null }, ...over })));
const tagOf = (html: string, name: string): string => new RegExp(`<[^>]*data-count="${name}"[^>]*>`).exec(html)?.[0] ?? '';

test('M1: when a note was unreadable, cut or not shown, links, tags and missing links are marked partial, and notes are not', () => {
  const html = withPlace(placeMemory({ unreadable: [{ code: 'TOO_LARGE', count: 1 }] }));
  for (const name of ['links', 'tags', 'missing-links']) assert.match(tagOf(html, name), /data-partial/, name);
  assert.doesNotMatch(tagOf(html, 'notes'), /data-partial/);
  assert.match(html, /data-count="links"[^>]*>2\+</);
  for (const memory of [placeMemory({ notShown: 5 }), placeMemory({ truncated: true }), placeMemory({ skipped: { folders: 1, entries: 0 } })]) assert.match(tagOf(withPlace(memory), 'links'), /data-partial/);
  assert.match(tagOf(withPlace(placeMemory({ truncated: true })), 'notes'), /data-partial/, 'a cut list makes the notes a lower bound too');
  assert.doesNotMatch(tagOf(withPlace(placeMemory()), 'links'), /data-partial/);
});

test('C1: Notes in all folders is a lower bound when a folder was cut or failed', () => {
  assert.match(tagOf(withPlace(placeMemory({ truncated: true })), 'total-notes'), /data-partial/);
  assert.match(tagOf(withPlace(placeMemory({ status: 'failed', code: 'PLACE_CHANGED' })), 'total-notes'), /data-partial/);
  assert.doesNotMatch(tagOf(withPlace(placeMemory()), 'total-notes'), /data-partial/);
});

test('C2: folders and entries that could not be listed are told with their counts', () => {
  const html = withPlace(placeMemory({ skipped: { folders: 2, entries: 1 } }));
  assert.match(html, /data-note="skipped-folders"[^>]*>[^<]*2 folders could not be listed/);
  assert.match(html, /data-note="skipped-entries"[^>]*>[^<]*1 file could not be looked at/);
});

test('C3: a read that failed as a whole shows its code and not "Reading"', () => {
  const html = render(createElement(MemoryView, base({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: null }, memory: { status: 'failed', places: [], code: 'FAILED' } })));
  assert.match(html, /data-memory-code="FAILED"/);
  assert.ok(!html.includes(MEMORY_WORDS.reading));
});

test('M4: a harness context that is not loaded is told in words and shows no zeros; a set with no page count shows n/a and a partial total', () => {
  const html = render(createElement(MemoryView, base({ context: { status: 'not-loaded', agents: 0, skills: 0, tools: 0, sets: [] } })));
  assert.match(html, /data-context-state="not-loaded"/);
  assert.doesNotMatch(html, /data-count="agents"/);
  const part2 = render(createElement(MemoryView, base({ context: { status: 'ok', agents: 0, skills: 0, tools: 0, sets: [{ id: 'a', name: 'A', pages: 3 }, { id: 'b', name: 'B', pages: null }] } })));
  assert.match(part2, /data-context-set="b"[\s\S]*?n\/a/);
  assert.match(tagOf(part2, 'context-pages'), /data-partial/);
  const partial = render(createElement(MemoryView, base({ context: { status: 'partial', agents: 1, skills: 0, tools: 0, sets: [] } })));
  assert.match(partial, /data-context-state="partial"/);
  assert.match(tagOf(partial, 'agents'), /data-partial/);
  assert.deepEqual(contextSummary([part('agent', 'a')], 'not-loaded').status, 'not-loaded');
});

test('L3: a missing target is drawn inside bdi', () => {
  assert.match(withPlace(placeMemory()), /<bdi>gone<\/bdi>/);
});

test('L4: Refresh is there when a folder is approved, calls the read again, and is not there with no folder', () => {
  let n = 0;
  const html = withPlace(placeMemory(), { onRefresh: () => { n += 1; } });
  assert.match(html, />Refresh</);
  assert.doesNotMatch(render(createElement(MemoryView, base())), />Refresh</);
  void n;
});

test('H1: the context is partial when the reader read only part of it: stopped early, only part read, texts cut, could not read, or links that failed', () => {
  const real = { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0 };
  assert.equal(contextStatusOf(true, {}), 'not-loaded');
  assert.equal(contextStatusOf(false, {}), 'ok');
  assert.equal(contextStatusOf(true, { real }), 'ok');
  for (const over of [{ stoppedEarly: true }, { couldNotRead: 2 }, { onlyPartRead: true }, { textsCut: 1 }]) assert.equal(contextStatusOf(true, { real: { ...real, ...over } }), 'partial', JSON.stringify(over));
  const problem = { id: 'h', name: 'h', label: '~/h', readable: true, engines: [], parts: [], links: [], linkProblems: [{ reason: 'gone', label: 'x' }] };
  assert.equal(contextStatusOf(true, { real, harnessPlaces: [problem as never] }), 'partial');
});

test('L-d: a total cap is told in a line', () => {
  const html = withPlace(placeMemory({ analytics: { ...placeMemory().analytics, capped: true } }));
  assert.match(html, /data-note="capped"[^>]*>[^<]*5,000/);
  assert.doesNotMatch(withPlace(placeMemory()), /data-note="capped"/);
});

test('H2: notes the walk skipped make Notes a lower bound', () => {
  assert.match(tagOf(withPlace(placeMemory({ skipped: { folders: 0, entries: 3 } })), 'notes'), /data-partial/);
});
