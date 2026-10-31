/**
 * The refusal codes of the harness bundle and their words. One table serves the package, the command line (`apps/cli/src/human.ts` copies each sentence) and the
 * app (main puts `message` in a `Refusal`). The README states the same table, and a test keeps the two equal. The sentences repeat no text from a file. A refusal
 * may name paths: each one is shortened (see `PATH_SHOWN_CHARS`) and its control characters are escaped, so a path in a message is quoted text of bounded size.
 * The words follow plain English: short sentences, active voice, no contractions.
 */
import { DefinitionError, oneLine } from '../../contracts/src/index.js';
import type { Problem } from '../../harness-definition/src/index.js';

export const BUNDLE_MESSAGES = Object.freeze({
  BUNDLE_USAGE: 'The choices do not fit this file, or a value of the call is not allowed. Nothing was written.',
  BUNDLE_FORMAT: 'This is not a Bowerloom harness file, or it is a form Bowerloom does not read. Nothing was written.',
  BUNDLE_TOO_LARGE: 'This file is larger than Bowerloom reads, or it holds more files or bytes than a harness may. Nothing was written.',
  BUNDLE_DAMAGED: 'This file does not match its own sizes or checksums, so it was changed or damaged. Nothing was written.',
  BUNDLE_PATH_UNSAFE: 'This file names a path that is not a plain path inside the harness. Nothing was written.',
  BUNDLE_SECRET_FOUND: 'A file holds what looks like a secret value. A harness never carries one. Nothing was written.',
  BUNDLE_INVALID: 'The files in this bundle do not make a harness that loads. Nothing was written.',
  BUNDLE_FILE_UNSAFE: 'The bundle file is a link, is not a plain file that you own, or changed while it was read. Nothing was read or written.',
  BUNDLE_EXISTS: 'A file exists at that place already. Bowerloom does not replace it. Nothing was written.',
  IMPORT_FOLDER_HAS_HARNESS: 'This folder has a harness with parts in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written.',
  IMPORT_NEEDS_ACKNOWLEDGEMENT: 'This file holds tools or files that can run, values it reads from this computer, or paths from another computer. Tick that you read them, then import. Nothing was written.',
  EXPORT_NEEDS_ACKNOWLEDGEMENT: 'These files hold a path from this computer. Tick that you read them, then export. Nothing was written.',
} as const);

export type BundleCode = keyof typeof BUNDLE_MESSAGES;
/** Every code, in the order of the table. */
export const BUNDLE_CODES: readonly BundleCode[] = Object.freeze(Object.keys(BUNDLE_MESSAGES) as BundleCode[]);

/** The most characters of one path a message shows. A longer path is cut and ends in an ellipsis. */
export const PATH_SHOWN_CHARS = 120;
/** One path as a message shows it: at most PATH_SHOWN_CHARS characters, control, format and line-separator characters escaped, and an ellipsis when it was cut. */
export function shownPath(path: string): string {
  let head = '', count = 0, cut = false;
  for (const ch of path) {
    if (count === PATH_SHOWN_CHARS) { cut = true; break; }
    head += ch; count += 1;
  }
  const text = oneLine(head);
  return cut ? `${text}\u2026` : text;
}

/**
 * A refusal of the bundle package. `paths` are bundle paths (relative to `.bowerloom`) or, for the file codes, nothing. `problems` are the loader's, by path
 * and code. `message` is the table sentence, then up to 20 paths, each shortened by `shownPath`, on one line. Its size is bounded whatever the paths are.
 */
export class BundleRefusal extends DefinitionError {
  declare readonly code: BundleCode;
  /** At most 20 paths, each as `shownPath` gives it, so no caller can pass an unbounded string on. */
  readonly paths: readonly string[];
  constructor(code: BundleCode, paths: readonly string[] = [], readonly problems: readonly Problem[] = []) {
    const shown = paths.slice(0, 20).map(shownPath);
    super(code, `${BUNDLE_MESSAGES[code]}${shown.length > 0 ? ` ${shown.join(', ')}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    this.paths = shown;
    this.name = 'BundleRefusal';
  }
}
