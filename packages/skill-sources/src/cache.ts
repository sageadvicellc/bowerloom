import fs from 'node:fs';
import { types as utilTypes } from 'node:util';
import { dirname, isAbsolute, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, closed, captureSkillData, freezeSkillData, revisionOf } from './validation.js';
import { NPM_LIMITS, NpmAcquisitionError, npmCheck, npmRefuse, sha256, validateNpmPlan, verifyNpmPayload } from './npm.js';
import type { NpmAcquisitionPlan, ObservedNpmPayload, ExpectedSkillFile } from './npm.js';
import { GitAcquisitionError, gitFixedCode, listedGitCode, validateGitPlan, verifyGitPayload } from './git.js';
import type { GitAcquisitionPlan, ObservedGitPayload } from './git.js';
type AcquisitionPlan = NpmAcquisitionPlan | GitAcquisitionPlan;
type ObservedPayload = ObservedNpmPayload | ObservedGitPayload;
function isGit(plan:AcquisitionPlan):plan is GitAcquisitionPlan{return plan.format==='bowerloom/git-acquisition-plan/v1beta2';}
// Both Git formats go to the Git validator, which refuses the retired v1beta1 format with GIT_PLAN_CHANGED.
const GIT_PLAN_FORMATS=Object.freeze(['bowerloom/git-acquisition-plan/v1beta1','bowerloom/git-acquisition-plan/v1beta2']);
function validateCachePlan(value:unknown):Readonly<AcquisitionPlan>{const v=captureSkillData(value) as Record<string,unknown>;return GIT_PLAN_FORMATS.includes(v?.format as string)?validateGitPlan(v):validateNpmPlan(v);}
function dataName(plan:AcquisitionPlan):string{return isGit(plan)?'payload.json':'archive.tgz';}
function recordFormat(plan:AcquisitionPlan):RecordBody['format']{return isGit(plan)?'bowerloom/git-cache-record/v1beta1':'bowerloom/npm-cache-record/v1beta1';}
function inspectionFormat(plan:AcquisitionPlan):CacheInspection['format']{return isGit(plan)?'bowerloom/git-cache-inspection/v1beta1':'bowerloom/npm-cache-inspection/v1beta1';}
function recoveryFormat(plan:AcquisitionPlan):CacheRecoveryPlan['format']{return isGit(plan)?'bowerloom/git-cache-recovery-plan/v1beta1':'bowerloom/npm-cache-recovery-plan/v1beta1';}
async function verifyPayload(plan:AcquisitionPlan,metadata:Buffer,data:Buffer,signal:AbortSignal,check:()=>void):Promise<Readonly<ObservedPayload>>{return isGit(plan)?verifyGitPayload(plan,metadata,data,signal,check):verifyNpmPayload(plan,metadata,data,signal,check);}


