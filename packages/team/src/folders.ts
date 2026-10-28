/**
 * Member folder confinement (review ruling T1). A member folder is inside the project, or exactly one level beside it.
 * On disk:
 * - each component from the real project folder (or its real parent, for `../<name>`) down must be a real folder,
 *   not a link;
 * - the folder is not the home folder, does not hold it, and is not in a user engine config folder such as `~/.claude`,
 *   `~/.codex`, `~/.config`, `~/.pi`, or `~/.dsh`.
 * A missing folder, a folder that cannot be read, and a link are different problems (ruling T14).
 */
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, sep } from 'node:path';
import { normalizeFolder } from './scan.js';

/** Folders under the home folder where engines keep user-level configuration. A member never works in one. */
export const ENGINE_CONFIG_DIRS = Object.freeze([
  '.claude', '.codex', '.config', '.pi', '.dsh', '.opencode', '.agents', '.bowerloom', '.deepseek', '.local/share',
]);

export type FolderCheck =
  | { readonly ok: true; readonly abs: string; readonly exists: boolean }
  | { readonly ok: false; readonly code: FolderCode; readonly message: string };
export type FolderCode =
  | 'TEAM_FOLDER_INVALID' | 'TEAM_FOLDER_OUTSIDE' | 'TEAM_FOLDER_LINK' | 'TEAM_FOLDER_NOT_A_FOLDER' | 'TEAM_FOLDER_UNREADABLE'
  | 'TEAM_START_FOLDER' | 'TEAM_PROJECT_FOLDER';

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
function real(abs: string): string {
  try { return fs.realpathSync(abs); } catch { return abs; }
}
const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/**
 * Checks one member folder against the project. `mustExist` refuses a folder that is not there yet; adoption passes
 * false, because a worktree can come later. `home` is the home folder; tests pass their own.
 */
export function confineFolder(projectDir: string, folder: string, options: { mustExist: boolean; home?: string }): FolderCheck {
  const normal = normalizeFolder(folder);
  if (normal === null) return { ok: false, code: 'TEAM_FOLDER_INVALID', message: 'is not inside the project or exactly one level beside it' };
  let project: string;
  try { project = fs.realpathSync(projectDir); } catch (e) {
    return errno(e) === 'ENOENT'
      ? { ok: false, code: 'TEAM_PROJECT_FOLDER', message: 'has no project folder: the project folder does not exist' }
      : { ok: false, code: 'TEAM_FOLDER_UNREADABLE', message: 'cannot be checked: the project folder cannot be read' };
  }
  const segments = normal === '.' ? [] : normal.split('/');
  let at = segments[0] === '..' ? dirname(project) : project;
  const names = segments[0] === '..' ? segments.slice(1) : segments;
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
  if (exists && real(at) !== at) return { ok: false, code: 'TEAM_FOLDER_LINK', message: 'changed into a link while it was checked' };
  const inside = segments[0] === '..' ? dirname(at) === dirname(project) : within(at, project);
  if (!inside) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: 'is not inside the project or one level beside it' };
  const home = real(options.home ?? os.homedir());
  if (within(home, at)) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: 'is the home folder, or a folder that holds it' };
  for (const d of ENGINE_CONFIG_DIRS) {
    if (within(at, real(join(home, d)))) return { ok: false, code: 'TEAM_FOLDER_OUTSIDE', message: `is in ~/${d}, where an engine keeps user configuration` };
  }
  return { ok: true, abs: at, exists };
}
