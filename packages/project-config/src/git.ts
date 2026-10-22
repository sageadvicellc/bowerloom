/**
 * The git-backed store (spec 06, 3.10). Bowerloom never runs git: it reads a few files in `~/.bowerloom/.git`, each as a
 * plain file (a regular file, not a link, owned by the user, with no group or world write), opened with O_NOFOLLOW and
 * O_NONBLOCK and read up to its limit. Any file that fails its rules makes the repository `unreadable`.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { GITHUB_NAME_ANY_CASE, GITHUB_OWNER_ANY_CASE } from '../../skill-manifest/src/github-repository.js';

export type StoreRepoProblem = 'none' | 'no-origin' | 'unsupported-remote' | 'unreadable' | 'unpushed';
export interface StoreRepo {
  problem: StoreRepoProblem | null;
  /** The normal form `https://github.com/<o>/<r>`, lower case. */
  remote: string | null;
  branch: string | null;
  /** The commit of `refs/heads/<branch>`. Null when it is missing. */
  head: string | null;
  /** The commit a lock records: `--commit`, or the commit of `refs/remotes/origin/<branch>`. */
  pushed: string | null;
}
/** Test hook: the owner every file must have. Product code passes nothing. */
export interface StoreRepoHooks { readonly uid?: number }

// Review F4 of PR 97: the owner and name patterns are the shared ones, so every remote this accepts passes the store fetch.
const OWNER = GITHUB_OWNER_ANY_CASE, REPO = GITHUB_NAME_ANY_CASE, HEX40 = /^[a-f0-9]{40}$/;
const FORMS = [
  /^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git|\/)?$/,
  /^git@([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?$/,
  /^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
] as const;
/**
 * The normal form of a github.com remote, `https://github.com/<o>/<r>` in lower case, or null. Accepted forms:
 * `https://github.com/<o>/<r>` with an optional `.git` or `/`, `git@github.com:<o>/<r>` with an optional `.git`, and
 * `ssh://git@github.com/<o>/<r>` with an optional `.git`. The host is compared in lower case; credentials, a port, a
 * query, a fragment, or any other host gives null. GitHub ignores case in owners and names, so both are lower-cased.
 */
export function normalizeRemote(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 512) return null;
  for (const form of FORMS) {
    const m = form.exec(url);
    if (m === null) continue;
    const [, host, owner, repo] = m;
    // A name that still ends in .git after the one suffix is stripped (such as `r.git/`) is not one of the seven forms.
    if (host!.toLowerCase() !== 'github.com' || !OWNER.test(owner!) || !REPO.test(repo!) || repo === '.' || repo === '..' || /\.git$/i.test(repo!)) return null;
    return `https://github.com/${owner!.toLowerCase()}/${repo!.toLowerCase()}`;
  }
  return null;
}

class Unreadable extends Error {}
const unreadable = (): never => { throw new Unreadable(); };
/** One plain file, at most `max` bytes, or null when it is not there. Anything else that is wrong is `unreadable`. */
function plainFile(path: string, max: number, uid: number): Buffer | null {
  let stat: BigIntStats;
  try { stat = lstatSync(path, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return unreadable(); }
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0 || stat.size > BigInt(max)) unreadable();
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return unreadable(); }
  try {
    const open = fstatSync(fd, { bigint: true });
    if (!open.isFile() || open.dev !== stat.dev || open.ino !== stat.ino) unreadable();
    const buffer = Buffer.alloc(max + 1); let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    if (length > max) unreadable();
    return Buffer.from(buffer.subarray(0, length));
  } catch (error) { if (error instanceof Unreadable) throw error; return unreadable(); } finally { closeSync(fd); }
}
const utf8 = (bytes: Buffer): string => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return unreadable(); } };

