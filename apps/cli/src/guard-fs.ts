/** The file system the read guard looks at: lstat, stat, realpath, and listing, with device and inode as strings. */
import fs from 'node:fs';
import type { FsEntry, GuardFs } from '../../../packages/context-slices/src/guard.js';

function entry(s: fs.BigIntStats): FsEntry {
  return { dev: String(s.dev), ino: String(s.ino), type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : s.isSymbolicLink() ? 'link' : 'other', nlink: Number(s.nlink) };
}
const orNull = <T>(work: () => T): T | null => { try { return work(); } catch { return null; } };

export function nodeGuardFs(): GuardFs {
  return {
    lstat: p => orNull(() => entry(fs.lstatSync(p, { bigint: true }))),
    stat: p => orNull(() => entry(fs.statSync(p, { bigint: true }))),
    realpath: p => orNull(() => fs.realpathSync.native(p)),
    list: p => orNull(() => fs.readdirSync(p).map(name => ({ name, entry: entry(fs.lstatSync(`${p}/${name}`, { bigint: true })) }))),
  };
}
