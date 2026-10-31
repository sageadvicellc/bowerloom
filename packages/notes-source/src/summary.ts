/**
 * The summary of one notes folder, for the Notes panel. It reads names only and never opens a page:
 *
 * - The page count is every `*.md` name of a plain file, outside hidden folders, without following any link. It stops
 *   at an entry bound and a time bound, and says when it stopped early. A folder it cannot list leaves it incomplete.
 * - The latest report date comes from `reports/YYYY-MM-DD-*.md` names, in a real `reports` folder.
 * - The last commit time comes from `git log -1 --format=%ct`, when `.git` is a real folder and its own config passes runGit's check. A folder inside a
 *   larger repository (repo.ts finds it by a walk of plain folders) reads that repository's log for the folder only: `-- <prefix>`.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { byBytes } from '../../project-sync/src/portable-files.js';
import { uid, verifiedFolder } from './folder.js';
import { findGit, runGit } from './git.js';
import { commitTime } from './history.js';
import { isNotesRefusal, refuse } from './refusal.js';
import { findRepository } from './repo.js';
import type { NotesOptions } from './starter.js';

export const NOTES_SUMMARY_FORMAT = 'bowerloom/notes-summary/v1beta1' as const;
export const SUMMARY_LIMITS = Object.freeze({ entries: 50_000, timeBudgetMs: 2000, depth: 64, gitTimeoutMs: 5000 });

export interface SummaryOptions extends NotesOptions {
  /** The most entries the count reads. Default 50000. */
  readonly maxEntries?: number;
  /** The most milliseconds the count takes. Default 2000. */
  readonly timeBudgetMs?: number;
  /** The clock the time bound reads. Tests pass one; the app passes nothing. */
  readonly clock?: () => number;
}

/**
 * - `git`: `.git` is a real folder and git log read its last commit.
 * - `parent`: the folder sits inside a larger repository, whose `.git` is a real folder, and git log read it for this folder only. `lastCommitAt` is null
 *   when no commit of that repository touched the folder yet. Bowerloom never starts a repository there.
 * - `no-commit`: `.git` is a real folder, and git log found no commit, or git cannot read it as a repository. A history start that stopped part way
 *   leaves this; it is never ready.
 * - `none`: the folder has no `.git`.
 * - `git-missing`: the folder has `.git`, and git is not installed.
 * - `refused`: the repository's own git settings could make git start a program (NOTES_GIT_CONFIG), so no git command ran.
 * - `unreadable`: the nearest `.git` is not a real folder of yours, the folder's place in a larger repository is not a plain path, or git stopped on a
 *   timeout or the output cap.
 */
export type NotesHistory = 'git' | 'parent' | 'no-commit' | 'none' | 'git-missing' | 'refused' | 'unreadable';

export interface NotesSummary {
  readonly format: typeof NOTES_SUMMARY_FORMAT;
  readonly pages: number;
  /** False when a bound stopped the count, or a folder could not be listed. */
  readonly complete: boolean;
  readonly history: NotesHistory;
  /** The last commit time as an ISO date, or null. */
  readonly lastCommitAt: string | null;
  /** The newest report by the date in its name, or null. */
  readonly latestReport: { readonly date: string; readonly path: string } | null;
  /** False when the listing of `reports/` stopped at the entry bound or failed part way, so a newer report may be unread. */
  readonly reportsComplete: boolean;
}

const MD = /\.md$/i;
const REPORT = /^(\d{4})-(\d{2})-(\d{2})-.+\.md$/i;

function countPages(dir: string, maxEntries: number, budget: number, clock: () => number): { pages: number; complete: boolean } {
  const start = clock();
  let pages = 0, entries = 0, complete = true;
  const stack: { abs: string; depth: number }[] = [{ abs: dir, depth: 0 }];
  walk: while (stack.length) {
    const { abs, depth } = stack.pop()!;
    if (depth > SUMMARY_LIMITS.depth) { complete = false; continue; }
    let handle: fs.Dir;
    try { handle = fs.opendirSync(abs); } catch { complete = false; continue; }
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        if (++entries > maxEntries || clock() - start > budget) { complete = false; break walk; }
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) stack.push({ abs: join(abs, entry.name), depth: depth + 1 });
        else if (entry.isFile() && MD.test(entry.name)) pages++;
      }
    } catch { complete = false; } finally { handle.closeSync(); }
  }
  return { pages, complete };
}

