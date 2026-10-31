/**
 * What main does when a window dies or its page fails to load AFTER the app has started. A write may be in progress then, so the app must not end at once:
 * it waits until the engine is idle (the serial queue of main/engine-service.ts is empty), tells the person in a box, and quits through the normal quit, so that
 * before-quit and quit run (the clean-up of main's private report copies, and of the temporary data folder). `app.exit` stays with start-up failures, where no
 * write can be running. The tools come in as arguments, so a test runs it with no Electron.
 */

/** Said after the cause, whenever the launch can write. The window cannot say it: it is the thing that died. */
export const SAVING_WORDS = 'If you were saving or installing, open the folder again to see what was written.';

export interface WindowFailureDeps {
  /** The engine's idle signal, or null for a launch that has no engine calls (nothing can be writing). */
  readonly engine: { idle(): Promise<void> } | null;
  /** The terminal (stderr): told at once, before any wait. */
  readonly say: (text: string) => void;
  /** The error box of the system. It may throw when no box can be shown. */
  readonly showBox: (title: string, message: string) => void;
  readonly setExitCode: (code: number) => void;
  /** Marks the app as ending, just before the quit. The close guard (main/close-guard.ts) then skips its box, so a window with unsaved changes cannot stop this quit. */
  readonly markEnding: () => void;
  /** `app.quit()`. Never `app.exit`. */
  readonly quit: () => void;
}

/** One handler for the whole window. The first failure wins; later ones (a dead process is often followed by a failed load) add no second box. */
export function windowFailure(deps: WindowFailureDeps): (error: Error, title: string) => Promise<void> {
  let started = false;
  return async (error, title) => {
    if (started) return;
    started = true;
    deps.say(`${title}: ${error.message}\n`);
    if (deps.engine !== null) {
      deps.say('Bowerloom is finishing the work it has started before it closes.\n');
      try { await deps.engine.idle(); } catch { /* the signal failed: show the box anyway */ }
    }
    try { deps.showBox(title, deps.engine === null ? error.message : `${error.message} ${SAVING_WORDS}`); } catch { /* no box could be shown; stderr has the message */ }
    deps.setExitCode(1);
    deps.markEnding();
    deps.quit();
  };
}
