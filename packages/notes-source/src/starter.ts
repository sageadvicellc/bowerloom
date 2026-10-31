/**
 * The starter wiki: Bowerloom writes a template into a new or empty folder, then makes it a git repository with one
 * first commit. Create-only: a folder that holds anything, even one hidden file, is refused. The template arrives as a
 * list of `{ path, bytes }`; this package does not read it from anywhere.
 *
 * The plan reads only and lists every folder and file. Apply plans again and writes only when the revision is the one
 * approved. Every folder and file goes through the projection's create-only layer: the folders above it are checked just
 * before the write, and a file is linked into place, so it never replaces anything that appeared since the check.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { byBytes, checkAncestors, makeDir, revisionOf, sha, writeAbs } from '../../project-sync/src/portable-files.js';
import { fileStep, plainRelative, targetFolder } from './folder.js';
import { COMMIT_MESSAGES, findGit } from './git.js';
import type { GitRunOptions } from './git.js';
import { firstCommit } from './history.js';
import { NotesRefusal, refuse } from './refusal.js';

export const STARTER_PLAN_FORMAT = 'bowerloom/notes-starter-plan/v1beta1' as const;
export const STARTER_LIMITS = Object.freeze({ files: 256, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024, depth: 8 });

/** One file of the starter template. */
export interface TemplateFile { readonly path: string; readonly bytes: Uint8Array }

export interface NotesOptions extends GitRunOptions {
  /** The paths to look for git instead of the fixed ones. Tests pass these; the app passes nothing. */
  readonly gitCandidates?: readonly string[];
}

export interface StarterPlan {
  readonly format: typeof STARTER_PLAN_FORMAT;
  readonly dir: string;
  /** True when the folder does not exist yet and apply creates it. */
  readonly createsFolder: boolean;
  /** The folders apply creates inside it, parents first. */
  readonly folders: readonly string[];
  /** The files apply writes, each with its size and SHA-256. They are also exactly what the first commit holds. */
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  readonly message: typeof COMMIT_MESSAGES.starter;
  readonly revision: string;
}

export interface StarterResult {
  readonly dir: string;
  readonly files: readonly string[];
  readonly committedAt: string;
  readonly clean: boolean;
}

const git = (options: NotesOptions) => findGit(options.gitCandidates === undefined ? {} : { candidates: options.gitCandidates });

/** Checks the template and returns it sorted by path. Refuses NOTES_TEMPLATE_INVALID. */
function checkTemplate(files: unknown): TemplateFile[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > STARTER_LIMITS.files) return refuse('NOTES_TEMPLATE_INVALID');
  const seen = new Set<string>(), folded = new Set<string>();
  let total = 0;
  const out: TemplateFile[] = [];
  for (const f of files as unknown[]) {
    if (f === null || typeof f !== 'object') return refuse('NOTES_TEMPLATE_INVALID');
    const { path, bytes } = f as Record<string, unknown>;
    if (!plainRelative(path) || path.normalize('NFC') !== path || path.split('/').length > STARTER_LIMITS.depth || !(bytes instanceof Uint8Array)) return refuse('NOTES_TEMPLATE_INVALID');
    if (bytes.length > STARTER_LIMITS.fileBytes || (total += bytes.length) > STARTER_LIMITS.totalBytes) return refuse('NOTES_TEMPLATE_INVALID');
    const fold = path.toLowerCase();
    if (seen.has(path) || folded.has(fold)) return refuse('NOTES_TEMPLATE_INVALID');
    seen.add(path); folded.add(fold);
    out.push({ path, bytes });
  }
  // A path that is a file and also a folder of another file.
  for (const p of folded) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) if (folded.has(parts.slice(0, i).join('/'))) refuse('NOTES_TEMPLATE_INVALID'); }
  return out.sort((a, b) => byBytes(a.path, b.path));
}

function foldersOf(files: readonly TemplateFile[]): string[] {
  const set = new Set<string>();
  for (const f of files) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/')); }
  return [...set].sort(byBytes);
}

function buildPlan(dir: unknown, templateFiles: unknown): { plan: StarterPlan; files: TemplateFile[] } {
  const target = targetFolder(dir);
  const files = checkTemplate(templateFiles);
  if (target.existing && fs.readdirSync(target.abs).length > 0) refuse('NOTES_NOT_EMPTY');
  const body = {
    format: STARTER_PLAN_FORMAT, dir: target.abs, createsFolder: target.existing === null, folders: foldersOf(files),
    files: files.map(f => ({ path: f.path, bytes: f.bytes.length, sha256: sha(f.bytes) })), message: COMMIT_MESSAGES.starter,
  };
  const revision = revisionOf({ ...body, folder: target.existing?.id ?? 'absent', parent: target.parent.id });
  return { plan: { ...body, revision }, files };
}

/**
 * Plans a starter wiki in `dir`, an absent folder whose parent exists, or an empty folder. Reads only. Refuses
 * NOTES_PATH_UNSAFE, NOTES_FOLDER_MISSING, NOTES_NOT_EMPTY, NOTES_TEMPLATE_INVALID, or NOTES_GIT_MISSING.
 */
export function planStarter(dir: string, templateFiles: readonly TemplateFile[], options: NotesOptions = {}): StarterPlan {
  const { plan } = buildPlan(dir, templateFiles);
  git(options);
  return plan;
}

/**
 * Writes the starter wiki the plan with `revision` showed, then makes the first commit. Refuses NOTES_STALE when the
 * plan now differs, before it writes anything. A failure after the first write refuses NOTES_PARTIAL with what was
 * written; the folder is left as it is.
 */
export async function applyStarter(dir: string, revision: string, templateFiles: readonly TemplateFile[], options: NotesOptions = {}): Promise<StarterResult> {
  const binary = git(options);
  const { plan, files } = buildPlan(dir, templateFiles);
  if (plan.revision !== revision) refuse('NOTES_STALE');
  const target = plan.dir, written: string[] = [];
  try {
    fileStep(() => {
      if (plan.createsFolder) { const t = targetFolder(target); makeDir(t.parent.abs, t.name); written.push('.'); }
      for (const rel of plan.folders) { makeDir(target, rel); written.push(rel); }
      for (const f of files) {
        writeAbs(join(target, f.path), f.bytes, 0o644, { exclusive: true, label: f.path, recheck: () => { checkAncestors(target, f.path, true); } });
        written.push(f.path);
      }
    });
  } catch (e) {
    if (written.length === 0) throw e;
    throw new NotesRefusal('NOTES_PARTIAL', written, e instanceof NotesRefusal ? e.code : undefined);
  }
  const done = await firstCommit(binary, target, files.map(f => f.path), COMMIT_MESSAGES.starter, options, written);
  return { dir: target, files: files.map(f => f.path), ...done };
}
