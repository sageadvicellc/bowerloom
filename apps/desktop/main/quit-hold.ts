/**
 * What main does when the person quits while the engine still works (Cmd+Q, the Quit menu, or the last window closing on Windows and Linux). An import or an export writes
 * in a worker thread, and a quit that ends the thread part way leaves a stopped save. So `before-quit` holds the quit until the engine is idle (the serial queue of
 * main/engine-service.ts is empty). If the wait is not short, a native box says a save is finishing. The wait has a bound: past it the app quits anyway, and the journal
 * with "Finish a stopped harness" puts the folder right at the next open. The tools come in as arguments, so a test runs it with no Electron.
 */

/** The longest the quit waits for the engine. */
export const QUIT_WAIT_MS = 30_000;
/** A wait shorter than this shows no box: most quits find the engine idle. */
export const QUIT_BOX_AFTER_MS = 400;

/** The words of the box. They say what is happening, how long it can take, and what happens after. */
export const QUIT_WORDS = Object.freeze({
  title: 'Bowerloom is finishing a save',
  message: 'A save is finishing. Bowerloom closes when it is done.',
  detail: `Please wait. If this takes longer than ${QUIT_WAIT_MS / 1000} seconds, Bowerloom closes anyway. Then open the folder again: Finish a stopped harness puts it right.`,
  button: 'OK',
});

export interface QuitHoldDeps {
  /** The engine's idle signal and its synchronous check, or null for a launch that has no engine calls (nothing can be writing). Read at each quit. */
  readonly engine: { idle(): Promise<void>; busy(): boolean } | null;
  /** True once the app is ending on its own (a window that failed, main/window-failure.ts). That path has its own bound, so this one stands aside. */
  readonly ending: () => boolean;
  /** Shows the native box without waiting for an answer. It may throw when no box can be shown. */
  readonly showBox: (words: typeof QUIT_WORDS) => void;
  /** `app.quit()`: runs `before-quit` again, which this hold lets through once. */
  readonly quit: () => void;
  /** Said when the wait ends by its bound, or the engine could not say. Defaults to the log of the app. */
  readonly log?: (text: string, cause?: unknown) => void;
  readonly waitMs?: number;
  readonly boxAfterMs?: number;
  /**
   * Backstop: ends the app at once. Used only when a quit that the hold started has not reached `will-quit` in `backstopMs`. It gets code 1, because the app did not quit as it
   * should have. `app.exit` skips the `quit` event, so the caller does the clean-up of that event first (the report copies).
   */
  readonly exit: (code: number) => void;
  /** How long the quit that the hold started may take to reach `will-quit`. Default QUIT_BACKSTOP_MS. */
  readonly backstopMs?: number;
}

/** The handler of `before-quit`; `reachedWillQuit` is for the `will-quit` event and stops the backstop; `windowsClosed` is for `window-all-closed` and starts it; `cancelled` is for a window that kept its unsaved changes, which ends the quit. */
export type QuitHold = ((event: { preventDefault(): void }) => void) & { readonly reachedWillQuit: () => void; readonly windowsClosed: () => void; readonly cancelled: () => void; readonly begun: () => boolean };

/** After the hold lets a held quit go on and every window is closed, the app must reach `will-quit` within this time, or the backstop ends it. */
export const QUIT_BACKSTOP_MS = 5_000;

