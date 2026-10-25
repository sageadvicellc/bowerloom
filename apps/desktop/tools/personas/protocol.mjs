// What a persona may ask for, and nothing more. The client and the server both check every request against this list. A word that is not
// here is refused with a plain message. There is no command that reads page source, the DOM, styles, scripts or files, and no way to add one by an argument.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** A plain error that is safe to show to a persona. */
export class PersonaError extends Error {
  constructor(message) { super(message); this.name = 'PersonaError'; }
}

/** Every command a persona may send to the server. Keys are the only words the server accepts. */
export const COMMANDS = Object.freeze({
  look: 'Show what a person sees: the text, the controls with numbers, the focus, and a screenshot.',
  click: 'click <n>: press a control from the last look.',
  type: 'type <n> <text>: click a field from the last look, then type the text.',
  press: 'press <key>: press one key, such as Enter, Escape, Tab, Shift+Tab, ArrowDown, or a letter.',
  hover: 'hover <n>: move the pointer over a control from the last look.',
  drag: 'drag <from n> <to n>: drag one control onto another.',
  scroll: 'scroll <up|down> [n]: scroll the window, or the area under control n.',
  resize: 'resize <width> <height>: change the window size.',
  theme: 'theme <light|dark>: switch the colour scheme.',
  motion: 'motion <reduce|normal>: ask for less or normal movement.',
  goto: 'goto <welcome|map|tour>: start again at the first minute, at the map, or at the tour.',
  log: 'log <text>: write a note into the session transcript. Use it to think aloud.',
  stop: 'stop: end the session.',
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMANDS));

export const SCREENS = Object.freeze({ welcome: '#prototype-v2', map: '#prototype-v2/map', tour: '#prototype-v2/map/tour' });
const MAX_HANDLE = 9999, MIN_W = 320, MAX_W = 3840, MIN_H = 240, MAX_H = 2400, MAX_TEXT = 500;

