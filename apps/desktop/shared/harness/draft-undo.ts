/**
 * Undo and redo of the Builder's unsaved changes: a bounded stack of earlier drafts of one folder (shared/harness/save-draft.ts). Plain data only: no React,
 * no clock, no call. Every function hands back a new frozen stack and never changes the one it is given.
 *
 * Saved changes are not here: they go back through the folder's save points ("Go back"). After a save, a discard, or a move to another folder, the stack
 * starts again from one draft (`resetDraft`).
 */
import { EMPTY_DRAFT } from './save-draft.js';
import type { SaveDraft } from './save-draft.js';

/** The most earlier drafts the stack keeps for undo, and the most later drafts it keeps for redo. */
export const UNDO_LIMIT = 50;

/** The draft now, the drafts before it (oldest first), and the drafts an undo stepped back from (the next redo first). */
export interface DraftStack {
  readonly past: readonly SaveDraft[];
  readonly present: SaveDraft;
  readonly future: readonly SaveDraft[];
  readonly limit: number;
}

const stackOf = (past: readonly SaveDraft[], present: SaveDraft, future: readonly SaveDraft[], limit: number): DraftStack =>
  Object.freeze({ past: Object.freeze([...past]), present, future: Object.freeze([...future]), limit });

/** A stack that starts from `draft`, with nothing to undo or redo. A limit that is not a whole number of at least one is a RangeError. */
export function startDraft(draft: SaveDraft = EMPTY_DRAFT, limit: number = UNDO_LIMIT): DraftStack {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`The undo limit must be a whole number of at least 1, not ${String(limit)}.`);
  return stackOf([], draft, [], limit);
}

/**
 * Records a change: the draft now goes onto the undo list and `next` becomes the draft. The redo list is dropped. The oldest draft goes when the list is
 * past the limit. The same draft as now is no change, and the stack comes back as it was.
 */
export function pushDraft(stack: DraftStack, next: SaveDraft): DraftStack {
  if (next === stack.present) return stack;
  return stackOf([...stack.past, stack.present].slice(-stack.limit), next, [], stack.limit);
}

/** Steps back one change. With nothing to undo, the stack comes back as it was. */
export function undoDraft(stack: DraftStack): DraftStack {
  const previous = stack.past[stack.past.length - 1];
  if (previous === undefined) return stack;
  return stackOf(stack.past.slice(0, -1), previous, [stack.present, ...stack.future].slice(0, stack.limit), stack.limit);
}

/** Steps forward one change that an undo stepped back from. With nothing to redo, the stack comes back as it was. */
export function redoDraft(stack: DraftStack): DraftStack {
  const next = stack.future[0];
  if (next === undefined) return stack;
  return stackOf([...stack.past, stack.present].slice(-stack.limit), next, stack.future.slice(1), stack.limit);
}

/** Starts again from one draft, with the same limit: after a save, a discard, or a move to another folder. */
export const resetDraft = (stack: DraftStack, draft: SaveDraft = EMPTY_DRAFT): DraftStack => startDraft(draft, stack.limit);

export const canUndo = (stack: DraftStack): boolean => stack.past.length > 0;
export const canRedo = (stack: DraftStack): boolean => stack.future.length > 0;
/** How many changes an undo can step back through. */
export const undoCount = (stack: DraftStack): number => stack.past.length;
