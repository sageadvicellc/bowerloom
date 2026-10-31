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

/** Starts the built app (the folder `desktop`) with the given arguments and environment, hidden unless the person watches. */
export function launchElectron(desktop: string, args: string[], env?: Record<string, string | undefined>): Promise<ElectronApplication> {
  return electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, ...args, ...hiddenArgs()], ...(env === undefined ? {} : { env: env as Record<string, string> }) });
}
