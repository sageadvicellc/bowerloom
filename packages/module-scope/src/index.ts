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

export const SCOPE_LIMITS = Object.freeze({ placesPerModule: 16, modules: 64, recordBytes: 128 * 1024, readBytes: 256 * 1024, pathChars: 512 });
const VERSION = 1;
/** A module id: the same name rule as an extension id (apps/desktop/shared/extensions/manifest.ts). */
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLACE_ID = /^place-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f]{32}$/;
const REL_PART = /^[^./\\\0][^/\\\0]{0,254}$/;

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
const inside = (root: string, child: string): boolean => child !== root && child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

type Record_ = { readonly status: 'none' } | { readonly status: 'damaged' } | { readonly status: 'blocked' } | { readonly status: 'ok'; readonly modules: Modules };

function validStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !PLACE_ID.test(v.id) || typeof v.key !== 'string' || !KEY.test(v.key) || v.id !== placeIdOf(v.key)) return false;
  if (typeof v.at !== 'string' || v.at.length > 40 || typeof v.rel !== 'string' || v.rel.length > SCOPE_LIMITS.pathChars) return false;
  return v.rel.split('/').every(part => REL_PART.test(part));
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

export type ApproveRefusal = 'BAD_MODULE' | 'NOT_A_FOLDER' | 'NOT_IN_HOME' | 'HIDDEN_PART' | 'STATE_FOLDER' | 'FULL' | 'RECORD_BLOCKED' | 'RECORD_NOT_MOVED' | 'FAILED';
export type Approved = { readonly status: 'kept'; readonly place: PlaceView } | { readonly status: 'refused'; readonly code: ApproveRefusal };
const refused = (code: ApproveRefusal): Approved => ({ status: 'refused', code });

/**
 * Records the person's pick of a folder as a place for one module. The pick is resolved to its real path, so a shortcut is approved as the folder it leads to. A place must be below the home folder (not the
 * home folder itself), must have no hidden part (such as `.ssh`), and must not hold or sit in the state folder. A damaged record is moved aside under a dated name first: the pick is the person's consent to a new list.
 */
export function approvePlace(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly picked: string; readonly now?: () => string }): Approved {
  if (typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId)) return refused('BAD_MODULE');
  let real: string, home: string;
  try {
    home = fs.realpathSync.native(o.home);
    real = fs.realpathSync.native(o.picked);
    if (!fs.statSync(real).isDirectory()) return refused('NOT_A_FOLDER');
  } catch { return refused('NOT_A_FOLDER'); }
  if (!inside(home, real)) return refused('NOT_IN_HOME');
  const rel = path.relative(home, real).split(path.sep);
  if (!rel.every(part => REL_PART.test(part)) || rel.join('/').length > SCOPE_LIMITS.pathChars) return refused(rel.some(part => part.startsWith('.')) ? 'HIDDEN_PART' : 'FAILED');
  const state = plannedReal(o.stateRoot);
  if (state === null || state === real || inside(real, state) || inside(state, real)) return refused('STATE_FOLDER');
  try {
    const dir = path.join(o.stateRoot, 'module-scope');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!ownFolder(fs.lstatSync(dir))) return refused('RECORD_BLOCKED');
    fs.chmodSync(dir, 0o700);
    let record = readRecord(o.stateRoot);
    if (record.status === 'blocked') return refused('RECORD_BLOCKED');
    if (record.status === 'damaged') {
      if (!setAside(dir, scopeFileOf(o.stateRoot))) return refused('RECORD_NOT_MOVED');
      record = { status: 'none' };
    }
    const modules: Modules = Object.create(null) as Modules;
    if (record.status === 'ok') for (const [id, list] of Object.entries(record.modules)) modules[id] = [...list];
    const key = keyOf(real);
    const list = modules[o.moduleId] ?? [];
    const held = list.find(s => s.key === key);
    if (held !== undefined) return { status: 'kept', place: viewOf(held) };
    if (list.length >= SCOPE_LIMITS.placesPerModule || (modules[o.moduleId] === undefined && Object.keys(modules).length >= SCOPE_LIMITS.modules)) return refused('FULL');
    const stored: Stored = { id: placeIdOf(key), rel: rel.join('/'), key, at: (o.now ?? ((): string => new Date().toISOString()))() };
    modules[o.moduleId] = [...list, stored];
    writeRecord(o.stateRoot, modules);
    return { status: 'kept', place: viewOf(stored) };
  } catch { return refused('FAILED'); }
}

