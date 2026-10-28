/**
 * Apply, removal, and recovery of the portable projection: the journaled run.
 *
 * - Apply and removal plan again under the project lock and refuse STALE_APPROVAL for any other revision.
 * - The pending marker journals every step before the first project write. Each step re-checks the folders above its
 *   path, saves the current bytes, and compares their hash with the planned one immediately before it writes or deletes
 *   (rulings P2, P3). A new file is linked into place, so a file that appeared since the check is never overwritten (P24).
 * - A failure rolls back every step that was written, keeps going past a step it cannot roll back, and refuses
 *   PORTABLE_PARTIAL with the paths left over (P10). After a lost lock it touches nothing more (P11).
 * - After the steps: the empty folders an apply no longer needs, then the receipt, then the cleanup of saved bytes and
 *   the marker (P9, V11). A failure there refuses PORTABLE_PARTIAL with the code of its cause: the files are applied
 *   and the marker stays for recovery. The lock is checked before each of those writes (V7).
 * - The journal lists only the folders a run really created, so a rollback never removes a person's folder (V10).
 * - Recovery finishes an apply whose receipt is written and a removal whose steps all ran (P21), and rolls back any
 *   other run. It can keep a person's version of a changed or deleted path and drop that path from the receipt (P10).
 *
 * The index exports the functions without hooks. The hooks entry points here are for tests (ruling P7).
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { withProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { syncError } from './refusal.js';
import {
  PortableRefusal, byBytes, checkAncestors, folderId, isProjectedDir, isRefusal, makeDir, readProject, refuse, removeEmptyDirs, revisionOf, sameState,
  sha, stateOrUnsafe, sweepTemps, syncDir, writeAbs,
} from './portable-files.js';
import type { FileState, LeftBehind } from './portable-files.js';
import {
  PENDING_FORMAT, PORTABLE_RECEIPT_FORMAT, blob, blobOk, checkPaths, cleanBlobs, ensureState, keepOriginal, keptPath, originalsOf, pendingExists,
  readPending, readReceipt, saveBlob, unlinkRecord, writeRecord,
} from './portable-state.js';
import type { Pending, PortableReceipt, Step } from './portable-state.js';
import { planWithBytes } from './portable.js';
import type { PlannedChange, PortableInput, PortablePlan, PortableReport } from './portable.js';

export const PORTABLE_REMOVAL_FORMAT = 'bowerloom/portable-removal-plan/v1beta2' as const;
export const PORTABLE_RECOVERY_FORMAT = 'bowerloom/portable-recovery-plan/v1beta2' as const;

/** Test hooks. Product code passes nothing. An error with `crash: true` stands for a killed process: nothing more runs. */
export type RunPoint = 'before-steps' | 'after-steps' | 'after-receipt' | 'after-finish' | 'recovery';
export interface PortableHooks {
  readonly afterStep?: (path: string) => void;
  readonly at?: (point: RunPoint) => void;
  /** Runs inside the last check before a file is linked or renamed into place. */
  readonly beforePlace?: (path: string) => void;
  /** Runs between the check of a folder and the unlink of a file in it. */
  readonly beforeUnlink?: (path: string) => void;
  /** Runs between the mkdir of a folder and its chmod. */
  readonly afterMkdir?: (path: string) => void;
  /** Stands in for link(), to reach the fallback of a file system without it. */
  readonly link?: (from: string, to: string) => void;
  /** Runs after the no-link fallback creates a path and before it writes the bytes. */
  readonly afterCreate?: (path: string) => void;
}

