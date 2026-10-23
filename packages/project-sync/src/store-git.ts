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
import { CachePruneRefusal, couldNot, leftoverFix, removeCacheEntry } from '../../skill-sources/src/cache.js';
import { directory } from '../../managed-skills/src/observed.js';
import { withCacheLock } from '../../project-context/src/index.js';
import type { HeldCacheLock } from '../../project-context/src/index.js';
import { folderNames, readGuarded, readTree, realFolder } from '../../project-authoring/src/files.js';
import { LIMITS } from '../../project-authoring/src/files.js';
import { createPublicTransport } from '../../skill-manifest/src/public-get.js';
import type { PublicGetOptions, PublicTransport } from '../../skill-manifest/src/public-get.js';
import { GithubToken, GITHUB_TOKEN_VARIABLE } from '../../skill-manifest/src/github-token.js';
import { isGithubRepository, repositoryOfRemote } from '../../skill-manifest/src/github-repository.js';
import { authoredPath, authoredRows, fetchAuthored } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredKind, AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { isManifestRefusal, manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { configRefusal } from '../../project-config/src/refusal.js';
import { offlineBecause, offlineNetwork, syncError } from './refusal.js';
import { DefinitionError } from '../../contracts/src/index.js';

export const STORE_CACHE_FOLDER = 'store-cache';
export const GITHUB_HOST = 'api.github.com';
/** The machine cache (its lock covers the store cache) and the store cache itself. */
export interface StoreCacheRoots { cacheRoot: string; storeCacheRoot: string }
export type StoreTransport = PublicTransport & { close(): void };
/** Makes the transport of an authored store fetch. The default is createPublicTransport (spec 07, section 6). */
export type StoreTransportFactory = (options: PublicGetOptions) => StoreTransport;
/** `githubToken` is the token the CLI read for this run, or null (spec 07). */
export interface StoreGitDeps { signal: AbortSignal; storeTransport?: StoreTransportFactory; githubToken?: GithubToken | null }

/**
 * Spec 07, 4.3: `network.credentials` of a plan. It names the variable, the one host, and the repositories that get the
 * token, never the token. Null when no token is used.
 */
export interface Credentials { variable: typeof GITHUB_TOKEN_VARIABLE; host: typeof GITHUB_HOST; repositories: string[] }
/** Where a plan input takes the token from: the token, none, or a reader the CLI made over its `env` argument. */
export type TokenSource = GithubToken | null | undefined | (() => GithubToken | null);
/**
 * `owner/repo` of a normal github.com remote. Every remote here has already passed the lock or the remote normalizer,
 * so another value is a fault of the calling code: a TypeError, not a refusal (review F4 of PR 97).
 */
export function repositoryOf(remote: string): string {
  const repository = repositoryOfRemote(remote);
  if (repository === null) throw new TypeError('repositoryOf takes a normal https://github.com/<owner>/<repo> remote.');
  return repository;
}
/** Review F5 of PR 97: the sentence a STALE_APPROVAL adds when the token may be what changed. */
export const TOKEN_STALE_NOTE = 'Setting or removing BOWERLOOM_GITHUB_TOKEN between the plan and --approve also changes the plan.';
/** The credentials field for these remotes: sorted, no repeats. Null for no remote. */
export function credentialsFor(remotes: Iterable<string>): Credentials | null {
  const repositories = [...new Set([...remotes].map(repositoryOf))].sort();
  return repositories.length ? { variable: GITHUB_TOKEN_VARIABLE, host: GITHUB_HOST, repositories } : null;
}
/**
 * Reads a token source once (spec 07, 3.2): call it only when a repository needs the token. A reader may throw
 * GITHUB_TOKEN_INVALID. Review F3 of PR 97: a source, or a reader's answer, that is neither null nor a token is a fault
 * of the calling code and throws a TypeError, so a wrong value never passes as "no token".
 */
export function readTokenSource(source: TokenSource): GithubToken | null {
  if (source === undefined || source === null) return null;
  if (GithubToken.isToken(source)) return source;
  if (typeof source !== 'function') throw new TypeError('A token source is null, a GithubToken, or a function that returns one or null.');
  const value: unknown = source();
  if (value === null) return null;
  if (!GithubToken.isToken(value)) throw new TypeError('A token reader returns a GithubToken or null.');
  return value;
}
/** A source that reads its token at most once, so a plan and its re-plan in one run see the same value. */
export function onceTokenSource(source: TokenSource): () => GithubToken | null {
  let read = false, value: GithubToken | null = null;
  return () => { if (!read) { value = readTokenSource(source); read = true; } return value; };
}
function validCredentials(value: unknown): value is Credentials {
  if (value === null || typeof value !== 'object') return false;
  const c = value as Partial<Credentials>;
  return Object.keys(c).length === 3 && c.variable === GITHUB_TOKEN_VARIABLE && c.host === GITHUB_HOST && Array.isArray(c.repositories) && c.repositories.length >= 1 && c.repositories.length <= 8
    && c.repositories.every((r, i, all) => isGithubRepository(r) && (i === 0 || Buffer.compare(Buffer.from(all[i - 1]!), Buffer.from(r)) < 0));
}
/**
 * The transport options of one authored fetch or proof (spec 07, section 6). A plan with credentials needs the token and
 * names the item's repository; a plan without needs no token. Any other case refuses STALE_APPROVAL before a transport.
 */
export function storeTransportOptions(credentials: unknown, token: GithubToken | null | undefined, remote: string): PublicGetOptions {
  const tokenSet = GithubToken.isToken(token);
  if (credentials === null || credentials === undefined) { if (tokenSet) throw syncError('STALE_APPROVAL', TOKEN_STALE_NOTE); return {}; }
  if (!tokenSet) throw syncError('STALE_APPROVAL', TOKEN_STALE_NOTE);
  if (!validCredentials(credentials)) throw syncError('STALE_APPROVAL');
  const repository = repositoryOf(remote);
  if (!credentials.repositories.includes(repository)) throw syncError('STALE_APPROVAL');
  return { githubAuth: { token: token!, repositories: [repository] } };
}
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
async function writeHeld(held: HeldCacheLock, roots: StoreCacheRoots, kind: AuthoredKind, id: string, hash: string, files: Files): Promise<{ status: 'written' | 'present'; dir: string }> {
  const key = storeCacheKey(kind, id, hash), target = join(roots.storeCacheRoot, key);
  if (authoredRows(files).hash !== hash) throw configRefusal('LOCK_HASH_MISMATCH');
  held.assertHeld();
  storeCacheFolder(roots.storeCacheRoot);
  // A crash leaves a `.tmp-<key>-*` folder. Under the lock, any such folder is this writer's to remove. Review L10 of PR 99
  // (spec 09: one delete path): it goes through removeCacheEntry, which refuses a link or a folder that is not private.
  for (const name of fs.readdirSync(roots.storeCacheRoot)) if (leftover(key).test(name)) {
    try { await removeCacheEntry(dirname(roots.storeCacheRoot), { scope: 'store', projectId: null }, name, held); }
    catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'PROJECT_LOCK_UNAVAILABLE') throw error;
      // Round 3 of the reviews of PR 99, M-C: the words name the leftover and why, and the next step fixes it.
      // Round 4, L3: after a delete-step failure the fix names the .prune- folder the leftover became.
      if (error instanceof CachePruneRefusal) throw Object.defineProperty(Object.assign(syncError('SKILLS_STATE_UNSAFE', couldNot(error.where, error.reason)), { next: error.fix ?? error.next ?? leftoverFix(join(roots.storeCacheRoot, name)) }), 'cause', { value: error, enumerable: false });
      throw unsafe();
    }
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
/** At most this many bytes of the repository answer are read. Only its status matters. */
const REPOSITORY_BYTES = 524288;
/** What the repository request found: GitHub shows it, it does not (404, or a refused token), or an error that cannot tell. */
type RepositoryCheck = { state: 'readable' } | { state: 'not-readable' } | { state: 'unknown'; error: unknown };
/**
 * Beta.3 docs review, fix 2: after a 404 on the commit request, one request for the repository itself, through the same
 * transport, so it counts against the item's requests and carries the token exactly when the commit request did. A
 * readable repository means the commit is gone (a force-push or a deleted branch). Nothing of the answer is kept.
 * Round 2 of the reviews of PR 100, M1: a failure that cannot tell is `unknown`, never "not readable".
 */
async function checkRepository(transport: PublicTransport, remote: string, signal: AbortSignal): Promise<RepositoryCheck> {
  try { await transport.get(`https://${GITHUB_HOST}/repos/${repositoryOf(remote)}`, REPOSITORY_BYTES, signal); return { state: 'readable' }; }
  catch (error) {
    const code = error instanceof DefinitionError ? error.code : null;
    return code === 'SKILLS_ADD_NOT_FOUND' || code === 'STORE_REMOTE_AUTH_FAILED' ? { state: 'not-readable' } : { state: 'unknown', error };
  }
}
/** Codes of the repository request that say more than the commit 404 does, and pass as they are (review M1). */
const OWN_CODES: ReadonlySet<string> = new Set(['GITHUB_RATE_LIMITED', 'GITHUB_REQUEST_FAILED', 'GITHUB_TOKEN_SSO_REQUIRED', 'SKILLS_ADD_HOST_REFUSED']);
/**
 * A transport error of a fetch, in the words of 3.10. Nothing in the project has changed when this runs. With a token
 * (spec 07, 3.7), a 404 on the commit request is STORE_REMOTE_AUTH_FAILED unless the repository check says more.
 */
function fetchRefusal(error: unknown, signal: AbortSignal, commitMissing: boolean, id: string, withToken: boolean, check: RepositoryCheck | null = null): unknown {
  if (signal.aborted || (error as { name?: unknown } | null)?.name === 'AbortError') return syncError('SKILLS_SYNC_INTERRUPTED', `It stopped while fetching ${id}, before any change to the project.`);
  // Review F3: an error that is no refusal of Bowerloom's is rethrown as it is, never reported as offline.
  if (!(error instanceof DefinitionError)) return error;
  const code = error.code;
  if (code === 'SKILLS_ADD_NETWORK') return offlineNetwork(`Fetching ${id} needs api.github.com, and the network was not reachable.`);
  if (code === 'SKILLS_ADD_NOT_FOUND') {
    if (!commitMissing) return configRefusal('STORE_ITEM_GONE_AT_COMMIT');
    if (check?.state === 'readable') return syncError('LOCK_COMMIT_GONE');
    const old = withToken ? manifestRefusal('STORE_REMOTE_AUTH_FAILED') : configRefusal('STORE_REMOTE_PRIVATE');
    if (check?.state !== 'unknown') return old;
    const failure = check.error;
    if (!(failure instanceof DefinitionError)) return failure;
    if (failure.code === 'SKILLS_ADD_NETWORK') return offlineNetwork(`Fetching ${id} needs api.github.com, and the network was not reachable.`);
    if (OWN_CODES.has(failure.code)) return failure;
    return new DefinitionError(old.code, `${old.message} Bowerloom could not check the repository: ${/^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code) ? failure.code : 'UNKNOWN'}.`);
  }
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
 * transport, require its rows and hash to equal the lock pin, and write it into the store cache. `credentials` is the
 * plan's `network.credentials` (spec 07): the token in `deps` must agree with it, or the fetch refuses STALE_APPROVAL.
 */
export async function fetchStoreGit(item: StoreGitItem, roots: StoreCacheRoots, approvedHosts: readonly string[], deps: StoreGitDeps, credentials: Credentials | null = null): Promise<{ dir: string; fetched: boolean }> {
  const pin = item.lockPin;
  if (pin === null || item.requestDigest !== pin.hash || pin.path !== authoredPath(item.kind, item.id)) throw syncError('STALE_APPROVAL');
  // The approval names each host the run may contact. A fetch it did not approve never starts.
  if (!approvedHosts.includes(GITHUB_HOST)) throw offlineBecause('approved', `The approved plan allows no fetch of ${item.id}.`);
  const options = storeTransportOptions(credentials, deps.githubToken, pin.remote), withToken = options.githubAuth !== undefined;
  const make = (): StoreTransport => (deps.storeTransport ?? createPublicTransport)(options);
  let commitMissing = false, check: RepositoryCheck | null = null;
  try {
    return await withCacheLock(roots.cacheRoot, deps.signal, async held => {
      let cached = null;
      try { cached = readStoreCache(roots.storeCacheRoot, item.kind, item.id, pin.hash); } catch { cached = null; }
      if (cached !== null) return { dir: cached.dir, fetched: false };
      held.assertHeld();
      const transport = make(), seen = watched(transport);
      let fetched;
      const next = () => { const more = make(), w = watched(more); return { get: w.get, close: () => more.close() }; };
      try { fetched = await fetchAuthored(seen, { remote: pin.remote, commit: pin.commit, kind: item.kind, id: item.id }, deps.signal, next, { sha: pin.tree, refuse: () => { throw configRefusal('LOCK_HASH_MISMATCH'); } }); }
      catch (error) {
        // Fix 2: a commit GitHub does not show, in a repository it does show, is gone. A 404 alone cannot tell. Review M2:
        // only a 404 asks; a refused token stays STORE_REMOTE_AUTH_FAILED, since a token may read the repository and not its contents.
        if (seen.commitMissing && !deps.signal.aborted) check = await checkRepository(transport, pin.remote, deps.signal);
        throw error;
      }
      finally { commitMissing = seen.commitMissing; transport.close(); }
      const { rows, hash } = authoredRows(fetched.files);
      if (hash !== pin.hash || revisionOf(rows) !== revisionOf(pin.files) || fetched.tree !== pin.tree) throw configRefusal('LOCK_HASH_MISMATCH');
      return { dir: (await writeHeld(held, roots, item.kind, item.id, pin.hash, fetched.files)).dir, fetched: true };
    });
  } catch (error) { throw fetchRefusal(error, deps.signal, commitMissing, item.id, withToken, check) as Error; }
}
