// A part that is added to a harness is placed once, below the lowest card of its column, and nothing else moves because it came or went. The prototype store
// (`addPart`) and the real Builder's folder drafts (`copySkill` and the other steps) both use `settleAdded`. Made-up data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { graphOf } from '../shared/harness/layout.js';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import { harnessById } from '../shared/harness/status.js';
import { addPart, removePart } from '../shared/harness/store.js';
import { copySkill, definitionWorld, draftView } from '../shared/harness/save-draft.js';
import { folderDraftsReduce } from '../renderer/harness/folder-draft.js';
import type { FolderDrafts } from '../renderer/harness/folder-draft.js';
import type { DefinitionView } from '../shared/engine/types.js';
import type { HarnessState } from '../shared/harness/types.js';

const NOW = { at: '2026-10-31T10:00:00Z', who: 'Robin', where: 'this Mac' } as never;

/** The sample world with the saved places of the weekly harness taken away: one missing card, no saved place at all. */
function unplaced(): HarnessState {
  const s = createSampleWorld();
  return { ...s, harnesses: s.harnesses.map(h => (h.id === SAMPLE_IDS.weekly ? { ...h, positions: {} } : h)) };
}
const placeOf = (state: HarnessState, id: string): [number, number] | undefined => {
  const n = graphOf(state, harnessById(state, SAMPLE_IDS.weekly)!).nodes.find(x => x.id === id);
  return n === undefined ? undefined : [n.x, n.y];
};

test('with no saved place and one missing card, adding a part moves no card and does not land on the missing card', () => {
  const s = unplaced(), before = graphOf(s, harnessById(s, SAMPLE_IDS.weekly)!);
  assert.ok(before.nodes.some(n => n.id === 'missing-translate'));
  const added = addPart(s, SAMPLE_IDS.weekly, 'tool-notes-search', NOW), after = graphOf(added, harnessById(added, SAMPLE_IDS.weekly)!);
  for (const n of before.nodes) assert.deepEqual(after.nodes.find(x => x.id === n.id), n, `${n.id} did not move`);
  const fresh = after.nodes.find(n => n.id === 'tool-notes-search')!, missing = after.nodes.find(n => n.id === 'missing-translate')!;
  assert.ok(fresh.y >= missing.y + missing.h || fresh.y + fresh.h <= missing.y, 'no overlap');
  assert.equal(fresh.y, missing.y + 76, 'below the lowest card');
});

test('adding and removing parts one after another moves no card that nobody moved', () => {
  let s = unplaced();
  const first = createSampleWorld().parts.filter(p => p.kind !== 'agent' && !harnessById(s, SAMPLE_IDS.weekly)!.partIds.includes(p.id)).slice(0, 3).map(p => p.id);
  const base = graphOf(s, harnessById(s, SAMPLE_IDS.weekly)!);
  for (const id of first) s = addPart(s, SAMPLE_IDS.weekly, id, NOW);
  const placed = new Map(first.map(id => [id, placeOf(s, id)]));
  assert.equal(new Set([...placed.values()].map(v => v!.join(','))).size, first.length, 'each new part has its own place');
  for (const n of base.nodes) assert.deepEqual(placeOf(s, n.id), [n.x, n.y], n.id);
  s = removePart(s, SAMPLE_IDS.weekly, first[0]!, NOW);
  for (const n of base.nodes) assert.deepEqual(placeOf(s, n.id), [n.x, n.y], `${n.id} after a removal`);
  for (const id of first.slice(1)) assert.deepEqual(placeOf(s, id), placed.get(id), `${id} after a removal`);
});

// ---- the real Builder: folder drafts ---------------------------------------------------------------------------------------

const BASE: DefinitionView = {
  id: 'rope-yard', description: 'Makes rope.', engines: ['claude-code'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }],
  sources: [{ name: 'reading-list', kind: 'wiki-folder', label: '~/Documents/Reading list', notesId: 'notes-1' }], kits: [],
};
const copy = (id: string) => ({ id, from: 'folder-2', fromLabel: '~/Projects/other', name: id, description: 'Copied.' });
const graphAt = (drafts: FolderDrafts, folder = 'folder-1') => {
  const e = drafts[folder]!, w = definitionWorld(draftView(e.base!, e.stack.present));
  return graphOf(w.state, w.harness, e.positions);
};

test('a skill copied into the folder lands below the lowest card, never on a card the person dragged there', () => {
  let d: FolderDrafts = folderDraftsReduce({}, { kind: 'loaded', folder: 'folder-1', base: BASE, versions: null });
  const start = graphAt(d), lowest = Math.max(...start.nodes.filter(n => n.kind !== 'agent').map(n => n.y));
  // The person drags the notes card to the slot where the next card would go.
  d = folderDraftsReduce(d, { kind: 'move', folder: 'folder-1', node: 'notes:reading-list', at: { x: 440, y: lowest + 76 } });
  const dragged = graphAt(d);
  d = folderDraftsReduce(d, { kind: 'change', folder: 'folder-1', next: draft => copySkill(BASE, draft, copy('tie-knots'), true) });
  const after = graphAt(d), fresh = after.nodes.find(n => n.id === 'skill:tie-knots')!;
  assert.ok(fresh, 'the copied skill is drawn');
  const others = after.nodes.filter(n => n.id !== fresh.id && n.kind !== 'agent');
  assert.ok(others.every(n => fresh.y >= n.y + n.h || fresh.y + fresh.h <= n.y), 'no card under the new one');
  for (const n of dragged.nodes) assert.deepEqual(after.nodes.find(x => x.id === n.id), n, `${n.id} did not move`);
});

test('undo, redo and a second copy move no card; the copied skill keeps its place', () => {
  let d: FolderDrafts = folderDraftsReduce({}, { kind: 'loaded', folder: 'folder-1', base: BASE, versions: null });
  const start = graphAt(d);
  d = folderDraftsReduce(d, { kind: 'change', folder: 'folder-1', next: draft => copySkill(BASE, draft, copy('tie-knots'), true) });
  const one = graphAt(d).nodes.find(n => n.id === 'skill:tie-knots')!;
  d = folderDraftsReduce(d, { kind: 'change', folder: 'folder-1', next: draft => copySkill(BASE, draft, copy('coil-rope'), true) });
  const two = graphAt(d);
  assert.deepEqual(two.nodes.find(n => n.id === 'skill:tie-knots'), one, 'the first copy did not move');
  assert.ok(two.nodes.find(n => n.id === 'skill:coil-rope')!.y > one.y);
  d = folderDraftsReduce(d, { kind: 'undo', folder: 'folder-1' });
  d = folderDraftsReduce(d, { kind: 'undo', folder: 'folder-1' });
  for (const n of start.nodes) assert.deepEqual(graphAt(d).nodes.find(x => x.id === n.id), n, `${n.id} after undo`);
  d = folderDraftsReduce(d, { kind: 'redo', folder: 'folder-1' });
  assert.deepEqual(graphAt(d).nodes.find(n => n.id === 'skill:tie-knots'), one, 'redo puts the copy where it was');
});
