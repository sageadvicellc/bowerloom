/**
 * Managed items v1beta2: the journaled transaction. A mechanical generalization of transaction.ts: the three fixed
 * kinds (canonical, projection, catalog) become the plan's ordered surface list. Functions keep the v1 names with a
 * V2 suffix only where a type changed, and keep v1's statement order. transaction.ts stayed byte-identical to
 * cc117ac until the M4 fix round, which gave both files the same record write (`json` below).
 *
 * Changes from v1 beyond the generalization, declared for review:
 * - `finish` fsyncs `dirname(marker)` after removing the marker. The v2 marker is `.bowerloom/managed-pending.json`,
 *   so that folder is `.bowerloom/`; v1 fsyncs the project folder, which is where its marker lives.
 * - apply compares normalized closures: `readClosure` returns the content-only `ItemClosure` (a cache closure goes
 *   through `cacheClosure`, a local one through the local reader), and that is compared with `plan.core.closure`.
 *   v1 compares the raw acquired cache closure.
 * - `applyManagedItem` takes no separate `expectedPreviousRevision` argument. The request carries it, the plan binds
 *   it, and the approval revision covers the plan, so a second copy could only disagree.
 *
 * Guard map, v1 transaction.ts line -> v2 (this file), for the independent review:
 * - 13 `sync` (O_NOFOLLOW open, guard before and after, fsync)            -> `sync`, identical
 * - 14-18 `durable` (absent, O_CREAT|O_EXCL|O_NOFOLLOW, fchmod, fsync file then parent) -> `durable`, identical
 * - 19 `json`                                                              -> changed: each record (intent, journal
 *   record, receipt, marker) goes through `durable` under a hidden `.<name>.tmp` in the same folder, then is renamed
 *   into place and the folder fsynced; a leftover temporary is removed by `discard` and allowed by `readState`
 * - 21-42 `locked` (exclusive port, cancellation, close confirmation)     -> `locked`, identical; `heldLock` adds the
 *   caller-held path: token check, then a port probe that must find the port taken (else LOCK_NOT_HELD)
 * - 45-55 `readState` (op identity, intent format, plan revalidation, bindings, name allowlist, record chain)
 *   -> `readState`: stage names `(new|old|returned)-<surface-id>`; the record kind list is v1's, unchanged
 * - 56-61 `marker` (format, key, stateDir, op identity, intent sha256)     -> `marker`: v2 path and format, plus item
 * - 62-89 `parentGuard` (created parents never adopted before their PARENT_CREATED stamp) -> identical
 * - 90-99 `stateGuard` (life.check, bindings, op identity, retained bytes, free space, marker pin, parents, closing
 *   life.check)                                                            -> identical
 * - 100-103 `append` (hash chain, 256 records)                             -> identical
 * - 104-107 `relocated`, `at`, `exactAt` (ctime dropped via stablePins), `currentSurfaces` -> same, keyed by surface
 * - 108-124 `stageAll` (absent, mkdir 0700, per-directory identity, durable 0644, re-read hash, materialPins)
 *   -> identical per material; `kind === 'file'` replaces `kind === 'catalog'`
 * - 125-133 `stages` (exactly one STAGE_INTENT and STAGE_READY per surface) -> loop over surfaces with material
 * - 134-144 `parents` (prestamp gap never adopted)                         -> identical
 * - 145-153 `moves` (backup when present, then publish)                    -> identical; the backup-only `legacy`
 *   surface has no material and so no publish move
 * - 154-165 `executeMove` (intent, exact source or target, absent, rename, fsync both parents, done) -> identical
 * - 166-179 `expectedState`, `reversed`, `stateMatches`                    -> identical, keyed by surface id
 * - 180-190 `prefix` (exactly one matching prefix, intents and dones consistent) -> identical
 * - 191-204 `reconcileDone`, `removeCreatedParents` (identity and emptiness before rmdir) -> identical
 * - 205-209 `terminal`                                                     -> harness becomes harnesses, plus item
 *   and migratedFrom
 * - 210-234 `publishReceipt`, `finish`, `resume`, `rollback`               -> identical apart from the receipt body
 * - 235-250 apply (lock, replan equal revision, re-read source equal, bindings, before equal, parents, markers,
 *   absent op, history, capacity, life.check, mkdir op, intent, marker, stage, resume) -> identical order; history
 *   refuses with MANAGED_SKILL_HISTORY_FULL
 * - 251-257 `snapshot`, 258-285 recovery plan and recover                  -> identical apart from formats
 */
