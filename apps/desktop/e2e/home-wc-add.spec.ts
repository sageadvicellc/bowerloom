/**
 * Wave C, group 7, in the real window: in the Add drawer's picker an agent that already has the card says "Has it" and cannot be picked; a card that every agent has says
 * "On all agents" and its button is off; and the notes (the one after an add, the one after Remove, the one after the first Save) never lie over a row of the list.
 * Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { overlaps, rectOf, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home, Rect } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;

let home: Home;
const page = (): Page => home.page;
const drawer = (): Locator => page().locator('[data-slot="add"]');
const row = (name: string): Locator => drawer().locator('.add-row').filter({ has: page().locator('.kit-card-main', { hasText: new RegExp(`^${name}$`) }) });
const addTo = (name: string): Locator => row(name).getByRole('button', { name: `Add to ${name}`, exact: true });
const picker = (name: string): Locator => row(name).locator('.add-picker');
const barText = (): Locator => page().getByRole('region', { name: 'Save bar' }).locator('.hm-savebar-state > p');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const shot = async (name: string, w: number, h: number, look: string): Promise<void> => { if (SHOTS === null) return; await animationsDone(page()); await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await page().locator('nav.hm-nav').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer()).toBeVisible();
  await animationsDone(page());
});

test('the picker marks an agent that already has the card "Has it", and it cannot be picked', async () => {
  const p = page();
  await addTo('Compare two options').click();
  await expect(picker('Compare two options')).toBeVisible();
  const has = picker('Compare two options').locator('.add-pick[data-has]');
  await expect(has).toHaveCount(3);
  await expect(has.getByText('Has it', { exact: true })).toHaveCount(3);
  const names = await has.locator('.add-pick-main').allInnerTexts();
  expect(names.sort()).toEqual(['Interview notetaker', 'Research assistant', 'Trip organizer']);
  for (const b of await has.locator('.add-pick-main').all()) await expect(b).toBeDisabled();
  // The keyboard goes to the first agent that can be picked, and a press on one that has it adds nothing and says why.
  await expect(picker('Compare two options').locator('.add-pick:not([data-has]) .add-pick-main').first()).toBeFocused();
  await has.first().locator('.add-pick-main').click({ force: true });
  await expect(barText()).toHaveText('Nothing to save yet');
  await expect(drawer().locator('.add-note')).toHaveText(/ already has it\.$/);
  await addTo('Compare two options').click();
  await expect(picker('Compare two options').locator('.add-pick:not([data-has]) .add-pick-main').first()).toBeEnabled();
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('add-has-it', w, h, look); }
});

test('a card that every agent has says "On all agents", and its Add to button is off', async () => {
  const p = page();
  await expect(addTo('Compare two options')).toBeEnabled();
  const before = await row('Compare two options').locator('.kit-status').count();
  expect(before).toBe(0);
  // Three agents have it. Put it on the other seven, one after another, by the picker.
  for (let i = 0; i < 12; i += 1) {
    if (await addTo('Compare two options').isDisabled()) break;
    await addTo('Compare two options').click();
    const free = picker('Compare two options').locator('.add-pick:not([data-has]) .add-pick-main');
    if ((await free.count()) === 0) break;
    await free.first().click();
    await expect(picker('Compare two options')).toHaveCount(0);
  }
  await expect(row('Compare two options').locator('.kit-status')).toHaveText('On all agents');
  await expect(addTo('Compare two options')).toBeDisabled();
  await expect(row('Compare two options').locator('.kit-status')).toHaveAttribute('data-tone', 'info');
  expect(await budget()).toEqual([]);
  // A card that some agent lacks does not say it.
  await expect(row('Answer a common question').locator('.kit-status')).toHaveCount(0);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await row('Compare two options').scrollIntoViewIfNeeded(); await shot('add-on-all', w, h, look); }
});

test('the note after an add sits in the foot under the list and never lies over a row', async () => {
  const p = page();
  await addTo('Compare two options').click();
  await picker('Compare two options').locator('.add-pick:not([data-has]) .add-pick-main').first().click();
  const foot = drawer().locator('.add-foot[data-open]');
  await expect(foot).toBeVisible();
  const note = await rectOf(p, '.add-foot[data-open]');
  const scroll = await rectOf(p, '[data-slot="add"] .add-scroll');
  expect(note.y).toBeGreaterThanOrEqual(scroll.y + scroll.h - 1);
  for (const r of await drawer().locator('.add-row').all()) {
    const box = (await r.boundingBox())!;
    const visible: Rect = { x: box.x, y: Math.max(box.y, scroll.y), w: box.width, h: Math.min(box.y + box.height, scroll.y + scroll.h) - Math.max(box.y, scroll.y) };
    if (visible.h > 0) expect(overlaps(note, visible)).toBe(false);
  }
});

test('the note after Remove and the note after the first Save never lie over a row of the drawer either', async () => {
  const p = page();
  await p.keyboard.press('Escape');
  // A guided session: its first Save says so in a note.
  await fresh(p, undefined, { tour: true });
  await resize(p, 1280, 800);
  await p.keyboard.press('Escape');
  await p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }).click();
  await p.locator('aside.hm-panel').getByRole('button', { name: 'Remove Write a reply' }).click();
  await p.locator('nav.hm-nav').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer()).toBeVisible(); await animationsDone(p);
  const toast = p.locator('.hm-toast[data-note]');
  await expect(toast).toBeVisible();
  const check = async (): Promise<void> => {
    const note = await rectOf(p, '.hm-toast[data-note]');
    const scroll = await rectOf(p, '[data-slot="add"] .add-scroll');
    for (const r of await drawer().locator('.add-row').all()) {
      const box = (await r.boundingBox())!;
      expect(overlaps(note, { x: box.x, y: box.y, w: box.width, h: box.height }), 'a row of the drawer').toBe(false);
    }
    expect(note.x + note.w).toBeLessThanOrEqual(scroll.x + 2);
  };
  await check();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast).toHaveText('Saved in this preview. Your files are untouched.');
  await check();
  await shot('add-notes', 1280, 800, 'light');
});
