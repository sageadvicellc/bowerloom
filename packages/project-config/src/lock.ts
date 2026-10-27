/**
 * `bowerloom.lock.json`, format `bowerloom/lock/v1beta1` (spec 06, 4.1): where each store item of a project comes from,
 * and a hash that proves its bytes. A pinned store skill locks to its whole skills.json entry (`pin`); a skill, prompt,
 * or team written in the store locks to a commit of the store's github.com remote (`authored`). Project items are never
 * in the lock: git versions them.
 *
 * The parser is strict and mirrors parseConfig. The reader uses the guards of the config reader. Nothing here writes.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, captureSkillData, revisionOf } from '../../skill-sources/src/validation.js';
import { strictUtf8 } from '../../skill-sources/src/cache.js';
import { verifyProjectPins } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { serializeEntry, validateEntry } from '../../skill-manifest/src/schema.js';
import type { PinnedEntry } from '../../skill-manifest/src/schema.js';
import { skillFilePath } from '../../skill-manifest/src/content.js';
import { authoredPath } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { refuse } from './refusal.js';
import { isStorePromptId, isStoreSkillId, isStoreTeamId } from './schema.js';
import type { ProjectConfig } from './schema.js';
import { normalizeRemote } from './git.js';

export type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
export const LOCK_FILE = 'bowerloom.lock.json' as const;
export const LOCK_FORMAT = 'bowerloom/lock/v1beta1' as const;
export const LOCK_LIMITS = Object.freeze({ bytes: 4194304, skills: 128, prompts: 128, teams: 32, files: 126, fileBytes: 65536, totalBytes: 2097152 });
/** At most this many distinct `authored.remote` values in one lock. */
export const LOCK_REMOTES = 8;
export type LockItem = { id: string; from: 'store'; pin: PinnedEntry } | { id: string; from: 'store'; authored: AuthoredPin };
export interface ProjectLock { format: typeof LOCK_FORMAT; skills: LockItem[]; prompts: LockItem[]; teams: LockItem[] }
export type LockKind = 'skill' | 'prompt' | 'team';
export const LOCK_LISTS = [['skills', 'skill'], ['prompts', 'prompt'], ['teams', 'team']] as const;

const HEX40 = /^[a-f0-9]{40}$/, HEX64 = /^[a-f0-9]{64}$/, ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KIND_TEST: Readonly<Record<LockKind, (id: unknown) => boolean>> = { skill: isStoreSkillId, prompt: isStorePromptId, team: isStoreTeamId };
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
function invalid(ok: unknown): asserts ok { if (!ok) refuse('LOCK_INVALID'); }
function limit(ok: unknown): asserts ok { if (!ok) refuse('LOCK_LIMIT'); }
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k));

/** One `authored` value, checked for an item of `kind` and `id`. */
function authoredOf(value: unknown, kind: LockKind, id: string): AuthoredPin {
  invalid(isRecord(value) && exactKeys(value, ['remote', 'commit', 'path', 'tree', 'files', 'hash'], kind === 'team' ? [] : ['teams']));
  invalid(typeof value.remote === 'string' && normalizeRemote(value.remote) === value.remote);
  invalid(typeof value.commit === 'string' && HEX40.test(value.commit) && typeof value.tree === 'string' && HEX40.test(value.tree));
  invalid(value.path === authoredPath(kind, id));
  invalid(Array.isArray(value.files) && value.files.length > 0);
  limit(value.files.length <= LOCK_LIMITS.files);
  let total = 0;
  const files = (value.files as unknown[]).map(raw => {
    invalid(isRecord(raw) && exactKeys(raw, ['path', 'sha256', 'bytes']) && typeof raw.path === 'string' && typeof raw.sha256 === 'string' && HEX64.test(raw.sha256));
    invalid(Number.isSafeInteger(raw.bytes) && (raw.bytes as number) > 0);
    limit((raw.bytes as number) <= LOCK_LIMITS.fileBytes && (total += raw.bytes as number) <= LOCK_LIMITS.totalBytes);
    if (kind === 'prompt') invalid(raw.path === `${id}.md`);
    try { skillFilePath(raw.path); } catch { refuse('LOCK_INVALID'); }
    return { path: raw.path, sha256: raw.sha256, bytes: raw.bytes as number };
  });
  for (let i = 1; i < files.length; i++) invalid(byteOrder(files[i - 1]!.path, files[i]!.path) < 0);
  invalid(typeof value.hash === 'string' && HEX64.test(value.hash) && value.hash === revisionOf(files));
  let teams: string[] | undefined;
  if (Object.hasOwn(value, 'teams')) {
    const t = value.teams;
    invalid(Array.isArray(t) && t.length > 0 && t.length <= 32 && t.every(x => typeof x === 'string' && x.length <= 64 && ID.test(x)));
    for (let i = 1; i < t.length; i++) invalid(byteOrder(t[i - 1] as string, t[i] as string) < 0);
    teams = [...t as string[]];
  }
  return { remote: value.remote, commit: value.commit, path: value.path as string, tree: value.tree, files, hash: value.hash, ...(teams ? { teams } : {}) };
}