import fs from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { revisionOf, freezeSkillData } from '../../skill-sources/src/validation.js';
import { LIMITS, check, fail, schema, hash, same, lifetime, path, directory, ancestry, exists, names, absent, raw, parsed, stablePins, retainedBytes } from './observed.js';
import type { Lifetime } from './observed.js';
import { MARKER_V2, PENDING_FORMAT, RECEIPT_FORMAT, boundaryV2, requestV2, readClosure, surfaceV2, matchesV2, bindingsV2, capacityV2, materialPinsV2, validatePlanV2, planItemWithLifetime, receiptAtV2 } from './v2-observed.js';
import { isHeldProjectLock, lockSlot, lockServer, lockHolder, reportSlotCollision, slotRefusal } from '../../project-context/src/index.js';
import { createServer } from 'node:net';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import type { Identity, FilePin, JournalRecord } from './observed-types.js';
import type { SurfaceId, SurfaceKind, SurfaceV2, ManagedItemPlan, ManagedItemReceipt, IntentV2, RecoveryPlanV2, RecoveryAction, MigratedFrom } from './v2-types.js';
const intentKeys = ['format', 'plan', 'operationIdentity', 'approvalRevision'];
const recordKeys = ['sequence', 'previous', 'kind', 'data', 'revision'];
const pendingKeys = ['format', 'item', 'operationKey', 'stateDir', 'operationIdentity', 'intentSha256'];
const STAGE_NAME = /^(?:new|old|returned)-(?:canonical|catalog|projection-claude|projection-codex|command-claude|ignore|legacy)$/;
const intentPath = (p: ManagedItemPlan) => join(p.core.request.stateDir, 'op-' + p.operationKey);
function sync(p: string, guard: () => void): void { guard(); const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { guard(); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function durable(p: string, bytes: string | Buffer, guard: () => void, mode = 0o600): void {
  guard(); absent(p); guard(); const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { guard(); fs.fchmodSync(fd, mode); guard(); fs.writeFileSync(fd, bytes); guard(); fs.fsyncSync(fd); guard(); } finally { fs.closeSync(fd); }
  guard(); sync(dirname(p), guard); guard();
}
/** The hidden temporary name of one record, in the record's own folder. */
const temporary = (p: string): string => join(dirname(p), '.' + basename(p) + '.tmp');
/** A temporary left by an interrupted record write never became a record. Only a plain owned file is removed. */
function discard(tmp: string, guard: () => void): void {
  guard(); if (!exists(tmp)) return; const s = fs.lstatSync(tmp, { bigint: true }); check(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && Number(s.uid) === process.getuid?.());
  guard(); fs.unlinkSync(tmp); sync(dirname(tmp), guard); guard();
}
/**
 * A JSON record (intent, journal record, receipt, marker) is never seen part-written: it is written whole under
 * its temporary name, fsynced, renamed into place, and the folder fsynced. A kill leaves no record or a whole one.
 */
function json(p: string, value: unknown, guard: () => void): void {
  const tmp = temporary(p); guard(); absent(p); discard(tmp, guard); durable(tmp, JSON.stringify(value) + '\n', guard);
  guard(); absent(p); guard(); fs.renameSync(tmp, p); sync(dirname(p), guard); guard();
}
/** Same key as startup revision apply/recovery and v1 managed apply. Initial startup has a different lock. */
async function locked<T>(project: string, life: Lifetime, work: () => Promise<T>): Promise<T> {
  life.check(); const slot = lockSlot(project), port = slot.port, server = lockServer(slot); let acquired = false, pending = true;
  let stop: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const settle = (error?: unknown) => { if (!pending) return; pending = false; life.signal.removeEventListener('abort', stop!); error ? reject(error) : resolve(); };
      stop = () => settle(new Error('stopped')); life.signal.addEventListener('abort', stop, { once: true });
      server.once('error', error => settle(error));
      // If cancellation wins first, late listen completion only closes this listener.
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { acquired = true; if (!pending) { try { server.close(() => {}); } catch { /* Already closed by cancellation. */ } return; } try { life.check(); settle(); } catch (e) { settle(e); } });
      if (life.signal.aborted) stop();
    });
    life.check(); const result = await work(); life.check(); return result;
  } catch (e) {
    life.check();
    // Only EADDRINUSE reads the holder's banner: this project's own lock is LOCKED, anything else on the slot is a collision.
    if (!acquired) { if ((e as NodeJS.ErrnoException)?.code === 'EADDRINUSE' && await slotRefusal(slot) === 'collision') { life.check(); fail('MANAGED_SKILL_LOCK_SLOT_COLLISION', port); } fail('MANAGED_SKILL_LOCKED'); }
    throw e;
  }
  finally {
    if (stop) life.signal.removeEventListener('abort', stop);
    // Closing during pending listen cancels Node's listen handle. A late callback
    // still retains and closes only this exact server; no process/PID adoption.
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('close-unconfirmed')), 1000); timer.unref(); const done = (error?: Error) => { clearTimeout(timer); if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(new Error('close-unconfirmed')); else resolve(); }; try { server.close(done); } catch { clearTimeout(timer); reject(new Error('close-unconfirmed')); } });
  }
}
/**
 * v2 only. The caller (the sync orchestrator) already holds the project lock and passes its token. The token must
 * name this project and assert held, and the lock port must be taken: if this process can bind it, nobody holds the
 * lock, and the token is refused. Only EADDRINUSE counts as taken; any other listen error proves nothing and refuses.
 * The probe listener is closed before any work.
 */
