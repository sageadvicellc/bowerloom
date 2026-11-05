// The words of the Export and Import sheets: every fixed string obeys the limits and the banned list, the allowed words "export" and "import" are used for the
// sheets and buttons only, and the words built from a number or a name obey the same rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { bannedIn } from '../shared/home/textbudget.js';
import { BUNDLE_MESSAGES } from '../../../packages/harness-bundle/src/index.js';
import { SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import {
  CODE_WHY_WORDS, EXPORT_TARGET_IN_HARNESS_WORDS, FLAG_WORDS, changesStart, checkParts, fromThisComputer, SHARE, SHARE_REFUSAL_WORDS, approveImportName, approveImportWords, downloadsCode, eventWords, jumpName, runsAsAdmin, runsShellLine, exportFileWords, fileSizeWords, hiddenCounts, hiddenWords, importBlockWords,
  importFilesWords, importTickWords, importedWords, makesHarnessWords, moreWords, notesButtonName, notesChoiceName, readFileWords, secretKindWords, sinkWords, summaryLine, transportWords, writesCount,
} from '../renderer/harness/words-share.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';
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
    ['env', ['npx', 'x'], true], ['env', ['-i', 'A=1', 'npx', 'x'], true], ['npm', ['exec', 'x'], true], ['pnpm', ['dlx', 'x'], true], ['yarn', ['dlx', 'x'], true], ['bun', ['x', 'y'], true], ['deno', ['run', 'u'], true], ['uv', ['run', 'x'], true],
    ['docker', ['ps'], false], ['node', ['server.js'], false], ['npm', ['install'], false], ['env', [], false], [null, [], false]] as const) assert.equal(downloadsCode(command, args), down, `${command} ${args.join(' ')}`);
  for (const [command, args, shell] of [['sh', ['-c', 'x'], true], ['bash', ['-lc', 'x'], true], ['/bin/zsh', ['-c', 'x'], true], ['env', ['sh', '-c', 'x'], true], ['sh', ['script.sh'], false], ['node', ['-c', 'x'], false], [null, [], false],
    ['node', ['-e', 'x'], true], ['node', ['--eval', 'x'], true], ['node', ['server.js'], false], ['python', ['-c', 'x'], true], ['python3.12', ['-c', 'x'], true], ['python3', ['-m', 'http.server'], true], ['deno', ['eval', 'x'], true], ['deno', ['run', 'x'], false], ['node', ['--eval=1'], true], ['node', ['--print=1'], true],
    ['env', ['-iu', 'A', 'sh', '-c', 'x'], true], ['env', ['--split-string=sh -c x'], true], ['env', ['-iS', 'sh -c x'], true], ['env', ['-iu', 'A', 'node', 'x.js'], false],
    ['ruby', ['-e', 'x'], true], ['perl', ['-e', 'x'], true], ['php', ['-r', 'x'], true], ['cmd', ['/c', 'x'], true], ['CMD.EXE', ['/K', 'x'], true], ['C:\\Windows\\System32\\cmd.exe', ['/c', 'x'], true],
    ['powershell', ['-Command', 'x'], true], ['pwsh.exe', ['-c', 'x'], true], ['powershell', ['-File', 'x.ps1'], false], ['sudo', ['sh', '-c', 'x'], true], ['env', ['-S', 'sh -c x'], true]] as const) assert.equal(runsShellLine(command, args), shell, `${command} ${args.join(' ')}`);
  // `env` and `sudo` options that take a value, a split string, a Windows path and extension, and a word that is not text.
  for (const [command, args, down] of [['env', ['-u', 'HOME', 'npx', 'x'], true], ['env', ['--unset', 'A', 'npx', 'x'], true], ['env', ['-C', '/tmp', 'npx', 'x'], true], ['env', ['--chdir', '/tmp', 'npx'], true], ['env', ['-P', '/bin', 'npx'], true],
    ['env', ['-S', 'npx -y evil'], true], ['env', ['-Snpx -y evil'], true], ['env', ['-u', 'A', 'node', 'x.js'], false], ['C:\\x\\npx.cmd', ['x'], true], ['npx.exe', [], true], ['NPX', [], true], ['sudo', ['npx', 'x'], true],
    ['sudo', ['-u', 'root', 'npx', 'x'], true], ['env', ['A=1', 'sudo', 'npx', 'x'], true], ['env', [1, 2, null, { a: 1 }], false], ['npx', [1, 2], true]] as const) assert.equal(downloadsCode(command, args as readonly unknown[]), down, `${command} ${args.join(' ')}`);
  assert.equal(downloadsCode(5 as unknown as string, []), false);
  assert.equal(runsShellLine(5 as unknown as string, []), false);
  for (const [command, args, admin] of [['sudo', ['x'], true], ['doas', ['x'], true], ['env', ['A=1', 'sudo', 'x'], true], ['/usr/bin/sudo', [], true], ['node', [], false], ['env', ['node'], false], [null, [], false]] as const) assert.equal(runsAsAdmin(command, args), admin, `${command} ${args.join(' ')}`);
  assert.equal(SHARE.label.runsCode, 'Starts a program');
});

