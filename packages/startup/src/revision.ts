import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { lockSlot, lockServer, slotRefusal, slotStillNames } from '../../project-context/src/index.js';
import type { LockSlot } from '../../project-context/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { scaffold, TEAM_PATH, TEMPLATE_VERSION } from './scaffold.js';
import { inspectStartup, StartupError, STARTUP_FORMAT, startupInternals as io } from './index.js';
import type { StartupBrief, StartupPlan, StartupReceipt, StartupInspection, DirectoryIdentity } from './index.js';

export interface RevisionInput { targetDir: string; brief: StartupBrief }
export interface StartupRevisionPlan {
  format: 'bowerloom/startup-revision-plan/v1beta1' | 'bowerloom/startup-revision-plan/v1beta2';
  operationBinding?: { parent: DirectoryIdentity; target: DirectoryIdentity; sourceBowerloom: DirectoryIdentity }; targetDir: string; fromRevision: string; toRevision: string;
  beforeReceiptSha256: string; before: StartupReceipt; after: StartupPlan; revision: string; executionAuthorized: false; runtimeReady: false;
}
export interface StartupRevisionRecovery {
  format: 'bowerloom/startup-revision-recovery/v1beta1' | 'bowerloom/startup-revision-recovery/v1beta2'; state: 'committed' | 'rolled-back'; revision: string;
  installedRevision: string | null; inspection: StartupInspection;
}
const MARKER = '.bowerloom-revision.json', RECEIPT = 'installation-receipt.json';
function record(value: unknown, required: string[]): asserts value is Record<string, unknown> {
  (io.record as (value: unknown, required: string[]) => void)(value, required);
}
const LIMIT = 4 * 1024 * 1024;
const fail = (code: string): never => { throw new StartupError(code); };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const rootPath = (target: string) => join(target, '.bowerloom');
const historyPath = (target: string, revision: string) => join(target, `.bowerloom-revision-${revision}`);
const present = (path: string): boolean => { try { lstatSync(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
function syncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function write(path: string, bytes: string): void {
  io.ancestors(dirname(path));
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}
function directory(path: string): DirectoryIdentity {
  io.ancestors(path); const id = io.identity(path); io.ownedDirectory(id);
  if ((id.mode & 0o077) !== 0) fail('REVISION_PRIVATE_DIRECTORY_REQUIRED');
  return id;
}
function move(from: string, to: string): void {
  io.ancestors(dirname(from)); io.ancestors(dirname(to)); if (present(to)) fail('REVISION_DESTINATION_EXISTS');
  renameSync(from, to); syncDirectory(dirname(from)); if (dirname(from) !== dirname(to)) syncDirectory(dirname(to));
}
/** A kernel-owned local port, keyed on the target folder's device and inode (`lockSlot`), excludes cooperating writers and releases on process death.
 * A collision refuses work. No protocol, PID adoption, remote interface or daemon is provided. */
async function withLock<T>(target: string, work: () => Promise<T>): Promise<T> {
  let slot: LockSlot; try { slot = lockSlot(target); } catch { throw new StartupError('REVISION_LOCK_UNAVAILABLE'); }
  const server = lockServer(slot);
  const code = await new Promise<string | undefined>(resolve => {
    server.once('error', error => resolve((error as NodeJS.ErrnoException).code ?? 'UNKNOWN'));
    server.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, () => resolve(undefined));
  });
  // This project's own lock (its banner) stays REVISION_LOCK_UNAVAILABLE; anything else on the slot is a collision.
  if (code !== undefined) {
    if (code === 'EADDRINUSE' && await slotRefusal(slot) === 'collision') throw Object.assign(new StartupError('REVISION_LOCK_SLOT_COLLISION'), { message: `REVISION_LOCK_SLOT_COLLISION (local port ${slot.port})`, port: slot.port });
    throw new StartupError('REVISION_LOCK_UNAVAILABLE');
  }
  // A folder replaced between the key and the bind has another slot: this port locks nothing. Release and refuse.
  if (!slotStillNames(target, slot)) { await new Promise<void>(resolve => server.close(() => resolve())); throw new StartupError('REVISION_LOCK_UNAVAILABLE'); }
  try { return await work(); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const v2 = (plan: StartupRevisionPlan): boolean => plan.format === 'bowerloom/startup-revision-plan/v1beta2';
const sourceIdentity = (plan: StartupRevisionPlan): DirectoryIdentity => v2(plan) ? plan.operationBinding!.sourceBowerloom : plan.before.installedBowerloomIdentity;
const recoveryFormat = (plan: StartupRevisionPlan) => v2(plan) ? 'bowerloom/startup-revision-recovery/v1beta2' as const : 'bowerloom/startup-revision-recovery/v1beta1' as const;
const resultBody = (plan: StartupRevisionPlan, state: 'committed' | 'rolled-back') => ({ ...(v2(plan) ? { format: 'bowerloom/startup-revision-result/v1beta2' } : {}), revision: plan.revision, state });
function targetIdentity(plan: StartupRevisionPlan): void {
  io.ancestors(plan.targetDir);
  const target = v2(plan) ? plan.operationBinding!.target : plan.before.installedTargetIdentity;
  const parent = v2(plan) ? plan.operationBinding!.parent : plan.after.binding.parent;
  if (!io.same(io.identity(plan.targetDir), target) || !io.same(io.identity(dirname(plan.targetDir)), parent)) fail('REVISION_BINDING_CHANGED');
}
function moveOwned(plan: StartupRevisionPlan, from: string, to: string, expected: DirectoryIdentity): void {
  if (v2(plan)) {
    targetIdentity(plan);
    if (!io.same(directory(from), expected)) fail('REVISION_BINDING_CHANGED');
  }
  move(from, to);
}
function nextPlan(target: string, brief: StartupBrief, before: StartupReceipt, beforeHash: string, recordedBinding?: StartupPlan['binding']): StartupPlan {
  const input = io.normalize({ mode: 'existing', targetDir: target, brief });
  const binding = recordedBinding ?? { parent: io.identity(dirname(target)), target: io.identity(target) };
  io.ownedDirectory(binding.parent); io.ownedDirectory(binding.target!);
  // Legacy history never selects the current host's first-install default.
  if (before.format === 'bowerloom/startup-receipt/v1alpha1') return io.legacyPlan(input, binding);
  return io.v2Plan(input, binding, { predecessorReceiptSha256: beforeHash, predecessorPolicy: before.plan.installationIdentityPolicy,
    predecessorPlanRevision: before.plan.revision, retainedTargetBaseline: before.installedTargetIdentity });
}
function markerAbsent(target: string): void {
  if (io.names(target).some(name => name.normalize('NFC').toLowerCase() === MARKER)) fail('REVISION_PENDING');
}
export async function planStartupRevision(input: RevisionInput): Promise<StartupRevisionPlan> {
  record(input, ['targetDir', 'brief']); const target = io.canonicalTarget(input.targetDir); io.ancestors(target); markerAbsent(target);
  const status = await inspectStartup(target); if (!status.specReady) fail('REVISION_DRIFT');
  const bytes = io.readManaged(join(rootPath(target), RECEIPT), 1024 * 1024), before = io.receiptValue(bytes);
  const after = nextPlan(target, input.brief, before, io.hash(bytes));
  const body = { format: before.format === 'bowerloom/startup-receipt/v1beta2' ? 'bowerloom/startup-revision-plan/v1beta2' as const : 'bowerloom/startup-revision-plan/v1beta1' as const,
    ...(before.format === 'bowerloom/startup-receipt/v1beta2' ? { operationBinding: { parent: after.binding.parent, target: after.binding.target!, sourceBowerloom: directory(rootPath(target)) } } : {}), targetDir: target, fromRevision: before.plan.revision,
    toRevision: after.revision, executionAuthorized: false as const, runtimeReady: false as const, beforeReceiptSha256: io.hash(bytes), before, after };
  const plan = { ...body, revision: io.hash(canonicalJson(body)) };
  targetIdentity(plan); await tree(rootPath(target), before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
  if (present(historyPath(target, plan.revision))) fail('REVISION_HISTORY_EXISTS');
  markerAbsent(target); if (v2(plan)) targetIdentity(plan); return plan;
}
/** Verify exact managed inventory, including directories, and reject additions rather than moving them. */
async function tree(path: string, receipt: StartupReceipt, receiptDigest: string, partial = false, exactIdentity: DirectoryIdentity = receipt.installedBowerloomIdentity): Promise<void> {
  if (!io.same(directory(path), exactIdentity) || !io.matchesInstalled(receipt, 'installedBowerloomIdentity', exactIdentity)) fail('REVISION_BINDING_CHANGED');
  const expected = new Map(receipt.plan.files.map(file => [file.path, { text: file.text, digest: file.sha256 }]));
  expected.set(RECEIPT, { text: '', digest: receiptDigest });
  let count = 0;
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(path, relative), { withFileTypes: true })) {
      if (++count > 256) fail('REVISION_INVENTORY_LIMIT');
      const name = relative ? `${relative}/${entry.name}` : entry.name, full = join(path, name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        directory(full); if (![...expected.keys()].some(key => key.startsWith(name + '/'))) fail('REVISION_DRIFT'); walk(name);
      } else {
        const item = expected.get(name); if (!item || io.hash(io.readManaged(full, 1024 * 1024)) !== item.digest) fail('REVISION_DRIFT');
      }
    }
  };
  walk('');
  if (!partial) {
    for (const [name, item] of expected) if (io.hash(io.readManaged(join(path, name), 1024 * 1024)) !== item.digest) fail('REVISION_DRIFT');
    if (!io.same(await compileCrew(join(path, TEAM_PATH)), receipt.plan.compiled)) fail('COMPILED_PLAN_CHANGED');
  }
  if (receipt.format === 'bowerloom/startup-receipt/v1beta2' && !io.same(directory(path), exactIdentity)) fail('REVISION_BINDING_CHANGED');
}
function journal(target: string, revision: string, archived = false): StartupRevisionPlan {
  if (!sha(revision)) fail('EXACT_APPROVAL_REQUIRED');
  const path = archived ? join(historyPath(target, revision), 'journal.json') : join(target, MARKER);
  const raw = JSON.parse(io.readManaged(path, LIMIT).toString('utf8')) as unknown;
  record(raw, ['format', 'plan']);
  const modern = raw.format === 'bowerloom/startup-revision-journal/v1beta2';
  if (!modern && raw.format !== 'bowerloom/startup-revision-journal/v1beta1') fail('REVISION_JOURNAL_INVALID');
  record(raw.plan, ['format', 'targetDir', 'fromRevision', 'toRevision', 'beforeReceiptSha256', 'before', 'after', 'revision', 'executionAuthorized', 'runtimeReady', ...(modern ? ['operationBinding'] : [])]);
  const plan = raw.plan as unknown as StartupRevisionPlan, { revision: recorded, ...body } = plan;
  if (plan.executionAuthorized !== false || plan.runtimeReady !== false || plan.format !== (modern ? 'bowerloom/startup-revision-plan/v1beta2' : 'bowerloom/startup-revision-plan/v1beta1') || plan.targetDir !== target || recorded !== revision
    || io.hash(canonicalJson(body)) !== revision || !sha(plan.beforeReceiptSha256)) fail('REVISION_JOURNAL_INVALID');
  const before = io.receiptValue(Buffer.from(io.json(plan.before))), after = io.validatedPlan(plan.after);
  if (modern !== (before.format === 'bowerloom/startup-receipt/v1beta2') || modern !== (after.format === 'bowerloom/startup-plan/v1beta2')) fail('REVISION_JOURNAL_INVALID');
  if (modern) {
    record(plan.operationBinding, ['parent', 'target', 'sourceBowerloom']);
    const binding = plan.operationBinding!;
    if (![binding.parent, binding.target, binding.sourceBowerloom].every(io.validIdentity)
      || !io.same(after.binding, { parent: binding.parent, target: binding.target })
      || !io.matchesInstalled(before, 'installedTargetIdentity', binding.target)
      || !io.matchesInstalled(before, 'installedBowerloomIdentity', binding.sourceBowerloom)) fail('REVISION_JOURNAL_INVALID');
  }
  if (before.plan.input.targetDir !== target || before.plan.revision !== plan.fromRevision || plan.toRevision !== after.revision
    || !io.same(nextPlan(target, after.input.brief, before, plan.beforeReceiptSha256, modern ? after.binding : undefined), after)) fail('REVISION_JOURNAL_INVALID');
  targetIdentity(plan); return plan;
}
function newReceipt(plan: StartupRevisionPlan, id: DirectoryIdentity): StartupReceipt {
  return io.makeReceipt(plan.after, plan.before.installedTargetIdentity, id);
}
function stamp(path: string, plan: StartupRevisionPlan): DirectoryIdentity | null {
  const file = join(path, 'stage.json'); if (!present(file)) return null;
  const value = JSON.parse(io.readManaged(file, 4096).toString('utf8')) as unknown;
  record(value, [...(v2(plan) ? ['format'] : []), 'revision', 'identity']); if ((v2(plan) && value.format !== 'bowerloom/startup-revision-stage/v1beta2') || value.revision !== plan.revision || !io.validIdentity(value.identity)) fail('REVISION_STAGE_INVALID');
  return value.identity as unknown as DirectoryIdentity;
}
function exactMarker(path: string, plan: StartupRevisionPlan): boolean {
  if (!present(path)) return false;
  if (io.readManaged(path, 256).toString('utf8') !== plan.revision + '\n') fail('REVISION_JOURNAL_INVALID');
  return true;
}
function inventory(path: string): void {
  directory(path);
  const allowed = new Set(['stage.json', 'next', 'previous', 'prepared', 'rollback', 'result.json', 'journal.json']);
  if (readdirSync(path).some(name => !allowed.has(name))) fail('REVISION_STAGE_INVALID');
  for (const name of readdirSync(path)) {
    const entry = lstatSync(join(path, name)); if (entry.isSymbolicLink()) fail('REVISION_STAGE_INVALID');
  }
}
async function stage(plan: StartupRevisionPlan, history: string): Promise<StartupReceipt> {
  targetIdentity(plan);
  if (!present(history)) { mkdirSync(history, { mode: 0o700 }); syncDirectory(plan.targetDir); }
  inventory(history);
  const next = join(history, 'next'); let id = stamp(history, plan);
  if (!id) {
    // Before a stamp exists, only an empty newly created stage is recoverable.
    if (present(next)) { directory(next); if (readdirSync(next).length) fail('REVISION_STAGE_INVALID'); }
    else { mkdirSync(next, { mode: 0o700 }); syncDirectory(history); }
    id = directory(next); write(join(history, 'stage.json'), io.json({ ...(v2(plan) ? { format: 'bowerloom/startup-revision-stage/v1beta2' } : {}), revision: plan.revision, identity: id }));
  }
  const receipt = newReceipt(plan, id), receiptText = io.json(receipt);
  await tree(next, receipt, io.hash(receiptText), true);
  if (v2(plan)) { targetIdentity(plan); if (!io.same(directory(next), id) || !io.same(directory(rootPath(plan.targetDir)), sourceIdentity(plan))) fail('REVISION_BINDING_CHANGED'); }
  for (const file of [...plan.after.files, { path: RECEIPT, text: receiptText }]) {
    const destination = join(next, file.path);
    let directoryPath = next;
    for (const component of file.path.split('/').slice(0, -1)) {
      const child = join(directoryPath, component);
      if (!present(child)) { mkdirSync(child, { mode: 0o700 }); syncDirectory(directoryPath); }
      directory(child); directoryPath = child;
    }
    if (!present(destination)) write(destination, file.text);
  }
  await tree(next, receipt, io.hash(receiptText));
  if (v2(plan)) { targetIdentity(plan); if (!io.same(directory(next), id) || !io.same(directory(rootPath(plan.targetDir)), sourceIdentity(plan))) fail('REVISION_BINDING_CHANGED'); }
  if (!exactMarker(join(history, 'prepared'), plan)) write(join(history, 'prepared'), plan.revision + '\n');
  return receipt;
}
async function recoverLocked(target: string, revision: string, action: 'resume' | 'rollback'): Promise<StartupRevisionRecovery> {
  if (action !== 'resume' && action !== 'rollback') fail('REVISION_RECOVERY_ACTION');
  const archived = !present(join(target, MARKER));
  const plan = journal(target, revision, archived), history = historyPath(target, revision), root = rootPath(target);
  if (archived) {
    inventory(history);
    const result = JSON.parse(io.readManaged(join(history, 'result.json'), 1024).toString('utf8')) as unknown;
    record(result, [...(v2(plan) ? ['format'] : []), 'revision', 'state']);
    if ((v2(plan) && result.format !== 'bowerloom/startup-revision-result/v1beta2') || result.revision !== revision || !['committed', 'rolled-back'].includes(String(result.state))) fail('REVISION_JOURNAL_INVALID');
    const id = stamp(history, plan), prepared = exactMarker(join(history, 'prepared'), plan), rollback = exactMarker(join(history, 'rollback'), plan);
    const next = join(history, 'next'), previous = join(history, 'previous');
    if (result.state === 'committed') {
      if (!id || !prepared || rollback || present(next)) fail('REVISION_STAGE_INVALID');
      await tree(previous, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
    } else {
      if (!rollback || present(previous)) fail('REVISION_STAGE_INVALID');
      if (present(next)) {
        if (!id) { directory(next); if (readdirSync(next).length) fail('REVISION_STAGE_INVALID'); }
        else { const saved = newReceipt(plan, id); await tree(next, saved, io.hash(io.json(saved)), !prepared); }
      } else if (id) fail('REVISION_STAGE_INVALID');
    }
    const inspection = await inspectStartup(target);
    return { format: recoveryFormat(plan), state: result.state as 'committed' | 'rolled-back', revision, installedRevision: inspection.revision, inspection };
  }
  targetIdentity(plan);
  if (!present(history)) { await tree(root, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan)); if (v2(plan)) targetIdentity(plan); mkdirSync(history, { mode: 0o700 }); syncDirectory(target); }
  inventory(history);
  if (present(join(history, 'result.json'))) {
    const finalText = io.json(resultBody(plan, action === 'resume' ? 'committed' : 'rolled-back'));
    if (io.readManaged(join(history, 'result.json'), 1024).toString('utf8') !== finalText) fail('REVISION_FINALIZATION_ACTION');
  }
  if (present(join(history, 'journal.json'))) fail('REVISION_JOURNAL_INVALID');
  const previous = join(history, 'previous'), next = join(history, 'next');
  let id = stamp(history, plan), receipt = id ? newReceipt(plan, id) : null;
  const oldAtRoot = present(root) && io.same(directory(root), sourceIdentity(plan));
  const newAtRoot = present(root) && id !== null && io.same(directory(root), id);
  if (present(root) && !oldAtRoot && !newAtRoot) fail('REVISION_BINDING_CHANGED');
  if (oldAtRoot) await tree(root, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
  if (newAtRoot) await tree(root, receipt!, io.hash(io.json(receipt)));
  if (present(previous)) await tree(previous, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
  if ((oldAtRoot && present(previous)) || (!oldAtRoot && !present(previous))) fail('REVISION_STAGE_INVALID');
  const prepared = exactMarker(join(history, 'prepared'), plan);
  if (present(next)) {
    if (!id) { directory(next); if (readdirSync(next).length) fail('REVISION_STAGE_INVALID'); }
    else await tree(next, receipt!, io.hash(io.json(receipt)), !prepared);
  } else if (id && !newAtRoot) fail('REVISION_STAGE_INVALID');
  if ((!oldAtRoot && !prepared) || (newAtRoot && present(next))) fail('REVISION_STAGE_INVALID');
  const rollback = exactMarker(join(history, 'rollback'), plan);
  if (rollback && action !== 'rollback') fail('REVISION_ROLLBACK_STARTED');
  if (v2(plan)) targetIdentity(plan);
  if (action === 'rollback') {
    if (!rollback) write(join(history, 'rollback'), revision + '\n');
    if (newAtRoot) { targetIdentity(plan); await tree(root, receipt!, io.hash(io.json(receipt))); moveOwned(plan, root, next, id!); }
    if (!oldAtRoot) { targetIdentity(plan); await tree(previous, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan)); moveOwned(plan, previous, root, sourceIdentity(plan)); }
    await tree(root, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
  } else {
    if (oldAtRoot) {
      receipt = await stage(plan, history); id = receipt.installedBowerloomIdentity;
      // Staging/compilation awaits do not authorize mutation of a changed old installation.
      targetIdentity(plan); await tree(root, plan.before, plan.beforeReceiptSha256, false, sourceIdentity(plan));
      moveOwned(plan, root, previous, sourceIdentity(plan));
    }
    if (!newAtRoot) {
      if (!receipt) fail('REVISION_STAGE_INVALID');
      targetIdentity(plan); await tree(next, receipt!, io.hash(io.json(receipt))); moveOwned(plan, next, root, id!);
    }
    await tree(root, receipt!, io.hash(io.json(receipt)));
  }
  if (v2(plan)) targetIdentity(plan);
  const state = action === 'resume' ? 'committed' : 'rolled-back', resultText = io.json(resultBody(plan, state));
  if (present(join(history, 'result.json'))) {
    if (io.readManaged(join(history, 'result.json'), 1024).toString('utf8') !== resultText) fail('REVISION_JOURNAL_INVALID');
  } else write(join(history, 'result.json'), resultText);
  targetIdentity(plan); move(join(target, MARKER), join(history, 'journal.json'));
  const inspection = await inspectStartup(target);
  if (!inspection.specReady) fail('REVISION_FINAL_INSPECTION');
  return { format: recoveryFormat(plan), state, revision, installedRevision: inspection.revision, inspection };
}
export async function applyStartupRevision(input: RevisionInput, expectedOldRevision: string, exactRevision: string): Promise<StartupReceipt> {
  if (!sha(expectedOldRevision) || !sha(exactRevision)) fail('EXACT_APPROVAL_REQUIRED');
  const target = io.canonicalTarget(input.targetDir);
  return withLock(target, async () => {
    const plan = await planStartupRevision(input);
    if (plan.fromRevision !== expectedOldRevision || plan.revision !== exactRevision) fail('STALE_APPROVAL');
    if (v2(plan)) targetIdentity(plan);
    write(join(target, MARKER), io.json({ format: v2(plan) ? 'bowerloom/startup-revision-journal/v1beta2' : 'bowerloom/startup-revision-journal/v1beta1', plan }));
    await recoverLocked(target, exactRevision, 'resume');
    return io.receiptValue(io.readManaged(join(rootPath(target), RECEIPT), 1024 * 1024));
  });
}
export async function recoverStartupRevision(targetDir: string, exactRevision: string, action: 'resume' | 'rollback'): Promise<StartupRevisionRecovery> {
  const target = io.canonicalTarget(targetDir); io.ancestors(target); if (!sha(exactRevision)) fail('EXACT_APPROVAL_REQUIRED');
  return withLock(target, () => recoverLocked(target, exactRevision, action));
}
export function renderStartupRevisionReview(plan: StartupRevisionPlan): string {
  const line = (value: string) => value.replace(/\r(?!\n)/g, '\\r');
  return [ 'Bowerloom installed setup revision', `Project: ${line(plan.after.input.brief.projectName)}`, `Target: ${plan.targetDir}`,
    `Saved goal: ${line(plan.before.plan.input.brief.goal)}`, `Proposed goal: ${line(plan.after.input.brief.goal)}`,
    `Old installation revision: ${plan.fromRevision}`, `New installation revision: ${plan.toRevision}`,
    'Approval replaces only the exact managed setup files and retains the original installation as a private backup.',
    'Unrelated project files stay unchanged. No model, backend, worker or execution permission is included.',
    'Old connections and runtime registrations do not authorize the new specification; review their exact bindings separately.',
    ...(v2(plan) ? ['The reviewed installation identity policy persists across this revision; the original target baseline is retained. Active revision and recovery identity pins remain exact.'] : []),
    'Interrupted updates remain pending. This approval also permits deterministic recovery or rollback to the recorded original.',
    `Exact revision approval: ${plan.revision}`, 'Review first; apply with --from the old revision and --approve this exact revision.' ].join('\n');
}