export interface PortableApplyResult {
  readonly noop: boolean;
  readonly planRevision: string;
  /** The receipt now in force. Null only for a no-op run of a project that has none. */
  readonly receipt: PortableReceipt | null;
  readonly report: PortableReport;
  /** Folders Bowerloom created that it could not remove, with why. */
  readonly leftBehind: readonly LeftBehind[];
}
export interface PortableRemovalPlan {
  readonly format: typeof PORTABLE_REMOVAL_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly receipt: string;
  readonly changes: readonly PlannedChange[];
  readonly removeDirs: readonly string[];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface PortableRemovalResult {
  readonly planRevision: string;
  readonly restored: readonly string[];
  readonly deleted: readonly string[];
  readonly leftBehind: readonly LeftBehind[];
}
export interface RecoveryInput { readonly projectDir: string; readonly stateDir: string; readonly keep?: readonly string[] }
export interface PortableRecoveryPlan {
  readonly format: typeof PORTABLE_RECOVERY_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  /** The kind of the unfinished run, or null when there is none and the plan only keeps paths. */
  readonly kind: 'apply' | 'remove' | null;
  /**
   * `complete`: the run finished its steps; only the receipt and cleanup remain. `rollback`: each written step is undone.
   * `keep`: no run is unfinished; the named paths keep the person's version and leave the receipt.
   */
  readonly action: 'complete' | 'rollback' | 'keep';
  readonly steps: readonly { readonly path: string; readonly now: FileState | null | 'unsafe'; readonly decision: 'undo' | 'none' | 'keep' }[];
  /** Paths that keep the person's version and leave the receipt. */
  readonly keep: readonly string[];
  /**
   * For each kept path, where its saved original stays: `kept/<hash>` in the state folder, or null when no original was
   * saved or the copy is gone (review item V1).
   */
  readonly keptOriginals: readonly { readonly path: string; readonly original: string | null }[];
  /** What keeping means for the next apply. Null when nothing is kept. */
  readonly notice: string | null;
  readonly revision: string;
}
/** What recovery did: its plan, and the folders it could not remove (review item V14). */
export interface PortableRecoveryResult extends PortableRecoveryPlan { readonly leftBehind: readonly LeftBehind[] }
/** The words of a recovery plan that keeps paths. */
export const KEEP_NOTICE = 'Each kept path leaves the receipt and is targeted again on the next apply, which saves the person\'s version as its original. The earlier original stays in the kept folder of the state folder.';
export interface DriftLine { readonly path: string; readonly reason: 'changed' | 'missing' | 'unsafe'; readonly now: FileState | null; readonly recorded: FileState }

const reportOf = (p: PortablePlan): PortableReport => ({
  loss: p.loss, partial: p.partial, notice: p.notice, deferred: p.deferred, filterLeaks: p.filterLeaks, pendingTrust: p.pendingTrust, ignored: p.ignored, offers: p.offers,
  trust: p.trust, review: p.review, approved: p.approved,
});
const hex = (r: unknown): r is string => typeof r === 'string' && /^[a-f0-9]{64}$/.test(r);
const isCrash = (e: unknown): boolean => (e as { crash?: unknown } | null)?.crash === true;

// ---- the journaled steps -------------------------------------------------------------------------------------------------

interface Ctx { readonly projectDir: string; readonly stateDir: string; readonly held: HeldProjectLock; readonly hooks: PortableHooks }
interface Work { readonly step: Step; readonly bytes: Uint8Array | null }

function live(ctx: Ctx): void { try { ctx.held.assertHeld(ctx.projectDir); } catch { refuse('PORTABLE_LOCK_LOST'); } }
const lockHeld = (ctx: Ctx): boolean => { try { ctx.held.assertHeld(ctx.projectDir); return true; } catch { return false; } };
/** The code of an error, for a message: a short upper-case code, or the error's name. */
const causeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(c) ? c : e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'an unknown error';
};

/**
 * Moves one path from `step.from` to `step.to`. Immediately before it acts, it checks the folders above the path, saves
 * the current bytes, and compares them with `step.from`; a difference stops with PORTABLE_DRIFT and keeps the saved copy.
 * The last check before the link or rename reads the target again (V4). An unlink compares the device and inode of the
 * folder with the value it checked a moment before (V5). `onCommit` runs once the file system holds the new state.
 */
