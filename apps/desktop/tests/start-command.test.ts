// The Start command (beta.2): Start shows the command for one engine and one folder and copies it. It runs nothing. The instruction is any text a person types, so
// the one quoting function is proved against a real shell: for every nasty input, the final command passes the instruction to the program as ONE argument, unchanged.
// The shell runs a function named like the engine that only prints its arguments. No engine is ever started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  START_ENGINES, START_INSTRUCTION_LIMIT, START_MAIN_WORDS, START_PROGRAMS, checkInstruction, folderWord, isStartEngine, shQuote, shWord, startCommand,
} from '../shared/engine/start-command.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { tempDir } from './support.js';

/** Inputs a shell or a terminal treats in a special way. Each one must reach the program unchanged. */
const NASTY: readonly string[] = [
  'fix the login', '', ' ', '  leading and trailing  ', 'two\nlines', 'a\n\nb\n', 'tab\there', "it's", "'", "''", "'\\''", 'say "hi"', '"', '\\', '\\n', '\\\\',
  '$(touch pwned)', '`touch pwned`', '${HOME}', '$HOME', '$1 $@ $*', 'a; touch pwned', 'a && touch pwned', 'a || touch pwned', 'a | cat', 'a > pwned', 'a < /etc/hosts',
  'a & b', '(a)', '{ a; }', '* ? [a-z]', '~', '~root/x', '!!', '!$', '#not a comment', '%d %s', '-n', '--help', '-- x', '<<EOF\nboom\nEOF', 'cd / && rm -rf x',
  'emoji 🎉 and 👨‍💻 and ❤️', 'café ß 日本語 русский עברית', '\u200b zero width', 'a\u2028b', 'x'.repeat(START_INSTRUCTION_LIMIT),
  `${"it's \"q\" $(x) `y` ; & | \n".repeat(100)}`,
];

/** The shells a person may paste into. A shell that is not on this computer is skipped. */
const SHELLS = ['/bin/sh', '/bin/bash', '/bin/zsh'].filter(path => existsSync(path));

/** Runs `command` in a shell with a function that stands for the engine, and returns what the function saw: its folder, its argument count, and each argument. */
function seen(command: string, program: string, home?: string, shell = '/bin/sh'): { folder: string; count: number; args: string[] } {
  const script = `${program}() { printf '%s\\0' "$(pwd -P)" "$#" "$@"; }\n${command}`;
  const run = spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home ?? '/nonexistent' }, timeout: 20_000 });
  assert.equal(run.status, 0, `${shell} ran the command (${run.stderr})`);
  const parts = run.stdout.split('\0');
  parts.pop();
  return { folder: parts[0]!, count: Number(parts[1]), args: parts.slice(2) };
}

test('the engines Start knows are Claude Code and Codex, each with the program name its vendor documents', () => {
  assert.deepEqual([...START_ENGINES], ['claude-code', 'codex']);
  assert.deepEqual({ ...START_PROGRAMS }, { 'claude-code': 'claude', codex: 'codex' });
  assert.equal(isStartEngine('codex'), true); assert.equal(isStartEngine('opencode'), false); assert.equal(isStartEngine(7), false); assert.equal(isStartEngine('claude'), false);
});

test('shQuote wraps text in single quotes and escapes each single quote as the four characters that close, escape, and reopen', () => {
  assert.equal(shQuote('abc'), "'abc'");
  assert.equal(shQuote(''), "''");
  assert.equal(shQuote("it's"), "'it'\\''s'");
  assert.equal(shQuote("'"), "''\\'''");
  assert.equal(shQuote('a\nb'), "'a\nb'");
  assert.equal(shQuote('$(x) `y`'), "'$(x) `y`'");
});

test('shQuote refuses a NUL character, which no shell can carry in an argument', () => {
  assert.throws(() => shQuote('a\u0000b'), RangeError);
  assert.throws(() => shQuote('\u0000'), RangeError);
});

test('every nasty instruction reaches the program as one argument, unchanged, once the command runs in a real shell', t => {
  const dir = tempDir(t, 'bowerloom-start-');
  assert.ok(SHELLS.length >= 1);
  for (const shell of SHELLS) {
    for (const engine of START_ENGINES) {
      for (const text of NASTY) {
        const got = seen(startCommand(engine, shWord(dir), text), START_PROGRAMS[engine], undefined, shell);
        assert.equal(got.count, 1, `${shell}: one argument for ${JSON.stringify(text.slice(0, 40))}`);
        assert.deepEqual(got.args, [text], `${shell}: unchanged ${JSON.stringify(text.slice(0, 40))}`);
        assert.equal(got.folder, dir);
      }
    }
  }
  assert.deepEqual(readdirSync(dir), [], 'a command inside an instruction ran nowhere: the folder holds nothing');
});

test('the command names the folder first and the engine after it, in the same line', () => {
  assert.equal(startCommand('claude-code', '/tmp/demo', 'fix it'), "cd /tmp/demo && claude 'fix it'");
  assert.equal(startCommand('codex', "'/tmp/my demo'", 'fix it'), "cd '/tmp/my demo' && codex 'fix it'");
  assert.throws(() => startCommand('claude-code', '/tmp/demo', 'a\u0000b'), RangeError);
});

