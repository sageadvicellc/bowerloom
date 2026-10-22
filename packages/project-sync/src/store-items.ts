/**
 * The bytes of an authored store item as a lock records them (spec 06, section 6, `localItemRows`). Reads only, with the
 * authoring guards: the item is walked with `folderNames`, and each file is read once with `readGuarded`. The file rules
 * are those of the store sources and the fetch (`storeFileFault`). Every refusal happens before any network read.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, folderNames, readGuarded, realFolder } from '../../project-authoring/src/files.js';
import { STORE_FILE_LIMITS, storeFileFault } from '../../skill-manifest/src/content.js';
import { authoredPath, authoredRows } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredKind, AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { notShareable } from '../../project-config/src/refusal.js';

export interface ItemRows { rows: AuthoredPin['files']; hash: string; files: { path: string; bytes: Buffer }[] }
const file = (): never => { throw notShareable('file'); };
const size = (): never => { throw notShareable('size'); };

/**
 * The rows and hash of the item `<kind> <id>` in the folder `storeDir` (the live store or a store cache folder). Paths
 * are relative to the item folder; a prompt's one path is `<id>.md`. A path, a link, an owner, a mode or a text a lock
 * cannot record refuses STORE_ITEM_NOT_SHAREABLE with `The item holds a file that a lock cannot record.`; a size over a
 * limit with `The item is larger than a lock can record.`
 */
export function localItemRows(storeDir: string, kind: AuthoredKind, id: string): ItemRows {
  const files: { path: string; bytes: Buffer }[] = [];
  let total = 0;
  const take = (abs: string, rel: string): void => {
    let mode: number;
    try { const s = lstatSync(abs); if (s.isSymbolicLink() || !s.isFile()) file(); mode = s.mode; } catch (error) { if ((error as { code?: unknown }).code === 'STORE_ITEM_NOT_SHAREABLE') throw error; return file(); }
    let bytes: Buffer;
    try { bytes = readGuarded(abs, LIMITS.fileBytes); } catch { return file(); }
    const fault = storeFileFault(rel, bytes, mode);
    if (fault === 'large') size(); else if (fault !== null) file();
    if (files.length >= STORE_FILE_LIMITS.files || (total += bytes.length) > STORE_FILE_LIMITS.totalBytes) size();
    files.push({ path: rel, bytes });
  };
  const root = join(storeDir, authoredPath(kind, id));
  // Review S1 of PR 98: the area folder (`skills`, `prompts`, or `teams`) is read without following a link, and the item
  // must really be inside the folder that was given, so a link never brings in files from elsewhere.
  const area = join(storeDir, kind === 'prompt' ? 'prompts' : `${kind}s`);
  try { realFolder(area); if (realpathSync(area) !== join(realpathSync(storeDir), kind === 'prompt' ? 'prompts' : `${kind}s`)) file(); }
  catch (error) { if ((error as { code?: unknown }).code === 'STORE_ITEM_NOT_SHAREABLE') throw error; file(); }
  if (kind === 'prompt') {
    take(root, `${id}.md`);
  } else {
    const walk = (abs: string, rel: string, depth: number): void => {
      if (depth > LIMITS.depth) file();
      let names: string[]; try { names = folderNames(abs); } catch { return file(); }
      if (names.length === 0) file();
      for (const name of names) {
        const childAbs = join(abs, name), childRel = rel ? `${rel}/${name}` : name;
        let isFolder: boolean; try { const s = lstatSync(childAbs); if (s.isSymbolicLink()) file(); isFolder = s.isDirectory(); } catch (error) { if ((error as { code?: unknown }).code === 'STORE_ITEM_NOT_SHAREABLE') throw error; return file(); }
        if (isFolder) walk(childAbs, childRel, depth + 1); else take(childAbs, childRel);
      }
    };
    try { realFolder(root); } catch { file(); }
    walk(root, '', 1);
  }
  if (files.length === 0) file();
  const { rows, hash } = authoredRows(files);
  return { rows, hash, files };
}
