// The words of the adopt and install sheets: limits, the banned list (no "adopt", "apply", "import" or "MCP" on screen), and the words built from numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import {
  CHANGE_WORDS, DRIFT_WORDS, ENGINE_WORDS, GATE_WORDS, RESULT_TONE, RESULT_WORDS, approveLineName, approvePlanWords, changesLine, conflictWords, countsWords, engineHeading,
  engineList, hiddenWords, partName, readLine, removeFilesWords, removedWords, tickedWords, waitingWords, writeFilesWords, wroteAdoption, wroteInstall,
  acknowledgeName, approveItemName, engineDetails, ignoredWords, recoveryKindWords, stillWaiting, writesIntoLine,
  MODE_CHOICE_WORDS, RECOVERY_ACTION_WORDS, headingLine, modeActionName, modeLine,
  SAVE_REFUSAL_WORDS, draftWords, goBackWords, saveFilesWords, savePointLine, NOTES_REFUSAL_WORDS, NOTES_PARTIAL_WORDS,
} from '../renderer/harness/words-engine.js';
import { NOTES_REFUSAL_CODES } from '../../../packages/notes-source/src/index.js';
import { SAVE_REFUSAL_CODES } from '../../../packages/adoption/src/index.js';
import { VERSION_REFUSAL_CODES } from '../../../packages/project-sync/src/index.js';
import { KIT_MAIN_WORDS, REPORT_MAIN_WORDS, SAVE_MAIN_WORDS } from '../shared/engine/types.js';

