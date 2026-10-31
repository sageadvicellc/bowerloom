// The Builder's own words (renderer/harness/words.ts): "Discard N changes?" when the person leaves a folder with unsaved changes (owner decision Q1A), the
// Unlink, Undo and Redo buttons, and the hint that says Remove deletes a skill's files at Save. They obey the preview's limits and banned words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { WORDS, discardWords, openFolderName, unlinkName } from '../renderer/harness/words.js';
import { BUILDER_REFUSALS } from '../shared/harness/builder-draft.js';
import { DESKTOP } from './support.js';

test('leaving a folder asks "Discard N changes?" with the count of unsaved changes', () => {
  assert.equal(discardWords(1), 'Discard 1 change?');
  assert.equal(discardWords(3), 'Discard 3 changes?');
  assert.equal(WORDS.label.discard, 'Discard');
  assert.equal(WORDS.label.keepEditing, 'Keep editing');
});

test('the Builder\'s buttons and hints say what they do', () => {
  assert.equal(WORDS.label.unlink, 'Unlink');
  assert.equal(WORDS.label.undo, 'Undo');
  assert.equal(WORDS.label.redo, 'Redo');
  assert.equal(WORDS.label.save, 'Save');
  assert.equal(unlinkName('editor', 'check-facts'), 'Unlink editor and check-facts');
  assert.equal(openFolderName('weekly-report'), 'Open weekly-report in the builder');
  // Remove deletes the skill's files at Save: the hint no longer says it does not.
  assert.match(WORDS.hint.removeNote, /deletes/);
  assert.doesNotMatch(WORDS.hint.removeNote, /does not delete/);
});

test('the words built from a number or a name obey the limits and the banned words', () => {
  for (const text of [discardWords(1), discardWords(12), unlinkName('notes-keeper', 'add-source'), openFolderName('inbox-tools')]) {
    assert.equal(bannedHere(text), null, text);
    assert.ok(countWords(text) <= LIMITS.label + 1, text);
  }
  for (const text of Object.values(BUILDER_REFUSALS)) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); }
});

test('the Fix sheet is gone: a missing part is not fixed in beta.1', () => {
  assert.throws(() => readFileSync(join(DESKTOP, 'renderer/harness/screens/builder/FixSheet.tsx')), /ENOENT/);
  const builder = readFileSync(join(DESKTOP, 'renderer/harness/screens/Builder.tsx'), 'utf8');
  assert.doesNotMatch(builder, /FixSheet|fixMissingPart|useHarnessStore/);
  // Every gesture goes through the editor's act, which is builderAction on the draft; the Builder holds no reducer of its own.
  assert.match(builder, /editor\.act\(/);
  assert.match(readFileSync(join(DESKTOP, 'renderer/harness/FolderEditor.tsx'), 'utf8'), /builderAction\(/);
  assert.match(builder, /useFolderDraft\(/);
});
