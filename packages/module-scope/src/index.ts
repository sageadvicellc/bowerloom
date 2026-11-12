/**
 * Module scope: what a module may read. A module reads only what the person picks, plus places in the home folder that the person approved once for that module (the maintainer, 2026-11-11). Nothing leaves this computer:
 * this package imports no network module and starts no program. A place the person picks in main's own chooser is the approval. It is kept in the private state folder, `<state>/module-scope/approved.json`,
 * by module id, as the home-relative path (never a full path) and the key of the real folder (SHA-256 of its native real path, cut to 32 characters). A place that is later swapped for another folder
 * (a shortcut) has another key, so it is no longer approved. The model of the record is the one of the linked notes folders (packages/notes-source/src/approvals.ts, docs/v0.9/context-items.md), with
 * one list for each module and not one list for the whole app. Nothing here throws. No message and no full path is ever returned.
 *
 * This is the only code that decides whether a module may read a place. `approvePlace` is called by main's chooser only (apps/desktop/main/module-pick.ts), never with a value from the page.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCOPE_LIMITS = Object.freeze({ placesPerModule: 16, modules: 64, recordBytes: 128 * 1024, readBytes: 256 * 1024, pathChars: 512, listFiles: 5000, listDepth: 6, listEntries: 50000, listMs: 5000 });
const VERSION = 1;
/** A module id: the same name rule as an extension id (apps/desktop/shared/extensions/manifest.ts). */
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLACE_ID = /^place-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f]{32}$/;
const REL_PART = /^[^./\\\0][^/\\\0]{0,254}$/;
/** Control characters and format characters (zero-width and bidirectional marks), and the two line separators: none may be in the name of a place or of a path inside it. The rule of notes-source's plainName, with the format class added. */
const ODD_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;
/** One plain part of a path: not hidden, no separator, no NUL, no control or bidirectional character, at most 255 characters. */
const plainPart = (part: string): boolean => REL_PART.test(part) && !ODD_CHARACTER.test(part);

export const scopeFileOf = (stateRoot: string): string => path.join(stateRoot, 'module-scope', 'approved.json');
const keyOf = (realFolder: string): string => createHash('sha256').update(`bowerloom-module-scope\u0000${realFolder}`).digest('hex').slice(0, 32);
const placeIdOf = (key: string): string => `place-${key.slice(0, 12)}`;

/** What the page may see of a place: an id, the label written with `~`, and when it was approved. Never a full path. */
export interface PlaceView { readonly id: string; readonly label: string; readonly approvedAt: string }
interface Stored { readonly id: string; readonly rel: string; readonly key: string; readonly at: string }
type Modules = Record<string, Stored[]>;

const uid = (): number | undefined => process.getuid?.();
const ownFolder = (info: fs.Stats): boolean => !info.isSymbolicLink() && info.isDirectory() && (uid() === undefined || info.uid === uid());
const isPrivate = (info: fs.Stats): boolean => (info.mode & 0o022) === 0;
const codeOf = (error: unknown): string => (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '');
/** The class of a failure as a short word, for a log: the error code (such as ENOENT) or the error name. Never the message, which can hold a path. */
export function causeOf(error: unknown): string {
  const code = codeOf(error);
  if (/^[A-Z0-9_]{1,40}$/.test(code)) return code;
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'Error';
}
const inside = (root: string, child: string): boolean => child !== root && child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

type Record_ = { readonly status: 'none' } | { readonly status: 'damaged' } | { readonly status: 'blocked' } | { readonly status: 'ok'; readonly modules: Modules };

function validStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !PLACE_ID.test(v.id) || typeof v.key !== 'string' || !KEY.test(v.key) || v.id !== placeIdOf(v.key)) return false;
  if (typeof v.at !== 'string' || v.at.length > 40 || typeof v.rel !== 'string' || v.rel.length > SCOPE_LIMITS.pathChars) return false;
  return v.rel.split('/').every(plainPart);
}