function put(ctx: Ctx, step: Step, bytes: Uint8Array | null, onCommit: () => void): void {
  const { projectDir, stateDir, hooks } = ctx, rel = step.path, abs = join(projectDir, rel);
  const drift = (state: FileState | null | undefined): never => { throw Object.assign(new PortableRefusal('PORTABLE_DRIFT', [rel]), { saved: state?.sha256 ?? null }); };
  const cur = readProject(projectDir, rel);
  if (cur) saveBlob(stateDir, cur.bytes);
  // Ruling P3: a mismatch stops with drift, and the copy just saved stays in the state folder.
  if (!sameState(cur?.state ?? null, step.from)) drift(cur?.state);
  if (bytes === null) {
    if (step.from === null) return;
    checkAncestors(projectDir, rel, true);
    const parent = dirname(abs), checked = folderId(parent, rel);
    hooks.beforeUnlink?.(rel);
    if (folderId(parent, rel) !== checked) refuse('PORTABLE_PATH_UNSAFE', [rel]);
    fs.unlinkSync(abs); onCommit(); syncDir(parent);
    return;
  }
  checkAncestors(projectDir, rel, true);
  const recheck = (): void => {
    checkAncestors(projectDir, rel, true);
    hooks.beforePlace?.(rel);
    const again = readProject(projectDir, rel);
    if (!sameState(again?.state ?? null, step.from)) drift(again?.state);
  };
  writeAbs(abs, bytes, step.to!.mode, { exclusive: step.from === null, recheck, label: rel, onPlaced: onCommit, ...(hooks.link ? { link: hooks.link } : {}), ...(hooks.afterCreate ? { afterCreate: () => hooks.afterCreate!(rel) } : {}) });
}

/**
 * Undoes steps, last first. A step whose path is at its new state goes back to its old state; one at its old state is
 * left; any other is left over. It recreates missing folders through the checked path first. It keeps going past a
 * step it cannot undo and returns every path left over. A lost lock stops it at once. Its callers sweep the writer
 * temporaries of every journaled path, so it sweeps none itself.
 */
function undo(ctx: Ctx, steps: readonly Step[]): string[] {
  const left: string[] = [];
  for (const step of [...steps].reverse()) {
    live(ctx);
    try {
      const now = stateOrUnsafe(ctx.projectDir, step.path);
      if (now !== 'unsafe' && sameState(now, step.from)) continue;
      if (now === 'unsafe' || !sameState(now, step.to)) { left.push(step.path); continue; }
      if (step.from !== null) for (const d of checkAncestors(ctx.projectDir, step.path)) { if (!isProjectedDir(d)) refuse('PORTABLE_PATH_UNSAFE', [d]); makeDir(ctx.projectDir, d); }
      put(ctx, { path: step.path, from: step.to, to: step.from }, step.from === null ? null : blob(ctx.stateDir, step.from, step.path), () => {});
    } catch (e) {
      if (isRefusal(e, 'PORTABLE_LOCK_LOST')) throw e;
      left.push(step.path);
    }
  }
  return left.sort(byBytes);
}

const partial = (detail: string, paths: readonly string[] = []): PortableRefusal => new PortableRefusal('PORTABLE_PARTIAL', paths, [], detail);
/** An error with the folders a rollback left behind (V14). A frozen or foreign value gets a refusal that carries them. */
function withLeft(error: unknown, leftBehind: readonly LeftBehind[]): unknown {
  if (typeof error === 'object' && error !== null && Object.isExtensible(error)) { Object.defineProperty(error, 'leftBehind', { value: leftBehind, enumerable: false, configurable: true }); return error; }
  return error;
}
/** Removes empty folders after checking the lock; with the lock lost, it removes none and reports each (V7). */
function removeDirs(ctx: Ctx, dirs: readonly string[]): LeftBehind[] {
  if (!lockHeld(ctx)) return [...new Set(dirs)].sort(byBytes).map(path => ({ path, reason: 'lock-lost' as const }));
  return removeEmptyDirs(ctx.projectDir, dirs);
}

/**
 * Journals and runs the steps. The journal lists only the folders the run created, each added once it exists (V10).
 * A failure rolls back what was written; see the module comment.
 */
