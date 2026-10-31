// The persona tool's command allowlist and the rules around it: what a persona may ask for, how arguments are checked, how the command line is read,
// and how results are cleaned. Nothing here starts the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

interface Parsed { cmd: string; args: (string | number)[] }
interface Protocol {
  COMMANDS: Record<string, string>; COMMAND_NAMES: string[]; SCREENS: Record<string, string>;
  PersonaError: new (m: string) => Error;
  validateCommand(cmd: unknown, args: unknown): Parsed;
  normalizeKey(raw: unknown): string;
  redact(text: string, paths: string[]): string;
  transcriptEntry(when: string, line: string, ok: boolean, result: string): string;
  commandLine(cmd: string, args: unknown[]): string;
  checkId(id: string): string;
  stateRoot(env: Record<string, string | undefined>, tmp?: string): string;
  stateFileFor(root: string, id: string): string;
  parseCli(argv: string[], env?: Record<string, string | undefined>): { command: string | undefined; args: string[]; flags: Record<string, string> };
  USAGE: string;
}
const load = async (): Promise<Protocol> => await import(join(DESKTOP, 'tools', 'personas', 'protocol.mjs')) as Protocol;

test('the allowlist is exactly the thirteen commands of the brief', async () => {
  const p = await load();
  assert.deepEqual([...p.COMMAND_NAMES].sort(), ['click', 'drag', 'goto', 'hover', 'log', 'look', 'motion', 'press', 'resize', 'scroll', 'stop', 'theme', 'type']);
  assert.ok(Object.isFrozen(p.COMMANDS), 'nobody can add a command at run time');
  assert.deepEqual(Object.keys(p.SCREENS), ['welcome', 'map', 'tour']);
});

test('every word that is not on the list is refused with a plain message, and nothing can read source, markup, styles, scripts or files', async () => {
  const p = await load();
  const refused = ['eval', 'evaluate', 'exec', 'shell', 'html', 'source', 'dom', 'css', 'style', 'js', 'script', 'read', 'cat', 'ls', 'open', 'file', 'screenshot', 'shot', 'inspect', 'devtools', 'console',
    'Look', 'LOOK', 'look ', ' look', 'look;ls', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'help'];
  for (const word of refused) assert.throws(() => p.validateCommand(word, []), /I do not know/, `"${word}" must be refused`);
  for (const bad of [undefined, null, 7, {}, [], true]) assert.throws(() => p.validateCommand(bad, []), /I do not know/);
  // The refusal names the real commands so a persona can recover.
  assert.throws(() => p.validateCommand('eval', ['1+1']), /look, click, type/);
});

test('arguments must be a short list of words', async () => {
  const p = await load();
  assert.throws(() => p.validateCommand('click', 'seven'), /list of words/);
  assert.throws(() => p.validateCommand('click', [7]), /list of words/);
  assert.throws(() => p.validateCommand('click', [null]), /list of words/);
  assert.throws(() => p.validateCommand('log', Array.from({ length: 61 }, () => 'x')), /list of words/);
});

test('look and stop take no arguments', async () => {
  const p = await load();
  assert.deepEqual(p.validateCommand('look', []), { cmd: 'look', args: [] });
  assert.deepEqual(p.validateCommand('stop', []), { cmd: 'stop', args: [] });
  assert.throws(() => p.validateCommand('look', ['--path', '/etc/passwd']), /takes no arguments/);
  assert.throws(() => p.validateCommand('stop', ['now']), /takes no arguments/);
});

test('click, hover and type take a control number from 1 to 9999', async () => {
  const p = await load();
  assert.deepEqual(p.validateCommand('click', ['7']), { cmd: 'click', args: [7] });
  assert.deepEqual(p.validateCommand('hover', ['9999']), { cmd: 'hover', args: [9999] });
  for (const bad of ['0', '-1', '1.5', 'abc', '10000', '', '1e3', '0x10', ' 7', '7 ', '٣', '07a']) assert.throws(() => p.validateCommand('click', [bad]), /control number|from the last look|Numbers start/, `"${bad}"`);
  assert.throws(() => p.validateCommand('click', []), /Use: click/);
  assert.throws(() => p.validateCommand('click', ['1', '2']), /Use: click/);
  assert.deepEqual(p.validateCommand('type', ['3', 'hello', 'world']), { cmd: 'type', args: [3, 'hello world'] });
  assert.throws(() => p.validateCommand('type', ['3']), /Use: type/);
});