function readRecord(stateRoot: string): Record_ {
  const dir = path.join(stateRoot, 'module-scope'), file = scopeFileOf(stateRoot);
  try {
    const folder = fs.lstatSync(dir);
    if (!ownFolder(folder) || !isPrivate(folder)) return { status: 'blocked' };
  } catch (error) { return codeOf(error) === 'ENOENT' ? { status: 'none' } : { status: 'blocked' }; }
  let info: fs.Stats;
  try { info = fs.lstatSync(file); } catch (error) { return codeOf(error) === 'ENOENT' ? { status: 'none' } : { status: 'damaged' }; }
  if (!info.isFile() || info.size > SCOPE_LIMITS.recordBytes || (uid() !== undefined && info.uid !== uid())) return { status: 'damaged' };
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; modules?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.version !== VERSION || typeof v.modules !== 'object' || v.modules === null || Array.isArray(v.modules)) return { status: 'damaged' };
    const entries = Object.entries(v.modules as Record<string, unknown>);
    if (entries.length > SCOPE_LIMITS.modules) return { status: 'damaged' };
    const modules: Modules = Object.create(null) as Modules;
    for (const [id, list] of entries) {
      if (!MODULE_ID.test(id) || !Array.isArray(list) || list.length > SCOPE_LIMITS.placesPerModule || !list.every(validStored)) return { status: 'damaged' };
      modules[id] = list as Stored[];
    }
    return { status: 'ok', modules };
  } catch { return { status: 'damaged' }; }
}

/** The real path of a folder that may not exist yet: the real path of its nearest existing parent, with the rest of the name added. Null when no part of it can be resolved. */
function plannedReal(folder: string): string | null {
  let at = path.resolve(folder);
  const rest: string[] = [];
  for (let step = 0; step < 64; step += 1) {
    try { return path.join(fs.realpathSync.native(at), ...rest); } catch (error) { if (codeOf(error) !== 'ENOENT') return null; }
    const parent = path.dirname(at);
    if (parent === at) return null;
    rest.unshift(path.basename(at));
    at = parent;
  }
  return null;
}

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
function setAside(dir: string, file: string): boolean {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const aside = path.join(dir, `approved.json.damaged-${stamp()}-${randomBytes(3).toString('hex')}`);
    try { fs.lstatSync(aside); continue; } catch (error) { if (codeOf(error) !== 'ENOENT') return false; }
    try { fs.renameSync(file, aside); return true; } catch { return false; }
  }
  return false;
}

function writeRecord(stateRoot: string, modules: Modules): void {
  const dir = path.join(stateRoot, 'module-scope'), file = scopeFileOf(stateRoot);
  const tmp = path.join(dir, `.approved-${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, `${JSON.stringify({ version: VERSION, modules })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (error) { fs.rmSync(tmp, { force: true }); throw error; }
}

export type PlacesAnswer = { readonly status: 'ok'; readonly places: readonly PlaceView[] } | { readonly status: 'damaged' } | { readonly status: 'blocked' };
const viewOf = (s: Stored): PlaceView => Object.freeze({ id: s.id, label: `~/${s.rel}`, approvedAt: s.at });

/** The places approved for one module. `damaged` and `blocked` are the states of the record, never an empty list for a record that could not be read. */
export function listPlaces(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown }): PlacesAnswer {
  const record = readRecord(o.stateRoot);
  if (record.status === 'damaged' || record.status === 'blocked') return { status: record.status };
  if (typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId) || record.status === 'none') return { status: 'ok', places: Object.freeze([]) };
  return { status: 'ok', places: Object.freeze((record.modules[o.moduleId] ?? []).map(viewOf)) };
}

export type ApproveRefusal = 'BAD_MODULE' | 'NOT_A_FOLDER' | 'HOME_UNREADABLE' | 'NOT_IN_HOME' | 'HIDDEN_PART' | 'BAD_NAME' | 'PATH_TOO_LONG' | 'STATE_FOLDER' | 'LIBRARY_FOLDER' | 'FULL'
  | 'RECORD_BLOCKED' | 'RECORD_NOT_MOVED' | 'RECORD_RESET_FAILED' | 'FAILED';
/** `cause`: the class of the failure behind a refusal (a code or a name, never a message), for a log. `resetRecord`: a damaged record was set aside during this call, so the old list is no longer the list in use. */
export type Approved =
  | { readonly status: 'kept'; readonly place: PlaceView; readonly resetRecord?: true }
  | { readonly status: 'refused'; readonly code: ApproveRefusal; readonly cause?: string; readonly resetRecord?: true };