/** The sections of a git config: lower-cased section header text, and its `key = value` lines, keys lower-cased. */
function configValues(text: string): { objectFormat: string | null; originUrl: string | null } {
  let section: string | null = null, objectFormat: string | null = null, originUrl: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/.exec(line);
    if (header) { section = header[2] === undefined ? header[1]!.toLowerCase() : `${header[1]!.toLowerCase()} "${header[2]}"`; continue; }
    // Review F9: a key on the header line, such as `[remote "origin"] url = ...`, is refused, not read past.
    if (line.startsWith('[')) unreadable();
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase(); let value = (kv[2] ?? '').trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (section === 'extensions' && key === 'objectformat') objectFormat = value.toLowerCase();
    if (section === 'remote "origin"' && key === 'url' && originUrl === null) originUrl = value;
  }
  return { objectFormat, originUrl };
}
/** A branch name: letters, digits, `.`, `_`, `/`, `-`, at most 200, with no `..` and no slash at either end. */
const isBranch = (name: string): boolean => /^[A-Za-z0-9._/-]{1,200}$/.test(name) && !name.includes('..') && !name.startsWith('/') && !name.endsWith('/') && !name.includes('//');
/** A loose ref: exactly 40 lower-case hex characters and a newline, or null when the file is not there. */
function looseRef(git: string, ref: string, uid: number): string | null {
  const bytes = plainFile(join(git, ref), 41, uid);
  if (bytes === null) return null;
  const text = utf8(bytes);
  if (!/^[a-f0-9]{40}\n$/.test(text)) unreadable();
  return text.slice(0, 40);
}
/** The sha of `ref` in packed-refs, or null. Comment lines and peeled `^` lines are skipped; other line shapes are ignored. */
function packedRef(packed: string | null, ref: string): string | null {
  if (packed === null) return null;
  for (const line of packed.split('\n')) {
    if (line.startsWith('#') || line.startsWith('^')) continue;
    const m = /^([a-f0-9]{40}) (\S+)$/.exec(line);
    if (m && m[2] === ref) return m[1]!;
  }
  return null;
}

/**
 * Reads the store repository at `storeDir` (3.10). `commit` is a `--commit` value, already checked, or null. The result
 * names a problem, or the remote, the branch, HEAD and the pushed commit. It never throws for anything in `.git`.
 */
