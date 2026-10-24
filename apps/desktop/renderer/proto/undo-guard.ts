/**
 * Which undo and redo steps belong to the draft now. Applying or restoring makes a version, and going back past a version is for Versions,
 * not for Undo. Every step holds the draft as it was, and a draft carries the list of versions it was made under. A step made before the
 * last apply or restore carries an older list, so only the steps that carry the committed list belong to the draft.
 *
 * This reads the store as it is today. When the store itself clears both stacks on apply and restore, the lists are empty after those, the
 * same answer comes out, and this file can go.
 */
import type { StoreState } from '../../shared/proto/store.js';

/** True when the newest undo step was made since the last apply or restore. */
export function canUndoDraft(state: StoreState): boolean {
  const top = state.undoStack[state.undoStack.length - 1];
  return top !== undefined && top.versions === state.committed.versions;
}

/** True when the newest redo step was made since the last apply or restore. */
export function canRedoDraft(state: StoreState): boolean {
  const top = state.redoStack[state.redoStack.length - 1];
  return top !== undefined && top.versions === state.committed.versions;
}
