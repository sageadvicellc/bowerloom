/**
 * `skills sync` apply (build plan 01, section 4, M5). Under one held project lock:
 * 1. Plan again; refuse STALE_APPROVAL unless the revision is equal.
 * 2. Create the planned private folders, mode 0700, and check their identities.
 * 3. Phase A, no project write: for each pin the machine cache does not hold, take the cache lock, look the pin up
 *    again and reuse it when another project's run completed it meanwhile. Otherwise build its acquisition plan in
 *    this run, require its content key to equal the bound one and its host to be an approved one, and acquire with
 *    that plan's own revision. The lock is held for that one pin only. A network fault refuses SKILLS_OFFLINE.
 * 4. Phase B, no project write: build every child plan; require its material, before-pins and previous receipt to
 *    equal the bound ones (SKILLS_SYNC_CONTENT_MISMATCH for material, STALE_APPROVAL for the rest).
 * 5. Phase C: for each child in order, plan it once more in this run, require that plan to equal its phase B plan
 *    apart from the shared folders and ignore file that earlier children created, and apply it with the revision
 *    just computed. The person's interrupt is checked only between children, so no child is stopped half done.
 *
 * Children share `.bowerloom/managed/.gitignore` and parent folders (`.claude/skills`, `.agents/skills`,
 * `.bowerloom/managed/...`). The first child to apply creates them, so a later child's phase B revision is stale by
 * then. That is why phase C plans again; the comparison allows exactly those differences and nothing else.
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import type { DefinitionError } from '../../contracts/src/index.js';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { inspectSkillCache, observeSkillCacheRoot, refusalSummary } from '../../skill-sources/src/cache.js';
import type { AcquiredSkillCacheReceipt, AcquiredSkillCacheSelector } from '../../skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../skill-sources/src/npm.js';
import type { NpmAcquisitionPlan } from '../../skill-sources/src/npm.js';
import { planGitAcquisition } from '../../skill-sources/src/git.js';
import type { GitAcquisitionPlan } from '../../skill-sources/src/git.js';
import { ManagedSkillError, absent, directory, exists, stablePins } from '../../managed-skills/src/observed.js';
import type { Identity } from '../../managed-skills/src/observed-types.js';
import { ownSurface } from '../../managed-skills/src/v2-observed.js';
import { readLocalPrompt, readLocalSkill } from '../../managed-skills/src/local-source.js';
import type { ItemSource, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { withCacheLock, withProjectLock } from '../../project-context/src/index.js';
import { cacheRootProblem } from '../../skill-sources/src/cache.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import type { Entry, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { entryRequest, lookupCache, receiptMatches } from './cache-index.js';
import type { CacheLookup, CacheRoots, PinnedRequest } from './cache-index.js';
import { managedPort } from './deps.js';
import type { ManagedPort, SyncDeps } from './deps.js';
import { HOSTS, MIN_FREE_BYTES, isActionable, observeSync } from './plan.js';
import type { SyncInput, SyncItem, SyncPlan } from './plan.js';
import { managedCode, outward, staleAfterApplied, syncError } from './refusal.js';
import { fetchStoreGit, missingRequests, readStoreCache, requireRequestBudget } from './store-git.js';
import type { Credentials } from './store-git.js';
import { promptNotices } from './notices.js';
import { verifyProjectPins } from '../../project-context/src/index.js';
import { createBowerloomFolder } from '../../project-config/src/folder.js';
import type { ProjectContext } from '../../project-context/src/types.js';

export const SYNC_RESULT_FORMAT = 'bowerloom/skills-sync-result/v1beta2' as const;
/** Spec 06, 4.8: each applied, held and up-to-date entry names where it is defined and where its bytes came from. */
export interface ResultOrigin { origin: 'store' | 'project' | null; resolvedFrom: 'store' | 'lock' | 'project' }
export interface SyncResult {
  format: typeof SYNC_RESULT_FORMAT; planRevision: string;
  applied: ({ id: string; action: 'install' | 'update'; receiptRevision: string } & ResultOrigin)[];
  held: ({ id: string; code: string; next: string } & ResultOrigin)[];
  upToDate: ({ id: string } & ResultOrigin)[]; orphaned: string[]; fetched: string[];
  executionAuthorized: false;
}
/** The hold of a lock-fetched item whose bytes give a notice (spec 06, 3.16, decision A). */
/** The hold of a fetched item the approved plan did not show; `rerun` is the command that shows it (second review INFO). */
export const reviewHold = (rerun = 'bowerloom apply --frozen'): { code: string; next: string } => ({ code: 'ITEM_REVIEW_REQUIRED', next: `Run ${rerun} again to review it.` });
const HEX64 = /^[a-f0-9]{64}$/;
const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const mismatch = (id: string) => syncError('SKILLS_SYNC_CONTENT_MISMATCH', `The skill is ${id}.`);

