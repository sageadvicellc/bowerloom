/**
 * The store cache (spec 06, 3.11): authored store items fetched from github.com, in content-addressed folders
 * `<stateRoot>/store-cache/<kind>-<id>-<hash>/`, laid out as a store lays them out (`skills/<id>/...`,
 * `prompts/<id>.md`, `teams/<id>/...`). Folders are mode 0700 and files 0600, owned by the user. It is never inside
 * `~/.bowerloom` and it is not an `op-` operation of the skills cache.
 *
 * Writers hold the cache lock of `<stateRoot>/cache`, which covers this folder too. Readers take no lock: they read with
 * the authoring guards and compare the hash in the folder name. `fetchStoreGit` is the authored twin of `fetchPin`
 * (apply.ts): the bound content key, an approved host, and the cache lock for that one item only.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { directory } from '../../managed-skills/src/observed.js';
import { withCacheLock } from '../../project-context/src/index.js';
import type { HeldCacheLock } from '../../project-context/src/index.js';
import { folderNames, readGuarded, readTree, realFolder } from '../../project-authoring/src/files.js';
import { LIMITS } from '../../project-authoring/src/files.js';
import { createPublicTransport } from '../../skill-manifest/src/public-get.js';
import type { PublicTransport } from '../../skill-manifest/src/public-get.js';
import { authoredPath, authoredRows, fetchAuthored } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredKind, AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { isManifestRefusal } from '../../skill-manifest/src/refusal.js';
import { configRefusal } from '../../project-config/src/refusal.js';
import { syncError } from './refusal.js';
import { DefinitionError } from '../../contracts/src/index.js';

export const STORE_CACHE_FOLDER = 'store-cache';
export const GITHUB_HOST = 'api.github.com';
/** The machine cache (its lock covers the store cache) and the store cache itself. */
export interface StoreCacheRoots { cacheRoot: string; storeCacheRoot: string }
export type StoreTransport = PublicTransport & { close(): void };
export interface StoreGitDeps { signal: AbortSignal; storeTransport?: () => StoreTransport }
/** One authored lock item to fetch: its kind, id, the content key the plan bound (its hash), and its lock pin. */
export interface StoreGitItem { kind: AuthoredKind; id: string; requestDigest: string | null; lockPin: AuthoredPin | null }
type Files = readonly { path: string; bytes: Buffer }[];

const HEX64 = /^[a-f0-9]{64}$/, ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `<kind>-<id>-<hash>`: the folder name of one item in the store cache. */
export function storeCacheKey(kind: AuthoredKind, id: string, hash: string): string {
  if (!['skill', 'prompt', 'team'].includes(kind) || typeof id !== 'string' || !ID.test(id) || id.length > 64 || !HEX64.test(hash)) throw syncError('SKILLS_STATE_UNSAFE');
  return `${kind}-${id}-${hash}`;
}
const leftover = (key: string): RegExp => new RegExp(`^\\.tmp-${key}-[a-f0-9]{8}$`);
/** The name a replaced or pruned folder of `key` is moved to. Spec 09 (cache prune) uses the same name. */
export const pruneName = (key: string): string => `.prune-${key}-${randomBytes(4).toString('hex')}`;
export const PRUNE_NAME = /^\.prune-(?:skill|prompt|team)-[a-z0-9-]+-[a-f0-9]{64}-[a-f0-9]{8}$/;