const refused = (code: ApproveRefusal, cause?: string, resetRecord?: true): Approved => ({ status: 'refused', code, ...(cause === undefined ? {} : { cause }), ...(resetRecord === undefined ? {} : { resetRecord }) });

/**
 * The checks of a place, for an approval and again for every read: below the home folder (not the home folder itself), every part plain (no hidden part, no control or bidirectional character, a path of at most
 * `pathChars`), not touching the state folder, and not in Library. Both paths are real paths. Null when the place passes.
 */
function placeProblem(home: string, real: string, stateRoot: string): ApproveRefusal | null {
  if (!inside(home, real)) return 'NOT_IN_HOME';
  const rel = path.relative(home, real).split(path.sep);
  if (rel.some(part => part.startsWith('.'))) return 'HIDDEN_PART';
  if (!rel.every(plainPart)) return 'BAD_NAME';
  if (rel.join('/').length > SCOPE_LIMITS.pathChars) return 'PATH_TOO_LONG';
  const state = plannedReal(stateRoot);
  if (state === null || state === real || inside(real, state) || inside(state, real)) return 'STATE_FOLDER';
  if (rel[0]!.toLowerCase() === 'library') return 'LIBRARY_FOLDER';
  return null;
}

/**
 * Records the person's pick of a folder as a place for one module. The pick is resolved to its real path, so a shortcut is approved as the folder it leads to. A place must pass `placeProblem`. A damaged record is moved
 * aside under a dated name first: the pick is the person's consent to a new list, and the answer says so (`resetRecord`). `write` is for a test: another writer of the record.
 */
export function approvePlace(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly picked: string; readonly now?: () => string; readonly write?: (stateRoot: string, modules: Modules) => void }): Approved {
  if (typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId)) return refused('BAD_MODULE');
  let home: string, real: string;
  try { home = fs.realpathSync.native(o.home); } catch (error) { return refused('HOME_UNREADABLE', causeOf(error)); }
  try {
    real = fs.realpathSync.native(o.picked);
    if (!fs.statSync(real).isDirectory()) return refused('NOT_A_FOLDER');
  } catch (error) { return refused('NOT_A_FOLDER', causeOf(error)); }
  const problem = placeProblem(home, real, o.stateRoot);
  if (problem !== null) return refused(problem);
  const rel = path.relative(home, real).split(path.sep);
  let reset = false;
  try {
    const dir = path.join(o.stateRoot, 'module-scope');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!ownFolder(fs.lstatSync(dir))) return refused('RECORD_BLOCKED');
    fs.chmodSync(dir, 0o700);
    let record = readRecord(o.stateRoot);
    if (record.status === 'blocked') return refused('RECORD_BLOCKED');
    if (record.status === 'damaged') {
      if (!setAside(dir, scopeFileOf(o.stateRoot))) return refused('RECORD_NOT_MOVED');
      reset = true;
      record = { status: 'none' };
    }
    const modules: Modules = Object.create(null) as Modules;
    if (record.status === 'ok') for (const [id, list] of Object.entries(record.modules)) modules[id] = [...list];
    const key = keyOf(real);
    const list = modules[o.moduleId] ?? [];
    const held = list.find(s => s.key === key);
    if (held !== undefined) return { status: 'kept', place: viewOf(held), ...(reset ? { resetRecord: true as const } : {}) };
    if (list.length >= SCOPE_LIMITS.placesPerModule || (modules[o.moduleId] === undefined && Object.keys(modules).length >= SCOPE_LIMITS.modules)) return refused('FULL', undefined, reset ? true : undefined);
    const stored: Stored = { id: placeIdOf(key), rel: rel.join('/'), key, at: (o.now ?? ((): string => new Date().toISOString()))() };
    modules[o.moduleId] = [...list, stored];
    (o.write ?? writeRecord)(o.stateRoot, modules);
    return { status: 'kept', place: viewOf(stored), ...(reset ? { resetRecord: true as const } : {}) };
  } catch (error) { return refused(reset ? 'RECORD_RESET_FAILED' : 'FAILED', causeOf(error), reset ? true : undefined); }
}

