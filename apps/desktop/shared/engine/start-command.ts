/**
 * The command that Start shows and copies. Start runs nothing: it builds one line of text, `cd <folder> && <engine> '<instruction>'`, for a person to paste into their own
 * Terminal. This file builds that line and checks the instruction. It imports only the engines' command lists, so main and the sample use the same code, and a test can run the line in a real shell.
 *
 * The engines and their commands, from the vendors' own pages (read 2026-11-06):
 *  - Claude Code: `claude "query"` starts an interactive session with an initial prompt (https://code.claude.com/docs/en/cli-reference, "CLI commands").
 *  - Codex: `codex [PROMPT]` launches the terminal UI, and the optional prompt is a text instruction to start the session (https://developers.openai.com/codex/cli/reference).
 * Neither page documents `--` to end the options, so an instruction that starts with a dash is refused rather than guessed at. Neither command here sets a permission
 * mode, a model, or any other flag: the engine asks the person as it always does.
 */

/** The engines Start has a command for, with the program name each vendor documents. */
import { START_SUBCOMMANDS } from '../vendor/start-subcommands.js';

export const START_ENGINES = Object.freeze(['claude-code', 'codex'] as const);
export type StartEngineId = (typeof START_ENGINES)[number];
export const START_PROGRAMS: Readonly<Record<StartEngineId, string>> = Object.freeze({ 'claude-code': 'claude', codex: 'codex' });
export const isStartEngine = (value: unknown): value is StartEngineId => typeof value === 'string' && (START_ENGINES as readonly string[]).includes(value);

/** The longest instruction, in characters. The window and main both check it. */
export const START_INSTRUCTION_LIMIT = 4000;

/**
 * Wraps text in single quotes, the one quoting every POSIX shell reads the same way (sh, bash, zsh): inside single quotes nothing is special, so a single quote is written
 * as close-quote, backslash, quote, reopen-quote. A NUL cannot be in a shell argument, so it is refused.
 */
export function shQuote(text: string): string {
  if (text.includes('\u0000')) throw new RangeError('A shell argument cannot hold a NUL character.');
  return `'${text.split("'").join("'\\''")}'`;
}

const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** A word for a path: left bare when it holds only plain characters, else quoted. */
export const shWord = (text: string): string => (PLAIN.test(text) ? text : shQuote(text));

/**
 * The folder as a shell word. `home` is the home folder or null. A folder at or below home is written with `~` (a bare `~`, then `/`, then the rest as one word), which a shell
 * reads as the same folder on this computer. Any other folder keeps its full path. The path must be absolute and hold no NUL.
 */
export function folderWord(dir: string, home: string | null): string {
  if (!dir.startsWith('/') || dir.includes('\u0000')) throw new RangeError('The folder must be an absolute path with no NUL character.');
  if (home !== null && home.length > 1 && home.startsWith('/')) {
    if (dir === home) return '~';
    if (dir.startsWith(`${home}/`)) return `~/${shWord(dir.slice(home.length + 1))}`;
  }
  return shWord(dir);
}

/** The whole line. `folder` is already a shell word (`folderWord`). The instruction is one quoted argument. */
export function startCommand(engine: StartEngineId, folder: string, instruction: string): string {
  return `cd ${folder} && ${START_PROGRAMS[engine]} ${shQuote(instruction)}`;
}

/** The words of every refusal of Start, the same in main and in the sample. Each says nothing was copied or built. */
export const START_MAIN_WORDS = Object.freeze({
  START_INSTRUCTION_EMPTY: 'Write an instruction first.',
  START_INSTRUCTION_TOO_LONG: 'The instruction is longer than 4,000 characters. Make it shorter.',
  START_INSTRUCTION_CHARACTERS: 'The instruction holds a control character, such as a null or a carriage return. Remove it.',
  START_INSTRUCTION_HIDDEN: 'The instruction has hidden characters. Remove them and try again.',
  START_INSTRUCTION_BROKEN: 'The instruction has a broken character. Remove the last character you pasted and try again.',
  START_INSTRUCTION_DASH: 'The instruction starts with a dash, and the engine would read it as an option. Start with a word.',
  START_FOLDER_HIDDEN: 'The folder name holds hidden characters, so Bowerloom will not build a command for it.',
  START_FOLDER_NAME: 'The folder name holds a line break or a tab, so Bowerloom will not build a one-line command for it.',
  START_COPY_FAILED: 'Your computer would not copy it. Nothing was changed.',
} as const);
export type StartRefusalCode = keyof typeof START_MAIN_WORDS | 'START_INSTRUCTION_SUBCOMMAND';

