/**
 * The store's `.gitignore` (beta.3 docs review, fix 3; owner decision A on PR 100: registered-folder records and grants
 * stay out of git). A store pushed to GitHub, often a public repository, must not publish the files of this machine. The
 * lines Bowerloom keeps there, and why:
 *
 * - `/folders/`: registered-folder records hold folder paths relative to the home folder, and their `.grants/` folders
 *   hold project ids (spec 05, Part B). They name places on this machine only. Each machine runs `folder add` itself.
 * - `.*.tmp`: the temporary files of an interrupted write, which all start with a dot (`.store.json.<hex>.tmp`, a folder
 *   record's `.folder-*.tmp`, a grant's `.grant-*.tmp`, this file's own). An item file such as `LICENSE.tmp` is not
 *   matched (round 2 of the reviews of PR 100, S4).
 * - `/authoring/pending.json`, `/authoring/.stage-*` folders, `/authoring/.tmp-*`: the record and the staged files of a
 *   create that has not finished on this machine.
 * - `.DS_Store`: the folder settings that macOS Finder writes. Bowerloom already ignores them in the store.
 *
 * The store cache and the skills cache live in the private state folder, never in the store, so they need no line.
 *
 * Bowerloom appends the lines it misses, once, after the bytes a person wrote, and never removes, reorders, or re-encodes
 * a byte. A line counts as git reads it: an exact line, not undone by a later `!` line (review S3). The file must be a
 * plain file: a regular file, not a link, owned by the user, with one link and no group or world write, of at most 64 KiB
 * after the append. Anything else refuses STORE_UNSAFE before any write, in words that name the file. The write goes to a
 * temporary file that is renamed into place.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import { refuse, storeWriteFailed } from './refusal.js';

export const STORE_GITIGNORE = '.gitignore';
export const STORE_GITIGNORE_HEADER = '# Bowerloom: files of this machine. Git leaves them out, so a pushed store does not publish them.';
export const STORE_GITIGNORE_LINES: readonly string[] = Object.freeze(['/folders/', '.*.tmp', '/authoring/pending.json', '/authoring/.stage-*/', '/authoring/.tmp-*', '.DS_Store']);
export const STORE_GITIGNORE_LIMIT = 65536;
const TEMP = /^\.gitignore\.[a-f0-9]{16}\.tmp$/;
const NOT_PLAIN = '~/.bowerloom/.gitignore is a link, or not a plain file that you own with one link and no write access for others, so Bowerloom does not read or write it.';
const TOO_LARGE = `~/.bowerloom/.gitignore would be larger than ${STORE_GITIGNORE_LIMIT} bytes, the most Bowerloom writes, so it was not changed.`;

/** What the store's .gitignore needs: nothing (`ok`), new lines (`update`), or the file itself (`create`). `sha256` is null for no file. */
export interface StoreGitignoreState { readonly state: 'ok' | 'update' | 'create'; readonly sha256: string | null }
/** For `store status`: the state, `unsafe` when the file cannot be used, and the lines a person would add. */
export interface StoreGitignoreStatus { readonly state: 'ok' | 'update' | 'create' | 'unsafe'; readonly missing: readonly string[]; readonly endsWithNewline: boolean }

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The bytes of the file, read with the guards of a plain file, with its identity; null when it is not there. */
function readPlain(file: string, uid: number): { bytes: Buffer; stat: BigIntStats } | null {
  let stat: BigIntStats;
  try { stat = lstatSync(file, { bigint: true }); } catch (error) { if (errno(error) === 'ENOENT') return null; throw refuse('STORE_UNREADABLE'); }
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.uid) !== uid || stat.nlink !== 1n || (Number(stat.mode) & 0o022) !== 0) throw refuse('STORE_UNSAFE', NOT_PLAIN);
  if (stat.size > BigInt(STORE_GITIGNORE_LIMIT)) throw refuse('STORE_UNSAFE', TOO_LARGE);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (error) { throw errno(error) === 'ELOOP' ? refuse('STORE_UNSAFE', NOT_PLAIN) : refuse('STORE_UNREADABLE'); }
  try {
    const open = fstatSync(fd, { bigint: true });
    if (!open.isFile() || open.dev !== stat.dev || open.ino !== stat.ino) throw refuse('STORE_UNSAFE', NOT_PLAIN);
    const buffer = Buffer.alloc(STORE_GITIGNORE_LIMIT + 1); let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    if (length > STORE_GITIGNORE_LIMIT) throw refuse('STORE_UNSAFE', TOO_LARGE);
    return { bytes: Buffer.from(buffer.subarray(0, length)), stat };
  } finally { closeSync(fd); }
}
/** The lines of the file as git splits them, each byte kept (latin1 maps each byte to one character). */
const linesOf = (bytes: Buffer): string[] => bytes.toString('latin1').split('\n');
/**
 * Round 3 of the reviews of PR 100, L2: true when a `!` line could take the top folder `folders` back in. It names folders,
 * or it is one path segment (a leading or trailing `/` aside) whose glob matches `folders`, such as `!*\/` or `!**`.
 */
