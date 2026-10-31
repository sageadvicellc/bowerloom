/**
 * "Two different copies": one skill, tool or agent that was found with different text in more than one tool. This turns the copies into what the
 * side-by-side view needs (each copy's lines, with the lines that differ marked) and into the one store action that keeps a copy. Pure: no React, no DOM.
 * The lines come from `diffLines` in setup-diff.ts. A copy is compared with one other copy: the first copy with the second, every later copy with
 * the first. For two copies the marks are symmetric: a line is marked in a copy when the other copy does not have it. No file path is ever returned.
 */
import type { HarnessItem } from '../proto/types.js';
import type { StoreAction } from '../proto/store.js';
import { conflictCopies, distinctTexts } from '../proto/conflicts.js';
import { diffLines } from '../proto/setup-diff.js';
import type { DiffLine } from '../proto/setup-diff.js';
import { sampleCopyDays } from './sample-copies.js';

/** True when the item has two or more different texts. */
export const hasCopies = (item: HarnessItem): boolean => distinctTexts(item) >= 2;

/** One copy as the dialog draws it. `index` is the number the store's `resolveConflict` keeps. `place` says where it was found, in words. */
export interface CopyView {
  readonly index: number;
  readonly number: number;
  readonly place: string;
  /** How many days ago the newest place of this copy was changed, or null when no place says. */
  readonly daysAgo: number | null;
  readonly lines: readonly DiffLine[];
  /** Lines this copy has that the other copy does not. */
  readonly changed: number;
}

/** The copies of an item, in the order they were found, with their lines marked. Empty when the item has fewer than two texts. */
export function copiesOf(item: HarnessItem): CopyView[] {
  const copies = conflictCopies(item);
  return copies.map((copy, at): CopyView => {
    const other = copies[at === 0 ? 1 : 0]!;
    const diff = diffLines(other.text, copy.text);
    const dates = sampleCopyDays(item), days = dates === null ? [] : item.foundAt.flatMap((f, place) => (f.contentHash === copy.hash ? [dates[place]!] : []));
    return { index: copy.index, number: at + 1, place: copy.interfaceNames, daysAgo: days.length === 0 ? null : Math.min(...days), lines: diff.lines, changed: diff.changed };
  });
}

/** The number of the copy that was changed last, or null when the copies do not all say when they changed, or the newest two changed on the same day. */
export function newerCopy(views: readonly CopyView[]): number | null {
  if (views.length < 2 || views.some(v => v.daysAgo === null)) return null;
  const least = Math.min(...views.map(v => v.daysAgo!)), newest = views.filter(v => v.daysAgo === least);
  return newest.length === 1 ? newest[0]!.number : null;
}

/** The store action that keeps one copy and drops the others from the draft. */
export const keepCopyAction = (itemId: string, copy: Pick<CopyView, 'index'>): StoreAction => ({ type: 'resolveConflict', itemId, keep: copy.index });

/** True when no line differs between the copies (the texts differ only in a way a line cannot show, such as the end of the file). */
export const copiesLookAlike = (views: readonly CopyView[]): boolean => views.length > 0 && views.every(v => v.changed === 0);