/** One item of the list of `kind`. Each item passes captureSkillData on its own, so the bounds apply per item. */
function itemOf(raw: unknown, kind: LockKind): LockItem {
  let value: unknown;
  try { value = captureSkillData(raw); } catch (error) { if (error instanceof SkillSourceError) refuse('LOCK_INVALID'); throw error; }
  invalid(isRecord(value) && exactKeys(value, ['id', 'from'], ['pin', 'authored']) && Object.hasOwn(value, 'pin') !== Object.hasOwn(value, 'authored'));
  invalid(typeof value.id === 'string' && KIND_TEST[kind](value.id) && value.from === 'store');
  const id = value.id;
  if (Object.hasOwn(value, 'pin')) {
    invalid(kind === 'skill');
    let pin: PinnedEntry;
    try { pin = validateEntry(value.pin) as PinnedEntry; } catch { return refuse('LOCK_INVALID'); }
    invalid(pin.source.kind === 'npm' || pin.source.kind === 'git');
    invalid(pin.id === id);
    return { id, from: 'store', pin };
  }
  return { id, from: 'store', authored: authoredOf(value.authored, kind, id) };
}

/**
 * Strict parse (4.1): at most 4 MiB of UTF-8 with no byte order mark, strict JSON with no duplicate key, then each item
 * on its own. Any failure is LOCK_INVALID, except a size over a limit, which is LOCK_LIMIT.
 */
export function parseLock(bytes: Buffer): ProjectLock {
  invalid(Buffer.isBuffer(bytes));
  limit(bytes.length <= LOCK_LIMITS.bytes);
  invalid(bytes.length > 0 && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
  const text = strictUtf8(bytes); invalid(text !== null);
  let value: unknown;
  try { value = strictJson(text, LOCK_LIMITS.bytes); }
  catch (error) { if (error instanceof AdapterError || error instanceof SkillSourceError) return refuse('LOCK_INVALID'); throw error; }
  invalid(isRecord(value) && exactKeys(value, ['format', 'skills', 'prompts', 'teams']) && value.format === LOCK_FORMAT);
  for (const [name] of LOCK_LISTS) invalid(Array.isArray(value[name]));
  for (const [name] of LOCK_LISTS) limit((value[name] as unknown[]).length <= LOCK_LIMITS[name]);
  const lists = {} as Record<'skills' | 'prompts' | 'teams', LockItem[]>;
  for (const [name, kind] of LOCK_LISTS) {
    lists[name] = (value[name] as unknown[]).map(item => itemOf(item, kind));
    for (let i = 1; i < lists[name].length; i++) invalid(byteOrder(lists[name][i - 1]!.id, lists[name][i]!.id) < 0);
  }
  const remotes = new Set([...lists.skills, ...lists.prompts, ...lists.teams].flatMap(i => 'authored' in i ? [i.authored.remote] : []));
  limit(remotes.size <= LOCK_REMOTES);
  return { format: LOCK_FORMAT, skills: lists.skills, prompts: lists.prompts, teams: lists.teams };
}

const itemOut = (item: LockItem) => 'pin' in item
  ? { id: item.id, from: item.from, pin: serializeEntry(item.pin) }
  : { id: item.id, from: item.from, authored: { remote: item.authored.remote, commit: item.authored.commit, path: item.authored.path, tree: item.authored.tree, files: item.authored.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })), hash: item.authored.hash, ...(item.authored.teams ? { teams: [...item.authored.teams] } : {}) } };
const sorted = (list: readonly LockItem[]): LockItem[] => [...list].sort((a, b) => byteOrder(a.id, b.id));
/** Canonical bytes: the key order of 4.1, lists sorted by id, two-space indent and a final newline. Parsed back before it is returned. */
export function serializeLock(lock: ProjectLock): string {
  invalid(isRecord(lock) && Array.isArray(lock.skills) && Array.isArray(lock.prompts) && Array.isArray(lock.teams));
  const text = `${JSON.stringify({ format: LOCK_FORMAT, skills: sorted(lock.skills).map(itemOut), prompts: sorted(lock.prompts).map(itemOut), teams: sorted(lock.teams).map(itemOut) }, null, 2)}\n`;
  parseLock(Buffer.from(text));
  return text;
}

