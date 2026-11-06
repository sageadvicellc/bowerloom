/**
 * Start (beta.2): the answer of showStartCommand and startCommandToClipboard, built the same way in main and in the sample. Start runs nothing. This file builds one line of text for one engine in one folder, and for a copy
 * it hands that line to the clipboard function main gives it. It starts no process, reads no file, writes no file, and opens no connection: it imports only Bowerloom's own
 * pure modules, and a test holds that. The folder's full path stays here: the window gets the line with `~` for the home folder, and the clipboard gets the full path.
 */
import { ENGINE_NAMES } from './types.js';
import type { Answer, StartCommandView } from './types.js';
import { hasHiddenChar } from './scrub.js';
import { START_MAIN_WORDS, checkInstruction, folderWord, startCommand, subcommandOf, subcommandWords } from './start-command.js';
import type { StartEngineId, StartRefusalCode } from './start-command.js';

export interface StartInput {
  /** The folder, as main knows it: an absolute path. It never leaves main. */
  readonly dir: string;
  /** The folder as the window already shows it (`~` for the home folder). */
  readonly label: string;
  /** The home folder, in every form main knows it (the given one and its real path). */
  readonly homes: readonly string[];
  readonly engine: StartEngineId;
  readonly instruction: string;
}

/** What the window may read, and the line for the clipboard, which stays in main. */
export interface StartBuilt { readonly view: StartCommandView; readonly real: string }

export const startRefused = (code: StartRefusalCode, message?: string): Answer<never> => ({
  ok: false, refusal: { code, message: message ?? START_MAIN_WORDS[code as keyof typeof START_MAIN_WORDS], paths: [] },
});

/** Builds the command for the window (`view`, nothing copied yet) and the one for the clipboard (`real`). It touches nothing. */
export function buildStart(input: StartInput): Answer<StartBuilt> {
  const problem = checkInstruction(input.instruction);
  if (problem !== null) return startRefused(problem.code);
  // An engine reads a one-word instruction that equals one of its own commands as that command, even when it is quoted.
  const word = subcommandOf(input.engine, input.instruction);
  if (word !== null) return startRefused('START_INSTRUCTION_SUBCOMMAND', subcommandWords(word, input.engine));
  // A hidden character in the folder name could make the shown line read differently from the copied one, so no line is built for that folder.
  if (hasHiddenChar(input.dir)) return startRefused('START_FOLDER_HIDDEN');
  // A line break or a tab in the folder name would break the one-line command.
  if (/[\n\t]/.test(input.dir)) return startRefused('START_FOLDER_NAME');
  const home = input.homes.find(h => h.length > 1 && (input.dir === h || input.dir.startsWith(`${h}/`))) ?? null;
  const real = startCommand(input.engine, folderWord(input.dir, null), input.instruction);
  const shown = startCommand(input.engine, folderWord(input.dir, home), input.instruction);
  return { ok: true, value: { real, view: { engine: input.engine, engineName: ENGINE_NAMES[input.engine], folder: input.label, command: shown, copied: false, differs: shown !== real } } };
}

/** The sample's answer: the view, with nothing copied. */
export function startAnswer(input: StartInput): Answer<StartCommandView> {
  const built = buildStart(input);
  return built.ok ? { ok: true, value: built.value.view } : built;
}