export function readStoreRepo(storeDir: string, commit: string | null, hooks: StoreRepoHooks = {}): StoreRepo {
  const uid = hooks.uid ?? process.getuid?.() ?? -1, git = join(storeDir, '.git');
  const result = (problem: StoreRepoProblem | null, fields: Partial<Omit<StoreRepo, 'problem'>> = {}): StoreRepo => ({ problem, remote: fields.remote ?? null, branch: fields.branch ?? null, head: fields.head ?? null, pushed: fields.pushed ?? null });
  if (commit !== null && !HEX40.test(commit)) return result('unreadable');
  try {
    let stat: BigIntStats;
    try { stat = lstatSync(git, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result('none'); return result('unreadable'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.uid) !== uid) return result('unreadable');
    try { lstatSync(join(git, 'reftable')); return result('unreadable'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return result('unreadable'); }
    const configBytes = plainFile(join(git, 'config'), 65536, uid);
    if (configBytes === null) return result('unreadable');
    const config = configValues(utf8(configBytes));
    if (config.objectFormat === 'sha256') return result('unreadable');
    if (config.originUrl === null || config.originUrl === '') return result('no-origin');
    const remote = normalizeRemote(config.originUrl);
    if (remote === null) return result('unsupported-remote');
    const headBytes = plainFile(join(git, 'HEAD'), 256, uid);
    if (headBytes === null) return result('unreadable');
    const headText = utf8(headBytes);
    let branch: string | null = null;
    const symbolic = /^ref: refs\/heads\/(.+)\n$/.exec(headText);
    if (symbolic) { if (!isBranch(symbolic[1]!)) return result('unreadable'); branch = symbolic[1]!; }
    else if (!/^[a-f0-9]{40}\n$/.test(headText)) return result('unreadable');
    else if (commit === null) return result('unpushed', { remote });
    let packed: string | null = null;
    const packedBytes = plainFile(join(git, 'packed-refs'), 1048576, uid);
    if (packedBytes !== null) packed = utf8(packedBytes);
    const head = branch === null ? null : looseRef(git, `refs/heads/${branch}`, uid) ?? packedRef(packed, `refs/heads/${branch}`);
    if (commit !== null) return result(null, { remote, branch, head, pushed: commit });
    const pushed = looseRef(git, `refs/remotes/origin/${branch}`, uid) ?? packedRef(packed, `refs/remotes/origin/${branch}`);
    if (pushed === null) return result('unpushed', { remote, branch, head });
    return result(null, { remote, branch, head, pushed });
  } catch (error) { if (error instanceof Unreadable) return result('unreadable'); throw error; }
}

const INDEX_LIMIT = 33554432, INDEX_ENTRIES = 1048576;
/**
 * Fix 3 of the beta.3 docs review: true when the git index of the store tracks a path under `folders/`, the records of
 * registered folders, which name places on this machine. False when the store has no repository or no index, or the
 * index tracks nothing there. Null when Bowerloom cannot read the index: a file that fails the plain-file rules, a format
 * it does not know, or a size over 32 MiB. It reads `.git/index` as a plain file and runs no git. Index versions 2, 3,
 * and 4 are read, with sha1 or sha256 object names.
 */
export function storeTracksFolders(storeDir: string, hooks: StoreRepoHooks = {}): boolean | null {
  const uid = hooks.uid ?? process.getuid?.() ?? -1, git = join(storeDir, '.git');
  try {
    let stat: BigIntStats;
    try { stat = lstatSync(git, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; return null; }
    if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.uid) !== uid) return null;
    const configBytes = plainFile(join(git, 'config'), 65536, uid);
    const hashBytes = configBytes !== null && configValues(utf8(configBytes)).objectFormat === 'sha256' ? 32 : 20;
    const index = plainFile(join(git, 'index'), INDEX_LIMIT, uid);
    if (index === null) return false;
    return indexHasFolders(index, hashBytes);
  } catch (error) { if (error instanceof Unreadable) return null; throw error; }
}
/** Walks the entries of a git index. True at the first path in `folders/`; null for bytes that do not parse. */
function indexHasFolders(bytes: Buffer, hashBytes: number): boolean | null {
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'DIRC') return null;
  const version = bytes.readUInt32BE(4), count = bytes.readUInt32BE(8);
  if (version < 2 || version > 4 || count > INDEX_ENTRIES) return null;
  const fixed = 40 + hashBytes + 2;
  let at = 12, previous: Buffer = Buffer.alloc(0);
  for (let i = 0; i < count; i++) {
    if (at + fixed > bytes.length) return null;
    const flags = bytes.readUInt16BE(at + 40 + hashBytes);
    let name = at + fixed;
    if (flags & 0x4000) { if (version < 3) return null; name += 2; }
    let path: Buffer;
    if (version === 4) {
      // A path is the previous path less N bytes, then the bytes up to a NUL. N is git's offset varint.
      if (name >= bytes.length) return null;
      let c = bytes[name++]!, strip = c & 127;
      while (c & 128) { if (name >= bytes.length || strip > INDEX_LIMIT) return null; c = bytes[name++]!; strip = ((strip + 1) * 128) + (c & 127); }
      if (strip > previous.length) return null;
      const end = bytes.indexOf(0, name);
      if (end < 0) return null;
      path = Buffer.concat([previous.subarray(0, previous.length - strip), bytes.subarray(name, end)]);
      at = end + 1;
    } else {
      const end = bytes.indexOf(0, name);
      if (end < 0) return null;
      path = bytes.subarray(name, end);
      // The entry, path included, is padded with 1 to 8 NUL bytes to a multiple of 8.
      at += ((name - at) + path.length + 8) & ~7;
    }
    if (path.length >= 7 && path.toString('latin1', 0, 7) === 'folders' && (path.length === 7 || path[7] === 0x2f)) return true;
    previous = path;
  }
  return false;
}