test('the first tick says what it covers; when a list was cut it names the cut, so a tick never claims more than was shown', () => {
  assert.equal(importTickWords(BLANK), 'I read what runs and where my values go.');
  assert.equal(importTickWords({ ...BLANK, foreignPaths: { rows: [{ path: 'a', line: 1, text: 'x' }], more: 0 } }), 'I read what runs, where my values go and the paths.');
  assert.equal(importTickWords({ ...BLANK, tools: { rows: [], more: 12 } }), 'I read the 200 tools shown. 12 are not shown.');
  assert.equal(importTickWords({ ...BLANK, codeFiles: { rows: [], more: 3 } }), 'I read the 200 files shown. 3 are not shown.');
  assert.equal(importTickWords({ ...BLANK, tools: { rows: [], more: 12 }, foreignPaths: { rows: [{ path: 'a', line: 1, text: 'x' }], more: 0 } }), 'I read 200 tools and the paths. 12 tools are not shown.');
  assert.equal(importTickWords({ ...BLANK, foreignPaths: { rows: [], more: 4 } }), 'I read the 200 paths shown. 4 are not shown.');
  assert.equal(importTickWords({ ...BLANK, tools: { rows: [], more: 1 }, secrets: { rows: [], more: 1 } }), 'I read the lists shown. More are not shown.');
  assert.deepEqual(hiddenCounts({ ...BLANK, tools: { rows: [], more: 12 }, foreignPaths: { rows: [], more: 2 } }), { tools: 12, codeFiles: 0, secrets: 0, foreignPaths: 2, total: 14 });
  for (const text of [importTickWords(BLANK), SHARE.hint.tickExport, SHARE.hint.tickFirst, importTickWords({ ...BLANK, tools: { rows: [], more: 12 }, foreignPaths: { rows: [{ path: 'a', line: 1, text: 'x' }], more: 0 } }), importTickWords({ ...BLANK, codeFiles: { rows: [], more: 3 } })]) assert.ok(countWords(text) <= LIMITS.hint, text);
  assert.equal(SHARE.hint.tickExport, 'I accept these paths from this computer in the file.');
});

test('the second tick names the files and the folder and says install is separate; a folder with no harness is made one in the same approval', () => {
  assert.equal(approveImportWords(10, '~/Projects/alpha', false), 'Write these 10 files into ~/Projects/alpha. Install is separate.');
  assert.equal(approveImportWords(1, '~/x', true), 'Make a harness and write this file into ~/x. Install is separate.');
  assert.equal(makesHarnessWords(10), 'Makes the harness. Writes 10 files in all.');
  assert.equal(importedWords(10, '~/Projects/alpha'), 'Imported 10 files into ~/Projects/alpha.');
});

