/**
 * Writes the approval record of linked notes folders in the home folder (shared/real/linked-approvals.ts), in the app's private state folder:
 * `<state root>/linked-notes/approved.json`. Only the link flow calls it, after the person approved the save that names the folder. The folder is for its owner only (0700), must be a real
 * folder and never a link; the text goes to a new temporary file for its owner only (0600) and is renamed over the old record in one step. A failure gives false and never throws.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { APPROVALS_MAX, APPROVALS_MAX_BYTES, approvalKey, parseApprovals, serializeApprovals } from '../shared/real/linked-approvals.js';

export const approvalsFileOf = (stateRoot: string): string => join(stateRoot, 'linked-notes', 'approved.json');

function load(file: string): Set<string> {
  try {
    const s = lstatSync(file);
    if (!s.isFile() || s.size > APPROVALS_MAX_BYTES) return new Set();
    return new Set(parseApprovals(readFileSync(file, 'utf8')));
  } catch { return new Set(); }
}

/** True when the record holds an approval for this harness folder and stored path. */
export function isApproved(stateRoot: string, harnessFolder: string, stored: string): boolean {
  try { return load(approvalsFileOf(stateRoot)).has(approvalKey(realpathSync(harnessFolder), stored)); } catch { return false; }
}

/** Records the approvals. True when the record holds every one of them afterwards. */
export function recordApprovals(stateRoot: string, harnessFolder: string, stored: readonly string[]): boolean {
  if (stored.length === 0) return true;
  try {
    const file = approvalsFileOf(stateRoot), dir = join(stateRoot, 'linked-notes');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const info = lstatSync(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    chmodSync(dir, 0o700);
    const real = realpathSync(harnessFolder), keys = load(file);
    for (const path of stored) keys.add(approvalKey(real, path));
    if (keys.size > APPROVALS_MAX) return false;
    const tmp = join(dir, `.approved-${randomBytes(6).toString('hex')}.tmp`);
    try { writeFileSync(tmp, serializeApprovals(keys), { mode: 0o600, flag: 'wx' }); renameSync(tmp, file); } catch (error) { rmSync(tmp, { force: true }); throw error; }
    return true;
  } catch { return false; }
}