async function heldLock<T>(held: HeldProjectLock, project: string, life: Lifetime, work: () => Promise<T>): Promise<T> {
  // The brand proves the token came from `withProjectLock`; a literal with the same fields is refused. The port probe
  // and every `assertHeld` call below stay: the brand proves where the token came from, not that the lock is still held.
  life.check(); check(isHeldProjectLock(held) && held.dir === project && held.signal instanceof AbortSignal, 'MANAGED_SKILL_LOCK_NOT_HELD'); check(!held.signal.aborted, 'MANAGED_SKILL_ABORTED');
  try { held.assertHeld(project); } catch { fail('MANAGED_SKILL_LOCK_NOT_HELD'); }
  const slot = lockSlot(project), probe = createServer(socket => socket.destroy());
  const seen = await new Promise<'bound' | 'taken' | 'failed'>(resolve => { probe.once('error', e => resolve((e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'taken' : 'failed')); probe.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, () => resolve('bound')); });
  if (seen === 'bound') await new Promise<void>(resolve => probe.close(() => resolve()));
  check(seen === 'taken', 'MANAGED_SKILL_LOCK_NOT_HELD');
  // The taken slot must answer with this project's banner: another listener on the port proves nothing about the lock.
  if (await lockHolder(slot) !== 'this') fail('MANAGED_SKILL_LOCK_SLOT_COLLISION', reportSlotCollision(slot));
  const guard = () => { check(!held.signal.aborted, 'MANAGED_SKILL_ABORTED'); try { held.assertHeld(project); } catch { fail('MANAGED_SKILL_LOCK_NOT_HELD'); } life.check(); };
  guard(); const result = await work(); guard(); return result;
}
interface State { intent: IntentV2; op: string; records: JournalRecord[]; receipt: ManagedItemReceipt | null; opIdentity: Identity; createdParents?: Map<string, Identity>; markerRemoved?: boolean }
function recordName(sequence: number): string { return `record-${String(sequence).padStart(3, '0')}.json`; }
function readState(project: string, state: string, key: string, life: Lifetime): State {
  life.check(); path(project); path(state); check(/^[a-f0-9]{64}$/.test(key)); ancestry(project); ancestry(state); directory(state, true);
  const op = join(state, 'op-' + key), opIdentity = directory(op, true), intent = parsed<IntentV2>(join(op, 'intent.json'), intentKeys);
  check(intent.format === 'bowerloom/managed-item-intent/v1beta2' && same(intent.operationIdentity, opIdentity)); const plan = validatePlanV2(intent.plan);
  check(plan.operationKey === key && plan.core.request.projectDir === project && plan.core.request.stateDir === state && intent.approvalRevision === plan.revision); bindingsV2(plan.core, () => life.check());
  // A hidden temporary is an interrupted record write: never read, and removed by the next write of that record.
  const all = names(op); check(all.every(n => /^(?:intent|receipt)\.json$/.test(n) || /^record-\d{3}\.json$/.test(n) || STAGE_NAME.test(n) || /^\.(?:intent|receipt|record-\d{3})\.json\.tmp$/.test(n)));
  const files = all.filter(n => /^record-\d{3}\.json$/.test(n)).sort(); check(files.length <= 256);
  const records = files.map((n, i) => { const r = parsed<JournalRecord>(join(op, n), recordKeys), { revision, ...body } = r; check(n === recordName(i) && r.sequence === i && r.previous === (i ? parsed<JournalRecord>(join(op, recordName(i - 1)), recordKeys).revision : null) && revisionOf(body) === revision); check(['STAGE_INTENT', 'STAGE_READY', 'PARENT_INTENT', 'PARENT_CREATED', 'MOVE_INTENT', 'MOVE_DONE', 'ROLLBACK_START', 'ROLLBACK_INTENT', 'ROLLBACK_DONE', 'PARENT_REMOVE_INTENT', 'PARENT_REMOVED', 'RECEIPT_INTENT', 'RECEIPT_DONE', 'MARKER_REMOVE_INTENT'].includes(r.kind)); return r; });
  const receipt = exists(join(op, 'receipt.json')) ? receiptAtV2(state, key) : null;
  return { intent, op, records, receipt, opIdentity };
}
function marker(state: State, allowAbsent = false): FilePin | null {
  const plan = state.intent.plan, file = join(plan.core.request.projectDir, MARKER_V2);
  if (!exists(file)) { check(allowAbsent); return null; }
  const m = parsed<{ format: string; item: unknown; operationKey: string; stateDir: string; operationIdentity: Identity; intentSha256: string }>(file, pendingKeys);
  check(m.format === PENDING_FORMAT && same(m.item, plan.core.request.item) && m.operationKey === plan.operationKey && m.stateDir === plan.core.request.stateDir && same(m.operationIdentity, state.opIdentity) && m.intentSha256 === hash(raw(join(state.op, 'intent.json')).bytes)); return raw(file).pin;
}
/** Only this invocation may remember a just-created parent before its durable stamp.
 * Recovery has no such memory and cannot adopt a present, unstamped directory. */
