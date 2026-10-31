// The words of the Export and Import sheets: every fixed string obeys the limits and the banned list, the allowed words "export" and "import" are used for the
// sheets and buttons only, and the words built from a number or a name obey the same rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { bannedIn } from '../shared/home/textbudget.js';
import { BUNDLE_MESSAGES } from '../../../packages/harness-bundle/src/index.js';
import { SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import { CODE_WHY_WORDS, FLAG_WORDS, SHARE, SHARE_REFUSAL_WORDS, approveImportName, exportFileWords, fileSizeWords, importFilesWords, moreWords, notesButtonName, notesChoiceName, secretKindWords, sinkWords, writesCount } from '../renderer/harness/words-share.js';

test('SHARE is frozen all the way down; a label has at most 5 words, a hint 12, a paragraph 25, and none has a banned word', () => {
  assert.equal(Object.isFrozen(SHARE), true); assert.equal(Object.isFrozen(SHARE.label), true);
  assert.throws(() => { (SHARE.label as Record<string, string>).export = 'x'; }, TypeError);
  for (const [group, limit] of [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const) {
    const entries = Object.entries(SHARE[group]);
    assert.ok(entries.length >= 4, group);
    for (const [key, text] of entries) {
      assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`);
      assert.equal(bannedHere(text), null, `${group}.${key}`);
      assert.equal(text, text.trim(), `${group}.${key}`);
      assert.doesNotMatch(text, /\b(?:don't|doesn't|didn't|isn't|can't|won't|it's)\b/i, `${group}.${key} has a contraction`);
    }
  }
});

test('the words Export and Import are the two allowed names, and they stay banned at home', () => {
  assert.equal(SHARE.label.export, 'Export'); assert.equal(SHARE.label.import, 'Import');
  assert.equal(bannedHere(`${SHARE.label.exportTitle} ${SHARE.label.importTitle} ${SHARE.label.importFromFile}`), null);
  assert.notEqual(bannedIn('Export'), null); assert.notEqual(bannedIn('Import'), null);
});

test('the words say "passes these values from this computer to these tools", never "add"', () => {
  assert.equal(SHARE.hint.secretsImport, 'The file passes these values from this computer to these tools.');
  for (const text of [...Object.values(SHARE.hint), ...Object.values(SHARE.label), ...Object.values(SHARE.paragraph)]) assert.doesNotMatch(text, /\badd\b/i, text);
  for (const text of Object.values(SHARE_REFUSAL_WORDS)) assert.doesNotMatch(text, /\badd\b/i, text);
  assert.match(SHARE.hint.notChecked, /did not check/);
  assert.match(SHARE.hint.otherPerson, /another person is data/);
  assert.match(SHARE.hint.otherPerson, /Read the files that run/);
});

test('the next-step lines have no banned word, are short, and the codes the package and main give are covered', () => {
  for (const [code, text] of Object.entries(SHARE_REFUSAL_WORDS)) { assert.equal(bannedHere(text), null, code); assert.ok(countWords(text) <= LIMITS.hint, code); }
  for (const code of [...Object.keys(BUNDLE_MESSAGES), ...Object.keys(SHARE_MAIN_WORDS)]) assert.ok(code in SHARE_REFUSAL_WORDS, `${code} has a next step`);
  assert.ok('CANCELLED' in SHARE_REFUSAL_WORDS && 'NOT_THE_PLAN_SHOWN' in SHARE_REFUSAL_WORDS);
});

test('every reason a file can run, and every address flag, has words', () => {
  for (const why of ['executable', 'hook', 'script', 'shebang', 'binary', 'manifest', 'extension', 'not-data'] as const) { assert.ok(CODE_WHY_WORDS[why].length > 0, why); assert.equal(bannedHere(CODE_WHY_WORDS[why]), null, why); }
  for (const flag of ['credentials', 'backslash', 'scheme', 'unreadable'] as const) { assert.ok(FLAG_WORDS[flag].length > 0, flag); assert.equal(bannedHere(FLAG_WORDS[flag]), null, flag); }
});

test('the words built from a number or a name', () => {
  assert.equal(moreWords(12), 'and 12 more');
  assert.equal(fileSizeWords(1), '1 byte'); assert.equal(fileSizeWords(0), '0 bytes'); assert.equal(fileSizeWords(2048), '2.0 KB'); assert.equal(fileSizeWords(3 * 1024 * 1024), '3.0 MB');
  assert.equal(exportFileWords('x.bowerloom.json', 1536), 'x.bowerloom.json, 1.5 KB');
  assert.equal(importFilesWords(1), 'Import 1 file'); assert.equal(importFilesWords(9), 'Import 9 files'); assert.equal(writesCount(1), '1 file');
  assert.equal(sinkWords({ tool: 'docs', field: 'url', host: 'docs.example.test' }), 'docs, in the address, to docs.example.test');
  assert.equal(sinkWords({ tool: 'docs', field: 'env', host: null }), 'docs, in an environment value');
  assert.equal(secretKindWords({ kind: 'env', name: 'A', sinks: [] }), 'Variable'); assert.equal(secretKindWords({ kind: 'keychain', name: 'A', sinks: [] }), 'Keychain entry');
  for (const text of [notesChoiceName('wiki'), notesButtonName(SHARE.label.link, 'wiki'), approveImportName('rope-yard'), importFilesWords(3), moreWords(3)]) assert.equal(bannedHere(text), null, text);
});
