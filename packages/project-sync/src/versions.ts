/**
 * The version store of the save step: every save keeps the folder's definition as it stood before, so "Go back" always has
 * a target. It sits in the shared state layout of harness-state.ts:
 *
 *   <state>/versions/index.json   one record of every folder's versions, written atomically, mode 0600
 *   <state>/versions/blobs/<sha>  one file per distinct content, named by its sha256, mode 0600
 *
 * Each file keeps its execute bit, so a restore gives back the same definition files. An index entry with no `executable`
 * field reads as false. The format stays `v1`: the field is optional on read and always written, so no bump is needed.
 *
 * A folder is named by a folder key, a short name of letters, digits, `-` and `_` that the caller picks. A key is never a
 * path: it only names a list in the index. Each folder counts its versions on its own, `v1`, `v2`, and so on. A counter is
 * never reused, even after the oldest version is dropped, and a version's `parent` names the version recorded just before
 * it, which may be one that has been dropped since.
 *
 * Bounds (VERSION_LIMITS): 50 versions per folder, 200 files and 8 MiB per version, 1 MiB per file, 64 folders, and 1 MiB
 * for the index. A version past the cap of 50 drops the oldest of its folder. A version that would push the index past its
 * size drops the oldest of its folder too, and is refused VERSION_TOO_LARGE when it cannot fit alone.
 *
 * A record writes the new blobs first, then the index through a temporary and a rename, then removes every blob the index no
 * longer names. A write that stops at any point leaves the earlier index whole; the blobs it left are removed by the next
 * record. A missing or changed blob, and a damaged index, refuse VERSION_CORRUPT. Nothing is ever read as an empty set.
 *
 * Calls are synchronous and take no lock. A caller that saves holds the project lock around `recordVersion` already.
 */
import fs from 'node:fs';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import type { DefinitionFile } from '../../harness-definition/src/index.js';
import { MAX_FILE, PortableRefusal, byBytes, readAbs, refuse, sha, sweepFolderTemps, writeAbs } from './portable-files.js';
import { ensureRecordFolder, readPrivateJson, recordExists } from './harness-state.js';
import type { HarnessStateDirs } from './harness-state.js';
import { stateExists } from './portable-state.js';

// ---- refusals ----------------------------------------------------------------------------------------------------------

const MESSAGES = {
  VERSION_USAGE: 'The version input is not valid: a folder key, a file set, or a label is not in the shape the store takes. Nothing was written.',
  VERSION_UNKNOWN: 'The store holds no such version for this folder. Nothing was changed.',
  VERSION_CORRUPT: 'The version store is damaged: its index is not valid, or a saved copy of a file is missing or has changed. Nothing was changed.',
  VERSION_TOO_LARGE: 'The files are over a limit of the version store: files in a version, bytes in a version, bytes in one file, folders, or the size of the index. Nothing was written.',
} as const;
export type VersionCode = keyof typeof MESSAGES;
export const VERSION_REFUSAL_CODES: readonly VersionCode[] = Object.freeze(Object.keys(MESSAGES) as VersionCode[]);

/** A refusal of the version store. The message never carries a path or a folder key. */
export class VersionRefusal extends DefinitionError {
  constructor(code: VersionCode) {
    super(code, MESSAGES[code]);
    this.name = 'VersionRefusal';
  }
}
const refuseVersion = (code: VersionCode): never => { throw new VersionRefusal(code); };

// ---- shapes and limits -------------------------------------------------------------------------------------------------

export const VERSION_FORMAT = 'bowerloom/harness-versions/v1' as const;
export const VERSION_LIMITS = Object.freeze({
  /** Versions kept per folder. Past it, the oldest goes. */
  versions: 50,
  /** Files in one version. */
  files: 200,
  /** Bytes in one version, all files together. */
  bytes: 8 * 1024 * 1024,
  /** Bytes in one file. The state layer reads no file larger than this. */
  fileBytes: MAX_FILE,
  /** Folders in one store. */
  folders: 64,
  /** Bytes in the index file. The state layer reads no file larger than this. */
  index: MAX_FILE,
});