test('typed and logged text is cleaned: no control characters, one line, a length limit, and any unicode, emoji or SQL characters pass through as plain text', async () => {
  const p = await load();
  assert.deepEqual(p.validateCommand('type', ['1', 'a\nb\tc\u0000d']).args, [1, 'a b c d']);
  const sql = "Robert'); SELECT * FROM agents;--";
  assert.deepEqual(p.validateCommand('type', ['1', sql]).args, [1, sql]);
  assert.deepEqual(p.validateCommand('type', ['1', 'café \u{1F600} 中文']).args, [1, 'café \u{1F600} 中文']);
  assert.throws(() => p.validateCommand('type', ['1', 'x'.repeat(501)]), /longer than 500/);
  assert.equal((p.validateCommand('type', ['1', 'x'.repeat(500)]).args[1] as string).length, 500);
  assert.throws(() => p.validateCommand('type', ['1', '   ']), /Use: type/);
  assert.throws(() => p.validateCommand('log', ['\n\n']), /Use: log/);
  assert.throws(() => p.validateCommand('log', []), /Use: log/);
  assert.deepEqual(p.validateCommand('log', ['I', 'feel', 'lost']).args, ['I feel lost']);
});

test('press accepts plain keys and safe shortcuts, and refuses what could close, reload or open tools for the window', async () => {
  const p = await load();
  for (const [given, want] of [['Enter', 'Enter'], ['enter', 'Enter'], ['esc', 'Escape'], ['Escape', 'Escape'], ['Tab', 'Tab'], ['Shift+Tab', 'Shift+Tab'], ['shift+tab', 'Shift+Tab'], ['down', 'ArrowDown'], ['ArrowUp', 'ArrowUp'],
    ['space', 'Space'], ['a', 'a'], ['Z', 'Z'], ['7', '7'], ['/', '/'], ['cmd+z', 'Meta+z'], ['Control+Shift+z', 'Control+Shift+z'], ['PageDown', 'PageDown']] as const) assert.equal(p.normalizeKey(given), want, given);
  for (const bad of ['F5', 'F12', 'Meta+q', 'Control+w', 'Meta+r', 'Control+Shift+i', 'Meta+Alt+i', 'ControlOrMeta+n', 'Hyper+a', 'Enter+Enter+Enter+Enter+Enter', 'abc', '', 'Shift+', 'Shift+Shift+a']) assert.throws(() => p.normalizeKey(bad), /not allowed|do not know|too long|needs one key/, `"${bad}"`);
  assert.throws(() => p.normalizeKey(undefined), /needs one key/);
  assert.deepEqual(p.validateCommand('press', ['esc']), { cmd: 'press', args: ['Escape'] });
  assert.throws(() => p.validateCommand('press', []), /Use: press/);
  assert.throws(() => p.validateCommand('press', ['a', 'b']), /Use: press/);
});

test('drag, scroll, resize, theme, motion and goto check their arguments', async () => {
  const p = await load();
  assert.deepEqual(p.validateCommand('drag', ['4', '9']), { cmd: 'drag', args: [4, 9] });
  assert.throws(() => p.validateCommand('drag', ['4']), /Use: drag/);
  assert.throws(() => p.validateCommand('drag', ['x', '9']), /"from" number/);
  assert.throws(() => p.validateCommand('drag', ['4', '0']), /Numbers start|"to" number/);
  assert.deepEqual(p.validateCommand('scroll', ['Down']), { cmd: 'scroll', args: ['down'] });
  assert.deepEqual(p.validateCommand('scroll', ['up', '12']), { cmd: 'scroll', args: ['up', 12] });
  assert.throws(() => p.validateCommand('scroll', ['left']), /Use: scroll/);
  assert.throws(() => p.validateCommand('scroll', []), /Use: scroll/);
  assert.deepEqual(p.validateCommand('resize', ['900', '600']), { cmd: 'resize', args: [900, 600] });
  assert.deepEqual(p.validateCommand('resize', ['320', '240']).args, [320, 240]);
  assert.deepEqual(p.validateCommand('resize', ['3840', '2400']).args, [3840, 2400]);
  for (const [w, h] of [['319', '600'], ['3841', '600'], ['900', '239'], ['900', '2401'], ['abc', '600'], ['9', '9'], ['1e3', '600'], ['-900', '600']]) assert.throws(() => p.validateCommand('resize', [w!, h!]), /whole number/, `${w}x${h}`);
  assert.throws(() => p.validateCommand('resize', ['900']), /Use: resize/);
  assert.deepEqual(p.validateCommand('theme', ['DARK']).args, ['dark']);
  assert.throws(() => p.validateCommand('theme', ['blue']), /Use: theme/);
  assert.deepEqual(p.validateCommand('motion', ['reduce']).args, ['reduce']);
  assert.deepEqual(p.validateCommand('motion', ['normal']).args, ['normal']);
  assert.throws(() => p.validateCommand('motion', ['none']), /Use: motion/);
  for (const screen of ['welcome', 'map', 'tour']) assert.deepEqual(p.validateCommand('goto', [screen]).args, [screen]);
  assert.throws(() => p.validateCommand('goto', ['#prototype-v2/kit']), /Use: goto/);
  assert.throws(() => p.validateCommand('goto', ['https://example.com']), /Use: goto/);
  assert.throws(() => p.validateCommand('goto', ['file:///etc/passwd']), /Use: goto/);
});