const unsafe = (): Error => syncError('SKILLS_STATE_UNSAFE');
function syncFolder(path: string): void { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
const missing = (path: string): boolean => { try { fs.lstatSync(path); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw unsafe(); } };

/**
 * The rows of one store cache folder, read with the authoring guards: real folders and plain files the user owns, no
 * links, no group or world write, one link per file. Null when the folder is not there. A guard failure is
 * SKILLS_STATE_UNSAFE; files that do not give `hash` are LOCK_HASH_MISMATCH.
 */
export function readStoreCache(storeCacheRoot: string, kind: AuthoredKind, id: string, hash: string): { dir: string; rows: AuthoredPin['files'] } | null {
  const dir = join(storeCacheRoot, storeCacheKey(kind, id, hash));
  if (missing(dir)) return null;
  let files: { path: string; bytes: Buffer }[];
  try {
    realFolder(dir);
    // Review F10: the folder holds exactly the one item, laid out as a store lays it out, and nothing else.
    const area = kind === 'prompt' ? 'prompts' : kind === 'skill' ? 'skills' : 'teams';
    if (folderNames(dir).join('/') !== area || folderNames(join(dir, area)).join('/') !== (kind === 'prompt' ? `${id}.md` : id)) throw unsafe();
    if (kind === 'prompt') { realFolder(join(dir, 'prompts')); files = [{ path: `${id}.md`, bytes: readGuarded(join(dir, 'prompts', `${id}.md`), LIMITS.fileBytes) }]; }
    else {
      const prefix = `${area}/${id}/`;
      realFolder(join(dir, area));
      files = readTree(dir, `${area}/${id}`).map(pin => ({ path: pin.path.slice(prefix.length), bytes: readGuarded(join(dir, pin.path), LIMITS.fileBytes) }));
    }
  } catch { throw unsafe(); }
  const { rows, hash: got } = authoredRows(files);
  if (got !== hash) throw configRefusal('LOCK_HASH_MISMATCH');
  return { dir, rows };
}

/**
 * The store cache folder of an item as a plan sees it: `dir` when it re-verifies, null when it is not there, and a `fault`
 * when it is there and fails verification (review F5): the run replaces it, and the plan says so.
 */
export function probeStoreCache(storeCacheRoot: string, kind: AuthoredKind, id: string, hash: string): { dir: string | null; fault: { code: string; key: string } | null } {
  try { return { dir: readStoreCache(storeCacheRoot, kind, id, hash)?.dir ?? null, fault: null }; }
  catch (error) { const code = (error as { code?: unknown } | null)?.code; return { dir: null, fault: { code: typeof code === 'string' ? code : 'SKILLS_STATE_UNSAFE', key: storeCacheKey(kind, id, hash) } }; }
}
export const faultNote = (key: string): string => `store cache entry ${key} failed verification; it will be replaced`;
/** The store cache folder, made private when it is missing; its parent must be the existing private state chain. */
function storeCacheFolder(root: string): void {
  try {
    directory(dirname(root));
    if (missing(root)) { fs.mkdirSync(root, { mode: 0o700 }); fs.chmodSync(root, 0o700); syncFolder(dirname(root)); }
    directory(root, true);
  } catch { throw unsafe(); }
}
/** Writes one file that must not exist yet, mode 0600, and flushes it. */
function newFile(path: string, bytes: Buffer): void {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); let at = 0; while (at < bytes.length) at += fs.writeSync(fd, bytes, at); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function newFolder(path: string): void { fs.mkdirSync(path, { mode: 0o700 }); fs.chmodSync(path, 0o700); }

/** writeStoreCache, for a caller that already holds the cache lock. */
function writeHeld(held: HeldCacheLock, roots: StoreCacheRoots, kind: AuthoredKind, id: string, hash: string, files: Files): { status: 'written' | 'present'; dir: string } {
  const key = storeCacheKey(kind, id, hash), target = join(roots.storeCacheRoot, key);
  if (authoredRows(files).hash !== hash) throw configRefusal('LOCK_HASH_MISMATCH');
  held.assertHeld();
  storeCacheFolder(roots.storeCacheRoot);
  // A crash leaves a `.tmp-<key>-*` folder. Under the lock, any such folder is this writer's to remove.
  for (const name of fs.readdirSync(roots.storeCacheRoot)) if (leftover(key).test(name)) {
    const s = fs.lstatSync(join(roots.storeCacheRoot, name));
    if (s.isSymbolicLink() || s.uid !== process.getuid?.()) throw unsafe();
    fs.rmSync(join(roots.storeCacheRoot, name), { recursive: s.isDirectory(), force: false });
  }
  if (!missing(target)) {
    let ok = false;
    try { ok = readStoreCache(roots.storeCacheRoot, kind, id, hash) !== null; } catch { ok = false; }
    if (ok) return { status: 'present', dir: target };
    held.assertHeld();
    fs.renameSync(target, join(roots.storeCacheRoot, pruneName(key)));
  }
  const temp = join(roots.storeCacheRoot, `.tmp-${key}-${randomBytes(4).toString('hex')}`);
  try {
    newFolder(temp);
    const base = kind === 'prompt' ? join(temp, 'prompts') : join(temp, `${kind}s`, id);
    const folders = new Set<string>([temp, ...(kind === 'prompt' ? [base] : [join(temp, `${kind}s`), base])]);
    for (const f of folders) if (f !== temp) newFolder(f);
    for (const file of files) {
      const path = kind === 'prompt' ? join(base, `${id}.md`) : join(base, file.path);
      const parts = (kind === 'prompt' ? '' : file.path).split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) { const f = join(base, ...parts.slice(0, i)); if (!folders.has(f)) { newFolder(f); folders.add(f); } }
      newFile(path, file.bytes);
    }
    for (const f of [...folders].sort((a, b) => b.length - a.length)) syncFolder(f);
    held.assertHeld();
    fs.renameSync(temp, target);
    syncFolder(roots.storeCacheRoot);
  } catch (error) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* The next write removes it. */ }
    if ((error as { code?: unknown } | null)?.code === 'PROJECT_LOCK_UNAVAILABLE') throw error;
    throw unsafe();
  }
  return { status: 'written', dir: target };
}

