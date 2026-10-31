/**
 * Where the keyboard focus goes when one layer hands over to the next, in the real window (Electron started with --prototype-v2, on the home app itself).
 * Every case opens a layer, closes it, and asserts that `document.activeElement` is the control that opened it (or, when that control is gone, a stable
 * control: the card that owns it, the button that opens the layer, or the main heading). The focus is read twice, right after the close and again once the
 * exits have ended and the layer is out of the page, so a focus that is right for a moment and lost a moment later still fails. The cases run with motion
 * (the layers fade out for a moment, which is where a handover can lose the focus) and with less motion (the layers go in the same pass).
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const topBar = (name: string): Locator => page().locator('nav.hm-nav').getByRole('button', { name, exact: true });
const addDrawer = (): Locator => page().locator('[data-slot="add"]');
const pointsDrawer = (): Locator => page().locator('[data-slot="points"]');
const notesLayer = (): Locator => page().locator('[data-slot="notes"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const sheet = (): Locator => page().getByRole('dialog', { name: 'Share my agents' });
const copiesDialog = (): Locator => page().getByRole('dialog', { name: 'Two different copies' });
const tourDialog = (): Locator => page().getByRole('dialog', { name: 'Tour' });
const shareButton = (): Locator => pointsDrawer().getByRole('button', { name: 'Share my agents' });
const chooseButton = (): Locator => panel().locator('[data-notes-shelf]').getByRole('button', { name: 'Choose notes' });
const panelBadge = (): Locator => panel().getByRole('button', { name: '2 different copies' });
const agentButton = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });
const mainHeading = (): Locator => page().locator('.hm-topbar h1');

/** True when the focus is on a real control or heading and not on the page itself (where the next Tab would start from the top). */
const focusIsOnPage = async (): Promise<boolean> => page().evaluate(() => document.activeElement !== null && document.activeElement !== document.body && document.activeElement !== document.documentElement);

/** The focus is on `target` now and still is when every exit has ended. */
async function focusIs(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await animationsDone(page());
  await expect(target).toBeFocused();
  expect(await focusIsOnPage()).toBe(true);
}

async function openAdd(): Promise<void> {
  await topBar('Add').click();
  await expect(addDrawer()).toBeVisible();
  await animationsDone(page());
}
async function openPoints(): Promise<void> {
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  await animationsDone(page());
}
async function gone(layer: Locator): Promise<void> { await expect(layer).toHaveCount(0); await animationsDone(page()); }