test('shWord keeps a plain path bare and quotes anything else', () => {
  assert.equal(shWord('/Users/a/proj-1_x.y'), '/Users/a/proj-1_x.y');
  assert.equal(shWord('/Users/a/my proj'), "'/Users/a/my proj'");
  assert.equal(shWord("/tmp/it's"), "'/tmp/it'\\''s'");
  assert.equal(shWord('/tmp/a$b'), "'/tmp/a$b'");
  assert.equal(shWord('/tmp/a\nb'), "'/tmp/a\nb'");
});

test('folderWord writes the home folder as ~ and quotes the rest; another folder keeps its full path', () => {
  assert.equal(folderWord('/Users/a/proj', '/Users/a'), '~/proj');
  assert.equal(folderWord('/Users/a', '/Users/a'), '~');
  assert.equal(folderWord('/Users/a/my proj/sub', '/Users/a'), "~/'my proj/sub'");
  assert.equal(folderWord('/Users/a/~x', '/Users/a'), "~/'~x'");
  assert.equal(folderWord('/Users/ab/proj', '/Users/a'), '/Users/ab/proj', 'a folder that only starts like home is not below it');
  assert.equal(folderWord('/srv/work', '/Users/a'), '/srv/work');
  assert.equal(folderWord('/srv/work', null), '/srv/work');
  assert.equal(folderWord('/srv/my work', null), "'/srv/my work'");
  assert.throws(() => folderWord('relative/path', null), RangeError);
  assert.throws(() => folderWord('', null), RangeError);
  assert.throws(() => folderWord('/tmp/a\u0000b', null), RangeError);
});

test('the shown folder word and the copied one leave the shell in the same folder', t => {
  const home = tempDir(t, 'bowerloom-home-');
  for (const name of ['plain', 'with space', "it's", 'dollar$sign', 'new\nline', 'ünï']) {
    const dir = join(home, name);
    mkdirSync(dir);
    const real = realpathSync(dir);
    const copied = seen(startCommand('claude-code', folderWord(dir, null), 'x'), 'claude', home);
    const shown = seen(startCommand('claude-code', folderWord(dir, realpathSync(home)), 'x'), 'claude', realpathSync(home));
    assert.equal(copied.folder, real, name);
    assert.equal(shown.folder, real, `${name} (shown form)`);
    assert.deepEqual(shown.args, copied.args);
  }
});

test('checkInstruction accepts ordinary text, emoji and a full-length text', () => {
  for (const text of ['fix it', 'two\nlines\twith a tab', 'emoji 🎉 👨‍💻 ❤️', 'x'.repeat(START_INSTRUCTION_LIMIT), "it's $(x) `y`; a && b | c", ' - leading space then dash']) assert.equal(checkInstruction(text), null, text.slice(0, 20));
});

test('checkInstruction names the problem: empty, too long, a control character, or a leading dash', () => {
  assert.equal(checkInstruction('')?.code, 'START_INSTRUCTION_EMPTY');
  assert.equal(checkInstruction(' \n\t ')?.code, 'START_INSTRUCTION_EMPTY');
  assert.equal(checkInstruction('x'.repeat(START_INSTRUCTION_LIMIT + 1))?.code, 'START_INSTRUCTION_TOO_LONG');
  for (const text of ['a\u0000b', 'a\rb', 'a\u001bb', 'a\u007fb', 'a\u0085b', 'a\u202eb', 'a\u2066b', 'a\u2028b', 'a\u200eb']) assert.equal(checkInstruction(text)?.code, 'START_INSTRUCTION_CHARACTERS', JSON.stringify(text));
  for (const text of ['-n', '--help', '-- x', '-']) assert.equal(checkInstruction(text)?.code, 'START_INSTRUCTION_DASH', text);
});

test('checkInstruction treats a value that is not text as no text at all', () => {
  for (const bad of [undefined, null, 7, {}, [], ['a']]) assert.equal(checkInstruction(bad)?.code, 'START_INSTRUCTION_EMPTY');
});

test('the limit is 4,000 characters and the words say so', () => {
  assert.equal(START_INSTRUCTION_LIMIT, 4000);
  assert.match(START_MAIN_WORDS.START_INSTRUCTION_TOO_LONG, /4,000/);
});

test('the words of every refusal are plain: inside the paragraph limit, free of banned words, and each ends the matter', () => {
  const codes = Object.keys(START_MAIN_WORDS);
  assert.deepEqual(codes.sort(), ['START_COPY_FAILED', 'START_FOLDER_HIDDEN', 'START_INSTRUCTION_CHARACTERS', 'START_INSTRUCTION_DASH', 'START_INSTRUCTION_EMPTY', 'START_INSTRUCTION_TOO_LONG']);
  for (const [code, text] of Object.entries(START_MAIN_WORDS)) {
    assert.ok(countWords(text) <= LIMITS.paragraph, `${code}: ${text}`);
    assert.equal(bannedHere(text), null, code);
  }
  assert.equal(Object.isFrozen(START_MAIN_WORDS), true);
});
