/**
 * The tidy-up report main opens for the Notes panel (spec 6.9; first five minutes, section 5). The window names a notes folder by the id main gave it and
 * never sends a path. Main finds the newest report itself, by the rule the panel's line uses (packages/notes-source, `readLatestReport`: the newest
 * `reports/YYYY-MM-DD-*.md` name of a plain file in a plain `reports` folder), then checks the path once more just before it opens it:
 *  - the notes folder is still its own real path;
 *  - the report's name is one plain name under `reports/`, with no `..`, slash, control character or backslash;
 *  - `reports` is a plain folder, not a link, and the report is a plain file of its own: not a link, and no second hard link;
 *  - the report's real path is that very path, inside the notes folder.
 * Nothing here opens a file or talks to the window: engine-service.ts calls it inside its gate.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readLatestReport } from '../../../packages/notes-source/src/index.js';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { REPORT_MAIN_WORDS, REPORT_NONE, REPORT_UNSAFE } from '../shared/engine/types.js';

/** The newest report's place: relative to the notes folder (`reports/<name>`) for the window, and absolute for main's opener. */
export interface ReportPlace { readonly rel: string; readonly abs: string }

const NAME = /^\d{4}-\d{2}-\d{2}-[^/\\\p{Cc}]+\.md$/iu;
const unsafe = (): never => { throw new DefinitionError(REPORT_UNSAFE, REPORT_MAIN_WORDS.REPORT_UNSAFE); };

/** The newest report of the folder now, by name only, or null when it has none. Refuses as packages/notes-source does for a folder that is not plain. */
export function newestReport(notesDir: string): string | null {
  return readLatestReport(notesDir).latestReport?.path ?? null;
}

/** Checks the report `rel` of the folder again, as said above, and gives its absolute path. Refuses REPORT_UNSAFE, or REPORT_NONE when it is gone. */
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
  if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1 || (process.getuid !== undefined && st.uid !== process.getuid())) unsafe();
  let realReport: string;
  try { realReport = realpathSync(abs); } catch { return unsafe(); }
  if (realReport !== abs || !realReport.startsWith(`${notesDir}${sep}`)) unsafe();
  return { rel: `reports/${name}`, abs };
}