test('the line of counts leaves out the zeros, and the foot line says what blocks the button', () => {
  assert.equal(summaryLine({ ...BLANK, counts: { skills: 2, agents: 1, mcp: 2, hooks: 1, guardrails: 0, scripts: 0, files: 10, bytes: 4915 } }), '2 skills, 1 agent, 2 tools, 1 hook, 10 files, 4.8 KB');
  assert.equal(summaryLine(BLANK), '1 file, 40 bytes');
  assert.equal(importBlockWords({ planning: false, needsRead: true, approved: false }), 'Tick both boxes to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: true, approved: true }), 'Tick the first box to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: false }), 'Tick the second box to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: false, hasRead: false }), 'Tick the box to import.', 'a plan with one box says one box');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: false, hasRead: true }), 'Tick the second box to import.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: false, hasRead: false, noop: true }), 'The folder already matches. Nothing to import.');
  assert.equal(jumpName('3 tools'), '3 tools. Go to the list.');
  assert.equal(importBlockWords({ planning: true, needsRead: true, approved: true }), 'Planning. Then tick again.');
  assert.equal(importBlockWords({ planning: false, needsRead: false, approved: true }), 'Ready. Press the button to go on.');
  assert.equal(SHARE.hint.approvalCleared, 'Approval cleared. Tick again before you import.');
  assert.equal(SHARE.hint.notInstalled, 'Nothing is installed. Nothing has run.');
  assert.equal(SHARE.hint.planFailed, 'The plan could not be made. Plan again.');
});

test('the lows: admin and inline-code lines, a hook line is split, a wrapper nested past the guard is flagged', () => {
  assert.equal(SHARE.hint.sudoLine, 'This runs with admin rights.');
  assert.equal(SHARE.hint.shellLine, 'This runs text as code.');
  assert.equal(SHARE.hint.changesStart, 'This changes how the program starts.');
  const hook = checkParts({ kind: 'hook', command: 'sudo npx -y x', args: [] });
  assert.deepEqual(hook, { command: 'sudo', args: ['npx', '-y', 'x'] });
  assert.equal(runsAsAdmin(hook.command, hook.args), true);
  assert.equal(downloadsCode(hook.command, hook.args), true);
  assert.equal(runsShellLine(...Object.values(checkParts({ kind: 'hook', command: 'bash -c "x"', args: [] })) as [string, string[]]), true);
  assert.deepEqual(checkParts({ kind: 'mcp', command: 'a b', args: ['c'] }), { command: 'a b', args: ['c'] });
  const deep = Array(70).fill('env');
  assert.equal(runsShellLine('env', deep.slice(1)), true);
  assert.equal(downloadsCode('env', deep.slice(1)), true);
  assert.equal(runsAsAdmin('env', deep.slice(1)), true);
});

test('names that change how a program starts, and values read from this computer', () => {
  for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_LIBRARY_PATH', 'PATH', 'BASH_ENV', 'ENV', 'PYTHONSTARTUP', 'PYTHONPATH', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'PERL5OPT', 'RUBYOPT', 'path']) assert.equal(changesStart(name), true, name);
  for (const name of ['HOME', 'API_KEY', 'constructor']) assert.equal(changesStart(name), false, name);
  assert.equal(fromThisComputer('${TOKEN}'), true); assert.equal(fromThisComputer('Bearer ${TOKEN}'), true); assert.equal(fromThisComputer('{"keychain":"e"}'), true); assert.equal(fromThisComputer('north'), false);
});

test('the refusal for a save place inside the harness is one sentence, the same in main and in the window', () => {
  assert.match(EXPORT_TARGET_IN_HARNESS_WORDS, /^That place is inside the folder \.bowerloom of this harness/);
  const main = readFileSync(join(DESKTOP, 'main', 'engine-bundle.ts'), 'utf8');
  assert.doesNotMatch(main, /export const EXPORT_TARGET_IN_HARNESS_WORDS\s*=/, 'main holds no copy of its own');
  assert.match(main, /EXPORT_TARGET_IN_HARNESS_WORDS\b[\s\S]*from '\.\.\/shared\/engine\/types\.js'/);
  assert.equal('EXPORT_TARGET_IN_HARNESS' in SHARE_REFUSAL_WORDS, false, 'no second sentence under it');
});
