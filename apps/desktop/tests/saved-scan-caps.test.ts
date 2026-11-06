// The caps of a saved read, held against the reader's own largest answers and against planted files. A read the reader can really make must always pass (a wrong guess about a cap
// would delete a good read), and a file past what the reader can make must be refused before it makes the window do heavy work. Timings are printed so a reviewer can see them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { SAVED_SCAN_CAPS, SAVED_SCAN_VERSION, parseSavedScan } from '../shared/real/saved-scan.js';
import type { SavedScan } from '../shared/real/saved-scan.js';
import type { NoteEntry, PlaceRead, StampedRecord } from '../shared/real/place.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { hashText } from '../shared/world/sample.js';

const TALLY = { tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, brokenLinks: 0, stoppedEarly: false, truncated: false, overBytes: false, samples: { tooBig: [], binary: [], unreadable: [], linksOutside: [], brokenLinks: [] } };
const note = (folder: string, i: number): NoteEntry => ({ rel: `${folder}/n${i}.md`, folder, title: `Note ${folder} ${i}`, summary: 'A note.', tags: ['a'], type: 'note', bytes: 10, mtimeMs: 1 });
const skill = (i: number): StampedRecord => ({ kind: 'skill', app: 'claude-code', name: `skill-${i}`, slug: `skill-${i}`, description: 'A skill.', relPath: `skills/s${i}/SKILL.md`, text: 'Do it.', partial: false, meta: {}, mtimeMs: 1 });
const emptyTally = { ...TALLY } as unknown as PlaceRead['tally'];

/** A place of notes: 13 folders of 3 pages each, so the reader makes the set of the whole place and 12 topic sets. */
function noteyPlace(i: number): PlaceRead {
  const notes: NoteEntry[] = [];
  for (let t = 0; t < 13; t += 1) for (let p = 0; p < 3; p += 1) notes.push(note(`topic-${t}`, p));
  return { place: { id: `place-${String(i).padStart(12, '0')}`, kind: 'project', label: `proj ${i}`, path: `~/proj-${i}`, apps: [] }, records: [], notes, notesLeftOut: 0, partlyRead: 0, folders: [], tally: emptyTally };
}
const homeWith = (skills: number): PlaceRead => ({ place: { id: 'place-aaaaaaaaaaaa', kind: 'home', label: 'Claude Code at home', path: '~', apps: ['claude-code'] }, records: Array.from({ length: skills }, (_, i) => skill(i)), notes: [], notesLeftOut: 0, partlyRead: 0, folders: ['.claude'], tally: emptyTally });
const summary = (read: PlaceRead): RealPlace => ({ id: read.place.id, label: read.place.label, kind: read.place.kind, apps: [], appLabel: 'x', counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: read.notes.length }, empty: false, details: { path: read.place.path, folders: [], topics: [], notes: [] } });
const keep = (result: RealResult, reads: readonly PlaceRead[]): SavedScan => ({ version: SAVED_SCAN_VERSION, savedAtMs: 1, fingerprint: 'c'.repeat(64), chosen: reads.map(summary), result });
const ms = (start: number): number => Math.round(Date.now() - start);

test('the reader\'s own answer for 30 note-rich places passes, as does the one for the most places it can hold', () => {
  for (const places of [30, REAL_LIMITS.places - 1]) {
    const reads = Array.from({ length: places }, (_, i) => noteyPlace(i));
    const result = buildRealResult(reads, TALLY, { nowMs: 1, foldExtraApps: true });
    assert.ok(result.world.slices.length >= places * 13, `${places} places make ${result.world.slices.length} sets of notes`);
    const text = JSON.stringify(keep(result, reads));
    const parsed = parseSavedScan(text);
    assert.equal(parsed.ok, true, `${places} places: ${parsed.ok ? '' : parsed.why}`);
  }
});

test('the biggest legal read (the most places with notes, and as many skills as one read can hand on) passes, and is mapped well inside a second', () => {
  const reads = [homeWith(9_000), ...Array.from({ length: REAL_LIMITS.places - 1 }, (_, i) => noteyPlace(i))];
  const result = buildRealResult(reads, TALLY, { nowMs: 1, foldExtraApps: true });
  assert.ok(result.world.items.length > REAL_LIMITS.itemsPerCall - 2_000, `${result.world.items.length} items`);
  const parsedAt = Date.now(), parsed = parseSavedScan(JSON.stringify(keep(result, reads)));
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.why);
  const parseMs = ms(parsedAt), mapAt = Date.now();
  realToHarnessState(result, reads.map(summary));
  const mapMs = ms(mapAt);
  console.log(`maximal legal read: ${result.world.items.length} items, ${result.world.slices.length} slices, ${result.world.wikiPages.length} pages: parse ${parseMs} ms, map ${mapMs} ms`);
  assert.ok(mapMs < 1_000, `mapped in ${mapMs} ms`);
});

