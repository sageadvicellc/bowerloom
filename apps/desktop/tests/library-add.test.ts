// Library Add (issue 148), variant C: the pure rules of the small Add form in each Library tab. No screen, no engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_READY, folderStepLines, showSkillsHeading, addState, canAttach, copySources, notesDone, notesRestart, NOTES_START, keeperHeld, notesEdits, skillEdits, skillHeld, targetsFor, KEEPER_EDITS } from '../shared/harness/library-add.js';
import { SavedScanContext, firstSaved, savedReduce } from '../renderer/harness/real/saved-scan.js';
import { WORDS } from '../renderer/harness/words.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { PART_KINDS } from '../shared/harness/types.js';
import type { DefinitionView, FolderInfo, NotesView } from '../shared/engine/types.js';

const folder = (id: string, over: Partial<FolderInfo> = {}): FolderInfo => ({
  id, label: `~/Projects/${id}`, name: id, hasDefinition: true, engines: ['claude-code'], previewEngines: false, installedEngines: [], problem: null, projected: false,
  unfinished: { projection: false, adoption: false }, ...over,
});
const definition = (over: Partial<DefinitionView> = {}): DefinitionView => ({ id: 'd', description: '', engines: ['claude-code'], skills: [], agents: [], instructions: true, sources: [], kits: [], ...over });
const notes = (over: Partial<NotesView> = {}): NotesView => ({
  id: 'notes-1', label: '~/journal', name: 'journal', suggestedName: 'journal', pages: 3, complete: true, history: 'git', lastCommitAt: null, latestReport: null, reportsComplete: true, ...over,
});

test('Add is on for skills, agents and context, and off for tools with a plain reason', () => {
  assert.deepEqual(PART_KINDS.map(k => addState(k).enabled), PART_KINDS.map(k => k !== 'tool'));
  assert.equal(addState('tool').reason, 'Not yet: tools cannot be added from the app.');
  for (const k of ['skill', 'agent', 'context'] as const) assert.equal(addState(k).reason, null);
});

test('only a folder that already holds a harness can take a part, and each folder left out says why', () => {
  const list = [
    folder('ready'), folder('bare', { hasDefinition: false }), folder('broken', { problem: 'harness.json is not valid.' }),
    folder('stopped', { unfinished: { projection: false, adoption: true } }), folder('installed', { projected: true, unfinished: { projection: true, adoption: false } }),
  ];
  const { usable, left } = targetsFor(list);
  assert.deepEqual(usable.map(f => f.id), ['ready', 'installed']);
  assert.deepEqual(left.map(l => l.folder.id), ['bare', 'broken', 'stopped']);
  assert.ok(left.every(l => l.why.length > 0 && l.why.split(' ').length <= 12), 'each reason is a short line');
  assert.match(left[0]!.why, /no harness/i);
  assert.equal(left[1]!.why, 'harness.json is not valid.');
});

test('a skill is copied from another folder that holds a harness, never from the folder that gets it', () => {
  const list = [folder('a'), folder('b'), folder('c', { hasDefinition: false }), folder('d', { problem: 'bad' })];
  assert.deepEqual(copySources(list, 'a').map(f => f.id), ['b']);
  assert.deepEqual(copySources(list, 'b').map(f => f.id), ['a']);
});

