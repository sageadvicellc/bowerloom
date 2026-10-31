/**
 * Shared set-up for the harness-first preview e2e specs (Electron started with --sample and a temporary data folder from temp-dirs.ts).
 * One launch per spec file. The specs run one at a time on this machine: take the lock before a run (`until mkdir /tmp/bowerloom-test.lock 2>/dev/null; do sleep 5; done`) and release it after.
 * Set HARNESS_SHOTS to a folder outside the repo to also save screenshots.
 */
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_SEEN_KEY } from '../renderer/harness/tour/seen.js';
import { animationsDone } from './page-wait.js';
import { tempDir } from './temp-dirs.js';

export const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
export const shotsDir = process.env.HARNESS_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });

export interface Harness { app: ElectronApplication; page: Page }

/** The app, past the first three screens: the Harness list. */
export const APP = '#sample/harnesses';
/** The first minute: Welcome. */
export const WELCOME = '#sample';
export const WEEKLY = 'harness-weekly-report-crew';

/**
 * Builds the bundle fresh from the source in this folder, starts the app with --sample and waits for the first window. The guided tour starts on its
 * own at first use; a spec that is not about it starts with the tour seen, in the window's session store (it lasts through `fresh`), unless `freshTour`.
 */
export async function launchHarness({ samplePreviewEngines = false, freshTour = false }: { samplePreviewEngines?: boolean; freshTour?: boolean } = {}): Promise<Harness> {
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  const userData = tempDir('bowerloom-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sample', ...(samplePreviewEngines ? ['--sample-preview-engines'] : []), `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
  if (!freshTour) await page.evaluate(key => sessionStorage.setItem(key, '1'), TOUR_SEEN_KEY);
  return { app, page };
}

/** Starts the page again from nothing, as a new session, on the address given. */
export async function fresh(page: Page, hash: string = APP): Promise<void> {
  await page.evaluate(h => { location.hash = h; location.reload(); }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
}

export async function shot(page: Page, name: string): Promise<void> {
  if (shotsDir === null) return;
  await animationsDone(page);
  await page.screenshot({ path: join(shotsDir, `${name}.png`), scale: 'css' });
}
