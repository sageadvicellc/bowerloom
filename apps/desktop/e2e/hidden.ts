/**
 * Every e2e run is hidden by default: no window appears on the screen, no other app loses focus, and (on macOS) the Dock shows no icon.
 * This file is the one place that decides it. Every launch goes through `launchElectron` (or adds `hiddenArgs()` to its own command), and every
 * extra window a spec opens from the main process takes `extraWindowOptions()`.
 * Set BOWERLOOM_E2E_SHOW=1 to watch a run: the windows then show, as a person would see them.
 * The hidden switch is `--e2e-hidden` (main/window-options.ts). It changes only whether a window is shown.
 */
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import electronPath from 'electron';
import { E2E_HIDDEN_FLAG, hiddenWindowOptions } from '../main/window-options.js';

/** True when the person asked to watch the run. */
export const watching: boolean = process.env.BOWERLOOM_E2E_SHOW === '1';

/** The arguments to add to a start of the app. Empty when the person watches. */
export function hiddenArgs(): string[] { return watching ? [] : [E2E_HIDDEN_FLAG]; }

/** The options of a window that a spec makes in the main process (it is plain data, so it can go through `app.evaluate`). */
export function extraWindowOptions(): { show: boolean; paintWhenInitiallyHidden?: boolean } { return watching ? { show: true } : { ...hiddenWindowOptions() }; }

/**
 * Answers main's close question ("Discard N changes?", main/close-guard.ts) in place of a person, and records what it was asked. `answer` is the index of the button: 0 is
 * "Keep editing" and 1 is "Discard". It replaces the synchronous box in the main process, so a hidden run never waits on a box nobody can see. Gives nothing back; read the
 * asks with `closeAsks`.
 */
export async function answerCloseQuestion(app: ElectronApplication, answer: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, a) => {
    const g = globalThis as unknown as { __closeAsks?: { title: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }[] };
    g.__closeAsks = [];
    (dialog as unknown as { showMessageBoxSync: (...args: unknown[]) => number }).showMessageBoxSync = (...args: unknown[]): number => {
      const options = args[args.length - 1] as { title: string; detail: string; buttons: string[]; defaultId: number; cancelId: number };
      g.__closeAsks!.push({ title: options.title, detail: options.detail, buttons: [...options.buttons], defaultId: options.defaultId, cancelId: options.cancelId });
      return a;
    };
  }, answer);
}

/** What main asked since the last `answerCloseQuestion`. */
export function closeAsks(app: ElectronApplication): Promise<{ title: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }[]> {
  return app.evaluate(() => (globalThis as unknown as { __closeAsks?: never[] }).__closeAsks ?? []);
}

/**
 * Starts the built app (the folder `desktop`) with the given arguments and environment, hidden unless the person watches. The close question answers "Discard" at first,
 * so a run that ends, or reloads the page, with unsaved changes in the Builder never waits on a box; a spec about the question sets its own answer.
 */
export async function launchElectron(desktop: string, args: string[], env?: Record<string, string | undefined>): Promise<ElectronApplication> {
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, ...args, ...hiddenArgs()], ...(env === undefined ? {} : { env: env as Record<string, string> }) });
  await answerCloseQuestion(app, 1);
  return app;
}
