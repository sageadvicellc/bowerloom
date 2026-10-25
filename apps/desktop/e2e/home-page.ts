/**
 * Shared set-up for the home app e2e specs (Electron started with --prototype-v2 and a temporary data folder from proto-temp.ts). One launch per spec file,
 * a viewport override to the sizes the review needs, the theme, and screenshots when HOME_U0_SHOTS names a folder (outside the repo).
 */
import { _electron as electron } from '@playwright/test';
import type { CDPSession, ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animationsDone } from './proto-wait.js';
import { tempDir } from './proto-temp.js';

export const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
export const shotsDir = process.env.HOME_U0_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
export const SIZES = [[1440, 900], [900, 600]] as const;
export const THEMES = ['light', 'dark'] as const;

export interface Home { app: ElectronApplication; page: Page }

/** Builds the bundle fresh from the source in this folder, starts the app with --prototype-v2 and waits for the first window. */
export async function launchHome(): Promise<Home> {
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  const userData = tempDir('bowerloom-prototype-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-v2', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
  return { app, page };
}

const emulations = new WeakMap<Page, CDPSession>();
/** Shows the page at w by h (the window may be smaller than the size asked for, so the viewport is emulated). */
export async function resize(page: Page, w: number, h: number): Promise<void> {
  let emulation = emulations.get(page);
  if (emulation === undefined) { emulation = await page.context().newCDPSession(page); emulations.set(page, emulation); }
  await emulation.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(({ w: ww, h: hh }) => window.innerWidth === ww && window.innerHeight === hh, { w, h });
}

/** Sets the look the way the person's computer does, through the colour-scheme setting, and waits for the page to follow. */
export async function setLook(page: Page, look: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: look });
  await page.waitForFunction(l => document.documentElement.getAttribute('data-theme') === l, look);
}

/** Starts the app page again from nothing, as a new session: the tour runs again. */
export async function fresh(page: Page, hash = '#prototype-v2'): Promise<void> {
  await page.evaluate(h => { location.hash = h; location.reload(); }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
}

/** Ends the tour if it is running (the shell specs look at the shell, not the tour). */
export async function skipTour(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: 'Tour' });
  if (await tour.count() > 0) { await page.keyboard.press('Escape'); await tour.waitFor({ state: 'detached' }); }
}

export async function shot(page: Page, name: string, w: number, h: number, look: string, fullPage = false): Promise<void> {
  if (shotsDir === null) return;
  await animationsDone(page);
  await page.screenshot({ path: join(shotsDir, `${name}-${look}-${w}x${h}.png`), scale: 'css', fullPage });
}

export interface Rect { x: number; y: number; w: number; h: number }
export const rectOf = async (page: Page, selector: string): Promise<Rect> => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
