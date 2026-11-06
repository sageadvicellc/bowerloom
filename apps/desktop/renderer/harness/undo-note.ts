/**
 * Undo from a button, and the note when a change did nothing. The store says why in a few lowercase words (or returns null when it worked); the note puts them after "Nothing changed:".
 */
import type { HarnessStore } from '../../shared/harness/store.js';
import type { Ui } from './ui.js';
import { nothingChanged } from './words-flow.js';

/** Undoes one history entry. When it is held back (a newer change comes first, the harness is gone), a note says why. */
export function undoNow(store: HarnessStore, ui: Ui, entryId: string): void {
  const why = store.undo(entryId);
  if (why !== null) ui.showToast(nothingChanged(why));
}

/**
 * Runs a change that may add a history entry. When it did, a note says `say` and offers "Undo". When it did not, a note says why (`change` returns the reason, or null).
 */
export function changeWithUndo(store: HarnessStore, ui: Ui, say: string, undoLabel: string, change: () => string | null | void): void {
  const before = store.getState().history.length;
  const why = change();
  const entry = store.getState().history[0];
  if (store.getState().history.length > before && entry !== undefined) ui.showToast(say, { label: undoLabel, run: () => undoNow(store, ui, entry.id) });
  else ui.showToast(nothingChanged(typeof why === 'string' ? why : 'nothing was different'));
}