function validDate(y: string, m: string, d: string): boolean {
  const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return t.getUTCFullYear() === Number(y) && t.getUTCMonth() === Number(m) - 1 && t.getUTCDate() === Number(d);
}

function latestReport(dir: string, maxEntries: number): Pick<NotesSummary, 'latestReport' | 'reportsComplete'> {
  const abs = join(dir, 'reports');
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid()) return { latestReport: null, reportsComplete: true };
  } catch { return { latestReport: null, reportsComplete: true }; }
  let best: { date: string; name: string } | null = null, complete = true;
  let handle: fs.Dir;
  try { handle = fs.opendirSync(abs); } catch { return { latestReport: null, reportsComplete: false }; }
  try {
    let n = 0;
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      if (++n > maxEntries) { complete = false; break; }
      const m = REPORT.exec(entry.name);
      if (!m || !entry.isFile() || !validDate(m[1]!, m[2]!, m[3]!)) continue;
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      if (!best || date > best.date || (date === best.date && byBytes(entry.name, best.name) > 0)) best = { date, name: entry.name };
    }
  } catch { complete = false; /* a listing that fails part way keeps what it read */ } finally { handle.closeSync(); }
  return { latestReport: best ? { date: best.date, path: `reports/${best.name}` } : null, reportsComplete: complete };
}

async function history(dir: string, options: SummaryOptions): Promise<Pick<NotesSummary, 'history' | 'lastCommitAt'>> {
  const repo = findRepository(dir, options);
  if (repo.kind === 'none') return { history: 'none', lastCommitAt: null };
  if (repo.kind === 'not-plain' || repo.kind === 'unknown' || (repo.kind === 'parent' && repo.prefix === null)) return { history: 'unreadable', lastCommitAt: null };
  let git;
  try { git = findGit(options.gitCandidates === undefined ? {} : { candidates: options.gitCandidates }); } catch { return { history: 'git-missing', lastCommitAt: null }; }
  const run = { timeoutMs: options.timeoutMs ?? SUMMARY_LIMITS.gitTimeoutMs, ...(options.outputBytes === undefined ? {} : { outputBytes: options.outputBytes }) };
  try {
    if (repo.kind === 'self') return { history: 'git', lastCommitAt: commitTime(await runGit(git, dir, { op: 'log-time' }, run)) };
    // The larger repository's log, for this folder only. No output: no commit of that repository touched the folder yet.
    const out = await runGit(git, repo.root, { op: 'log-time', prefix: repo.prefix! }, run);
    return { history: 'parent', lastCommitAt: out === '' ? null : commitTime(out) };
  } catch (e) {
    if (isNotesRefusal(e, 'NOTES_GIT_FAILED')) return { history: 'no-commit', lastCommitAt: null };
    if (isNotesRefusal(e, 'NOTES_GIT_CONFIG')) return { history: 'refused', lastCommitAt: null };
    if (isNotesRefusal(e, 'NOTES_GIT_MISSING')) return { history: 'git-missing', lastCommitAt: null };
    if (isNotesRefusal(e, 'NOTES_USAGE')) throw e;
    return { history: 'unreadable', lastCommitAt: null };
  }
}

/**
 * Reads the summary of a linked notes folder. Never opens a page and never follows a link. Refuses
 * NOTES_FOLDER_MISSING, NOTES_PATH_UNSAFE, or NOTES_USAGE (a bound out of range).
 */
export async function readNotesSummary(dir: string, options: SummaryOptions = {}): Promise<NotesSummary> {
  const folder = verifiedFolder(dir);
  const maxEntries = options.maxEntries ?? SUMMARY_LIMITS.entries, budget = options.timeBudgetMs ?? SUMMARY_LIMITS.timeBudgetMs;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(budget) || budget < 0) refuse('NOTES_USAGE');
  const clock = options.clock ?? (() => performance.now());
  const { pages, complete } = countPages(folder.abs, maxEntries, budget, clock);
  return {
    format: NOTES_SUMMARY_FORMAT, pages, complete, ...(await history(folder.abs, options)), ...latestReport(folder.abs, maxEntries),
  };
}