export type Revoked = { readonly status: 'revoked' } | { readonly status: 'unknown' } | { readonly status: 'damaged' } | { readonly status: 'blocked' } | { readonly status: 'failed'; readonly cause: string };

/** Removes one place of one module from the record. It deletes no file of the person's. */
export function revokePlace(o: { readonly stateRoot: string; readonly moduleId: unknown; readonly placeId: unknown; readonly write?: (stateRoot: string, modules: Modules) => void }): Revoked {
  const record = readRecord(o.stateRoot);
  if (record.status === 'damaged' || record.status === 'blocked') return { status: record.status };
  if (record.status === 'none' || typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId) || typeof o.placeId !== 'string') return { status: 'unknown' };
  const list = record.modules[o.moduleId] ?? [];
  if (!list.some(s => s.id === o.placeId)) return { status: 'unknown' };
  const modules: Modules = Object.create(null) as Modules;
  for (const [id, l] of Object.entries(record.modules)) modules[id] = id === o.moduleId ? l.filter(s => s.id !== o.placeId) : [...l];
  if (modules[o.moduleId]!.length === 0) delete modules[o.moduleId];
  try { (o.write ?? writeRecord)(o.stateRoot, modules); return { status: 'revoked' }; } catch (error) { return { status: 'failed', cause: causeOf(error) }; }
}

export type ReadCode = 'NOT_APPROVED' | 'PLACE_CHANGED' | 'BAD_PATH' | 'OUTSIDE_PLACE' | 'NOT_A_FILE' | 'TOO_LARGE' | 'NOT_TEXT' | 'UNREADABLE' | 'HOME_UNREADABLE' | 'RECORD_DAMAGED' | 'RECORD_BLOCKED';
export type ReadAnswer = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: ReadCode };
const no = (code: ReadCode): ReadAnswer => ({ ok: false, code });

/** True for a path that is one plain relative path of plain parts: no dot part, no hidden part, no empty part, no separator of another system, no control or bidirectional character. */
function cleanRelative(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SCOPE_LIMITS.pathChars && value.split('/').every(plainPart);
}

/** The gate of a place, in order: the ids are well formed, the record can be used and holds the place for the module, and the place is still the same folder and still passes the checks of an approval. */
type Gate = { readonly ok: true; readonly placeReal: string } | { readonly ok: false; readonly code: ReadCode };
function openPlace(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly placeId: unknown }): Gate {
  const refuse = (code: ReadCode): Gate => ({ ok: false, code });
  if (typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId) || typeof o.placeId !== 'string' || !PLACE_ID.test(o.placeId)) return refuse('NOT_APPROVED');
  const record = readRecord(o.stateRoot);
  if (record.status === 'damaged') return refuse('RECORD_DAMAGED');
  if (record.status === 'blocked') return refuse('RECORD_BLOCKED');
  if (record.status !== 'ok') return refuse('NOT_APPROVED');
  const stored = (record.modules[o.moduleId] ?? []).find(s => s.id === o.placeId);
  if (stored === undefined) return refuse('NOT_APPROVED');
  let home: string, placeReal: string;
  try { home = fs.realpathSync.native(o.home); } catch { return refuse('HOME_UNREADABLE'); }
  try { placeReal = fs.realpathSync.native(path.join(home, ...stored.rel.split('/'))); } catch { return refuse('PLACE_CHANGED'); }
  if (keyOf(placeReal) !== stored.key) return refuse('PLACE_CHANGED');
  if (placeProblem(home, placeReal, o.stateRoot) !== null) return refuse('NOT_APPROVED');
  return { ok: true, placeReal };
}

