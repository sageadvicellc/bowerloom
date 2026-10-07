import fs from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { lockSlot, lockServer, slotRefusal } from '../../project-context/src/index.js';
import { readAcquiredSkillCache } from '../../skill-sources/src/cache.js';
import { revisionOf, freezeSkillData } from '../../skill-sources/src/validation.js';
import { LIMITS, MARKER, POLICY, check, fail, boundary, schema, hash, same, lifetime, path, directory, ancestry, exists, names, absent, raw, parsed, tree, surface, stablePins, matches, locate, request, bindings, capacity, retainedBytes, opTemp, removeOpTemp, sweepOpTemps, temporary, markerTwin, rawMarker, formPlan, materialPins, validatePlan, planWithLifetime, receiptAt, receiptKeys } from './observed.js';
import type { Lifetime } from './observed.js';
import type { Identity, FilePin, Surface, ObservedSkillPlan, ObservedSkillReceipt, Intent, JournalRecord, RecoveryPlan, SkillInspection } from './observed-types.js';
const intentKeys = ['format', 'plan', 'operationIdentity', 'approvalRevision'];
const recordKeys = ['sequence', 'previous', 'kind', 'data', 'revision'];
const pendingKeys = ['format', 'operationKey', 'stateDir', 'operationIdentity', 'intentSha256'];
const intentPath = (p: ObservedSkillPlan) => join(p.core.request.stateDir, 'op-' + p.operationKey);
function sync(p: string, guard: () => void): void { guard(); const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { guard(); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function durable(p: string, bytes: string | Buffer, guard: () => void, mode = 0o600): void {
  guard(); absent(p); guard(); const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { guard(); fs.fchmodSync(fd, mode); guard(); fs.writeFileSync(fd, bytes); guard(); fs.fsyncSync(fd); guard(); } finally { fs.closeSync(fd); }
  guard(); sync(dirname(p), guard); guard();
}
// A record lands whole: a hidden temporary in the same folder, fsynced, renamed into place, folder fsynced.
// A leftover temporary never became a record; readState allows it and the next write removes it.
function discard(tmp: string, guard: () => void): void {
  guard(); if (!exists(tmp)) return; const s = fs.lstatSync(tmp, { bigint: true }); check(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && Number(s.uid) === process.getuid?.());
  guard(); fs.unlinkSync(tmp); sync(dirname(tmp), guard); guard();
}
function json(p: string, value: unknown, guard: () => void): void {
  const tmp = temporary(p); guard(); absent(p); discard(tmp, guard); durable(tmp, JSON.stringify(value) + '\n', guard);
  guard(); absent(p); guard(); fs.renameSync(tmp, p); sync(dirname(p), guard); guard();
}
/** The marker sits in the shared project, so it is published by a link that fails if its name exists, never by a
 * rename over it. Then its temporary is unlinked; a kill between the two leaves the twin state of `markerTwin`. */
function publish(p: string, value: unknown, guard: () => void): void {
  const tmp = temporary(p); guard(); absent(p); discard(tmp, guard); durable(tmp, JSON.stringify(value) + '\n', guard);
  guard(); absent(p); guard(); fs.linkSync(tmp, p); sync(dirname(p), guard); settleTwin(p, guard);
}
/** Unlinks the marker's own temporary when the two are one file (`markerTwin`), so the marker has one link again. */
function settleTwin(p: string, guard: () => void): void { guard(); if (!markerTwin(p)) return; fs.unlinkSync(temporary(p)); sync(dirname(p), guard); guard(); }
/** Removes a leftover marker temporary only when it is a private one-link file whose bytes begin `expected`. */
function discardMarkerTemp(p: string, expected: string, guard: () => void): void {
  const tmp = temporary(p), want = Buffer.from(expected); guard(); if (!exists(tmp)) return;
  const s = fs.lstatSync(tmp, { bigint: true });
  if (!s.isFile() || s.nlink !== 1n || Number(s.uid) !== process.getuid?.() || (Number(s.mode) & 0o7777) !== 0o600 || s.size > BigInt(want.length)) return;
  const got = raw(tmp, want.length).bytes; if (got.equals(want.subarray(0, got.length))) discard(tmp, guard);
}
/** Same key as startup revision apply/recovery. Initial startup has a different lock. */
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
interface State { intent: Intent; op: string; records: JournalRecord[]; receipt: ObservedSkillReceipt | null; opIdentity: Identity; createdParents?: Map<string, Identity>; markerRemoved?: boolean }
function recordName(sequence: number): string { return `record-${String(sequence).padStart(3, '0')}.json`; }
function readState(project: string, state: string, key: string, life: Lifetime): State {
  life.check(); path(project); path(state); check(/^[a-f0-9]{64}$/.test(key)); ancestry(project); ancestry(state); directory(state, true);
  const op = join(state, 'op-' + key), opIdentity = directory(op, true), intent = parsed<Intent>(join(op, 'intent.json'), intentKeys);
  check(intent.format === 'bowerloom/managed-skill-intent/v1beta1' && same(intent.operationIdentity, opIdentity)); const plan = validatePlan(intent.plan);
  check(plan.operationKey === key && plan.core.request.projectDir === project && plan.core.request.stateDir === state && intent.approvalRevision === plan.revision); bindings(plan.core, () => life.check());
  const all = names(op); check(all.every(n => /^(?:intent|receipt)\.json$/.test(n) || /^record-\d{3}\.json$/.test(n) || /^(?:new|old|returned)-(?:canonical|projection|catalog)$/.test(n) || /^\.(?:intent|receipt|record-\d{3})\.json\.tmp$/.test(n)));
  const files = all.filter(n => /^record-\d{3}\.json$/.test(n)).sort(); check(files.length <= 256);
  const records = files.map((n, i) => { const r = parsed<JournalRecord>(join(op, n), recordKeys), { revision, ...body } = r; check(n === recordName(i) && r.sequence === i && r.previous === (i ? parsed<JournalRecord>(join(op, recordName(i - 1)), recordKeys).revision : null) && revisionOf(body) === revision); check(['STAGE_INTENT', 'STAGE_READY', 'PARENT_INTENT', 'PARENT_CREATED', 'MOVE_INTENT', 'MOVE_DONE', 'ROLLBACK_START', 'ROLLBACK_INTENT', 'ROLLBACK_DONE', 'PARENT_REMOVE_INTENT', 'PARENT_REMOVED', 'RECEIPT_INTENT', 'RECEIPT_DONE', 'MARKER_REMOVE_INTENT'].includes(r.kind)); return r; });
  const receipt = exists(join(op, 'receipt.json')) ? receiptAt(state, key) : null;
  // At most one temporary, and only the one an interrupted write leaves: the next record's, or the receipt's while
  // RECEIPT_INTENT is the last record and no receipt landed.
  const temps = all.filter(n => n.endsWith('.tmp')); check(temps.length <= 1);
  if (temps.length) check(temps[0] === '.' + recordName(records.length) + '.tmp' || (temps[0] === '.receipt.json.tmp' && receipt === null && records.at(-1)?.kind === 'RECEIPT_INTENT'));
  return { intent, op, records, receipt, opIdentity };
}
function marker(state: State, allowAbsent = false): FilePin | null {
  const plan = state.intent.plan, file = join(plan.core.request.projectDir, MARKER);
  if (!exists(file)) { check(allowAbsent && state.receipt !== null); return null; }
  const m = parsed<{ format: string; operationKey: string; stateDir: string; operationIdentity: Identity; intentSha256: string }>(file, pendingKeys, true);
  check(m.format === 'bowerloom/managed-skill-pending/v1beta1' && m.operationKey === plan.operationKey && m.stateDir === plan.core.request.stateDir && same(m.operationIdentity, state.opIdentity) && m.intentSha256 === hash(raw(join(state.op, 'intent.json')).bytes)); return rawMarker(file).pin;
}
/** The pending marker of one operation. Apply writes exactly these bytes, and a leftover temporary is compared with them. */
function pendingBody(plan: ObservedSkillPlan, operationIdentity: Identity, intentSha256: string) {
  return { format: 'bowerloom/managed-skill-pending/v1beta1', operationKey: plan.operationKey, stateDir: plan.core.request.stateDir, operationIdentity, intentSha256 };
}
const pendingText = (state: State): string => JSON.stringify(pendingBody(state.intent.plan, state.opIdentity, hash(raw(join(state.op, 'intent.json')).bytes))) + '\n';
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
    life.check(); bindings(state.intent.plan.core, () => life.check()); check(same(directory(state.op, true), state.opIdentity));
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
function at(kind: Surface['kind'], p: string): FilePin[] | null { return surface(kind, p).pins; }
function exactAt(kind: Surface['kind'], p: string, expected: FilePin[] | null): boolean { return same(stablePins(at(kind, p)), stablePins(expected)); }
function currentSurfaces(plan: ObservedSkillPlan): Surface[] { return plan.core.before.map(s => surface(s.kind, s.path)); }
function stageAll(state: State, life: Lifetime, guard: () => void): void {
  for (const mat of state.intent.plan.material) {
    const dest = join(state.op, 'new-' + mat.kind); append(state, 'STAGE_INTENT', { kind: mat.kind, path: dest }, guard);
    if (mat.kind !== 'catalog') { guard(); absent(dest); guard(); fs.mkdirSync(dest, { mode: 0o700 }); sync(state.op, guard); }
    const directories = new Map<string, Identity>(); if (mat.kind !== 'catalog') directories.set(dest, directory(dest, true));
    const stageGuard = () => { guard(); for (const [p, id] of directories) check(same(directory(p, true), id)); life.check(); };
    for (const f of mat.files) {
      const file = mat.kind === 'catalog' ? dest : join(dest, f.path);
      if (mat.kind !== 'catalog') {
        let here = dest; for (const part of f.path.split('/').slice(0, -1)) { here = join(here, part); if (!directories.has(here)) { stageGuard(); absent(here); stageGuard(); fs.mkdirSync(here, { mode: 0o700 }); directories.set(here, directory(here, true)); sync(dirname(here), stageGuard); } }
      }
      durable(file, f.text, stageGuard, 0o644); check(hash(raw(file, mat.kind === 'catalog' ? 262144 : LIMITS.file, false).bytes) === f.sha256);
    }
    stageGuard(); const pins = at(mat.kind, dest)!; materialPins(mat, dest, pins); append(state, 'STAGE_READY', { kind: mat.kind, path: dest, pins }, guard);
  }
  life.check();
}
function stages(state: State): Map<string, FilePin[]> {
  const map = new Map<string, FilePin[]>();
  for (const kind of ['canonical', 'projection', 'catalog'] as const) {
    const intents = state.records.filter(r => r.kind === 'STAGE_INTENT' && (r.data as { kind: string }).kind === kind), ready = state.records.filter(r => r.kind === 'STAGE_READY' && (r.data as { kind: string }).kind === kind);
    check(intents.length === 1 && ready.length === 1, 'MANAGED_SKILL_RECOVERY_REQUIRED');
    const v = schema<{ kind: string; path: string; pins: FilePin[] }>(ready[0]!.data, ['kind', 'path', 'pins']); check(v.path === join(state.op, 'new-' + kind)); materialPins(state.intent.plan.material.find(m => m.kind === kind)!, v.path, v.pins); map.set(kind, v.pins);
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
interface Move { id: string; kind: Surface['kind']; from: string; to: string; pins: FilePin[] }
function moves(state: State): Move[] {
  const ready = stages(state), result: Move[] = [];
  for (const s of state.intent.plan.core.before) {
    if (s.pins) result.push({ id: s.kind + '-backup', kind: s.kind, from: s.path, to: join(state.op, 'old-' + s.kind), pins: s.pins });
    result.push({ id: s.kind + '-publish', kind: s.kind, from: join(state.op, 'new-' + s.kind), to: s.path, pins: ready.get(s.kind)! });
  }
  return result;
}
function executeMove(state: State, move: Move, reverse: boolean, guard: () => void): void {
  const intentKind = reverse ? 'ROLLBACK_INTENT' : 'MOVE_INTENT', doneKind = reverse ? 'ROLLBACK_DONE' : 'MOVE_DONE';
  const intents = state.records.filter(r => r.kind === intentKind && (r.data as { id: string }).id === move.id), done = state.records.filter(r => r.kind === doneKind && (r.data as { id: string }).id === move.id);
  check(intents.length <= 1 && done.length <= 1); const expectedTo = relocated(move.pins, move.from, move.to);
  if (intents.length) check(same(intents[0]!.data, move));
  else { check(done.length === 0); guard(); check(exactAt(move.kind, move.from, move.pins) && !exists(move.to), 'MANAGED_SKILL_LOCAL_DRIFT'); append(state, intentKind, move, guard); }
  guard(); const source = exactAt(move.kind, move.from, move.pins), target = exactAt(move.kind, move.to, expectedTo);
  check((source && !exists(move.to)) || (!exists(move.from) && target), 'MANAGED_SKILL_LOCAL_DRIFT');
  if (done.length) { check(same(done[0]!.data, move) && !exists(move.from) && target); return; }
  if (source) { guard(); check(exactAt(move.kind, move.from, move.pins)); absent(move.to); guard(); fs.renameSync(move.from, move.to); sync(dirname(move.from), guard); sync(dirname(move.to), guard); guard(); }
  check(!exists(move.from) && exactAt(move.kind, move.to, expectedTo)); append(state, doneKind, move, guard);
}
function expectedState(state: State, forward: number, reverse: number): Map<string, { kind: Surface['kind']; pins: FilePin[] | null }> {
  const map = new Map<string, { kind: Surface['kind']; pins: FilePin[] | null }>(), ready = stages(state);
  for (const s of state.intent.plan.core.before) {
    map.set(s.path, { kind: s.kind, pins: s.pins });
    map.set(join(state.op, 'new-' + s.kind), { kind: s.kind, pins: ready.get(s.kind)! });
    map.set(join(state.op, 'old-' + s.kind), { kind: s.kind, pins: null });
    map.set(join(state.op, 'returned-' + s.kind), { kind: s.kind, pins: null });
  }
  const all = moves(state); for (const m of all.slice(0, forward)) { map.set(m.from, { kind: m.kind, pins: null }); map.set(m.to, { kind: m.kind, pins: relocated(m.pins, m.from, m.to) }); }
  for (const m of reversed(all.slice(0, forward)).slice(0, reverse)) { map.set(m.from, { kind: m.kind, pins: null }); map.set(m.to, { kind: m.kind, pins: relocated(m.pins, m.from, m.to) }); }
  return map;
}
function reversed(done: Move[]): Move[] { return [...done].reverse().map(m => ({ id: m.id, kind: m.kind, from: m.to, to: m.id.endsWith('-publish') ? join(dirname(m.from), 'returned-' + m.kind) : m.from, pins: relocated(m.pins, m.from, m.to) })); }
function stateMatches(map: ReturnType<typeof expectedState>): boolean { return [...map].every(([p, e]) => exactAt(e.kind, p, e.pins)); }
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
function terminal(state: State, receipt: ObservedSkillReceipt): void {
  const p = state.intent.plan; check(receipt.planRevision === p.revision && receipt.operationKey === p.operationKey && receipt.projectDir === p.core.request.projectDir && receipt.stateDir === p.core.request.stateDir && receipt.harness === p.core.request.harness && receipt.previousRevision === p.core.request.expectedPreviousRevision);
  const observed = currentSurfaces(p); check(matches(observed, receipt.installed), 'MANAGED_SKILL_LOCAL_DRIFT');
  if (receipt.state === 'rolled-back') check(matches(observed, p.core.before) && same(receipt.restoredPrevious, p.core.previous)); else check(receipt.restoredPrevious === null && stateMatches(expectedState(state, moves(state).length, 0)));
}
function publishReceipt(state: State, outcome: 'committed' | 'rolled-back', guard: () => void): ObservedSkillReceipt {
  if (state.receipt) { check(state.receipt.state === outcome); terminal(state, state.receipt); return state.receipt; }
  const p = state.intent.plan, body = { format: 'bowerloom/observed-managed-skill-receipt/v1beta1' as const, state: outcome, operationKey: p.operationKey, planRevision: p.revision, previousRevision: p.core.request.expectedPreviousRevision, projectDir: p.core.request.projectDir, stateDir: p.core.request.stateDir, harness: p.core.request.harness, installed: currentSurfaces(p), restoredPrevious: outcome === 'rolled-back' ? p.core.previous : null, executionAuthorized: false as const }, receipt = { ...body, revision: revisionOf(body) };
  const prior = state.records.filter(r => r.kind === 'RECEIPT_INTENT'); check(prior.length <= 1); if (prior.length) check(same(prior[0]!.data, receipt)); else append(state, 'RECEIPT_INTENT', receipt, guard);
  json(join(state.op, 'receipt.json'), receipt, guard); state.receipt = receipt; terminal(state, receipt); append(state, 'RECEIPT_DONE', { revision: receipt.revision }, guard); return receipt;
}
function finish(state: State, outcome: 'committed' | 'rolled-back', guard: () => void): ObservedSkillReceipt {
  const r = publishReceipt(state, outcome, guard), file = join(r.projectDir, MARKER); terminal(state, r);
  if (exists(file)) { marker(state); if (!state.records.some(x => x.kind === 'MARKER_REMOVE_INTENT')) append(state, 'MARKER_REMOVE_INTENT', { receiptRevision: r.revision }, guard); guard(); marker(state); guard(); fs.unlinkSync(file); state.markerRemoved = true; sync(r.projectDir, guard); }
  // A leftover marker temporary of this operation never became a marker: removed only when its bytes are ours.
  discardMarkerTemp(file, pendingText(state), guard);
  return r;
}
function resume(state: State, life: Lifetime, guard: () => void): ObservedSkillReceipt {
  check(!state.records.some(r => r.kind.startsWith('ROLLBACK'))); parents(state, guard); const all = moves(state), completed = prefix(state, false); reconcileDone(state, all.slice(0, completed), false, guard);
  for (const move of all.slice(completed)) { life.check(); executeMove(state, move, false, guard); }
  check(stateMatches(expectedState(state, all.length, 0))); return finish(state, 'committed', guard);
}
function rollback(state: State, life: Lifetime, guard: () => void): ObservedSkillReceipt {
  check(!state.receipt); const starts = state.records.filter(r => r.kind === 'ROLLBACK_START'); check(starts.length <= 1);
  let count: number;
  if (starts.length) { const v = schema<{ count: number }>(starts[0]!.data, ['count']); check(Number.isSafeInteger(v.count) && v.count >= 0 && v.count <= moves(state).length); count = v.count; }
  else { count = prefix(state, false); reconcileDone(state, moves(state).slice(0, count), false, guard); append(state, 'ROLLBACK_START', { count }, guard); }
  const all = reversed(moves(state).slice(0, count)), completed = prefix(state, true, count); reconcileDone(state, all.slice(0, completed), true, guard);
  for (const move of all.slice(completed)) { life.check(); executeMove(state, move, true, guard); }
  check(matches(currentSurfaces(state.intent.plan), state.intent.plan.core.before), 'MANAGED_SKILL_LOCAL_DRIFT'); removeCreatedParents(state, guard); return finish(state, 'rolled-back', guard);
}
export async function applyObservedManagedSkill(value: unknown, exactRevision: string, expectedPreviousRevision: string | null, options: unknown = {}): Promise<ObservedSkillReceipt> {
  const life = lifetime(options); let mutated = false;
  try { const input = request(value); check(typeof exactRevision === 'string' && /^[a-f0-9]{64}$/.test(exactRevision) && expectedPreviousRevision === input.expectedPreviousRevision);
    return await locked(input.projectDir, life, async () => {
      sweepOpTemps(input.stateDir, () => life.check());
      const proposed = await planWithLifetime(input, life); life.check(); check(proposed.format === 'bowerloom/observed-managed-skill-plan/v1beta1' && proposed.revision === exactRevision, 'MANAGED_SKILL_STALE_APPROVAL'); const plan = proposed as ObservedSkillPlan;
      const closure = await readAcquiredSkillCache(input.cache, { signal: life.signal, deadlineMs: life.deadlineMs }); life.check(); check(same(closure, plan.core.closure));
      const op = intentPath(plan); bindings(plan.core, () => life.check()); check(same(currentSurfaces(plan), plan.core.before), 'MANAGED_SKILL_LOCAL_DRIFT');
      for (const p of plan.core.parents) { if (p.identity) check(same(directory(p.path), p.identity)); else if (exists(dirname(p.path))) absent(p.path); }
      const temp = opTemp(input.stateDir, plan.operationKey);
      check(!exists(join(input.projectDir, MARKER)) && !exists(join(input.projectDir, '.bowerloom-revision.json'))); absent(op); absent(temp); check(names(input.stateDir).length < LIMITS.history); capacity(input); life.check();
      // The operation folder appears whole, with its intent, or not at all: built under its private temporary name,
      // then renamed. The rename keeps the inode and birthtime, so the intent's operationIdentity still matches.
      fs.mkdirSync(temp, { mode: 0o700 }); const opIdentity = directory(temp, true);
      const state: State = { op: temp, opIdentity, intent: { format: 'bowerloom/managed-skill-intent/v1beta1', plan, operationIdentity: opIdentity, approvalRevision: exactRevision }, records: [], receipt: null };
      let guard = stateGuard(state, life, null);
      try { json(join(temp, 'intent.json'), state.intent, guard); guard(); absent(op); fs.renameSync(temp, op); }
      catch (e) { try { removeOpTemp(temp, () => {}); } catch { /* A leftover temporary is removed by the next apply. */ } throw e; }
      mutated = true; state.op = op; sync(input.stateDir, guard); guard();
      const markerFile = join(input.projectDir, MARKER); publish(markerFile, pendingBody(plan, opIdentity, hash(raw(join(op, 'intent.json')).bytes)), guard);
      guard = stateGuard(state, life, marker(state)); stageAll(state, life, guard); return resume(state, life, guard);
    });
  } catch (e) { if (mutated) fail('MANAGED_SKILL_RECOVERY_REQUIRED'); return boundary(e); } finally { life.close(); }
}
function snapshot(state: State, life: Lifetime): string {
  const rows: unknown[] = []; let bytes = 0, count = 0;
  const walk = (p: string) => { life.check(); const s = fs.lstatSync(p, { bigint: true }); check(++count < 2048 && !s.isSymbolicLink());
    if (s.isDirectory()) { const id = directory(p, true); rows.push({ path: p, identity: id, mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }); for (const n of names(p)) walk(join(p, n)); }
    else { const got = raw(p, LIMITS.record, (Number(s.mode) & 0o7777) === 0o600); bytes += got.bytes.length; check(bytes <= LIMITS.bytes); rows.push(got.pin); }
  }; walk(state.op); const m = marker(state, state.receipt !== null); rows.push(m); rows.push(currentSurfaces(state.intent.plan)); return revisionOf(rows);
}
async function recoveryWithLife(value: unknown, life: Lifetime): Promise<{ state: State; plan: RecoveryPlan }> {
  const v = schema<{ projectDir: string; stateDir: string; operationKey: string; action: 'resume' | 'rollback' }>(value, ['projectDir', 'stateDir', 'operationKey', 'action']); check(v.action === 'resume' || v.action === 'rollback');
  const state = readState(v.projectDir, v.stateDir, v.operationKey, life); marker(state, state.receipt !== null); parentGuard(state); life.check();
  if (state.receipt) { check(v.action === (state.receipt.state === 'committed' ? 'resume' : 'rollback')); terminal(state, state.receipt); }
  else {
    stages(state); // Incomplete/prestamp stages are held, never adopted.
    for (const r of state.records.filter(x => x.kind === 'PARENT_INTENT')) {
      const v = schema<{ path: string }>(r.data, ['path']);
      check(state.intent.plan.core.parents.some(p => p.path === v.path && p.identity === null));
      check(state.records.filter(x => x.kind === 'PARENT_CREATED' && (x.data as { path: string }).path === v.path).length === 1, 'MANAGED_SKILL_RECOVERY_REQUIRED');
    }
  }
  const body = { format: 'bowerloom/observed-managed-skill-recovery/v1beta1' as const, ...v, snapshotRevision: snapshot(state, life), planRevision: state.intent.plan.revision, writesAuthorized: false as const, executionAuthorized: false as const };
  life.check(); return { state, plan: freezeSkillData({ ...body, revision: revisionOf(body) }) };
}
export async function planObservedManagedSkillRecovery(value: unknown, options: unknown = {}): Promise<RecoveryPlan> { const life = lifetime(options); try { return (await recoveryWithLife(value, life)).plan; } catch (e) { return boundary(e); } finally { life.close(); } }
export async function recoverObservedManagedSkill(value: unknown, exactRevision: string, options: unknown = {}): Promise<ObservedSkillReceipt> {
  const life = lifetime(options);
  try { const plan = schema<RecoveryPlan>(value, ['format', 'projectDir', 'stateDir', 'operationKey', 'action', 'snapshotRevision', 'planRevision', 'writesAuthorized', 'executionAuthorized', 'revision']);
    path(plan.projectDir); path(plan.stateDir); const { revision, ...body } = plan; check(typeof exactRevision === 'string' && exactRevision === revision && /^[a-f0-9]{64}$/.test(revision) && revisionOf(body) === revision && plan.format === 'bowerloom/observed-managed-skill-recovery/v1beta1' && plan.writesAuthorized === false && plan.executionAuthorized === false, 'MANAGED_SKILL_STALE_APPROVAL');
    return await locked(plan.projectDir, life, async () => {
      const fresh = await recoveryWithLife({ projectDir: plan.projectDir, stateDir: plan.stateDir, operationKey: plan.operationKey, action: plan.action }, life); life.check(); check(same(fresh.plan, plan) && exactRevision === plan.revision, 'MANAGED_SKILL_STALE_APPROVAL'); const state = fresh.state; capacity(state.intent.plan.core.request);
      // The approved snapshot saw the marker twin, if any; settling it changes the marker's ctime, so it comes after.
      settleTwin(join(plan.projectDir, MARKER), () => life.check());
      const pending = marker(state, state.receipt !== null), guard = stateGuard(state, life, pending);
      if (state.receipt) { terminal(state, state.receipt); guard(); if (!pending) { discardMarkerTemp(join(plan.projectDir, MARKER), pendingText(state), guard); return state.receipt; } return finish(state, state.receipt.state, guard); }
      return plan.action === 'resume' ? resume(state, life, guard) : rollback(state, life, guard);
    });
  } catch (e) { return boundary(e, 'MANAGED_SKILL_RECOVERY_REQUIRED'); } finally { life.close(); }
}
