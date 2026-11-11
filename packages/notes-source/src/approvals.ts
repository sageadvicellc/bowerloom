/**
 * The approval of a notes folder that a harness links in the home folder (`~/` form). A `knowledge.json` can come from a cloned repository, so a folder it names in the home folder is read
 * only when this computer holds the person's own approval of that exact folder. The approval is the pick: the person chose the folder with main's own notes chooser ("Link a notes folder",
 * "Use my notes"), and main records it (apps/desktop/main/main.ts). It is kept in the app's private state folder, `<state root>/linked-notes/approved.json`, by the real path of the folder
 * (SHA-256, cut to 32 characters), so the record names no folder, and a stored path that later leads to another folder through a swapped shortcut is not approved.
 *
 * The folder of the record is for its owner only (0700) and must be a real folder, never a link. The text goes to a new temporary file for its owner only (0600) and is renamed over the old
 * record in one step. A record that is damaged (a link, not a plain file, over the size cap, or not a record of this version) is never written over: earlier approvals could be in it, so
 * the write refuses and says so. Nothing here throws.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const APPROVALS_LIMITS = Object.freeze({ keys: 2000, bytes: 256 * 1024 });
const VERSION = 1, KEY = /^[0-9a-f]{32}$/;

export const approvalsFileOf = (stateRoot: string): string => path.join(stateRoot, 'linked-notes', 'approved.json');
/** The key of a folder: SHA-256 of its real path, cut to 32 characters. */
export const approvalKey = (realFolder: string): string => createHash('sha256').update(`bowerloom-linked-notes\u0000${realFolder}`).digest('hex').slice(0, 32);

export type ApprovalRecord = { readonly status: 'none' } | { readonly status: 'damaged' } | { readonly status: 'ok'; readonly keys: ReadonlySet<string> };

/** The record as it is on disk: none (no file), damaged, or its keys. */
export function readApprovals(stateRoot: string): ApprovalRecord {
  const file = approvalsFileOf(stateRoot);
  let info: fs.Stats;
  try { info = fs.lstatSync(file); } catch (error) { return (error as { code?: string }).code === 'ENOENT' ? { status: 'none' } : { status: 'damaged' }; }
  if (!info.isFile() || info.size > APPROVALS_LIMITS.bytes) return { status: 'damaged' };
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; keys?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.version !== VERSION || !Array.isArray(v.keys) || v.keys.length > APPROVALS_LIMITS.keys || !v.keys.every(k => typeof k === 'string' && KEY.test(k))) return { status: 'damaged' };
    return { status: 'ok', keys: new Set(v.keys as string[]) };
  } catch { return { status: 'damaged' }; }
}

/** `kept`: the record holds the folder. `damaged`: the record is damaged and was not touched. `failed`: it could not be written, or the folder is not a folder. */
export type Approved = 'kept' | 'damaged' | 'failed';

/** Records the person's pick of a folder. The folder is resolved to its real path here, so a shortcut is approved as the folder it leads to. */
export function approveFolder(stateRoot: string, picked: string): Approved {
  try {
    const real = fs.realpathSync(picked);
    if (!fs.statSync(real).isDirectory()) return 'failed';
    const dir = path.join(stateRoot, 'linked-notes');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return 'failed';
    fs.chmodSync(dir, 0o700);
    const record = readApprovals(stateRoot);
    if (record.status === 'damaged') return 'damaged';
    const keys = new Set(record.status === 'ok' ? record.keys : []);
    keys.add(approvalKey(real));
    if (keys.size > APPROVALS_LIMITS.keys) return 'failed';
    const tmp = path.join(dir, `.approved-${randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(tmp, `${JSON.stringify({ version: VERSION, keys: [...keys].sort() })}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, approvalsFileOf(stateRoot));
    } catch (error) { fs.rmSync(tmp, { force: true }); throw error; }
    return 'kept';
  } catch { return 'failed'; }
}
