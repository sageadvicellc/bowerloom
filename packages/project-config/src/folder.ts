/**
 * Creates `.bowerloom` in a config-only project (spec 06, 3.4, decisions 12 and 16). `apply`, `skills sync`, the create
 * commands and `team adopt` call it under the project lock, as their first write into `.bowerloom`. `use` and `unuse`
 * never do. The folder is mode 0755; everything the engine writes inside it stays git-ignored through
 * `.bowerloom/managed/.gitignore`.
 *
 * `mkdir` with mode 0755, then `chmod` 0755. The new folder is opened with O_DIRECTORY and O_NOFOLLOW and its handle
 * checked: a real folder of this user with mode 0755. The project folder is flushed. A folder that is already there by
 * then refuses STALE_APPROVAL. The caller uses the returned context, with the folder adopted, for the rest of the run.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { adoptCreatedMarker, isHeldProjectLock, projectRefusal } from '../../project-context/src/index.js';
import type { HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';

/** Test hook: called with the context `adoptCreatedMarker` returned. Product code passes nothing. */
export interface FolderHooks { readonly adopted?: (project: ProjectContext) => void }
export function createBowerloomFolder(project: ProjectContext, held: HeldProjectLock, hooks: FolderHooks = {}): ProjectContext {
  if (!isHeldProjectLock(held)) throw manifestRefusal('PROJECT_LOCKED');
  held.assertHeld(project.dir);
  if (project.bowerloomIdentity !== null) throw manifestRefusal('STALE_APPROVAL');
  const path = join(project.dir, '.bowerloom');
  try { fs.lstatSync(path); throw manifestRefusal('STALE_APPROVAL'); } catch (error) { if ((error as { code?: unknown }).code !== 'ENOENT') throw error; }
  try { fs.mkdirSync(path, { mode: 0o755 }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw manifestRefusal('STALE_APPROVAL'); throw projectRefusal('PROJECT_UNSAFE'); }
  let expected: { device: string; inode: string; birthtimeNs: string };
  try {
    fs.chmodSync(path, 0o755);
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const s = fs.fstatSync(fd, { bigint: true });
      if (!s.isDirectory() || Number(s.uid) !== process.getuid?.() || (Number(s.mode) & 0o777) !== 0o755) throw projectRefusal('PROJECT_UNSAFE');
      expected = { device: s.dev.toString(), inode: s.ino.toString(), birthtimeNs: s.birthtimeNs.toString() };
    } finally { fs.closeSync(fd); }
    const dir = fs.openSync(project.dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } catch (error) { if ((error as { code?: unknown }).code === 'PROJECT_UNSAFE') throw error; throw projectRefusal('PROJECT_UNSAFE'); }
  held.assertHeld(project.dir);
  const adopted = adoptCreatedMarker(project, 'folder', expected);
  hooks.adopted?.(adopted);
  return adopted;
}
