/**
 * The version store under the project lock, for a caller that holds no lock (the desktop app, which never takes the lock itself). `recordVersion` stays
 * synchronous and lock-free for a caller that holds the lock already; this is its locked form, as `addApprovalDraftLocked` is for the approval drafts.
 */
import { withProjectLock } from '../../project-context/src/index.js';
import { checkLayout } from './harness-state.js';
import type { HarnessStateDirs } from './harness-state.js';
import { listVersions, recordVersion } from './versions.js';
import type { VersionEntry, VersionFiles, VersionMeta } from './versions.js';

/** What to record: the file set and its meta, as `recordVersion` takes them. */
export interface KeepVersion { readonly files: VersionFiles; readonly meta: VersionMeta }

/**
 * Takes the project lock, reads the newest version of `folderKey` (or null), and calls `next` with it, still under the lock. `next` reads what it needs
 * (the definition as it is now, say) and returns what to record, or null to record nothing. Returns the recorded entry, or null. The layout must be the
 * layout of `projectDir` (PORTABLE_USAGE before the lock and before `next` runs). PROJECT_LOCKED while another holder has the lock. An error of `next`
 * passes through, and nothing is recorded.
 */
export async function recordVersionLocked(
  dirs: HarnessStateDirs, projectDir: string, folderKey: string, next: (newest: VersionEntry | null) => KeepVersion | null, signal?: AbortSignal,
): Promise<VersionEntry | null> {
  checkLayout(dirs, projectDir);
  return withProjectLock(projectDir, signal ?? new AbortController().signal, async held => {
    held.assertHeld(projectDir);
    const keep = next(listVersions(dirs, folderKey)[0] ?? null);
    return keep === null ? null : recordVersion(dirs, folderKey, keep.files, keep.meta);
  });
}
