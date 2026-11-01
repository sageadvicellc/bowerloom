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
  BUNDLE_FILE_FAILED: 'The file could not be read or written. The disk may be full or read-only, the name may be too long, or you may lack permission. Nothing was read or written.',
  BUNDLE_EXISTS: 'A file exists at that place already. Bowerloom does not replace it. Nothing was written.',
  IMPORT_FOLDER_HAS_HARNESS: 'This folder has a harness with parts or settings in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written.',
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
 * Why a file could not be read or written, in plain words, by the code of the system error. These go after the table sentence of `BUNDLE_FILE_FAILED`. They name no path
 * and no operating system text. Any other code gets the last line.
 */
export const FILE_FAILED_REASONS: Readonly<Record<string, string>> = Object.freeze({
  ENOSPC: 'The disk is full.',
  EDQUOT: 'The disk is full.',
  EACCES: 'You do not have permission for that folder or file.',
  EPERM: 'You do not have permission for that folder or file.',
  EROFS: 'The disk is read-only.',
  ENAMETOOLONG: 'The file name is too long.',
  EIO: 'The disk reported an error.',
  ENOENT: 'The file or the folder is not there.',
  EBUSY: 'The file is in use.',
  EMFILE: 'Too many files are open.',
  ENFILE: 'Too many files are open.',
});
const OTHER_REASON = 'The system refused the file.';

/** The kind of a fault for a log: the code of a system error, else the class name of the error. Never a message, never a path. */
export function causeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^E[A-Z0-9]{2,20}$/.test(code)) return code;
  const name = (error as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof name === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : 'Error';
}

/** The plain-words reason of a file failure, by the code of the system error. */
const reasonOf = (code: BundleCode, cause: string | undefined): string | undefined =>
  code === 'BUNDLE_FILE_FAILED' ? (cause !== undefined ? FILE_FAILED_REASONS[cause] : undefined) ?? OTHER_REASON : undefined;

/** The message of a refusal, true by construction: the table sentence, the reason, then the shortened paths and how many more there were. */
const messageOf = (code: BundleCode, reason: string | undefined, shown: readonly string[], more: number): string =>
  `${BUNDLE_MESSAGES[code]}${reason !== undefined ? ` ${reason}` : ''}${shown.length > 0 ? ` ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}.` : ''}`;

/**
 * A refusal of the bundle package. `paths` are bundle paths (relative to `.bowerloom`) or, for the file codes, nothing. `problems` are the loader's, by path
 * and code. `message` is the table sentence, then up to 20 paths, each shortened by `shownPath`, on one line. Its size is bounded whatever the paths are.
 *  - `cause`: only a system error code (`ENOSPC`) or the class name of an internal fault (`RangeError`), never a path and never the text of an error. It is kept for logs, is not
 *    enumerable, and is not part of `message`.
 *  - `BUNDLE_FILE_FAILED` carries a plain-words reason after the table sentence, chosen by the system error code in `cause`.
 *  - `more` is how many paths there were past the 20 that `paths` holds.
 * A refusal crosses a worker boundary as `toJSON()` and comes back with `BundleRefusal.fromPlain`, because the structured clone of an error drops its extra fields. The
 * message is built again from the code, never copied.
 */
export class BundleRefusal extends DefinitionError {
  declare readonly code: BundleCode;
  /** At most 20 paths, each as `shownPath` gives it, so no caller can pass an unbounded string on. */
  readonly paths: readonly string[];
  /** How many paths there were past the 20 in `paths`. */
  readonly more: number;
  /** The plain-words reason of a `BUNDLE_FILE_FAILED`, else undefined. */
  readonly reason: string | undefined;
  declare readonly cause: string | undefined;
  constructor(code: BundleCode, paths: readonly string[] = [], readonly problems: readonly Problem[] = [], cause?: string) {
    const shown = paths.slice(0, 20).map(shownPath);
    const more = Math.max(0, paths.length - 20);
    const reason = reasonOf(code, cause);
    super(code, messageOf(code, reason, shown, more));
    this.paths = shown;
    this.more = more;
    this.reason = reason;
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false, writable: false, configurable: true });
    this.name = 'BundleRefusal';
  }

  /** The plain form that crosses a worker boundary. */
  toJSON(): { name: 'BundleRefusal'; code: BundleCode; message: string; paths: readonly string[]; more: number; problems: readonly Problem[]; reason: string | undefined; cause: string | undefined } {
    return { name: 'BundleRefusal', code: this.code, message: this.message, paths: this.paths, more: this.more, problems: this.problems, reason: this.reason, cause: this.cause };
  }

  /**
   * Builds a refusal again from what `toJSON` gave. Every field is checked and cut, and the message is rebuilt from the code table, the reason of the cause, the checked paths
   * and the count: the `message` of the plain value is not read, so no text can ride in it. A value that is not one gives `BUNDLE_USAGE`.
   */
  static fromPlain(value: unknown): BundleRefusal {
    const v = value as { code?: unknown; paths?: unknown; more?: unknown; problems?: unknown; cause?: unknown } | null;
    if (v === null || typeof v !== 'object' || typeof v.code !== 'string' || !(BUNDLE_CODES as readonly string[]).includes(v.code)) return new BundleRefusal('BUNDLE_USAGE');
    const code = v.code as BundleCode;
    const cause = typeof v.cause === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v.cause) ? v.cause : undefined;
    const problems = Array.isArray(v.problems) ? (v.problems as unknown[]).slice(0, 200).flatMap(p => {
      const q = p as { code?: unknown; path?: unknown; message?: unknown } | null;
      return q !== null && typeof q === 'object' && typeof q.code === 'string' && typeof q.path === 'string' && typeof q.message === 'string'
        ? [{ code: oneLine(q.code.slice(0, 100)), path: shownPath(q.path), message: oneLine(q.message.slice(0, 300)) }] : [];
    }) : [];
    // A path is kept only if it is already in the form `shownPath` makes: no control character, and no longer than 120 characters cut plus the escapes it may hold.
    const paths = Array.isArray(v.paths) ? (v.paths as unknown[]).slice(0, 20).filter((x): x is string => typeof x === 'string' && x.length <= 800 && oneLine(x) === x) : [];
    const more = typeof v.more === 'number' && Number.isSafeInteger(v.more) && v.more >= 0 ? v.more : 0;
    const refusal = new BundleRefusal(code, [], problems, cause);
    const reason = refusal.reason;
    Object.defineProperty(refusal, 'paths', { value: paths, enumerable: true, writable: false, configurable: true });
    Object.defineProperty(refusal, 'more', { value: more, enumerable: true, writable: false, configurable: true });
    refusal.message = messageOf(code, reason, paths, more);
    return refusal;
  }
}
