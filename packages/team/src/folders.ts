/**
 * Member folder confinement (rulings T1, V1, and V10). A member folder is inside the project, or exactly one level
 * beside it. On disk:
 * - each component from the real project folder (or its real parent, for `../<name>`) down must be a real folder,
 *   not a link;
 * - the folder is not the home folder and does not hold it;
 * - it is not in a user folder that holds engine config or keys, such as `~/.claude`, `~/.codex`, `~/.config`,
 *   `~/.ssh`, or `~/Library`, nor in the folders that `XDG_CONFIG_HOME`, `CODEX_HOME`, or `CLAUDE_CONFIG_DIR` name;
 * - it is not the project's `.git`, `.claude`, `.codex`, or `.bowerloom`, nor a folder in one.
 * Paths are compared by their native real path, in Unicode NFC, with letter case folded: one file system may fold case,
 * so `~/.CLAUDE` is `~/.claude`. A missing folder, a folder that cannot be read, and a link are different problems.
 */
import fs from 'node:fs';
import os from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { normalizeFolder } from './scan.js';

/** Folders under the home folder where engines keep user configuration, or where keys live. A member never works in one. */
export const ENGINE_CONFIG_DIRS = Object.freeze([
  '.claude', '.codex', '.config', '.pi', '.dsh', '.opencode', '.agents', '.bowerloom', '.deepseek', '.local/share',
  '.ssh', '.aws', '.gnupg', 'Library', '.gemini', '.cursor',
]);
/** Environment variables that name a user config folder. Their values are read, and never shown. */
export const CONFIG_ENV_NAMES = Object.freeze(['XDG_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']);
/** Project folders that hold engine or Bowerloom config, or the repository. A member folder is never one of them. */
export const RESERVED_PROJECT_DIRS = Object.freeze(['.git', '.claude', '.codex', '.bowerloom']);

export type FolderCheck =
  | { readonly ok: true; readonly abs: string; readonly exists: boolean }
  | { readonly ok: false; readonly code: FolderCode; readonly message: string };
export type FolderCode =
  | 'TEAM_FOLDER_INVALID' | 'TEAM_FOLDER_OUTSIDE' | 'TEAM_FOLDER_RESERVED' | 'TEAM_FOLDER_LINK' | 'TEAM_FOLDER_NOT_A_FOLDER'
  | 'TEAM_FOLDER_UNREADABLE' | 'TEAM_START_FOLDER' | 'TEAM_PROJECT_FOLDER';
export interface FolderOptions {
  /** True refuses a folder that is not there yet. Adoption passes false, because a worktree can come later. */
  readonly mustExist: boolean;
  /** The home folder. Default: the user's home folder. */
  readonly home?: string;
  /** The environment to read the config folder names from. Default: this process's environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
/** The native real path of the deepest part of `abs` that exists, with the rest joined on. */
function real(abs: string): string {
  const rest: string[] = [];
  let at = resolve(abs);
  for (;;) {
    try { return join(fs.realpathSync.native(at), ...rest); } catch {
      const up = dirname(at);
      if (up === at) return join(at, ...rest);
      rest.unshift(at.slice(up.length).replace(/^[/\\]/, ''));
      at = up;
    }
  }
}
const fold = (p: string) => p.normalize('NFC').toLowerCase();
/** True when `child` is `parent` or inside it, by folded path. */
function within(child: string, parent: string): boolean {
  const c = fold(child), p = fold(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** Checks one member folder against the project. */
export function confineFolder(projectDir: string, folder: string, options: FolderOptions): FolderCheck {
  const normal = normalizeFolder(folder);
  if (normal === null) return { ok: false, code: 'TEAM_FOLDER_INVALID', message: 'is not inside the project or exactly one level beside it' };
  let project: string;
  try { project = fs.realpathSync.native(projectDir); } catch (e) {
    return errno(e) === 'ENOENT'
      ? { ok: false, code: 'TEAM_PROJECT_FOLDER', message: 'has no project folder: the project folder does not exist' }
      : { ok: false, code: 'TEAM_FOLDER_UNREADABLE', message: 'cannot be checked: the project folder cannot be read' };
  }
  const segments = normal === '.' ? [] : normal.split('/');
  const beside = segments[0] === '..';
  let at = beside ? dirname(project) : project;
  const names = beside ? segments.slice(1) : segments;
  let exists = true;
  for (const name of names) {
    at = join(at, name);
    if (!exists) continue;
    let st: fs.Stats;
    try { st = fs.lstatSync(at); } catch (e) {
      if (errno(e) === 'ENOENT') {
        if (options.mustExist) return { ok: false, code: 'TEAM_START_FOLDER', message: 'does not exist. Create the worktree first' };
        exists = false; continue;
      }
      return { ok: false, code: 'TEAM_FOLDER_UNREADABLE', message: `cannot be read (${errno(e) ?? 'unknown error'})` };
    }
    if (st.isSymbolicLink()) return { ok: false, code: 'TEAM_FOLDER_LINK', message: 'passes through a link. Each folder on the way must be a real folder' };
    if (!st.isDirectory()) return { ok: false, code: 'TEAM_FOLDER_NOT_A_FOLDER', message: 'is a file, not a folder' };
  }
  // No component is a link, so the native real path differs from `at` only in case or Unicode form.
  const abs = real(at);
  if (fold(abs) !== fold(at)) return { ok: false, code: 'TEAM_FOLDER_LINK', message: 'changed into a link while it was checked' };
  const inside = beside ? fold(dirname(abs)) === fold(dirname(project)) : within(abs, project);
  if (!inside) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: 'is not inside the project or one level beside it' };
  if (!beside) {
    for (const d of RESERVED_PROJECT_DIRS) {
      if (within(abs, join(project, d))) return { ok: false, code: 'TEAM_FOLDER_RESERVED', message: `is the project's ${d} folder, or a folder in it, where the repository or engine config lives` };
    }
  }
  const home = real(options.home ?? os.homedir());
  if (within(home, abs)) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: 'is the home folder, or a folder that holds it' };
  for (const d of ENGINE_CONFIG_DIRS) {
    if (within(abs, real(join(home, d)))) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: `is in ~/${d}, where user configuration or keys live` };
  }
  const env = options.env ?? process.env;
  for (const name of CONFIG_ENV_NAMES) {
    const value = env[name];
    if (typeof value !== 'string' || !isAbsolute(value)) continue;
    if (within(abs, real(value)) || within(real(value), abs)) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: `is in, or holds, the folder that ${name} names, where an engine keeps user configuration` };
  }
  return { ok: true, abs, exists };
}
