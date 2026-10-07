import fs from 'node:fs';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { closed, captureSkillData, freezeSkillData, revisionOf, relativeSkillPath } from '../../skill-sources/src/validation.js';
import { readAcquiredSkillCache } from '../../skill-sources/src/cache.js';
import { projectionFor } from '../../portable/src/harness-projection.js';
import type { AcquiredSkillClosure } from '../../skill-sources/src/cache.js';
import type { Identity, FilePin, Surface, Material, ObservedSkillRequest, PlanCore, ObservedSkillPlan, ObservedSkillReceipt, SkillInspection, UpToDate } from './observed-types.js';
/** A fixed code. Only MANAGED_SKILL_LOCK_SLOT_COLLISION also carries a value, the local port, which its message names. */
export class ManagedSkillError extends Error { constructor(readonly code: string, readonly port?: number) { super(port === undefined ? code : `${code} (local port ${port})`); this.name = 'ManagedSkillError'; } }
export const LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, file: 65536, record: 8 * 1024 * 1024, names: 1024, history: 64, duration: 30000 });
export const POLICY = 'bowerloom/observed-managed-skill/v1beta1' as const;
export const MARKER = '.bowerloom-skills-pending.json';
export const fail = (code: string, port?: number): never => { throw new ManagedSkillError(code, port); };
export function check(ok: unknown, code = 'MANAGED_SKILL_REFUSED'): asserts ok { if (!ok) fail(code); }
export const hash = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');
export const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
export function schema<T>(v: unknown, keys: string[]): T { return closed(v, keys) as T; }
/** Every fixed code a managed-skills boundary can report. MANAGED_SKILL_REFUSED is the default fallback. */
export const MANAGED_SKILL_CODES: readonly string[] = Object.freeze(['MANAGED_SKILL_ABORTED', 'MANAGED_SKILL_TIMEOUT', 'MANAGED_SKILL_LOCKED', 'MANAGED_SKILL_LOCK_SLOT_COLLISION', 'MANAGED_SKILL_LOCAL_DRIFT', 'MANAGED_SKILL_STALE_APPROVAL', 'MANAGED_SKILL_RECOVERY_REQUIRED', 'MANAGED_SKILL_REFUSED']);
export function boundary(error: unknown, fallback = 'MANAGED_SKILL_REFUSED'): never {
  // MANAGED_SKILL_REFUSED is a fallback, not a pass-through code, so the caller's fallback still replaces it.
  return passThrough(error, MANAGED_SKILL_CODES, fallback);
}
/** A listed code other than MANAGED_SKILL_REFUSED passes with its port, if any; everything else takes the fallback. */
export function passThrough(error: unknown, listed: readonly string[], fallback: string): never {
  if (error instanceof ManagedSkillError && error.code !== 'MANAGED_SKILL_REFUSED' && listed.includes(error.code)) return fail(error.code, error.code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION' ? error.port : undefined);
  return fail(fallback);
}
export interface Lifetime { signal: AbortSignal; deadlineMs: number; check(): void; close(): void }
export function lifetime(options: unknown = {}): Lifetime {
  check(options !== null && typeof options === 'object' && !types.isProxy(options));
  const ds = Object.getOwnPropertyDescriptors(options); check([Object.prototype, null].includes(Object.getPrototypeOf(options)) && Reflect.ownKeys(ds).length <= 1 && Reflect.ownKeys(ds).every(k => k === 'signal') && Object.values(ds).every(d => 'value' in d));
  const external = ds.signal?.value as AbortSignal | undefined; check(external === undefined || external instanceof AbortSignal);
  const controller = new AbortController(), deadlineMs = performance.now() + LIMITS.duration;
  const abort = () => controller.abort(); external?.addEventListener('abort', abort, { once: true }); if (external?.aborted) abort();
  const timer = setTimeout(abort, LIMITS.duration); timer.unref();
  return { signal: controller.signal, deadlineMs, check() { check(performance.now() < deadlineMs, 'MANAGED_SKILL_TIMEOUT'); check(!controller.signal.aborted, 'MANAGED_SKILL_ABORTED'); }, close() { clearTimeout(timer); external?.removeEventListener('abort', abort); controller.abort(); } };
}
export function path(value: unknown): asserts value is string {
  check(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' && value === value.normalize('NFC') && Buffer.byteLength(value) <= 2048 && !/[\p{Cc}\p{Cf}\\]/u.test(value));
  check(!value.toLowerCase().split('/').some(p => ['.git', '.ssh', '.config', '.codex', '.claude', '.agents', 'node_modules', 'library'].includes(p)) && !/^\/(?:etc|usr|bin|sbin|system|private\/etc|private\/var\/root)(?:\/|$)/i.test(value));
}
export function identity(s: fs.BigIntStats): Identity { return { device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs), uid: Number(s.uid), mode: Number(s.mode) & 0o7777 }; }
export function directory(p: string, privateMode = false): Identity {
  const s = fs.lstatSync(p, { bigint: true }), id = identity(s); check(s.isDirectory() && !s.isSymbolicLink());
  check(privateMode ? id.uid === process.getuid?.() && id.mode === 0o700 : (id.uid === process.getuid?.() || id.uid === 0) && !(id.mode & 0o7022)); return id;
}
export function ancestry(p: string): { path: string; identity: Identity }[] {
  check(fs.realpathSync(p) === p); const out = []; for (let at = p;; at = dirname(at)) { out.push({ path: at, identity: directory(at) }); if (at === '/') break; } return out;
}
export function exists(p: string): boolean { try { fs.lstatSync(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export function names(p: string): string[] { const out = fs.readdirSync(p); check(out.length <= LIMITS.names && new Set(out.map(x => x.normalize('NFC').toLowerCase())).size === out.length); return out.sort(); }
export function absent(p: string): void { check(!names(dirname(p)).some(x => x.normalize('NFC').toLowerCase() === p.slice(dirname(p).length + 1).normalize('NFC').toLowerCase())); }
/** The private name an operation folder has until its intent is in place: `.op-<key>.tmp`, beside `op-<key>`. */
export const OP_TEMP = /^\.op-[a-f0-9]{64}\.tmp$/;
export const opTemp = (stateDir: string, key: string): string => join(stateDir, '.op-' + key + '.tmp');
/**
 * Removes one operation temporary. It never became an operation, so nothing reads it. Call it only under the project
 * lock. It must be a private folder of this user that holds only `intent.json` and its temporary, each a plain private
 * file of this user with one link; anything else refuses MANAGED_SKILL_RECOVERY_REQUIRED and removes nothing.
 */
export function removeOpTemp(p: string, live: () => void): void {
  live(); check(OP_TEMP.test(p.slice(dirname(p).length + 1))); const id = directory(p, true), entries = names(p);
  check(entries.every(n => n === 'intent.json' || n === '.intent.json.tmp'), 'MANAGED_SKILL_RECOVERY_REQUIRED');
  for (const n of entries) { const s = fs.lstatSync(join(p, n), { bigint: true }); check(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && Number(s.uid) === process.getuid?.() && (Number(s.mode) & 0o7777) === 0o600, 'MANAGED_SKILL_RECOVERY_REQUIRED'); }
  for (const n of entries) { live(); check(same(directory(p, true), id)); fs.unlinkSync(join(p, n)); }
  live(); check(same(directory(p, true), id) && names(p).length === 0); fs.rmdirSync(p);
  const fd = fs.openSync(dirname(p), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } live();
}
/** Removes every leftover operation temporary in a state folder. Only under the project lock. */
export function sweepOpTemps(stateDir: string, live: () => void): void { for (const n of names(stateDir)) if (OP_TEMP.test(n)) removeOpTemp(join(stateDir, n), live); }
export function raw(p: string, max = LIMITS.record, privateMode = true): { bytes: Buffer; pin: FilePin } {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try { const before = fs.fstatSync(fd, { bigint: true }); check(before.isFile() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(max) && Number(before.uid) === process.getuid?.() && (Number(before.mode) & 0o7777) === (privateMode ? 0o600 : 0o644));
    const bytes = Buffer.alloc(Number(before.size)); let at = 0; while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); check(n > 0); at += n; }
    check(fs.readSync(fd, Buffer.alloc(1), 0, 1, null) === 0); const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(p, { bigint: true });
    check(!named.isSymbolicLink() && same(identity(before), identity(after)) && same(identity(before), identity(named)) && before.size === after.size && before.size === named.size && before.mtimeNs === after.mtimeNs && before.mtimeNs === named.mtimeNs && before.ctimeNs === after.ctimeNs && before.ctimeNs === named.ctimeNs);
    return { bytes, pin: { path: p, identity: identity(before), bytes: bytes.length, sha256: hash(bytes), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs) } };
  } finally { fs.closeSync(fd); }
}
export function parsed<T>(p: string, keys: string[]): T { const b = raw(p).bytes; return schema<T>(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(b), LIMITS.record), keys); }
export function tree(p: string, checkLive: () => void = () => {}): FilePin[] {
  const rows: FilePin[] = []; let bytes = 0;
  const visit = (at: string) => { checkLive(); const s = fs.lstatSync(at, { bigint: true }); check(rows.length < 512 && !s.isSymbolicLink());
    if (s.isDirectory()) { const id = directory(at, true); rows.push({ path: at, identity: id, bytes: 0, sha256: null, mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }); for (const name of names(at)) visit(join(at, name)); }
    else { const pin = raw(at, LIMITS.file, false).pin; rows.push(pin); bytes += pin.bytes; check(bytes <= 2 * 1024 * 1024); }
  }; visit(p); return rows;
}
export function surface(kind: Surface['kind'], p: string, live: () => void = () => {}): Surface { return { kind, path: p, pins: !exists(p) ? null : kind === 'catalog' ? [raw(p, 262144, false).pin] : tree(p, live) }; }
// Renames change ctime. Ownership still requires the same inode, birthtime, bytes and modes.
export function stablePins(pins: FilePin[] | null): unknown { return pins?.map(({ ctimeNs: _c, ...pin }) => pin) ?? null; }
export function matches(actual: Surface[], wanted: Surface[]): boolean { return same(actual.map(s => ({ ...s, pins: stablePins(s.pins) })), wanted.map(s => ({ ...s, pins: stablePins(s.pins) }))); }
export function locate(project: string, closure: AcquiredSkillClosure, harness: 'codex' | 'claude'): { kind: Surface['kind']; path: string }[] {
  const skill = closure.receipt.skill; check(/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.id) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name));
  return [{ kind: 'canonical', path: join(project, '.bowerloom-skills/skills', skill.id) }, { kind: 'projection', path: join(project, projectionFor(harness)!.skillRoot, skill.name) }, { kind: 'catalog', path: join(project, '.bowerloom-skills/catalog.json') }];
}
export function request(value: unknown): ObservedSkillRequest {
  const v = schema<ObservedSkillRequest>(value, ['operation', 'projectDir', 'stateDir', 'harness', 'cache', 'expectedPreviousRevision', 'minFreeBytes']); path(v.projectDir); path(v.stateDir);
  check(['install', 'update'].includes(v.operation) && ['codex', 'claude'].includes(v.harness) && (v.expectedPreviousRevision === null || /^[a-f0-9]{64}$/.test(v.expectedPreviousRevision)) && Number.isSafeInteger(v.minFreeBytes) && v.minFreeBytes >= LIMITS.bytes);
  const cache = schema(v.cache, ['root', 'operationId', 'expectedSnapshotRevision', 'expectedReceiptRevision']) as ObservedSkillRequest['cache']; path(cache.root);
  for (const a of [v.projectDir, v.stateDir, cache.root]) for (const b of [v.projectDir, v.stateDir, cache.root]) if (a !== b) check(!a.startsWith(b + '/')); check(new Set([v.projectDir, v.stateDir, cache.root]).size === 3);
  return v;
}
export function bindings(core: PlanCore, live: () => void): void { live(); for (const pin of core.bindings) check(same(directory(pin.path, pin.path === core.request.stateDir), pin.identity)); if (core.previousReceiptPin) check(same(raw(core.previousReceiptPin.path).pin, core.previousReceiptPin)); }
export function retainedBytes(state: string): number {
  const unit = Number(fs.statfsSync(state, { bigint: true }).bsize); check(Number.isSafeInteger(unit) && unit >= 512 && unit <= 65536);
  let total = 0, count = 0; const walk = (p: string) => { const s = fs.lstatSync(p); check(!s.isSymbolicLink() && ++count <= 12000); if (s.isDirectory()) { directory(p, true); total += unit; check(total <= 256 * 1024 * 1024); for (const n of names(p)) walk(join(p, n)); } else { check(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && !(s.mode & 0o022)); total += Math.max(unit, Math.ceil(s.size / unit) * unit); check(total <= 256 * 1024 * 1024); } }; walk(state); return total;
}
export function capacity(v: ObservedSkillRequest): void { const retained = retainedBytes(v.stateDir); const s = fs.statfsSync(v.stateDir, { bigint: true }); check(s.bavail * s.bsize >= BigInt(v.minFreeBytes + LIMITS.bytes)); check(retained + LIMITS.bytes <= 256 * 1024 * 1024); }
export const receiptKeys = ['format', 'state', 'operationKey', 'planRevision', 'previousRevision', 'projectDir', 'stateDir', 'harness', 'installed', 'restoredPrevious', 'revision', 'executionAuthorized'];
export function receiptAt(state: string, key: string): ObservedSkillReceipt {
  check(/^[a-f0-9]{64}$/.test(key)); const op = join(state, 'op-' + key); ancestry(op); directory(op, true); const r = parsed<ObservedSkillReceipt>(join(state, 'op-' + key, 'receipt.json'), receiptKeys), { revision, ...body } = r;
  check(r.format === 'bowerloom/observed-managed-skill-receipt/v1beta1' && ['committed', 'rolled-back'].includes(r.state) && r.operationKey === key && r.executionAuthorized === false && revisionOf(body) === revision); return r;
}
const catalogKeys = ['format', 'operationKey', 'policy', 'source', 'skill', 'license', 'references', 'inventory', 'harness', 'executionAuthorized'];
export function current(project: string, state: string): ObservedSkillReceipt | null {
  const namespace = join(project, '.bowerloom-skills'); if (exists(namespace)) directory(namespace, true); const catalog = join(namespace, 'catalog.json'); if (!exists(catalog)) { check(!exists(namespace), 'MANAGED_SKILL_RECOVERY_REQUIRED'); return null; }
  const c = schema<{ operationKey: string; format: string; policy: string }>(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw(catalog, 262144, false).bytes), 262144), catalogKeys);
  check(c.format === 'bowerloom/observed-managed-skill-catalog/v1beta1' && c.policy === POLICY); const r = receiptAt(state, c.operationKey); check(r.state === 'committed' && r.projectDir === project && r.stateDir === state);
  check(r.installed.length === 3 && r.installed.every(s => ['canonical', 'projection', 'catalog'].includes(s.kind) && s.path.startsWith(project + '/'))); const seen = r.installed.map(s => surface(s.kind, s.path)); check(matches(seen, r.installed), 'MANAGED_SKILL_LOCAL_DRIFT'); return r;
}
export function material(core: PlanCore, operationKey: string): Material[] {
  const c = core.closure; check(c.format === 'bowerloom/acquired-skill-closure/v1beta1' && c.acquisitionObserved === true && c.installAuthorized === false && c.executionAuthorized === false && c.files.length > 0 && c.files.length <= 128);
  let bytes = 0; const paths = new Set<string>();
  for (const f of c.files) { relativeSkillPath(f.path); check(!paths.has(f.path.toLowerCase()) && f.mode === 420 && Buffer.byteLength(f.text) <= LIMITS.file && hash(f.text) === f.sha256); paths.add(f.path.toLowerCase()); bytes += Buffer.byteLength(f.text); } check(bytes <= 2 * 1024 * 1024);
  const files = c.files.map(f => ({ path: f.path, text: f.text, sha256: f.sha256, mode: f.mode }));
  const catalog = { format: 'bowerloom/observed-managed-skill-catalog/v1beta1', operationKey, policy: POLICY, source: c.receipt.source, skill: c.receipt.skill, license: c.receipt.license, references: c.receipt.references, inventory: c.receipt.inventory, harness: core.request.harness, executionAuthorized: false };
  const text = JSON.stringify(catalog) + '\n'; check(Buffer.byteLength(text) <= 262144);
  return [{ kind: 'canonical', files }, { kind: 'projection', files }, { kind: 'catalog', files: [{ path: 'catalog.json', text, sha256: hash(text), mode: 420 }] }];
}
export function materialPins(mat: Material, root: string, pins: FilePin[]): void {
  const files = pins.filter(p => p.sha256 !== null), dirs = pins.filter(p => p.sha256 === null); check(files.length === mat.files.length && dirs.length <= 128);
  const expectedDirs = new Set<string>(); if (mat.kind !== 'catalog') expectedDirs.add(root);
  for (const f of mat.files) {
    const wanted = mat.kind === 'catalog' ? root : join(root, f.path), pin = files.find(p => p.path === wanted);
    check(pin && pin.sha256 === f.sha256 && pin.bytes === Buffer.byteLength(f.text) && pin.identity.mode === f.mode);
    if (mat.kind !== 'catalog') for (let p = dirname(wanted); p === root || p.startsWith(root + '/'); p = dirname(p)) expectedDirs.add(p);
  }
  check(dirs.length === expectedDirs.size && dirs.every(p => expectedDirs.has(p.path) && p.identity.mode === 0o700));
}
export function formPlan(core: PlanCore): ObservedSkillPlan {
  const operationKey = revisionOf(core), body = { format: 'bowerloom/observed-managed-skill-plan/v1beta1' as const, policy: POLICY, core, operationKey, material: material(core, operationKey), acquisitionObserved: true as const, filesystemObserved: true as const, writesAuthorized: false as const, executionAuthorized: false as const };
  return freezeSkillData({ ...body, revision: revisionOf(body) });
}
export function validatePlan(value: unknown): ObservedSkillPlan {
  const p = schema<ObservedSkillPlan>(value, ['format', 'policy', 'core', 'operationKey', 'material', 'acquisitionObserved', 'filesystemObserved', 'writesAuthorized', 'executionAuthorized', 'revision']);
  // Both key sets are valid: `history` is present exactly when the state folder held an operation (see PlanCore).
  const keys = ['request', 'bindings', 'closure', 'before', 'previous', 'previousReceiptPin', 'parents'];
  const core = schema<PlanCore>(p.core, typeof p.core === 'object' && p.core !== null && Object.hasOwn(p.core, 'history') ? [...keys, 'history'] : keys); request(core.request);
  if (core.history !== undefined) {
    const h = core.history; check(Array.isArray(h) && h.length >= 1 && h.length <= LIMITS.history && h.every((k, i) => typeof k === 'string' && /^[a-f0-9]{64}$/.test(k) && (i === 0 || h[i - 1]! < k)));
    if (core.previous) check(h.includes(core.previous.operationKey));
  }
  const ancestors = (root: string) => { const list = [root]; while (list.at(-1) !== '/') list.push(dirname(list.at(-1)!)); return list; };
  const expectedBindings = [...ancestors(core.request.projectDir), ...ancestors(core.request.stateDir)]; check(core.bindings.length === expectedBindings.length && core.bindings.every((b, i) => b.path === expectedBindings[i]));
  const locations = locate(core.request.projectDir, core.closure, core.request.harness);
  check(core.before.length === 3 && core.before.every((s, i) => s.path === locations[i]!.path && s.kind === locations[i]!.kind));
  if (core.previous) check(core.previousReceiptPin?.path === join(core.request.stateDir, 'op-' + core.previous.operationKey, 'receipt.json') && /^[a-f0-9]{64}$/.test(core.previous.operationKey)); else check(core.previousReceiptPin === null);
  const expectedParents = new Set(locations.flatMap(s => { const a: string[] = []; for (let at = dirname(s.path); at !== core.request.projectDir; at = dirname(at)) a.push(at); return a; }));
  check(core.parents.length === expectedParents.size && new Set(core.parents.map(p => p.path)).size === expectedParents.size && core.parents.every(p => expectedParents.has(p.path)) && same(formPlan(core), p)); return p;
}
export async function planWithLifetime(value: unknown, life: Lifetime): Promise<ObservedSkillPlan | UpToDate> {
  const v = request(value); life.check(); const root = directory(v.projectDir), state = directory(v.stateDir, true); check(root.uid === process.getuid?.() && root.device === state.device);
  const pins = [...ancestry(v.projectDir), ...ancestry(v.stateDir)];
  // A leftover `.op-<key>.tmp` never became an operation: plan reads past it, and apply removes it under the lock.
  const history: string[] = [];
  for (const n of names(v.stateDir)) { if (OP_TEMP.test(n)) continue; check(/^op-[a-f0-9]{64}$/.test(n) && exists(join(v.stateDir, n, 'receipt.json')), 'MANAGED_SKILL_RECOVERY_REQUIRED'); const prior = receiptAt(v.stateDir, n.slice(3)); check(prior.projectDir === v.projectDir && prior.stateDir === v.stateDir); history.push(n.slice(3)); } check(!exists(join(v.projectDir, MARKER)) && !exists(join(v.projectDir, '.bowerloom-revision.json')), 'MANAGED_SKILL_RECOVERY_REQUIRED'); capacity(v);
  const closure = await readAcquiredSkillCache(v.cache, { signal: life.signal, deadlineMs: life.deadlineMs }); life.check();
  for (const pin of pins) check(same(directory(pin.path), pin.identity));
  const previous = current(v.projectDir, v.stateDir); check((previous?.revision ?? null) === v.expectedPreviousRevision, 'MANAGED_SKILL_STALE_APPROVAL');
  const locations = locate(v.projectDir, closure, v.harness), before = locations.map(s => surface(s.kind, s.path, () => life.check()));
  const parents = [...new Set(locations.flatMap(s => { const out = []; for (let at = dirname(s.path); at !== v.projectDir; at = dirname(at)) out.push(at); return out; }))].sort((a, b) => a.length - b.length).map(p => ({ path: p, identity: exists(p) ? directory(p) : null }));
  for (const p of parents) if (exists(dirname(p.path))) { names(dirname(p.path)); if (!p.identity) absent(p.path); }
  if (v.operation === 'install') check(previous === null && before.every(s => s.pins === null) && !exists(join(v.projectDir, '.bowerloom-skills')));
  else {
    check(previous !== null && previous.harness === v.harness && matches(before, previous.installed), 'MANAGED_SKILL_LOCAL_DRIFT');
    const catalog = JSON.parse(raw(locations[2]!.path, 262144, false).bytes.toString('utf8'));
    const incoming=closure.receipt.source;
    const sameSource=incoming.kind==='npm'
      ? catalog.source.kind==='npm'&&catalog.source.package===incoming.package&&catalog.source.registry===incoming.registry
      : catalog.source.kind==='git'&&catalog.source.host===incoming.host&&catalog.source.repository===incoming.repository;
    check(sameSource && same(catalog.skill, closure.receipt.skill));
    // Same commit with changed contents/provenance is not a Git update.
    if(incoming.kind==='git'&&catalog.source.commit===incoming.commit) check(same(catalog.source,incoming)&&same(catalog.inventory,closure.receipt.inventory));
    if (same(catalog.source, closure.receipt.source) && same(catalog.inventory, closure.receipt.inventory)) return freezeSkillData({ format: 'bowerloom/managed-skill-up-to-date/v1beta1', status: 'up-to-date', previousRevision: previous.revision, writesAuthorized: false, executionAuthorized: false });
    check(incoming.kind==='npm'?catalog.source.version!==incoming.version:catalog.source.commit!==incoming.commit);
  }
  const core: PlanCore = { request: v, bindings: pins, closure, before, previous, previousReceiptPin: previous ? raw(join(v.stateDir, 'op-' + previous.operationKey, 'receipt.json')).pin : null, parents, ...(history.length ? { history } : {}) }; bindings(core, () => life.check());
  check(!exists(join(v.projectDir, MARKER)) && !exists(join(v.projectDir, '.bowerloom-revision.json'))); return formPlan(core);
}
export async function planObservedManagedSkill(value: unknown, options: unknown = {}): Promise<ObservedSkillPlan | UpToDate> { const life = lifetime(options); try { return await planWithLifetime(value, life); } catch (e) { return boundary(e); } finally { life.close(); } }
export async function inspectObservedManagedSkill(value: unknown): Promise<SkillInspection> {
  try { const detached = captureSkillData(value) as Record<string, unknown>; const v = schema<{ projectDir: string; stateDir: string; operationKey?: string }>(detached, Object.hasOwn(detached, 'operationKey') ? ['projectDir', 'stateDir', 'operationKey'] : ['projectDir', 'stateDir']); path(v.projectDir); path(v.stateDir); ancestry(v.projectDir); ancestry(v.stateDir); directory(v.stateDir, true);
    if (exists(join(v.projectDir, MARKER))) {
      const m = parsed<{ format: string; operationKey: string; stateDir: string; operationIdentity: Identity; intentSha256: string }>(join(v.projectDir, MARKER), ['format', 'operationKey', 'stateDir', 'operationIdentity', 'intentSha256']);
      check(m.format === 'bowerloom/managed-skill-pending/v1beta1' && m.stateDir === v.stateDir && /^[a-f0-9]{64}$/.test(m.operationKey) && (!v.operationKey || v.operationKey === m.operationKey));
      const op = join(v.stateDir, 'op-' + m.operationKey); check(same(directory(op, true), m.operationIdentity) && hash(raw(join(op, 'intent.json')).bytes) === m.intentSha256);
      return { format: 'bowerloom/observed-managed-skill-inspection/v1beta1', status: 'pending', receipt: null, operationKey: m.operationKey, executionAuthorized: false, writesAuthorized: false };
    }
    const receipt = v.operationKey ? receiptAt(v.stateDir, v.operationKey) : current(v.projectDir, v.stateDir);
    if (receipt) {
      check(receipt.projectDir === v.projectDir && receipt.stateDir === v.stateDir); const op = join(v.stateDir, 'op-' + receipt.operationKey);
      const intent = parsed<{ format: string; plan: ObservedSkillPlan; operationIdentity: Identity; approvalRevision: string }>(join(op, 'intent.json'), ['format', 'plan', 'operationIdentity', 'approvalRevision']); const plan = validatePlan(intent.plan);
      check(intent.format === 'bowerloom/managed-skill-intent/v1beta1' && same(directory(op, true), intent.operationIdentity) && receipt.planRevision === plan.revision && intent.approvalRevision === plan.revision);
      bindings(plan.core, () => {}); const actual = plan.core.before.map(s => surface(s.kind, s.path)); check(matches(actual, receipt.installed));
      if (receipt.state === 'rolled-back') check(matches(actual, plan.core.before) && same(receipt.restoredPrevious, plan.core.previous));
      else actual.forEach((s, i) => { check(s.pins !== null); materialPins(plan.material[i]!, s.path, s.pins); });
    }
    return { format: 'bowerloom/observed-managed-skill-inspection/v1beta1', status: receipt?.state ?? 'absent', receipt, operationKey: receipt?.operationKey ?? null, executionAuthorized: false, writesAuthorized: false };
  } catch (e) { return boundary(e); }
}
