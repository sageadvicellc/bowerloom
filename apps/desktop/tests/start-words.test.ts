// The words of the real Start sheet: limits, the banned list, and the lines built from a name or a state. Start runs nothing, and the words never say it starts, runs or compares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { START, commandFor, copyName, installFirstWords, limitWords, whyWords } from '../renderer/harness/words-start.js';
import { START_INSTRUCTION_LIMIT } from '../shared/engine/start-command.js';
import type { StartStatus } from '../shared/harness/start-real.js';

test('the table is frozen; a label has at most 5 words, a hint 12, a paragraph 25, and none holds a banned word', () => {
  assert.equal(Object.isFrozen(START.label), true); assert.equal(Object.isFrozen(START.hint), true); assert.equal(Object.isFrozen(START.paragraph), true);
  for (const [group, limit] of [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const) {
    for (const [key, text] of Object.entries(START[group])) {
      assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`);
      assert.equal(bannedHere(text), null, `${group}.${key}: ${text}`);
    }
  }
});

test('the words say that Bowerloom runs nothing and where the command goes, and never promise a run', () => {
  assert.equal(START.paragraph.noRun, 'Bowerloom does not run this. Paste it into your own Terminal.');
  assert.match(START.paragraph.note, /does not run an engine/);
  assert.equal(START.label.show, 'Show the command');
  const all = [...Object.values(START.label), ...Object.values(START.hint), ...Object.values(START.paragraph)].join(' ');
  assert.doesNotMatch(all, /Review and start|runs? started|Compare is on|Press Start/i);
});

test('the limit in the words is the limit in the code', () => {
  assert.equal(limitWords(), '4,000');
  assert.equal(START_INSTRUCTION_LIMIT, 4000);
  assert.match(START.hint.limit, /4,000/); assert.match(START.hint.tooLong, /4,000/);
});

test('the built lines read right and obey the rules', () => {
  assert.equal(installFirstWords(['codex']), 'Codex is not ready here. The install review opens first.');
  assert.equal(installFirstWords(['claude-code', 'codex']), 'Claude Code and Codex are not ready here. The install review opens first.');
  assert.equal(commandFor('claude-code'), 'Command for Claude Code');
  assert.equal(copyName('codex'), 'Copy the Codex command');
  for (const text of [installFirstWords(['codex']), installFirstWords(['claude-code', 'codex']), commandFor('codex'), copyName('claude-code')]) assert.equal(bannedHere(text), null, text);
  assert.ok(countWords(installFirstWords(['claude-code', 'codex'])) <= LIMITS.paragraph);
  assert.ok(countWords(commandFor('claude-code')) <= LIMITS.label); assert.ok(countWords(copyName('claude-code')) <= LIMITS.label + 1);
});

test('whyWords gives a line for each state that blocks the button, the install line for the review, and nothing when ready', () => {
  const lines = (s: StartStatus): string | null => whyWords(s);
  assert.equal(lines({ kind: 'no-project' }), START.hint.needFolder);
  assert.equal(lines({ kind: 'no-harness' }), START.hint.needFolder);
  assert.equal(lines({ kind: 'no-engine' }), START.hint.needEngine);
  assert.equal(lines({ kind: 'no-instruction' }), START.hint.needInstruction);
  assert.equal(lines({ kind: 'too-long' }), START.hint.tooLong);
  assert.equal(lines({ kind: 'bad-text', code: 'START_INSTRUCTION_DASH' }), START.hint.dash);
  assert.equal(lines({ kind: 'bad-text', code: 'START_INSTRUCTION_CHARACTERS' }), START.hint.chars);
  assert.equal(lines({ kind: 'needs-install', engines: ['codex'] }), installFirstWords(['codex']));
  assert.equal(lines({ kind: 'ready', engines: ['codex'] }), null);
});