function parentGuard(state: State): void {
  const planned = state.intent.plan.core.parents;
  for (const record of state.records.filter(r => ['PARENT_INTENT', 'PARENT_CREATED', 'PARENT_REMOVE_INTENT', 'PARENT_REMOVED'].includes(r.kind))) {
    const data = schema<{ path: string; identity?: Identity }>(record.data, record.kind === 'PARENT_INTENT' ? ['path'] : ['path', 'identity']);
    check(planned.some(p => p.path === data.path && p.identity === null));
  }
  for (const parent of planned) {
    if (parent.identity) { check(same(directory(parent.path), parent.identity), 'MANAGED_SKILL_LOCAL_DRIFT'); continue; }
    const records = (kind: string) => state.records.filter(r => r.kind === kind && (r.data as { path: string }).path === parent.path);
    const requested = records('PARENT_INTENT'), created = records('PARENT_CREATED'), removing = records('PARENT_REMOVE_INTENT'), removed = records('PARENT_REMOVED');
    check([requested, created, removing, removed].every(r => r.length <= 1));
    const stamp = created.length ? schema<{ path: string; identity: Identity }>(created[0]!.data, ['path', 'identity']) : null;
    const local = state.createdParents?.get(parent.path), id = stamp?.identity ?? local;
    if (stamp && local) check(same(stamp.identity, local));
    if (id) {
      check(requested.length === 1);
      if (removing.length) { check(stamp !== null && state.records.some(r => r.kind === 'ROLLBACK_START')); check(same(removing[0]!.data, stamp)); }
      if (removed.length) check(removing.length === 1 && same(removed[0]!.data, stamp));
      if (exists(parent.path)) { check(!removed.length && same(directory(parent.path, true), id), 'MANAGED_SKILL_LOCAL_DRIFT'); }
      else check(removing.length === 1, 'MANAGED_SKILL_LOCAL_DRIFT');
    } else {
      check(!created.length && !removing.length && !removed.length);
      check(!exists(parent.path), 'MANAGED_SKILL_RECOVERY_REQUIRED');
    }
  }
}
function stateGuard(state: State, life: Lifetime, pending: FilePin | null): () => void {
  return () => {
    life.check(); bindingsV2(state.intent.plan.core, () => life.check()); check(same(directory(state.op, true), state.opIdentity));
    check(retainedBytes(state.op) <= LIMITS.bytes); const space = fs.statfsSync(state.op, { bigint: true }); check(space.bavail * space.bsize >= BigInt(state.intent.plan.core.request.minFreeBytes));
    if (pending) { if (state.markerRemoved) check(!exists(pending.path)); else check(same(raw(pending.path).pin, pending)); }
    parentGuard(state);
    // Every caller receives a closing check, after all synchronous observations.
    life.check();
  };
}
function append(state: State, kind: string, data: unknown, guard: () => void): void {
  guard(); check(state.records.length < 256); const body = { sequence: state.records.length, previous: state.records.at(-1)?.revision ?? null, kind, data }; const record = { ...body, revision: revisionOf(body) };
  json(join(state.op, recordName(state.records.length)), record, guard); state.records.push(record);
}
function relocated(pins: FilePin[], from: string, to: string): FilePin[] { return pins.map(p => ({ ...p, path: join(to, relative(from, p.path)) })); }
function at(id: SurfaceId, kind: SurfaceKind, p: string): FilePin[] | null { return surfaceV2(id, kind, p).pins; }
function exactAt(id: SurfaceId, kind: SurfaceKind, p: string, expected: FilePin[] | null): boolean { return same(stablePins(at(id, kind, p)), stablePins(expected)); }
function currentSurfaces(plan: ManagedItemPlan): SurfaceV2[] { return plan.core.before.map(s => surfaceV2(s.id, s.kind, s.path)); }
function stageAll(state: State, life: Lifetime, guard: () => void): void {
  for (const mat of state.intent.plan.material) {
    const dest = join(state.op, 'new-' + mat.id); append(state, 'STAGE_INTENT', { id: mat.id, path: dest }, guard);
    if (mat.kind !== 'file') { guard(); absent(dest); guard(); fs.mkdirSync(dest, { mode: 0o700 }); sync(state.op, guard); }
    const directories = new Map<string, Identity>(); if (mat.kind !== 'file') directories.set(dest, directory(dest, true));
    const stageGuard = () => { guard(); for (const [p, id] of directories) check(same(directory(p, true), id)); life.check(); };
    for (const f of mat.files) {
      const file = mat.kind === 'file' ? dest : join(dest, f.path);
      if (mat.kind !== 'file') {
        let here = dest; for (const part of f.path.split('/').slice(0, -1)) { here = join(here, part); if (!directories.has(here)) { stageGuard(); absent(here); stageGuard(); fs.mkdirSync(here, { mode: 0o700 }); directories.set(here, directory(here, true)); sync(dirname(here), stageGuard); } }
      }
      durable(file, f.text, stageGuard, 0o644); check(hash(raw(file, mat.kind === 'file' ? 262144 : LIMITS.file, false).bytes) === f.sha256);
    }
    stageGuard(); const pins = at(mat.id, mat.kind, dest)!; materialPinsV2(mat, dest, pins); append(state, 'STAGE_READY', { id: mat.id, path: dest, pins }, guard);
  }
  life.check();
}
function stages(state: State): Map<SurfaceId, FilePin[]> {
  const map = new Map<SurfaceId, FilePin[]>();
  for (const mat of state.intent.plan.material) {
    const id = mat.id, intents = state.records.filter(r => r.kind === 'STAGE_INTENT' && (r.data as { id: string }).id === id), ready = state.records.filter(r => r.kind === 'STAGE_READY' && (r.data as { id: string }).id === id);
    check(intents.length === 1 && ready.length === 1, 'MANAGED_SKILL_RECOVERY_REQUIRED');
    const v = schema<{ id: string; path: string; pins: FilePin[] }>(ready[0]!.data, ['id', 'path', 'pins']); check(v.path === join(state.op, 'new-' + id)); materialPinsV2(mat, v.path, v.pins); map.set(id, v.pins);
  }
  return map;
}
function parents(state: State, guard: () => void): void {
  for (const parent of state.intent.plan.core.parents) {
    if (parent.identity) { check(same(directory(parent.path), parent.identity)); continue; }
    const requested = state.records.filter(r => r.kind === 'PARENT_INTENT' && (r.data as { path: string }).path === parent.path), done = state.records.filter(r => r.kind === 'PARENT_CREATED' && (r.data as { path: string }).path === parent.path);
    if (done.length) { check(done.length === 1 && requested.length === 1); const pin = schema<{ path: string; identity: Identity }>(done[0]!.data, ['path', 'identity']); check(same(directory(parent.path, true), pin.identity)); continue; }
    // An intent without a creation receipt is a prestamp gap, never adopted.
    check(requested.length === 0 && !exists(parent.path), 'MANAGED_SKILL_RECOVERY_REQUIRED'); append(state, 'PARENT_INTENT', { path: parent.path }, guard); guard(); absent(parent.path); guard(); fs.mkdirSync(parent.path, { mode: 0o700 });
    const identity = directory(parent.path, true); (state.createdParents ??= new Map()).set(parent.path, identity);
    sync(dirname(parent.path), guard); guard(); append(state, 'PARENT_CREATED', { path: parent.path, identity }, guard);
  }
}
interface Move { id: string; surface: SurfaceId; kind: SurfaceKind; from: string; to: string; pins: FilePin[] }
function moves(state: State): Move[] {
  const ready = stages(state), result: Move[] = [];
  for (const s of state.intent.plan.core.before) {
    if (s.pins) result.push({ id: s.id + '-backup', surface: s.id, kind: s.kind, from: s.path, to: join(state.op, 'old-' + s.id), pins: s.pins });
    // v2: a surface without material (the migrated legacy namespace) is backed up and never published.
    if (ready.has(s.id)) result.push({ id: s.id + '-publish', surface: s.id, kind: s.kind, from: join(state.op, 'new-' + s.id), to: s.path, pins: ready.get(s.id)! });
  }
  return result;
}
function executeMove(state: State, move: Move, reverse: boolean, guard: () => void): void {
  const intentKind = reverse ? 'ROLLBACK_INTENT' : 'MOVE_INTENT', doneKind = reverse ? 'ROLLBACK_DONE' : 'MOVE_DONE';
  const intents = state.records.filter(r => r.kind === intentKind && (r.data as { id: string }).id === move.id), done = state.records.filter(r => r.kind === doneKind && (r.data as { id: string }).id === move.id);
  check(intents.length <= 1 && done.length <= 1); const expectedTo = relocated(move.pins, move.from, move.to);
  if (intents.length) check(same(intents[0]!.data, move));
  else { check(done.length === 0); guard(); check(exactAt(move.surface, move.kind, move.from, move.pins) && !exists(move.to), 'MANAGED_SKILL_LOCAL_DRIFT'); append(state, intentKind, move, guard); }
  guard(); const source = exactAt(move.surface, move.kind, move.from, move.pins), target = exactAt(move.surface, move.kind, move.to, expectedTo);
  check((source && !exists(move.to)) || (!exists(move.from) && target), 'MANAGED_SKILL_LOCAL_DRIFT');
  if (done.length) { check(same(done[0]!.data, move) && !exists(move.from) && target); return; }
  if (source) { guard(); check(exactAt(move.surface, move.kind, move.from, move.pins)); absent(move.to); guard(); fs.renameSync(move.from, move.to); sync(dirname(move.from), guard); sync(dirname(move.to), guard); guard(); }
  check(!exists(move.from) && exactAt(move.surface, move.kind, move.to, expectedTo)); append(state, doneKind, move, guard);
}
type Expected = Map<string, { surface: SurfaceId; kind: SurfaceKind; pins: FilePin[] | null }>;
function expectedState(state: State, forward: number, reverse: number): Expected {
  const map: Expected = new Map(), ready = stages(state);
  for (const s of state.intent.plan.core.before) {
    map.set(s.path, { surface: s.id, kind: s.kind, pins: s.pins });
    if (ready.has(s.id)) map.set(join(state.op, 'new-' + s.id), { surface: s.id, kind: s.kind, pins: ready.get(s.id)! });
    map.set(join(state.op, 'old-' + s.id), { surface: s.id, kind: s.kind, pins: null });
    map.set(join(state.op, 'returned-' + s.id), { surface: s.id, kind: s.kind, pins: null });
  }
  const all = moves(state); for (const m of all.slice(0, forward)) { map.set(m.from, { surface: m.surface, kind: m.kind, pins: null }); map.set(m.to, { surface: m.surface, kind: m.kind, pins: relocated(m.pins, m.from, m.to) }); }
  for (const m of reversed(all.slice(0, forward)).slice(0, reverse)) { map.set(m.from, { surface: m.surface, kind: m.kind, pins: null }); map.set(m.to, { surface: m.surface, kind: m.kind, pins: relocated(m.pins, m.from, m.to) }); }
  return map;
}
function reversed(done: Move[]): Move[] { return [...done].reverse().map(m => ({ id: m.id, surface: m.surface, kind: m.kind, from: m.to, to: m.id.endsWith('-publish') ? join(dirname(m.from), 'returned-' + m.surface) : m.from, pins: relocated(m.pins, m.from, m.to) })); }
function stateMatches(map: Expected): boolean { return [...map].every(([p, e]) => exactAt(e.surface, e.kind, p, e.pins)); }
function prefix(state: State, reverse: boolean, forwardCount?: number): number {
  const all = reverse ? reversed(moves(state).slice(0, forwardCount!)) : moves(state), matchesAt: number[] = [];
  for (let i = 0; i <= all.length; i++) if (stateMatches(expectedState(state, reverse ? forwardCount! : i, reverse ? i : 0))) matchesAt.push(i);
  check(matchesAt.length === 1, 'MANAGED_SKILL_LOCAL_DRIFT'); const count = matchesAt[0]!;
  for (let i = 0; i < all.length; i++) {
    const m = all[i]!, intents = state.records.filter(r => r.kind === (reverse ? 'ROLLBACK_INTENT' : 'MOVE_INTENT') && (r.data as Move).id === m.id), done = state.records.filter(r => r.kind === (reverse ? 'ROLLBACK_DONE' : 'MOVE_DONE') && (r.data as Move).id === m.id);
    check(intents.length <= 1 && done.length <= 1 && (!intents.length || same(intents[0]!.data, m)) && (!done.length || same(done[0]!.data, m)));
    check(i < count ? intents.length === 1 : done.length === 0); check(i <= count || intents.length === 0);
  }
  return count;
}
function reconcileDone(state: State, completed: Move[], reverse: boolean, guard: () => void): void {
  for (const m of completed) if (!state.records.some(r => r.kind === (reverse ? 'ROLLBACK_DONE' : 'MOVE_DONE') && (r.data as Move).id === m.id)) append(state, reverse ? 'ROLLBACK_DONE' : 'MOVE_DONE', m, guard);
}
function removeCreatedParents(state: State, guard: () => void): void {
  for (const record of [...state.records.filter(r => r.kind === 'PARENT_CREATED')].reverse()) {
    const parent = schema<{ path: string; identity: Identity }>(record.data, ['path', 'identity']);
    const intents = state.records.filter(r => r.kind === 'PARENT_REMOVE_INTENT' && (r.data as { path: string }).path === parent.path), done = state.records.filter(r => r.kind === 'PARENT_REMOVED' && (r.data as { path: string }).path === parent.path);
    check(intents.length <= 1 && done.length <= 1); if (intents.length) check(same(intents[0]!.data, parent));
    if (!exists(parent.path)) { check(intents.length === 1); if (!done.length) append(state, 'PARENT_REMOVED', parent, guard); continue; }
    check(!done.length && same(directory(parent.path, true), parent.identity) && names(parent.path).length === 0, 'MANAGED_SKILL_LOCAL_DRIFT');
    if (!intents.length) append(state, 'PARENT_REMOVE_INTENT', parent, guard);
    guard(); check(same(directory(parent.path, true), parent.identity) && names(parent.path).length === 0); guard(); fs.rmdirSync(parent.path); sync(dirname(parent.path), guard); guard(); append(state, 'PARENT_REMOVED', parent, guard);
  }
}
function migratedFrom(p: ManagedItemPlan): MigratedFrom | null { const l = p.core.legacy; return l ? { format: 'bowerloom/observed-managed-skill-receipt/v1beta1', stateDir: l.stateDir, operationKey: l.operationKey, revision: l.receiptRevision } : null; }
function terminal(state: State, receipt: ManagedItemReceipt): void {
  const p = state.intent.plan; check(receipt.planRevision === p.revision && receipt.operationKey === p.operationKey && receipt.projectDir === p.core.request.projectDir && receipt.stateDir === p.core.request.stateDir && same(receipt.item, p.core.request.item) && same(receipt.harnesses, p.core.request.harnesses) && receipt.previousRevision === p.core.request.expectedPreviousRevision && same(receipt.migratedFrom, migratedFrom(p)));
  const observed = currentSurfaces(p); check(matchesV2(observed, receipt.installed), 'MANAGED_SKILL_LOCAL_DRIFT');
  if (receipt.state === 'rolled-back') check(matchesV2(observed, p.core.before) && same(receipt.restoredPrevious, p.core.previous)); else check(receipt.restoredPrevious === null && stateMatches(expectedState(state, moves(state).length, 0)));
}
function publishReceipt(state: State, outcome: 'committed' | 'rolled-back', guard: () => void): ManagedItemReceipt {
  if (state.receipt) { check(state.receipt.state === outcome); terminal(state, state.receipt); return state.receipt; }
  const p = state.intent.plan, body = { format: RECEIPT_FORMAT, state: outcome, item: p.core.request.item, operationKey: p.operationKey, planRevision: p.revision, previousRevision: p.core.request.expectedPreviousRevision, projectDir: p.core.request.projectDir, stateDir: p.core.request.stateDir, harnesses: p.core.request.harnesses, installed: currentSurfaces(p), restoredPrevious: outcome === 'rolled-back' ? p.core.previous : null, migratedFrom: migratedFrom(p), executionAuthorized: false as const }, receipt = { ...body, revision: revisionOf(body) };
  const prior = state.records.filter(r => r.kind === 'RECEIPT_INTENT'); check(prior.length <= 1); if (prior.length) check(same(prior[0]!.data, receipt)); else append(state, 'RECEIPT_INTENT', receipt, guard);
  json(join(state.op, 'receipt.json'), receipt, guard); state.receipt = receipt; terminal(state, receipt); append(state, 'RECEIPT_DONE', { revision: receipt.revision }, guard); return receipt;
}
function finish(state: State, outcome: 'committed' | 'rolled-back', guard: () => void): ManagedItemReceipt {
  const r = publishReceipt(state, outcome, guard), file = join(r.projectDir, MARKER_V2); terminal(state, r);
  if (exists(file)) { marker(state); if (!state.records.some(x => x.kind === 'MARKER_REMOVE_INTENT')) append(state, 'MARKER_REMOVE_INTENT', { receiptRevision: r.revision }, guard); guard(); marker(state); guard(); fs.unlinkSync(file); state.markerRemoved = true; sync(dirname(file), guard); }
  return r;
}
function resume(state: State, life: Lifetime, guard: () => void): ManagedItemReceipt {
  check(!state.records.some(r => r.kind.startsWith('ROLLBACK'))); parents(state, guard); const all = moves(state), completed = prefix(state, false); reconcileDone(state, all.slice(0, completed), false, guard);
  for (const move of all.slice(completed)) { life.check(); executeMove(state, move, false, guard); }
  check(stateMatches(expectedState(state, all.length, 0))); return finish(state, 'committed', guard);
}
function rollback(state: State, life: Lifetime, guard: () => void): ManagedItemReceipt {
  check(!state.receipt); const starts = state.records.filter(r => r.kind === 'ROLLBACK_START'); check(starts.length <= 1);
  let count: number;
  if (starts.length) { const v = schema<{ count: number }>(starts[0]!.data, ['count']); check(Number.isSafeInteger(v.count) && v.count >= 0 && v.count <= moves(state).length); count = v.count; }
  else { count = prefix(state, false); reconcileDone(state, moves(state).slice(0, count), false, guard); append(state, 'ROLLBACK_START', { count }, guard); }
  const all = reversed(moves(state).slice(0, count)), completed = prefix(state, true, count); reconcileDone(state, all.slice(0, completed), true, guard);
  for (const move of all.slice(completed)) { life.check(); executeMove(state, move, true, guard); }
  check(matchesV2(currentSurfaces(state.intent.plan), state.intent.plan.core.before), 'MANAGED_SKILL_LOCAL_DRIFT'); removeCreatedParents(state, guard); return finish(state, 'rolled-back', guard);
}
/** The journal shows no effect on the project: no move or rollback move, and no parent stamped, removed or removing. */
function untouched(state: State): boolean {
  return !state.records.some(r => ['MOVE_INTENT', 'MOVE_DONE', 'ROLLBACK_INTENT', 'ROLLBACK_DONE', 'PARENT_CREATED', 'PARENT_REMOVE_INTENT', 'PARENT_REMOVED'].includes(r.kind));
}
/**
 * The marker may be absent only after a receipt, or for an abandon whose journal holds nothing but its own records:
 * the apply was killed between intent.json and the marker, so nothing else ran.
 */
