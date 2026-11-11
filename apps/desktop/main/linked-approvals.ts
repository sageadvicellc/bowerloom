/**
 * Writes the approval record of linked notes folders in the home folder (shared/real/linked-approvals.ts), in the app's private state folder:
 * `<state root>/linked-notes/approved.json`. Only the link flow calls it, after the person approved the save that names the folder. The folder is for its owner only (0700), must be a real
 * folder and never a link; the text goes to a new temporary file for its owner only (0600) and is renamed over the old record in one step. A record that is damaged (a link, not a plain file,
 * over the size cap, or not a record of this version) is never written over: the person's earlier approvals could be in it, so the write refuses and says so. Nothing here throws.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { APPROVALS_MAX, APPROVALS_MAX_BYTES, approvalKey, parseApprovals, serializeApprovals } from '../shared/real/linked-approvals.js';

export const approvalsFileOf = (stateRoot: string): string => join(stateRoot, 'linked-notes', 'approved.json');

export type Record_ = { readonly status: 'none' } | { readonly status: 'damaged' } | { readonly status: 'ok'; readonly keys: Set<string> };

/** The record as it is on disk: none (no file), damaged, or its keys. */
export function loadRecord(file: string): Record_ {
  let info;
  try { info = lstatSync(file); } catch (error) { return (error as { code?: string }).code === 'ENOENT' ? { status: 'none' } : { status: 'damaged' }; }
  if (!info.isFile() || info.size > APPROVALS_MAX_BYTES) return { status: 'damaged' };
  try {
    const keys = parseApprovals(readFileSync(file, 'utf8'));
    return keys === null ? { status: 'damaged' } : { status: 'ok', keys: new Set(keys) };
  } catch { return { status: 'damaged' }; }
}

/** True when the record is damaged, so the write and the plan both refuse. */
export const recordDamaged = (stateRoot: string): boolean => loadRecord(approvalsFileOf(stateRoot)).status === 'damaged';

/** One link to approve: the stored path and the real folder it leads to now. */
export interface LinkEntry { readonly stored: string; readonly target: string }

/** True when the record holds an approval for this harness folder, stored path and target folder. */
export function isApproved(stateRoot: string, harnessFolder: string, entry: LinkEntry): boolean {
  try {
    const r = loadRecord(approvalsFileOf(stateRoot));
    return r.status === 'ok' && r.keys.has(approvalKey(realpathSync(harnessFolder), entry.stored, entry.target));
  } catch { return false; }
}

/** `kept`: the record holds every approval. `damaged`: the record is damaged and was not touched. `failed`: it could not be written. */
export type Recorded = 'kept' | 'damaged' | 'failed';

export function recordApprovals(stateRoot: string, harnessFolder: string, entries: readonly LinkEntry[]): Recorded {
  if (entries.length === 0) return 'kept';
  try {
    const file = approvalsFileOf(stateRoot), dir = join(stateRoot, 'linked-notes');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const info = lstatSync(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return 'failed';
    chmodSync(dir, 0o700);
    const r = loadRecord(file);
    if (r.status === 'damaged') return 'damaged';
    const keys = r.status === 'ok' ? r.keys : new Set<string>(), real = realpathSync(harnessFolder);
    for (const e of entries) keys.add(approvalKey(real, e.stored, e.target));
    if (keys.size > APPROVALS_MAX) return 'failed';
    const tmp = join(dir, `.approved-${randomBytes(6).toString('hex')}.tmp`);
    try { writeFileSync(tmp, serializeApprovals(keys), { mode: 0o600, flag: 'wx' }); renameSync(tmp, file); } catch (error) { rmSync(tmp, { force: true }); throw error; }
    return 'kept';
  } catch { return 'failed'; }
}