test('the edits are ids only', () => {
  assert.deepEqual(skillEdits('summarize', 'folder-2'), [{ kind: 'add-skill', id: 'summarize', from: 'folder-2' }]);
  assert.deepEqual(KEEPER_EDITS, [{ kind: 'add-from-kit', kit: 'wiki-keeper' }]);
  assert.deepEqual(notesEdits(notes({ id: 'notes-9', suggestedName: 'my-notes' })), [{ kind: 'set-source', name: 'my-notes', notesId: 'notes-9' }]);
  const text = JSON.stringify([skillEdits('x', 'y'), KEEPER_EDITS, notesEdits(notes())]);
  assert.doesNotMatch(text, /\/Users|\.bowerloom|SKILL\.md|\/\//, "no path and no file text");
});

test('the form knows when a harness holds the skill or the keeper already', () => {
  const held = definition({ skills: [{ id: 'summarize', name: 'summarize', description: '' }], agents: [{ id: 'notes-keeper', name: 'Notes keeper', description: '', skills: [], notes: [] }] });
  assert.equal(skillHeld(held, 'summarize'), true);
  assert.equal(skillHeld(held, 'other'), false);
  assert.equal(keeperHeld(held), true);
  assert.equal(keeperHeld(definition()), false);
});

test('the reasons a folder is left out, and why tools are off, are short plain lines', () => {
  const reasons = [addState('tool').reason!, ...targetsFor([folder('a', { hasDefinition: false }), folder('b', { unfinished: { projection: false, adoption: true } })]).left.map(l => l.why)];
  for (const line of reasons) { assert.ok(countWords(line) <= LIMITS.hint, line); assert.equal(bannedHere(line), null, line); }
});

test('only a notes state that can really be attached counts as ready', () => {
  for (const how of ['ready', 'parent', 'created', 'report-only', 'git-missing']) assert.equal(canAttach(how), true, how);
  for (const how of ['no-commit', 'refused', 'unreadable', 'anything-else']) assert.equal(canAttach(how), false, how);
});

test('trace 1: choosing notes again clears the earlier folder, so Review never attaches the old one', () => {
  let c = notesDone(NOTES_START, 0, notes({ id: 'notes-1' }), 'ready');
  assert.equal(c.view?.id, 'notes-1');
  c = notesRestart(c);
  assert.equal(c.view, null);
  assert.equal(NOTES_READY(c), false);
  c = notesDone(c, c.gen, notes({ id: 'notes-2' }), 'ready');
  assert.equal(c.view?.id, 'notes-2');
});

test('trace 2: a folder that cannot be attached is not ready, and an earlier ready folder does not stay', () => {
  let c = notesDone(NOTES_START, 0, notes({ id: 'notes-1' }), 'ready');
  for (const how of ['no-commit', 'refused', 'unreadable']) {
    const next = notesDone(c, c.gen, notes({ id: 'notes-9', history: 'refused' }), how);
    assert.equal(next.view, null, how);
    assert.equal(NOTES_READY(next), false, how);
  }
  c = notesDone(c, c.gen, notes({ id: 'notes-3' }), 'report-only');
  assert.equal(c.view?.id, 'notes-3');
});

test('trace 3: a late answer from a step that was left is ignored', () => {
  const first = notesRestart(NOTES_START);
  const late = notesDone(first, NOTES_START.gen, notes({ id: 'late' }), 'ready');
  assert.equal(late.view, null);
  assert.equal(late, first, 'the choice is the same object: nothing changed');
});

test('a write marks the read on the screen as changed, and only when there is a read', () => {
  const none = savedReduce(firstSaved(), { type: 'wrote' });
  assert.equal(none.changed, false, 'with no read there is nothing to call old');
  const read = savedReduce(firstSaved(), { type: 'read', atMs: 5 });
  const after = savedReduce(read, { type: 'wrote' });
  assert.equal(after.changed, true);
  assert.equal(after.readAtMs, 5);
  assert.equal(savedReduce(after, { type: 'read', atMs: 9 }).changed, false, 'a new read clears it');
  assert.equal(typeof SavedScanContext, 'object');
});

test('the new Library lines are short plain words', () => {
  for (const line of [WORDS.hint.noFileRead, WORDS.hint.libraryStale]) { assert.ok(countWords(line) <= LIMITS.hint, line); assert.equal(bannedHere(line), null, line); }
});

test('the folder step says "no folder has a harness" only when the list was read and is empty, and offers Try again when the read was refused', () => {
  assert.deepEqual(folderStepLines({ listed: true, refused: false, usable: 0, busy: false, bridge: true }), { noTargets: true, tryAgain: false });
  assert.deepEqual(folderStepLines({ listed: false, refused: true, usable: 0, busy: false, bridge: true }), { noTargets: false, tryAgain: true });
  assert.deepEqual(folderStepLines({ listed: false, refused: false, usable: 0, busy: true, bridge: true }), { noTargets: false, tryAgain: false }, 'still reading');
  assert.deepEqual(folderStepLines({ listed: true, refused: false, usable: 2, busy: false, bridge: true }), { noTargets: false, tryAgain: false });
  assert.deepEqual(folderStepLines({ listed: false, refused: false, usable: 0, busy: false, bridge: false }), { noTargets: false, tryAgain: false }, 'no bridge: its own line');
  // A refusal of a later read never turns a list that was read into a failed one.
  assert.deepEqual(folderStepLines({ listed: true, refused: true, usable: 0, busy: false, bridge: true }), { noTargets: true, tryAgain: false });
});

test('the "Which skill?" heading shows only once the skills are read', () => {
  assert.equal(showSkillsHeading(null), false);
  assert.equal(showSkillsHeading([]), true);
});
