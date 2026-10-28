/**
 * The private state of the portable projection: the receipt, the pending marker (the journal of a run), and the saved
 * bytes (blobs) of every file a run replaced or deleted. Each record is read against a strict shape (review ruling P1):
 * a forged path, folder, hash, or mode, a record of another project, or a damaged file is a coded refusal. The revision
 * of a record is a checksum, not a seal, so the shape check is what keeps a record inside the project.
 */
import fs from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { isEngineId, parseFidelityApproval } from '../../harness-definition/src/index.js';
import type { EngineId, FidelityApproval } from '../../harness-definition/src/index.js';
import {
  isProjectedDir, isProjectedPath, readAbs, refuse, revisionOf, sha, sweepFolderTemps, uid, writeAbs,
} from './portable-files.js';
import type { FileAfter, FileState } from './portable-files.js';

export const PORTABLE_RECEIPT_FORMAT = 'bowerloom/portable-projection-receipt/v1beta3' as const;
/** The receipt of step 2. It reads as a receipt with no approvals; the next apply writes the current format. */
export const PORTABLE_RECEIPT_FORMAT_V2 = 'bowerloom/portable-projection-receipt/v1beta2' as const;
export const PENDING_FORMAT = 'bowerloom/portable-pending/v1beta2' as const;
const RECEIPT = 'receipt.json', PENDING = 'pending.json', BLOBS = 'blobs';

export interface PortableEngine { readonly id: EngineId; readonly version: string | null }
export interface ReceiptFile extends FileAfter {
  readonly path: string;
  readonly engines: readonly EngineId[];
  readonly original: FileState | null;
}
/** A borrowed skill and where it came from (ruling P18). */
export interface ReceiptSource { readonly skill: string; readonly name: string; readonly marketplace: string; readonly version: string }
export interface PortableReceipt {
  readonly format: typeof PORTABLE_RECEIPT_FORMAT;
  readonly projectDir: string;
  readonly definition: { readonly folder: string; readonly harness: string; readonly revision: string };
  /** The engines and their versions. A version is recorded, and used only for the Claude Code check of ruling P23. */
  readonly engines: readonly PortableEngine[];
  readonly files: readonly ReceiptFile[];
  readonly sources: readonly ReceiptSource[];
  /** Folders the projection created, relative to the project, parents first. Removal deletes each that is empty. */
  readonly createdDirs: readonly string[];
  /** The recorded approvals of weakened or absent enforced entries that this projection carries (section 2). */
  readonly approvals: readonly FidelityApproval[];
  readonly planRevision: string;
  readonly revision: string;
}
export interface Step { readonly path: string; readonly from: FileState | null; readonly to: FileState | null }
export interface Pending {
  readonly format: typeof PENDING_FORMAT;
  readonly projectDir: string;
  readonly kind: 'apply' | 'remove';
  readonly planRevision: string;
  readonly steps: readonly Step[];
  readonly dirs: readonly string[];
}

// ---- the state folder (ruling P4) --------------------------------------------------------------------------------------

/**
 * The project must be a real absolute folder path. The state path must be absolute and normalized. Its nearest existing
 * folder, and every folder above that, must not be the project, compared by device and inode, so a link or another
 * letter case cannot place it inside the project (review item V3). An existing state folder must not be above the project.
 */
export function checkPaths(projectDir: unknown, stateDir: unknown): asserts projectDir is string {
  for (const p of [projectDir, stateDir]) if (typeof p !== 'string' || !isAbsolute(p) || p.includes('\0') || p.length > 4096) refuse('PORTABLE_USAGE');
  const project = projectDir as string, state = stateDir as string;
  let real: string;
  try { real = fs.realpathSync(project); } catch { return refuse('PORTABLE_USAGE'); }
  if (real !== project || !fs.lstatSync(project).isDirectory()) refuse('PORTABLE_USAGE');
  if (normalize(state) !== state || state.endsWith('/') || state === '/') refuse('PORTABLE_STATE_UNSAFE');
  const id = (p: string): string | null => { try { const st = fs.statSync(p); return `${st.dev}:${st.ino}`; } catch { return null; } };
  const projectId = id(project);
  let at = state, exists = true;
  while (id(at) === null) { exists = false; if (dirname(at) === at) break; at = dirname(at); }
  let realAt: string;
  try { realAt = fs.realpathSync(at); } catch { return refuse('PORTABLE_STATE_UNSAFE'); }
  for (let up = realAt; ; up = dirname(up)) {
    if (id(up) === projectId) refuse('PORTABLE_STATE_UNSAFE');
    if (dirname(up) === up) break;
  }
  if (exists) {
    const stateId = id(state);
    for (let up = project; ; up = dirname(up)) { if (id(up) === stateId) refuse('PORTABLE_STATE_UNSAFE'); if (dirname(up) === up) break; }
  }
}