export interface InstructionProblem {
  readonly code: StartRefusalCode;
  /** The words for the person. For a hidden character they name the character and its position. */
  readonly message: string;
}

/** Characters that act on a terminal when pasted, or reorder what the person reads: controls, DEL, C1 controls, line and paragraph separators, direction marks. Tab and line feed are fine. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/**
 * Every character that does not show: the default-ignorable code points (zero-width and joiner marks, variation selectors, tag characters, fillers, the braille blank), the format
 * characters, every space but the plain one, controls, and private use (it draws as a box). Property classes, so a later Unicode version is covered too. `Cn` (code points with no
 * meaning yet, and noncharacters) is refused because a later Unicode version could make one invisible; it also refuses an emoji newer than this runtime's tables, which fails closed.
 * Three marks that have no ink (the Tifinagh consonant joiner, the Khitan filler, the musical null notehead) are named, as they are not in any of those classes.
 */
const HIDING = /[\u2800\u2d7f\u{16fe4}\u{1d159}\p{Cn}\p{Default_Ignorable_Code_Point}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cc}\p{Co}]/u;
/** The emoji sequences of the Unicode standard (a family, a heart with its selector, a keycap, a flag, a skin tone). Only inside one is a joiner or a selector allowed. */
const EMOJI = new RegExp('\\p{RGI_Emoji}', 'gv');
/** A combining mark of any kind (non-spacing, enclosing, spacing), and the most that may follow one base in a row. */
const MARK = /\p{M}/u;
/** What a mark may sit on: a letter, number, symbol or punctuation mark. A space, a tab, a line feed, a control, or the start of the text is no base, so a mark there has nothing to draw on. */
const BASE = /[\p{L}\p{N}\p{S}\p{P}]/u;
/** Code points the runtime's Unicode tables do not give a meaning (and noncharacters). Refused, but not called invisible: they may well show. */
const UNASSIGNED = /\p{Cn}/u;
const MAX_MARKS = 3;
/** A surrogate with no partner: text cut in the middle of an emoji. A clipboard would turn it into U+FFFD, so the copy could never read back the same. */
const BROKEN = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export const hasBrokenCharacter = (text: string): boolean => BROKEN.test(text);

/** The first character that does not show, outside every real emoji sequence, with its place counted in characters from 1. A plain space, a tab and a line feed show, so they pass. */
export function firstHidden(text: string): { readonly point: number; readonly position: number; readonly stack?: boolean; readonly kind?: 'unassigned' | 'orphan' } | null {
  const spans = [...text.matchAll(EMOJI)].map(m => [m.index, m.index + m[0].length] as const);
  let at = 0, position = 0, k = 0, run = 0, runStart = 0, base = false;
  while (at < text.length) {
    while (k < spans.length && spans[k]![1] <= at) k += 1;
    position += 1;
    // A real emoji sequence counts as one character, and nothing in it hides.
    if (k < spans.length && at >= spans[k]![0]) { at = spans[k]![1]; run = 0; base = true; continue; }
    const ch = String.fromCodePoint(text.codePointAt(at)!);
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && HIDING.test(ch)) return { point: ch.codePointAt(0)!, position, ...(UNASSIGNED.test(ch) ? { kind: 'unassigned' as const } : {}) };
    // One to three marks on a visible base are text (accents, Thai, Hindi). A mark with no base (after a space, a tab, a line feed, or at the start) draws on nothing, so a run of them
    // on blank cells would carry hidden bits: it is refused. A longer stack on a base is refused as a whole. A spacing mark counts in the run, so it cannot reset the count.
    if (MARK.test(ch)) {
      if (!base) return { point: ch.codePointAt(0)!, position, kind: 'orphan' };
      if (run === 0) runStart = position;
      run += 1;
      if (run > MAX_MARKS) return { point: ch.codePointAt(0)!, position: runStart, stack: true };
    } else { run = 0; base = BASE.test(ch); }
    at += ch.length;
  }
  return null;
}

