/**
 * The bytes of an authored store item as a lock records them (spec 06, section 6, `localItemRows`). Reads only, with the
 * authoring guards: the item is walked with `folderNames`, and each file is read once with `readGuarded`. The file rules
 * are those of the store sources and the fetch (`storeFileFault`). Every refusal happens before any network read.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, folderNames, readGuarded, realFolder } from '../../project-authoring/src/files.js';
import { STORE_FILE_LIMITS, storeFileName, storeFileProblem } from '../../skill-manifest/src/content.js';
import { authoredPath, authoredRows } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredKind, AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { notShareable } from '../../project-config/src/refusal.js';
import type { ShareProblem } from '../../project-config/src/refusal.js';

export interface ItemRows { rows: AuthoredPin['files']; hash: string; files: { path: string; bytes: Buffer }[] }
// Rounds 1 and 2 of the reviews of PR 101: each refusal names the file or folder and what is wrong with it, so its Next:
// line says the fix. `path` and `item` are store paths; the refusal names a path only when it is plain.
const file = (problem: ShareProblem, path?: string, item?: string): never => { throw notShareable('file', { problem, ...(path !== undefined ? { path } : {}), ...(item !== undefined ? { item } : {}) }); };
const size = (problem: ShareProblem, path: string | undefined, item: string): never => { throw notShareable('size', { problem, ...(path !== undefined ? { path } : {}), item }); };
const ours = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 'STORE_ITEM_NOT_SHAREABLE';

/**
 * The rows and hash of the item `<kind> <id>` in the folder `storeDir` (the live store or a store cache folder). Paths
 * are relative to the item folder; a prompt's one path is `<id>.md`. A path, a link, an owner, a mode or a text a lock
 * cannot record refuses STORE_ITEM_NOT_SHAREABLE with `The item holds a file that a lock cannot record.`; a size over a
 * limit with `The item is larger than a lock can record.`
 */
export function localItemRows(storeDir: string, kind: AuthoredKind, id: string): ItemRows {
  const files: { path: string; bytes: Buffer }[] = [];
  let total = 0;
  const item = authoredPath(kind, id), at = (rel: string): string => kind === 'prompt' ? item : `${item}/${rel}`;
  const take = (abs: string, rel: string): void => {
    let mode: number, bytes: Buffer, length: number;
    try { const s = lstatSync(abs); if (s.isSymbolicLink()) file('link', at(rel), item); if (!s.isFile()) file('special', at(rel), item); mode = s.mode; length = s.size; }
    catch (error) { if (ours(error)) throw error; return file('unreadable', at(rel), item); }
    // A name a lock cannot record, or a file over the size limit, is named before the guarded read, which refuses both.
    if (!storeFileName(rel)) file('name', at(rel), item);
    if (length > STORE_FILE_LIMITS.fileBytes) size('large', at(rel), item);
    try { bytes = readGuarded(abs, LIMITS.fileBytes); } catch { return file('unsafe-file', at(rel), item); }
    const problem = storeFileProblem(rel, bytes, mode);
    if (problem === 'large') size('large', at(rel), item); else if (problem !== null) file(problem, at(rel), item);
    if (files.length >= STORE_FILE_LIMITS.files) size('count', undefined, item);
    if ((total += bytes.length) > STORE_FILE_LIMITS.totalBytes) size('total', undefined, item);
    files.push({ path: rel, bytes });
  };
  const root = join(storeDir, item);
  // Review S1 of PR 98: the area folder (`skills`, `prompts`, or `teams`) is read without following a link, and the item
  // must really be inside the folder that was given, so a link never brings in files from elsewhere.
  const areaName = kind === 'prompt' ? 'prompts' : `${kind}s`, area = join(storeDir, areaName);
  try { realFolder(area); if (realpathSync(area) !== join(realpathSync(storeDir), areaName)) file('area', areaName, item); }
  catch (error) { if (ours(error)) throw error; file('area', areaName, item); }
  if (kind === 'prompt') {
    take(root, `${id}.md`);
  } else {
    const walk = (abs: string, rel: string, depth: number): void => {
      const here = rel ? `${item}/${rel}` : item;
      if (depth > LIMITS.depth) file('too-deep', here, item);
      let names: string[]; try { names = folderNames(abs); } catch { return file('unsafe-folder', here, item); }
      if (names.length === 0) file('empty-folder', here, item);
      for (const name of names) {
        const childAbs = join(abs, name), childRel = rel ? `${rel}/${name}` : name;
        let isFolder: boolean;
        try { const s = lstatSync(childAbs); if (s.isSymbolicLink()) file('link', `${item}/${childRel}`, item); isFolder = s.isDirectory(); }
        catch (error) { if (ours(error)) throw error; return file('unreadable', `${item}/${childRel}`, item); }
        if (isFolder) walk(childAbs, childRel, depth + 1); else take(childAbs, childRel);
      }
    };
    try { realFolder(root); } catch { file('not-folder', item, item); }
    walk(root, '', 1);
  }
  if (files.length === 0) file('empty-folder', item, item);
  const { rows, hash } = authoredRows(files);
  return { rows, hash, files };
}