/**
 * Creates the planned private folders in order: each one new, mode 0700, owned by this user, its parent fsynced.
 * A shared folder (the state root, a folder above it, or the machine cache) that another project's run created
 * meanwhile is taken as it is, once it passes the same check: a real folder of this user, mode 0700.
 */
export function createPrivateFolders(plan: { privateState: { root: string; cacheRoot: string; itemsRoot: string; storeCacheRoot?: string; create: string[]; pins: { path: string; identity: Identity }[] } }, held: HeldProjectLock, dir: string): void {
  try {
    const ownFolder = (p: string) => p === plan.privateState.root || p.startsWith(plan.privateState.root + '/');
    for (const p of plan.privateState.create) {
      held.assertHeld(dir); directory(dirname(p));
      if (!ownFolder(p) && exists(p)) { directory(p, true); continue; }
      absent(p);
      try { fs.mkdirSync(p, { mode: 0o700 }); } catch (e) { if (!ownFolder(p) && (e as NodeJS.ErrnoException).code === 'EEXIST') { directory(p, true); continue; } throw e; }
      directory(p, true);
      const fd = fs.openSync(dirname(p), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const own = new Set([plan.privateState.root, plan.privateState.cacheRoot, plan.privateState.itemsRoot, ...(plan.privateState.storeCacheRoot ? [plan.privateState.storeCacheRoot] : [])]);
    for (const pin of plan.privateState.pins) if (!same(directory(pin.path, own.has(pin.path)), pin.identity)) throw syncError('SKILLS_STATE_UNSAFE');
  } catch (e) { if (e instanceof Error && 'code' in e && e.code === 'PROJECT_LOCKED') throw e; throw syncError('SKILLS_STATE_UNSAFE'); }
}

const NETWORK = new Set(['NPM_DNS', 'NPM_NETWORK', 'NPM_RESPONSE', 'NPM_RESPONSE_BOUND', 'NPM_REQUEST_BOUND', 'NPM_TIMEOUT', 'NPM_NONPUBLIC_ADDRESS', 'GIT_DNS', 'GIT_NETWORK', 'GIT_RESPONSE', 'GIT_RESPONSE_BOUND', 'GIT_REQUEST_BOUND', 'GIT_TIMEOUT', 'GIT_NONPUBLIC_ADDRESS']);
const CONTENT = /^(?:NPM_(?:METADATA|ARCHIVE_BOUND|INTEGRITY|ENCODING|CONTENT|SELECTED_INVENTORY|COMPRESSION|TAR_[A-Z]+)|GIT_(?:METADATA|BASE64|BLOB|BLOB_DIGEST|BOUND|CONTENT|ENCODING|OUTSIDE_PATH|PATH_[A-Z]+|SELECTED_INVENTORY|SUBMODULE|SYMLINK|TREE|TREE_BOUND|TREE_DIGEST))$/;
/** An acquisition refusal in sync's words. Nothing in the project has changed when this runs. */
function acquisitionRefusal(error: unknown, signal: AbortSignal, id: string): Error {
  if (signal.aborted) return syncError('SKILLS_SYNC_INTERRUPTED', `It stopped while fetching ${id}, before any change to the project. Run bowerloom skills sync again.`);
  const summary = refusalSummary(error), code = summary.codes[0] ?? '';
  if (summary.uncertain) return syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The fetch of ${id} left the cache unclear (${summary.codes.join(', ')}). Run bowerloom skills sync again: it leaves that operation as it is and fetches into a new one.`);
  if (code.endsWith('_ABORTED')) return syncError('SKILLS_SYNC_INTERRUPTED', `It stopped while fetching ${id}, before any change to the project.`);
  if (CONTENT.test(code)) return syncError('SKILLS_SYNC_CONTENT_MISMATCH', `The fetched bytes of ${id} do not match its pin (${code}).`);
  if (code.startsWith('NPM_CACHE') || code.startsWith('GIT_CACHE')) return syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The private cache refused the fetch of ${id} (${code}).`);
  return syncError('SKILLS_OFFLINE', `Bowerloom could not fetch it. The skill is ${id}${NETWORK.has(code) ? ` (${code})` : ''}. Check the network, then run bowerloom skills sync again. Pins that are already cached also sync with --offline.`);
}

/** The machine cache and, read only, the per-project cache of an earlier beta, for a plan's private state. */
export function cacheRoots(privateState: { root: string; cacheRoot: string }): CacheRoots { return { cacheRoot: privateState.cacheRoot, legacyCacheRoot: join(privateState.root, 'cache') }; }
/**
 * Phase A for one pin, under the cache lock and for this pin only: look it up again and reuse it when another run
 * completed it meanwhile; else plan its acquisition in this run, check the bound content key and the approved host,
 * and acquire into the first unused operation id. Returns where the pin now is, and whether this run fetched it.
 */
export async function fetchPin(item: SyncItem, pinned: PinnedRequest, roots: CacheRoots, approvedHosts: readonly string[], deps: SyncDeps): Promise<{ lookup: CacheLookup; fetched: boolean }> {
  if (pinned.digest !== item.requestDigest || item.cacheOperationId === null) throw stale();
  // The approval names each host the run may contact. A fetch it did not approve never starts.
  if (!approvedHosts.includes(HOSTS[pinned.kind])) throw syncError('SKILLS_OFFLINE', `The approved plan allows no fetch of ${item.id}. Run bowerloom skills sync without --offline.`);
  try {
    return await withCacheLock(roots.cacheRoot, deps.signal, async held => {
      const again = await lookupCache(roots, pinned);
      if (again.status === 'cached') return { lookup: again, fetched: false };
      held.assertHeld();
      let plan: Readonly<NpmAcquisitionPlan> | Readonly<GitAcquisitionPlan>;
      try {
        const binding = observeSkillCacheRoot(roots.cacheRoot, again.operationId, MIN_FREE_BYTES);
        plan = pinned.kind === 'npm' ? planNpmAcquisition(pinned.cacheRequest, binding) : planGitAcquisition(pinned.cacheRequest, binding);
      } catch { throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The private cache could not take ${item.id}.`); }
      if (plan.cache.operationId !== again.operationId || !same(plan.request, pinned.cacheRequest)) throw stale();
      let receipt: Readonly<AcquiredSkillCacheReceipt>;
      try { receipt = pinned.kind === 'npm' ? await deps.acquirer.npm(plan as NpmAcquisitionPlan, plan.revision, deps.signal) : await deps.acquirer.git(plan as GitAcquisitionPlan, plan.revision, deps.signal); }
      catch (e) { throw acquisitionRefusal(e, deps.signal, item.id); }
      if (!receiptMatches(pinned, receipt) || receipt.operationId !== again.operationId) throw mismatch(item.id);
      return { lookup: { ...again, status: 'cached', receiptRevision: receipt.revision }, fetched: true };
    });
  } catch (e) {
    if (deps.signal.aborted) throw syncError('SKILLS_SYNC_INTERRUPTED', `It stopped while fetching ${item.id}, before any change to the project. Run bowerloom skills sync again.`);
    throw e;
  }
}
/**
 * The selector of a completed cache operation, read again now. A pin found cached, or just fetched, must still be
 * the very same bytes: its snapshot and receipt, when known, are compared.
 */
export async function selectorFor(item: SyncItem, pinned: PinnedRequest, lookup: CacheLookup, context: PruneContext | null = null): Promise<AcquiredSkillCacheSelector> {
  const { root, operationId } = lookup;
  let inspected;
  try { inspected = await inspectSkillCache({ root, operationId }); }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const gone = context !== null && typeof code === 'string' && INSPECT_SOURCE_CODES.includes(code) ? prunedPin(item.id, root, operationId, context) : null;
    throw gone ?? syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The cached pin of ${item.id} could not be read back.`);
  }
  if (inspected.status !== 'COMPLETED' || inspected.receipt === null || inspected.activeOwner) throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The cached pin of ${item.id} is not complete.`);
  if (!receiptMatches(pinned, inspected.receipt)) throw mismatch(item.id);
  if ((lookup.snapshotRevision !== null && inspected.snapshotRevision !== lookup.snapshotRevision) || (lookup.receiptRevision !== null && inspected.receipt.revision !== lookup.receiptRevision)) throw stale();
  return { root, operationId, expectedSnapshotRevision: inspected.snapshotRevision, expectedReceiptRevision: inspected.receipt.revision };
}

/** What prunedPin checks a missing pin against: the state root, the skills cache folder that the plan pinned, and the rerun. */
export interface PruneContext { rerun: string; stateRoot: string; cacheIdentity: { device: string; inode: string } | null }
/** The inspection codes of an operation folder that is not there: the source-read refusals of selectorFor. */
export const INSPECT_SOURCE_CODES: readonly string[] = Object.freeze(['NPM_CACHE_DIRECTORY', 'GIT_CACHE_DIRECTORY']);
/**
 * The code that managed.plan gives when it cannot read a cache source. The managed layer folds every source-read
 * refusal of readAcquiredSkillCache into this fallback (managed-skills v2-observed.ts, boundaryV2), so the folder checks
 * of prunedPin decide the rest.
 */
export const PLAN_SOURCE_CODES: readonly string[] = Object.freeze(['MANAGED_SKILL_REFUSED']);
/** The context of a sync plan: its state root, its pin of the skills cache folder (if it was there), and the rerun. */
export function pruneContext(plan: { privateState: { cacheRoot: string; pins: readonly { path: string; identity: { device: string; inode: string } }[] } }, rerun: string): PruneContext {
  const pin = plan.privateState.pins.find(p => p.path === plan.privateState.cacheRoot);
  return { rerun, stateRoot: dirname(plan.privateState.cacheRoot), cacheIdentity: pin ? { device: pin.identity.device, inode: pin.identity.inode } : null };
}
/**
 * Review M2 of PR 99 (a departure from spec 09, which left sync unchanged), narrowed in round 3 (M-B): the caller has a
 * source-read refusal of a pin in the machine cache. When that cache folder is still the private folder the plan pinned
 * and only the pin's operation folder is gone, the pin was deleted after the fetch, for example by cache prune:
 * STALE_APPROVAL, and a rerun fetches it again. When the cache folder itself changed, SKILLS_STATE_UNSAFE. Otherwise null,
 * and the caller keeps its own refusal.
 */
export function prunedPin(id: string, root: string, operationId: string, context: PruneContext): DefinitionError | null {
  if (root !== join(context.stateRoot, 'cache')) return null;
  const problem = cacheRootProblem(context.stateRoot, { scope: 'machine', projectId: null });
  if (problem !== null) return syncError('SKILLS_STATE_UNSAFE', `The skills cache folder changed during the run: ${problem}.`);
  if (context.cacheIdentity !== null) {
    let s: fs.BigIntStats; try { s = fs.lstatSync(root, { bigint: true }); } catch { return syncError('SKILLS_STATE_UNSAFE', 'The skills cache folder changed during the run.'); }
    if (String(s.dev) !== context.cacheIdentity.device || String(s.ino) !== context.cacheIdentity.inode) return syncError('SKILLS_STATE_UNSAFE', 'The skills cache folder was replaced during the run.');
  }
  try { fs.lstatSync(join(root, 'op-' + operationId)); return null; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    return Object.assign(syncError('STALE_APPROVAL', `The cached pin of ${id} was deleted after the fetch, for example by bowerloom cache prune. Run ${context.rerun} again.`), { next: context.rerun });
  }
}
/** The store folder an authored lock item is read from after phase A: its store cache folder. Fetches it when it is not there. */
export async function authoredFolder(item: { kind: 'skill' | 'prompt' | 'team'; id: string; requestDigest: string | null; lockPin: SyncItem['lockPin'] }, privateState: { cacheRoot: string; storeCacheRoot: string }, hosts: readonly string[], deps: SyncDeps, credentials: Credentials | null = null): Promise<{ dir: string; fetched: boolean }> {
  const pin = item.lockPin;
  if (pin === null) throw stale();
  await deps.beforeStoreRead?.({ kind: item.kind, id: item.id });
  let cached: { dir: string } | null = null;
  try { cached = readStoreCache(privateState.storeCacheRoot, item.kind, item.id, pin.hash); } catch { cached = null; }
  if (cached !== null) return { dir: cached.dir, fetched: false };
  return fetchStoreGit({ kind: item.kind, id: item.id, requestDigest: item.requestDigest, lockPin: pin }, privateState, hosts, { signal: deps.signal, ...(deps.storeTransport ? { storeTransport: deps.storeTransport } : {}), githubToken: deps.githubToken ?? null }, credentials);
}
/** The text of one file of a store cache folder, read with the store reader. */
function storeText(project: string, kind: 'skill' | 'prompt', id: string, dir: string): string {
  const read = kind === 'skill' ? readLocalSkill(project, 'skills/' + id, () => {}, { bowerloom: dir, origin: 'store' }) : readLocalPrompt(project, id, () => {}, { bowerloom: dir, origin: 'store' });
  return read.files.find(f => f.path === (kind === 'skill' ? 'SKILL.md' : `${id}.md`))?.text ?? '';
}
/**
 * True when a lock-fetched skill can do more than text (allowed-tools, hooks, or shell lines) and the approved plan did not
 * show exactly that (decision A, widened by review H1). It reads the bytes phase A has, fetched or put there by another run.
 */
export function needsReview(project: string, item: SyncItem, dir: string): boolean {
  const notices = promptNotices(storeText(project, 'skill', item.id, dir));
  return notices.length > 0 && revisionOf(notices) !== revisionOf(item.notices ?? null);
}
export { storeText };

/** The child request of one item. Every field comes from the plan this run computed. */
export function childRequest(plan: SyncPlan, item: SyncItem, source: ItemSource): ManagedItemRequest {
  return {
    operation: item.action === 'install' ? 'install' : 'update', projectDir: plan.project.dir, stateDir: join(plan.privateState.itemsRoot, item.id),
    item: { kind: 'skill', id: item.id }, harnesses: [...item.harnesses], source, expectedPreviousRevision: item.previousReceiptRevision, minFreeBytes: MIN_FREE_BYTES, legacy: null,
  };
}
const rel = (dir: string, p: string): string => p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
/**
 * Phase B check of one child plan against the parent plan's bindings. Content that differs from skills.json is a
 * mismatch; anything else that differs means the project changed since the approval.
 */
export function checkChild(dir: string, item: SyncItem, pinned: PinnedRequest | null, req: ManagedItemRequest, child: ManagedItemPlan | UpToDateV2): ManagedItemPlan {
  if (child.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale(`${item.id} changed since the plan.`);
  const c = child as ManagedItemPlan, closure = c.core.closure;
  if (!same(c.core.request, req)) throw stale();
  if (!same(closure.inventory, item.expected.files)) throw mismatch(item.id);
  if (pinned) {
    const r = pinned.request;
    if (!same(closure.skill, r.skill) || !same(closure.license, r.license) || !same(closure.references, r.references) || !receiptMatches(pinned, { source: closure.source, skill: closure.skill, inventory: r.files, license: closure.license, references: closure.references } as unknown as AcquiredSkillCacheReceipt)) throw mismatch(item.id);
  } else if (!same(closure.source, { kind: item.origin === 'store' ? 'store' : 'local', path: 'skills/' + item.id }) || closure.skill !== null) throw mismatch(item.id);
  for (const m of c.material) if (m.id === 'canonical' || m.id === 'projection-claude' || m.id === 'projection-codex') {
    if (!same(m.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.byteLength(f.text) })), item.expected.files)) throw mismatch(item.id);
  }
  const own = c.core.before.filter(ownSurface);
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path) })), item.expected.surfaces)) throw stale();
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path), stablePinsDigest: revisionOf(stablePins(s.pins)) })), item.before)) throw stale(`${item.id} changed since the plan.`);
  if ((c.core.previous?.revision ?? null) !== item.previousReceiptRevision) throw stale();
  return c;
}
/**
 * Phase C: the plan made right before the apply equals the phase B plan, except that a shared parent folder or the
 * shared ignore file an earlier child of this run created is now present.
 */
function sameExceptShared(b: ManagedItemPlan, c: ManagedItemPlan | UpToDateV2, created: ReadonlyMap<string, Identity>, ignoreCreated: boolean): ManagedItemPlan {
  if (c.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale();
  const x = b.core, y = (c as ManagedItemPlan).core;
  const fixed = (core: typeof x) => ({ request: core.request, bindings: core.bindings, closure: core.closure, previous: core.previous, previousReceiptPin: core.previousReceiptPin, legacy: core.legacy, history: core.history, own: core.before.filter(ownSurface) });
  if (!same(fixed(x), fixed(y))) throw stale();
  const bIgnore = x.before.some(s => s.id === 'ignore'), cIgnore = y.before.some(s => s.id === 'ignore');
  if (bIgnore !== cIgnore && !(bIgnore && !cIgnore && ignoreCreated)) throw stale();
  if (x.parents.length !== y.parents.length) throw stale();
  for (const p of y.parents) {
    const was = x.parents.find(q => q.path === p.path);
    // Review M5 finding 6: a parent an earlier child created must be that very folder, by its recorded identity.
    const made = created.get(p.path);
    if (!was || !(same(was.identity, p.identity) || (was.identity === null && p.identity !== null && made !== undefined && same(made, p.identity)))) throw stale();
  }
  if (!same(b.material.filter(ownSurface), (c as ManagedItemPlan).material.filter(ownSurface))) throw stale();
  return c as ManagedItemPlan;
}

/** The command a person runs again to finish: `bowerloom skills sync`, or `bowerloom apply` for M6. */
export type Rerun = 'bowerloom skills sync' | 'bowerloom apply';
export const interrupted = (done: string[], left: string[], rerun: Rerun = 'bowerloom skills sync') => syncError('SKILLS_SYNC_INTERRUPTED',
  `${done.length ? `Finished: ${done.join(', ')}.` : 'No skill was changed.'} Not started: ${left.join(', ')}. Run ${rerun} to finish. If bowerloom status names an unfinished skill, run bowerloom skills recover plan --item <id>.`);
function childFailure(error: unknown, id: string, done: string[], rerun: Rerun): Error {
  const code = managedCode(error), before = done.length ? ` Finished before it: ${done.join(', ')}.` : '';
  if (code === 'MANAGED_SKILL_RECOVERY_REQUIRED') return syncError(code, `It belongs to ${id}, which stopped inside its change.${before} Run bowerloom skills recover plan --item ${id}, then ${rerun}.`);
  return outward(error instanceof ManagedSkillError ? error : new ManagedSkillError(code), 'MANAGED_SKILL_REFUSED', `It belongs to ${id}; nothing of ${id} changed.${before} Run ${rerun} again.`);
}

/** One child of a locked run: the item (its id names its private folder), its request and its phase B plan. */
export interface Child { item: { id: string; action: SyncItem['action'] }; req: ManagedItemRequest; plan: ManagedItemPlan }

/** What phase A gives phase B: the source of each actionable skill, what was fetched, and the items held for review. */
export interface SkillSources { sources: Map<string, ItemSource>; pins: Map<string, PinnedRequest>; fetched: string[]; review: string[] }
/**
 * Phase A for the actionable skills of a sync plan, inside the caller's locked run: fetch what needs fetching into the
 * private caches. No project write. A lock-fetched authored skill whose SKILL.md declares allowed-tools that the plan did
 * not show is held for review (ITEM_REVIEW_REQUIRED) and gets no child.
 */
export async function fetchSkillSources(plan: SyncPlan, entries: ReadonlyMap<string, Entry>, held: HeldProjectLock, deps: SyncDeps, rerun: Rerun = 'bowerloom skills sync'): Promise<SkillSources> {
  const dir = plan.project.dir, work = plan.items.filter(isActionable);
  const pins = new Map<string, PinnedRequest>(), sources = new Map<string, ItemSource>(), fetched: string[] = [], review: string[] = [];
  for (const item of work) {
    const entry = entries.get(item.id);
    if (!entry) throw stale();
    if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun);
    if (entry.source.kind === 'local') {
      if (item.origin === 'project') { sources.set(item.id, { kind: 'local', path: 'skills/' + item.id }); continue; }
      if (item.resolvedFrom === 'store') { if (plan.store === null) throw stale(); sources.set(item.id, { kind: 'store', path: 'skills/' + item.id, storeDir: plan.store.dir }); continue; }
      held.assertHeld(dir);
      const got = await authoredFolder({ kind: 'skill', id: item.id, requestDigest: item.requestDigest, lockPin: item.lockPin }, plan.privateState, plan.network.hosts, deps, plan.network.credentials ?? null);
      if (got.fetched) fetched.push(item.id);
      if (needsReview(dir, item, got.dir)) { review.push(item.id); continue; }
      sources.set(item.id, { kind: 'store', path: 'skills/' + item.id, storeDir: got.dir });
      continue;
    }
    const pinned = entryRequest(entry as PinnedEntry); pins.set(item.id, pinned);
    if (item.cache === null) throw stale();
    let found = item.cache;
    if (found.status === 'needs-fetch') {
      held.assertHeld(dir);
      const done = await fetchPin(item, pinned, cacheRoots(plan.privateState), plan.network.hosts, deps); found = done.lookup;
      if (done.fetched) fetched.push(item.id);
    }
    sources.set(item.id, { kind: 'cache', selector: await selectorFor(item, pinned, found, pruneContext(plan, rerun)) });
  }
  return { sources, pins, fetched, review };
}
/** Phase B: every child plan of the skills phase A gave a source, checked against the bindings. No project write. */
export async function planSkillChildren(plan: SyncPlan, got: SkillSources, deps: SyncDeps, managed: ManagedPort, rerun: Rerun = 'bowerloom skills sync'): Promise<Child[]> {
  const work = plan.items.filter(isActionable).filter(i => got.sources.has(i.id)), children: Child[] = [];
  for (const item of work) {
    if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun);
    const req = childRequest(plan, item, got.sources.get(item.id)!);
    let child; try { child = await managed.plan(req, { signal: deps.signal }); } catch (e) {
      if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun);
      const source = got.sources.get(item.id)!, code = (e as { code?: unknown } | null)?.code;
      const gone = source.kind === 'cache' && typeof code === 'string' && PLAN_SOURCE_CODES.includes(code) ? prunedPin(item.id, source.selector.root, source.selector.operationId, pruneContext(plan, rerun)) : null;
      if (gone !== null) throw gone;
      throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to ${item.id}; nothing was changed.`);
    }
    children.push({ item, req, plan: checkChild(plan.project.dir, item, got.pins.get(item.id) ?? null, req, child) });
  }
  return children;
}
/**
 * Phases A and B for the actionable skills of a sync plan, inside the caller's locked run: fetch what needs fetching
 * into the private cache, then build and check every child plan. Neither phase writes in the project.
 */
