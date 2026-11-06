/**
 * The tidy-up report main opens for the Notes panel (spec 6.9; first five minutes, section 5). The window names a notes folder by the id main gave it and
 * never sends a path. Main finds the newest report itself, by the rule the panel's line uses (packages/notes-source, `readLatestReport`: the newest
 * `reports/YYYY-MM-DD-*.md` name of a plain file in a plain `reports` folder), then checks the path once more just before it opens it:
 *  - the notes folder is still its own real path;
 *  - the report's name is one plain name under `reports/`, with no `..`, slash, backslash, control character or format character (a direction mark such
 *    as the right-to-left override, or a zero-width character);
 *  - `reports` is a plain folder, not a link, and the report is a plain file of its own: not a link, no second hard link, the person's own, no execute bit,
 *    and at most REPORT_BYTE_LIMIT bytes;
 *  - the report's real path is that very path, inside the notes folder.
 * A path checked is not yet a file opened: another process could swap the report for a link to something that runs between the check and the open. So main
 * never hands the report's own path to the computer's opener. `createReportCopies` opens the report once, without following a link, checks what that one open
 * file is (the same file the check passed, plain, one link, the person's own, no execute bit, within the size cap), and copies its bytes from that open file
 * into a fresh private folder (mode 0700) as `report.md` (mode 0600). Main opens that copy. The copies go on the next open, and at quit.
 * Nothing here talks to the window: engine-service.ts calls it inside its gate.
 */
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, writeSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readLatestReport } from '../../../packages/notes-source/src/index.js';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { REPORT_MAIN_WORDS, REPORT_NONE, REPORT_UNSAFE } from '../shared/engine/types.js';

/**
 * The newest report's place: relative to the notes folder (`reports/<name>`) for the window, and absolute for main. `dev` and `ino` name the file the check
 * passed, so the copy reads that file and no other.
 */
export interface ReportPlace { readonly rel: string; readonly abs: string; readonly dev: number; readonly ino: number }

/** The largest report main copies and opens: 4 MiB. A tidy-up report is a page of text. */
export const REPORT_BYTE_LIMIT = 4 * 1024 * 1024;
/** The start of the name of each private folder that holds a copy. */
export const REPORT_COPY_PREFIX = 'bowerloom-report-';

const NAME = /^\d{4}-\d{2}-\d{2}-[^/\\\p{Cc}\p{Cf}]+\.md$/iu;
const unsafe = (): never => { throw new DefinitionError(REPORT_UNSAFE, REPORT_MAIN_WORDS.REPORT_UNSAFE); };
const uid = (): number | undefined => process.getuid?.();
/** True for a plain file of its own the person may open as text: one link, the person's own, no execute bit, within the size cap. */
const plainReport = (st: { isFile(): boolean; nlink: number; uid: number; mode: number; size: number }): boolean => st.isFile() && st.nlink === 1
  && (uid() === undefined || st.uid === uid()) && (st.mode & 0o111) === 0 && st.size <= REPORT_BYTE_LIMIT;

/** The newest report of the folder now, by name only, or null when it has none. Refuses as packages/notes-source does for a folder that is not plain. */
export function newestReport(notesDir: string): string | null {
  return readLatestReport(notesDir).latestReport?.path ?? null;
}

/** Checks the report `rel` of the folder again, as said above, and gives its place. Refuses REPORT_UNSAFE, or REPORT_NONE when it is gone. */
export function checkedReport(notesDir: string, rel: string): ReportPlace {
  const name = rel.startsWith('reports/') ? rel.slice('reports/'.length) : '';
  if (!NAME.test(name) || name.includes('..')) unsafe();
  let real: string;
  try { real = realpathSync(notesDir); } catch { return unsafe(); }
  if (real !== notesDir) unsafe();
  const folder = join(notesDir, 'reports'), abs = join(folder, name);
  try {
    const dir = lstatSync(folder);
    if (dir.isSymbolicLink() || !dir.isDirectory()) unsafe();
  } catch (error) { if (error instanceof DefinitionError) throw error; return unsafe(); }
  let st;
  try { st = lstatSync(abs); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DefinitionError(REPORT_NONE, REPORT_MAIN_WORDS.REPORT_NONE);
    return unsafe();
  }
  if (st.isSymbolicLink() || !plainReport(st)) unsafe();
  let realReport: string;
  try { realReport = realpathSync(abs); } catch { return unsafe(); }
  if (realReport !== abs || !realReport.startsWith(`${notesDir}${sep}`)) unsafe();
  return { rel: `reports/${name}`, abs, dev: st.dev, ino: st.ino };
}

/** Reads every byte of the open file `fd`, which fstat said holds `size` bytes. Refuses a file that grows past `size` or past the cap while it is read. */
function readAll(fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let at = 0;
  while (at < size) {
    const n = readSync(fd, buf, at, size - at, null);
    if (n === 0) break;
    at += n;
  }
  if (at !== size || readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) unsafe();
  return buf;
}

/** The report's bytes, read through one open of the checked path that follows no link, and only when that open file is the one the check passed. */
function readChecked(place: ReportPlace): Buffer {
  let fd: number;
  // O_NOFOLLOW: a report swapped for a link fails to open. O_NONBLOCK: a report swapped for a pipe never holds the open.
  try { fd = openSync(place.abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return unsafe(); }
  try {
    const st = fstatSync(fd);
    // The same file the check passed: a reports folder swapped for a link to another folder opens another file, with another inode.
    if (st.dev !== place.dev || st.ino !== place.ino || !plainReport(st)) unsafe();
    return readAll(fd, st.size);
  } finally { closeSync(fd); }
}

/** Main's private copies of reports, in fresh folders under the folder `root` names (the system temporary folder in the app). */
export interface ReportCopies {
  /** Removes the copies made before, then copies the checked report into a new private folder and gives the copy's path. Refuses REPORT_UNSAFE. */
  copy(place: ReportPlace): string;
  /** Removes every copy made here. Main calls it at quit. A copy that cannot be removed is told on the console. */
  clear(): void;
}

export function createReportCopies(root: () => string): ReportCopies {
  const made: string[] = [];
  const clear = (): void => {
    for (const dir of made.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch (error) { console.error('Bowerloom could not remove its copy of a tidy-up report.', error); }
    }
  };
  return {
    clear,
    copy: place => {
      clear();
      const bytes = readChecked(place);
      const dir = mkdtempSync(join(root(), REPORT_COPY_PREFIX));
      made.push(dir);
      try {
        // mkdtemp makes the folder 0700 already; the mode is set again so no umask or platform default can widen it.
        const folder = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fchmodSync(folder, 0o700); } finally { closeSync(folder); }
        const path = join(dir, 'report.md');
        const out = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          fchmodSync(out, 0o600);
          let at = 0;
          while (at < bytes.length) at += writeSync(out, bytes, at, bytes.length - at);
        } finally { closeSync(out); }
        return path;
      } catch (error) {
        clear();
        throw error;
      }
    },
  };
}
