/**
 * Screenshots of Wave E. Set HOME_WE_SHOTS to a folder (outside the repo) and each spec of this wave saves what it checks, at 1280 by 800 and 900 by 600, in
 * light and dark. Without it nothing is saved.
 */
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { animationsDone } from './proto-wait.js';
import { resize, setLook } from './home-page.js';

export const WE_SHOTS = process.env.HOME_WE_SHOTS ?? null;
if (WE_SHOTS !== null) mkdirSync(WE_SHOTS, { recursive: true });
export const REVIEW_SIZES = [[1280, 800], [900, 600]] as const;
export const LOOKS = ['light', 'dark'] as const;

/** Saves one screenshot of the page as it is, named `<name>-<look>-<w>x<h>.png`. */
export async function weShot(page: Page, name: string, w: number, h: number, look: string): Promise<void> {
  if (WE_SHOTS === null) return;
  await animationsDone(page);
  await page.screenshot({ path: join(WE_SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' });
}

/** Runs `show` at both review sizes in both looks, saving a screenshot after each, and puts the page back at 1280 by 800 in the light look. */
export async function atEverySize(page: Page, name: string, show?: () => Promise<void>): Promise<void> {
  if (WE_SHOTS === null) return;
  for (const [w, h] of REVIEW_SIZES) for (const look of LOOKS) {
    await resize(page, w, h);
    await setLook(page, look);
    if (show !== undefined) await show();
    await weShot(page, name, w, h, look);
  }
  await resize(page, 1280, 800);
  await setLook(page, 'light');
}