/** True when the state folder exists. It must then be a private folder of this user. */
export function stateExists(stateDir: string): boolean {
  let st: fs.Stats;
  try { st = fs.lstatSync(stateDir); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; return refuse('PORTABLE_STATE_UNSAFE'); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid() || (st.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  return true;
}
export function ensureState(stateDir: string): void {
  if (!stateExists(stateDir)) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  stateExists(stateDir);
  const blobs = join(stateDir, BLOBS);
  if (!stateExists(blobs)) fs.mkdirSync(blobs, { mode: 0o700 });
  stateExists(blobs);
}

function readJson(stateDir: string, name: string): unknown {
  if (!stateExists(stateDir)) return null;
  const got = readAbs(join(stateDir, name), name);
  if (got === null) return null;
  if ((got.state.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  try { return JSON.parse(got.bytes.toString('utf8')) as unknown; } catch { return refuse('PORTABLE_STATE_INVALID', [name]); }
}
export function writeRecord(stateDir: string, name: 'receipt.json' | 'pending.json', value: unknown): void {
  writeAbs(join(stateDir, name), Buffer.from(JSON.stringify(value, null, 2) + '\n'), 0o600);
}
export function unlinkRecord(stateDir: string, name: 'receipt.json' | 'pending.json'): void {
  try { fs.unlinkSync(join(stateDir, name)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

// ---- shapes ------------------------------------------------------------------------------------------------------------

const HEX = /^[0-9a-f]{64}$/;
const bad = (name: string): never => refuse('PORTABLE_STATE_INVALID', [name]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function closed(v: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!isObj(v) || Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) bad(name);
  return v as Record<string, unknown>;
}
const text = (v: unknown, name: string, max = 4096): string => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : bad(name));
function fileState(v: unknown, name: string): FileState {
  const o = closed(v, ['sha256', 'mode'], name);
  if (typeof o.sha256 !== 'string' || !HEX.test(o.sha256) || !Number.isInteger(o.mode) || (o.mode as number) < 0 || (o.mode as number) > 0o777) bad(name);
  return { sha256: o.sha256 as string, mode: (o.mode as number) & 0o777 };
}
const stateOrNull = (v: unknown, name: string): FileState | null => (v === null ? null : fileState(v, name));
function list<T>(v: unknown, name: string, each: (x: unknown) => T, max = 100_000): T[] {
  if (!Array.isArray(v) || v.length > max) bad(name);
  return (v as unknown[]).map(each);
}
function projectedPath(v: unknown, name: string): string { if (!isProjectedPath(v)) bad(name); return v as string; }
function projectedDir(v: unknown, name: string): string { if (!isProjectedDir(v)) bad(name); return v as string; }
function engines(v: unknown, name: string): EngineId[] { return list(v, name, x => (isEngineId(x) ? x : bad(name)), 5); }
function unique(paths: readonly string[], name: string): void { if (new Set(paths).size !== paths.length) bad(name); }

/** The receipt, checked against its strict shape and against the project it must belong to. */
export function readReceipt(stateDir: string, projectDir: string): PortableReceipt | null {
  const raw = readJson(stateDir, RECEIPT);
  if (raw === null) return null;
  const n = RECEIPT;
  const legacy = isObj(raw) && raw.format === PORTABLE_RECEIPT_FORMAT_V2;
  const o = closed(raw, ['format', 'projectDir', 'definition', 'engines', 'files', 'sources', 'createdDirs', ...(legacy ? [] : ['approvals']), 'planRevision', 'revision'], n);
  if (o.format !== PORTABLE_RECEIPT_FORMAT && !legacy) bad(n);
  const d = closed(o.definition, ['folder', 'harness', 'revision'], n);
  const definition = { folder: text(d.folder, n), harness: text(d.harness, n, 64), revision: text(d.revision, n, 128) };
  const eng = list(o.engines, n, x => {
    const e = closed(x, ['id', 'version'], n);
    if (!isEngineId(e.id) || !(e.version === null || (typeof e.version === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(e.version)))) bad(n);
    return { id: e.id as EngineId, version: e.version as string | null };
  }, 5);
  const files = list(o.files, n, x => {
    const f = closed(x, ['path', 'sha256', 'mode', 'bytes', 'engines', 'original'], n);
    const st = fileState({ sha256: f.sha256, mode: f.mode }, n);
    if (!Number.isSafeInteger(f.bytes) || (f.bytes as number) < 0) bad(n);
    return { path: projectedPath(f.path, n), ...st, bytes: f.bytes as number, engines: engines(f.engines, n), original: stateOrNull(f.original, n) };
  });
  unique(files.map(f => f.path), n);
  const sources = list(o.sources, n, x => {
    const s = closed(x, ['skill', 'name', 'marketplace', 'version'], n);
    return { skill: text(s.skill, n, 64), name: text(s.name, n, 256), marketplace: text(s.marketplace, n, 256), version: text(s.version, n, 256) };
  });
  const createdDirs = list(o.createdDirs, n, x => projectedDir(x, n));
  unique(createdDirs, n);
  // An approval is checked with the shape check of the contract: unknown fields, a bad hash, or a time in the future refuse.
  const approvals = legacy ? [] : list(o.approvals, n, x => { const r = parseFidelityApproval(x); if (!r.ok) bad(n); return (r as { approval: FidelityApproval }).approval; }, 10_000);
  if (typeof o.planRevision !== 'string' || !HEX.test(o.planRevision) || typeof o.revision !== 'string' || typeof o.projectDir !== 'string') bad(n);
  const { revision, ...body } = o;
  if (revision !== revisionOf(body)) bad(n);
  if (o.projectDir !== projectDir) refuse('PORTABLE_STATE_FOREIGN');
  return { format: PORTABLE_RECEIPT_FORMAT, projectDir, definition, engines: eng, files, sources, createdDirs, approvals, planRevision: o.planRevision as string, revision: revision as string };
}

/** The pending marker, checked against its strict shape and its project (rulings P1 and P15). */
export function readPending(stateDir: string, projectDir: string): Pending | null {
  const raw = readJson(stateDir, PENDING);
  if (raw === null) return null;
  const n = PENDING;
  const o = closed(raw, ['format', 'projectDir', 'kind', 'planRevision', 'steps', 'dirs'], n);
  if (o.format !== PENDING_FORMAT || (o.kind !== 'apply' && o.kind !== 'remove') || typeof o.planRevision !== 'string' || !HEX.test(o.planRevision)) bad(n);
  const steps = list(o.steps, n, x => {
    const s = closed(x, ['path', 'from', 'to'], n);
    return { path: projectedPath(s.path, n), from: stateOrNull(s.from, n), to: stateOrNull(s.to, n) };
  });
  unique(steps.map(s => s.path), n);
  const dirs = list(o.dirs, n, x => projectedDir(x, n));
  if (o.projectDir !== projectDir) refuse('PORTABLE_STATE_FOREIGN');
  return { format: PENDING_FORMAT, projectDir, kind: o.kind as 'apply' | 'remove', planRevision: o.planRevision as string, steps, dirs };
}
export const pendingExists = (stateDir: string): boolean => stateExists(stateDir) && fs.existsSync(join(stateDir, PENDING));

// ---- blobs ---------------------------------------------------------------------------------------------------------------

/** The `blobs` folder, checked as a real private folder of this user before any read or write in it (review item V9). */
function blobsDir(stateDir: string): string {
  const dir = join(stateDir, BLOBS);
  if (!stateExists(dir)) refuse('PORTABLE_STATE_INVALID', ['blobs']);
  return dir;
}
/** Saves bytes into the state folder, by their hash. */
export function saveBlob(stateDir: string, bytes: Uint8Array): void {
  const at = join(blobsDir(stateDir), sha(bytes));
  let have: string | null = null;
  try { have = readAbs(at, 'blob')?.state.sha256 ?? null; } catch { have = null; }
  if (have !== sha(bytes)) writeAbs(at, bytes, 0o600);
}
/** The saved bytes of a state. A missing or changed blob refuses PORTABLE_STATE_INVALID. */
export function blob(stateDir: string, state: FileState, label: string): Buffer {
  const dir = blobsDir(stateDir);
  let got: ReturnType<typeof readAbs> = null;
  try { got = readAbs(join(dir, state.sha256), label); } catch { got = null; }
  if (got === null || got.state.sha256 !== state.sha256) return refuse('PORTABLE_STATE_INVALID', [`the saved copy of ${label}`]);
  return got.bytes;
}
/** True when the saved copy of a state is present and whole. */
export function blobOk(stateDir: string, state: FileState): boolean {
  try { blob(stateDir, state, 'x'); return true; } catch (e) { if ((e as { code?: unknown }).code === 'PORTABLE_STATE_UNSAFE') throw e; return false; }
}
/** Deletes every blob that `keep` does not name, and every writer temporary of the state folder. */
export function cleanBlobs(stateDir: string, keep: ReadonlySet<string>): void {
  const dir = blobsDir(stateDir);
  for (const name of fs.readdirSync(dir)) if (!keep.has(name)) { try { fs.unlinkSync(join(dir, name)); } catch { /* cleanup only */ } }
  sweepFolderTemps(stateDir);
}
export const originalsOf = (r: PortableReceipt | null): Set<string> => new Set((r?.files ?? []).flatMap(f => (f.original ? [f.original.sha256] : [])));

/**
 * Keeps the saved original of a path that a person keeps (review item V1): a copy in `kept/`, which no cleanup touches.
 * Returns its path, or null when no saved copy exists.
 */
export function keepOriginal(stateDir: string, state: FileState): string | null {
  let bytes: Buffer;
  try { bytes = blob(stateDir, state, 'kept'); } catch (e) { if ((e as { code?: unknown }).code === 'PORTABLE_STATE_UNSAFE') throw e; return null; }
  const dir = join(stateDir, 'kept');
  if (!stateExists(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  stateExists(dir);
  const at = join(dir, state.sha256);
  let have: string | null = null;
  try { have = readAbs(at, 'kept')?.state.sha256 ?? null; } catch { have = null; }
  if (have !== state.sha256) writeAbs(at, bytes, 0o600);
  return at;
}
export const keptPath = (stateDir: string, state: FileState): string => join(stateDir, 'kept', state.sha256);