/** One file of a version: its path inside the definition folder, the hash and size of its bytes, and its execute bit. */
export interface VersionFile { readonly path: string; readonly sha256: string; readonly bytes: number; readonly executable: boolean }
/** One recorded version of a folder. `parent` is the version recorded just before, or null for the first. */
export interface VersionEntry {
  readonly id: string;
  readonly counter: number;
  readonly parent: string | null;
  readonly revision: string;
  /** UTC, to the second. */
  readonly created: string;
  readonly label: string;
  /** In byte order of the path. */
  readonly files: readonly VersionFile[];
}
export interface VersionMeta {
  /** The revision of the definition the files make. */
  readonly revision: string;
  /** A short line for a person. May be empty. */
  readonly label: string;
  /** The present time. Default: the clock. */
  readonly now?: Date;
}
/**
 * A file set as a caller gives it: a list of definition files (path, bytes, and an optional execute bit), or, with the
 * execute bit off for every file, a map or a plain object of relative path to bytes.
 */
export type VersionFiles = readonly DefinitionFile[] | ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>;
/** A version with every file it holds, as definition files in byte order of the path. */
export interface StoredVersion { readonly entry: VersionEntry; readonly files: DefinitionFile[] }
/** Test hooks of `recordVersionWith`: each runs at one point of a record, so a test can stop it there. */
export interface RecordHooks {
  readonly beforeBlobs?: () => void;
  readonly afterBlobs?: () => void;
  /** Runs with the new index written to its temporary, right before the rename. */
  readonly beforeIndexRename?: () => void;
}

interface Folder { key: string; counter: number; versions: VersionEntry[] }

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ID = /^v[1-9][0-9]{0,9}$/;
const REVISION = /^[A-Za-z0-9:_.+-]{1,128}$/;
const CREATED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA = /^[0-9a-f]{64}$/;
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
const INDEX_NAME = 'index.json', BLOBS = 'blobs', STORE = 'versions';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const isCount = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const isoSeconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

function goodPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || Buffer.byteLength(p) > 1024 || p.startsWith('/') || p.includes('\\') || CONTROL.test(p)) return false;
  return p.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}
function goodLabel(l: unknown): l is string { return typeof l === 'string' && l.length <= 200 && !CONTROL.test(l); }

// ---- inputs ------------------------------------------------------------------------------------------------------------

/** The `versions` and `blobs` folders of a layout. The layout must be the `base` of `harnessStateDirs`, or `harness` folder. */
function storeOf(dirs: unknown): { store: string; blobs: string } {
  const base = isObj(dirs) ? dirs.base : undefined;
  if (typeof base !== 'string' || !isAbsolute(base) || base.includes('\0') || base.length > 4096 || normalize(base) !== base || base.endsWith('/') || basename(base) !== 'harness') refuse('PORTABLE_USAGE');
  const store = join(base as string, STORE);
  return { store, blobs: join(store, BLOBS) };
}
const keyOf = (key: unknown): string => (typeof key === 'string' && KEY.test(key) ? key : refuseVersion('VERSION_USAGE'));

