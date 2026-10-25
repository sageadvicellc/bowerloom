/**
 * Wave E, group E, in the real window (Electron started with --prototype-v2): the tour says "Step 3 of 7" and has a clear "Skip tour" on every step; its sentences
 * have at most ten words; the card of step three sits beside the lit details panel and covers neither the panel nor the agent that is picked, whichever agent
 * that is and at every size; the tour never picks an agent in silence (the sentence says so); and "These are the apps your agents work in." belongs to the
 * results of Find and is not on the screen that asks "Read what is inside?".
 * Set HOME_WE_SHOTS to a folder to also save tour step 3 at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { fresh, launchHome, overlaps, rectOf, resize, setLook } from './home-page.js';
import type { Home } from './home-page.js';
import { WE_SHOTS, weShot } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const dialog = (): Locator => page().getByRole('dialog', { name: 'Tour' });
const next = (): Locator => dialog().getByRole('button', { name: /^(Next|Done)$/ });
const agentButtons = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main');
const heading = (): Locator => page().locator('aside.hm-panel h2').first();
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const CLICKED = 'Skills show what the agent you picked can do.', GIVEN = 'We picked an agent. Skills show what it can do.';

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), undefined, { tour: true });
  await resize(page(), 1280, 800);
});

test('every step says where you are in words ("Step 3 of 7") and has a clear "Skip tour", and every sentence has at most ten words', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  for (let i = 1; i <= 7; i += 1) {
    await expect(dialog().getByText(`Step ${i} of 7`, { exact: true })).toBeVisible();
    const skip = dialog().getByRole('button', { name: 'Skip tour' });
    await expect(skip).toBeVisible();
    const box = (await skip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(32);
    for (const piece of await dialog().locator('.tour-text, .tour-hint').allTextContents()) expect(countWords(piece), piece).toBeLessThanOrEqual(10);
    expect(await budget()).toEqual([]);
    if (i < 7) await next().click();
  }
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
});

for (const [w, h] of [[1280, 800], [900, 600], [1440, 900], [1100, 700]] as const) {
  test(`step three at ${w} by ${h}: the card sits beside the lit panel and covers neither the panel nor the agent that is picked, whichever agent that is`, async () => {
    const p = page();
    await resize(p, w, h);
    const count = await agentButtons().count();
    for (const index of [0, 3, count - 1]) {
      await fresh(p, undefined, { tour: true });
      await resize(p, w, h);
      await expect(dialog()).toBeVisible();
      await next().click();
      await expect(dialog().getByText('Step 2 of 7')).toBeVisible();
      const tile = agentButtons().nth(index);
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await expect(dialog().getByText(CLICKED, { exact: true })).toBeVisible();
      await animationsDone(p);
      const pop = await rectOf(p, '.tour-pop'), hole = await rectOf(p, '.tour-spot'), panel = await rectOf(p, '[data-tour~="details"]');
      const picked = await rectOf(p, '.hm-grid .kit-card[data-selected]');
      // The ring is on the details panel, and the card is beside it.
      expect(Math.abs(hole.x - Math.max(panel.x, hole.x))).toBeLessThanOrEqual(8);
      expect(hole.x + hole.w, 'the ring holds the whole panel').toBeGreaterThanOrEqual(panel.x + panel.w - 2);
      expect(overlaps(pop, panel), `${index}: the panel`).toBe(false);
      expect(overlaps(pop, hole), `${index}: the ring`).toBe(false);
      expect(overlaps(pop, picked), `${index}: the agent that is picked`).toBe(false);
      const gap = Math.max(0, hole.x - (pop.x + pop.w), pop.x - (hole.x + hole.w));
      expect(gap, `${index}: beside the ring, ${JSON.stringify({ pop, hole })}`).toBeLessThanOrEqual(40);
      expect(pop.x).toBeGreaterThanOrEqual(0); expect(pop.x + pop.w).toBeLessThanOrEqual(w); expect(pop.y).toBeGreaterThanOrEqual(0); expect(pop.y + pop.h).toBeLessThanOrEqual(h);
    }
  });
}

test('the tour never picks an agent in silence: Next on the click step makes step three say so; a click leaves it saying "the agent you picked"', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  await next().click();
  await expect(heading()).toHaveText('Pick an agent');
  await next().click();
  await expect(dialog().getByText(GIVEN, { exact: true })).toBeVisible();
  await expect(heading()).not.toHaveText('Pick an agent');
  // Back to the click step and a real click: the sentence is the plain one.
  await dialog().getByRole('button', { name: 'Back' }).click();
  await expect(dialog().getByText('Click an agent to see what it can do.', { exact: true })).toBeVisible();
  // (The agent the tour picked is still picked, and a click on it would put it down, so the click goes to one that is not.)
  await page().locator('.hm-grid .kit-card[data-kind="agent"]:not([data-selected]) .kit-card-main').first().click();
  await expect(dialog().getByText(CLICKED, { exact: true })).toBeVisible();
  await expect(dialog().getByText(GIVEN, { exact: true })).toHaveCount(0);
  void p;
});

test('a tour that ends does not pick an agent for a person who picked none', async () => {
  const p = page();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  // Put the pick down, replay, and leave at once.
  await p.getByRole('button', { name: 'Help', exact: true }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(dialog()).toBeVisible();
  await expect(heading()).toHaveText('Pick an agent');
  await p.getByRole('button', { name: 'Skip tour' }).click();
  await expect(dialog()).toHaveCount(0);
  await animationsDone(p);
  await expect(heading()).toHaveText('Pick an agent');
  await expect(p.locator('.hm-grid .kit-card[data-selected]')).toHaveCount(0);
});

test('"These are the apps your agents work in." shows on the results of Find and on no other screen of Find', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true });
  const note = p.locator('[data-apps-note]');
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Looking for your agents' })).toBeVisible();
  await expect(note).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ agents$/ })).toBeVisible({ timeout: 15_000 });
  await expect(note).toHaveText('These are the apps your agents work in.');
  await p.getByRole('button', { name: 'Looks right' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  await expect(note).toHaveCount(0);
  await expect(p.getByText('These are the apps your agents work in.')).toHaveCount(0);
  await p.getByRole('button', { name: 'Back' }).click();
  await expect(note).toHaveText('These are the apps your agents work in.');
  expect(await budget()).toEqual([]);
});

if (WE_SHOTS !== null) {
  for (const [w, h] of [[1280, 800], [900, 600]] as const) for (const look of ['light', 'dark'] as const) {
    test(`screenshots: tour step 3 at ${w} by ${h}, ${look}`, async () => {
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await next().click();
      await agentButtons().nth(1).click();
      await expect(dialog().getByText(CLICKED, { exact: true })).toBeVisible();
      await weShot(p, 'tour-step-3', w, h, look);
    });
  }
}
