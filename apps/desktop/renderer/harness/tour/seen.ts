/**
 * The guided tour starts on its own at first use (first five minutes, section 2: "A guided tour with a spotlight runs on first use, and a Help button replays
 * it"). First use is the first time the edit of a folder's agents opens, the notes-and-keeper flow, with no Notes keeper saved yet. Once it has started it
 * is "seen", and it does not start on its own again; Help replays it at any time.
 *
 * Where "seen" is kept: the window has no preference file of its own, and in this launch (--prototype-v3 and --prototype-v3-real) its app data is a
 * temporary folder that main removes when the app quits, so nothing kept there outlives the launch anyway. The harness window writes nothing to storage on
 * disk (tests/harness-boundary.test.ts), so "seen" goes in the safest per-viewer store: this window's `sessionStorage`, which is held in memory, survives a
 * reload of the page, and goes with the window. The tour therefore starts once per launch. This file is the one place in the window that touches it.
 * Every read and write is wrapped: a storage that throws, or none at all, never stops the window, and "seen" is then held in memory, so the tour still
 * never repeats in this window.
 */
import type { DefinitionView } from '../../../shared/engine/types.js';
import { keeperOf } from '../../../shared/harness/save-draft.js';

/** The one key "seen" is kept under. The e2e helpers set it, so a spec that is not about the tour starts with the tour seen. */
export const TOUR_SEEN_KEY = 'bowerloom-harness-tour-seen';

/** The two calls of a storage that "seen" needs. */
export interface SeenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface TourMemory { seen(): boolean; mark(): void }

/** "Seen" in the storage `storage` gives (asked each time, as it may throw), and in memory when the storage cannot keep it. */
export function createTourMemory(storage: () => SeenStorage | null | undefined): TourMemory {
  let held = false;
  return {
    seen: () => {
      if (held) return true;
      try { return storage()?.getItem(TOUR_SEEN_KEY) === '1'; } catch { return false; }
    },
    mark: () => {
      held = true;
      try { storage()?.setItem(TOUR_SEEN_KEY, '1'); } catch { /* held in memory for this window */ }
    },
  };
}

/** The window's own memory of the tour: `sessionStorage` of this page. */
export const WINDOW_TOUR = createTourMemory(() => (typeof sessionStorage === 'undefined' ? null : sessionStorage));

/** True when the tour starts on its own now: the edit is open on a harness that has been read, with no Notes keeper saved, and the tour not seen yet. */
export function startsOnItsOwn({ step, base, seen }: { step: string; base: DefinitionView | null; seen: boolean }): boolean {
  return step === 'edit' && base !== null && keeperOf(base) === null && !seen;
}