export type Revoked = { readonly status: 'revoked' } | { readonly status: 'unknown' } | { readonly status: 'damaged' } | { readonly status: 'blocked' } | { readonly status: 'failed' };

/** Removes one place of one module from the record. It deletes no file of the person's. */
export function revokePlace(o: { readonly stateRoot: string; readonly moduleId: unknown; readonly placeId: unknown }): Revoked {
  const record = readRecord(o.stateRoot);
  if (record.status === 'damaged' || record.status === 'blocked') return { status: record.status };
  if (record.status === 'none' || typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId) || typeof o.placeId !== 'string') return { status: 'unknown' };
  const list = record.modules[o.moduleId] ?? [];
  if (!list.some(s => s.id === o.placeId)) return { status: 'unknown' };
  const modules: Modules = Object.create(null) as Modules;
  for (const [id, l] of Object.entries(record.modules)) modules[id] = id === o.moduleId ? l.filter(s => s.id !== o.placeId) : [...l];
  if (modules[o.moduleId]!.length === 0) delete modules[o.moduleId];
  try { writeRecord(o.stateRoot, modules); return { status: 'revoked' }; } catch { return { status: 'failed' }; }
}

export type ReadCode = 'NOT_APPROVED' | 'PLACE_CHANGED' | 'BAD_PATH' | 'OUTSIDE_PLACE' | 'NOT_A_FILE' | 'TOO_LARGE' | 'NOT_TEXT' | 'UNREADABLE';
export type ReadAnswer = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: ReadCode };
const no = (code: ReadCode): ReadAnswer => ({ ok: false, code });

/** True for a path that is one plain relative path of parts with no dot part, no hidden part, no empty part and no separator of another system. */
function cleanRelative(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SCOPE_LIMITS.pathChars && value.split('/').every(part => REL_PART.test(part));
}

/**
 * Reads one text file of an approved place of a module. The answer is the text or one short code, and it never holds a path. The gate, in order: the module and place id are well formed and the record
 * holds that place for that module (NOT_APPROVED); the place is still the same folder (PLACE_CHANGED); the relative path is plain (BAD_PATH); the real path of the file is inside the real path of the
 * place, so a link cannot lead out (OUTSIDE_PLACE); the file is a regular file (NOT_A_FILE) of at most `readBytes` (TOO_LARGE) that is valid UTF-8 text with no NUL (NOT_TEXT).
 */
export function readPlaceFile(o: { readonly stateRoot: string; readonly home: string; readonly moduleId: unknown; readonly placeId: unknown; readonly path: unknown }): ReadAnswer {
  if (typeof o.moduleId !== 'string' || !MODULE_ID.test(o.moduleId) || typeof o.placeId !== 'string' || !PLACE_ID.test(o.placeId)) return no('NOT_APPROVED');
  const record = readRecord(o.stateRoot);
  if (record.status !== 'ok') return no('NOT_APPROVED');
  const stored = (record.modules[o.moduleId] ?? []).find(s => s.id === o.placeId);
  if (stored === undefined) return no('NOT_APPROVED');
  let placeReal: string;
  try { placeReal = fs.realpathSync.native(path.join(fs.realpathSync.native(o.home), ...stored.rel.split('/'))); } catch { return no('PLACE_CHANGED'); }
  if (keyOf(placeReal) !== stored.key) return no('PLACE_CHANGED');
  if (!cleanRelative(o.path)) return no('BAD_PATH');
  let fileReal: string;
  try { fileReal = fs.realpathSync.native(path.join(placeReal, ...o.path.split('/'))); } catch { return no('UNREADABLE'); }
  if (!inside(placeReal, fileReal)) return no('OUTSIDE_PLACE');
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(fileReal);
    if (!before.isFile()) return no('NOT_A_FILE');
    fd = fs.openSync(fileReal, 'r');
    const info = fs.fstatSync(fd);
    if (!info.isFile()) return no('NOT_A_FILE');
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
