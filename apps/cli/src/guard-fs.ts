/** The file system the read guard looks at: lstat, stat, realpath, and listing, with device and inode as strings. */
import fs from 'node:fs';
import type { FsEntry, GuardFs } from '../../../packages/context-slices/src/guard.js';

function entry(s: fs.BigIntStats): FsEntry {
  return { dev: String(s.dev), ino: String(s.ino), type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : s.isSymbolicLink() ? 'link' : 'other', nlink: Number(s.nlink) };
}
const missing = (error: unknown): boolean => { const code = (error as NodeJS.ErrnoException | null)?.code; return code === 'ENOENT' || code === 'ENOTDIR'; };
/** null for a path that is not there (ENOENT, ENOTDIR). Any other error is not a miss: EACCES, ELOOP, ENAMETOOLONG and the rest throw. */
const orNull = <T>(work: () => T): T | null => { try { return work(); } catch (error) { if (missing(error)) return null; throw error; } };

export function nodeGuardFs(): GuardFs {
  return {
    lstat: p => orNull(() => entry(fs.lstatSync(p, { bigint: true }))),
    stat: p => orNull(() => entry(fs.statSync(p, { bigint: true }))),
    realpath: p => orNull(() => fs.realpathSync.native(p)),
    list: p => {
      const dir = orNull(() => fs.opendirSync(p)); if (dir === null) return null;
      return (function* () {
        try {
          for (let item = dir.readSync(); item !== null; item = dir.readSync()) {
            let e: FsEntry; try { e = entry(fs.lstatSync(`${p}/${item.name}`, { bigint: true })); } catch (error) { if (!missing(error)) throw error; e = { dev: '', ino: '', type: 'other', nlink: 0 }; }
            yield { name: item.name, entry: e };
          }
        } finally { dir.closeSync(); }
      })();
    },
  };
}