/** The file set as a sorted list of copied bytes, checked against the shape and the limits. */
function filesOf(files: unknown): { path: string; bytes: Buffer; executable: boolean }[] {
  const list: { path: unknown; bytes: unknown; executable: unknown }[] = [];
  if (Array.isArray(files)) {
    for (const f of files as unknown[]) {
      if (!isObj(f) || Object.keys(f).some(k => k !== 'path' && k !== 'bytes' && k !== 'executable')) return refuseVersion('VERSION_USAGE');
      if (f.executable !== undefined && typeof f.executable !== 'boolean') return refuseVersion('VERSION_USAGE');
      list.push({ path: f.path, bytes: f.bytes, executable: f.executable ?? false });
    }
  } else if (files instanceof Map) {
    for (const [path, bytes] of files.entries()) list.push({ path, bytes, executable: false });
  } else if (isObj(files) && (Object.getPrototypeOf(files) === Object.prototype || Object.getPrototypeOf(files) === null)) {
    for (const [path, bytes] of Object.entries(files)) list.push({ path, bytes, executable: false });
  } else return refuseVersion('VERSION_USAGE');
  if (list.length === 0) refuseVersion('VERSION_USAGE');
  for (const f of list) if (!goodPath(f.path) || !(f.bytes instanceof Uint8Array)) refuseVersion('VERSION_USAGE');
  if (new Set(list.map(f => f.path)).size !== list.length) refuseVersion('VERSION_USAGE');
  if (list.length > VERSION_LIMITS.files) refuseVersion('VERSION_TOO_LARGE');
  let total = 0;
  for (const f of list) {
    const n = (f.bytes as Uint8Array).length;
    if (n > VERSION_LIMITS.fileBytes) refuseVersion('VERSION_TOO_LARGE');
    total += n;
  }
  if (total > VERSION_LIMITS.bytes) refuseVersion('VERSION_TOO_LARGE');
  return (list as { path: string; bytes: Uint8Array; executable: boolean }[])
    .sort((a, b) => byBytes(a.path, b.path)).map(f => ({ path: f.path, bytes: Buffer.from(f.bytes), executable: f.executable }));
}

function metaOf(meta: unknown): { revision: string; label: string; created: string } {
  if (!isObj(meta) || Object.keys(meta).some(k => k !== 'revision' && k !== 'label' && k !== 'now')) return refuseVersion('VERSION_USAGE');
  const { revision, label, now } = meta;
  if (typeof revision !== 'string' || !REVISION.test(revision) || !goodLabel(label)) return refuseVersion('VERSION_USAGE');
  if (now !== undefined && !(now instanceof Date && !Number.isNaN(now.getTime()))) return refuseVersion('VERSION_USAGE');
  const created = isoSeconds(now instanceof Date ? now : new Date());
  if (!CREATED.test(created)) return refuseVersion('VERSION_USAGE');
  return { revision, label, created };
}

// ---- the index ---------------------------------------------------------------------------------------------------------

function parseEntry(raw: unknown, folderCounter: number): VersionEntry {
  const bad = (): never => refuseVersion('VERSION_CORRUPT');
  if (!isObj(raw) || !exactKeys(raw, ['id', 'counter', 'parent', 'revision', 'created', 'label', 'files'])) bad();
  const o = raw as Record<string, unknown>;
  if (!isCount(o.counter, 1, folderCounter) || o.id !== `v${o.counter}`) bad();
  const counter = o.counter as number;
  if (o.parent !== null && (typeof o.parent !== 'string' || !ID.test(o.parent) || Number(o.parent.slice(1)) >= counter)) bad();
  if (typeof o.revision !== 'string' || !REVISION.test(o.revision) || typeof o.created !== 'string' || !CREATED.test(o.created) || !goodLabel(o.label)) bad();
  if (!Array.isArray(o.files) || o.files.length < 1 || o.files.length > VERSION_LIMITS.files) bad();
  let total = 0, last: string | null = null;
  const files = (o.files as unknown[]).map((f): VersionFile => {
    if (!isObj(f) || !(exactKeys(f, ['path', 'sha256', 'bytes']) || exactKeys(f, ['path', 'sha256', 'bytes', 'executable']))) return bad();
    if (!goodPath(f.path) || typeof f.sha256 !== 'string' || !SHA.test(f.sha256) || !isCount(f.bytes, 0, VERSION_LIMITS.fileBytes)) return bad();
    if (f.executable !== undefined && typeof f.executable !== 'boolean') return bad();
    if (last !== null && byBytes(last, f.path) >= 0) bad();
    last = f.path; total += f.bytes;
    return Object.freeze({ path: f.path, sha256: f.sha256, bytes: f.bytes, executable: f.executable ?? false });
  });
  if (total > VERSION_LIMITS.bytes) bad();
  return Object.freeze({
    id: o.id as string, counter, parent: o.parent as string | null, revision: o.revision as string, created: o.created as string,
    label: o.label as string, files: Object.freeze(files),
  });
}