function markerOptional(state: State, action: RecoveryAction): boolean {
  return state.receipt !== null || (action === 'abandon' && state.records.every(r => r.kind === 'ROLLBACK_START' || r.kind === 'RECEIPT_INTENT'));
}
/** v2 only. Abandon applies to an unfinished operation that never touched the project (see `RecoveryAction`). */
function abandonable(state: State): void {
  check(!state.receipt && untouched(state), 'MANAGED_SKILL_RECOVERY_REQUIRED');
  const starts = state.records.filter(r => r.kind === 'ROLLBACK_START'); check(starts.length <= 1 && starts.every(r => same(r.data, { count: 0 })));
  check(matchesV2(currentSurfaces(state.intent.plan), state.intent.plan.core.before), 'MANAGED_SKILL_LOCAL_DRIFT');
}
function abandon(state: State, guard: () => void): ManagedItemReceipt {
  abandonable(state); if (!state.records.some(r => r.kind === 'ROLLBACK_START')) append(state, 'ROLLBACK_START', { count: 0 }, guard);
  abandonable(state); const receipt = finish(state, 'rolled-back', guard);
  // A marker temporary from a kill before the marker landed is ours and never became a marker.
  discard(temporary(join(receipt.projectDir, MARKER_V2)), guard); return receipt;
}
/** v2 lifetime: v1 `lifetime` over the caller signal and, when the caller holds the lock, the lock's own signal. */
function itemLifetime(options: unknown, held: HeldProjectLock | null): Lifetime {
  if (!held) return lifetime(options);
  // v1 `lifetime` validates the options first: no proxy, no accessor, only `signal`.
  lifetime(options).close(); const own = Object.getOwnPropertyDescriptor(options as object, 'signal')?.value as AbortSignal | undefined;
  check(isHeldProjectLock(held) && held.signal instanceof AbortSignal, 'MANAGED_SKILL_LOCK_NOT_HELD');
  return lifetime({ signal: AbortSignal.any(own ? [held.signal, own] : [held.signal]) });
}
export async function applyManagedItem(held: HeldProjectLock | null, req: unknown, revision: string, options: unknown = {}): Promise<ManagedItemReceipt> {
  let life: Lifetime | null = null, mutated = false;
  try { life = itemLifetime(options, held); const live = life; const input = requestV2(req); check(typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision));
    const work = async () => {
      const proposed = await planItemWithLifetime(input, live); live.check(); check(proposed.format === 'bowerloom/managed-item-plan/v1beta2' && proposed.revision === revision, 'MANAGED_SKILL_STALE_APPROVAL'); const plan = proposed as ManagedItemPlan;
      const { closure } = await readClosure(input, live); live.check(); check(same(closure, plan.core.closure));
      const op = intentPath(plan); bindingsV2(plan.core, () => live.check()); check(same(currentSurfaces(plan), plan.core.before), 'MANAGED_SKILL_LOCAL_DRIFT');
      for (const p of plan.core.parents) { if (p.identity) check(same(directory(p.path), p.identity)); else if (exists(dirname(p.path))) absent(p.path); }
      check(!exists(join(input.projectDir, MARKER_V2)) && !exists(join(input.projectDir, '.bowerloom-revision.json'))); absent(op); check(names(input.stateDir).length < LIMITS.history, 'MANAGED_SKILL_HISTORY_FULL'); capacityV2(input); live.check(); fs.mkdirSync(op, { mode: 0o700 }); mutated = true; const opIdentity = directory(op, true);
      const state: State = { op, opIdentity, intent: { format: 'bowerloom/managed-item-intent/v1beta2', plan, operationIdentity: opIdentity, approvalRevision: revision }, records: [], receipt: null };
      let guard = stateGuard(state, live, null); sync(input.stateDir, guard); json(join(op, 'intent.json'), state.intent, guard); guard();
      const markerFile = join(input.projectDir, MARKER_V2); json(markerFile, { format: PENDING_FORMAT, item: input.item, operationKey: plan.operationKey, stateDir: input.stateDir, operationIdentity: opIdentity, intentSha256: hash(raw(join(op, 'intent.json')).bytes) }, guard);
      guard = stateGuard(state, live, marker(state)); stageAll(state, live, guard); return resume(state, live, guard);
    };
    return await (held ? heldLock(held, input.projectDir, live, work) : locked(input.projectDir, live, work));
  } catch (e) { if (mutated) fail('MANAGED_SKILL_RECOVERY_REQUIRED'); return boundaryV2(e); } finally { life?.close(); }
}
function snapshot(state: State, life: Lifetime, action: RecoveryAction): string {
  const rows: unknown[] = []; let bytes = 0, count = 0;
  const walk = (p: string) => { life.check(); const s = fs.lstatSync(p, { bigint: true }); check(++count < 2048 && !s.isSymbolicLink());
    if (s.isDirectory()) { const id = directory(p, true); rows.push({ path: p, identity: id, mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }); for (const n of names(p)) walk(join(p, n)); }
    else { const got = raw(p, LIMITS.record, (Number(s.mode) & 0o7777) === 0o600); bytes += got.bytes.length; check(bytes <= LIMITS.bytes); rows.push(got.pin); }
  }; walk(state.op); const m = marker(state, markerOptional(state, action)); rows.push(m); rows.push(currentSurfaces(state.intent.plan)); return revisionOf(rows);
}
async function recoveryWithLife(value: unknown, life: Lifetime): Promise<{ state: State; plan: RecoveryPlanV2 }> {
  const v = schema<{ projectDir: string; stateDir: string; operationKey: string; action: RecoveryAction }>(value, ['projectDir', 'stateDir', 'operationKey', 'action']); check(v.action === 'resume' || v.action === 'rollback' || v.action === 'abandon');
  const state = readState(v.projectDir, v.stateDir, v.operationKey, life); marker(state, markerOptional(state, v.action)); parentGuard(state); life.check();
  if (state.receipt) { check(v.action === (state.receipt.state === 'committed' ? 'resume' : 'rollback') || (v.action === 'abandon' && state.receipt.state === 'rolled-back' && untouched(state))); terminal(state, state.receipt); }
  else if (v.action === 'abandon') abandonable(state); // Stages and prestamp parent intents are never read: abandon touches neither.
  else {
    stages(state); // Incomplete/prestamp stages are held, never adopted.
    for (const r of state.records.filter(x => x.kind === 'PARENT_INTENT')) {
      const v = schema<{ path: string }>(r.data, ['path']);
      check(state.intent.plan.core.parents.some(p => p.path === v.path && p.identity === null));
      check(state.records.filter(x => x.kind === 'PARENT_CREATED' && (x.data as { path: string }).path === v.path).length === 1, 'MANAGED_SKILL_RECOVERY_REQUIRED');
    }
  }
  const body = { format: 'bowerloom/managed-item-recovery/v1beta2' as const, ...v, snapshotRevision: snapshot(state, life, v.action), planRevision: state.intent.plan.revision, writesAuthorized: false as const, executionAuthorized: false as const };
  life.check(); return { state, plan: freezeSkillData({ ...body, revision: revisionOf(body) }) };
}
export async function planManagedItemRecovery(value: unknown, options: unknown = {}): Promise<RecoveryPlanV2> { const life = lifetime(options); try { return (await recoveryWithLife(value, life)).plan; } catch (e) { return boundaryV2(e); } finally { life.close(); } }
export async function recoverManagedItem(value: unknown, revision: string, options: unknown = {}): Promise<ManagedItemReceipt> { return recoverItem(null, value, revision, options); }
/**
 * v2 only. Recovery under a project lock the caller (the sync orchestrator) already holds, with the same held-lock
 * checks as `applyManagedItem`: a token for this project that asserts held, an unaborted lock signal joined to the
 * caller's own, and a lock port this process cannot bind.
 */
