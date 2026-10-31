// Undo for one change, alone: the store remembers the edits that made the draft, `withdraw` replays the others, and the Save bar's list says which rows can go alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, draftActions, reduceStore, snapshotOf } from '../shared/world/store.js';
import type { StoreAction, StoreState } from '../shared/world/store.js';
import type { AgentItem } from '../shared/world/types.js';
import { UNDO_WORDS, changeEntries, placeOf, stillInDraft } from '../shared/home/change-undo.js';
import { libraryChangeCount } from '../shared/home/library-changes.js';
import { addToAgentAction, planAdd, removeFromLibraryAction } from '../shared/home/library-actions.js';
import { SAMPLE_SOURCES, defaultTicked } from '../shared/home/library-sources.js';
import { withStartPoint } from '../shared/home/savebar.js';
import { chooseNotesAction } from '../shared/home/notes-actions.js';
import { countWords } from '../shared/home/textbudget.js';
import { plainNameOf, plainNameOfSaved } from '../shared/home/plain-names.js';
import { savePointRows } from '../shared/home/points.js';
import { libraryWorld } from './home-library-world.js';
import { keepCopyAction } from '../shared/home/add-copies.js';
import { readSharedFile } from '../shared/home/add-file.js';
import { plainName } from '../shared/home/add-model.js';
import { importFileAction } from '../renderer/home/store-actions.js';
import { buildShare } from '../shared/home/share-model.js';
import { bundleText } from '../shared/world/export-flow.js';

const fresh = (): StoreState => { const w = withStartPoint(libraryWorld()); return { committed: w, draft: w, undoStack: [], redoStack: [], headVersionId: w.versions[0]!.id }; };
const act = (s: StoreState, a: StoreAction | null): StoreState => { assert.ok(a !== null); return reduceStore(s, a); };
const agent = (s: StoreState, id: string): AgentItem => s.draft.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === id)!;
const texts = (s: StoreState): string[] => changeEntries(s).map(e => e.text);
const detach = (agentId: string, skillId: string): StoreAction => ({ type: 'detachSkill', agentId, skillId });
const withdraw = (s: StoreState, at: readonly number[]): StoreState => reduceStore(s, { type: 'withdraw', at });

test('the store remembers the edits that made the draft, in order, and a draft that is the saved world has none', () => {
  const s0 = fresh();
  assert.deepEqual(draftActions(s0), []);
  const a = agent(s0, 'agent-01'), first = a.definition.skillIds[0]!, second = a.definition.skillIds[1]!;
  const one = detach('agent-01', first), two = detach('agent-01', second);
  const s2 = act(act(s0, one), two);
  assert.deepEqual(draftActions(s2), [one, two]);
  assert.equal(placeOf(s2, two), 1);
  assert.equal(placeOf(s2, {}), -1);
});

test('an edit that changes nothing is not remembered', () => {
  const s0 = fresh(), skill = agent(s0, 'agent-01').definition.skillIds[0]!;
  const s1 = act(s0, detach('agent-01', skill));
  const again = reduceStore(s1, detach('agent-01', skill));
  assert.equal(again, s1);
  assert.equal(draftActions(s1)!.length, 1);
});

test('a draft put together by hand has no edits to withdraw: the answer is "cannot say" and nothing changes', () => {
  const s0 = fresh();
  const world = { ...s0.committed, items: s0.committed.items.slice(1) };
  const hand: StoreState = { ...s0, draft: world };
  assert.equal(draftActions(hand), null);
  assert.equal(withdraw(hand, [0]), hand);
  assert.ok(changeEntries(hand).every(e => e.undo === null && e.reason === UNDO_WORDS.unknown));
});

test('one removal of two is taken back alone, in the place it had, and the other stays', () => {
  const s0 = fresh(), ids = agent(s0, 'agent-01').definition.skillIds;
  const s2 = act(act(s0, detach('agent-01', ids[0]!)), detach('agent-01', ids[1]!));
  const rows = changeEntries(s2);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.undo !== null && r.reason === null));
  const back = withdraw(s2, rows[0]!.undo!.at);
  assert.deepEqual(agent(back, 'agent-01').definition.skillIds, ids.filter(id => id !== ids[1]), 'the first skill is back in its place; the second stays off');
  assert.equal(snapshotOf(back.draft), snapshotOf(act(s0, detach('agent-01', ids[1]!)).draft), 'the same draft as if only the second removal had been made');
  assert.equal(libraryChangeCount(back.committed, back.draft), 1);
  assert.deepEqual(draftActions(back), [draftActions(s2)![1]]);
});