function undoesFolders(later: string): boolean {
  const pattern = later.slice(1);
  if (pattern.includes('folders')) return true;
  const core = pattern.replace(/^\//, '').replace(/\/$/, '');
  if (core === '' || core.includes('/')) return false;
  let source = '';
  for (let i = 0; i < core.length; i++) {
    const c = core[i]!;
    if (c === '*') { source += '.*'; while (core[i + 1] === '*') i++; }
    else if (c === '?') source += '.';
    else if (c === '[') { const end = core.indexOf(']', i + 2); if (end < 0) return true; source += `[${core.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = end; }
    else source += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  try { return new RegExp(`^${source}$`).test('folders'); } catch { return true; }
}
/** True when `line` is in effect: an exact line, with no later `!` line that names it (for `/folders/`, any that could match the folder). */
function inEffect(lines: readonly string[], line: string): boolean {
  const at = lines.lastIndexOf(line);
  if (at < 0) return false;
  return !lines.slice(at + 1).some(later => later.startsWith('!') && (later.slice(1) === line || (line === '/folders/' && undoesFolders(later))));
}
const missingLines = (bytes: Buffer): string[] => { const lines = linesOf(bytes); return STORE_GITIGNORE_LINES.filter(l => !inEffect(lines, l)); };
/** The bytes the file has after the append: the person's bytes as they are, a line break when the last line has none, and ours. */
function appended(before: Buffer, missing: readonly string[]): Buffer {
  const header = linesOf(before).includes(STORE_GITIGNORE_HEADER) ? [] : [STORE_GITIGNORE_HEADER];
  const separator = before.length > 0 && before[before.length - 1] !== 0x0a ? Buffer.from('\n') : Buffer.alloc(0);
  return Buffer.concat([before, separator, Buffer.from([...header, ...missing].join('\n') + '\n')]);
}

/** What the .gitignore of the store folder `storeDir` needs. Reads only. STORE_UNSAFE for a file that is not plain, or too large after the append. */
export function storeGitignoreState(storeDir: string, uid: number = process.getuid?.() ?? -1): StoreGitignoreState {
  const read = readPlain(join(storeDir, STORE_GITIGNORE), uid);
  if (read === null) return { state: 'create', sha256: null };
  const missing = missingLines(read.bytes);
  if (missing.length && appended(read.bytes, missing).length > STORE_GITIGNORE_LIMIT) throw refuse('STORE_UNSAFE', TOO_LARGE);
  return { state: missing.length ? 'update' : 'ok', sha256: sha(read.bytes) };
}
/** For `store status`: as storeGitignoreState, but a file Bowerloom cannot use is `unsafe`, not a refusal. Reads only. */
export function storeGitignoreStatus(storeDir: string, uid: number = process.getuid?.() ?? -1): StoreGitignoreStatus {
  let read: { bytes: Buffer } | null;
  try { read = readPlain(join(storeDir, STORE_GITIGNORE), uid); } catch { return { state: 'unsafe', missing: [], endsWithNewline: true }; }
  if (read === null) return { state: 'create', missing: [STORE_GITIGNORE_HEADER, ...STORE_GITIGNORE_LINES], endsWithNewline: true };
  const missing = missingLines(read.bytes), header = linesOf(read.bytes).includes(STORE_GITIGNORE_HEADER) ? [] : [STORE_GITIGNORE_HEADER];
  return { state: missing.length ? 'update' : 'ok', missing: missing.length ? [...header, ...missing] : [], endsWithNewline: read.bytes.length === 0 || read.bytes[read.bytes.length - 1] === 0x0a };
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
  const data = appended(before, missing);
  // Review S5: refused before any write, so the file is never left larger than Bowerloom reads.
  if (data.length > STORE_GITIGNORE_LIMIT) throw refuse('STORE_UNSAFE', TOO_LARGE);
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
    if (read === null ? now !== null : now === null || now.isSymbolicLink() || now.ino !== read.stat.ino || now.dev !== read.stat.dev || now.size !== read.stat.size || now.mtimeNs !== read.stat.mtimeNs) throw now?.isSymbolicLink() ? refuse('STORE_UNSAFE', NOT_PLAIN) : refuse('STALE_APPROVAL');
    renameSync(temp, file); made = false;
    syncFolder(storeDir);
  } finally { if (made) { try { unlinkSync(temp); } catch { /* Already gone. */ } } }
}

/**
 * Round 2 of the reviews of PR 100, M3: a store write that could not add the .gitignore lines does not fail the command
 * that made the write. It records the code here, and the command's result names it once (apps/cli/src/confirm.ts).
 */
let failure: { code: string } | null = null;
export function recordStoreGitignoreFailure(error: unknown): void {
  const code = error instanceof DefinitionError ? error.code : storeWriteFailed(error).code;
  failure = { code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'STORE_WRITE_FAILED' };
}
/** The code of the last .gitignore write that failed, once; then null. */
export function takeStoreGitignoreFailure(): { code: string } | null { const out = failure; failure = null; return out; }
/** Adds the missing lines, and records a failure instead of throwing it. For every store write but folder add and allow. */
export function tryEnsureStoreGitignore(storeDir: string, uid?: number): void {
  try { ensureStoreGitignore(storeDir, undefined, uid); } catch (error) { recordStoreGitignoreFailure(error); }
}