export interface CacheIdentity { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }
export interface SkillCacheBinding { root: string; operationId: string; minFreeBytes: number; ancestors: { path: string; identity: CacheIdentity }[] }
export interface AcquiredSkillCacheReceipt {
  format: 'bowerloom/acquired-skill-cache/v1beta1'; planRevision: string; operationId: string; operationIdentity: CacheIdentity;
  source: ObservedPayload['source']; skill: ObservedNpmPayload['skill']; inventory: ExpectedSkillFile[];
  license: ObservedNpmPayload['license']; references: ObservedNpmPayload['references']; contentRevision: string; inventoryRevision: string; recordCount: number;
  publisherAuthenticated: false; installAuthorized: false; executionAuthorized: false; revision: string;
}
type Phase = 'PREPARED' | 'RECEIVING' | 'VERIFIED' | 'COMPLETED' | 'HELD';
interface RecordBody { format: 'bowerloom/npm-cache-record/v1beta1' | 'bowerloom/git-cache-record/v1beta1'; phase: Phase; previous: string | null; planRevision: string; payload: unknown }
interface PhaseRecord extends RecordBody { revision: string }
interface Pin { path: string; identity: CacheIdentity; size: number; mtimeNs: string; ctimeNs: string; sha256: string | null }
export interface CacheInspection { format: 'bowerloom/npm-cache-inspection/v1beta1' | 'bowerloom/git-cache-inspection/v1beta1'; status: Phase; activeOwner: boolean; snapshotRevision: string; planRevision: string; receipt: Readonly<AcquiredSkillCacheReceipt> | null; installAuthorized: false; executionAuthorized: false }
export interface CacheRecoveryPlan { format: 'bowerloom/npm-cache-recovery-plan/v1beta1' | 'bowerloom/git-cache-recovery-plan/v1beta1'; action: 'finalize' | 'hold'; root: string; operationId: string; snapshotRevision: string; originalPlanRevision: string; revision: string }
function same(a: unknown, b: unknown): boolean { return revisionOf(a) === revisionOf(b); }
// One shared list of fixed refusal codes. The npm and Git modules import it.
// A boundary keeps an inner code only when its own list names that code. Any other error,
// including a TypeError or a raw fault, gets the boundary's fixed fallback code.
const codes = (...lists: (readonly string[])[]): readonly string[] => Object.freeze([...new Set(lists.flat())]);
/** Fixed cache guard codes. Each one names the guard that refused. */
export const CACHE_GUARD_CODES = codes(['NPM_CACHE_CHANGED', 'NPM_CACHE_FILE', 'NPM_CACHE_INVENTORY', 'NPM_CACHE_RECORD', 'NPM_CACHE_BOUND', 'NPM_CACHE_DIRECTORY', 'NPM_CACHE_PATH', 'NPM_CACHE_SPACE']);
/** A caller cancellation, an elapsed deadline, and a use after release. */
export const STOP_CODES = codes(['NPM_ABORTED', 'NPM_TIMEOUT', 'NPM_CACHE_RELEASED']);
/** Fixed npm payload verification codes. */
export const NPM_PAYLOAD_CODES = codes(['NPM_METADATA', 'NPM_ARCHIVE_BOUND', 'NPM_INTEGRITY', 'NPM_ENCODING', 'NPM_CONTENT', 'NPM_SELECTED_INVENTORY', 'NPM_PLAN_CHANGED', 'NPM_COMPRESSION', 'NPM_TAR_BOUND', 'NPM_TAR_TYPE', 'NPM_TAR_ALIAS', 'NPM_TAR_FIELD', 'NPM_TAR_SIGNATURE', 'NPM_TAR_NUMBER', 'NPM_TAR_PATH', 'NPM_TAR_CHECKSUM', 'NPM_TAR_DECODER', 'NPM_TAR_COLLISION', 'NPM_TAR_END']);
/** Secondary codes. Each reports cleanup that a refusal could not confirm. */
export const SECONDARY_CODES = codes(['NPM_CACHE_HOLD_UNCERTAIN', 'NPM_CACHE_NOT_HELD', 'NPM_CACHE_OPEN_PARTIAL', 'NPM_CACHE_RELEASE_UNCERTAIN']);
const PLAN_CODES = codes(['NPM_INPUT', 'NPM_PLAN_CHANGED', 'NPM_CACHE_INPUT', 'NPM_CACHE_PATH']);
const READ_CODES = codes(CACHE_GUARD_CODES, ['NPM_CACHE_INPUT', 'NPM_ABORTED', 'NPM_TIMEOUT']);
const OPEN_CODES = codes(CACHE_GUARD_CODES, STOP_CODES, ['NPM_CACHE_EXISTS', 'NPM_APPROVAL']);
/** The codes that each boundary may report as certain. */
export const REFUSAL_CODES = Object.freeze({
  plan: PLAN_CODES,
  binding: codes(['NPM_CACHE_PATH', 'NPM_CACHE_DIRECTORY', 'NPM_CACHE_INPUT']),
  // Read-only boundaries: inspection, recovery planning and promotion. Payload verification codes use the fallback.
  read: READ_CODES,
  open: OPEN_CODES,
  receiving: codes(STOP_CODES, ['NPM_CACHE_PHASE']),
  stage: codes(CACHE_GUARD_CODES, STOP_CODES, NPM_PAYLOAD_CODES, ['NPM_CACHE_PHASE']),
  // Completion before its marker write begins.
  complete: codes(CACHE_GUARD_CODES, STOP_CODES, ['NPM_CACHE_PHASE']),
  // Recovery before its owner-lock write begins.
  recovery: codes(READ_CODES, ['NPM_CACHE_RECOVERY_STALE', 'NPM_CACHE_RECOVERY_REFUSED']),
  recover: codes(READ_CODES, ['NPM_CACHE_RECOVERY_STALE', 'NPM_CACHE_RECOVERY_REFUSED', 'NPM_CACHE_RECOVERY_UNCERTAIN']),
  acquire: codes(PLAN_CODES, OPEN_CODES, NPM_PAYLOAD_CODES, ['NPM_PLAN_REFUSED', 'NPM_DNS', 'NPM_NONPUBLIC_ADDRESS', 'NPM_NETWORK', 'NPM_RESPONSE', 'NPM_RESPONSE_BOUND', 'NPM_REQUEST_BOUND', 'NPM_CACHE_OPEN_REFUSED', 'NPM_CACHE_PHASE', 'NPM_CACHE_RECEIVING_REFUSED', 'NPM_CACHE_STAGE_REFUSED', 'NPM_CACHE_COMPLETE_REFUSED', 'NPM_CACHE_COMPLETE_UNCERTAIN']),
});
/** Explicit Git names for every cache code that can reach the Git API. */
const GIT_CACHE_CODE_MAP: ReadonlyMap<string, string> = new Map([
  ['NPM_CACHE_CHANGED', 'GIT_CACHE_CHANGED'], ['NPM_CACHE_FILE', 'GIT_CACHE_FILE'], ['NPM_CACHE_INVENTORY', 'GIT_CACHE_INVENTORY'], ['NPM_CACHE_RECORD', 'GIT_CACHE_RECORD'],
  ['NPM_CACHE_BOUND', 'GIT_CACHE_BOUND'], ['NPM_CACHE_DIRECTORY', 'GIT_CACHE_DIRECTORY'], ['NPM_CACHE_PATH', 'GIT_CACHE_PATH'], ['NPM_CACHE_SPACE', 'GIT_CACHE_SPACE'],
  ['NPM_CACHE_INPUT', 'GIT_CACHE_INPUT'], ['NPM_CACHE_PHASE', 'GIT_CACHE_PHASE'], ['NPM_CACHE_EXISTS', 'GIT_CACHE_EXISTS'], ['NPM_CACHE_RELEASED', 'GIT_CACHE_RELEASED'],
  ['NPM_CACHE_OPEN_REFUSED', 'GIT_CACHE_OPEN_REFUSED'], ['NPM_CACHE_RECEIVING_REFUSED', 'GIT_CACHE_RECEIVING_REFUSED'], ['NPM_CACHE_STAGE_REFUSED', 'GIT_CACHE_STAGE_REFUSED'],
  ['NPM_CACHE_COMPLETE_REFUSED', 'GIT_CACHE_COMPLETE_REFUSED'], ['NPM_CACHE_COMPLETE_UNCERTAIN', 'GIT_CACHE_COMPLETE_UNCERTAIN'],
  ['NPM_CACHE_HOLD_UNCERTAIN', 'GIT_CACHE_HOLD_UNCERTAIN'], ['NPM_CACHE_NOT_HELD', 'GIT_CACHE_NOT_HELD'], ['NPM_CACHE_OPEN_PARTIAL', 'GIT_CACHE_OPEN_PARTIAL'], ['NPM_CACHE_RELEASE_UNCERTAIN', 'GIT_CACHE_RELEASE_UNCERTAIN'],
  ['NPM_ABORTED', 'GIT_ABORTED'], ['NPM_TIMEOUT', 'GIT_TIMEOUT'], ['NPM_APPROVAL', 'GIT_APPROVAL'], ['NPM_METADATA', 'GIT_METADATA'], ['NPM_ARCHIVE_BOUND', 'GIT_BOUND'],
]);
const GIT_CACHE_SOURCES = codes([...GIT_CACHE_CODE_MAP.keys()]);
export const GIT_CACHE_CODES = Object.freeze([...GIT_CACHE_CODE_MAP].map(pair => Object.freeze(pair))) as readonly (readonly [string, string])[];
/** Every fixed Git code. The cache codes come from the explicit map above. */
export const GIT_CODES = codes(['GIT_ABORTED', 'GIT_ACQUISITION_FAILED', 'GIT_APPROVAL', 'GIT_BASE64', 'GIT_BLOB', 'GIT_BLOB_DIGEST', 'GIT_BOUND', 'GIT_CONTENT', 'GIT_DNS', 'GIT_ENCODING', 'GIT_INPUT', 'GIT_METADATA', 'GIT_NETWORK', 'GIT_OUTSIDE_PATH', 'GIT_PATH_DEPTH', 'GIT_PATH_DIGEST', 'GIT_PATH_MISSING', 'GIT_PATH_TYPE', 'GIT_PLAN_CHANGED', 'GIT_PLAN_REFUSED', 'GIT_NONPUBLIC_ADDRESS', 'GIT_REQUEST_BOUND', 'GIT_RESPONSE', 'GIT_RESPONSE_BOUND', 'GIT_SELECTED_INVENTORY', 'GIT_SUBMODULE', 'GIT_SYMLINK', 'GIT_TIMEOUT', 'GIT_TREE', 'GIT_TREE_BOUND', 'GIT_TREE_DIGEST'], [...GIT_CACHE_CODE_MAP.values()]);
export const GIT_PLAN_CODES = codes(['GIT_INPUT', 'GIT_PLAN_CHANGED', 'GIT_PATH_DEPTH', 'GIT_OUTSIDE_PATH', 'GIT_REQUEST_BOUND', 'GIT_CACHE_INPUT', 'GIT_CACHE_PATH']);
export const GIT_SECONDARY_CODES = codes(SECONDARY_CODES.map(code => GIT_CACHE_CODE_MAP.get(code)!));
/** Reads an NpmAcquisitionError code once. It survives only when `listed` names it. Anything else gets the fallback. */
export function fixedCode(error: unknown, listed: readonly string[], fallback: string): string {
  let code: unknown;
  // A forged error can throw from a prototype trap or a code getter. That fault gets the fallback too.
  try { if (!(error instanceof NpmAcquisitionError)) return fallback; code = error.code; } catch { return fallback; }
  return typeof code === 'string' && listed.includes(code) ? code : fallback;
}
/** The explicit Git name of a fixed cache code, or null. */
export function gitCacheName(code: string): string | null { return GIT_CACHE_CODE_MAP.get(code) ?? null; }
/** The fixed Git name of a mapped cache refusal, or null. */
export function gitCacheCode(error: unknown): string | null { const code = fixedCode(error, GIT_CACHE_SOURCES, ''); return code === '' ? null : GIT_CACHE_CODE_MAP.get(code)!; }
/** The listed secondary codes of a refusal, as npm or Git names. A malformed list is dropped. */
export function secondaryCodes(error: unknown, git = false): string[] {
  const found = listedSecondary(error, SECONDARY_CODES); return git ? found.map(code => GIT_CACHE_CODE_MAP.get(code)!) : found;
}
function listedSecondary(error: unknown, allowed: readonly string[]): string[] {
  if (error === null || typeof error !== 'object' || utilTypes.isProxy(error)) return [];
  try {
    if (!(error instanceof NpmAcquisitionError || error instanceof GitAcquisitionError)) return [];
    const list: unknown = error.secondary;
    return Array.isArray(list) && !utilTypes.isProxy(list) ? list.filter((code): code is string => typeof code === 'string' && allowed.includes(code)) : [];
  } catch { return []; }
}
const NONE = Object.freeze({ uncertain: false, codes: Object.freeze([]) as readonly string[] });
/** Every fixed npm code that a boundary can report, including each fallback. */
export const NPM_CODES = codes(...Object.values(REFUSAL_CODES), SECONDARY_CODES, ['NPM_CACHE_BINDING_REFUSED', 'NPM_CACHE_INSPECTION_REFUSED', 'NPM_CACHE_PROMOTION_REFUSED', 'NPM_ACQUISITION_FAILED']);
/**
 * A command-line summary of a refusal. Only listed fixed codes appear. A refusal is uncertain when its code ends in
 * _UNCERTAIN or it carries any secondary code. A raw, foreign or unlisted error gives no codes and is not uncertain.
 */