test('redact swaps each folder name for <path>, longest first', async () => {
  const p = await load();
  assert.equal(p.redact('open /Users/x/repo/apps/desktop/a.ts now', ['/Users/x/repo', '/Users/x/repo/apps/desktop']), 'open <path>/a.ts now');
  assert.equal(p.redact('nothing to hide', ['/Users/x/repo']), 'nothing to hide');
  assert.equal(p.redact('a/b', ['', '/', 'a/']), 'a/b', 'a very short path is ignored, so text is not shredded');
});

test('a transcript entry holds the time, the command, the verdict and the indented result', async () => {
  const p = await load();
  const entry = p.transcriptEntry('2026-10-25T10:00:00.000Z', 'click 7', true, 'Pressed [7].\nSecond line');
  assert.equal(entry, '[2026-10-25T10:00:00.000Z] > click 7\n  ok:\n    Pressed [7].\n    Second line\n');
  assert.match(p.transcriptEntry('t', 'click 99', false, 'There is no control [99].'), /^\[t\] > click 99\n {2}error:\n {4}There is no control \[99\]\.\n$/);
  assert.equal(p.commandLine('drag', [4, 9]), 'drag 4 9');
});

test('ids and state files: a plain id, one state file per id, an override folder for tests', async () => {
  const p = await load();
  for (const ok of ['main', 'layperson', 'senior-dev', 'it_security', 'a1']) assert.equal(p.checkId(ok), ok);
  for (const bad of ['', '../x', 'a/b', 'a b', '-x', 'x'.repeat(33), 'a.b', 'é']) assert.throws(() => p.checkId(bad), /An id uses/, bad);
  assert.equal(p.stateFileFor('/t/root', 'main'), join('/t/root', 'state-main.json'));
  assert.equal(p.stateRoot({}, '/tmp-x'), join('/tmp-x', 'bowerloom-personas'));
  assert.equal(p.stateRoot({ BOWERLOOM_PERSONAS_DIR: '/over/ride' }, '/tmp-x'), '/over/ride');
  assert.equal(p.stateRoot({ BOWERLOOM_PERSONAS_DIR: '' }, '/tmp-x'), join('/tmp-x', 'bowerloom-personas'));
});

test('the command line: options before or after the command, free text kept whole for type and log, and PERSONA_ID as a default', async () => {
  const p = await load();
  assert.deepEqual(p.parseCli(['look']), { command: 'look', args: [], flags: {} });
  assert.deepEqual(p.parseCli(['--id', 'a', 'click', '7']), { command: 'click', args: ['7'], flags: { id: 'a' } });
  assert.deepEqual(p.parseCli(['click', '7', '--id', 'b']), { command: 'click', args: ['7'], flags: { id: 'b' } });
  assert.deepEqual(p.parseCli(['serve', '--id', 'c', '--out', '/o', '--size', '900x600']).flags, { id: 'c', out: '/o', size: '900x600' });
  // Free text is never read as an option.
  assert.deepEqual(p.parseCli(['type', '4', 'my', '--id', 'x']), { command: 'type', args: ['4', 'my', '--id', 'x'], flags: {} });
  assert.deepEqual(p.parseCli(['log', 'use', '--out', 'next']).args, ['use', '--out', 'next']);
  assert.equal(p.parseCli(['look'], { PERSONA_ID: 'env-id' }).flags.id, 'env-id');
  assert.equal(p.parseCli(['--id', 'flag', 'look'], { PERSONA_ID: 'env-id' }).flags.id, 'flag');
  assert.throws(() => p.parseCli(['--bogus', 'x', 'look']), /do not know the option/);
  assert.throws(() => p.parseCli(['--id']), /needs a value/);
  assert.throws(() => p.parseCli(['look', '--id']), /needs a value/);
  assert.equal(p.parseCli([]).command, undefined);
  assert.match(p.USAGE, /Run look first/);
});
