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
  /** The most milliseconds to wait for the engine to be idle. Default WAIT_MS. After it the box shows and the app quits, and the journal of a stopped write is recovered at the next open. */
  readonly waitMs?: number;
}

/** How long a dead window waits for the engine: a person may be looking at a dialog of a window that no longer exists, and a write is held to its own timer. */
export const WAIT_MS = 15_000;

/** One handler for the whole window. The first failure wins; later ones (a dead process is often followed by a failed load) add no second box. */
export function windowFailure(deps: WindowFailureDeps): (error: Error, title: string) => Promise<void> {
  let started = false;
  return async (error, title) => {
    if (started) return;
    started = true;
    deps.say(`${title}: ${error.message}\n`);
    if (deps.engine !== null) {
      deps.say('Bowerloom is finishing the work it has started before it closes.\n');
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<'late'>(resolve => { timer = setTimeout(() => { resolve('late'); }, deps.waitMs ?? WAIT_MS); });
      try {
        const result = await Promise.race([deps.engine.idle().then(() => 'idle' as const), late]);
        if (result === 'late') deps.say('The engine did not finish in time. Bowerloom closes now; a stopped write is recovered when the folder is opened again.\n');
      } catch (error) {
        // The signal failed: show the box anyway, and say why.
        deps.say(`The engine could not say when it was idle (${error instanceof Error ? error.message : String(error)}).\n`);
      } finally { clearTimeout(timer); }
    }
    try { deps.showBox(title, deps.engine === null ? error.message : `${error.message} ${SAVING_WORDS}`); } catch { /* no box could be shown; stderr has the message */ }
    deps.setExitCode(1);
    deps.markEnding();
    deps.quit();
  };
}
