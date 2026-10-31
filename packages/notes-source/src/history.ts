/**
 * The first commit of a notes folder: init, the exclude file, add of the listed paths in batches, one commit, then a
 * status check and the commit time. Both the starter and the init of a linked folder end here.
 *
 * The exclude file is `.git/info/exclude`, inside the repository Bowerloom just made. It keeps hidden names, such as a
 * note app's settings folder or a `.DS_Store`, out of the history, so they never make the tree unclean. It is the only
 * file Bowerloom writes inside `.git`, and it goes through the projection's checked write layer.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { checkAncestors, makeDir, writeAbs } from '../../project-sync/src/portable-files.js';
import { fileStep } from './folder.js';
import { addCommands, runGit } from './git.js';
import type { CommitMessage, GitBinary, GitRunOptions } from './git.js';
import { NotesRefusal, refuse } from './refusal.js';

export const EXCLUDE_TEXT = '# Written by Bowerloom. Hidden files and folders, such as app settings, stay out of the notes history.\n.*\n';
const EXCLUDE = '.git/info/exclude';

export interface FirstCommit {
  /** The commit time, from git log, as an ISO date. */
  readonly committedAt: string;
  /** True when git status lists nothing after the commit. */
  readonly clean: boolean;
}

/** Reads `git log -1 --format=%ct` output as an ISO date. Refuses NOTES_GIT_FAILED for anything else. */
export function commitTime(out: string): string {
  const m = /^(\d{1,12})\n?$/.exec(out);
  if (!m) return refuse('NOTES_GIT_FAILED');
  return new Date(Number(m[1]) * 1000).toISOString();
}

function writeExclude(dir: string): void {
  fileStep(() => {
    for (const missing of checkAncestors(dir, EXCLUDE)) makeDir(dir, missing);
    writeAbs(join(dir, EXCLUDE), Buffer.from(EXCLUDE_TEXT), 0o644, { label: EXCLUDE, recheck: () => { checkAncestors(dir, EXCLUDE, true); } });
  });
}

/**
 * Makes the first commit of `dir` with exactly `paths`. When a step fails after the repository exists, it refuses
 * NOTES_PARTIAL with `.git` and the paths in `written`, and `step` holds the refusal that stopped it.
 */
export async function firstCommit(git: GitBinary, dir: string, paths: readonly string[], message: CommitMessage, options: GitRunOptions, written: readonly string[] = []): Promise<FirstCommit> {
  try {
    await runGit(git, dir, { op: 'init' }, options);
    writeExclude(dir);
    for (const add of addCommands(paths)) await runGit(git, dir, add, options);
    await runGit(git, dir, { op: 'commit', message }, options);
    const status = await runGit(git, dir, { op: 'status' }, options);
    const committedAt = commitTime(await runGit(git, dir, { op: 'log-time' }, options));
    return { committedAt, clean: status === '' };
  } catch (e) {
    const left = [...(fs.existsSync(join(dir, '.git')) ? ['.git'] : []), ...written];
    if (left.length === 0) throw e;
    throw new NotesRefusal('NOTES_PARTIAL', left, e instanceof NotesRefusal ? e.code : undefined);
  }
}
