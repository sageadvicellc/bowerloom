/**
 * The command that Start shows and copies. Start runs nothing: it builds one line of text, `cd <folder> && <engine> '<instruction>'`, for a person to paste into their own
 * Terminal. This file builds that line and checks the instruction. It imports only the hiding-character list of scrub.ts, so main and the sample use the same code, and a test can run the line in a real shell.
 *
 * The engines and their commands, from the vendors' own pages (read 2026-11-06):
 *  - Claude Code: `claude "query"` starts an interactive session with an initial prompt (https://code.claude.com/docs/en/cli-reference, "CLI commands").
 *  - Codex: `codex [PROMPT]` launches the terminal UI, and the optional prompt is a text instruction to start the session (https://developers.openai.com/codex/cli/reference).
 * Neither page documents `--` to end the options, so an instruction that starts with a dash is refused rather than guessed at. Neither command here sets a permission
 * mode, a model, or any other flag: the engine asks the person as it always does.
 */

/** The engines Start has a command for, with the program name each vendor documents. */
import { hasHiddenCharExcept } from './scrub.js';

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
  return `'${text.replace(/'/g, `'\\''`)}'`;
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
  START_INSTRUCTION_DASH: 'The instruction starts with a dash, and the engine would read it as an option. Start with a word.',
  START_FOLDER_HIDDEN: 'The folder name holds hidden characters, so Bowerloom will not build a command for it.',
  START_FOLDER_NAME: 'The folder name holds a line break or a tab, so Bowerloom will not build a one-line command for it.',
  START_COPY_FAILED: 'Your computer would not copy it. Nothing was changed.',
} as const);
export type StartRefusalCode = keyof typeof START_MAIN_WORDS | 'START_INSTRUCTION_SUBCOMMAND';

export interface InstructionProblem { readonly code: StartRefusalCode }

/** Characters that act on a terminal when pasted, or reorder what the person reads: controls, DEL, C1 controls, line and paragraph separators, direction marks. Tab and line feed are fine. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** The hiding characters that emoji sequences need: the zero width joiner and the emoji variation selector. */
const EMOJI_PARTS: readonly string[] = ['\u200d', '\ufe0f'];

/** The problem with an instruction, or null when Start can build a command for it. A value that is not text counts as no text. */
export function checkInstruction(value: unknown): InstructionProblem | null {
  if (typeof value !== 'string' || value.trim() === '') return { code: 'START_INSTRUCTION_EMPTY' };
  if (value.length > START_INSTRUCTION_LIMIT) return { code: 'START_INSTRUCTION_TOO_LONG' };
  if (CONTROL.test(value)) return { code: 'START_INSTRUCTION_CHARACTERS' };
  // Invisible characters (tag characters, zero-width space, byte order mark, fillers) would reach the engine unseen. Emoji need the joiner and the variation selector, so those stay.
  if (hasHiddenCharExcept(value, EMOJI_PARTS)) return { code: 'START_INSTRUCTION_HIDDEN' };
  if (value.startsWith('-')) return { code: 'START_INSTRUCTION_DASH' };
  return null;
}

/**
 * The commands of each engine, from the vendors' own pages (read 2026-11-06): the "CLI commands" table of https://code.claude.com/docs/en/cli-reference, and the "Command overview" table
 * of https://developers.openai.com/codex/cli/reference (with the aliases it names: `a`, `cloud-tasks`, `e`). An engine reads a first argument that equals one of these as that command,
 * even when it is quoted, so a one-word instruction that equals one is refused. `help` is not in either table, so it is not listed.
 */
export const START_SUBCOMMANDS: Readonly<Record<StartEngineId, readonly string[]>> = Object.freeze({
  'claude-code': Object.freeze(['agents', 'attach', 'auth', 'auto-mode', 'daemon', 'doctor', 'gateway', 'import', 'install', 'logs', 'mcp', 'plugin', 'purge', 'remote-control', 'respawn', 'rm', 'self-hosted-runner', 'setup-token', 'stop', 'ultrareview', 'update']),
  codex: Object.freeze(['a', 'agents', 'app', 'app-server', 'apply', 'archive', 'cloud', 'cloud-tasks', 'completion', 'debug', 'delete', 'doctor', 'e', 'exec', 'execpolicy', 'features', 'fork', 'login', 'logout', 'mcp', 'plugin', 'queue', 'remote-control', 'resume', 'review', 'sandbox', 'unarchive', 'update']),
});

const ENGINE_LABELS: Readonly<Record<StartEngineId, string>> = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex' });

/** The word, when the whole instruction (not trimmed) is one command of the engine; else null. */
export const subcommandOf = (engine: StartEngineId, instruction: string): string | null => (START_SUBCOMMANDS[engine].includes(instruction) ? instruction : null);

/** "'update' is also a command of Claude Code. Add more words to your instruction." */
export const subcommandWords = (word: string, engine: StartEngineId): string => `'${word}' is also a command of ${ENGINE_LABELS[engine]}. Add more words to your instruction.`;