export async function prepareSkillChildren(plan: SyncPlan, entries: ReadonlyMap<string, Entry>, held: HeldProjectLock, deps: SyncDeps, managed: ManagedPort, rerun: Rerun = 'bowerloom skills sync'): Promise<{ children: Child[]; fetched: string[]; review: string[] }> {
  const got = await fetchSkillSources(plan, entries, held, deps, rerun);
  return { children: await planSkillChildren(plan, got, deps, managed, rerun), fetched: got.fetched, review: got.review };
}
/**
 * Spec 06, 3.4: a config-only project gets `.bowerloom` after phase A and before phase B, under the project lock, when the
 * run has work. Returns the context to use for the rest of the run.
 */
export function bowerloomBeforePhaseB(project: ProjectContext, plan: { bowerloomFolder: 'present' | 'create' }, held: HeldProjectLock, work: boolean): ProjectContext {
  if (plan.bowerloomFolder !== 'create' || !work) return project;
  return createBowerloomFolder(project, held);
}

/**
 * Phase C: applies the children in order, each with a revision planned right before it in this locked run. The
 * person's interrupt is read only here, between children. `ignoreExact` is true when the shared ignore file was in
 * place when the run planned.
 */
export interface AppliedChild { id: string; action: 'install' | 'update'; receiptRevision: string }
export async function applyChildren(children: readonly Child[], held: HeldProjectLock, dir: string, ignoreExact: boolean, managed: ManagedPort, signal: AbortSignal, rerun: Rerun = 'bowerloom skills sync'): Promise<AppliedChild[]> {
  const applied: AppliedChild[] = [], created = new Map<string, Identity>(); let ignoreCreated = ignoreExact;
  for (const [index, child] of children.entries()) {
    if (signal.aborted) throw interrupted(applied.map(a => a.id), children.slice(index).map(c => c.item.id), rerun);
    held.assertHeld(dir);
    let fresh; try { fresh = await managed.plan(child.req, {}); } catch (e) { throw childFailure(e, child.item.id, applied.map(a => a.id), rerun); }
    let now: ManagedItemPlan;
    try { now = sameExceptShared(child.plan, fresh, created, ignoreCreated); }
    catch (e) { if (applied.length) throw staleAfterApplied(applied.map(a => a.id), child.item.id, rerun); throw e; }
    let receipt: ManagedItemReceipt;
    try { receipt = await managed.apply(held, child.req, now.revision, {}); } catch (e) { throw childFailure(e, child.item.id, applied.map(a => a.id), rerun); }
    if (receipt.state !== 'committed' || receipt.planRevision !== now.revision) throw childFailure(new ManagedSkillError('MANAGED_SKILL_REFUSED'), child.item.id, applied.map(a => a.id), rerun);
    applied.push({ id: child.item.id, action: child.item.action as 'install' | 'update', receiptRevision: receipt.revision });
    // The identity of each parent this child created, read right after it committed. One that cannot be read is not
    // recorded, so a later child that needs it refuses STALE_APPROVAL.
    for (const p of now.core.parents) if (p.identity === null) { try { created.set(p.path, directory(p.path)); } catch { /* Not recorded. */ } }
    if (now.core.before.some(s => s.id === 'ignore')) ignoreCreated = true;
  }
  return applied;
}