function parseIndex(raw: unknown): Folder[] {
  const bad = (): never => refuseVersion('VERSION_CORRUPT');
  if (!isObj(raw) || !exactKeys(raw, ['format', 'folders']) || raw.format !== VERSION_FORMAT || !Array.isArray(raw.folders) || raw.folders.length > VERSION_LIMITS.folders) return bad();
  const seen = new Set<string>();
  return (raw.folders as unknown[]).map((f): Folder => {
    if (!isObj(f) || !exactKeys(f, ['key', 'counter', 'versions']) || typeof f.key !== 'string' || !KEY.test(f.key) || seen.has(f.key)) return bad();
    seen.add(f.key);
    if (!isCount(f.counter, 0, 2 ** 31) || !Array.isArray(f.versions) || f.versions.length > VERSION_LIMITS.versions) return bad();
    const folderCounter = f.counter;
    const versions = (f.versions as unknown[]).map(v => parseEntry(v, folderCounter));
    for (let i = 1; i < versions.length; i++) if (versions[i]!.counter <= versions[i - 1]!.counter) bad();
    return { key: f.key, counter: folderCounter, versions };
  });
}

/** The folders in the index file, or none when there is no file. A file that is not a whole index refuses VERSION_CORRUPT. */
function readIndex(store: string): Folder[] {
  let raw: unknown;
  try { raw = readPrivateJson(join(store, INDEX_NAME), `${STORE}/${INDEX_NAME}`); } catch (e) {
    if (e instanceof PortableRefusal && e.code === 'PORTABLE_STATE_INVALID') return refuseVersion('VERSION_CORRUPT');
    throw e;
  }
  return raw === null ? [] : parseIndex(raw);
}
const serialize = (folders: readonly Folder[]): Buffer =>
  Buffer.from(JSON.stringify({ format: VERSION_FORMAT, folders: [...folders].sort((a, b) => byBytes(a.key, b.key)) }, null, 2) + '\n');

// ---- blobs -------------------------------------------------------------------------------------------------------------

/** True when the blob of `hash` is present and whole. A link or an unreadable file counts as not whole. */
function blobWhole(blobs: string, hash: string, bytes: number): boolean {
  try { const got = readAbs(join(blobs, hash), 'blob'); return got !== null && got.bytes.length === bytes && got.state.sha256 === hash; } catch { return false; }
}
/** Removes every blob that no version names, and every writer temporary in the store. Cleanup only: errors are ignored. */
function collect(store: string, blobs: string, folders: readonly Folder[]): void {
  const keep = new Set(folders.flatMap(f => f.versions.flatMap(v => v.files.map(x => x.sha256))));
  try { for (const name of fs.readdirSync(blobs)) if (SHA.test(name) && !keep.has(name)) { try { fs.unlinkSync(join(blobs, name)); } catch { /* cleanup only */ } } } catch { /* cleanup only */ }
  sweepFolderTemps(blobs); sweepFolderTemps(store);
}

