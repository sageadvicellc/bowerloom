/**
 * Managed items v1beta2: requests, surfaces, material, the current receipt and planning.
 * Built from the v1beta1 primitives in observed.ts, which stays byte-identical. Each function below that
 * generalizes a v1 function names it, so a reviewer can diff the two side by side.
 */
import fs from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { freezeSkillData, revisionOf, relativeSkillPath } from '../../skill-sources/src/validation.js';
import { readAcquiredSkillCache } from '../../skill-sources/src/cache.js';
import { projectionFor } from '../../portable/src/harness-projection.js';
import { LIMITS, MANAGED_SKILL_CODES, MARKER as V1_MARKER, ManagedSkillError, OP_TEMP, check, fail, passThrough, hash, same, schema, lifetime, path, directory, ancestry, exists, names, raw, parsed, stablePins, retainedBytes } from './observed.js';
import type { Lifetime } from './observed.js';
import { readLocalSkill, readLocalPrompt, itemName } from './local-source.js';
import { LEGACY_NAMESPACE, legacyPresent, readLegacy } from './migrate.js';
import type { AcquiredSkillClosure } from '../../skill-sources/src/cache.js';
import type { Identity, FilePin } from './observed-types.js';
import type { SurfaceId, SurfaceKind, SurfaceV2, MaterialV2, ItemRef, ItemClosure, ManagedItemRequest, PlanCoreV2, ManagedItemPlan, ManagedItemReceipt, UpToDateV2, ManagedProjectInspection, ManagedItemStatus, PendingV2, LegacyCore } from './v2-types.js';