function execute(ctx: Ctx, pending: Pending, work: readonly Work[], planned: readonly string[]): void {
  let journal: Pending = pending;
  writeRecord(ctx.stateDir, 'pending.json', journal);
  ctx.hooks.at?.('before-steps');
  const written: Step[] = [], created: string[] = [];
  try {
    for (const d of planned) {
      live(ctx);
      makeDir(ctx.projectDir, d, ctx.hooks.afterMkdir);
      created.push(d);
      journal = { ...journal, dirs: [...created] };
      writeRecord(ctx.stateDir, 'pending.json', journal);
    }
    for (const w of work) {
      live(ctx);
      put(ctx, w.step, w.bytes, () => { written.push(w.step); });
      ctx.hooks.afterStep?.(w.step.path);
    }
  } catch (error) {
    if (isCrash(error)) throw error;
    if (!lockHeld(ctx)) throw new PortableRefusal('PORTABLE_LOCK_LOST');
    const left = undo(ctx, written);
    for (const s of pending.steps) sweepTemps(ctx.projectDir, s.path);
    const leftBehind = removeDirs(ctx, created);
    if (left.length) throw withLeft(partial(`Rolling back after ${causeOf(error)} left these paths as they are:`, left), leftBehind);
    unlinkRecord(ctx.stateDir, 'pending.json');
    const keep = originalsOf(readReceipt(ctx.stateDir, ctx.projectDir)), saved = (error as { saved?: unknown } | null)?.saved;
    if (typeof saved === 'string') keep.add(saved);
    cleanBlobs(ctx.stateDir, keep);
    throw withLeft(error, leftBehind);
  }
}

/** Runs the phase after the steps, after a lock check. A failure leaves the files applied and the marker in place. */
function after(ctx: Ctx, work: () => void): void {
  live(ctx);
  try { work(); } catch (e) {
    if (isCrash(e) || isRefusal(e, 'PORTABLE_LOCK_LOST')) throw e;
    throw partial(`Every file is applied, but the receipt or the cleanup failed (${causeOf(e)}). The pending marker is kept.`);
  }
}

// ---- apply ---------------------------------------------------------------------------------------------------------------

/**
 * Applies the projection whose revision a person approved. A plan with nothing to do writes nothing, not even the
 * receipt. The result carries the receipt and the whole report (ruling P20).
 */