test('withdrawing the last change leaves a draft equal to the saved world, and the plain undo and redo still work after it', () => {
  const s0 = fresh(), skill = agent(s0, 'agent-01').definition.skillIds[0]!;
  const s1 = act(s0, detach('agent-01', skill));
  const gone = withdraw(s1, [0]);
  assert.equal(libraryChangeCount(gone.committed, gone.draft), 0);
  assert.equal(gone.undoStack.length, 2, 'the withdrawal is a step too');
  const undone = reduceStore(gone, { type: 'undo' });
  assert.equal(libraryChangeCount(undone.committed, undone.draft), 1, 'Ctrl+Z brings the removal back');
  assert.equal(changeEntries(undone).length, 1, 'and its edits are known again');
  const redone = reduceStore(undone, { type: 'redo' });
  assert.equal(libraryChangeCount(redone.committed, redone.draft), 0);
});

test('a bad place is refused and the very same state comes back', () => {
  const s1 = act(fresh(), detach('agent-01', agent(fresh(), 'agent-01').definition.skillIds[0]!));
  for (const at of [[], [5], [-1], [0.5], [Number.NaN]]) assert.equal(withdraw(s1, at), s1, JSON.stringify(at));
});

test('each kind of change the bar lists can be undone alone: remove, add, notes, library actions', () => {
  const s0 = fresh(), w = s0.draft;
  const steps: [string, StoreAction | null][] = [
    ['remove a skill', detach('agent-02', agent(s0, 'agent-02').definition.skillIds[0]!)],
    ['remove a tool', { type: 'detachTool', agentId: 'agent-01', toolId: agent(s0, 'agent-01').definition.toolAttachments[0]!.toolId }],
    ['add a skill to an agent', addToAgentAction(w, 'skill', 'skill-003', 'agent-05')],
    ['remove from the library', removeFromLibraryAction('skill-010')],
    ['add from the web', planAdd(w, SAMPLE_SOURCES[2]!, defaultTicked(SAMPLE_SOURCES[2]!)).action],
  ];
  for (const [what, action] of steps) {
    assert.ok(action !== null, what);
    const s1 = act(s0, action);
    const rows = changeEntries(s1);
    assert.ok(rows.length >= 1, what);
    assert.ok(rows.every(r => r.undo !== null), `${what}: ${JSON.stringify(rows)}`);
    let s = s1;
    for (const row of rows) { const next = withdraw(s, changeEntries(s).find(e => e.key === row.key)!.undo!.at); assert.notEqual(next, s, what); s = next; }
    assert.equal(libraryChangeCount(s.committed, s.draft), 0, `${what}: nothing is left`);
    assert.equal(snapshotOf(s.draft), snapshotOf(s0.draft), `${what}: the draft is the saved world again`);
  }
});

test('a run that one press made (seven things from the web) is one row, and its undo takes all seven', () => {
  const s0 = fresh(), office = SAMPLE_SOURCES[0]!;
  const s1 = act(s0, planAdd(s0.draft, office, defaultTicked(office)).action);
  const rows = changeEntries(s1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.changes, 7);
  assert.equal(libraryChangeCount(s1.committed, s1.draft), 7);
  const back = withdraw(s1, rows[0]!.undo!.at);
  assert.equal(libraryChangeCount(back.committed, back.draft), 0);
});

test('a change that a later one depends on cannot be undone alone: it says the later change goes first, and the later one can go', () => {
  const s0 = fresh(), source = SAMPLE_SOURCES[2]!;
  const s1 = act(s0, planAdd(s0.draft, source, defaultTicked(source)).action);
  const added = s1.draft.items.find(i => !s0.draft.items.some(o => o.id === i.id) && i.kind === 'skill')!;
  const s2 = act(s1, addToAgentAction(s1.draft, 'skill', added.id, 'agent-05'));
  const rows = changeEntries(s2);
  const early = rows.find(r => r.undo === null);
  assert.ok(early !== undefined, JSON.stringify(rows));
  assert.equal(early.reason, UNDO_WORDS.later);
  const late = rows.find(r => r.text.includes(' to '));
  assert.ok(late !== undefined && late.undo !== null);
  const s3 = withdraw(s2, late.undo!.at);
  const rows3 = changeEntries(s3);
  assert.ok(rows3.every(r => r.undo !== null), 'with the later change gone, the earlier one can go');
});

