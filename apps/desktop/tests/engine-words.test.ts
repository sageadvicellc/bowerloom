// The words of the adopt and install sheets: limits, the banned list (no "adopt", "apply", "import" or "MCP" on screen), and the words built from numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import {
  CHANGE_WORDS, DRIFT_WORDS, ENGINE_WORDS, GATE_WORDS, RESULT_TONE, RESULT_WORDS, approveLineName, approvePlanWords, changesLine, conflictWords, countsWords, engineHeading,
  engineList, hiddenWords, partName, readLine, removeFilesWords, removedWords, tickedWords, waitingWords, writeFilesWords, wroteAdoption, wroteInstall,
} from '../renderer/harness/words-engine.js';

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
  assert.equal(engineList(['Claude Code', 'Codex', 'OpenCode']), 'Claude Code, Codex and OpenCode'); assert.equal(engineList(null), 'Every interface'); assert.equal(engineList(['Codex']), 'Codex');
  assert.equal(hiddenWords('Codex', 'CLAUDE.md'), 'Codex does not read CLAUDE.md.'); assert.equal(hiddenWords('DeepSeek Harness', null), 'DeepSeek Harness reads both files.');
  assert.equal(waitingWords({ conflict: 1, acknowledge: 2, block: 0, problem: 0, approval: 3 }), '1 copy to pick, 2 acknowledgements, 3 approvals');
  assert.equal(waitingWords({ conflict: 0, acknowledge: 0, block: 0, problem: 0, approval: 0 }), 'Nothing is waiting.');
  assert.equal(engineHeading('Codex', '0.157.0'), 'Codex, version 0.157.0');
  const built = [writeFilesWords(2), removeFilesWords(2), readLine(2, '~/p'), changesLine(2, '~/p'), approvePlanWords('ab'), conflictWords('x', 3), tickedWords(1, 3), wroteAdoption(7), wroteInstall(10), removedWords(3, 1), approveLineName('guardrails', 'no-force-push', 'Codex'), hiddenWords('Pi', 'CLAUDE.md')];
  for (const text of built) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); }
});