export async function applyPortable(input: PortableInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableApplyResult> {
  return applyPortableWith(input, revision, signal, {});
}
/** applyPortable with test hooks. Not exported from the package index. */
export async function applyPortableWith(input: PortableInput, revision: string, signal: AbortSignal, hooks: PortableHooks): Promise<PortableApplyResult> {
  if (!hex(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const { plan, bytes: planned } = planWithBytes(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan, ctx: Ctx = { projectDir, stateDir, held, hooks };
    const previous = readReceipt(stateDir, projectDir);
    if (plan.noop) return { noop: true, planRevision: plan.revision, receipt: previous, report: reportOf(plan), leftBehind: [] };
    ensureState(stateDir);
    const work: Work[] = [];
    for (const c of plan.changes) {
      if (c.action === 'unchanged') continue;
      const target = planned.get(c.path);
      if (c.after !== null && target === undefined) throw syncError('STALE_APPROVAL');
      const bytes = c.after !== null ? target! : c.original === null ? null : blob(stateDir, c.original, c.path);
      if (bytes !== null && c.after !== null && sha(bytes) !== c.after.sha256) throw syncError('STALE_APPROVAL');
      work.push({ step: { path: c.path, from: c.before, to: c.after ? { sha256: c.after.sha256, mode: c.after.mode } : c.original }, bytes });
    }
    execute(ctx, { format: PENDING_FORMAT, projectDir, kind: 'apply', planRevision: plan.revision, steps: work.map(w => w.step), dirs: [] }, work, plan.createDirs);
    hooks.at?.('after-steps');
    const files = plan.changes.filter(c => c.after !== null).map(c => ({ path: c.path, ...c.after!, engines: c.engines, original: c.original }));
    let receipt: PortableReceipt | null = null, leftBehind: LeftBehind[] = [];
    after(ctx, () => {
      // Review item V11: the folders no projected file needs go first, so the receipt lists only folders that remain.
      leftBehind = removeDirs(ctx, plan.createdDirs.filter(d => !files.some(f => f.path.startsWith(d + '/'))));
      const removed = new Set(plan.createdDirs.filter(d => !files.some(f => f.path.startsWith(d + '/')) && !leftBehind.some(l => l.path === d)));
      const body = {
        format: PORTABLE_RECEIPT_FORMAT, projectDir, definition: plan.definition, engines: plan.engines, files, sources: plan.sources,
        createdDirs: plan.createdDirs.filter(d => !removed.has(d)), approvals: plan.approved, planRevision: plan.revision,
      };
      receipt = { ...body, revision: revisionOf(body) };
      live(ctx);
      writeRecord(stateDir, 'receipt.json', receipt);
      hooks.at?.('after-receipt');
      cleanBlobs(stateDir, originalsOf(receipt));
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      hooks.at?.('after-finish');
    });
    return { noop: false, planRevision: plan.revision, receipt, report: reportOf(plan), leftBehind };
  });
}

// ---- drift against the receipt (portable spec, section 5.3; ruling P13) --------------------------------------------------

/** Each projected file that differs from its receipt, with why: changed (content or mode), missing, or unsafe. */
export function portableDrift(input: { readonly projectDir: string; readonly stateDir: string }): DriftLine[] {
  checkPaths(input?.projectDir, input?.stateDir);
  const receipt = readReceipt(input.stateDir, input.projectDir);
  if (receipt === null) return [];
  const out: DriftLine[] = [];
  for (const f of receipt.files) {
    const now = stateOrUnsafe(input.projectDir, f.path), recorded = { sha256: f.sha256, mode: f.mode };
    if (now === 'unsafe') out.push({ path: f.path, reason: 'unsafe', now: null, recorded });
    else if (now === null) out.push({ path: f.path, reason: 'missing', now, recorded });
    else if (!sameState(now, f)) out.push({ path: f.path, reason: 'changed', now, recorded });
  }
  return out;
}
/** The receipt of the projection in this state folder, checked against its shape and project, or null. */
export function readPortableReceipt(input: { readonly projectDir: string; readonly stateDir: string }): PortableReceipt | null {
  checkPaths(input?.projectDir, input?.stateDir);
  return readReceipt(input.stateDir, input.projectDir);
}

// ---- removal -------------------------------------------------------------------------------------------------------------

/** Plans the removal: each projected file goes back to the file it replaced, or is deleted. Every saved copy is checked. */
export function planPortableRemoval(input: { readonly projectDir: string; readonly stateDir: string }): PortableRemovalPlan {
  checkPaths(input?.projectDir, input?.stateDir);
  const { projectDir, stateDir } = input;
  if (pendingExists(stateDir)) refuse('PORTABLE_RECOVERY_REQUIRED');
  const receipt = readReceipt(stateDir, projectDir);
  if (receipt === null) return refuse('PORTABLE_NOTHING_PROJECTED');
  const drifted = portableDrift(input);
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted.map(d => `${d.path} (${d.reason})`));
  for (const f of receipt.files) if (f.original) blob(stateDir, f.original, f.path);
  const changes = receipt.files.map((f): PlannedChange => ({
    path: f.path, action: f.original ? 'restore' : 'delete', before: { sha256: f.sha256, mode: f.mode }, after: null, original: f.original, engines: [],
  }));
  const body = { format: PORTABLE_REMOVAL_FORMAT, projectDir, stateDir, receipt: receipt.revision, changes, removeDirs: [...receipt.createdDirs], writesAuthorized: false as const };
  return { ...body, revision: revisionOf(body) };
}

/** Applies the approved removal under the project lock. */
export async function applyPortableRemoval(input: { readonly projectDir: string; readonly stateDir: string }, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableRemovalResult> {
  return applyPortableRemovalWith(input, revision, signal, {});
}
/** applyPortableRemoval with test hooks. Not exported from the package index. */
export async function applyPortableRemovalWith(input: { readonly projectDir: string; readonly stateDir: string }, revision: string, signal: AbortSignal, hooks: PortableHooks): Promise<PortableRemovalResult> {
  if (!hex(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const plan = planPortableRemoval(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan, ctx: Ctx = { projectDir, stateDir, held, hooks };
    const work: Work[] = plan.changes.map(c => ({ step: { path: c.path, from: c.before, to: c.original }, bytes: c.original === null ? null : blob(stateDir, c.original, c.path) }));
    // The marker of a removal holds the folders to remove, so a removal finished by recovery removes them too.
    execute(ctx, { format: PENDING_FORMAT, projectDir, kind: 'remove', planRevision: plan.revision, steps: work.map(w => w.step), dirs: plan.removeDirs }, work, []);
    hooks.at?.('after-steps');
    after(ctx, () => {
      unlinkRecord(stateDir, 'receipt.json');
      hooks.at?.('after-receipt');
      live(ctx);
      cleanBlobs(stateDir, new Set());
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      hooks.at?.('after-finish');
    });
    const leftBehind = removeDirs(ctx, plan.removeDirs);
    return { planRevision: plan.revision, restored: plan.changes.filter(c => c.action === 'restore').map(c => c.path), deleted: plan.changes.filter(c => c.action === 'delete').map(c => c.path), leftBehind };
  });
}

// ---- recovery ------------------------------------------------------------------------------------------------------------

/**
 * Plans the recovery. It first sweeps the writer temporaries beside each journaled path, so a link left by a kill does
 * not read as a second link (V6). With an unfinished run: an apply whose receipt names its plan, or a removal whose
 * receipt is gone or whose steps all ran, is complete; any other run is rolled back, and every saved copy a rollback
 * needs is checked (V2). A path that is neither at its old nor its new state, or whose saved copy is gone, refuses
 * unless `keep` names it. With no unfinished run, `keep` drops changed or missing paths from the receipt; their saved
 * originals stay in the kept folder (V1).
 */
export function planPortableRecovery(input: RecoveryInput): PortableRecoveryPlan {
  checkPaths(input?.projectDir, input?.stateDir);
  const { projectDir, stateDir } = input;
  const keepWanted = input.keep ?? [];
  if (!Array.isArray(keepWanted) || keepWanted.some(k => typeof k !== 'string')) refuse('PORTABLE_USAGE');
  const pending = readPending(stateDir, projectDir);
  const receipt = readReceipt(stateDir, projectDir);
  const originalOf = (path: string, fallback: FileState | null): string | null => {
    const listed = receipt?.files.find(f => f.path === path);
    const original = listed ? listed.original : fallback;
    return original !== null && blobOk(stateDir, original) ? keptPath(stateDir, original) : null;
  };
  const body = (kind: PortableRecoveryPlan['kind'], action: PortableRecoveryPlan['action'], steps: PortableRecoveryPlan['steps'], keep: string[], from: ReadonlyMap<string, FileState | null>) => {
    const sorted = keep.sort(byBytes);
    const b = {
      format: PORTABLE_RECOVERY_FORMAT, projectDir, stateDir, kind, action, steps, keep: sorted,
      keptOriginals: sorted.map(path => ({ path, original: originalOf(path, from.get(path) ?? null) })), notice: sorted.length ? KEEP_NOTICE : null,
    };
    return { ...b, revision: revisionOf(b) };
  };
  if (pending === null) {
    if (keepWanted.length === 0) return refuse('PORTABLE_RECOVER_NOTHING');
    const drift = new Set(portableDrift(input).map(d => d.path));
    const bad = keepWanted.filter(k => !drift.has(k));
    if (bad.length || receipt === null) refuse('PORTABLE_USAGE', bad);
    return body(null, 'keep', [], [...new Set(keepWanted)], new Map());
  }
  for (const s of pending.steps) sweepTemps(projectDir, s.path);
  const states = pending.steps.map(s => ({ step: s, now: stateOrUnsafe(projectDir, s.path) }));
  const at = (now: FileState | null | 'unsafe', want: FileState | null): boolean => now !== 'unsafe' && sameState(now, want);
  const complete = pending.kind === 'apply' ? receipt?.planRevision === pending.planRevision : receipt === null || states.every(x => at(x.now, x.step.to));
  if (complete) {
    if (keepWanted.length) refuse('PORTABLE_USAGE', keepWanted);
    return body(pending.kind, 'complete', states.map(x => ({ path: x.step.path, now: x.now, decision: 'none' as const })), [], new Map());
  }
  const drifted: string[] = [], lost: string[] = [], keep: string[] = [];
  const steps = states.map(({ step, now }) => {
    if (at(now, step.from)) return { path: step.path, now, decision: 'none' as const };
    if (at(now, step.to) && (step.from === null || blobOk(stateDir, step.from))) return { path: step.path, now, decision: 'undo' as const };
    if (keepWanted.includes(step.path)) { keep.push(step.path); return { path: step.path, now, decision: 'keep' as const }; }
    if (at(now, step.to)) lost.push(step.path);
    else drifted.push(`${step.path} (${now === 'unsafe' ? 'unsafe' : now === null ? 'missing' : 'changed'})`);
    return { path: step.path, now, decision: 'none' as const };
  });
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted);
  if (lost.length) throw new PortableRefusal('PORTABLE_STATE_INVALID', lost, [], 'The saved copy needed to roll these paths back is gone or changed. Name each in keep to leave it as it is:');
  const unknown = keepWanted.filter(k => !keep.includes(k));
  if (unknown.length) refuse('PORTABLE_USAGE', unknown);
  return body(pending.kind, 'rollback', steps, keep, new Map(pending.steps.map(s => [s.path, s.from])));
}

/** Drops paths from the receipt: the person's version stays. Its saved original moves to the kept folder (V1). */
function dropFromReceipt(stateDir: string, receipt: PortableReceipt | null, paths: readonly string[]): PortableReceipt | null {
  if (receipt === null || !receipt.files.some(f => paths.includes(f.path))) return receipt;
  const { revision: _r, ...rest } = receipt;
  const body = { ...rest, files: receipt.files.filter(f => !paths.includes(f.path)) };
  const next: PortableReceipt = { ...body, revision: revisionOf(body) };
  writeRecord(stateDir, 'receipt.json', next);
  return next;
}

/** Applies the approved recovery under the project lock. */
export async function applyPortableRecovery(input: RecoveryInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableRecoveryResult> {
  return applyPortableRecoveryWith(input, revision, signal, {});
}
/** applyPortableRecovery with test hooks. Not exported from the package index. */
export async function applyPortableRecoveryWith(input: RecoveryInput, revision: string, signal: AbortSignal, hooks: PortableHooks): Promise<PortableRecoveryResult> {
  if (!hex(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const plan = planPortableRecovery(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan, ctx: Ctx = { projectDir, stateDir, held, hooks };
    hooks.at?.('recovery');
    live(ctx);
    const pending = readPending(stateDir, projectDir);
    let receipt = readReceipt(stateDir, projectDir);
    // Review item V1: each kept original is copied to the kept folder before any cleanup.
    for (const k of plan.keptOriginals) if (k.original !== null) {
      const listed = receipt?.files.find(f => f.path === k.path)?.original ?? pending?.steps.find(s => s.path === k.path)?.from ?? null;
      if (listed) keepOriginal(stateDir, listed);
    }
    if (plan.action === 'keep') {
      live(ctx);
      receipt = dropFromReceipt(stateDir, receipt, plan.keep);
      cleanBlobs(stateDir, originalsOf(receipt));
      return { ...plan, leftBehind: [] };
    }
    const p = pending!;
    if (plan.action === 'complete') {
      live(ctx);
      if (p.kind === 'remove') { unlinkRecord(stateDir, 'receipt.json'); receipt = null; }
      cleanBlobs(stateDir, originalsOf(receipt));
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      const r = receipt as PortableReceipt | null;
      const leftBehind = removeDirs(ctx, p.kind === 'remove' ? p.dirs : (r?.createdDirs ?? []).filter(d => !r!.files.some(f => f.path.startsWith(d + '/'))));
      return { ...plan, leftBehind };
    }
    const undoSteps = plan.steps.filter(s => s.decision === 'undo').map(s => p.steps.find(x => x.path === s.path)!);
    // The plan, run again above, already swept the writer temporaries of every journaled path.
    const left = undo(ctx, undoSteps);
    const leftBehind = p.kind === 'apply' ? removeDirs(ctx, p.dirs) : [];
    if (left.length) throw withLeft(partial('Recovery could not roll back these paths:', left), leftBehind);
    live(ctx);
    receipt = dropFromReceipt(stateDir, receipt, plan.keep);
    cleanBlobs(stateDir, originalsOf(receipt));
    unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
    return { ...plan, leftBehind };
  });
}
