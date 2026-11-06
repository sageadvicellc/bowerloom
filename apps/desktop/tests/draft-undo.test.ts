// The undo and redo of the Builder's unsaved changes: a bounded stack of earlier drafts. Saved changes go back through save points instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DRAFT, linkSkill, setDraftEngines } from '../shared/harness/save-draft.js';
import type { SaveDraft } from '../shared/harness/save-draft.js';
import type { DefinitionView } from '../shared/engine/types.js';
import { UNDO_LIMIT, canRedo, canUndo, pushDraft, redoDraft, resetDraft, startDraft, undoCount, undoDraft } from '../shared/harness/draft-undo.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }],
  sources: [], kits: [],
};
const ONE = linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true);
const TWO = linkSkill(BASE, ONE, 'editor', 'draft-outline', true);
const THREE = setDraftEngines(BASE, TWO, ['codex']);

test('a new stack holds the draft it starts from, with nothing to undo or redo', () => {
  const h = startDraft();
  assert.equal(h.present, EMPTY_DRAFT);
  assert.deepEqual([h.past.length, h.future.length], [0, 0]);
  assert.equal(canUndo(h), false); assert.equal(canRedo(h), false);
  assert.equal(h.limit, UNDO_LIMIT);
  assert.equal(startDraft(ONE).present, ONE);
});

test('each change pushes the draft before it; undo goes back one step and redo goes forward again', () => {
  let h = pushDraft(pushDraft(startDraft(), ONE), TWO);
  assert.equal(h.present, TWO);
  assert.equal(undoCount(h), 2);
  h = undoDraft(h);
  assert.equal(h.present, ONE); assert.equal(canRedo(h), true);
  h = undoDraft(h);
  assert.equal(h.present, EMPTY_DRAFT); assert.equal(canUndo(h), false);
  h = redoDraft(h);
  assert.equal(h.present, ONE);
  h = redoDraft(h);
  assert.equal(h.present, TWO); assert.equal(canRedo(h), false);
});

test('undo with nothing to undo, and redo with nothing to redo, return the same stack', () => {
  const h = startDraft();
  assert.equal(undoDraft(h), h);
  assert.equal(redoDraft(h), h);
  const one = pushDraft(h, ONE);
  assert.equal(redoDraft(one), one);
});

test('a new change after an undo drops the redo steps', () => {
  const h = undoDraft(pushDraft(pushDraft(startDraft(), ONE), TWO));
  assert.equal(canRedo(h), true);
  const next = pushDraft(h, THREE);
  assert.equal(next.present, THREE);
  assert.equal(canRedo(next), false);
  assert.deepEqual(next.past, [EMPTY_DRAFT, ONE]);
});

test('pushing the draft that is there already changes nothing and keeps the redo steps', () => {
  const h = undoDraft(pushDraft(startDraft(), ONE));
  assert.equal(pushDraft(h, h.present), h);
  assert.equal(canRedo(pushDraft(h, h.present)), true);
});

test('the stack keeps at most its limit of earlier drafts and drops the oldest first', () => {
  const drafts: SaveDraft[] = Array.from({ length: 6 }, (_, n) => ({ ...EMPTY_DRAFT, removed: [`skill-${n}`] }));
  let h = startDraft(EMPTY_DRAFT, 3);
  for (const d of drafts) h = pushDraft(h, d);
  assert.equal(h.past.length, 3);
  assert.deepEqual(h.past, drafts.slice(2, 5));
  assert.equal(h.present, drafts[5]);
  // Three undos reach the oldest kept draft; the fourth does nothing.
  h = undoDraft(undoDraft(undoDraft(h)));
  assert.equal(h.present, drafts[2]);
  assert.equal(undoDraft(h), h);
});

test('the redo list is bounded by the same limit', () => {
  let h = startDraft(EMPTY_DRAFT, 2);
  h = pushDraft(pushDraft(h, ONE), TWO);
  h = undoDraft(undoDraft(h));
  assert.equal(h.future.length, 2);
  assert.equal(h.present, EMPTY_DRAFT);
});

test('the default limit holds a long session of changes without growing past it', () => {
  let h = startDraft();
  for (let n = 0; n < UNDO_LIMIT * 200; n += 1) h = pushDraft(h, { ...EMPTY_DRAFT, removed: [`skill-${n}`] });
  assert.equal(h.past.length, UNDO_LIMIT);
  assert.deepEqual(h.present.removed, [`skill-${UNDO_LIMIT * 200 - 1}`]);
});

test('reset starts again from one draft, as after a save, a discard, or another folder', () => {
  const h = pushDraft(pushDraft(startDraft(EMPTY_DRAFT, 5), ONE), TWO);
  const fresh = resetDraft(h);
  assert.equal(fresh.present, EMPTY_DRAFT);
  assert.equal(undoCount(fresh), 0); assert.equal(canRedo(fresh), false);
  assert.equal(fresh.limit, 5, 'the limit stays');
  assert.equal(resetDraft(h, ONE).present, ONE);
});

test('the stack never changes the stack it is given', () => {
  const h = pushDraft(startDraft(), ONE);
  const past = [...h.past], future = [...h.future];
  undoDraft(h); pushDraft(h, TWO); resetDraft(h);
  assert.deepEqual(h.past, past); assert.deepEqual(h.future, future); assert.equal(h.present, ONE);
  assert.ok(Object.isFrozen(h) && Object.isFrozen(h.past) && Object.isFrozen(h.future));
});

test('a limit that is not a whole number of at least one is refused', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => startDraft(EMPTY_DRAFT, bad), RangeError, String(bad));
  assert.equal(startDraft(EMPTY_DRAFT, 1).limit, 1);
});