export const POLICY_V2 = 'bowerloom/managed-items/v1beta2' as const;
export const CATALOG_FORMAT = 'bowerloom/managed-catalog/v1beta2' as const;
export const RECEIPT_FORMAT = 'bowerloom/managed-item-receipt/v1beta2' as const;
export const PENDING_FORMAT = 'bowerloom/managed-item-pending/v1beta2' as const;
/** The v2 marker. The plan refuses while it, the v1 marker or `.bowerloom-revision.json` exists. */
export const MARKER_V2 = '.bowerloom/managed-pending.json';
export const MANAGED_ROOT = '.bowerloom/managed';
/** Managed copies and the catalog stay on each machine (Hanna, 2026-10-07): git ignores the whole folder. */
export const IGNORE_TEXT = '*\n';
const HEX64 = /^[a-f0-9]{64}$/;
/** The v1 projection-name rule, kept so every v1 skill name stays valid in v2. */
const PROJECTION_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ITEM_SURFACES: readonly SurfaceId[] = ['canonical', 'catalog', 'projection-claude', 'projection-codex', 'command-claude'];
export const ownSurface = (s: { id: SurfaceId }): boolean => ITEM_SURFACES.includes(s.id);
/** Every fixed v2 code: the v1 list plus four. MANAGED_SKILL_REFUSED stays the fallback. */
export const MANAGED_ITEM_CODES: readonly string[] = Object.freeze([...MANAGED_SKILL_CODES.filter(c => c !== 'MANAGED_SKILL_REFUSED'), 'MANAGED_SKILL_PATH_OCCUPIED', 'MANAGED_SKILL_LEGACY_PRESENT', 'MANAGED_SKILL_HISTORY_FULL', 'MANAGED_SKILL_LOCK_NOT_HELD', 'MANAGED_SKILL_REFUSED']);
/** v1 `boundary` over the v2 code list. */
export function boundaryV2(error: unknown, fallback = 'MANAGED_SKILL_REFUSED'): never {
  return passThrough(error, MANAGED_ITEM_CODES, fallback);
}
export const itemId = (item: ItemRef): string => item.kind === 'prompt' ? 'prompt-' + item.id : item.id;
export function itemRef(value: unknown): ItemRef {
  const item = schema<ItemRef>(value, ['kind', 'id']); check(item.kind === 'skill' || item.kind === 'prompt'); itemName(item.id);
  if (item.kind === 'skill') check(!item.id.startsWith('prompt-')); return item;
}
/** v1 `request`, generalized from one harness and one cache selector to a harness list and an item source. */
export function requestV2(value: unknown): ManagedItemRequest {
  const v = schema<ManagedItemRequest>(value, ['operation', 'projectDir', 'stateDir', 'item', 'harnesses', 'source', 'expectedPreviousRevision', 'minFreeBytes', 'legacy']); path(v.projectDir); path(v.stateDir);
  check(['install', 'update', 'migrate'].includes(v.operation) && (v.expectedPreviousRevision === null || HEX64.test(v.expectedPreviousRevision)) && Number.isSafeInteger(v.minFreeBytes) && v.minFreeBytes >= LIMITS.bytes);
  const item = itemRef(v.item); check(basename(v.stateDir) === itemId(item));
  check(Array.isArray(v.harnesses) && v.harnesses.length >= 1 && v.harnesses.length <= 2 && v.harnesses.every((h, i) => (h === 'claude' || h === 'codex') && (i === 0 || v.harnesses[i - 1]! < h)));
  const roots = [v.projectDir, v.stateDir], source = v.source as { kind: string };
  check(source !== null && typeof source === 'object');
  if (source.kind === 'cache') { const s = schema<{ selector: { root: string } }>(source, ['kind', 'selector']); schema(s.selector, ['root', 'operationId', 'expectedSnapshotRevision', 'expectedReceiptRevision']); path(s.selector.root); check(item.kind === 'skill'); roots.push(s.selector.root); }
  else if (source.kind === 'local') { const s = schema<{ path: string }>(source, ['kind', 'path']); check(item.kind === 'skill' && s.path === 'skills/' + item.id); }
  else if (source.kind === 'prompt') { const s = schema<{ name: string }>(source, ['kind', 'name']); check(item.kind === 'prompt' && s.name === item.id); }
  else fail('MANAGED_SKILL_REFUSED');
  if (v.operation === 'migrate') {
    check(v.legacy !== null && source.kind === 'cache' && v.expectedPreviousRevision === null);
    const legacy = schema<{ stateDir: string; operationKey: string }>(v.legacy, ['stateDir', 'operationKey']); path(legacy.stateDir); check(HEX64.test(legacy.operationKey)); roots.push(legacy.stateDir);
  } else check(v.legacy === null);
  for (const a of roots) for (const b of roots) if (a !== b) check(!a.startsWith(b + '/')); check(new Set(roots).size === roots.length);
  return v;
}
/** v1 `tree`, with the per-file and total bounds as parameters. The legacy namespace adds a v1 catalog of up to 256 KiB. */
export function wideTree(p: string, maxFile: number, checkLive: () => void = () => {}, maxBytes = 2 * 1024 * 1024): FilePin[] {
  const rows: FilePin[] = []; let bytes = 0;
  const visit = (at: string) => { checkLive(); const s = fs.lstatSync(at, { bigint: true }); check(rows.length < 512 && !s.isSymbolicLink());
    if (s.isDirectory()) { const id = directory(at, true); rows.push({ path: at, identity: id, bytes: 0, sha256: null, mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }); for (const name of names(at)) visit(join(at, name)); }
    else { const pin = raw(at, maxFile, false).pin; rows.push(pin); bytes += pin.bytes; check(bytes <= maxBytes); }
  }; visit(p); return rows;
}
/** v1 `surface`: a file surface is one 0644 file of at most 256 KiB, a directory surface is a v1 tree. */
export function surfaceV2(id: SurfaceId, kind: SurfaceKind, p: string, live: () => void = () => {}): SurfaceV2 {
  return { id, kind, path: p, pins: !exists(p) ? null : kind === 'file' ? [raw(p, 262144, false).pin] : (id === 'legacy' ? wideTree(p, 262144, live, 2 * 1024 * 1024 + 262144) : wideTree(p, LIMITS.file, live)) };
}
/** v1 `matches`: identity, bytes and times compared with ctime dropped, exactly where v1 drops it. */
export function matchesV2(actual: SurfaceV2[], wanted: SurfaceV2[]): boolean { return same(actual.map(s => ({ ...s, pins: stablePins(s.pins) })), wanted.map(s => ({ ...s, pins: stablePins(s.pins) }))); }
/** v1 `locate`, from three fixed kinds to the ordered surface list of one item. */
export function locateV2(v: ManagedItemRequest, closure: ItemClosure, extra: { ignore: boolean; legacy: boolean }): { id: SurfaceId; kind: SurfaceKind; path: string }[] {
  const p = v.projectDir, item = v.item, managed = join(p, MANAGED_ROOT), name = closure.name, out: { id: SurfaceId; kind: SurfaceKind; path: string }[] = [];
  check(PROJECTION_NAME.test(name) && !name.startsWith('prompt-') && (item.kind === 'skill' || name === item.id));
  if (extra.ignore) out.push({ id: 'ignore', kind: 'file', path: join(managed, '.gitignore') });
  if (item.kind === 'skill') out.push({ id: 'canonical', kind: 'directory', path: join(managed, 'skills', item.id) });
  if (item.kind === 'skill' && v.harnesses.includes('claude')) out.push({ id: 'projection-claude', kind: 'directory', path: join(p, projectionFor('claude')!.skillRoot, name) });
  if (v.harnesses.includes('codex')) out.push({ id: 'projection-codex', kind: 'directory', path: join(p, projectionFor('codex')!.skillRoot, item.kind === 'prompt' ? 'prompt-' + name : name) });
  if (item.kind === 'prompt' && v.harnesses.includes('claude')) out.push({ id: 'command-claude', kind: 'file', path: join(p, '.claude/commands', name + '.md') });
  out.push({ id: 'catalog', kind: 'file', path: join(managed, 'catalog', itemId(item) + '.json') });
  if (extra.legacy) out.push({ id: 'legacy', kind: 'directory', path: join(p, LEGACY_NAMESPACE) });
  return out;
}
const byPath = <T extends { path: string }>(rows: T[]): T[] => [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
/** A cache closure as v1 `material` checks it, normalized to content only. Third-party bytes are hashed and copied. */
export function cacheClosure(c: Readonly<AcquiredSkillClosure>, item: ItemRef): ItemClosure {
  check(c.format === 'bowerloom/acquired-skill-closure/v1beta1' && c.acquisitionObserved === true && c.installAuthorized === false && c.executionAuthorized === false && item.kind === 'skill' && c.receipt.skill.id === item.id);
  const files = byPath(c.files.map(f => ({ path: f.path, text: f.text, sha256: f.sha256, mode: f.mode })));
  return freezeSkillData({ format: 'bowerloom/managed-item-closure/v1beta2', source: c.receipt.source, skill: c.receipt.skill, license: c.receipt.license, references: c.receipt.references, inventory: files.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.byteLength(f.text) })), files, name: c.receipt.skill.name });
}
export async function readClosure(v: ManagedItemRequest, life: Lifetime): Promise<{ closure: ItemClosure; acquired: Readonly<AcquiredSkillClosure> | null }> {
  const s = v.source;
  if (s.kind === 'cache') { const acquired = await readAcquiredSkillCache(s.selector, { signal: life.signal, deadlineMs: life.deadlineMs }); life.check(); return { closure: cacheClosure(acquired, v.item), acquired }; }
  const local = s.kind === 'local' ? readLocalSkill(v.projectDir, s.path, () => life.check()) : readLocalPrompt(v.projectDir, s.name, () => life.check()); life.check();
  return { closure: freezeSkillData({ format: 'bowerloom/managed-item-closure/v1beta2', source: local.source, skill: null, license: null, references: [], inventory: local.inventory, files: local.files, name: v.item.id }), acquired: null };
}
const wrapper = (name: string, text: string): string => `---\nname: prompt-${name}\ndescription: Bowerloom prompt ${name}, wrapped as a skill for Codex. Edit .bowerloom/prompts/${name}.md, not this file.\n---\n${text}`;
const fileOf = (path: string, text: string) => ({ path, text, sha256: hash(text), mode: 420 });
/** The catalog bytes of one item. Content only: no absolute path, no operation key, no machine data. */
export function catalogText(v: ManagedItemRequest, c: ItemClosure, surfaces: { id: SurfaceId; path: string }[]): string {
  const catalog = { format: CATALOG_FORMAT, policy: POLICY_V2, item: { kind: v.item.kind, id: v.item.id }, source: c.source, skill: c.skill, license: c.license, references: c.references, inventory: c.inventory, harnesses: v.harnesses, surfaces: surfaces.filter(ownSurface).map(s => ({ id: s.id, path: relative(v.projectDir, s.path) })), executionAuthorized: false };
  const text = JSON.stringify(catalog) + '\n'; check(Buffer.byteLength(text) <= 262144); return text;
}
/** v1 `material`: the closure checks are v1's, and each planned surface with content gets its files. */
export function materialV2(core: PlanCoreV2): MaterialV2[] {
  const c = core.closure, v = core.request; check(c.format === 'bowerloom/managed-item-closure/v1beta2' && c.files.length > 0 && c.files.length <= 128 && (v.item.kind === 'skill' || c.files.length === 1));
  let bytes = 0; const paths = new Set<string>();
  for (const f of c.files) { relativeSkillPath(f.path); check(!paths.has(f.path.toLowerCase()) && f.mode === 420 && Buffer.byteLength(f.text) <= LIMITS.file && hash(f.text) === f.sha256); paths.add(f.path.toLowerCase()); bytes += Buffer.byteLength(f.text); } check(bytes <= 2 * 1024 * 1024);
  check(same(c.inventory, c.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.byteLength(f.text) }))));
  const files = c.files.map(f => ({ path: f.path, text: f.text, sha256: f.sha256, mode: f.mode })), text = c.files[0]!.text, out: MaterialV2[] = [];
  for (const s of core.before) {
    if (s.id === 'ignore') out.push({ id: s.id, kind: 'file', files: [fileOf('gitignore', IGNORE_TEXT)] });
    else if (s.id === 'canonical' || s.id === 'projection-claude') out.push({ id: s.id, kind: 'directory', files });
    else if (s.id === 'projection-codex') out.push({ id: s.id, kind: 'directory', files: v.item.kind === 'prompt' ? [fileOf('SKILL.md', wrapper(c.name, text))] : files });
    else if (s.id === 'command-claude') out.push({ id: s.id, kind: 'file', files: [fileOf(c.name + '.md', text)] });
    else if (s.id === 'catalog') out.push({ id: s.id, kind: 'file', files: [fileOf('catalog.json', catalogText(v, c, core.before))] });
  }
  return out;
}
/** v1 `materialPins`, with `kind === 'file'` in place of `kind === 'catalog'`. */
export function materialPinsV2(mat: MaterialV2, root: string, pins: FilePin[]): void {
  const files = pins.filter(p => p.sha256 !== null), dirs = pins.filter(p => p.sha256 === null); check(files.length === mat.files.length && dirs.length <= 128);
  const expectedDirs = new Set<string>(); if (mat.kind !== 'file') expectedDirs.add(root);
  for (const f of mat.files) {
    const wanted = mat.kind === 'file' ? root : join(root, f.path), pin = files.find(p => p.path === wanted);
    check(pin && pin.sha256 === f.sha256 && pin.bytes === Buffer.byteLength(f.text) && pin.identity.mode === f.mode);
    if (mat.kind !== 'file') for (let p = dirname(wanted); p === root || p.startsWith(root + '/'); p = dirname(p)) expectedDirs.add(p);
  }
  check(dirs.length === expectedDirs.size && dirs.every(p => expectedDirs.has(p.path) && p.identity.mode === 0o700));
}
/** v1 `bindings`, plus the bound v1 receipt of a migrate operation. */
export function bindingsV2(core: PlanCoreV2, live: () => void): void {
  live(); for (const pin of core.bindings) check(same(directory(pin.path, pin.path === core.request.stateDir), pin.identity));
  if (core.previousReceiptPin) check(same(raw(core.previousReceiptPin.path).pin, core.previousReceiptPin));
  if (core.legacy) check(same(raw(core.legacy.receiptPin.path).pin, core.legacy.receiptPin));
}
/** v1 `capacity`, unchanged except for the request type. */
export function capacityV2(v: { stateDir: string; minFreeBytes: number }): void { const retained = retainedBytes(v.stateDir); const s = fs.statfsSync(v.stateDir, { bigint: true }); check(s.bavail * s.bsize >= BigInt(v.minFreeBytes + LIMITS.bytes)); check(retained + LIMITS.bytes <= 256 * 1024 * 1024); }
export const receiptKeysV2 = ['format', 'state', 'item', 'operationKey', 'planRevision', 'previousRevision', 'projectDir', 'stateDir', 'harnesses', 'installed', 'restoredPrevious', 'migratedFrom', 'executionAuthorized', 'revision'];
/** v1 `receiptAt`. */
export function receiptAtV2(state: string, key: string): ManagedItemReceipt {
  check(HEX64.test(key)); const op = join(state, 'op-' + key); ancestry(op); directory(op, true); const r = parsed<ManagedItemReceipt>(join(op, 'receipt.json'), receiptKeysV2), { revision, ...body } = r;
  check(r.format === RECEIPT_FORMAT && ['committed', 'rolled-back'].includes(r.state) && r.operationKey === key && r.executionAuthorized === false && revisionOf(body) === revision); return r;
}
const catalogKeys = ['format', 'policy', 'item', 'source', 'skill', 'license', 'references', 'inventory', 'harnesses', 'surfaces', 'executionAuthorized'];
export const catalogPath = (project: string, item: ItemRef): string => join(project, MANAGED_ROOT, 'catalog', itemId(item) + '.json');
/**
 * v1 `current`, without an operation key in the catalog: the current receipt is the one committed receipt whose
 * installed item surfaces match the live surfaces. A catalog with no committed receipt here is not ours.
 */