/**
 * Reads one text file of an approved place of a module. The answer is the text or one short code, and it never holds a path. The gate, in order: the module and place id are well formed; the record can be used
 * (RECORD_DAMAGED, RECORD_BLOCKED) and holds that place for that module (NOT_APPROVED); the place is still the same folder (PLACE_CHANGED) and still passes the checks of an approval (NOT_APPROVED); the relative path
 * is plain (BAD_PATH); the real path of the file is inside the real path of the place, so a link cannot lead out (OUTSIDE_PLACE), and every part of its path inside the place is plain, so a link cannot lead to a
 * hidden file (BAD_PATH). The file is opened without following a link and without blocking, the opened file must be the one that was looked at, and must be a regular file (NOT_A_FILE: never a pipe or a device);
 * the real path is worked out again before the read. At most `readBytes` (TOO_LARGE), valid UTF-8 text with no NUL (NOT_TEXT).
 */
export function readPlaceFile(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly placeId: unknown; readonly path: unknown }): ReadAnswer {
  const gate = openPlace(o);
  if (!gate.ok) return no(gate.code);
  const placeReal = gate.placeReal;
  if (!cleanRelative(o.path)) return no('BAD_PATH');
  const walk = (): string | null => { try { return fs.realpathSync.native(path.join(placeReal, ...(o.path as string).split('/'))); } catch { return null; } };
  const fileReal = walk();
  if (fileReal === null) return no('UNREADABLE');
  if (!inside(placeReal, fileReal)) return no('OUTSIDE_PLACE');
  if (!path.relative(placeReal, fileReal).split(path.sep).every(plainPart)) return no('BAD_PATH');
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(fileReal);
    if (!before.isFile()) return no('NOT_A_FILE');
    fd = fs.openSync(fileReal, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const info = fs.fstatSync(fd);
    if (!info.isFile()) return no('NOT_A_FILE');
    if (info.dev !== before.dev || info.ino !== before.ino) return no('UNREADABLE');
    // The path is worked out again: a link that was moved while the file was opened must still lead to this file, inside the place.
    const again = walk();
    if (again !== fileReal || !inside(placeReal, again)) return no('OUTSIDE_PLACE');
    // And the file at that path must still be the file that is open.
    const after = fs.lstatSync(again);
    if (!after.isFile() || after.dev !== info.dev || after.ino !== info.ino) return no('UNREADABLE');
    if (info.size > SCOPE_LIMITS.readBytes) return no('TOO_LARGE');
    const buffer = Buffer.alloc(SCOPE_LIMITS.readBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > SCOPE_LIMITS.readBytes) return no('TOO_LARGE');
    if (buffer.subarray(0, length).includes(0)) return no('NOT_TEXT');
    try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) }; } catch { return no('NOT_TEXT'); }
  } catch { return no('UNREADABLE'); } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing more to do */ }
  }
}

export type ListCode = 'NOT_APPROVED' | 'PLACE_CHANGED' | 'HOME_UNREADABLE' | 'RECORD_DAMAGED' | 'RECORD_BLOCKED' | 'UNREADABLE';
/**
 * `files`: the relative paths of the markdown files, sorted, with `/` between parts. `truncated`: the walk stopped at a limit (files, entries, time) or left out a folder that is too deep, so more files may exist.
 * `skipped`: the folders that could not be listed (they could not be opened, sit on another device, or were replaced while they were read) and the entries that could not be looked at. Both are counts, never names.
 */
export type ListAnswer = { readonly ok: true; readonly files: readonly string[]; readonly truncated: boolean; readonly skipped: { readonly folders: number; readonly entries: number } } | { readonly ok: false; readonly code: ListCode };
const MARKDOWN = /\.(?:md|markdown)$/i;

/** What a test may swap. Main never passes any of it. */
export interface ListHooks {
  readonly opendir?: (dir: string) => fs.Dir;
  readonly lstat?: (path: string) => fs.Stats;
  readonly now?: () => number;
  readonly dev?: (abs: string, info: fs.Stats) => number;
  readonly limits?: Partial<{ files: number; depth: number; entries: number; ms: number }>;
}

/**
 * Lists the markdown files of an approved place of a module. The gate is the one of `readPlaceFile`. The walk reads names only and opens no file. It reads each folder entry by entry and counts every entry as it reads it,
 * so a folder of a million names is never loaded whole. It never follows a link: a link to a file or a folder is left out, so a link cannot lead out of the place or to a hidden file. A hidden part, or a part with a
 * control, bidirectional or lone surrogate character, is left out with all that is below it. A folder on another device than the place is skipped. A folder that is replaced while it is read is dropped. The walk keeps
 * at most `listFiles` files, looks at most at `listEntries` names and runs at most `listMs` milliseconds; a folder deeper than `listDepth` is left out and the walk goes on. After the walk the place is checked again, so a
 * place that was swapped meanwhile gives PLACE_CHANGED and no list. The answer holds relative paths only, never a full path.
 */
