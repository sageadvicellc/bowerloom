/**
 * The words of the close guard (owner decision Q1A): closing the window, Cmd+Q, Cmd+W or a reload while a folder holds unsaved Builder changes asks "Discard N changes?".
 * The window and main both read this file, so the question has one set of words. Main asks in its own box (main/close-guard.ts); the window only holds the unload
 * (renderer/harness/close-guard.ts) and says how many changes it holds, in its page title. The count is a number inside a fixed sentence: nothing else the window
 * writes ever reaches the box.
 */

/** The name in the page title. The window's title bar never shows the page title (main keeps it "Bowerloom"), so the count in the title is seen by nobody but main. */
export const TITLE_NAME = 'Bowerloom';

/** The words of the box. The labels are the Builder's own ("Keep editing" and "Discard" of the sheet that asks when a person leaves a folder). */
export const CLOSE_WORDS = Object.freeze({
  keep: 'Keep editing',
  discard: 'Discard',
  note: 'Your changes are not saved. Closing Bowerloom drops them.',
  /** The question when the window did not say how many changes it holds. */
  unknown: 'Discard your changes?',
});

/** "Discard 3 changes?": the question when the person leaves a folder, or the window, with unsaved changes. */
export const discardWords = (n: number): string => `Discard ${n} ${n === 1 ? 'change' : 'changes'}?`;

/** The page title for a count of unsaved changes: the plain name for none, and "Bowerloom, 3 unsaved changes" otherwise. */
export const titleWithChanges = (name: string, count: number): string => (count > 0 ? `${name}, ${count} unsaved ${count === 1 ? 'change' : 'changes'}` : name);

const TITLE = new RegExp(`^${TITLE_NAME}, ([1-9][0-9]{0,5}) unsaved (?:change|changes)$`);

/** The count a page title names, or null for any title that is not exactly the sentence above with a whole number from 1 to 999999. */
export function changesInTitle(title: unknown): number | null {
  if (typeof title !== 'string') return null;
  const found = TITLE.exec(title);
  return found === null ? null : Number(found[1]);
}