test('notes chosen twice for one agent are one row, and it goes with both steps', () => {
  const s0 = fresh();
  const choice = (folders: string[]) => ({ rule: { folders, pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, seeds: [] as string[] });
  const folder = (s0.draft.wikiPages.find(p => p.folder !== '')?.folder ?? '').split('/')[0]!;
  const a = chooseNotesAction('agent-01', 'Meeting assistant', choice([folder]));
  const s1 = act(s0, a);
  assert.ok(libraryChangeCount(s1.committed, s1.draft) >= 1);
  const rows = changeEntries(s1);
  assert.ok(rows.every(r => r.undo !== null));
  let s = s1;
  for (const r of rows) s = withdraw(s, changeEntries(s).find(e => e.key === r.key)!.undo!.at);
  assert.equal(libraryChangeCount(s.committed, s.draft), 0);
});

test('the same notes chosen a second time change the first choice in place: still one row, and undoing it takes both steps', () => {
  const s0 = fresh();
  const rule = (folders: string[]) => ({ folders, pageTypesAndTags: { types: [] as string[], tags: [] as string[] }, linksFromSeeds: null });
  const folders = [...new Set(s0.draft.wikiPages.map(p => p.folder.split('/')[0]!).filter(f => f !== ''))];
  assert.ok(folders.length >= 2);
  const first = reduceStore(s0, { type: 'chooseNotes', agentId: 'agent-01', name: 'Meeting assistant notes', rule: rule([folders[0]!]), seeds: [] });
  const second = reduceStore(first, { type: 'chooseNotes', agentId: 'agent-01', name: 'Meeting assistant notes', rule: rule([folders[1]!]), seeds: [] });
  assert.equal(draftActions(second)!.length, 2);
  const rows = changeEntries(second);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.undo?.at, [0, 1]);
  const back = withdraw(second, rows[0]!.undo!.at);
  assert.equal(libraryChangeCount(back.committed, back.draft), 0);
});

test('every row has words within the text budget, and the reasons too', () => {
  const s0 = fresh();
  const s1 = act(act(s0, detach('agent-01', agent(s0, 'agent-01').definition.skillIds[0]!)), removeFromLibraryAction('skill-010'));
  for (const row of changeEntries(s1)) assert.ok(countWords(row.text) <= 12, row.text);
  for (const reason of Object.values(UNDO_WORDS)) assert.ok(countWords(reason) <= 12, reason);
});

test('saving clears the edits, and a save point carries the time the screen gave and none when it gave none', () => {
  const store = createStore(withStartPoint(libraryWorld()));
  const skill = agent(store.getState(), 'agent-01').definition.skillIds[0]!;
  store.dispatch(detach('agent-01', skill));
  store.dispatch({ type: 'apply', label: 'Removed a skill', madeAt: 'Today, 8:42' });
  const s = store.getState();
  assert.equal(s.committed.versions[s.committed.versions.length - 1]!.madeAt, 'Today, 8:42');
  assert.deepEqual(draftActions(s), []);
  assert.deepEqual(s.undoStack, []);
  store.dispatch(detach('agent-02', agent(store.getState(), 'agent-02').definition.skillIds[0]!));
  store.dispatch({ type: 'apply', label: 'Removed another' });
  const last = store.getState().committed.versions.at(-1)!;
  assert.equal('madeAt' in last, false, 'a point made without a time has no time');
  store.dispatch({ type: 'restore', versionId: s.committed.versions[0]!.id, madeAt: '  Today, 9:05 ' });
  assert.equal(store.getState().committed.versions.at(-1)!.madeAt, 'Today, 9:05');
  texts(store.getState());
});

test('after a save, the history still calls a thing that was taken out by its plain name, not the name it is stored under', () => {
  const store = createStore(withStartPoint(libraryWorld()));
  const stored = store.getState().draft.items.find(i => i.id === 'skill-003')!.name;
  store.dispatch(removeFromLibraryAction('skill-003'));
  store.dispatch({ type: 'apply', label: 'Removed Translate a text' });
  const world = store.getState().committed;
  assert.notEqual(plainNameOf(world)(stored), 'Translate a text', 'the world alone has forgotten it');
  assert.equal(plainNameOfSaved(world)(stored), 'Translate a text');
  const rows = savePointRows(world, plainNameOfSaved(world));
  assert.equal(rows[0]!.changes, 'Removed Translate a text');
  const broken = { ...world, versions: [...world.versions, { id: 'vx', parentId: null, counter: 99, label: 'x', snapshotJson: '{not json' }] };
  assert.equal(plainNameOfSaved(broken)(stored), 'Translate a text', 'a save point that cannot be read is skipped');
});

test('keeping one of two copies is a change that can be undone alone, and the other copy comes back', () => {
  const s0 = fresh();
  const item = s0.draft.items.find(i => i.id === 'skill-014')!;
  const hashes = new Set(item.foundAt.map(f => f.contentHash));
  assert.ok(hashes.size >= 2, 'the sample skill has two different copies');
  const s1 = act(act(s0, detach('agent-01', agent(s0, 'agent-01').definition.skillIds[0]!)), keepCopyAction('skill-014', { index: 0 }));
  const rows = changeEntries(s1);
  assert.equal(rows.length, 2);
  const kept = rows.find(r => /^Kept one copy of/.test(r.text))!;
  assert.ok(kept !== undefined && kept.undo !== null, JSON.stringify(rows));
  const back = withdraw(s1, kept.undo!.at);
  assert.equal(new Set(back.draft.items.find(i => i.id === 'skill-014')!.foundAt.map(f => f.contentHash)).size, hashes.size, 'both copies are back');
  assert.equal(libraryChangeCount(back.committed, back.draft), 1);
});

