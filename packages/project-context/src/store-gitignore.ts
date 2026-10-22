/**
 * The store's `.gitignore` (beta.3 docs review, fix 3). A store pushed to GitHub, often a public repository, must not
 * publish the files of this machine. The lines Bowerloom keeps there, and why:
 *
 * - `/folders/`: registered-folder records hold folder paths relative to the home folder, and their `.grants/` folders
 *   hold project ids (spec 05, Part B). They name places on this machine only.
 * - `*.tmp`: the temporary files of an interrupted write (`.store.json.<hex>.tmp`, a folder record's `.folder-*.tmp`, a
 *   grant's `.grant-*.tmp`, this file's own). No item file can match: an item file ends in md, txt, json, yaml, yml, or csv.
 * - `/authoring/pending.json`, `/authoring/.stage-*\/`, `/authoring/.tmp-*`: the record and the staged files of a create
 *   that has not finished on this machine.
 * - `.DS_Store`: the folder settings that macOS Finder writes. Bowerloom already ignores them in the store.
 *
 * The store cache and the skills cache live in the private state folder, never in the store, so they need no line.
 *
 * Bowerloom appends the lines it misses, once, after the lines a person wrote, and never removes or reorders a line.
 * The file must be a plain file: a regular file, not a link, owned by the user, with one link and no group or world write.
 * Anything else refuses STORE_UNSAFE before any write. The write goes to a temporary file that is renamed into place.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import { refuse, storeWriteFailed } from './refusal.js';

export const STORE_GITIGNORE = '.gitignore';
export const STORE_GITIGNORE_HEADER = '# Bowerloom: files of this machine. Git leaves them out, so a pushed store does not publish them.';
export const STORE_GITIGNORE_LINES: readonly string[] = Object.freeze(['/folders/', '*.tmp', '/authoring/pending.json', '/authoring/.stage-*/', '/authoring/.tmp-*', '.DS_Store']);
const LIMIT = 65536;
const TEMP = /^\.gitignore\.[a-f0-9]{16}\.tmp$/;
const DETAIL = 'The store .gitignore must be a plain file that you own, with one link and no write access for others.';

/** What the store's .gitignore needs: nothing (`ok`), new lines (`update`), or the file itself (`create`). `sha256` is null for no file. */
export interface StoreGitignoreState { readonly state: 'ok' | 'update' | 'create'; readonly sha256: string | null }

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const unsafe = (): Error => refuse('STORE_UNSAFE', DETAIL);
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The bytes of the file, read with the guards of a plain file, with its identity; null when it is not there. */
function readPlain(file: string, uid: number): { bytes: Buffer; stat: BigIntStats } | null {
  let stat: BigIntStats;
  try { stat = lstatSync(file, { bigint: true }); } catch (error) { if (errno(error) === 'ENOENT') return null; throw refuse('STORE_UNREADABLE'); }
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.uid) !== uid || stat.nlink !== 1n || (Number(stat.mode) & 0o022) !== 0 || stat.size > BigInt(LIMIT)) throw unsafe();
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (error) { throw errno(error) === 'ELOOP' ? unsafe() : refuse('STORE_UNREADABLE'); }
  try {
    const open = fstatSync(fd, { bigint: true });
    if (!open.isFile() || open.dev !== stat.dev || open.ino !== stat.ino) throw unsafe();
    const buffer = Buffer.alloc(LIMIT + 1); let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    if (length > LIMIT) throw unsafe();
    return { bytes: Buffer.from(buffer.subarray(0, length)), stat };
  } finally { closeSync(fd); }
}
const linesOf = (bytes: Buffer): Set<string> => new Set(bytes.toString('utf8').split(/\r?\n/).map(l => l.trim()));
const missingLines = (bytes: Buffer): string[] => { const have = linesOf(bytes); return STORE_GITIGNORE_LINES.filter(l => !have.has(l)); };

/** What the .gitignore of the store folder `storeDir` needs. Reads only. STORE_UNSAFE for a file that is not plain. */
export function storeGitignoreState(storeDir: string, uid: number = process.getuid?.() ?? -1): StoreGitignoreState {
  const read = readPlain(join(storeDir, STORE_GITIGNORE), uid);
  if (read === null) return { state: 'create', sha256: null };
  return { state: missingLines(read.bytes).length ? 'update' : 'ok', sha256: sha(read.bytes) };
}

/** Removes leftover `.gitignore.<16 hex>.tmp` files of an interrupted write: regular files the user owns. */
function removeLeftovers(storeDir: string, uid: number): void {
  for (const name of readdirSync(storeDir)) {
    if (!TEMP.test(name)) continue;
    try { const s = lstatSync(join(storeDir, name)); if (s.isFile() && !s.isSymbolicLink() && s.uid === uid) unlinkSync(join(storeDir, name)); } catch (error) { if (errno(error) !== 'ENOENT') throw error; }
  }
}
function syncFolder(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }

/**
 * Appends the lines the store's .gitignore misses. The caller holds the store lock. When `expected` is given, the file
 * must still be what the plan read (its sha256, or no file), else STALE_APPROVAL. Returns true when it wrote the file.
 */
export function ensureStoreGitignore(storeDir: string, expected?: StoreGitignoreState, uid: number = process.getuid?.() ?? -1): boolean {
  const file = join(storeDir, STORE_GITIGNORE), read = readPlain(file, uid);
  if (expected !== undefined && (read === null ? null : sha(read.bytes)) !== expected.sha256) throw refuse('STALE_APPROVAL');
  const before = read?.bytes ?? Buffer.alloc(0), missing = missingLines(before);
  if (read !== null && missing.length === 0) return false;
  const text = before.toString('utf8'), have = linesOf(before);
  const added = [...(have.has(STORE_GITIGNORE_HEADER) ? [] : [STORE_GITIGNORE_HEADER]), ...missing].join('\n') + '\n';
  const data = Buffer.from(`${text}${text.length && !text.endsWith('\n') ? '\n' : ''}${added}`);
  try { write(storeDir, file, read, data, uid); } catch (error) { throw error instanceof DefinitionError ? error : storeWriteFailed(error); }
  return true;
}
function write(storeDir: string, file: string, read: { stat: BigIntStats } | null, data: Buffer, uid: number): void {
  removeLeftovers(storeDir, uid);
  const temp = join(storeDir, `.gitignore.${randomBytes(8).toString('hex')}.tmp`);
  let made = false;
  try {
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); made = true;
    try { fchmodSync(fd, 0o644); let at = 0; while (at < data.length) at += writeSync(fd, data, at); fsyncSync(fd); } finally { closeSync(fd); }
    // The file must still be the one read: the same inode and bytes, or still no file. A link that appeared refuses.
    let now: BigIntStats | null;
    try { now = lstatSync(file, { bigint: true }); } catch (error) { if (errno(error) !== 'ENOENT') throw error; now = null; }
    if (read === null ? now !== null : now === null || now.isSymbolicLink() || now.ino !== read.stat.ino || now.dev !== read.stat.dev || now.size !== read.stat.size || now.mtimeNs !== read.stat.mtimeNs) throw now?.isSymbolicLink() ? unsafe() : refuse('STALE_APPROVAL');
    renameSync(temp, file); made = false;
    syncFolder(storeDir);
  } finally { if (made) { try { unlinkSync(temp); } catch { /* Already gone. */ } } }
}
