/**
 * `skills sync` apply (build plan 01, section 4, M5). Under one held project lock:
 * 1. Plan again; refuse STALE_APPROVAL unless the revision is equal.
 * 2. Create the planned private folders, mode 0700, and check their identities.
 * 3. Phase A, no project write: for each pin that needs fetching, build its acquisition plan in this run, require its
 *    request digest and cache operation id to equal the bound ones, and acquire with that plan's own revision.
 *    A network fault refuses SKILLS_OFFLINE.
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
import { revisionOf } from '../../skill-sources/src/validation.js';
import { inspectSkillCache, observeSkillCacheRoot, refusalSummary } from '../../skill-sources/src/cache.js';
import type { AcquiredSkillCacheReceipt, AcquiredSkillCacheSelector } from '../../skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../skill-sources/src/npm.js';
import type { NpmAcquisitionPlan } from '../../skill-sources/src/npm.js';
import { planGitAcquisition } from '../../skill-sources/src/git.js';
import type { GitAcquisitionPlan } from '../../skill-sources/src/git.js';
import { ManagedSkillError, absent, directory, stablePins } from '../../managed-skills/src/observed.js';
import type { Identity } from '../../managed-skills/src/observed-types.js';
import { ownSurface } from '../../managed-skills/src/v2-observed.js';
import type { ItemSource, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import type { Entry, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { entryRequest, receiptMatches } from './cache-index.js';
import type { PinnedRequest } from './cache-index.js';
import { managedPort } from './deps.js';
import type { ManagedPort, SyncDeps } from './deps.js';
import { MIN_FREE_BYTES, isActionable, observeSync } from './plan.js';
import type { SyncInput, SyncItem, SyncPlan } from './plan.js';
import { managedCode, outward, staleAfterApplied, syncError } from './refusal.js';

export const SYNC_RESULT_FORMAT = 'bowerloom/skills-sync-result/v1beta1' as const;
export interface SyncResult {
  format: typeof SYNC_RESULT_FORMAT; planRevision: string;
  applied: { id: string; action: 'install' | 'update'; receiptRevision: string }[];
  held: { id: string; code: string; next: string }[];
  upToDate: string[]; orphaned: string[]; fetched: string[];
  executionAuthorized: false;
}
const HEX64 = /^[a-f0-9]{64}$/;
const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const mismatch = (id: string) => syncError('SKILLS_SYNC_CONTENT_MISMATCH', `The skill is ${id}.`);

/** Creates the planned private folders in order: each one new, mode 0700, owned by this user, its parent fsynced. */
export function createPrivateFolders(plan: Pick<SyncPlan, 'privateState'>, held: HeldProjectLock, dir: string): void {
  try {
    for (const p of plan.privateState.create) {
      held.assertHeld(dir); directory(dirname(p)); absent(p);
      fs.mkdirSync(p, { mode: 0o700 }); directory(p, true);
      const fd = fs.openSync(dirname(p), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const own = new Set([plan.privateState.root, plan.privateState.cacheRoot, plan.privateState.itemsRoot]);
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

/** Phase A for one pin: an acquisition plan made in this run, checked against the bound digest and id, then acquired. */
export async function fetchPin(item: SyncItem, pinned: PinnedRequest, cacheRoot: string, deps: SyncDeps): Promise<void> {
  if (pinned.digest !== item.requestDigest || item.cacheOperationId === null) throw stale();
  let plan: Readonly<NpmAcquisitionPlan> | Readonly<GitAcquisitionPlan>;
  try {
    const binding = observeSkillCacheRoot(cacheRoot, item.cacheOperationId, MIN_FREE_BYTES);
    plan = pinned.kind === 'npm' ? planNpmAcquisition(pinned.request, binding) : planGitAcquisition(pinned.request, binding);
  } catch { throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The private cache could not take ${item.id}.`); }
  if (plan.cache.operationId !== item.cacheOperationId || !same(plan.request, pinned.request)) throw stale();
  let receipt: Readonly<AcquiredSkillCacheReceipt>;
  try { receipt = pinned.kind === 'npm' ? await deps.acquirer.npm(plan as NpmAcquisitionPlan, plan.revision, deps.signal) : await deps.acquirer.git(plan as GitAcquisitionPlan, plan.revision, deps.signal); }
  catch (e) { throw acquisitionRefusal(e, deps.signal, item.id); }
  if (!receiptMatches(pinned, receipt) || receipt.operationId !== item.cacheOperationId) throw mismatch(item.id);
}
/** The selector of a completed cache operation, read again now; a bound cached pin must be the very same bytes. */
export async function selectorFor(item: SyncItem, pinned: PinnedRequest, cacheRoot: string): Promise<AcquiredSkillCacheSelector> {
  const operationId = item.cacheOperationId!;
  let inspected;
  try { inspected = await inspectSkillCache({ root: cacheRoot, operationId }); } catch { throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The cached pin of ${item.id} could not be read back.`); }
  if (inspected.status !== 'COMPLETED' || inspected.receipt === null || inspected.activeOwner) throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', `The cached pin of ${item.id} is not complete.`);
  if (!receiptMatches(pinned, inspected.receipt)) throw mismatch(item.id);
  if (item.cache?.status === 'cached' && (inspected.snapshotRevision !== item.cache.snapshotRevision || inspected.receipt.revision !== item.cache.receiptRevision)) throw stale();
  return { root: cacheRoot, operationId, expectedSnapshotRevision: inspected.snapshotRevision, expectedReceiptRevision: inspected.receipt.revision };
}

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
  } else if (!same(closure.source, { kind: 'local', path: 'skills/' + item.id }) || closure.skill !== null) throw mismatch(item.id);
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

/**
 * Phases A and B for the actionable skills of a sync plan, inside the caller's locked run: fetch what needs fetching
 * into the private cache, then build and check every child plan. Neither phase writes in the project.
 */
export async function prepareSkillChildren(plan: SyncPlan, entries: ReadonlyMap<string, Entry>, held: HeldProjectLock, deps: SyncDeps, managed: ManagedPort, rerun: Rerun = 'bowerloom skills sync'): Promise<{ children: Child[]; fetched: string[] }> {
  const dir = plan.project.dir, work = plan.items.filter(isActionable);
  // Phase A: fetch into the private cache. No project write.
  const pins = new Map<string, PinnedRequest>(), sources = new Map<string, ItemSource>(), fetched: string[] = [];
  for (const item of work) {
    const entry = entries.get(item.id);
    if (!entry) throw stale();
    if (entry.source.kind === 'local') { sources.set(item.id, { kind: 'local', path: 'skills/' + item.id }); continue; }
    const pinned = entryRequest(entry as PinnedEntry); pins.set(item.id, pinned);
    if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun);
    if (item.cache?.status === 'needs-fetch') { held.assertHeld(dir); await fetchPin(item, pinned, plan.privateState.cacheRoot, deps); fetched.push(item.id); }
    sources.set(item.id, { kind: 'cache', selector: await selectorFor(item, pinned, plan.privateState.cacheRoot) });
  }
  // Phase B: every child plan, checked against the bindings. No project write.
  const children: Child[] = [];
  for (const item of work) {
    if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun);
    const req = childRequest(plan, item, sources.get(item.id)!);
    let child; try { child = await managed.plan(req, { signal: deps.signal }); } catch (e) { if (deps.signal.aborted) throw interrupted([], work.map(i => i.id), rerun); throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to ${item.id}; nothing was changed.`); }
    children.push({ item, req, plan: checkChild(plan.project.dir, item, pins.get(item.id) ?? null, req, child) });
  }
  return { children, fetched };
}

/**
 * Phase C: applies the children in order, each with a revision planned right before it in this locked run. The
 * person's interrupt is read only here, between children. `ignoreExact` is true when the shared ignore file was in
 * place when the run planned.
 */
export async function applyChildren(children: readonly Child[], held: HeldProjectLock, dir: string, ignoreExact: boolean, managed: ManagedPort, signal: AbortSignal, rerun: Rerun = 'bowerloom skills sync'): Promise<SyncResult['applied']> {
  const applied: SyncResult['applied'] = [], created = new Map<string, Identity>(); let ignoreCreated = ignoreExact;
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
      const { plan, entries } = await observeSync(input);
      if (plan.revision !== revision) throw stale();
      const dir = plan.project.dir, work = plan.items.filter(isActionable);
      if (deps.signal.aborted) throw interrupted([], work.map(i => i.id));
      createPrivateFolders(plan, held, dir);
      const { children, fetched } = await prepareSkillChildren(plan, entries, held, deps, managed);
      const applied = await applyChildren(children, held, dir, plan.managed.ignore === 'exact', managed, deps.signal);
      return {
        format: SYNC_RESULT_FORMAT, planRevision: plan.revision, applied,
        held: plan.items.filter(i => i.action === 'hold').map(i => ({ id: i.id, code: i.hold!.code, next: i.hold!.next })),
        upToDate: plan.items.filter(i => i.state === 'up-to-date' && i.action === 'none').map(i => i.id),
        orphaned: plan.items.filter(i => i.state === 'orphaned').map(i => i.id), fetched, executionAuthorized: false,
      };
    });
  } catch (e) { throw outward(e); }
}