function ensureStore(dirs: HarnessStateDirs, store: string, blobs: string): void {
  ensureRecordFolder(dirs);
  for (const dir of [store, blobs]) {
    if (!stateExists(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    if (!stateExists(dir)) refuse('PORTABLE_STATE_UNSAFE');
  }
}

// ---- the calls ---------------------------------------------------------------------------------------------------------

const copyEntry = (e: VersionEntry): VersionEntry => Object.freeze({ ...e, files: Object.freeze(e.files.map(f => Object.freeze({ ...f }))) });

/**
 * Records `files` as the next version of the folder `folderKey` and returns the entry. `files` is the full file set of the
 * definition folder: a list of `{ path, bytes, executable? }`, or a map or object of path to bytes with every execute bit off. The write is atomic and bounded (see the top of the file). Refuses
 * VERSION_USAGE for a bad key, file set, or meta, VERSION_TOO_LARGE past a limit, VERSION_CORRUPT for a damaged index
 * (which it leaves as it is), PORTABLE_USAGE for a layout that is not a harness layout, and PORTABLE_STATE_UNSAFE for a
 * state folder that is a link or is open to others.
 */
export function recordVersion(dirs: HarnessStateDirs, folderKey: string, files: VersionFiles, meta: VersionMeta): VersionEntry {
  return recordVersionWith(dirs, folderKey, files, meta, {});
}

/** `recordVersion` with test hooks. Not exported from the package index. */
export function recordVersionWith(dirs: HarnessStateDirs, folderKey: string, files: VersionFiles, meta: VersionMeta, hooks: RecordHooks): VersionEntry {
  const { store, blobs } = storeOf(dirs);
  const key = keyOf(folderKey), set = filesOf(files), m = metaOf(meta);
  ensureStore(dirs, store, blobs);
  const folders = readIndex(store);

  let folder = folders.find(f => f.key === key);
  if (folder === undefined) {
    if (folders.length >= VERSION_LIMITS.folders) refuseVersion('VERSION_TOO_LARGE');
    folder = { key, counter: 0, versions: [] };
    folders.push(folder);
  }
  folder.counter += 1;
  const entry: VersionEntry = Object.freeze({
    id: `v${folder.counter}`, counter: folder.counter, parent: folder.counter > 1 ? `v${folder.counter - 1}` : null,
    revision: m.revision, created: m.created, label: m.label,
    files: Object.freeze(set.map(f => Object.freeze({ path: f.path, sha256: sha(f.bytes), bytes: f.bytes.length, executable: f.executable }))),
  });
  folder.versions.push(entry);
  while (folder.versions.length > VERSION_LIMITS.versions) folder.versions.shift();
  let body = serialize(folders);
  while (body.length > VERSION_LIMITS.index && folder.versions.length > 1) { folder.versions.shift(); body = serialize(folders); }
  if (body.length > VERSION_LIMITS.index) refuseVersion('VERSION_TOO_LARGE');

  hooks.beforeBlobs?.();
  for (const { path, bytes } of set) {
    const hash = sha(bytes);
    if (!blobWhole(blobs, hash, bytes.length)) writeAbs(join(blobs, hash), bytes, 0o600, { label: path });
  }
  hooks.afterBlobs?.();
  writeAbs(join(store, INDEX_NAME), body, 0o600, hooks.beforeIndexRename === undefined ? {} : { recheck: hooks.beforeIndexRename });
  collect(store, blobs, folders);
  return copyEntry(entry);
}

/** The versions of a folder, newest first. Reads only: it creates nothing, and does not open a blob. */
export function listVersions(dirs: HarnessStateDirs, folderKey: string): readonly VersionEntry[] {
  const { store } = storeOf(dirs);
  const key = keyOf(folderKey);
  if (!recordExists(dirs) || !stateExists(store)) return [];
  const folder = readIndex(store).find(f => f.key === key);
  return folder === undefined ? [] : folder.versions.map(copyEntry).reverse();
}

/**
 * One version of a folder with every file it holds as a list of definition files in byte order of the path, ready to be passed
 * to the save step. Each file is checked against its recorded hash and size. VERSION_UNKNOWN when
 * the folder holds no such version. VERSION_CORRUPT when the index is damaged or a blob is missing, changed, or a link;
 * the file set is never returned in part.
 */
export function readVersion(dirs: HarnessStateDirs, folderKey: string, id: string): StoredVersion {
  const { store, blobs } = storeOf(dirs);
  const key = keyOf(folderKey);
  if (!recordExists(dirs) || !stateExists(store)) return refuseVersion('VERSION_UNKNOWN');
  const folder = readIndex(store).find(f => f.key === key);
  const entry = typeof id === 'string' ? folder?.versions.find(v => v.id === id) : undefined;
  if (entry === undefined) return refuseVersion('VERSION_UNKNOWN');
  if (!stateExists(blobs)) return refuseVersion('VERSION_CORRUPT');
  const out: DefinitionFile[] = [];
  for (const f of entry.files) {
    let got: ReturnType<typeof readAbs> = null;
    try { got = readAbs(join(blobs, f.sha256), 'blob'); } catch { got = null; }
    if (got === null || got.bytes.length !== f.bytes || got.state.sha256 !== f.sha256) return refuseVersion('VERSION_CORRUPT');
    out.push({ path: f.path, bytes: got.bytes, executable: f.executable });
  }
  return { entry: copyEntry(entry), files: out };
}