/** The handler of `before-quit`. */
export function quitHold(deps: QuitHoldDeps): QuitHold {
  const log = deps.log ?? ((text, cause) => { console.error(text, cause === undefined ? '' : cause instanceof Error ? cause.message : String(cause)); });
  let letThrough = false, holding = false, begun = false;
  let backstop: NodeJS.Timeout | undefined;
  /** True from the moment the hold lets a quit go on until that quit reaches will-quit (or a new quit starts). */
  let continuing = false;

  const pause = (ms: number): { done: Promise<'late'>; stop: () => void } => {
    let timer: NodeJS.Timeout | undefined;
    const done = new Promise<'late'>(resolve => { timer = setTimeout(() => { resolve('late'); }, ms); });
    return { done, stop: () => { clearTimeout(timer); } };
  };

  async function wait(engine: { idle(): Promise<void> }): Promise<void> {
    const bound = deps.waitMs ?? QUIT_WAIT_MS, boxAfter = Math.min(deps.boxAfterMs ?? QUIT_BOX_AFTER_MS, bound);
    const idle = engine.idle().then(() => 'idle' as const, (error: unknown) => { log('Bowerloom: the engine could not say when it was idle, so the quit goes on.', error); return 'idle' as const; });
    const first = pause(boxAfter);
    try { if (await Promise.race([idle, first.done]) === 'idle') return; } finally { first.stop(); }
    try { deps.showBox(QUIT_WORDS); } catch (error) { log('Bowerloom: the box about a save that is finishing could not be shown.', error); }
    const rest = pause(bound - boxAfter);
    try {
      if (await Promise.race([idle, rest.done]) === 'late') log(`Bowerloom: a save did not finish in ${bound / 1000} seconds, so the app quits. A stopped save is recovered when the folder is opened again.`);
    } finally { rest.stop(); }
  }

  const handler = (event: { preventDefault(): void }): void => {
    begun = true;
    // The quit this hold started comes back here once; the next quit holds again.
    if (letThrough) { letThrough = false; return; }
    const engine = deps.engine;
    if (engine === null || deps.ending()) return;
    // An idle engine has nothing to finish, so the quit is never held: a held quit that is re-started later does not always end the app (a quit that began as a signal).
    if (!engine.busy()) return;
    event.preventDefault();
    if (holding) return;
    continuing = false; clearTimeout(backstop);
    holding = true;
    void wait(engine).finally(() => {
      holding = false; letThrough = true;
      continuing = true;
      deps.quit();
      // The quit asks before-quit at once. If it did not, the pass-through must not wait for some later quit.
      letThrough = false;
    }).catch((error: unknown) => {
      // deps.quit threw: the quit did not go on, so nothing is let through later, and the log says so.
      holding = false; letThrough = false; continuing = false;
      log('Bowerloom: the quit could not be started again after the wait.', error);
    });
  };
  /**
   * Every window is closed. For a quit that the hold let go on, will-quit must follow at once. When the held quit began as a signal (SIGTERM), Electron does not go on after the
   * windows close: it emits window-all-closed and waits. So the quit is asked once more here, and it goes on. If it does not within the backstop time, the app would stay open with no window, so the
   * backstop ends it. A quit that a window cancelled (Keep editing) is ended by `cancelled`, so a later close of the last window does not come here as a quit.
   */
  const windowsClosed = (): void => {
    if (!continuing) return;
    clearTimeout(backstop);
    backstop = setTimeout(() => {
      continuing = false; letThrough = false;
      log(`Bowerloom: the quit did not reach will-quit in ${(deps.backstopMs ?? QUIT_BACKSTOP_MS) / 1000} seconds, so the app exits now (engine busy: ${String(deps.engine?.busy() ?? false)}).`);
      deps.exit(1);
    }, deps.backstopMs ?? QUIT_BACKSTOP_MS);
    backstop.unref();
    // Found by experiment: Electron closed the windows of this quit and then emitted window-all-closed instead of going on to will-quit. A second quit from here goes on.
    letThrough = true;
    deps.quit();
    letThrough = false;
  };
  /** A window kept its unsaved changes (Keep editing): the quit is over. The app stays, and a later close of the last window must not end it. */
  const cancelled = (): void => { begun = false; continuing = false; letThrough = false; clearTimeout(backstop); };
  return Object.assign(handler, { reachedWillQuit: () => { continuing = false; letThrough = false; clearTimeout(backstop); }, windowsClosed, cancelled, begun: () => begun });
}