export function currentV2(project: string, state: string, item: ItemRef): ManagedItemReceipt | null {
  const catalog = catalogPath(project, item); if (!exists(catalog)) return null;
  const c = schema<{ format: string; policy: string; item: unknown }>(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw(catalog, 262144, false).bytes), 262144), catalogKeys);
  check(c.format === CATALOG_FORMAT && c.policy === POLICY_V2 && same(c.item, item));
  const committed = names(state).filter(n => /^op-[a-f0-9]{64}$/.test(n) && exists(join(state, n, 'receipt.json'))).map(n => receiptAtV2(state, n.slice(3)))
    .filter(r => r.state === 'committed' && r.projectDir === project && r.stateDir === state && same(r.item, item));
  check(committed.length > 0, 'MANAGED_SKILL_PATH_OCCUPIED');
  const live = (r: ManagedItemReceipt): boolean => { try { const own = r.installed.filter(ownSurface); check(own.some(s => s.id === 'catalog' && s.path === catalog) && own.every(s => s.path.startsWith(project + '/'))); return matchesV2(own.map(s => surfaceV2(s.id, s.kind, s.path)), own); } catch { return false; } };
  const current = committed.filter(live); check(current.length === 1, 'MANAGED_SKILL_LOCAL_DRIFT'); return current[0]!;
}
/** The shared ignore file is either absent or exactly IGNORE_TEXT in a plain owned 0644 file. */
export function ignoreState(project: string): 'absent' | 'exact' {
  const p = join(project, MANAGED_ROOT, '.gitignore'); if (!exists(p)) return 'absent';
  check(raw(p, 262144, false).bytes.toString('utf8') === IGNORE_TEXT, 'MANAGED_SKILL_PATH_OCCUPIED'); return 'exact';
}
/** No other entry of the parent folder folds to the same name. */
function aliasFree(p: string): boolean { const want = basename(p).normalize('NFC').toLowerCase(); return !names(dirname(p)).some(n => n.normalize('NFC').toLowerCase() === want); }
export function formPlanV2(core: PlanCoreV2): ManagedItemPlan {
  const operationKey = revisionOf(core), body = { format: 'bowerloom/managed-item-plan/v1beta2' as const, policy: POLICY_V2, core, operationKey, material: materialV2(core), filesystemObserved: true as const, writesAuthorized: false as const, executionAuthorized: false as const };
  return freezeSkillData({ ...body, revision: revisionOf(body) });
}
const ancestors = (root: string) => { const list = [root]; while (list.at(-1) !== '/') list.push(dirname(list.at(-1)!)); return list; };
const parentsOf = (project: string, locations: { path: string }[]): string[] => [...new Set(locations.flatMap(s => { const out: string[] = []; for (let at = dirname(s.path); at !== project; at = dirname(at)) out.push(at); return out; }))];
/** v1 `validatePlan`. */
export function validatePlanV2(value: unknown): ManagedItemPlan {
  const p = schema<ManagedItemPlan>(value, ['format', 'policy', 'core', 'operationKey', 'material', 'filesystemObserved', 'writesAuthorized', 'executionAuthorized', 'revision']);
  const core = schema<PlanCoreV2>(p.core, ['request', 'bindings', 'closure', 'before', 'previous', 'previousReceiptPin', 'parents', 'legacy', 'history']); const v = requestV2(core.request);
  check(Array.isArray(core.history) && core.history.length <= LIMITS.history && core.history.every((k, i) => HEX64.test(k) && (i === 0 || core.history[i - 1]! < k)));
  if (core.previous) check(core.history.includes(core.previous.operationKey));
  const expectedBindings = [...ancestors(v.projectDir), ...ancestors(v.stateDir), ...(v.legacy ? ancestors(v.legacy.stateDir) : [])]; check(core.bindings.length === expectedBindings.length && core.bindings.every((b, i) => b.path === expectedBindings[i]));
  const ignore = core.before.some(s => s.id === 'ignore'), locations = locateV2(v, core.closure, { ignore, legacy: v.operation === 'migrate' });
  check(core.before.length === locations.length && core.before.every((s, i) => s.id === locations[i]!.id && s.kind === locations[i]!.kind && s.path === locations[i]!.path));
  check(!ignore || core.before[0]!.pins === null);
  if (core.previous) check(core.previousReceiptPin?.path === join(v.stateDir, 'op-' + core.previous.operationKey, 'receipt.json') && HEX64.test(core.previous.operationKey)); else check(core.previousReceiptPin === null);
  if (v.legacy) { const l = schema<LegacyCore>(core.legacy, ['stateDir', 'operationKey', 'receiptRevision', 'receiptPin', 'harness']); check(l.stateDir === v.legacy.stateDir && l.operationKey === v.legacy.operationKey && l.receiptPin.path === join(l.stateDir, 'op-' + l.operationKey, 'receipt.json') && HEX64.test(l.receiptRevision) && v.harnesses.includes(l.harness)); }
  else check(core.legacy === null);
  const expectedParents = new Set(parentsOf(v.projectDir, locations));
  check(core.parents.length === expectedParents.size && new Set(core.parents.map(x => x.path)).size === expectedParents.size && core.parents.every(x => expectedParents.has(x.path)) && same(formPlanV2(core), p)); return p;
}
/** v1 `planWithLifetime`, generalized. Every v1 check keeps its place; the v2 checks are marked. */
export async function planItemWithLifetime(value: unknown, life: Lifetime): Promise<ManagedItemPlan | UpToDateV2> {
  const v = requestV2(value); life.check(); const root = directory(v.projectDir), state = directory(v.stateDir, true); check(root.uid === process.getuid?.() && root.device === state.device);
  directory(join(v.projectDir, '.bowerloom')); // v2: the project already has a safe `.bowerloom/`.
  const pins = [...ancestry(v.projectDir), ...ancestry(v.stateDir), ...(v.legacy ? ancestry(v.legacy.stateDir) : [])];
  const history: string[] = [];
  // A leftover `.op-<key>.tmp` never became an operation: plan reads past it, and apply removes it under the lock.
  for (const n of names(v.stateDir)) { if (OP_TEMP.test(n)) continue; check(/^op-[a-f0-9]{64}$/.test(n) && exists(join(v.stateDir, n, 'receipt.json')), 'MANAGED_SKILL_RECOVERY_REQUIRED'); const prior = receiptAtV2(v.stateDir, n.slice(3)); check(prior.projectDir === v.projectDir && prior.stateDir === v.stateDir && same(prior.item, v.item)); history.push(n.slice(3)); }
  check(!exists(join(v.projectDir, MARKER_V2)) && !exists(join(v.projectDir, '.bowerloom-revision.json')), 'MANAGED_SKILL_RECOVERY_REQUIRED');
  if (v.operation === 'migrate') check(!exists(join(v.projectDir, V1_MARKER)), 'MANAGED_SKILL_RECOVERY_REQUIRED'); else check(!legacyPresent(v.projectDir), 'MANAGED_SKILL_LEGACY_PRESENT');
  capacityV2(v);
  const { closure, acquired } = await readClosure(v, life); life.check();
  for (const pin of pins) check(same(directory(pin.path), pin.identity));
  const legacy = v.operation === 'migrate' ? await readLegacy(v, acquired!, life) : null; life.check();
  const previous = currentV2(v.projectDir, v.stateDir, v.item); check((previous?.revision ?? null) === v.expectedPreviousRevision, 'MANAGED_SKILL_STALE_APPROVAL');
  const ignoreAbsent = ignoreState(v.projectDir) === 'absent';
  const locations = locateV2(v, closure, { ignore: ignoreAbsent, legacy: legacy !== null }), before = locations.map(s => surfaceV2(s.id, s.kind, s.path, () => life.check()));
  const parents = parentsOf(v.projectDir, locations).sort((a, b) => a.length - b.length).map(p => ({ path: p, identity: exists(p) ? directory(p) : null }));
  for (const p of parents) if (exists(dirname(p.path))) { names(dirname(p.path)); if (!p.identity) check(aliasFree(p.path), 'MANAGED_SKILL_PATH_OCCUPIED'); }
  for (const s of before) if (s.pins === null && exists(dirname(s.path))) check(aliasFree(s.path), 'MANAGED_SKILL_PATH_OCCUPIED');
  if (v.operation === 'install') check(previous === null && before.every(s => s.pins === null), 'MANAGED_SKILL_PATH_OCCUPIED');
  else if (v.operation === 'migrate') {
    // v2: the only occupied item surface may be the v1 projection, unchanged since the v1 receipt.
    check(previous === null && before.at(-1)!.id === 'legacy' && before.at(-1)!.pins !== null);
    for (const s of before.filter(ownSurface)) check(s.pins === null || (s.path === legacy!.projection.path && same(stablePins(s.pins), stablePins(legacy!.projection.pins))), 'MANAGED_SKILL_PATH_OCCUPIED');
  } else {
    check(previous !== null && previous.harnesses.every(h => v.harnesses.includes(h)));
    const kept = previous.installed.filter(ownSurface);
    check(kept.every(s => before.some(b => b.id === s.id && b.path === s.path)) && matchesV2(kept.map(s => before.find(b => b.id === s.id)!), kept), 'MANAGED_SKILL_LOCAL_DRIFT');
    for (const s of before.filter(b => ownSurface(b) && !kept.some(k => k.id === b.id))) check(s.pins === null, 'MANAGED_SKILL_PATH_OCCUPIED');
    const catalog = schema<{ source: { kind: string; package?: string; registry?: string; host?: string; repository?: string; version?: string; commit?: string }; skill: unknown; inventory: unknown }>(strictJson(raw(catalogPath(v.projectDir, v.item), 262144, false).bytes.toString('utf8'), 262144), catalogKeys);
    const incoming = closure.source as typeof catalog.source, was = catalog.source;
    const sameSource = incoming.kind === was.kind && (incoming.kind === 'npm' ? was.package === incoming.package && was.registry === incoming.registry : incoming.kind === 'git' ? was.host === incoming.host && was.repository === incoming.repository : same(was, incoming));
    check(sameSource && same(catalog.skill, closure.skill));
    // Same commit or same npm version with changed contents or provenance is not an update.
    if ((incoming.kind === 'git' && was.commit === incoming.commit) || (incoming.kind === 'npm' && was.version === incoming.version)) check(same(was, incoming) && same(catalog.inventory, closure.inventory));
    if (!ignoreAbsent && raw(catalogPath(v.projectDir, v.item), 262144, false).bytes.toString('utf8') === catalogText(v, closure, locations)) return freezeSkillData({ format: 'bowerloom/managed-item-up-to-date/v1beta2', status: 'up-to-date', item: v.item, previousRevision: previous.revision, writesAuthorized: false, executionAuthorized: false });
  }
  const core: PlanCoreV2 = { request: v, bindings: pins, closure, before, previous, previousReceiptPin: previous ? raw(join(v.stateDir, 'op-' + previous.operationKey, 'receipt.json')).pin : null, parents, legacy: legacy?.core ?? null, history }; bindingsV2(core, () => life.check());
  check(!exists(join(v.projectDir, MARKER_V2)) && !exists(join(v.projectDir, '.bowerloom-revision.json'))); if (v.operation !== 'migrate') check(!legacyPresent(v.projectDir), 'MANAGED_SKILL_LEGACY_PRESENT');
  return formPlanV2(core);
}
export async function planManagedItem(req: unknown, options: unknown = {}): Promise<ManagedItemPlan | UpToDateV2> { const life = lifetime(options); try { return await planItemWithLifetime(req, life); } catch (e) { return boundaryV2(e); } finally { life.close(); } }
const pendingKeys = ['format', 'item', 'operationKey', 'stateDir', 'operationIdentity', 'intentSha256'];
export function readPending(project: string): PendingV2 {
  const m = parsed<PendingV2>(join(project, MARKER_V2), pendingKeys); itemRef(m.item); path(m.stateDir);
  check(m.format === PENDING_FORMAT && HEX64.test(m.operationKey) && HEX64.test(m.intentSha256)); return m;
}
/** Item refs from catalog file names: `<id>.json` for a skill, `prompt-<id>.json` for a prompt. */
export function catalogItem(name: string): ItemRef {
  const m = /^(prompt-)?([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(name); check(m !== null);
  return itemRef(m[1] ? { kind: 'prompt', id: m[2]! } : { kind: 'skill', id: m[2]! });
}
/** Status of every managed item and of the project's markers. Reads only. */
export function inspectManagedProject(projectDir: string, itemsRoot: string): ManagedProjectInspection {
  try {
    path(projectDir); path(itemsRoot); ancestry(projectDir); ancestry(itemsRoot); directory(itemsRoot, true); directory(join(projectDir, '.bowerloom'));
    let pending: ManagedProjectInspection['pending'] = null;
    if (exists(join(projectDir, MARKER_V2))) { const m = readPending(projectDir); check(dirname(m.stateDir) === itemsRoot && basename(m.stateDir) === itemId(m.item)); pending = { item: m.item, operationKey: m.operationKey, stateDir: m.stateDir }; }
    const items: ManagedItemStatus[] = [], catalogs = join(projectDir, MANAGED_ROOT, 'catalog');
    if (exists(catalogs)) {
      directory(catalogs);
      for (const n of names(catalogs)) {
        const item = catalogItem(n), state = join(itemsRoot, itemId(item));
        if (!exists(state)) { items.push({ item, status: 'unowned', receiptRevision: null, code: 'MANAGED_SKILL_PATH_OCCUPIED' }); continue; }
        try { directory(state, true); const r = currentV2(projectDir, state, item); check(r !== null); items.push({ item, status: 'committed', receiptRevision: r.revision, code: null }); }
        catch (e) { const code = e instanceof ManagedSkillError && MANAGED_ITEM_CODES.includes(e.code) ? e.code : 'MANAGED_SKILL_REFUSED'; items.push({ item, status: code === 'MANAGED_SKILL_LOCAL_DRIFT' ? 'drift' : code === 'MANAGED_SKILL_PATH_OCCUPIED' ? 'unowned' : 'refused', receiptRevision: null, code }); }
      }
    }
    return freezeSkillData({ format: 'bowerloom/managed-project-inspection/v1beta2', legacy: legacyPresent(projectDir), pending, items, writesAuthorized: false, executionAuthorized: false });
  } catch (e) { return boundaryV2(e); }
}
/**
 * What a v1beta1 write route (apply, recovery) must find absent: an unfinished v1beta2 operation (`pending`) or
 * v1beta2 managed content (`managed`). Reads only. The project and `.bowerloom` pass the product's folder guards
 * (no symlink, a folder, owner or root, no group or world write); the two names are checked with lstat, so an
 * entry of any type counts and a link is never followed.
 */
export function managedV2State(projectDir: unknown): 'absent' | 'pending' | 'managed' {
  path(projectDir); ancestry(projectDir); const bowerloom = join(projectDir, '.bowerloom'); if (!exists(bowerloom)) return 'absent';
  const pin = directory(bowerloom), pending = exists(join(projectDir, MARKER_V2)), managed = exists(join(projectDir, MANAGED_ROOT));
  check(same(directory(bowerloom), pin)); return pending ? 'pending' : managed ? 'managed' : 'absent';
}
export type { Identity };