test('what a shared file adds is undone alone, whole, and a later change that uses it says the later change goes first', () => {
  const s0 = fresh();
  // A file of one agent, made new so it lands as all new.
  const one = buildShare(s0.draft, ['agent-02']);
  const swap = (x: string): string => `${x}-b`;
  const file = JSON.parse(bundleText(one)) as { items: Record<string, unknown>[]; toolRefs: Record<string, unknown>[]; sliceRules: Record<string, unknown>[] };
  for (const i of file.items) {
    i.id = swap(String(i.id)); i.name = swap(String(i.name));
    const d = i.definition as { name: string; skillIds: string[]; toolAttachments: { toolId: string }[]; sliceId?: string } | undefined;
    if (d !== undefined) { d.name = swap(d.name); d.skillIds = d.skillIds.map(swap); for (const t of d.toolAttachments) t.toolId = swap(t.toolId); if (d.sliceId !== undefined) d.sliceId = swap(d.sliceId); }
  }
  for (const t of file.toolRefs) { t.toolId = swap(String(t.toolId)); t.name = swap(String(t.name)); }
  for (const x of file.sliceRules) { x.sliceId = swap(String(x.sliceId)); x.name = swap(String(x.name)); }
  const read = readSharedFile(JSON.stringify(file), s0.draft, plainName);
  assert.ok(read.ok);
  const s1 = act(s0, importFileAction(read.preview.bundle));
  const rows = changeEntries(s1);
  assert.ok(rows.length >= 1 && libraryChangeCount(s1.committed, s1.draft) >= 2);
  assert.ok(rows.every(r => r.undo !== null), JSON.stringify(rows));
  let s = s1;
  for (const row of rows) s = withdraw(s, changeEntries(s).find(e => e.key === row.key)!.undo!.at);
  assert.equal(libraryChangeCount(s.committed, s.draft), 0);
  assert.equal(snapshotOf(s.draft), snapshotOf(s0.draft));
  // A later change that uses the new agent: the file cannot go before it.
  const added = s1.draft.items.find(i => !s0.draft.items.some(o => o.id === i.id) && i.kind === 'skill')!;
  const s2 = act(s1, addToAgentAction(s1.draft, 'skill', added.id, 'agent-05'));
  const blocked = changeEntries(s2).filter(r => r.undo === null);
  assert.ok(blocked.length >= 1 && blocked.every(r => r.reason === UNDO_WORDS.later), JSON.stringify(changeEntries(s2)));
});

test('a removal is still in the draft until undo, withdraw, discard or save takes it out; a draft with no list of edits never loses its note', () => {
  const s0 = fresh(), ids = agent(s0, 'agent-01').definition.skillIds;
  const one = detach('agent-01', ids[0]!), two = detach('agent-01', ids[1]!);
  const s2 = act(act(s0, one), two);
  assert.equal(stillInDraft(s2, one), true);
  assert.equal(stillInDraft(s2, two), true);
  // Ctrl+Z takes the last removal away: the note about it is stale, the one about the first removal is not.
  const undone = reduceStore(s2, { type: 'undo' });
  assert.equal(stillInDraft(undone, two), false);
  assert.equal(stillInDraft(undone, one), true);
  // Ctrl+Shift+Z puts it back.
  assert.equal(stillInDraft(reduceStore(undone, { type: 'redo' }), two), true);
  // One Undo in the list takes only its own removal.
  const withdrawn = withdraw(s2, [placeOf(s2, one)]);
  assert.equal(stillInDraft(withdrawn, one), false);
  assert.equal(stillInDraft(withdrawn, two), true);
  // Undo all changes and Save leave no removal behind.
  assert.equal(stillInDraft(reduceStore(s2, { type: 'discard' }), one), false);
  assert.equal(stillInDraft(reduceStore(s2, { type: 'apply', label: 'x' }), one), false);
  // A draft put together by hand cannot say: the note stays.
  const hand: StoreState = { ...s0, draft: { ...s0.committed, items: s0.committed.items.slice(1) } };
  assert.equal(stillInDraft(hand, one), true);
});

test('a removal from the library is a remembered edit too, so its note goes with Ctrl+Z', () => {
  const s0 = fresh();
  const removal = removeFromLibraryAction('skill-010');
  const s1 = act(s0, removal);
  assert.equal(stillInDraft(s1, removal), true);
  assert.notEqual(draftActions(s1), null);
  assert.equal(stillInDraft(reduceStore(s1, { type: 'undo' }), removal), false);
});
