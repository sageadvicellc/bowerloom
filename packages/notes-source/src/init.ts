/**
 * Version history for a linked wiki folder that has none. The plan lists every file the first commit adds; apply plans
 * again, and runs init, add of exactly those paths, and one commit only when the revision is the one approved.
 *
 * The listing never opens a file and never follows a link. A link is listed as a link, and git stores it as a link.
 * Hidden names are kept out of the commit, and the exclude file keeps them out of the tree's status. A folder that holds
 * a git settings file, a nested repository, or no file at all is refused, because the first commit would then not be
 * the list shown or would leave the tree unclean.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { byBytes, revisionOf, sha } from '../../project-sync/src/portable-files.js';
import { MAX_PATH_BYTES, plainRelative, verifiedFolder } from './folder.js';
import { COMMIT_MESSAGES, findGit } from './git.js';
import { firstCommit } from './history.js';
import { refuse } from './refusal.js';
import type { NotesOptions } from './starter.js';

export const GIT_INIT_PLAN_FORMAT = 'bowerloom/notes-git-init-plan/v1beta1' as const;
export const GIT_INIT_LIMITS = Object.freeze({ entries: 20_000, depth: 64 });
const GIT_FILES = new Set(['.gitignore', '.gitattributes', '.gitmodules']);

export interface GitInitOptions extends NotesOptions {
  /** The most entries the listing reads before it refuses NOTES_TOO_LARGE. Default 20000. */
  readonly maxEntries?: number;
}

export interface GitInitPlan {
  readonly format: typeof GIT_INIT_PLAN_FORMAT;
  readonly dir: string;
  /** Every path the first commit adds, sorted. A link is added as a link. */
  readonly files: readonly { readonly path: string; readonly kind: 'file' | 'link' }[];
  /** How many hidden files and folders stay out of the commit. */
  readonly hidden: number;
  readonly message: typeof COMMIT_MESSAGES.history;
  readonly revision: string;
}

export interface GitInitResult {
  readonly dir: string;
  readonly files: readonly string[];
  readonly committedAt: string;
  readonly clean: boolean;
}

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;
const git = (options: NotesOptions) => findGit(options.gitCandidates === undefined ? {} : { candidates: options.gitCandidates });

function buildPlan(dir: unknown, options: GitInitOptions): GitInitPlan {
  const folder = verifiedFolder(dir);
  const maxEntries = options.maxEntries ?? GIT_INIT_LIMITS.entries;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) refuse('NOTES_USAGE');
  let gitThere = true;
  try { fs.lstatSync(join(folder.abs, '.git')); } catch (e) { if (errno(e) !== 'ENOENT') refuse('NOTES_PATH_UNSAFE', ['.git']); gitThere = false; }
  if (gitThere) refuse('NOTES_ALREADY_REPOSITORY');
  const files: { path: string; kind: 'file' | 'link' }[] = [], marks: string[] = [];
  let hidden = 0, entries = 0;
  const stack: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }];
  while (stack.length) {
    const { rel, depth } = stack.pop()!;
    if (depth > GIT_INIT_LIMITS.depth) refuse('NOTES_TOO_LARGE');
    let names: string[];
    try { names = fs.readdirSync(join(folder.abs, rel)); } catch { return refuse('NOTES_PATH_UNSAFE', [rel || '.']); }
    for (const name of names.sort(byBytes)) {
      if (++entries > maxEntries) refuse('NOTES_TOO_LARGE');
      const child = rel ? `${rel}/${name}` : name, lower = name.toLowerCase();
      if (lower === '.git') refuse('NOTES_NESTED_REPOSITORY', [child]);
      if (GIT_FILES.has(lower)) refuse('NOTES_GIT_FILES', [child]);
      if (name.startsWith('.')) { hidden++; continue; }
      if (!plainRelative(child) || Buffer.byteLength(child) > MAX_PATH_BYTES) refuse('NOTES_PATH_UNSAFE', [child]);
      let st: fs.Stats;
      try { st = fs.lstatSync(join(folder.abs, child)); } catch { return refuse('NOTES_STALE', [child]); }
      if (st.isDirectory()) { stack.push({ rel: child, depth: depth + 1 }); marks.push(`d\0${child}\0${st.ino}`); continue; }
      const kind = st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : null;
      if (kind === null) continue; // a socket or pipe: git does not track it
      files.push({ path: child, kind });
      marks.push(`${kind}\0${child}\0${st.ino}\0${st.size}\0${st.mtimeMs}`);
    }
  }
  if (files.length === 0) refuse('NOTES_NOTHING_TO_COMMIT');
  files.sort((a, b) => byBytes(a.path, b.path));
  const body = { format: GIT_INIT_PLAN_FORMAT, dir: folder.abs, files, hidden, message: COMMIT_MESSAGES.history };
  const revision = revisionOf({ ...body, folder: folder.id, state: sha(marks.sort(byBytes).join('\n')) });
  return { ...body, revision };
}

/**
 * Plans version history for a linked folder with no `.git`. Reads names and file states only; never opens a file.
 * Refuses NOTES_PATH_UNSAFE, NOTES_FOLDER_MISSING, NOTES_ALREADY_REPOSITORY, NOTES_NESTED_REPOSITORY, NOTES_GIT_FILES,
 * NOTES_NOTHING_TO_COMMIT, NOTES_TOO_LARGE, or NOTES_GIT_MISSING.
 */
export function planGitInit(dir: string, options: GitInitOptions = {}): GitInitPlan {
  const plan = buildPlan(dir, options);
  git(options);
  return plan;
}

/**
 * Starts the history the plan with `revision` showed: init, add of exactly the listed paths, and one commit. Refuses
 * NOTES_STALE, before it runs anything, when the folder changed since the plan. A failure after init refuses
 * NOTES_PARTIAL with `.git`, which is left as it is.
 */
export async function applyGitInit(dir: string, revision: string, options: GitInitOptions = {}): Promise<GitInitResult> {
  const binary = git(options);
  const plan = buildPlan(dir, options);
  if (plan.revision !== revision) refuse('NOTES_STALE');
  const paths = plan.files.map(f => f.path);
  const done = await firstCommit(binary, plan.dir, paths, COMMIT_MESSAGES.history, options);
  return { dir: plan.dir, files: paths, ...done };
}