export function listPlaceFiles(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly placeId: unknown; readonly hooks?: ListHooks }): ListAnswer {
  const gate = openPlace(o);
  if (!gate.ok) return { ok: false, code: gate.code === 'NOT_APPROVED' || gate.code === 'PLACE_CHANGED' || gate.code === 'HOME_UNREADABLE' || gate.code === 'RECORD_DAMAGED' || gate.code === 'RECORD_BLOCKED' ? gate.code : 'UNREADABLE' };
  const h = o.hooks ?? {};
  const opendir = h.opendir ?? ((dir: string) => fs.opendirSync(dir)), lstat = h.lstat ?? ((p: string) => fs.lstatSync(p)), now = h.now ?? Date.now, devOf = h.dev ?? ((_abs: string, info: fs.Stats) => info.dev);
  const maxFiles = h.limits?.files ?? SCOPE_LIMITS.listFiles, maxDepth = h.limits?.depth ?? SCOPE_LIMITS.listDepth, maxEntries = h.limits?.entries ?? SCOPE_LIMITS.listEntries, maxMs = h.limits?.ms ?? SCOPE_LIMITS.listMs;
  const found: string[] = [];
  const started = now();
  let looked = 0, stopped = false, deepCut = false, rootFailed = false, skippedFolders = 0, skippedEntries = 0;
  let placeInfo: fs.Stats;
  try { placeInfo = lstat(gate.placeReal); } catch { return { ok: false, code: 'UNREADABLE' }; }
  const placeDev = devOf(gate.placeReal, placeInfo);
  const walk = (dirReal: string, dirInfo: fs.Stats, rel: string[], depth: number): void => {
    const mark = found.length;
    let dir: fs.Dir;
    try { dir = opendir(dirReal); } catch { if (depth === 0) rootFailed = true; skippedFolders += 1; return; }
    try {
      for (;;) {
        if (stopped) break;
        let entry: fs.Dirent | null;
        try { entry = dir.readSync(); } catch { skippedFolders += 1; found.length = mark; return; }
        if (entry === null) break;
        looked += 1;
        if (looked > maxEntries || now() - started > maxMs) { stopped = true; break; }
        const name = entry.name;
        if (!plainPart(name)) continue;
        const abs = path.join(dirReal, name);
        let info: fs.Stats;
        try { info = lstat(abs); } catch { skippedEntries += 1; continue; }
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          if (depth + 1 > maxDepth) { deepCut = true; continue; }
          if (devOf(abs, info) !== placeDev) { skippedFolders += 1; continue; }
          walk(abs, info, [...rel, name], depth + 1);
        } else if (info.isFile() && MARKDOWN.test(name)) {
          const joined = [...rel, name].join('/');
          if (joined.length > SCOPE_LIMITS.pathChars) continue;
          if (found.length >= maxFiles) { stopped = true; break; }
          found.push(joined);
        }
      }
    } finally { try { dir.closeSync(); } catch { /* nothing more to do */ } }
    // The folder must still be the one that was looked at: a swap while it was read drops what it gave.
    let after: fs.Stats | null = null;
    try { after = lstat(dirReal); } catch { /* gone */ }
    if (after === null || after.ino !== dirInfo.ino || after.dev !== dirInfo.dev) { found.length = mark; skippedFolders += 1; }
  };
  walk(gate.placeReal, placeInfo, [], 0);
  if (rootFailed) return { ok: false, code: 'UNREADABLE' };
  const again = openPlace(o);
  if (!again.ok || again.placeReal !== gate.placeReal) return { ok: false, code: 'PLACE_CHANGED' };
  found.sort();
  return { ok: true, files: Object.freeze(found), truncated: stopped || deepCut, skipped: { folders: skippedFolders, entries: skippedEntries } };
}
