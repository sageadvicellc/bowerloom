/**
 * Apply, removal, and recovery of the portable projection: the journaled run.
 *
 * - Apply and removal plan again under the project lock and refuse STALE_APPROVAL for any other revision.
 * - The pending marker journals every step before the first project write. Each step re-checks the folders above its
 *   path, saves the current bytes, and compares their hash with the planned one immediately before it writes or deletes
 *   (rulings P2, P3). A new file is linked into place, so a file that appeared since the check is never overwritten (P24).
 * - A failure rolls back every step that was written, keeps going past a step it cannot roll back, and refuses
 *   PORTABLE_PARTIAL with the paths left over (P10). After a lost lock it touches nothing more (P11).
 * - After the steps: the receipt, then the cleanup of saved bytes and the marker, then empty folders (P9). A failure
 *   there refuses PORTABLE_PARTIAL: the files are applied and the marker stays for recovery.
 * - Recovery finishes an apply whose receipt is written and a removal whose steps all ran (P21), and rolls back any
 *   other run. It can keep a person's version of a changed or deleted path and drop that path from the receipt (P10).
 *
 * The index exports the functions without hooks. The hooks entry points here are for tests (ruling P7).
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { withProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { syncError } from './refusal.js';
import {
  PortableRefusal, byBytes, checkAncestors, isProjectedDir, isRefusal, makeDir, readProject, refuse, removeEmptyDirs, revisionOf, sameState, sha,
  stateOrUnsafe, sweepTemps, syncDir, writeAbs,
} from './portable-files.js';
import type { FileState, LeftBehind } from './portable-files.js';
import {
  PENDING_FORMAT, PORTABLE_RECEIPT_FORMAT, blob, checkPaths, cleanBlobs, ensureState, originalsOf, pendingExists, readPending, readReceipt, saveBlob,
  unlinkRecord, writeRecord,
} from './portable-state.js';
import type { Pending, PortableReceipt, Step } from './portable-state.js';
import { FOLLOW_TEXT, loadForProjection, planPortable } from './portable.js';
import type { PlannedChange, PortableInput, PortablePlan, PortableReport } from './portable.js';
import type { Definition } from '../../harness-definition/src/index.js';

export const PORTABLE_REMOVAL_FORMAT = 'bowerloom/portable-removal-plan/v1beta2' as const;
export const PORTABLE_RECOVERY_FORMAT = 'bowerloom/portable-recovery-plan/v1beta2' as const;

/** Test hooks. Product code passes nothing. An error with `crash: true` stands for a killed process: nothing more runs. */
export type RunPoint = 'before-steps' | 'after-steps' | 'after-receipt' | 'after-finish';
export interface PortableHooks { readonly afterStep?: (path: string) => void; readonly at?: (point: RunPoint) => void }

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
  readonly revision: string;
}
export interface DriftLine { readonly path: string; readonly reason: 'changed' | 'missing' | 'unsafe'; readonly now: FileState | null; readonly recorded: FileState }

const reportOf = (p: PortablePlan): PortableReport => ({
  loss: p.loss, partial: p.partial, notice: p.notice, deferred: p.deferred, filterLeaks: p.filterLeaks, pendingTrust: p.pendingTrust, ignored: p.ignored, offers: p.offers,
});
const hex = (r: unknown): r is string => typeof r === 'string' && /^[a-f0-9]{64}$/.test(r);
const isCrash = (e: unknown): boolean => (e as { crash?: unknown } | null)?.crash === true;

// ---- the journaled steps -------------------------------------------------------------------------------------------------

interface Ctx { readonly projectDir: string; readonly stateDir: string; readonly held: HeldProjectLock; readonly hooks: PortableHooks }
interface Work { readonly step: Step; readonly bytes: Uint8Array | null }

function live(ctx: Ctx): void { try { ctx.held.assertHeld(ctx.projectDir); } catch { refuse('PORTABLE_LOCK_LOST'); } }
const lockHeld = (ctx: Ctx): boolean => { try { ctx.held.assertHeld(ctx.projectDir); return true; } catch { return false; } };