export type LockRead = { state: 'absent' } | { state: 'present'; lock: ProjectLock; sha256: string; bytes: number };
/** Test hook: the owner the file must have. Product code passes nothing. */
export interface LockReadHooks { readonly uid?: number }
/**
 * Reads `bowerloom.lock.json` with the guards of the config reader: a regular file, not a link, one hard link, owned by
 * the user, no group or world write, at most 4 MiB, opened with O_NOFOLLOW and checked after the read. Any guard failure
 * is LOCK_UNSAFE. The project pins are checked before and after. A missing file is `absent`.
 */
export function readLockBytes(project: ProjectContext, hooks: LockReadHooks = {}): Buffer | null {
  verifyProjectPins(project);
  const file = join(project.dir, LOCK_FILE), uid = hooks.uid ?? process.getuid?.() ?? -1;
  let stat: BigIntStats;
  try { stat = lstatSync(file, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return refuse('LOCK_UNSAFE'); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0) refuse('LOCK_UNSAFE');
  if (stat.size > BigInt(LOCK_LIMITS.bytes)) refuse('LOCK_LIMIT');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); } catch { return refuse('LOCK_UNSAFE'); }
  let bytes: Buffer;
  try {
    const open = fstatSync(fd, { bigint: true });
    if (open.dev !== stat.dev || open.ino !== stat.ino || !open.isFile() || open.nlink !== 1n) refuse('LOCK_UNSAFE');
    const buffer = Buffer.alloc(LOCK_LIMITS.bytes + 1);
    let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    if (length > LOCK_LIMITS.bytes) refuse('LOCK_LIMIT');
    const after = fstatSync(fd, { bigint: true });
    if (BigInt(length) !== after.size || after.size !== open.size || after.mtimeNs !== open.mtimeNs) refuse('LOCK_UNSAFE');
    bytes = Buffer.from(buffer.subarray(0, length));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'LOCK_UNSAFE' || code === 'LOCK_LIMIT') throw error;
    return refuse('LOCK_UNSAFE');
  } finally { closeSync(fd); }
  verifyProjectPins(project);
  return bytes;
}
/** Reads and parses the lock. Throws LOCK_UNSAFE, LOCK_LIMIT, or LOCK_INVALID, and the project's own pin refusals. */
export function readLock(project: ProjectContext, hooks: LockReadHooks = {}): { state: 'absent' } | { state: 'present'; lock: ProjectLock; sha256: string; bytes: number } {
  const bytes = readLockBytes(project, hooks);
  if (bytes === null) return { state: 'absent' };
  return { state: 'present', lock: parseLock(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

/** The `<kind> <id>` pairs of a lock. */
export const lockPairs = (lock: ProjectLock): string[] => LOCK_LISTS.flatMap(([name, kind]) => lock[name].map(i => `${kind} ${i.id}`));
/** The `<kind> <id>` pairs of the store entries of a config. */
export const storePairs = (config: ProjectConfig): string[] => LOCK_LISTS.flatMap(([name, kind]) => config[name].filter(e => e.source === 'store').map(e => `${kind} ${e.id}`));
/**
 * Agreement of a lock with a config: the (kind, id) pairs of the lock equal those of the config's store entries.
 * `added` lists the pairs the config adds (it has them, the lock does not); `removed` the pairs only the lock has.
 * `via`, project entries and `harnesses` are not compared.
 */
export function lockAgrees(lock: ProjectLock, config: ProjectConfig): { agrees: boolean; added: string[]; removed: string[] } {
  const inLock = new Set(lockPairs(lock)), inConfig = new Set(storePairs(config));
  const added = [...inConfig].filter(p => !inLock.has(p)).sort(byteOrder), removed = [...inLock].filter(p => !inConfig.has(p)).sort(byteOrder);
  return { agrees: added.length === 0 && removed.length === 0, added, removed };
}
/** The lock item of `kind` and `id`, or null. */
export function lockItem(lock: ProjectLock, kind: LockKind, id: string): LockItem | null {
  const list = kind === 'skill' ? lock.skills : kind === 'prompt' ? lock.prompts : lock.teams;
  return list.find(i => i.id === id) ?? null;
}
/** The `<lock source>` text of 3.5: `npm <package>@<version>`, `GitHub <owner>/<repo>@<commit8>`, or `<owner>/<repo> commit <commit8>, hash <hash8>`. */
export function lockSourceLabel(item: LockItem): string {
  if ('pin' in item) {
    const s = item.pin.source;
    return s.kind === 'npm' ? `npm ${s.package}@${s.version}` : `GitHub ${s.repository}@${s.commit.slice(0, 8)}`;
  }
  const a = item.authored, repo = a.remote.slice('https://github.com/'.length);
  return `${repo} commit ${a.commit.slice(0, 8)}, hash ${a.hash.slice(0, 8)}`;
}
