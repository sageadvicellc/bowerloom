/**
 * The full path of a folder the engine service gave out under an id, for the run record. The engine service tells the window a folder's name and its label (the path written with `~` for the home folder, and any hidden
 * character written out), never a full path, and its list of folders is its only public way to know them. So the full path is worked out here from the label, and it is trusted only after it is checked:
 * it must be an absolute path with no NUL and no written-out hidden character, and it must be a real folder now (not a link). A folder that fails any check gives null, and the run is not recorded for it.
 * The path is used by main alone: to find the session log, and as the key that groups the runs of one project.
 */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { FolderRef } from './runs-ipc.js';

/** The part of a folder's information this reads. */
export interface FolderLabel { readonly label: string; readonly name: string }

/** A hidden character is written out as `[U+XXXX]` in a label (main/engine-service.ts, `visible`). A path with one is not a path main can open from the label. */
const WRITTEN_OUT = /\[U\+[0-9A-Fa-f]{4,6}\]/;

export function folderRefOf(info: FolderLabel, home: string): FolderRef | null {
  const { label } = info;
  if (typeof label !== 'string' || label === '' || label.length > 2200 || label.includes('\u0000') || WRITTEN_OUT.test(label)) return null;
  let dir: string;
  if (label === '~') dir = home;
  else if (label.startsWith('~/')) dir = join(home, label.slice(2));
  else if (label.startsWith('/')) dir = label;
  else return null;
  if (!dir.startsWith('/') || dir.length > 2048) return null;
  try { const s = lstatSync(dir); if (s.isSymbolicLink() || !s.isDirectory()) return null; } catch { return null; }
  return { dir, name: info.name, label };
}