/** A file the reader could never make, built to the edge of the caps: as many items, pages, scopes and sets as are allowed, every set matching every page. */
function planted(change: (world: Record<string, unknown>) => void = () => undefined): string {
  const places = REAL_LIMITS.places, C = SAVED_SCAN_CAPS;
  const scopes = Array.from({ length: places + 1 }, (_, i) => ({ id: `s${i}`, kind: i === 0 ? 'global' : 'project', name: `n${i}`, parentId: null, path: '~' }));
  const slices: Record<string, unknown>[] = [], sliceItems: Record<string, unknown>[] = [];
  for (let k = 0; k < places; k += 1) {
    const key = hashText(`k${k}`).slice(0, 16);
    for (let t = 0; t < 13; t += 1) {
      const id = t === 0 ? `real-notes-${key}` : `real-notes-${key}-${hashText(`t${t}`).slice(0, 16)}`;
      slices.push({ id, name: 'n', seeds: [], rule: { folders: ['f', 'f', 'f', 'f', 'f'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false });
      sliceItems.push({ id: `item-${id}`, kind: 'context-slice', name: 'n', scopeId: 's1', foundAt: [], library: null, sliceId: id });
    }
  }
  const skills = Array.from({ length: C.items - sliceItems.length }, (_, i) => ({ id: `k${i}`, kind: 'skill', name: 'n', scopeId: `s${i % places}`, foundAt: [], library: null, description: 'd' }));
  const pages = Array.from({ length: C.wikiPages }, (_, i) => ({ id: `p${i}`, title: `Title ${i}`, folder: 'f', type: 'note', tags: [], summary: '', bytes: 1, links: [], joinedSinceVisit: false }));
  const world: Record<string, unknown> = { interfaces: [], items: [...skills, ...sliceItems], scopes, overrides: [], wikiPages: pages, slices, versions: [], libraries: [] };
  change(world);
  const chosen = [{ id: 'place-0123456789ab', label: 'x', kind: 'home', apps: [], appLabel: 'x', counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, empty: true, details: { path: '~', folders: [], topics: [], notes: [] } }];
  return JSON.stringify({ version: 1, savedAtMs: 1, fingerprint: 'd'.repeat(64), chosen, result: { world, others: [], counts: chosen[0]!.counts, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true } });
}

test('a planted file at the very edge of every cap is mapped in a bounded time, or refused', () => {
  const text = planted(), at = Date.now(), parsed = parseSavedScan(text), parseMs = ms(at);
  if (!parsed.ok) { console.log(`planted edge file refused (${parsed.why}) in ${parseMs} ms`); return; }
  const mapAt = Date.now();
  try { realToHarnessState(parsed.scan.result, parsed.scan.chosen); } catch { /* a throw is fast and is damaged */ }
  const mapMs = ms(mapAt);
  console.log(`planted edge file accepted: parse ${parseMs} ms, map ${mapMs} ms`);
  assert.ok(mapMs < 2_000, `mapped in ${mapMs} ms`);
});

test('10,000 items with a slice of 20 folders, and 1,000,000 folders, are refused at once', () => {
  const folders = (n: number): string[] => Array.from({ length: n }, () => 'f');
  for (const count of [20, 1_000_000]) {
    const text = planted(w => {
      const slices = w.slices as Record<string, unknown>[];
      slices[0] = { ...slices[0], rule: { folders: folders(count), pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } };
    });
    const at = Date.now(), parsed = parseSavedScan(text);
    assert.equal(parsed.ok, false, `${count} folders`);
    assert.ok(ms(at) < 1_000, `refused in ${ms(at)} ms`);
  }
});

test('the structure of the sets of notes is held to what the reader makes', () => {
  const edit = (change: (slices: Record<string, unknown>[], items: Record<string, unknown>[]) => void): string => planted(w => change(w.slices as Record<string, unknown>[], w.items as Record<string, unknown>[]));
  const bad: [string, (s: Record<string, unknown>[], i: Record<string, unknown>[]) => void][] = [
    ['a set with an id that is not the reader\'s', s => { s[0] = { ...s[0], id: 'whatever' }; }],
    ['two sets with one id', s => { s[1] = { ...s[1], id: s[0]!.id }; }],
    ['a set with no folders', s => { s[0] = { ...s[0], rule: { ...(s[0]!.rule as object), folders: [] } }; }],
    ['a folder that is not text', s => { s[0] = { ...s[0], rule: { ...(s[0]!.rule as object), folders: [5] } }; }],
    ['a folder of 10,000 characters', s => { s[0] = { ...s[0], rule: { ...(s[0]!.rule as object), folders: ['f'.repeat(10_000)] } }; }],
    ['a rule that is not an object', s => { s[0] = { ...s[0], rule: 'x' }; }],
    ['a context item for a set that is not there', (_s, i) => { const at = i.findIndex(x => x.kind === 'context-slice'); i[at] = { ...i[at], sliceId: 'nowhere' }; }],
  ];
  for (const [what, change] of bad) assert.equal(parseSavedScan(edit(change)).ok, false, what);
});

test('an agent with a list of a million skills is refused at once', () => {
  const text = planted(w => { (w.items as Record<string, unknown>[])[0] = { id: 'a', kind: 'agent', name: 'n', scopeId: 's1', foundAt: [], library: null, definition: { name: 'n', role: 'r', instructions: '', skillIds: Array.from({ length: 1_000_000 }, () => 's'), toolAttachments: [] } }; });
  const at = Date.now();
  assert.equal(parseSavedScan(text).ok, false);
  assert.ok(ms(at) < 1_000);
});

test('a file past a cap is told as too big, and a wrong shape is told as a wrong shape', () => {
  const items = planted(w => { (w.items as unknown[]).push(...Array.from({ length: 5_000 }, (_, i) => ({ id: `x${i}`, kind: 'skill', name: 'n', scopeId: 's1', foundAt: [], library: null, description: 'd' }))); });
  assert.deepEqual(parseSavedScan(items), { ok: false, why: 'too-big' });
  assert.deepEqual(parseSavedScan(planted(w => { (w.items as unknown[])[0] = 5; })), { ok: false, why: 'bad-shape' });
});

test('agents at the edge of their list caps are mapped in a bounded time, or refused', () => {
  const text = planted(w => {
    const items = w.items as Record<string, unknown>[];
    for (let i = 0; i < 1_500; i += 1) {
      items[i] = { id: `a${i}`, kind: 'agent', name: `agent ${i}`, scopeId: 's1', foundAt: [], library: null, extras: [], definition: { name: 'n', role: 'r', instructions: '', skillIds: Array.from({ length: 200 }, (_, k) => `k${k}`), toolAttachments: Array.from({ length: 200 }, (_, k) => ({ toolId: `t${k}`, access: 'read-only' })) } };
    }
  });
  const at = Date.now(), parsed = parseSavedScan(text), parseMs = ms(at);
  if (!parsed.ok) { console.log(`planted agents file refused (${parsed.why}) in ${parseMs} ms`); return; }
  const mapAt = Date.now();
  try { realToHarnessState(parsed.scan.result, parsed.scan.chosen); } catch { /* a throw is fast */ }
  const mapMs = ms(mapAt);
  console.log(`planted agents file accepted (${Math.round(text.length / 1e6)} MB): parse ${parseMs} ms, map ${mapMs} ms`);
  assert.ok(mapMs < 2_000, `mapped in ${mapMs} ms`);
});

test('20,000 agents that each name a set of notes (the reader never does) are refused at once, and the file is not called a wrong shape', () => {
  const text = planted(w => {
    const items = w.items as Record<string, unknown>[], sliceId = (items.filter(x => x.kind === 'context-slice').pop() as { sliceId: string }).sliceId;
    for (let i = 0; i < 20_000; i += 1) items[i] = { id: `a${i}`, kind: 'agent', name: `agent ${i}`, scopeId: 's1', foundAt: [], library: null, extras: [], definition: { name: 'n', role: 'r', instructions: '', sliceId, skillIds: [], toolAttachments: [] } };
  });
  const at = Date.now(), parsed = parseSavedScan(text), refusedMs = ms(at);
  console.log(`20,000 agents with a set of notes: ${Math.round(text.length / 1e6)} MB, refused (${parsed.ok ? 'NOT refused' : parsed.why}) in ${refusedMs} ms`);
  assert.deepEqual(parsed, { ok: false, why: 'unsupported' });
  assert.ok(refusedMs < 1_000);
});

test('two sets of notes with one id (two folder names that meet under the id hash) are refused without being called a wrong shape, so the file is left', () => {
  const text = planted(w => { const s = w.slices as { id: string }[]; s[1] = { ...s[1]!, id: s[0]!.id }; });
  assert.deepEqual(parseSavedScan(text), { ok: false, why: 'unsupported' });
});

test('a read that has a few more pages or others than the per-call cap, as the reader can hand over, passes', () => {
  const edge = REAL_LIMITS.itemsPerCall + 1;
  const pages = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: 't', folder: 'f', type: 'note', tags: [], summary: '', bytes: 1, links: [], joinedSinceVisit: false }));
  assert.equal(parseSavedScan(planted(w => { w.wikiPages = pages(edge); })).ok, true, 'one page past the cap');
  assert.equal(parseSavedScan(planted(w => { w.wikiPages = pages(REAL_LIMITS.itemsPerCall + REAL_LIMITS.places + 1); })).ok, false, 'a margin, not a free-for-all');
});
