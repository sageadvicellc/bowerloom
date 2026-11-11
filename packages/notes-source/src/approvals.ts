/**
 * The approval of a notes folder that a harness links in the home folder (`~/` form). A `knowledge.json` can come from a cloned repository, so a folder it names in the home folder is read
 * only when this computer holds the person's own approval of that exact folder. The approval is the pick: the person chose the folder with main's own notes chooser ("Link a notes folder",
 * "Use my notes"), and main records it (apps/desktop/main/notes-pick.ts). It is kept in the app's private state folder, `<state root>/linked-notes/approved.json`, by the real path of the
 * folder (SHA-256, cut to 32 characters, case as the file system keeps it), so the record names no folder, and a stored path that later leads to another folder through a swapped shortcut is
 * not approved. An approval is global for the folder: it holds for any harness that links it. The most it keeps is `APPROVALS_LIMITS.keys` folders.
 *
 * The folder of the record is checked as the saved read is (apps/desktop/main/scan-cache.ts): a real folder, never a link, owned by this user, and not writable by others; the same checks hold
 * for a read and for a write. The text goes to a new temporary file for its owner only (0600) and is renamed over the old record in one step. A record that is damaged (a link, not a plain
 * file, over the size cap, or not a record of this version) is moved aside by the next write under a dated name, never deleted and never written over: the pick is the person's consent to start a new
 * list, and nothing is lost. Nothing here throws.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const APPROVALS_LIMITS = Object.freeze({ keys: 2000, bytes: 256 * 1024 });
const VERSION = 1, KEY = /^[0-9a-f]{32}$/;

export const approvalsFileOf = (stateRoot: string): string => path.join(stateRoot, 'linked-notes', 'approved.json');
/** The key of a folder: SHA-256 of its real path, cut to 32 characters. */
export const approvalKey = (realFolder: string): string => createHash('sha256').update(`bowerloom-linked-notes\u0000${realFolder}`).digest('hex').slice(0, 32);

/**
 * The key of a folder by its native real path (`realpathSync.native`): the name the file system itself gives the folder, so `~/documents/notes` and `~/Documents/Notes` are one key on a volume that
 * ignores case, and two keys on a volume that keeps it. The write and the read both use it. Null when the folder is not there.
 */
export function approvalKeyOf(folder: string): string | null {
  try { return approvalKey(fs.realpathSync.native(folder)); } catch { return null; }
}

/**
 * The record as it is on disk: none (no file), damaged (the file cannot be read as a record), blocked (the folder of the record is a link, is not owned by this user, or is writable by others,
 * so neither a read nor a write is safe), or its keys.
 */
export type ApprovalRecord = { readonly status: 'none' } | { readonly status: 'damaged' } | { readonly status: 'blocked' } | { readonly status: 'ok'; readonly keys: ReadonlySet<string> };

const uid = (): number | undefined => process.getuid?.();
/** True when a folder is a real folder owned by this user. A link is never one. */
const ownFolder = (info: fs.Stats): boolean => !info.isSymbolicLink() && info.isDirectory() && (uid() === undefined || info.uid === uid());
/** True when nobody else can write to it. */
const isPrivate = (info: fs.Stats): boolean => (info.mode & 0o022) === 0;

export function readApprovals(stateRoot: string): ApprovalRecord {
  const dir = path.join(stateRoot, 'linked-notes'), file = approvalsFileOf(stateRoot);
  try {
    const folder = fs.lstatSync(dir);
    if (!ownFolder(folder) || !isPrivate(folder)) return { status: 'blocked' };
  } catch (error) { return (error as { code?: string }).code === 'ENOENT' ? { status: 'none' } : { status: 'blocked' }; }
  let info: fs.Stats;
  try { info = fs.lstatSync(file); } catch (error) { return (error as { code?: string }).code === 'ENOENT' ? { status: 'none' } : { status: 'damaged' }; }
  if (!info.isFile() || info.size > APPROVALS_LIMITS.bytes || (uid() !== undefined && info.uid !== uid())) return { status: 'damaged' };
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; keys?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.version !== VERSION || !Array.isArray(v.keys) || v.keys.length > APPROVALS_LIMITS.keys || !v.keys.every(k => typeof k === 'string' && KEY.test(k))) return { status: 'damaged' };
    return { status: 'ok', keys: new Set(v.keys as string[]) };
  } catch { return { status: 'damaged' }; }
}

/**
 * `kept`: the record holds the folder (a damaged record was moved aside under a dated name first). `full`: the record holds the most folders. `not-a-folder`: the pick is not a folder.
 * `not-moved`: the damaged record could not be set aside. `failed`: the folder of the record cannot be made or used, or the write failed.
 */
export type Approved = 'kept' | 'full' | 'not-a-folder' | 'not-moved' | 'failed';

/** Moves the damaged record to a dated name that nothing holds yet: a name that is taken is never written over, the next one is tried. There is no cap on the files set aside. */
function setAside(dir: string, file: string): boolean {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const aside = path.join(dir, `approved.json.damaged-${stamp()}-${randomBytes(3).toString('hex')}`);
    try { fs.lstatSync(aside); continue; } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') return false; }
    try { fs.renameSync(file, aside); return true; } catch { return false; }
  }
  return false;
}

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');

/** Records the person's pick of a folder. The folder is resolved to its real path here, so a shortcut is approved as the folder it leads to. */
export function approveFolder(stateRoot: string, picked: string): Approved {
  let real: string;
  try {
    real = fs.realpathSync.native(picked);
    if (!fs.statSync(real).isDirectory()) return 'not-a-folder';
  } catch { return 'not-a-folder'; }
  try {
    const dir = path.join(stateRoot, 'linked-notes'), file = approvalsFileOf(stateRoot);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const folder = fs.lstatSync(dir);
    if (!ownFolder(folder)) return 'failed';
    fs.chmodSync(dir, 0o700);
    let record = readApprovals(stateRoot);
    if (record.status === 'blocked') return 'failed';
    if (record.status === 'damaged') {
      // The pick is the person's consent to a new list. The damaged file is kept, under a dated name, and the new record starts empty.
      if (!setAside(dir, file)) return 'not-moved';
      record = { status: 'none' };
    }
    const keys = new Set(record.status === 'ok' ? record.keys : []);
    if (!keys.has(approvalKey(real)) && keys.size >= APPROVALS_LIMITS.keys) return 'full';
    keys.add(approvalKey(real));
    const tmp = path.join(dir, `.approved-${randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(tmp, `${JSON.stringify({ version: VERSION, keys: [...keys].sort() })}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch (error) { fs.rmSync(tmp, { force: true }); throw error; }
    return 'kept';
  } catch { return 'failed'; }
}