/**
 * Writes one authored item into the store cache under the cache lock (3.11): `present` when its folder is there and
 * re-verifies, else `written`. A folder that fails the check is moved to `.prune-<key>-<8 hex>` and replaced. Files that
 * do not give `hash` refuse LOCK_HASH_MISMATCH before anything is written.
 */
export async function writeStoreCache(roots: StoreCacheRoots, kind: AuthoredKind, id: string, hash: string, files: Files, signal: AbortSignal): Promise<{ status: 'written' | 'present'; dir: string }> {
  return withCacheLock(roots.cacheRoot, signal, async held => writeHeld(held, roots, kind, id, hash, files));
}

/** A transport that remembers whether the commit request answered 404 (3.10, the error table). */
function watched(transport: PublicTransport): PublicTransport & { commitMissing: boolean } {
  const out = {
    commitMissing: false,
    async get(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
      try { return await transport.get(url, maxBytes, signal); }
      catch (error) { if (isManifestRefusal(error) && error.code === 'SKILLS_ADD_NOT_FOUND' && /\/git\/commits\/[a-f0-9]{40}$/.test(url)) out.commitMissing = true; throw error; }
    },
  };
  return out;
}
/** A transport error of a fetch, in the words of 3.10. Nothing in the project has changed when this runs. */
function fetchRefusal(error: unknown, signal: AbortSignal, commitMissing: boolean, id: string): unknown {
  if (signal.aborted || (error as { name?: unknown } | null)?.name === 'AbortError') return syncError('SKILLS_SYNC_INTERRUPTED', `It stopped while fetching ${id}, before any change to the project.`);
  // Review F3: an error that is no refusal of Bowerloom's is rethrown as it is, never reported as offline.
  if (!(error instanceof DefinitionError)) return error;
  const code = error.code;
  if (code === 'SKILLS_ADD_NETWORK') return syncError('SKILLS_OFFLINE', `bowerloom apply --frozen needs api.github.com for ${id}. Connect to the network and run it again.`);
  if (code === 'SKILLS_ADD_NOT_FOUND') return configRefusal(commitMissing ? 'STORE_REMOTE_PRIVATE' : 'STORE_ITEM_GONE_AT_COMMIT');
  if (code === 'SKILLS_ADD_UNSAFE_CONTENT') return configRefusal('LOCK_HASH_MISMATCH');
  return error;
}
/** At most this many GitHub requests in one run by default (review L2); --max-github-requests sets up to GITHUB_REQUEST_MAX. */
export const GITHUB_REQUEST_LIMIT = 1000;
export const GITHUB_REQUEST_MAX = 5000;
/** The requests the fetch of one authored item takes: 4, plus one per distinct blob for a skill or a team (3.10). */
export const fetchRequests = (pin: AuthoredPin): number => 4 + new Set(pin.files.map(f => f.sha256)).size;
/** The limit of a run: GITHUB_REQUEST_LIMIT, or a whole number from 1 to GITHUB_REQUEST_MAX that the person set. */
export function requestLimit(value: unknown): number {
  if (value === undefined) return GITHUB_REQUEST_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > GITHUB_REQUEST_MAX) throw new DefinitionError('USAGE', `Use --max-github-requests <n>, a whole number from 1 to ${GITHUB_REQUEST_MAX}.`);
  return value;
}
/** Refuses GITHUB_REQUEST_BUDGET when a run would make more than `limit` requests. */
export function requireRequestBudget(requests: number, limit: number = GITHUB_REQUEST_LIMIT): void { if (requests > limit) throw configRefusal('GITHUB_REQUEST_BUDGET'); }
/**
 * Second review L2: the requests of the items whose store cache entry is missing now. Phase A counts again with this, so
 * an entry removed after the plan counts, and one another run filled does not.
 */