/** The origin fields of a plan item, for a result entry. */
export const originOf = (i: { origin: 'store' | 'project' | null; resolvedFrom: 'store' | 'lock' | 'project' }): ResultOrigin => ({ origin: i.origin, resolvedFrom: i.resolvedFrom });
/** Fetches the authored lock items a plan puts in the store cache only (3.16): prompts for skills sync, teams for a frozen run. */
export async function fetchStoreOnly(plan: { storeFetch: readonly { kind: 'prompt' | 'team'; id: string; lockPin: NonNullable<SyncItem['lockPin']> }[]; privateState: { cacheRoot: string; storeCacheRoot: string }; network: { hosts: string[]; credentials?: Credentials | null }; project: { dir: string } }, held: HeldProjectLock, deps: SyncDeps): Promise<string[]> {
  const fetched: string[] = [];
  for (const f of plan.storeFetch) {
    held.assertHeld(plan.project.dir);
    const got = await authoredFolder({ kind: f.kind, id: f.id, requestDigest: f.lockPin.hash, lockPin: f.lockPin }, plan.privateState, plan.network.hosts, deps, plan.network.credentials ?? null);
    if (got.fetched) fetched.push(`${f.kind} ${f.id}`);
  }
  return fetched;
}

/** Applies an approved sync plan. `revision` must be the revision this run computes again under the lock. */
export async function applySync(input: SyncInput, revision: string, deps: SyncDeps): Promise<SyncResult> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw stale();
  if (!(deps?.signal instanceof AbortSignal) || typeof deps.acquirer?.npm !== 'function' || typeof deps.acquirer?.git !== 'function') throw new TypeError('applySync needs an acquirer and a signal.');
  if (deps.signal.aborted) throw interrupted([], ['every skill']);
  const managed: ManagedPort = deps.managed ?? managedPort;
  // The lock's own signal is not the person's interrupt: a child holds the lock to its end.
  const lock = new AbortController();
  try {
    return await withProjectLock(input.project.dir, lock.signal, async held => {
      const { plan, entries, token } = await observeSync(input);
      if (plan.revision !== revision) throw stale();
      // Spec 07: the token this run read for the plan, and only that one, reaches the store fetch.
      deps = { ...deps, githubToken: token };
      const dir = plan.project.dir, work = plan.items.filter(isActionable);
      if (deps.signal.aborted) throw interrupted([], work.map(i => i.id));
      createPrivateFolders(plan, held, dir);
      // Review L2: a run never makes more GitHub requests than the budget, checked again before any fetch.
      // Second review L2: the items the store cache lacks now, counted again, within the bound limit.
      requireRequestBudget(missingRequests(plan.privateState.storeCacheRoot, [...work.filter(i => i.lockPin !== null).map(i => ({ kind: 'skill' as const, id: i.id, lockPin: i.lockPin! })), ...plan.storeFetch]), plan.network.maxRequests);
      // Phase A: the private caches only.
      const got = await fetchSkillSources(plan, entries, held, deps);
      const stored = await fetchStoreOnly(plan, held, deps);
      // Review C2: the context that names the folder this run made, checked again before phase C writes.
      const project = bowerloomBeforePhaseB(input.project, plan, held, got.sources.size > 0);
      const children = await planSkillChildren(plan, got, deps, managed);
      verifyProjectPins(project);
      const applied = await applyChildren(children, held, dir, plan.managed.ignore === 'exact', managed, deps.signal);
      const byId = new Map(plan.items.map(i => [i.id, i]));
      return {
        format: SYNC_RESULT_FORMAT, planRevision: plan.revision,
        applied: applied.map(a => ({ ...a, ...originOf(byId.get(a.id)!) })),
        held: [...plan.items.filter(i => i.action === 'hold').map(i => ({ id: i.id, code: i.hold!.code, next: i.hold!.next, ...originOf(i) })), ...got.review.map(id => ({ id, ...reviewHold(plan.frozen ? 'bowerloom skills sync --frozen' : 'bowerloom skills sync'), ...originOf(byId.get(id)!) }))],
        upToDate: plan.items.filter(i => i.state === 'up-to-date' && i.action === 'none').map(i => ({ id: i.id, ...originOf(i) })),
        orphaned: plan.items.filter(i => i.state === 'orphaned').map(i => i.id), fetched: [...got.fetched, ...stored], executionAuthorized: false,
      };
    });
  } catch (e) { throw outward(e); }
}
