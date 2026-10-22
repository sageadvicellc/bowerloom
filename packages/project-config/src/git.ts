/**
 * The git-backed store (spec 06, 3.10). Bowerloom never runs git: it reads a few files in `~/.bowerloom/.git`, each as a
 * plain file (a regular file, not a link, owned by the user, with no group or world write), opened with O_NOFOLLOW and
 * O_NONBLOCK and read up to its limit. Any file that fails its rules makes the repository `unreadable`.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';

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

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, REPO = /^[A-Za-z0-9._-]{1,100}$/, HEX40 = /^[a-f0-9]{40}$/;
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
    if (line.startsWith('[')) { section = '?'; continue; }
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