export function refusalSummary(error: unknown): Readonly<{ uncertain: boolean; codes: readonly string[] }> {
  if (error === null || typeof error !== 'object' || utilTypes.isProxy(error)) return NONE;
  let primary: string | null;
  try { primary = error instanceof GitAcquisitionError ? gitFixedCode(error) : fixedCode(error, NPM_CODES, '') || null; } catch { return NONE; }
  if (primary === null) return NONE;
  const secondary = primary.startsWith('GIT_') ? listedSecondary(error, GIT_SECONDARY_CODES) : listedSecondary(error, SECONDARY_CODES);
  return Object.freeze({ uncertain: primary.endsWith('_UNCERTAIN') || secondary.length > 0, codes: Object.freeze([primary, ...secondary]) });
}
/** Strict UTF-8 decoding. A fatal decoding refusal returns null. Any other error is rethrown. */
export function strictUtf8(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { if (error instanceof TypeError && (error as { code?: unknown }).code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return null; throw error; }
}
// A listed Git verification code passes through, as it does in staging. Read-only refusals are certain.
function passGit(error: unknown): void { const git = listedGitCode(error); if (git !== null) throw new GitAcquisitionError(git); }
function readRefusal(error: unknown, fallback: string): never { passGit(error); return npmRefuse(fixedCode(error, REFUSAL_CODES.read, fallback)); }
function schema<T>(value: unknown, keys: string[], code = 'NPM_CACHE_INPUT'): T { try { return closed(value, keys) as T; } catch (error) { if (error instanceof SkillSourceError) return npmRefuse(code); throw error; } }
function identity(s: fs.BigIntStats): CacheIdentity { return { device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs), uid: Number(s.uid), mode: Number(s.mode) & 0o7777 }; }
function safePath(value: unknown): asserts value is string {
  npmCheck(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value === value.normalize('NFC') && Buffer.byteLength(value) <= 2048 && !/[\p{Cc}\p{Cf}]/u.test(value), 'NPM_CACHE_PATH');
  npmCheck(!value.toLowerCase().split('/').some(p => ['.ssh', '.codex', '.claude', '.config', '.git', 'library'].includes(p)) && !/^\/(?:etc|usr|bin|sbin|system|private\/etc|private\/var\/root)(?:\/|$)/i.test(value), 'NPM_CACHE_PATH');
}
function parseIdentity(value: unknown, code = 'NPM_CACHE_INPUT'): CacheIdentity {
  const v = schema<CacheIdentity>(value, ['device', 'inode', 'birthtimeNs', 'uid', 'mode'], code);
  npmCheck([v.device, v.inode, v.birthtimeNs].every(x => typeof x === 'string' && /^\d+$/.test(x)) && Number.isSafeInteger(v.uid) && v.uid >= 0 && Number.isSafeInteger(v.mode) && v.mode >= 0 && v.mode <= 0o7777, code); return v;
}
function dirs(root: string): string[] { const found = [root]; while (found.at(-1) !== '/') found.push(dirname(found.at(-1)!)); return found; }
// Only the current user or root may own non-writable ancestors. Sticky/shared
// temporary directories receive no exception. The selected root stays exactly 0700.
function safeDirectoryIdentity(pin: CacheIdentity, privateMode: boolean): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && (privateMode ? pin.uid === uid && pin.mode === 0o700 : (pin.uid === uid || pin.uid === 0) && (pin.mode & 0o7022) === 0);
}
// A Node system error from lstat, such as a missing directory, is the directory guard's own observation.
function systemError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, syscall } = error as NodeJS.ErrnoException; return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) && typeof syscall === 'string';
}
function directory(path: string, privateMode = false): CacheIdentity {
  let s: fs.BigIntStats; try { s = fs.lstatSync(path, { bigint: true }); } catch (error) { if (systemError(error)) return npmRefuse('NPM_CACHE_DIRECTORY'); throw error; }
  const pin = identity(s); npmCheck(s.isDirectory() && !s.isSymbolicLink() && safeDirectoryIdentity(pin, privateMode), 'NPM_CACHE_DIRECTORY'); return pin;
}
/** Read-only binding capture. No directories are created by planning. */
export function observeSkillCacheRoot(root: string, operationId: string, minFreeBytes: number): Readonly<SkillCacheBinding> {
  try { safePath(root); npmCheck(fs.realpathSync(root) === root, 'NPM_CACHE_PATH');
    return validateCacheBinding({ root, operationId, minFreeBytes, ancestors: dirs(root).map(path => ({ path, identity: directory(path, path === root) })) });
  } catch (error) { return npmRefuse(fixedCode(error, REFUSAL_CODES.binding, 'NPM_CACHE_BINDING_REFUSED')); }
}
export function validateCacheBinding(value: unknown): Readonly<SkillCacheBinding> {
  const v = schema<SkillCacheBinding>(value, ['root', 'operationId', 'minFreeBytes', 'ancestors']); safePath(v.root);
  npmCheck(typeof v.operationId === 'string' && /^[a-f0-9]{32}$/.test(v.operationId) && Number.isSafeInteger(v.minFreeBytes) && v.minFreeBytes >= NPM_LIMITS.storageBytes && Array.isArray(v.ancestors), 'NPM_CACHE_INPUT');
  const expected = dirs(v.root); npmCheck(v.ancestors.length === expected.length, 'NPM_CACHE_INPUT');
  v.ancestors = v.ancestors.map((raw, i) => { const a = schema<{ path: string; identity: CacheIdentity }>(raw, ['path', 'identity']); npmCheck(a.path === expected[i], 'NPM_CACHE_INPUT'); const pin = parseIdentity(a.identity); npmCheck(safeDirectoryIdentity(pin, i === 0), 'NPM_CACHE_INPUT'); return { path: a.path, identity: pin }; });
  npmCheck(v.ancestors[0]!.identity.uid === process.getuid?.() && v.ancestors[0]!.identity.mode === 0o700, 'NPM_CACHE_INPUT'); return freezeSkillData(v);
}
function bindingMatches(v: SkillCacheBinding): void { try { for (const a of v.ancestors) npmCheck(same(directory(a.path, a.path === v.root), a.identity), 'NPM_CACHE_CHANGED'); } catch (error) { if (error instanceof NpmAcquisitionError) npmRefuse('NPM_CACHE_CHANGED'); throw error; } }
// A statfs fault is not a space refusal. It reaches the boundary's fixed fallback.
function allocationUnit(root: string): number { const unit = Number(fs.statfsSync(root, { bigint: true }).bsize); npmCheck(Number.isSafeInteger(unit) && unit >= 512 && unit <= 65536, 'NPM_CACHE_SPACE'); return unit; }
function storageCost(pins: Pin[], unit: number): number { return pins.reduce((sum, p) => sum + (p.sha256 === null ? unit : Math.max(unit, Math.ceil(p.size / unit) * unit)), 0); }
function freeSpace(v: SkillCacheBinding, growth: number): void {
  const stats = fs.statfsSync(v.root, { bigint: true }); npmCheck(stats.bavail * stats.bsize >= BigInt(v.minFreeBytes) + BigInt(growth), 'NPM_CACHE_SPACE');
}
function syncDir(path: string): void { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function regular(path: string, max: number): { bytes: Buffer; pin: Pin } {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true }); npmCheck(before.isFile() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(max) && Number(before.uid) === process.getuid?.() && (Number(before.mode) & 0o7777) === 0o600, 'NPM_CACHE_FILE');
    const bytes = Buffer.alloc(Number(before.size)); let at = 0;
    while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); npmCheck(n > 0, 'NPM_CACHE_CHANGED'); at += n; }
    const probe = Buffer.alloc(1); npmCheck(fs.readSync(fd, probe, 0, 1, null) === 0, 'NPM_CACHE_CHANGED');
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(path, { bigint: true });
    npmCheck(!named.isSymbolicLink() && same(identity(before), identity(after)) && same(identity(before), identity(named)) && before.size === after.size && before.size === named.size && before.mtimeNs === after.mtimeNs && before.mtimeNs === named.mtimeNs && before.ctimeNs === after.ctimeNs && before.ctimeNs === named.ctimeNs, 'NPM_CACHE_CHANGED');
    return { bytes, pin: { path, identity: identity(before), size: bytes.length, mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs), sha256: sha256(bytes) } };
  } finally { fs.closeSync(fd); }
}
function immutableFile(path: string, bytes: Buffer, check: () => void): void {
  check(); const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { check(); fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, bytes); check(); fs.fsyncSync(fd); check(); }
  finally { fs.closeSync(fd); }
  check(); syncDir(dirname(path)); check();
}
function recordBytes(body: RecordBody): Buffer { return Buffer.from(JSON.stringify({ ...body, revision: revisionOf(body) }) + '\n'); }
function recordFile(index: number, phase: Phase): string { return `${String(index).padStart(2, '0')}-${phase}.json`; }
function receipt(plan: AcquisitionPlan, opIdentity: CacheIdentity, payload: Readonly<ObservedPayload>): Readonly<AcquiredSkillCacheReceipt> {
  const body = { format: 'bowerloom/acquired-skill-cache/v1beta1' as const, planRevision: plan.revision, operationId: plan.cache.operationId, operationIdentity: opIdentity, source: payload.source, skill: payload.skill, inventory: plan.request.files, license: payload.license, references: payload.references, contentRevision: payload.contentRevision, inventoryRevision: payload.inventoryRevision, recordCount: payload.recordCount, publisherAuthenticated: false as const, installAuthorized: false as const, executionAuthorized: false as const };
  return freezeSkillData({ ...body, revision: revisionOf(body) });
}
function allowedPaths(plan: AcquisitionPlan): Map<string, number> {
  const allowed = new Map<string, number>([['owner.lock', 256], ['metadata.json', NPM_LIMITS.metadataBytes], [dataName(plan), NPM_LIMITS.compressedBytes], ['files', -1]]);
  for (let i = 0; i < 5; i++) for (const p of ['PREPARED', 'RECEIVING', 'VERIFIED', 'COMPLETED', 'HELD'] as Phase[]) allowed.set(recordFile(i, p), 262144);
  for (const file of plan.request.files) { let path = `files/${file.path}`; allowed.set(path, NPM_LIMITS.fileBytes); for (path = dirname(path); path !== '.'; path = dirname(path)) allowed.set(path, -1); }
  npmCheck(allowed.size <= 1200, 'NPM_CACHE_BOUND'); return allowed;
}
function scan(op: string, allowed: Map<string, number>): Pin[] {
  const pins: Pin[] = []; let total = 0;
  function visit(path: string, relative: string): void {
    const s = fs.lstatSync(path, { bigint: true });
    if (s.isDirectory()) {
      npmCheck(relative === '' || allowed.get(relative) === -1, 'NPM_CACHE_INVENTORY'); directory(path, true);
      pins.push({ path, identity: identity(s), size: 0, mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs), sha256: null });
      const names = fs.readdirSync(path); npmCheck(names.length <= 1200 && pins.length + names.length <= 1400, 'NPM_CACHE_BOUND');
      for (const name of names.sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else {
      const max = allowed.get(relative); npmCheck(max !== undefined && max >= 0, 'NPM_CACHE_INVENTORY'); const read = regular(path, max); pins.push(read.pin); total += read.bytes.length; npmCheck(total <= NPM_LIMITS.storageBytes, 'NPM_CACHE_BOUND');
    }
  }
  visit(op, ''); return pins;
}
function assertPins(pins: Pin[]): void {
  for (const pin of pins) { const s = fs.lstatSync(pin.path, { bigint: true }); npmCheck(!s.isSymbolicLink() && same(identity(s), pin.identity) && String(s.mtimeNs) === pin.mtimeNs && String(s.ctimeNs) === pin.ctimeNs && (pin.sha256 === null ? s.isDirectory() : s.isFile() && s.nlink === 1n && s.size === BigInt(pin.size)), 'NPM_CACHE_CHANGED'); }
}
function parseRecord(path: string): PhaseRecord {
  const read = regular(path, 262144); const text = strictUtf8(read.bytes); npmCheck(text !== null, 'NPM_CACHE_RECORD');
  let parsed: unknown; try { parsed = strictJson(text, 262144); } catch (error) { if (error instanceof AdapterError) return npmRefuse('NPM_CACHE_RECORD'); throw error; }
  const r = schema<PhaseRecord>(parsed, ['format', 'phase', 'previous', 'planRevision', 'payload', 'revision'], 'NPM_CACHE_RECORD');
  const { revision, ...body } = r; npmCheck(['bowerloom/npm-cache-record/v1beta1','bowerloom/git-cache-record/v1beta1'].includes(r.format) && revisionOf(body) === revision, 'NPM_CACHE_RECORD'); return r;
}
function address(value: unknown): { root: string; operationId: string; op: string } {
  const v = schema<{ root: string; operationId: string }>(value, ['root', 'operationId']); safePath(v.root); npmCheck(typeof v.operationId === 'string' && /^[a-f0-9]{32}$/.test(v.operationId), 'NPM_CACHE_INPUT');
  npmCheck(fs.realpathSync(v.root) === v.root, 'NPM_CACHE_PATH'); dirs(v.root).forEach(p => directory(p, p === v.root)); return { ...v, op: join(v.root, 'op-' + v.operationId) };
}
interface Loaded { plan: Readonly<AcquisitionPlan>; op: string; opIdentity: CacheIdentity; records: PhaseRecord[]; pins: Pin[]; activeOwner: boolean; snapshotRevision: string }
function load(value: unknown): Loaded {
  const a = address(value); const opIdentity = directory(a.op, true);
  // A folder without its first record, such as a partial open, is a record refusal. No recovery can read it.
  const firstPath = join(a.op, recordFile(0, 'PREPARED')); let firstPin: Pin;
  try { firstPin = regular(firstPath, 262144).pin; } catch (error) { if (systemError(error) && (error as NodeJS.ErrnoException).code === 'ENOENT') return npmRefuse('NPM_CACHE_RECORD'); throw error; }
  const first = parseRecord(firstPath);
  // The first record is stored data, not caller input. A malformed payload or plan is a record refusal.
  const p = schema<{ plan: AcquisitionPlan; operationIdentity: CacheIdentity }>(first.payload, ['plan', 'operationIdentity'], 'NPM_CACHE_RECORD');
  let plan: Readonly<AcquisitionPlan>;
  try { plan = validateCachePlan(p.plan); } catch (error) {
    // A planning fault keeps its fixed fallback, so a TypeError never reads as a record refusal.
    // A retired v1beta1 Git plan keeps GIT_PLAN_CHANGED, so the user sees why the cache refuses closed.
    if (fixedCode(error, ['NPM_PLAN_REFUSED'], '') !== '' || ['GIT_PLAN_REFUSED', 'GIT_PLAN_CHANGED'].includes(listedGitCode(error) ?? '')) throw error;
    if (error instanceof NpmAcquisitionError || error instanceof GitAcquisitionError || error instanceof SkillSourceError) return npmRefuse('NPM_CACHE_RECORD'); throw error;
  }
  npmCheck(plan.cache.root === a.root && plan.cache.operationId === a.operationId && same(parseIdentity(p.operationIdentity, 'NPM_CACHE_RECORD'), opIdentity), 'NPM_CACHE_CHANGED'); bindingMatches(plan.cache);
  const pins = scan(a.op, allowedPaths(plan)); const names = pins.filter(pin => /^\d\d-[A-Z]+\.json$/.test(pin.path.slice(a.op.length + 1))).map(pin => pin.path).sort();
  const records = names.map(parseRecord); npmCheck(records.length > 0 && records.length <= 5, 'NPM_CACHE_RECORD');
  const order = ['PREPARED', 'RECEIVING', 'VERIFIED', 'COMPLETED'];
  records.forEach((r, i) => { npmCheck(r.format === recordFormat(plan) && names[i] === join(a.op, recordFile(i, r.phase)) && r.planRevision === plan.revision && r.previous === (i ? records[i - 1]!.revision : null) && (r.phase === order[i] || r.phase === 'HELD' && i > 0 && i === records.length - 1 && records[i - 1]!.phase !== 'COMPLETED'), 'NPM_CACHE_RECORD'); if (r.phase === 'RECEIVING' || r.phase === 'HELD') npmCheck(r.payload === null, 'NPM_CACHE_RECORD'); });
  npmCheck(records[0]!.phase === 'PREPARED' && same(records[0], first), 'NPM_CACHE_RECORD'); assertPins([firstPin]); assertPins(pins); bindingMatches(plan.cache); npmCheck(storageCost(pins, allocationUnit(plan.cache.root)) <= NPM_LIMITS.storageBytes, 'NPM_CACHE_BOUND');
  return { plan, op: a.op, opIdentity, records, pins, activeOwner: pins.some(pin => pin.path === join(a.op, 'owner.lock')), snapshotRevision: revisionOf({ planRevision: plan.revision, pins }) };
}
async function verifyStored(state: Loaded, signal: AbortSignal, check: () => void): Promise<Readonly<AcquiredSkillCacheReceipt>> {
  check(); assertPins(state.pins);
  const metadata = regular(join(state.op, 'metadata.json'), NPM_LIMITS.metadataBytes).bytes, archive = regular(join(state.op, dataName(state.plan)), NPM_LIMITS.compressedBytes).bytes;
  const payload = await verifyPayload(state.plan, metadata, archive, signal, check); check();
  for (const file of payload.files) { const bytes = regular(join(state.op, 'files', file.path), NPM_LIMITS.fileBytes).bytes; npmCheck(bytes.equals(Buffer.from(file.text)), 'NPM_CACHE_CHANGED'); }
  const result = receipt(state.plan, state.opIdentity, payload);
  for (const record of state.records) if (record.phase === 'VERIFIED' || record.phase === 'COMPLETED') npmCheck(same(record.payload, result), 'NPM_CACHE_RECORD');
  assertPins(state.pins); bindingMatches(state.plan.cache); check(); return result;
}
async function inspect(value: unknown): Promise<{ state: Loaded; result: Readonly<CacheInspection> }> {
  const state = load(value), status = state.records.at(-1)!.phase; const controller = new AbortController(); const end = performance.now() + NPM_LIMITS.durationMs;
  const timer = setTimeout(() => controller.abort(), NPM_LIMITS.durationMs); timer.unref();
  const check = () => { npmCheck(!controller.signal.aborted && performance.now() < end, 'NPM_TIMEOUT'); bindingMatches(state.plan.cache); };
  try {
    const result = status === 'VERIFIED' || status === 'COMPLETED' ? await verifyStored(state, controller.signal, check) : null;
    check(); assertPins(state.pins);
    return { state, result: freezeSkillData({ format: inspectionFormat(state.plan), status, activeOwner: state.activeOwner, snapshotRevision: state.snapshotRevision, planRevision: state.plan.revision, receipt: status === 'COMPLETED' ? result : null, installAuthorized: false, executionAuthorized: false }) };
  } finally { clearTimeout(timer); controller.abort(); }
}
export async function inspectSkillCache(value: unknown): Promise<Readonly<CacheInspection>> {
  try { return (await inspect(value)).result; } catch (error) { return readRefusal(error, 'NPM_CACHE_INSPECTION_REFUSED'); }
}

/** Internal capability. It validates real bytes itself, not a caller-provided success object. */
export function openNpmCacheOperation(planValue: unknown, approvalRevision: string, signal: AbortSignal) {
  return openCacheOperation(validateNpmPlan(planValue),approvalRevision,signal);
}
export function openGitCacheOperation(planValue:unknown,approvalRevision:string,signal:AbortSignal){
  return openCacheOperation(validateGitPlan(planValue),approvalRevision,signal);
}
function openCacheOperation(planValue:unknown,approvalRevision:string,signal:AbortSignal){
  let release = (): boolean => false, lockAttempted = false, opCreated = false;
  try {
  const plan = validateCachePlan(planValue); npmCheck(approvalRevision === plan.revision && signal instanceof AbortSignal, 'NPM_APPROVAL'); npmCheck(!signal.aborted, 'NPM_ABORTED');
  bindingMatches(plan.cache); freeSpace(plan.cache, NPM_LIMITS.storageBytes);
  const op = join(plan.cache.root, 'op-' + plan.cache.operationId); const end = performance.now() + NPM_LIMITS.durationMs; let released = false, releaseConfirmed = false, opIdentity: CacheIdentity | undefined, lockIdentity: CacheIdentity | undefined, storedBytes = allocationUnit(plan.cache.root); const unit = storedBytes; let records: PhaseRecord[] = []; const ownedDirectories = new Map<string, CacheIdentity>();
  // The cache guards only. HELD uses this alone, so a stop or an elapsed deadline still leaves a held operation.
  const guard = () => { bindingMatches(plan.cache); if (opIdentity) npmCheck(same(directory(op, true), opIdentity), 'NPM_CACHE_CHANGED'); for (const [path, pin] of ownedDirectories) npmCheck(same(directory(path, true), pin), 'NPM_CACHE_CHANGED'); if (lockIdentity) npmCheck(same(regular(join(op, 'owner.lock'), 256).pin.identity, lockIdentity), 'NPM_CACHE_CHANGED'); };
  const check = () => { npmCheck(!released, 'NPM_CACHE_RELEASED'); npmCheck(!signal.aborted, 'NPM_ABORTED'); npmCheck(performance.now() < end, 'NPM_TIMEOUT'); guard(); };
  const write = (name: string, bytes: Buffer, live = check, begin = () => {}) => { live(); npmCheck((storedBytes += Math.max(unit, Math.ceil(bytes.length / unit) * unit)) <= NPM_LIMITS.storageBytes, 'NPM_CACHE_BOUND'); freeSpace(plan.cache, bytes.length); begin(); immutableFile(join(op, name), bytes, live); };
  // A record write that fails can leave a partial record file. The flag then stays set, so no record ever lands beside it.
  let appending = false;
  const append = (phase: Phase, payload: unknown, live = check) => { npmCheck(!appending, 'NPM_CACHE_PHASE'); const body: RecordBody = { format: recordFormat(plan), phase, previous: records.at(-1)?.revision ?? null, planRevision: plan.revision, payload }; const bytes = recordBytes(body); write(recordFile(records.length, phase), bytes, live, () => { appending = true; }); records.push({ ...body, revision: revisionOf(body) }); appending = false; };
  release = () => {
    if (released) return releaseConfirmed; released = true;
    // Unknown ownership stays held, and a replacement is never unlinked. The caller reports an unconfirmed release.
    if (opIdentity && lockIdentity) try { bindingMatches(plan.cache); npmCheck(same(directory(op, true), opIdentity), 'NPM_CACHE_CHANGED'); const locked = regular(join(op, 'owner.lock'), 256); npmCheck(same(locked.pin.identity, lockIdentity), 'NPM_CACHE_CHANGED'); fs.unlinkSync(join(op, 'owner.lock')); syncDir(op); releaseConfirmed = true; } catch { releaseConfirmed = false; }
    return releaseConfirmed;
  };
    check(); npmCheck(!fs.readdirSync(plan.cache.root).some(name => name.toLowerCase() === ('op-' + plan.cache.operationId)), 'NPM_CACHE_EXISTS');
    check(); fs.mkdirSync(op, { mode: 0o700 }); opCreated = true; opIdentity = directory(op, true); syncDir(plan.cache.root); check();
    lockAttempted = true; write('owner.lock', Buffer.from(randomUUID() + '\n')); lockIdentity = regular(join(op, 'owner.lock'), 256).pin.identity;
    append('PREPARED', { plan, operationIdentity: opIdentity });
  let payloadReceipt: Readonly<AcquiredSkillCacheReceipt> | undefined; let markerAttempted = false;
  return {
    check,
    /** True once the COMPLETED marker write has begun. Any later stop or fault leaves completion uncertain. */
    completionBegun(): boolean { return markerAttempted; },
    receiving(): void {
      try { check(); npmCheck(records.at(-1)?.phase === 'PREPARED', 'NPM_CACHE_PHASE'); append('RECEIVING', null); }
      catch (error) { npmRefuse(fixedCode(error, REFUSAL_CODES.receiving, 'NPM_CACHE_RECEIVING_REFUSED')); }
    },
    async stage(metadata: Buffer, archive: Buffer, cancellation: AbortSignal): Promise<void> {
      try { check(); npmCheck(records.at(-1)?.phase === 'RECEIVING', 'NPM_CACHE_PHASE');
      npmCheck(Buffer.isBuffer(metadata) && metadata.length > 0 && metadata.length <= NPM_LIMITS.metadataBytes, 'NPM_METADATA');
      npmCheck(Buffer.isBuffer(archive) && archive.length > 0 && archive.length <= NPM_LIMITS.compressedBytes, 'NPM_ARCHIVE_BOUND');
      const metaCopy = Buffer.from(metadata), archiveCopy = Buffer.from(archive);
      const payload = await verifyPayload(plan, metaCopy, archiveCopy, cancellation, check); check();
      write('metadata.json', metaCopy); write(dataName(plan), archiveCopy);
      const directories = [...allowedPaths(plan)].filter(([, max]) => max === -1).map(([path]) => path).sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
      for (const path of directories) { check(); npmCheck((storedBytes += unit) <= NPM_LIMITS.storageBytes, 'NPM_CACHE_BOUND'); freeSpace(plan.cache, unit); fs.mkdirSync(join(op, path), { mode: 0o700 }); ownedDirectories.set(join(op, path), directory(join(op, path), true)); syncDir(dirname(join(op, path))); check(); }
      for (const file of payload.files) write('files/' + file.path, Buffer.from(file.text));
      payloadReceipt = receipt(plan, opIdentity!, payload); append('VERIFIED', payloadReceipt);
      } catch (error) {
        // A listed Git verification code passes through unchanged. The Git module reports it under its own name.
        const git = listedGitCode(error); if (git !== null) throw new GitAcquisitionError(git);
        return npmRefuse(fixedCode(error, REFUSAL_CODES.stage, 'NPM_CACHE_STAGE_REFUSED'));
      }
    },
    async complete(cancellation: AbortSignal): Promise<Readonly<AcquiredSkillCacheReceipt>> {
      try { check(); npmCheck(records.at(-1)?.phase === 'VERIFIED' && payloadReceipt, 'NPM_CACHE_PHASE'); const state = load({ root: plan.cache.root, operationId: plan.cache.operationId });
      const verified = await verifyStored(state, cancellation, check); check();
      // Set before append on purpose. A fault inside append can follow bytes that reached disk, so the flag errs toward uncertain.
      markerAttempted = true; append('COMPLETED', verified);
      const final = load({ root: plan.cache.root, operationId: plan.cache.operationId }); const result = await verifyStored(final, cancellation, check); check(); return result;
      } catch (error) {
        // Before the marker write begins, completion is read-only: the refusal is certain and the operation stays VERIFIED.
        if (markerAttempted) return npmRefuse('NPM_CACHE_COMPLETE_UNCERTAIN');
        return npmRefuse(fixedCode(error, REFUSAL_CODES.complete, 'NPM_CACHE_COMPLETE_REFUSED'));
      }
    },
    /**
     * Returns null when the operation is held or needs no HELD record. Otherwise it returns a fixed secondary code.
     * NPM_CACHE_HOLD_UNCERTAIN: a record write began and did not finish, so nothing is written beside it.
     * NPM_CACHE_NOT_HELD: no HELD record was written, and the operation keeps its earlier phase.
     */
    hold(): string | null {
      const last = records.at(-1)?.phase;
      // A verified but unacknowledged final write can be inspected/recovered; do not overwrite it.
      if (last === 'COMPLETED' || last === 'HELD' || last === 'VERIFIED') return null;
      if (appending) return 'NPM_CACHE_HOLD_UNCERTAIN';
      if (released) return 'NPM_CACHE_NOT_HELD';
      // Cleanup path: any fault becomes a fixed secondary code, and partial state is never repaired automatically.
      try { guard(); } catch { return 'NPM_CACHE_NOT_HELD'; }
      try { append('HELD', null, guard); return null; } catch { return appending ? 'NPM_CACHE_HOLD_UNCERTAIN' : 'NPM_CACHE_NOT_HELD'; }
    },
    release,
  };
  } catch (error) {
    const confirmed = release();
    // Once the operation folder exists, a later retry meets NPM_CACHE_EXISTS. The secondary code says so.
    return npmRefuse(fixedCode(error, REFUSAL_CODES.open, 'NPM_CACHE_OPEN_REFUSED'), [...(opCreated ? ['NPM_CACHE_OPEN_PARTIAL'] : []), ...(lockAttempted && !confirmed ? ['NPM_CACHE_RELEASE_UNCERTAIN'] : [])]);
  }
}
async function planRecovery(value: unknown): Promise<Readonly<CacheRecoveryPlan>> {
  const input = schema<{ root: string; operationId: string; action: 'finalize' | 'hold' }>(value, ['root', 'operationId', 'action']);
  npmCheck(input.action === 'finalize' || input.action === 'hold', 'NPM_CACHE_INPUT');
  const { state, result } = await inspect({ root: input.root, operationId: input.operationId });
  npmCheck(!result.activeOwner && (input.action === 'finalize' ? result.status === 'VERIFIED' : ['PREPARED', 'RECEIVING'].includes(result.status)), 'NPM_CACHE_RECOVERY_REFUSED');
  const body = { format: recoveryFormat(state.plan), ...input, snapshotRevision: result.snapshotRevision, originalPlanRevision: state.plan.revision }; return freezeSkillData({ ...body, revision: revisionOf(body) });
}
async function recover(value: unknown, approvalRevision: string): Promise<Readonly<CacheInspection>> {
  // Every step before the owner-lock write is read-only, so its refusal is certain.
  let plan: CacheRecoveryPlan, state: Loaded;
  try {
    plan = schema<CacheRecoveryPlan>(value, ['format', 'action', 'root', 'operationId', 'snapshotRevision', 'originalPlanRevision', 'revision']);
    const fresh = await planSkillCacheRecovery({ root: plan.root, operationId: plan.operationId, action: plan.action });
    npmCheck(same(fresh, plan) && approvalRevision === fresh.revision, 'NPM_CACHE_RECOVERY_STALE');
    state = load({ root: plan.root, operationId: plan.operationId }); npmCheck(state.snapshotRevision === plan.snapshotRevision && !state.activeOwner, 'NPM_CACHE_RECOVERY_STALE');
  } catch (error) { passGit(error); return npmRefuse(fixedCode(error, REFUSAL_CODES.recovery, 'NPM_CACHE_RECOVERY_REFUSED')); }
  const lock = join(state.op, 'owner.lock'); let lockIdentity: CacheIdentity | undefined; let released = false, lockAttempted = false, failure: string | undefined; const controller = new AbortController(); const deadline = performance.now() + NPM_LIMITS.durationMs;
  const timer = setTimeout(() => controller.abort(), NPM_LIMITS.durationMs); timer.unref();
  const check = () => { npmCheck(!controller.signal.aborted && performance.now() < deadline, 'NPM_TIMEOUT'); bindingMatches(state.plan.cache); npmCheck(same(directory(state.op, true), state.opIdentity), 'NPM_CACHE_CHANGED'); if (lockIdentity) npmCheck(same(regular(lock, 256).pin.identity, lockIdentity), 'NPM_CACHE_CHANGED'); };
  try {
    check(); assertPins(state.pins); lockAttempted = true; immutableFile(lock, Buffer.from(randomUUID() + '\n'), check); lockIdentity = regular(lock, 256).pin.identity;
    const owned = load({ root: plan.root, operationId: plan.operationId }); npmCheck(same(owned.records, state.records), 'NPM_CACHE_RECOVERY_STALE');
    // The expected owner-lock changes the directory stamp. All original non-directory bytes stay pinned.
    assertPins(state.pins.filter(p => p.sha256 !== null));
    const result = plan.action === 'finalize' ? await verifyStored(owned, controller.signal, check) : null;
    check(); const body: RecordBody = { format: recordFormat(state.plan), phase: plan.action === 'finalize' ? 'COMPLETED' : 'HELD', previous: owned.records.at(-1)!.revision, planRevision: state.plan.revision, payload: result };
    const bytes = recordBytes(body); npmCheck(storageCost(owned.pins, allocationUnit(state.plan.cache.root)) + Math.max(allocationUnit(state.plan.cache.root), Math.ceil(bytes.length / allocationUnit(state.plan.cache.root)) * allocationUnit(state.plan.cache.root)) <= NPM_LIMITS.storageBytes, 'NPM_CACHE_BOUND'); freeSpace(state.plan.cache, bytes.length);
    check(); immutableFile(join(state.op, recordFile(owned.records.length, body.phase)), bytes, check); check();
  } catch (error) {
    // Before the lock write nothing changed. After it, only a stale journal is certain, and only once the lock is released.
    // A Git verification code can arise only after the lock write, so it reaches the UNCERTAIN fallback.
    failure = lockAttempted ? fixedCode(error, ['NPM_CACHE_RECOVERY_STALE'], 'NPM_CACHE_RECOVERY_UNCERTAIN') : fixedCode(error, REFUSAL_CODES.recovery, 'NPM_CACHE_RECOVERY_REFUSED');
  }
  finally {
    clearTimeout(timer); controller.abort();
    if (lockIdentity) try { bindingMatches(state.plan.cache); npmCheck(same(directory(state.op, true), state.opIdentity), 'NPM_CACHE_CHANGED'); npmCheck(same(regular(lock, 256).pin.identity, lockIdentity), 'NPM_CACHE_CHANGED'); fs.unlinkSync(lock); syncDir(state.op); released = true; } catch { /* Keep unknown locks. The refusal below reports them. */ }
  }
  if (lockAttempted && !released) return npmRefuse('NPM_CACHE_RECOVERY_UNCERTAIN', ['NPM_CACHE_RELEASE_UNCERTAIN']);
  if (failure !== undefined) return npmRefuse(failure);
  // The terminal record is written. A refusal to read it back leaves the outcome uncertain.
  try { return await inspectSkillCache({ root: plan.root, operationId: plan.operationId }); } catch (error) { if (error instanceof NpmAcquisitionError || error instanceof GitAcquisitionError) return npmRefuse('NPM_CACHE_RECOVERY_UNCERTAIN'); throw error; }
}

export async function planSkillCacheRecovery(value: unknown): Promise<Readonly<CacheRecoveryPlan>> {
  try { return await planRecovery(value); } catch (error) { return readRefusal(error, 'NPM_CACHE_RECOVERY_REFUSED'); }
}
export async function recoverSkillCache(value: unknown, approvalRevision: string): Promise<Readonly<CacheInspection>> {
  // A Git code reaches this boundary only from the read-only steps before the lock write, so it is certain.
  try { return await recover(value, approvalRevision); } catch (error) { passGit(error); return npmRefuse(fixedCode(error, REFUSAL_CODES.recover, 'NPM_CACHE_RECOVERY_UNCERTAIN'), secondaryCodes(error)); }
}

export interface AcquiredSkillCacheSelector { root: string; operationId: string; expectedSnapshotRevision: string; expectedReceiptRevision: string }
export interface AcquiredSkillClosure {
  format: 'bowerloom/acquired-skill-closure/v1beta1'; receipt: Readonly<AcquiredSkillCacheReceipt>;
  snapshotRevision: string; files: ObservedNpmPayload['files'];
  acquisitionObserved: true; publisherAuthenticated: false; installAuthorized: false; executionAuthorized: false;
}
/** Reopens actual completed, unowned bytes. The supplied selector is never evidence. */
export async function readAcquiredSkillCache(value: unknown, options: { signal: AbortSignal; deadlineMs: number }): Promise<Readonly<AcquiredSkillClosure>> {
  let timer: ReturnType<typeof setTimeout> | undefined; let signal: AbortSignal | undefined; let abort: (() => void) | undefined;
  const controller = new AbortController();
  try {
    const selected = schema<AcquiredSkillCacheSelector>(value, ['root', 'operationId', 'expectedSnapshotRevision', 'expectedReceiptRevision']);
    npmCheck(/^[a-f0-9]{64}$/.test(selected.expectedSnapshotRevision) && /^[a-f0-9]{64}$/.test(selected.expectedReceiptRevision), 'NPM_CACHE_INPUT');
    // Options contain a host capability, so inspect descriptors instead of copying it as JSON.
    npmCheck(options !== null && typeof options === 'object' && !utilTypes.isProxy(options), 'NPM_CACHE_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(options);
    npmCheck(Object.getPrototypeOf(options) === Object.prototype && Reflect.ownKeys(descriptors).length === 2 && ['signal', 'deadlineMs'].every(k => descriptors[k] && 'value' in descriptors[k]!), 'NPM_CACHE_INPUT');
    signal = descriptors.signal!.value; const deadlineMs = descriptors.deadlineMs!.value as number;
    npmCheck(signal instanceof AbortSignal && Number.isFinite(deadlineMs) && deadlineMs > performance.now() && deadlineMs <= performance.now() + NPM_LIMITS.durationMs, 'NPM_CACHE_INPUT');
    const caller: AbortSignal = signal; abort = () => controller.abort(); caller.addEventListener('abort', abort, { once: true }); if (caller.aborted) abort();
    timer = setTimeout(abort, Math.max(1, deadlineMs - performance.now())); timer.unref();
    // A caller cancellation is NPM_ABORTED. The internal controller is otherwise aborted only by the deadline timer.
    const check = () => { npmCheck(!caller.aborted, 'NPM_ABORTED'); npmCheck(!controller.signal.aborted && performance.now() < deadlineMs, 'NPM_TIMEOUT'); };
    check(); const state = load({ root: selected.root, operationId: selected.operationId });
    npmCheck(state.records.at(-1)!.phase === 'COMPLETED' && !state.activeOwner && state.snapshotRevision === selected.expectedSnapshotRevision, 'NPM_CACHE_CHANGED');
    const verified = await verifyStored(state, controller.signal, check); check();
    npmCheck(verified.revision === selected.expectedReceiptRevision, 'NPM_CACHE_CHANGED');
    const files = state.plan.request.files.map(file => {
      check(); const raw = regular(join(state.op, 'files', file.path), NPM_LIMITS.fileBytes).bytes;
      npmCheck(sha256(raw) === file.sha256 && raw.length === file.bytes, 'NPM_CACHE_CHANGED');
      return { path: file.path, sourcePath: file.sourcePath, text: new TextDecoder('utf-8', { fatal: true }).decode(raw), sha256: file.sha256, mode: file.mode };
    });
    check(); assertPins(state.pins); const closing = load({ root: selected.root, operationId: selected.operationId }); check();
    npmCheck(!closing.activeOwner && closing.snapshotRevision === state.snapshotRevision, 'NPM_CACHE_CHANGED');
    return freezeSkillData({ format: 'bowerloom/acquired-skill-closure/v1beta1', receipt: verified, snapshotRevision: state.snapshotRevision, files, acquisitionObserved: true, publisherAuthenticated: false, installAuthorized: false, executionAuthorized: false });
  } catch (error) { return readRefusal(error, 'NPM_CACHE_PROMOTION_REFUSED'); }
  finally { if (timer) clearTimeout(timer); if (signal && abort) signal.removeEventListener('abort', abort); controller.abort(); }
}