/** True when a folder path holds a broken or hiding character. A tab and a line feed are a separate refusal. */
export const hiddenPath = (path: string): boolean => hasBrokenCharacter(path) || firstHidden(path) !== null;

const HIDDEN_NAMES: Readonly<Record<number, string>> = Object.freeze({
  0xa0: 'no-break space', 0x200b: 'zero-width space', 0x200c: 'zero-width non-joiner', 0x200d: 'zero-width joiner', 0xfeff: 'byte order mark', 0xad: 'soft hyphen', 0x3000: 'ideographic space',
});
/** "U+00A0 (no-break space)". The common ones have a name; any other is "an invisible character". */
const pointWords = (point: number): string => `U+${point.toString(16).toUpperCase().padStart(4, '0')} (${HIDDEN_NAMES[point] ?? 'an invisible character'})`;

/** "U+10D40 (this app cannot check it)". An unassigned code point is not known to be invisible, so it is not called that. */
const unassignedWords = (point: number): string => `U+${point.toString(16).toUpperCase().padStart(4, '0')} (this app cannot check it)`;

const problem = (code: StartRefusalCode, message?: string): InstructionProblem => ({ code, message: message ?? START_MAIN_WORDS[code as keyof typeof START_MAIN_WORDS] });

/**
 * The problem with an instruction, or null when Start can build a command for it. A value that is not text counts as no text. The text is never changed: a problem is named, and the
 * person fixes it. Hidden characters are refused because they would reach the engine unseen; the joiner and the emoji selector pass only inside a real emoji sequence.
 */
export function checkInstruction(value: unknown): InstructionProblem | null {
  if (typeof value !== 'string' || value.trim() === '') return problem('START_INSTRUCTION_EMPTY');
  if (value.length > START_INSTRUCTION_LIMIT) return problem('START_INSTRUCTION_TOO_LONG');
  if (hasBrokenCharacter(value)) return problem('START_INSTRUCTION_BROKEN');
  if (CONTROL.test(value)) return problem('START_INSTRUCTION_CHARACTERS');
  const hidden = firstHidden(value);
  if (hidden !== null) {
    if (hidden.kind === 'unassigned') return problem('START_INSTRUCTION_HIDDEN', `The instruction has an unassigned character: ${unassignedWords(hidden.point)} at position ${hidden.position}. Remove it and try again.`);
    const what = hidden.stack === true ? 'a stack of marks' : hidden.kind === 'orphan' ? 'a combining mark with no letter to sit on' : pointWords(hidden.point);
    return problem('START_INSTRUCTION_HIDDEN', `The instruction has a hidden character: ${what} at position ${hidden.position}. Remove it and try again.`);
  }
  if (value.startsWith('-')) return problem('START_INSTRUCTION_DASH');
  return null;
}

export { START_SUBCOMMANDS };

const ENGINE_LABELS: Readonly<Record<StartEngineId, string>> = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex' });

/** The word, when the whole instruction (not trimmed) is one command of the engine; else null. */
export const subcommandOf = (engine: StartEngineId, instruction: string): string | null => (START_SUBCOMMANDS[engine].includes(instruction) ? instruction : null);

/** "'update' is also a command of Claude Code. Add more words to your instruction." */
export const subcommandWords = (word: string, engine: StartEngineId): string => `'${word}' is also a command of ${ENGINE_LABELS[engine]}. Add more words to your instruction.`;