/**
 * Moves one path from `step.from` to `step.to`. Immediately before it acts, it checks the folders above the path, saves
 * the current bytes, and compares them with `step.from`; a difference stops with PORTABLE_DRIFT and keeps the saved copy.
 * `onCommit` runs once the file system holds the new state.
 */
function put(ctx: Ctx, step: Step, bytes: Uint8Array | null, onCommit: () => void): void {
  const { projectDir, stateDir } = ctx, rel = step.path, abs = join(projectDir, rel);
  const cur = readProject(projectDir, rel);
  if (cur) saveBlob(stateDir, cur.bytes);
  // Ruling P3: a mismatch stops with drift, and the copy just saved stays in the state folder.
  if (!sameState(cur?.state ?? null, step.from)) throw Object.assign(new PortableRefusal('PORTABLE_DRIFT', [rel]), { saved: cur?.state.sha256 ?? null });
  if (bytes === null) {
    if (step.from === null) return;
    checkAncestors(projectDir, rel, true);
    fs.unlinkSync(abs); onCommit(); syncDir(join(abs, '..'));
    return;
  }
  checkAncestors(projectDir, rel, true);
  writeAbs(abs, bytes, step.to!.mode, step.from === null, () => checkAncestors(projectDir, rel, true), rel, onCommit);
}

/**
 * Undoes steps, last first. A step whose path is at its new state goes back to its old state; one at its old state is
 * left; any other is left over. It recreates missing folders through the checked path first. It keeps going past a
 * step it cannot undo and returns every path left over. A lost lock stops it at once.
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
      sweepTemps(ctx.projectDir, step.path);
      put(ctx, { path: step.path, from: step.to, to: step.from }, step.from === null ? null : blob(ctx.stateDir, step.from, step.path), () => {});
    } catch (e) {
      if (isRefusal(e, 'PORTABLE_LOCK_LOST')) throw e;
      left.push(step.path);
    }
  }
  return left.sort(byBytes);
}

const partial = (detail: string, paths: readonly string[] = []): PortableRefusal => new PortableRefusal('PORTABLE_PARTIAL', paths, [], detail);

/** Journals and runs the steps. A failure rolls back what was written; see the module comment. */
function execute(ctx: Ctx, pending: Pending, work: readonly Work[]): void {
  writeRecord(ctx.stateDir, 'pending.json', pending);
  ctx.hooks.at?.('before-steps');
  const written: Step[] = [];
  try {
    for (const d of pending.kind === 'apply' ? pending.dirs : []) { live(ctx); makeDir(ctx.projectDir, d); }
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
    if (pending.kind === 'apply') removeEmptyDirs(ctx.projectDir, pending.dirs);
    if (left.length) throw partial(`Rolling back after ${error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'a failure'} left these paths as they are:`, left);
    unlinkRecord(ctx.stateDir, 'pending.json');
    const keep = originalsOf(readReceipt(ctx.stateDir, ctx.projectDir)), saved = (error as { saved?: unknown } | null)?.saved;
    if (typeof saved === 'string') keep.add(saved);
    cleanBlobs(ctx.stateDir, keep);
    throw error;
  }
}

/** Runs the phase after the steps. A failure there leaves the files applied and the marker in place. */
function after(ctx: Ctx, work: () => void): void {
  try { work(); } catch (e) {
    if (isCrash(e)) throw e;
    throw partial('Every file is applied, but the receipt or the cleanup failed. The pending marker is kept.');
  }
}

// ---- apply ---------------------------------------------------------------------------------------------------------------

