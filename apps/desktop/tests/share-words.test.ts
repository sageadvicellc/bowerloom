// The words of the Export and Import sheets: every fixed string obeys the limits and the banned list, the allowed words "export" and "import" are used for the
// sheets and buttons only, and the words built from a number or a name obey the same rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { bannedIn } from '../shared/home/textbudget.js';
import { BUNDLE_MESSAGES } from '../../../packages/harness-bundle/src/index.js';
import { SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import {
  CODE_WHY_WORDS, FLAG_WORDS, SHARE, SHARE_REFUSAL_WORDS, approveImportName, approveImportWords, downloadsCode, eventWords, exportFileWords, fileSizeWords, hiddenCounts, hiddenWords, importBlockWords,
  importFilesWords, importTickWords, importedWords, makesHarnessWords, moreWords, notesButtonName, notesChoiceName, readFileWords, secretKindWords, sinkWords, summaryLine, transportWords, writesCount,
} from '../renderer/harness/words-share.js';
import type { ShareSummary } from '../shared/engine/types.js';

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
  assert.match(SHARE.hint.otherPerson, /came from another person/);
  assert.match(SHARE.hint.otherPerson, /Check what runs before you import/);
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

const EMPTY = { rows: [], more: 0 };
const BLANK: ShareSummary = { harness: 'h', engines: [], instructions: false, counts: { skills: 0, agents: 0, mcp: 0, hooks: 0, guardrails: 0, scripts: 0, files: 1, bytes: 40 }, tools: EMPTY, codeFiles: EMPTY, secrets: EMPTY, notes: EMPTY, borrowed: EMPTY, foreignPaths: EMPTY };

test('the words built from a number or a name', () => {
  assert.equal(moreWords(12), 'and 12 more');
  assert.equal(fileSizeWords(1), '1 byte'); assert.equal(fileSizeWords(0), '0 bytes'); assert.equal(fileSizeWords(2048), '2.0 KB'); assert.equal(fileSizeWords(3 * 1024 * 1024), '3.0 MB');
  assert.equal(exportFileWords('x.bowerloom.json', 1536), 'x.bowerloom.json, 1.5 KB');
  assert.equal(importFilesWords(1), 'Import 1 file'); assert.equal(importFilesWords(9), 'Import 9 files'); assert.equal(importFilesWords(null), 'Import'); assert.equal(writesCount(1), '1 file');
  assert.equal(secretKindWords({ kind: 'env', name: 'A', sinks: [] }), 'Variable'); assert.equal(secretKindWords({ kind: 'keychain', name: 'A', sinks: [] }), 'Keychain entry');
  for (const text of [notesChoiceName('wiki'), notesButtonName(SHARE.label.link, 'wiki'), approveImportName('rope-yard'), importFilesWords(3), moreWords(3), hiddenWords(3), makesHarnessWords(4),
    approveImportWords(4, '~/Projects/x', true), importedWords(2, '~/Projects/x'), readFileWords('x.bowerloom.json', 3, 1)]) assert.equal(bannedHere(text), null, text);
});

test('where a value goes: a host is named, and a program with no host is said to be able to send it anywhere', () => {
  assert.equal(sinkWords({ tool: 'docs', field: 'url', host: 'docs.example.test' }), 'docs, in the address, to docs.example.test');
  assert.equal(sinkWords({ tool: 'docs', field: 'env', host: null }), 'Passed to the program docs, in an environment value. It can send it anywhere.');
  assert.equal(sinkWords({ tool: 'docs', field: 'header', host: null }), 'docs, in a header');
  assert.match(sinkWords({ tool: 'stock-db', field: 'arg', host: null }), /^Passed to the program stock-db.*It can send it anywhere\.$/);
});

test('what a tool does, in words: a transport, a hook event, and a command that downloads code', () => {
  assert.equal(transportWords('stdio'), 'Starts a program on this computer.');
  assert.equal(transportWords('http'), 'Connects to a web address.');
  assert.equal(transportWords('carrier-pigeon'), null);
  assert.equal(eventWords('PostToolUse'), 'Runs after each tool use.');
  assert.equal(eventWords('constructor'), null, 'an event named like a property of Object is not a known one');
  for (const [command, args, down] of [['npx', ['-y', 'x'], true], ['uvx', [], true], ['pipx', ['run', 'x'], true], ['bunx', [], true], ['/usr/local/bin/npx', [], true], ['docker', ['run', 'img'], true],
    ['docker', ['ps'], false], ['node', ['server.js'], false], [null, [], false]] as const) assert.equal(downloadsCode(command, args), down, `${command} ${args.join(' ')}`);
  assert.equal(SHARE.label.runsCode, 'Starts a program');
});

test('the first tick says what it covers; when a list was cut it names the cut, so a tick never claims more than was shown', () => {
  assert.equal(importTickWords(BLANK), 'I read what runs and where my values go.');
  assert.equal(importTickWords({ ...BLANK, foreignPaths: { rows: [{ path: 'a', line: 1, text: 'x' }], more: 0 } }), 'I read what runs, where my values go and the paths.');
  assert.equal(importTickWords({ ...BLANK, tools: { rows: [], more: 12 } }), 'I read the first 200 tools. 12 more are not shown.');
  assert.equal(importTickWords({ ...BLANK, codeFiles: { rows: [], more: 3 } }), 'I read the first 200 files that run. 3 more are not shown.');
  assert.equal(importTickWords({ ...BLANK, tools: { rows: [], more: 1 }, secrets: { rows: [], more: 1 } }), 'I read the lists shown. More are not shown.');
  assert.deepEqual(hiddenCounts({ ...BLANK, tools: { rows: [], more: 12 }, foreignPaths: { rows: [], more: 2 } }), { tools: 12, codeFiles: 0, secrets: 0, foreignPaths: 2, total: 14 });
  for (const text of [importTickWords(BLANK), SHARE.hint.tickExport, SHARE.hint.tickFirst]) assert.ok(countWords(text) <= LIMITS.hint, text);
  assert.equal(SHARE.hint.tickExport, 'I accept these paths from this computer in the file.');
});

test('the second tick names the files and the folder and says install is separate; a folder with no harness is made one in the same approval', () => {
  assert.equal(approveImportWords(10, '~/Projects/alpha', false), 'Write these 10 files into ~/Projects/alpha. Install is separate.');
  assert.equal(approveImportWords(1, '~/x', true), 'Make a harness and write this file into ~/x. Install is separate.');
  assert.equal(makesHarnessWords(10), 'Makes an empty harness here, then writes 10 files.');
  assert.equal(importedWords(10, '~/Projects/alpha'), 'Imported 10 files into ~/Projects/alpha.');
});

test('the line of counts leaves out the zeros, and the foot line says what blocks the button', () => {
  assert.equal(summaryLine({ ...BLANK, counts: { skills: 2, agents: 1, mcp: 2, hooks: 1, guardrails: 0, scripts: 0, files: 10, bytes: 4915 } }), '2 skills, 1 agent, 2 tools, 1 hook, 10 files, 4.8 KB');
  assert.equal(summaryLine(BLANK), '1 file, 40 bytes');
  assert.equal(importBlockWords({ planning: false, needsRead: true, approved: false }), 'Tick both boxes to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: true, approved: true }), 'Tick the first box to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: false }), 'Tick the second box to import.');
  assert.equal(importBlockWords({ planning: true, needsRead: true, approved: true }), 'Planning. Then tick again.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: true }), 'Ready. Press the button to go on.');
  assert.equal(SHARE.hint.approvalCleared, 'Approval cleared. Tick again before you import.');
  assert.equal(SHARE.hint.doneFoot, 'Nothing is installed. Nothing has run.');
});
