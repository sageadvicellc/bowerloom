// The Start command (beta.2): Start shows the command for one engine and one folder and copies it. It runs nothing. The instruction is any text a person types, so
// the one quoting function is proved against a real shell: for every nasty input, the final command passes the instruction to the program as ONE argument, unchanged.
// The shell runs a function named like the engine that only prints its arguments. No engine is ever started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  START_ENGINES, START_INSTRUCTION_LIMIT, START_MAIN_WORDS, START_PROGRAMS, START_SUBCOMMANDS, checkInstruction, folderWord, isStartEngine, shQuote, shWord, startCommand, subcommandOf, subcommandWords, hiddenPath,
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
  assert.deepEqual(codes.sort(), ['START_COPY_FAILED', 'START_FOLDER_HIDDEN', 'START_FOLDER_NAME', 'START_INSTRUCTION_BROKEN', 'START_INSTRUCTION_CHARACTERS', 'START_INSTRUCTION_DASH', 'START_INSTRUCTION_EMPTY', 'START_INSTRUCTION_HIDDEN', 'START_INSTRUCTION_TOO_LONG']);
  for (const [code, text] of Object.entries(START_MAIN_WORDS)) {
    assert.ok(countWords(text) <= LIMITS.paragraph, `${code}: ${text}`);
    assert.equal(bannedHere(text), null, code);
  }
  assert.equal(Object.isFrozen(START_MAIN_WORDS), true);
});

test('checkInstruction refuses invisible characters: tag characters, zero-width space, BOM, soft hyphen, word joiners, fillers, braille blank, variation selectors', () => {
  const hidden = ['a\u{e0041}b', 'a\u{e007f}', 'a\u200bb', 'a\ufeffb', 'a\u00adb', 'a\u2060b', 'a\u2064b', 'a\u180eb', 'a\u3164b', 'a\u2800b', 'a\ufe00b', 'a\u200cb', 'a\u{e0100}b', 'a\u034fb', 'a\u115fb'];
  for (const text of hidden) assert.equal(checkInstruction(text)?.code, 'START_INSTRUCTION_HIDDEN', JSON.stringify(text));
  assert.equal(START_MAIN_WORDS.START_INSTRUCTION_HIDDEN, 'The instruction has hidden characters. Remove them and try again.');
});

test('emoji still pass: a ZWJ sequence, a heart with its variation selector, a flag, and a skin tone', () => {
  for (const text of ['team \u{1F468}\u200d\u{1F4BB} ships', 'love \u2764\ufe0f it', '\u{1F1E9}\u{1F1EA} flag', 'wave \u{1F44B}\u{1F3FD}', 'tab\there\nand a line']) assert.equal(checkInstruction(text), null, JSON.stringify(text));
});

test('the subcommand lists are the names the vendors document (read 2026-11-06), and a one-word instruction equal to one is found for that engine only', () => {
  assert.deepEqual([...START_SUBCOMMANDS['claude-code']], ['agents', 'attach', 'auth', 'auto-mode', 'daemon', 'doctor', 'gateway', 'help', 'import', 'install', 'logs', 'mcp', 'plugin', 'purge', 'remote-control', 'respawn', 'rm', 'self-hosted-runner', 'setup-token', 'stop', 'ultrareview', 'update']);
  assert.deepEqual([...START_SUBCOMMANDS.codex], ['a', 'agents', 'app', 'app-server', 'apply', 'archive', 'cloud', 'cloud-tasks', 'completion', 'debug', 'delete', 'doctor', 'e', 'exec', 'execpolicy', 'features', 'fork', 'help', 'login', 'logout', 'mcp', 'plugin', 'queue', 'remote-control', 'resume', 'review', 'sandbox', 'unarchive', 'update']);
  for (const engine of START_ENGINES) for (const word of START_SUBCOMMANDS[engine]) assert.equal(subcommandOf(engine, word), word, `${engine} ${word}`);
  assert.equal(subcommandOf('codex', 'login'), 'login'); assert.equal(subcommandOf('claude-code', 'login'), null, 'login is a Codex command, not a Claude Code one');
  assert.equal(subcommandOf('claude-code', 'review'), null); assert.equal(subcommandOf('codex', 'review'), 'review');
});