/** The bytes a projected path gets: `AGENTS.md`, `CLAUDE.md`, or a file of a skill folder. */
function bytesFor(def: Definition, path: string): Uint8Array {
  if (path === 'AGENTS.md') return Buffer.from(def.instructions ?? '');
  if (path === 'CLAUDE.md') return Buffer.from(FOLLOW_TEXT);
  const m = /^\.(?:claude|agents)\/skills\/([^/]+)\/(.+)$/.exec(path);
  const f = m && def.files.find(x => x.path === `skills/${m[1]}/${m[2]}`);
  if (!f) throw syncError('STALE_APPROVAL');
  return f.bytes;
}

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
    const plan = planPortable(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan, ctx: Ctx = { projectDir, stateDir, held, hooks };
    const previous = readReceipt(stateDir, projectDir);
    if (plan.noop) return { noop: true, planRevision: plan.revision, receipt: previous, report: reportOf(plan), leftBehind: [] };
    ensureState(stateDir);
    const def = loadForProjection(input.definitionFolder);
    const work: Work[] = [];
    for (const c of plan.changes) {
      if (c.action === 'unchanged') continue;
      const bytes = c.after !== null ? bytesFor(def, c.path) : c.original === null ? null : blob(stateDir, c.original, c.path);
      if (bytes !== null && c.after !== null && sha(bytes) !== c.after.sha256) throw syncError('STALE_APPROVAL');
      work.push({ step: { path: c.path, from: c.before, to: c.after ? { sha256: c.after.sha256, mode: c.after.mode } : c.original }, bytes });
    }
    execute(ctx, { format: PENDING_FORMAT, projectDir, kind: 'apply', planRevision: plan.revision, steps: work.map(w => w.step), dirs: plan.createDirs }, work);
    hooks.at?.('after-steps');
    const files = plan.changes.filter(c => c.after !== null).map(c => ({ path: c.path, ...c.after!, engines: c.engines, original: c.original }));
    const body = {
      format: PORTABLE_RECEIPT_FORMAT, projectDir, definition: plan.definition, engines: plan.engines, files, sources: plan.sources,
      createdDirs: plan.createdDirs, planRevision: plan.revision,
    };
    const receipt: PortableReceipt = { ...body, revision: revisionOf(body) };
    after(ctx, () => {
      writeRecord(stateDir, 'receipt.json', receipt);
      hooks.at?.('after-receipt');
      cleanBlobs(stateDir, originalsOf(receipt));
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      hooks.at?.('after-finish');
    });
    const leftBehind = removeEmptyDirs(projectDir, receipt.createdDirs.filter(d => !files.some(f => f.path.startsWith(d + '/'))));
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
    execute(ctx, { format: PENDING_FORMAT, projectDir, kind: 'remove', planRevision: plan.revision, steps: work.map(w => w.step), dirs: plan.removeDirs }, work);
    hooks.at?.('after-steps');
    after(ctx, () => {
      unlinkRecord(stateDir, 'receipt.json');
      hooks.at?.('after-receipt');
      cleanBlobs(stateDir, new Set());
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      hooks.at?.('after-finish');
    });
    const leftBehind = removeEmptyDirs(projectDir, plan.removeDirs);
    return { planRevision: plan.revision, restored: plan.changes.filter(c => c.action === 'restore').map(c => c.path), deleted: plan.changes.filter(c => c.action === 'delete').map(c => c.path), leftBehind };
  });
}

// ---- recovery ------------------------------------------------------------------------------------------------------------

/**
 * Plans the recovery. With an unfinished run: an apply whose receipt names its plan, or a removal whose receipt is gone
 * or whose steps all ran, is complete; any other run is rolled back. A path that is neither at its old nor its new state
 * refuses PORTABLE_DRIFT unless `keep` names it. With no unfinished run, `keep` drops changed or missing paths from the
 * receipt, so the person's version stays and removal leaves it alone.
 */
