/**
 * The saved read, as the app uses it. It joins three things: the file (main/scan-cache.ts), the walk that tells whether the watched folders changed (`watchTextOf` in main/real-scan.ts)
 * and the reader's own answer. It keeps no state of its own besides the file.
 *
 *  - `keepRead` wraps a read (question two). The folders are fingerprinted before the read, so a change during the read is seen next launch; the answer is saved after it. A failure of
 *    the fingerprint or the file never fails the read: the person gets the read, and the old saved read is removed so it cannot be shown as the last one.
 *  - `savedScan` is what a launch asks. It loads the file and reads no folder at all.
 *  - `checkSavedScan` is the cheap, read-only check that follows: it fingerprints the places of the saved read again and says whether anything differs.
 *
 * A saved read never gives a place an id the reader accepts: the reader's own list (main/real-scan.ts) is filled only by a look at the folders, so a read of a folder still needs
 * the look and the "Yes, read them" question first.
 */
import { createHash } from 'node:crypto';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { SAVED_SCAN_VERSION } from '../shared/real/saved-scan.js';
import type { SavedScanAnswer, SavedScanCheck } from '../shared/real/saved-scan.js';
import { watchTextOf } from './real-scan.js';
import type { WatchedPlace } from './real-scan.js';
import { createScanCache } from './scan-cache.js';
import type { ScanCache } from './scan-cache.js';

export interface Fingerprint { readonly fingerprint: string; readonly complete: boolean }
export type Fingerprinter = (home: string, watched: readonly WatchedPlace[], now?: () => number, budgetMs?: number) => Promise<Fingerprint>;

/** A SHA-256 of what the watched places look like (see `watchTextOf`). */
export const fingerprintOf: Fingerprinter = async (home, watched, now, budgetMs) => {
  const { text, complete } = await watchTextOf(home, watched, now, budgetMs);
  return { fingerprint: createHash('sha256').update(text).digest('hex'), complete };
};

/** The three facts of each ticked place that the fingerprint needs. */
export const watchedOf = (places: readonly RealPlace[]): WatchedPlace[] => places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));

export interface ScanSessionDeps {
  readonly home: string;
  readonly stateRoot: string;
  readonly now?: () => number;
  /** For a test: the file and the fingerprint, in place of the real ones. */
  readonly cache?: ScanCache;
  readonly fingerprint?: Fingerprinter;
  /** The time the check of a launch may take. Past it the answer is `unchecked`, never `same`. Default 5 seconds: the check runs in the main process. */
  readonly checkBudgetMs?: number;
}

export interface ScanSession {
  keepRead(chosen: readonly RealPlace[], read: () => Promise<RealResult>): Promise<RealResult>;
  savedScan(): Promise<SavedScanAnswer>;
  checkSavedScan(): Promise<SavedScanCheck>;
}

export const CHECK_BUDGET_MS = 5000;

/** The one fixed line told when a read could not be kept. It holds no path and no message of the error. */
const NOT_KEPT = 'Bowerloom could not keep its last read.';

export function createScanSession(deps: ScanSessionDeps): ScanSession {
  const now = deps.now ?? (() => Date.now()), cache = deps.cache ?? createScanCache({ stateRoot: deps.stateRoot }), fingerprint = deps.fingerprint ?? fingerprintOf;
  const checkBudget = deps.checkBudgetMs ?? CHECK_BUDGET_MS;
  /**
   * The read that is on the screen: its places and the fingerprint made before it. The launch sets it from the file it loaded and showed, and a read made in this window sets it too,
   * so the check always answers for the read the window holds and never for another file.
   */
  let held: { readonly chosen: readonly RealPlace[]; readonly fingerprint: string } | null = null;
  return {
    keepRead: async (chosen, read) => {
      let before: Fingerprint | null = null;
      try { before = await fingerprint(deps.home, watchedOf(chosen), now); } catch { before = null; }
      const result = await read();
      try {
        const kept = before !== null && chosen.length > 0 && cache.save({ version: SAVED_SCAN_VERSION, savedAtMs: now(), fingerprint: before.fingerprint, chosen, result });
        if (kept && before !== null) held = { chosen, fingerprint: before.fingerprint };
        else {
          // Not kept: the older read must not stay on disk to be called "last time" at the next launch.
          held = null;
          cache.forget();
          if (before !== null && chosen.length > 0) console.error(NOT_KEPT);
        }
      } catch (error) {
        held = null;
        try { cache.forget(); } catch { /* nothing more to do */ }
        console.error(`Bowerloom could not keep its last read (${error instanceof Error ? error.constructor.name : typeof error}).`);
      }
      return result;
    },
    savedScan: async () => {
      const found = cache.load();
      held = found.status === 'ok' ? { chosen: found.scan.chosen, fingerprint: found.scan.fingerprint } : null;
      if (found.status === 'none') return { status: 'none' };
      if (found.status === 'damaged') return { status: 'damaged', why: found.why };
      return { status: 'saved', savedAtMs: found.scan.savedAtMs, chosen: found.scan.chosen, result: found.scan.result };
    },
    checkSavedScan: async () => {
      const read = held;
      if (read === null) return 'unchecked';
      try {
        const current = await fingerprint(deps.home, watchedOf(read.chosen), now, checkBudget);
        return !current.complete ? 'unchecked' : current.fingerprint === read.fingerprint ? 'same' : 'changed';
      } catch { return 'unchecked'; }
    },
  };
}