test('only an exact one-word instruction counts: more words, other case, or any space around it are fine', () => {
  for (const text of ['update the docs', 'Update', ' update', 'update ', 'update\n', 'fix', '', 'mcp servers']) assert.equal(subcommandOf('claude-code', text), null, JSON.stringify(text));
});

test('the words for a subcommand name the word and the engine, and ask for more words', () => {
  assert.equal(subcommandWords('update', 'claude-code'), "'update' is also a command of Claude Code. Add more words to your instruction.");
  assert.equal(subcommandWords('login', 'codex'), "'login' is also a command of Codex. Add more words to your instruction.");
  assert.ok(countWords(subcommandWords('self-hosted-runner', 'claude-code')) <= LIMITS.paragraph);
  assert.equal(bannedHere(subcommandWords('update', 'claude-code')), null);
});

test('no refusal of the instruction or the folder says "Nothing was copied", since a show copies nothing', () => {
  for (const [code, text] of Object.entries(START_MAIN_WORDS)) if (code !== 'START_COPY_FAILED') assert.doesNotMatch(text, /copied/i, code);
});

const hiddenCode = (text: string): string | undefined => checkInstruction(text)?.code;

test('a joiner or a variation selector is allowed only inside a real emoji sequence: alone, in a run, or between letters it is refused', () => {
  for (const text of ['a\u200db', 'a\ufe0fb', 'a\ufe0f\ufe0f\ufe0fb', '\u2764\ufe0f\ufe0f', '\u{1F468}\u200d\u200d\u{1F4BB}', 'x \u200d', 'ok\ufe0f']) assert.equal(hiddenCode(text), 'START_INSTRUCTION_HIDDEN', JSON.stringify(text));
  // The bit-coded payload: 8 hidden characters for each byte of "hello" (joiner is 1, selector is 0).
  const payload = [...'hello'].map(c => [...c.charCodeAt(0).toString(2).padStart(8, '0')].map(b => (b === '1' ? '\u200d' : '\ufe0f')).join('')).join('');
  assert.equal(payload.length, 40);
  assert.equal(hiddenCode(`fix the login${payload}`), 'START_INSTRUCTION_HIDDEN');
  assert.equal(hiddenCode(`fix ${payload} the login`), 'START_INSTRUCTION_HIDDEN');
});

test('real emoji sequences still pass: a family, a heart with its selector, a keycap, a flag, a skin tone, a profession, a rainbow flag', () => {
  for (const text of ['\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466} home', 'love \u2764\ufe0f it', 'press 1\ufe0f\u20e3 now', '\u{1F1E9}\u{1F1EA} flag', 'wave \u{1F44B}\u{1F3FD}', '\u{1F469}\u{1F3FD}\u200d\u{1F4BB} codes', '\u{1F3F3}\ufe0f\u200d\u{1F308} pride', 'tab\tand\nlines']) assert.equal(checkInstruction(text), null, JSON.stringify(text));
});

test('every default-ignorable code point is refused when it stands alone, so a future Unicode version is covered too', () => {
  let count = 0;
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (!/\p{Default_Ignorable_Code_Point}/u.test(ch)) continue;
    count += 1;
    assert.notEqual(checkInstruction(`a${ch}b`), null, `U+${cp.toString(16).toUpperCase()}`);
  }
  assert.ok(count > 4000, `${count} code points`);
});

test('the gaps of the older list are refused: U+180F, U+2065, U+FFF0-FFF8, U+E0080-E00FF, U+E01F0-E0FFF, format marks, and private use', () => {
  const cps = [0x180f, 0x2065, 0xfff0, 0xfff8, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0080, 0xe00ff, 0xe01f0, 0xe0fff, 0x600, 0x605, 0x6dd, 0x70f, 0x890, 0x891, 0x8e2, 0x110bd, 0x110cd, 0x13430, 0x1343f, 0xe000, 0xf8ff, 0xf0000, 0x10fffd];
  for (const cp of cps) assert.notEqual(checkInstruction(`a${String.fromCodePoint(cp)}b`), null, `U+${cp.toString(16).toUpperCase()}`);
});