export function planPortableRecovery(input: RecoveryInput): PortableRecoveryPlan {
  checkPaths(input?.projectDir, input?.stateDir);
  const { projectDir, stateDir } = input;
  const keepWanted = input.keep ?? [];
  if (!Array.isArray(keepWanted) || keepWanted.some(k => typeof k !== 'string')) refuse('PORTABLE_USAGE');
  const pending = readPending(stateDir, projectDir);
  const receipt = readReceipt(stateDir, projectDir);
  const body = (kind: PortableRecoveryPlan['kind'], action: PortableRecoveryPlan['action'], steps: PortableRecoveryPlan['steps'], keep: string[]) => {
    const b = { format: PORTABLE_RECOVERY_FORMAT, projectDir, stateDir, kind, action, steps, keep: keep.sort(byBytes) };
    return { ...b, revision: revisionOf(b) };
  };
  if (pending === null) {
    if (keepWanted.length === 0) return refuse('PORTABLE_RECOVER_NOTHING');
    const drift = new Set(portableDrift(input).map(d => d.path));
    const bad = keepWanted.filter(k => !drift.has(k));
    if (bad.length || receipt === null) refuse('PORTABLE_USAGE', bad);
    return body(null, 'keep', [], [...new Set(keepWanted)]);
  }
  const states = pending.steps.map(s => ({ step: s, now: stateOrUnsafe(projectDir, s.path) }));
  const at = (now: FileState | null | 'unsafe', want: FileState | null): boolean => now !== 'unsafe' && sameState(now, want);
  const complete = pending.kind === 'apply' ? receipt?.planRevision === pending.planRevision : receipt === null || states.every(x => at(x.now, x.step.to));
  if (complete) {
    if (keepWanted.length) refuse('PORTABLE_USAGE', keepWanted);
    return body(pending.kind, 'complete', states.map(x => ({ path: x.step.path, now: x.now, decision: 'none' as const })), []);
  }
  const drifted: string[] = [], keep: string[] = [];
  const steps = states.map(({ step, now }) => {
    if (at(now, step.from)) return { path: step.path, now, decision: 'none' as const };
    if (at(now, step.to)) return { path: step.path, now, decision: 'undo' as const };
    if (keepWanted.includes(step.path)) { keep.push(step.path); return { path: step.path, now, decision: 'keep' as const }; }
    drifted.push(`${step.path} (${now === 'unsafe' ? 'unsafe' : now === null ? 'missing' : 'changed'})`);
    return { path: step.path, now, decision: 'none' as const };
  });
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted);
  const unknown = keepWanted.filter(k => !keep.includes(k));
  if (unknown.length) refuse('PORTABLE_USAGE', unknown);
  return body(pending.kind, 'rollback', steps, keep);
}

/** Drops paths from the receipt: the person's version stays, and its saved original goes. */
function dropFromReceipt(stateDir: string, receipt: PortableReceipt | null, paths: readonly string[]): PortableReceipt | null {
  if (receipt === null || !receipt.files.some(f => paths.includes(f.path))) return receipt;
  const { revision: _r, ...rest } = receipt;
  const body = { ...rest, files: receipt.files.filter(f => !paths.includes(f.path)) };
  const next: PortableReceipt = { ...body, revision: revisionOf(body) };
  writeRecord(stateDir, 'receipt.json', next);
  return next;
}

/** Applies the approved recovery under the project lock. */
export async function applyPortableRecovery(input: RecoveryInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableRecoveryPlan> {
  if (!hex(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const plan = planPortableRecovery(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan, ctx: Ctx = { projectDir, stateDir, held, hooks: {} };
    const pending = readPending(stateDir, projectDir);
    let receipt = readReceipt(stateDir, projectDir);
    if (plan.action === 'keep') {
      receipt = dropFromReceipt(stateDir, receipt, plan.keep);
      cleanBlobs(stateDir, originalsOf(receipt));
      return plan;
    }
    const p = pending!;
    for (const s of p.steps) sweepTemps(projectDir, s.path);
    if (plan.action === 'complete') {
      if (p.kind === 'remove') { unlinkRecord(stateDir, 'receipt.json'); receipt = null; }
      cleanBlobs(stateDir, originalsOf(receipt));
      unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
      removeEmptyDirs(projectDir, p.kind === 'remove' ? p.dirs : (receipt?.createdDirs ?? []).filter(d => !receipt!.files.some(f => f.path.startsWith(d + '/'))));
      return plan;
    }
    const undoSteps = plan.steps.filter(s => s.decision === 'undo').map(s => p.steps.find(x => x.path === s.path)!);
    const left = undo(ctx, undoSteps);
    if (left.length) throw partial('Recovery could not roll back these paths:', left);
    if (p.kind === 'apply') removeEmptyDirs(projectDir, p.dirs);
    receipt = dropFromReceipt(stateDir, receipt, plan.keep);
    cleanBlobs(stateDir, originalsOf(receipt));
    unlinkRecord(stateDir, 'pending.json'); syncDir(stateDir);
    return plan;
  });
}
