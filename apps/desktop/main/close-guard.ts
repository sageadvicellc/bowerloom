/**
 * The close guard of main (owner decision Q1A). A window with unsaved Builder changes holds its own unload (a `beforeunload` handler). Electron cancels such an unload
 * without a word unless main handles `will-prevent-unload`, so main asks in its own native box: "Discard N changes?", with "Keep editing" and "Discard". That one
 * event covers closing the window, Cmd+W, a reload, and Cmd+Q: `app.quit()` closes every window through the same unload, so a window that keeps its changes stops the quit.
 * - Discard: `event.preventDefault()` ignores the page's hold, so the unload goes on (the window closes, the quit continues).
 * - Keep editing, any other answer, and a box that fails: the event is left alone, so the window stays and the quit stops. It never discards by default.
 * The event is answered at once (Electron reads the answer when the handler returns), so the box is the synchronous one. The window cannot skip it, word it or answer it:
 * it has no channel here. It only says how many changes it holds, in its page title, which main reads as a whole number inside a fixed sentence (shared/harness/close-words.ts).
 * A title that is not exactly that sentence still asks, in general words. The tools come in as arguments, so a test runs it with no Electron.
 */
import { CLOSE_WORDS, changesInTitle, discardWords } from '../shared/harness/close-words.js';

/** The buttons, in order: the first is the default and the cancel button. */
export const CLOSE_BUTTONS: readonly [string, string] = Object.freeze([CLOSE_WORDS.keep, CLOSE_WORDS.discard]) as readonly [string, string];

/** What main shows: the options of a message box. */
export interface CloseQuestion {
  readonly type: 'warning';
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
  readonly defaultId: 0;
  readonly cancelId: 0;
  readonly noLink: true;
}

/** The box for a count of unsaved changes, or for no count (the window did not say). */
export function closeQuestion(count: number | null): CloseQuestion {
  const text = count === null ? CLOSE_WORDS.unknown : discardWords(count);
  return { type: 'warning', title: text, message: text, detail: CLOSE_WORDS.note, buttons: CLOSE_BUTTONS, defaultId: 0, cancelId: 0, noLink: true };
}

/** Shows the box and gives back the index of the button pressed (a synchronous box: `dialog.showMessageBoxSync`). */
export type AskClose = (options: CloseQuestion) => number;

export interface CloseGuardDeps {
  /** The title of the page now. */
  readonly title: () => string;
  readonly ask: AskClose;
}

/** The handler of `will-prevent-unload`. */
export function closeGuard(deps: CloseGuardDeps): (event: { preventDefault(): void }) => void {
  return event => {
    let answer: number;
    try { answer = deps.ask(closeQuestion(changesInTitle(deps.title()))); } catch { return; }
    // Only the second button lets the unload go on; every other answer keeps the window.
    if (answer === 1) event.preventDefault();
  };
}