export async function recoverManagedItemHeld(held: HeldProjectLock, value: unknown, revision: string, options: unknown = {}): Promise<ManagedItemReceipt> {
  try { check(isHeldProjectLock(held), 'MANAGED_SKILL_LOCK_NOT_HELD'); } catch (e) { return boundaryV2(e); }
  return recoverItem(held, value, revision, options);
}
async function recoverItem(held: HeldProjectLock | null, value: unknown, revision: string, options: unknown): Promise<ManagedItemReceipt> {
  let life: Lifetime | null = null;
  try { life = itemLifetime(options, held); const live = life; const plan = schema<RecoveryPlanV2>(value, ['format', 'projectDir', 'stateDir', 'operationKey', 'action', 'snapshotRevision', 'planRevision', 'writesAuthorized', 'executionAuthorized', 'revision']);
    path(plan.projectDir); path(plan.stateDir); const { revision: own, ...body } = plan; check(typeof revision === 'string' && revision === own && /^[a-f0-9]{64}$/.test(own) && revisionOf(body) === own && plan.format === 'bowerloom/managed-item-recovery/v1beta2' && plan.writesAuthorized === false && plan.executionAuthorized === false, 'MANAGED_SKILL_STALE_APPROVAL');
    const work = async () => {
      const fresh = await recoveryWithLife({ projectDir: plan.projectDir, stateDir: plan.stateDir, operationKey: plan.operationKey, action: plan.action }, live); live.check(); check(same(fresh.plan, plan) && revision === plan.revision, 'MANAGED_SKILL_STALE_APPROVAL'); const state = fresh.state; capacityV2(state.intent.plan.core.request);
      const pending = marker(state, markerOptional(state, plan.action)), guard = stateGuard(state, live, pending);
      if (state.receipt) { terminal(state, state.receipt); guard(); if (!pending) return state.receipt; return finish(state, state.receipt.state, guard); }
      return plan.action === 'resume' ? resume(state, live, guard) : plan.action === 'rollback' ? rollback(state, live, guard) : abandon(state, guard);
    };
    return await (held ? heldLock(held, plan.projectDir, live, work) : locked(plan.projectDir, live, work));
  } catch (e) { return boundaryV2(e, 'MANAGED_SKILL_RECOVERY_REQUIRED'); } finally { life?.close(); }
}
