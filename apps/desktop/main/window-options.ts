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
