/**
 * The size, the smallest size and the title of the window, as plain data so a test can read them without Electron.
 * Every launch opens at 1280 by 800: the shelves hide under 1200 px wide while a drawer is open (renderer/home/home.css), and the old
 * 1100 by 760 put them out of sight after every add.
 */

export interface WindowOptions { readonly width: number; readonly height: number; readonly minWidth: number; readonly minHeight: number; readonly title: string }

const OPTIONS: WindowOptions = Object.freeze({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Bowerloom' });

export function windowOptions(): WindowOptions { return OPTIONS; }

/**
 * `--e2e-hidden` is a test switch, and it changes one thing: whether a window is shown. A window of this mode is made and loaded, and it is never shown, so nothing
 * appears on the screen, no other app loses focus, and (on macOS) the Dock shows no icon. Nothing about the page, the bridge, the data folder or the security rules differs,
 * and the switch reads no environment variable. A packaged app that is started with it only shows no window; that gives a caller no right it did not already have, because
 * a caller that can pass an argument to the app can start the app any other way it likes.
 */
export const E2E_HIDDEN_FLAG = '--e2e-hidden';

export function e2eHidden(argv: readonly string[]): boolean { return argv.includes(E2E_HIDDEN_FLAG); }

/** What a window of this mode needs from Electron: the window shows only on request, and a window that is never shown still paints and runs its timers. */
export function hiddenWindowOptions(): { readonly show: false; readonly paintWhenInitiallyHidden: true } { return { show: false, paintWhenInitiallyHidden: true }; }

/** The window is ready: show it, unless the start was a hidden one. */
export function revealWindow(window: { show(): void }, argv: readonly string[]): void { if (!e2eHidden(argv)) window.show(); }

/** On macOS the app also leaves the Dock in this mode, so no icon bounces. Other systems have no Dock. */
export function leaveDock(app: { readonly dock?: { hide(): void } | undefined }, argv: readonly string[]): void { if (e2eHidden(argv)) app.dock?.hide(); }

/** The parts of Electron's `dialog` that a hidden start replaces. A test hands in a plain object. */
export interface QuietDialog {
  showErrorBox: (title: string, content: string) => void;
  showMessageBox: (...args: never[]) => Promise<{ response: number; checkboxChecked: boolean }>;
  showMessageBoxSync: (...args: never[]) => number;
  showOpenDialog: (...args: never[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (...args: never[]) => Promise<{ canceled: boolean; filePath: string }>;
}

const optionsOf = (args: readonly unknown[]): { title?: string; message?: string; cancelId?: number } => (args.length > 1 ? args[1] : args[0]) as { title?: string; message?: string; cancelId?: number } ?? {};
const answerOf = (o: { cancelId?: number }): number => (typeof o.cancelId === 'number' && Number.isInteger(o.cancelId) && o.cancelId >= 0 ? o.cancelId : 0);

/**
 * A hidden start (`--e2e-hidden`) shows no native box: a box would stop a test and put a message on a person's screen. In that mode each native box of `dialog` writes its title and
 * message to `say` (stderr) and answers with the safe choice, the one that keeps data: an error box shows nothing; a question answers its `cancelId` (the button that cancels or keeps:
 * "Cancel", "Keep editing"), or the first button when it has none; a file chooser is closed with no pick. A test that needs another answer replaces the function after the start, as before.
 * Does nothing when the start is not hidden. Returns whether it replaced the boxes.
 */
export function quietDialogs(dialog: QuietDialog, argv: readonly string[], say: (text: string) => void): boolean {
  if (!e2eHidden(argv)) return false;
  // A closed stderr (EPIPE) must not turn a quiet box into a crash.
  const told = (kind: string, title: string | undefined, message: string | undefined): void => { try { say(`Bowerloom box not shown (hidden start, ${kind}): ${[title, message].filter((t): t is string => t !== undefined && t !== '').join(': ')}\n`); } catch { /* nobody reads stderr */ } };
  dialog.showErrorBox = (title, content) => { told('error', title, content); };
  dialog.showMessageBox = (async (...args: unknown[]) => { const o = optionsOf(args); told('question', o.title, o.message); return { response: answerOf(o), checkboxChecked: false }; }) as QuietDialog['showMessageBox'];
  dialog.showMessageBoxSync = ((...args: unknown[]) => { const o = optionsOf(args); told('question', o.title, o.message); return answerOf(o); }) as QuietDialog['showMessageBoxSync'];
  dialog.showOpenDialog = (async (...args: unknown[]) => { told('chooser', optionsOf(args).title, undefined); return { canceled: true, filePaths: [] }; }) as QuietDialog['showOpenDialog'];
  dialog.showSaveDialog = (async (...args: unknown[]) => { told('chooser', optionsOf(args).title, undefined); return { canceled: true, filePath: '' }; }) as QuietDialog['showSaveDialog'];
  return true;
}
