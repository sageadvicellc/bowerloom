/**
 * The window's half of the close guard (owner decision Q1A). While any folder holds unsaved changes, the page holds its own unload with a `beforeunload` handler, so
 * closing the window, Cmd+Q and a reload do not drop the changes without a word. Main asks the question in a native box (main/close-guard.ts); this half
 * cannot answer it. It also says how many changes it holds in the page title, which main reads and the title bar never shows. With no change it sets no handler.
 */
import { useEffect } from 'react';
import { TITLE_NAME, discardWords, titleWithChanges } from '../../shared/harness/close-words.js';
import { useChangeCount } from './folder-draft.js';

/** The part of the `beforeunload` event that is used. */
export interface UnloadEvent { preventDefault(): void; returnValue: unknown }
/** The part of `window` that is used. */
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (event: UnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (event: UnloadEvent) => void): void;
}

/**
 * Sets the title for `count`, and the `beforeunload` handler when `count` is above zero. Gives back the call that takes the handler away.
 * Electron wants `returnValue` set on the event itself, not only a returned value.
 */
export function installCloseGuard(target: UnloadTarget, doc: { title: string }, count: number): () => void {
  doc.title = titleWithChanges(TITLE_NAME, count);
  if (count <= 0) return () => undefined;
  const hold = (event: UnloadEvent): void => {
    event.preventDefault();
    event.returnValue = discardWords(count);
  };
  target.addEventListener('beforeunload', hold);
  return () => target.removeEventListener('beforeunload', hold);
}

/** Holds the unload of the window while any folder has unsaved changes. */
export function useCloseGuard(): void {
  const count = useChangeCount();
  useEffect(() => installCloseGuard(window, document, count), [count]);
}