const MODIFIERS = { shift: 'Shift', control: 'Control', ctrl: 'Control', alt: 'Alt', option: 'Alt', meta: 'Meta', cmd: 'Meta', command: 'Meta', controlormeta: 'ControlOrMeta' };
const NAMED_KEYS = { enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  arrowup: 'ArrowUp', up: 'ArrowUp', arrowdown: 'ArrowDown', down: 'ArrowDown', arrowleft: 'ArrowLeft', left: 'ArrowLeft', arrowright: 'ArrowRight', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
/** Shortcuts that would end or reload the window, or open its developer tools. */
const FORBIDDEN_SHORTCUT = /^(?:Control|Meta|ControlOrMeta)\+(?:Shift\+|Alt\+)*[qwrijn]$/i;

/** Turns what a persona typed into the name Playwright expects, or throws a plain error. */
export function normalizeKey(raw) {
  if (typeof raw !== 'string' || raw === '') throw new PersonaError('press needs one key, such as Enter or Escape.');
  const parts = raw.split('+');
  if (parts.length > 4) throw new PersonaError('That key combination is too long.');
  const key = parts.pop();
  const mods = parts.map(p => MODIFIERS[p.toLowerCase()]);
  if (mods.some(m => m === undefined) || new Set(mods).size !== mods.length) throw new PersonaError(`I do not know the key "${raw}". Use names like Enter, Escape, Tab, Shift+Tab, ArrowDown or a single letter.`);
  const named = NAMED_KEYS[key.toLowerCase()];
  const single = /^[A-Za-z0-9`~!@#$%^&*()_=+\[\]{};:'",.<>/?\\|-]$/.test(key);
  if (named === undefined && !single) throw new PersonaError(`I do not know the key "${raw}". Use names like Enter, Escape, Tab, Shift+Tab, ArrowDown or a single letter.`);
  const out = [...mods, named ?? key].join('+');
  if (FORBIDDEN_SHORTCUT.test(out)) throw new PersonaError(`${out} is not allowed here, because it could close or reload the window.`);
  return out;
}

function handleNumber(raw, label = 'a number') {
  if (!/^[0-9]{1,4}$/.test(String(raw ?? ''))) throw new PersonaError(`I need ${label} from the last look, such as 7.`);
  const n = Number(raw);
  if (n < 1 || n > MAX_HANDLE) throw new PersonaError(`${raw} is not a control number. Numbers start at 1.`);
  return n;
}

function oneOf(raw, allowed, usage) {
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!allowed.includes(v)) throw new PersonaError(`Use: ${usage}`);
  return v;
}

function cleanText(raw, usage) {
  // Control characters (including new lines) are dropped, so a line of the transcript is always one line.
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') throw new PersonaError(`Use: ${usage}`);
  if (text.length > MAX_TEXT) throw new PersonaError(`That text is longer than ${MAX_TEXT} characters. Say it in less.`);
  return text;
}

function size(raw, min, max, name) {
  if (!/^[0-9]{3,4}$/.test(String(raw ?? ''))) throw new PersonaError(`The ${name} must be a whole number from ${min} to ${max}.`);
  const n = Number(raw);
  if (n < min || n > max) throw new PersonaError(`The ${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/**
 * Checks one request and returns it in a fixed shape: { cmd, args } with typed arguments. Throws PersonaError for a word that is not on the list,
 * or an argument that is wrong. The server calls this too, so a hand-made request meets the same checks.
 */
export function validateCommand(cmd, args) {
  if (typeof cmd !== 'string' || !Object.hasOwn(COMMANDS, cmd)) throw new PersonaError(`I do not know "${String(cmd).slice(0, 40)}". The commands are: ${COMMAND_NAMES.join(', ')}.`);
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string') || args.length > 60) throw new PersonaError('The arguments must be a short list of words.');
  switch (cmd) {
    case 'look': case 'stop':
      if (args.length > 0) throw new PersonaError(`${cmd} takes no arguments.`);
      return { cmd, args: [] };
    case 'click': case 'hover':
      if (args.length !== 1) throw new PersonaError(`Use: ${cmd} <n>`);
      return { cmd, args: [handleNumber(args[0])] };
    case 'type': {
      if (args.length < 2) throw new PersonaError('Use: type <n> <text>');
      return { cmd, args: [handleNumber(args[0]), cleanText(args.slice(1).join(' '), 'type <n> <text>')] };
    }
    case 'press':
      if (args.length !== 1) throw new PersonaError('Use: press <key>');
      return { cmd, args: [normalizeKey(args[0])] };
    case 'drag':
      if (args.length !== 2) throw new PersonaError('Use: drag <from n> <to n>');
      return { cmd, args: [handleNumber(args[0], 'a "from" number'), handleNumber(args[1], 'a "to" number')] };
    case 'scroll':
      if (args.length < 1 || args.length > 2) throw new PersonaError('Use: scroll <up|down> [n]');
      return { cmd, args: args.length === 2 ? [oneOf(args[0], ['up', 'down'], 'scroll <up|down> [n]'), handleNumber(args[1])] : [oneOf(args[0], ['up', 'down'], 'scroll <up|down> [n]')] };
    case 'resize':
      if (args.length !== 2) throw new PersonaError('Use: resize <width> <height>');
      return { cmd, args: [size(args[0], MIN_W, MAX_W, 'width'), size(args[1], MIN_H, MAX_H, 'height')] };
    case 'theme':
      if (args.length !== 1) throw new PersonaError('Use: theme <light|dark>');
      return { cmd, args: [oneOf(args[0], ['light', 'dark'], 'theme <light|dark>')] };
    case 'motion':
      if (args.length !== 1) throw new PersonaError('Use: motion <reduce|normal>');
      return { cmd, args: [oneOf(args[0], ['reduce', 'normal'], 'motion <reduce|normal>')] };
    case 'goto':
      if (args.length !== 1) throw new PersonaError('Use: goto <welcome|map|tour>');
      return { cmd, args: [oneOf(args[0], Object.keys(SCREENS), 'goto <welcome|map|tour>')] };
    case 'log':
      if (args.length < 1) throw new PersonaError('Use: log <text>');
      return { cmd, args: [cleanText(args.join(' '), 'log <text>')] };
    default:
      throw new PersonaError(`I do not know "${cmd}".`);
  }
}

/** The command as one line, for the transcript. */
export function commandLine(cmd, args) { return [cmd, ...args.map(String)].join(' '); }

/** Replaces each given path in the text with <path>, longest first, so a result never carries a folder name of this machine. */
export function redact(text, paths) {
  let out = String(text);
  const list = [...new Set(paths.filter(p => typeof p === 'string' && p.length > 3))].sort((a, b) => b.length - a.length);
  for (const p of list) out = out.split(p).join('<path>');
  return out;
}

/** One transcript entry. The result is indented so the commands stand out. */
export function transcriptEntry(when, line, ok, result) {
  const body = String(result).replace(/\r/g, '').split('\n').map(l => `    ${l}`).join('\n');
  return `[${when}] > ${line}\n  ${ok ? 'ok' : 'error'}:\n${body}\n`;
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export function checkId(id) {
  if (!ID_PATTERN.test(id)) throw new PersonaError('An id uses letters, digits, dash and underscore, up to 32 characters.');
  return id;
}

/** The folder that holds the state files: BOWERLOOM_PERSONAS_DIR when set (the tests use it), else a folder in the system temporary folder. */
export function stateRoot(env = process.env, tmp = tmpdir()) {
  return env.BOWERLOOM_PERSONAS_DIR !== undefined && env.BOWERLOOM_PERSONAS_DIR !== '' ? env.BOWERLOOM_PERSONAS_DIR : join(tmp, 'bowerloom-personas');
}
export const stateFileFor = (root, id) => join(root, `state-${checkId(id)}.json`);

/** The folders whose names a result must never carry. */
export function secretPaths(extra = []) { return [homedir(), ...extra]; }

const FLAGS_WITH_VALUE = new Set(['--id', '--state', '--out', '--size']);

/**
 * Reads the command line. Flags (--id, --state, --out, --size) may come before the command, and after it for every command except `type` and
 * `log`, whose words are free text. Returns { command, args, flags }.
 */
export function parseCli(argv, env = process.env) {
  const flags = {};
  const rest = [...argv];
  const take = (list, index) => {
    const name = list[index];
    const value = list[index + 1];
    if (value === undefined || value.startsWith('--')) throw new PersonaError(`${name} needs a value.`);
    flags[name.slice(2)] = value;
    list.splice(index, 2);
  };
  while (rest.length > 0 && rest[0].startsWith('--')) {
    if (!FLAGS_WITH_VALUE.has(rest[0])) throw new PersonaError(`I do not know the option ${rest[0]}.`);
    take(rest, 0);
  }
  const command = rest.shift();
  if (command === undefined) return { command: undefined, args: [], flags };
  if (command !== 'type' && command !== 'log') {
    for (let i = 0; i < rest.length;) {
      if (FLAGS_WITH_VALUE.has(rest[i])) take(rest, i); else i += 1;
    }
  }
  if (flags.id === undefined && env.PERSONA_ID !== undefined && env.PERSONA_ID !== '') flags.id = env.PERSONA_ID;
  return { command, args: rest, flags };
}

export const USAGE = [
  'Usage: node tools/personas/drive.mjs [--id <id>] <command>',
  '',
  ...COMMAND_NAMES.map(n => `  ${COMMANDS[n]}`),
  '',
  'Run look first. Controls are numbered in each look. A number stays valid until the screen changes, goto is used, or you look again.',
  'You can set the id once with the PERSONA_ID environment variable.',
].join('\n');