test('the table is frozen; a label has at most 5 words, a hint 12, a paragraph 25, and none holds a banned word', () => {
  assert.equal(Object.isFrozen(ENGINE_WORDS.label), true);
  for (const [group, limit] of [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const) {
    for (const [key, text] of Object.entries(ENGINE_WORDS[group])) {
      assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`);
      assert.equal(bannedHere(text), null, `${group}.${key}: ${text}`);
    }
  }
  for (const text of [...Object.values(RESULT_WORDS), ...Object.values(GATE_WORDS), ...Object.values(CHANGE_WORDS), ...Object.values(DRIFT_WORDS)]) assert.equal(bannedHere(text), null, text);
});

test('the result words are the four words of the fidelity check, each with its own tone', () => {
  assert.deepEqual(Object.values(RESULT_WORDS), ['Exact', 'Translated', 'Weakened', 'Absent']);
  assert.equal(new Set(Object.values(RESULT_TONE)).size, 4);
  assert.equal(partName('mcp'), 'Servers'); assert.equal(partName('system-prompt'), 'Instructions'); assert.equal(partName('new-part'), 'new-part'); assert.equal(partName(null), 'Other');
});

test('the words built from a number or a name read right and obey the rules', () => {
  assert.equal(writeFilesWords(1), 'Write 1 file'); assert.equal(writeFilesWords(7), 'Write 7 files'); assert.equal(removeFilesWords(4), 'Remove 4 files');
  assert.equal(readLine(9, '~/Projects/inbox'), 'Read 9 files in ~/Projects/inbox. Nothing is written yet.');
  assert.equal(changesLine(10, '~/p'), 'Changes 10 files in ~/p.');
  assert.equal(approvePlanWords('1a2b3c4d'), 'I approve plan 1a2b3c4d');
  assert.equal(conflictWords('AGENTS.md', 2), 'Two copies of AGENTS.md differ.');
  assert.equal(countsWords({ exact: 3, translated: 0, weakened: 1, absent: 1 }), '3 exact, 1 weakened, 1 absent');
  assert.equal(countsWords({ exact: 0, translated: 0, weakened: 0, absent: 0 }), 'Nothing to install');
  assert.equal(engineList(['Claude Code', 'Codex', 'OpenCode']), 'Claude Code, Codex and OpenCode'); assert.equal(engineList(null), 'Every engine'); assert.equal(engineList(['Codex']), 'Codex');
  assert.equal(hiddenWords('Codex', 'CLAUDE.md'), 'Codex does not read CLAUDE.md.'); assert.equal(hiddenWords('DeepSeek Harness', null), 'DeepSeek Harness reads both files.');
  assert.equal(waitingWords({ conflict: 1, acknowledge: 2, block: 0, problem: 0, approval: 3 }), '1 copy to pick, 2 acknowledgements, 3 approvals');
  assert.equal(waitingWords({ conflict: 0, acknowledge: 0, block: 0, problem: 0, approval: 0 }), 'Nothing is waiting.');
  assert.equal(engineHeading('Codex', '0.157.0'), 'Codex, version 0.157.0');
  const built = [writeFilesWords(2), removeFilesWords(2), readLine(2, '~/p'), changesLine(2, '~/p'), approvePlanWords('ab'), conflictWords('x', 3), tickedWords(1, 3), wroteAdoption(7), wroteInstall(10), removedWords(3, 1), approveLineName('guardrails', 'no-force-push', 'Codex'), hiddenWords('Pi', 'CLAUDE.md')];
  for (const text of built) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); }
  assert.equal(writesIntoLine(7), 'Writes 7 files into the .bowerloom folder.');
  assert.equal(stillWaiting('2 approvals'), 'Still waiting for: 2 approvals');
  assert.equal(engineDetails('Codex', '0.157.0', 'gpt-5'), 'Codex, version 0.157.0, model gpt-5'); assert.equal(engineDetails('Pi', null, null), 'Pi');
  for (const text of [approveItemName('mcp', 'mail'), acknowledgeName('.codex/config.toml#/approval_policy'), writesIntoLine(1), recoveryKindWords('apply' as const), recoveryKindWords('remove' as const), recoveryKindWords(null), ignoredWords('reconcile', 'There is no CLAUDE.md.')]) assert.equal(bannedHere(text), null, text);
});

test('step 5: Merge is offered in words, never "not built"; a mode line names its two actions and both modes', () => {
  assert.equal(Object.values(ENGINE_WORDS.hint).some(t => /not built/i.test(t)), false);
  assert.equal(ENGINE_WORDS.hint.mergeText, 'Moves CLAUDE.md into the harness.');
  assert.equal(DRIFT_WORDS.mode, 'Mode changed since');
  assert.deepEqual(MODE_CHOICE_WORDS, { restoreMode: 'Restore mode', recordMode: 'Keep new mode' });
  assert.equal(RECOVERY_ACTION_WORDS.mode, 'Settle the file modes');
  assert.equal(modeLine('0700', '0644'), 'Now 0700. Bowerloom wrote 0644.');
  assert.equal(modeActionName('recordMode', 'AGENTS.md'), 'Keep new mode: AGENTS.md');
  assert.equal(headingLine('From CLAUDE.md'), 'It goes under the heading From CLAUDE.md.');
  for (const text of [modeLine('0700', '0644'), modeActionName('restoreMode', 'a/b.md'), headingLine('From CLAUDE.md'), ...Object.values(MODE_CHOICE_WORDS), ...Object.values(RECOVERY_ACTION_WORDS)]) {
    assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text);
  }
});

test('save step: every new refusal code has words for what to do next, inside the hint limit and free of banned words', () => {
  const edit = ['EDIT_BAD_EDIT', 'EDIT_UNSAFE_ID', 'EDIT_UNKNOWN_ID', 'EDIT_DUPLICATE_ID', 'EDIT_UNSAFE_PATH', 'EDIT_TOO_LARGE', 'EDIT_SECRET_FOUND', 'EDIT_INVALID'];
  // The notes edits: the kit main ships, and the stored path of a notes folder (packages/harness-definition, storedKnowledgePath).
  const notes = [...Object.keys(KIT_MAIN_WORDS), 'KNOWLEDGE_PATH_UNSAFE', 'KNOWLEDGE_PATH_ESCAPES', 'KNOWLEDGE_PATH_OUTSIDE'];
  const codes: string[] = [...SAVE_REFUSAL_CODES, ...VERSION_REFUSAL_CODES, ...edit, ...Object.keys(SAVE_MAIN_WORDS), ...notes];
  assert.deepEqual(codes.filter(c => SAVE_REFUSAL_WORDS[c] === undefined), [], 'every code has words');
  assert.deepEqual(Object.keys(SAVE_REFUSAL_WORDS).filter(c => !codes.includes(c)), [], 'no words for a code that does not exist');
  for (const [code, text] of Object.entries(SAVE_REFUSAL_WORDS)) {
    assert.ok(countWords(text) <= LIMITS.hint, `${code}: ${text}`);
    assert.equal(bannedHere(text), null, `${code}: ${text}`);
  }
  assert.equal(saveFilesWords(1), 'Save 1 file'); assert.equal(saveFilesWords(3), 'Save 3 files');
  assert.equal(goBackWords('v2'), 'Go back to v2');
  assert.equal(draftWords(0), 'No change yet.'); assert.equal(draftWords(2), '2 changes, not saved yet.');
  assert.equal(savePointLine('2026-10-30T12:00:00Z', 3), '2026-10-30 12:00 UTC, 3 files');
  for (const text of [saveFilesWords(2), goBackWords('v12'), draftWords(1), savePointLine('2026-10-30T12:00:00Z', 1)]) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); }
});

test('notes: every refusal of the notes calls has words for what to do next, inside the hint limit and free of banned words', () => {
  // The tidy-up report's own refusals of main (REPORT_MAIN_WORDS) are shown with the notes words too.
  const codes: string[] = [...NOTES_REFUSAL_CODES, 'KIT_INVALID', 'NOT_A_FOLDER', 'NOTES_NOT_CHOSEN', ...Object.keys(REPORT_MAIN_WORDS)];
  assert.deepEqual(codes.filter(c => NOTES_REFUSAL_WORDS[c] === undefined), [], 'every code has words');
  assert.deepEqual(Object.keys(NOTES_REFUSAL_WORDS).filter(c => !codes.includes(c)), [], 'no words for a code that does not exist');
  for (const [code, text] of Object.entries(NOTES_REFUSAL_WORDS)) {
    assert.ok(countWords(text) <= LIMITS.hint, `${code}: ${text}`);
    assert.equal(bannedHere(text), null, `${code}: ${text}`);
  }
});

test('notes: a step that stopped part way has advice of its own for the starter and for the history start', () => {
  assert.deepEqual(Object.keys(NOTES_PARTIAL_WORDS).sort(), ['history', 'starter']);
  assert.notEqual(NOTES_PARTIAL_WORDS.history, NOTES_PARTIAL_WORDS.starter);
  assert.equal(NOTES_REFUSAL_WORDS.NOTES_PARTIAL, NOTES_PARTIAL_WORDS.starter);
  for (const [step, text] of Object.entries(NOTES_PARTIAL_WORDS)) {
    assert.ok(countWords(text) <= LIMITS.hint, `${step}: ${text}`);
    assert.equal(bannedHere(text), null, `${step}: ${text}`);
  }
});