for (const motion of ['no-preference', 'reduce'] as const) {
  test.describe(`focus handovers, motion ${motion}`, () => {
    test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
    test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
    test.beforeEach(async () => {
      await page().emulateMedia({ reducedMotion: motion, colorScheme: 'light' });
      await fresh(page());
      await resize(page(), 1440, 900);
      await skipTour(page());
    });

    test('Add drawer to Version history drawer: the new drawer takes the focus, and closing it returns the focus to the clock button', async () => {
      const p = page();
      await openAdd();
      await topBar('Version history').click();
      await expect(pointsDrawer()).toBeVisible();
      await expect(pointsDrawer().getByRole('heading', { name: 'Version history' })).toBeFocused();
      await gone(addDrawer());
      await expect(pointsDrawer().getByRole('heading', { name: 'Version history' })).toBeFocused();
      await p.keyboard.press('Escape');
      await gone(pointsDrawer());
      await focusIs(topBar('Version history'));
    });

    test('Version history drawer to Add drawer: the new drawer takes the focus, and closing it returns the focus to the Add button', async () => {
      const p = page();
      await openPoints();
      await topBar('Add').click();
      await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
      await gone(pointsDrawer());
      await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
      await p.keyboard.press('Escape');
      await gone(addDrawer());
      await focusIs(topBar('Add'));
    });

    test('a drawer closed by its own button, and by Escape, returns the focus to the button that opened it', async () => {
      const p = page();
      await openAdd();
      await addDrawer().getByRole('button', { name: 'Close', exact: true }).click();
      await gone(addDrawer());
      await focusIs(topBar('Add'));
      await openPoints();
      await p.keyboard.press('Escape');
      await gone(pointsDrawer());
      await focusIs(topBar('Version history'));
    });

    test('drawer to dialog: the Share sheet opens over Version history and every way of closing it returns the focus to Share my agents', async () => {
      const p = page();
      await openPoints();
      for (const close of ['Escape', 'Close', 'Cancel'] as const) {
        await shareButton().click();
        await expect(sheet()).toBeVisible();
        await expect(sheet().getByRole('heading', { level: 2 })).toBeFocused();
        if (close === 'Escape') await p.keyboard.press('Escape'); else await sheet().getByRole('button', { name: close, exact: true }).click();
        await gone(sheet());
        await focusIs(shareButton());
        await expect(pointsDrawer()).toBeVisible();
      }
      // After a copy was made, "Done" closes it the same way.
      await shareButton().click();
      await sheet().getByRole('button', { name: 'Create share file' }).click();
      await sheet().getByRole('button', { name: 'Done', exact: true }).click();
      await gone(sheet());
      await focusIs(shareButton());
    });

    test('Share sheet to the Add drawer ("Open a shared file"): the Add drawer takes the focus, and closing it leaves the focus on a control of the page', async () => {
      const p = page();
      await openPoints();
      await shareButton().click();
      await sheet().getByRole('button', { name: 'Create share file' }).click();
      await sheet().getByRole('button', { name: 'Open a shared file' }).click();
      await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
      await gone(sheet());
      await gone(pointsDrawer());
      await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
      await p.keyboard.press('Escape');
      await gone(addDrawer());
      await focusIs(topBar('Add'));
    });

    test('Version history drawer to Add drawer by "Open a shared file": closing the Add drawer leaves the focus on the Add button', async () => {
      const p = page();
      await openPoints();
      await pointsDrawer().getByRole('button', { name: 'Open a shared file' }).click();
      await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
      await gone(pointsDrawer());
      await p.keyboard.press('Escape');
      await gone(addDrawer());
      await focusIs(topBar('Add'));
    });

    test('dialog closing: the copies dialog opened from the panel returns the focus to its badge, by Escape and by Close', async () => {
      const p = page();
      await ensurePicked(agentButton('Inbox sorter'));
      for (const close of ['Escape', 'Close'] as const) {
        await panelBadge().click();
        await expect(copiesDialog()).toBeVisible();
        await expect(copiesDialog().getByRole('heading', { level: 2, name: 'Two different copies' })).toBeFocused();
        if (close === 'Escape') await p.keyboard.press('Escape'); else await copiesDialog().getByRole('button', { name: 'Close', exact: true }).click();
        await gone(copiesDialog());
        await focusIs(panelBadge());
      }
    });

    test('dialog closing: keeping a copy takes the badge away, and the focus goes to the card that owns it', async () => {
      const p = page();
      await ensurePicked(agentButton('Inbox sorter'));
      await panelBadge().click();
      await expect(copiesDialog()).toBeVisible();
      await copiesDialog().getByRole('button', { name: /Keep this copy/ }).first().click();
      await gone(copiesDialog());
      await expect(panelBadge()).toHaveCount(0);
      expect(await focusIsOnPage()).toBe(true);
      expect(await p.evaluate(() => document.activeElement?.closest('aside.hm-panel') !== null)).toBe(true);
      await animationsDone(p);
      expect(await p.evaluate(() => document.activeElement?.closest('aside.hm-panel') !== null)).toBe(true);
    });

    test('drawer to dialog: the copies dialog opened from the Add drawer returns the focus to its badge in the drawer', async () => {
      const p = page();
      await ensurePicked(agentButton('Inbox sorter'));
      await openAdd();
      await addDrawer().getByRole('button', { name: 'Show more' }).click();
      const badge = addDrawer().locator('.add-row[data-add-id="skill-014"]').getByRole('button', { name: '2 different copies' });
      await badge.click();
      await expect(copiesDialog()).toBeVisible();
      await p.keyboard.press('Escape');
      await gone(copiesDialog());
      await focusIs(badge);
      await expect(addDrawer()).toBeVisible();
    });

    test('Choose notes closing: Escape, Cancel and Close return the focus to the Choose notes button', async () => {
      const p = page();
      await ensurePicked(agentButton('Report builder'));
      for (const close of ['Escape', 'Cancel', 'Close'] as const) {
        await chooseButton().click();
        await expect(notesLayer()).toBeVisible();
        await expect(notesLayer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
        if (close === 'Escape') await p.keyboard.press('Escape'); else await notesLayer().getByRole('button', { name: close, exact: true }).click();
        await gone(notesLayer());
        await focusIs(chooseButton());
      }
    });

    test('Choose notes closing after "Use these notes": the focus returns to the Choose notes button', async () => {
      await ensurePicked(agentButton('Report builder'));
      await chooseButton().click();
      await notesLayer().getByRole('button', { name: 'Travel', exact: true }).click();
      await notesLayer().getByRole('button', { name: 'Use these notes', exact: true }).click();
      await gone(notesLayer());
      await focusIs(chooseButton());
    });

    test('drawer to Choose notes: the sheet takes the focus from an open drawer, and closing it returns the focus to the Choose notes button', async () => {
      const p = page();
      await ensurePicked(agentButton('Report builder'));
      await openAdd();
      await chooseButton().click();
      await expect(notesLayer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
      await gone(addDrawer());
      await expect(notesLayer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
      await p.keyboard.press('Escape');
      await gone(notesLayer());
      await focusIs(chooseButton());
    });

    test('tour ending: Escape and Done return the focus to the Help button it was started from', async () => {
      const p = page();
      await topBar('Help').click();
      await p.getByRole('button', { name: 'Show me around' }).click();
      await expect(tourDialog()).toBeVisible();
      await p.keyboard.press('Escape');
      await gone(tourDialog());
      await focusIs(topBar('Help'));
      await topBar('Help').click();
      await p.getByRole('button', { name: 'Show me around' }).click();
      await expect(tourDialog()).toBeVisible();
      await tourDialog().getByRole('button', { name: 'Skip tour' }).click();
      await gone(tourDialog());
      await focusIs(topBar('Help'));
    });

    test('tour ending after it closed a drawer: the focus goes to the Help button, not to the top of the page', async () => {
      const p = page();
      await openAdd();
      await p.evaluate(() => { document.querySelector<HTMLElement>('nav.hm-nav button[data-tour="help"]')?.click(); });
      await p.evaluate(() => { [...document.querySelectorAll<HTMLElement>('button')].find(b => b.textContent?.trim() === 'Show me around')?.click(); });
      await expect(tourDialog()).toBeVisible();
      await gone(addDrawer());
      await p.keyboard.press('Escape');
      await gone(tourDialog());
      await focusIs(topBar('Help'));
    });

    test('tour ending when nothing opened it (it started by itself): the focus goes to the main heading', async () => {
      const p = page();
      await fresh(p, '#prototype-v2/map', { tour: true });
      await expect(tourDialog()).toBeVisible();
      await p.keyboard.press('Escape');
      await gone(tourDialog());
      await focusIs(mainHeading());
    });
  });
}
