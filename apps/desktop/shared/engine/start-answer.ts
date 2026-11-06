/**
 * Start (beta.2): the answer of showStartCommand and startCommandToClipboard, built the same way in main and in the sample. Start runs nothing. This file builds one line of text for one engine in one folder, and for a copy
 * it hands that line to the clipboard function main gives it. It starts no process, reads no file, writes no file, and opens no connection: it imports only Bowerloom's own
 * pure modules, and a test holds that. The folder's full path stays here: the window gets the line with `~` for the home folder, and the clipboard gets the full path.
 */
import { ENGINE_NAMES } from './types.js';
import type { Answer, StartCommandView } from './types.js';
import { hasHiddenChar } from './scrub.js';
import { START_MAIN_WORDS, checkInstruction, folderWord, startCommand } from './start-command.js';
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
  /** True for a copy: the real line goes to `writeClipboard`. False for a show, which touches nothing. */
  readonly copy: boolean;
  readonly writeClipboard: ((text: string) => void) | undefined;
}

const refused = (code: StartRefusalCode): Answer<never> => ({ ok: false, refusal: { code, message: START_MAIN_WORDS[code], paths: [] } });

export function startAnswer(input: StartInput): Answer<StartCommandView> {
  const problem = checkInstruction(input.instruction);
  if (problem !== null) return refused(problem.code);
  // A hidden character in the folder name could make the shown line read differently from the copied one, so no line is built for that folder.
  if (hasHiddenChar(input.dir)) return refused('START_FOLDER_HIDDEN');
  const home = input.homes.find(h => h.length > 1 && (input.dir === h || input.dir.startsWith(`${h}/`))) ?? null;
  const real = startCommand(input.engine, folderWord(input.dir, null), input.instruction);
  const shown = startCommand(input.engine, folderWord(input.dir, home), input.instruction);
  if (input.copy) {
    // The reason the clipboard failed is not passed on: it could name a path or a program.
    try { if (input.writeClipboard === undefined) return refused('START_COPY_FAILED'); input.writeClipboard(real); } catch { return refused('START_COPY_FAILED'); }
  }
  return { ok: true, value: { engine: input.engine, engineName: ENGINE_NAMES[input.engine], folder: input.label, command: shown, copied: input.copy, differs: shown !== real } };
}