export function missingRequests(storeCacheRoot: string, items: readonly { kind: AuthoredKind; id: string; lockPin: AuthoredPin }[]): number {
  return items.reduce((n, i) => n + (probeStoreCache(storeCacheRoot, i.kind, i.id, i.lockPin.hash).dir === null ? fetchRequests(i.lockPin) : 0), 0);
}

/**
 * Phase A for one authored lock item (3.16 step 5): under the cache lock for this item only, reuse a store cache folder
 * that re-verifies; else check the bound content key and the approved host, fetch the item at its lock commit with one
 * transport, require its rows and hash to equal the lock pin, and write it into the store cache.
 */
export async function fetchStoreGit(item: StoreGitItem, roots: StoreCacheRoots, approvedHosts: readonly string[], deps: StoreGitDeps): Promise<{ dir: string; fetched: boolean }> {
  const pin = item.lockPin;
  if (pin === null || item.requestDigest !== pin.hash || pin.path !== authoredPath(item.kind, item.id)) throw syncError('STALE_APPROVAL');
  // The approval names each host the run may contact. A fetch it did not approve never starts.
  if (!approvedHosts.includes(GITHUB_HOST)) throw syncError('SKILLS_OFFLINE', `The approved plan allows no fetch of ${item.id}. Run bowerloom apply --frozen without --offline.`);
  let commitMissing = false;
  try {
    return await withCacheLock(roots.cacheRoot, deps.signal, async held => {
      let cached = null;
      try { cached = readStoreCache(roots.storeCacheRoot, item.kind, item.id, pin.hash); } catch { cached = null; }
      if (cached !== null) return { dir: cached.dir, fetched: false };
      held.assertHeld();
      const transport = (deps.storeTransport ?? createPublicTransport)(), seen = watched(transport);
      let fetched;
      const next = () => { const more = (deps.storeTransport ?? createPublicTransport)(), w = watched(more); return { get: w.get, close: () => more.close() }; };
      try { fetched = await fetchAuthored(seen, { remote: pin.remote, commit: pin.commit, kind: item.kind, id: item.id }, deps.signal, next, { sha: pin.tree, refuse: () => { throw configRefusal('LOCK_HASH_MISMATCH'); } }); }
      finally { commitMissing = seen.commitMissing; transport.close(); }
      const { rows, hash } = authoredRows(fetched.files);
      if (hash !== pin.hash || revisionOf(rows) !== revisionOf(pin.files) || fetched.tree !== pin.tree) throw configRefusal('LOCK_HASH_MISMATCH');
      return { dir: writeHeld(held, roots, item.kind, item.id, pin.hash, fetched.files).dir, fetched: true };
    });
  } catch (error) { throw fetchRefusal(error, deps.signal, commitMissing, item.id) as Error; }
}