test('spaces that are not a plain space are refused: no-break space, ideographic space, thin space, narrow no-break space', () => {
  for (const cp of [0xa0, 0x3000, 0x2009, 0x202f, 0x2003, 0x1680, 0x205f]) assert.equal(hiddenCode(`a${String.fromCodePoint(cp)}b`), 'START_INSTRUCTION_HIDDEN', `U+${cp.toString(16)}`);
  assert.equal(checkInstruction('a b\tc\nd'), null, 'a plain space, a tab and a line feed are fine');
});

test('the refusal names the first hidden character and its position, in plain words, and never changes the text', () => {
  const text = 'fix the\u00a0login';
  assert.equal(checkInstruction(text)?.message, 'The instruction has a hidden character: U+00A0 (no-break space) at position 8. Remove it and try again.');
  assert.equal(text, 'fix the\u00a0login');
  assert.equal(checkInstruction('ab\u200bc')?.message, 'The instruction has a hidden character: U+200B (zero-width space) at position 3. Remove it and try again.');
  assert.equal(checkInstruction('\u200cx')?.message, 'The instruction has a hidden character: U+200C (zero-width non-joiner) at position 1. Remove it and try again.');
  assert.equal(checkInstruction('x\ufeff')?.message, 'The instruction has a hidden character: U+FEFF (byte order mark) at position 2. Remove it and try again.');
  assert.equal(checkInstruction('x\u00ady')?.message, 'The instruction has a hidden character: U+00AD (soft hyphen) at position 2. Remove it and try again.');
  assert.equal(checkInstruction('x\u3000y')?.message, 'The instruction has a hidden character: U+3000 (ideographic space) at position 2. Remove it and try again.');
  assert.equal(checkInstruction('x\u2060y')?.message, 'The instruction has a hidden character: U+2060 (an invisible character) at position 2. Remove it and try again.');
  // A position counts characters, so an emoji before it counts once, and a real emoji sequence does not hide the character after it.
  assert.equal(checkInstruction('\u{1F468}\u200d\u{1F4BB}\u200bx')?.message, 'The instruction has a hidden character: U+200B (zero-width space) at position 2. Remove it and try again.');
  assert.equal(checkInstruction('a\u{e0041}')?.message, 'The instruction has a hidden character: U+E0041 (an invisible character) at position 2. Remove it and try again.');
});

test('a lone surrogate, from text cut in the middle of an emoji, is refused with its own words', () => {
  for (const text of ['fix \ud800 this', 'fix \udc00 this', 'cut \u{1F468}'.slice(0, -1)]) {
    const problem = checkInstruction(text);
    assert.equal(problem?.code, 'START_INSTRUCTION_BROKEN', JSON.stringify(text));
    assert.equal(problem?.message, 'The instruction has a broken character. Remove the last character you pasted and try again.');
  }
  assert.equal(checkInstruction('whole \u{1F468} pair'), null);
});

test('a folder path is held to the same rules: a hidden character or a broken one is found, an emoji sequence in a name is not', () => {
  assert.equal(hiddenPath('/Users/a/x\u200by'), true); assert.equal(hiddenPath('/Users/a/x\u00a0y'), true); assert.equal(hiddenPath('/Users/a/x\ud800y'), true);
  assert.equal(hiddenPath('/Users/a/\u{1F468}\u200d\u{1F4BB} work'), false); assert.equal(hiddenPath('/Users/a/plain name'), false);
});

test('help is refused for both engines, since both parsers add it', () => {
  for (const engine of START_ENGINES) assert.equal(subcommandOf(engine, 'help'), 'help', engine);
  assert.equal(subcommandWords('help', 'codex'), "'help' is also a command of Codex. Add more words to your instruction.");
});
