/**
 * Wave E, group B, in the real window (Electron started with --home-sample): the note after Remove ("Removed <name>. Undo") and the Save bar must describe the
 * draft as it is now. After Ctrl+Z, after the note's own Undo, after an Undo in the list of changes, and after Go back, a note about a change that no longer
 * exists goes away; a note about a change that is still there stays. The note keeps its eight seconds. The Library page's note goes the same way.
 * Set HOME_WE_SHOTS to a folder to also save the screenshot "undo note after Ctrl+Z".
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const barWords = (): Locator => bar().locator('.hm-savebar-state > p');
const changeList = (): Locator => page().locator('[data-changes-list]');
const toggle = (): Locator => bar().locator('.hm-changes-toggle');
const note = (): Locator => page().locator('.hm-toast[data-note]');
const panel = (): Locator => page().locator('aside.hm-panel');
const shelf = (name: string): Locator => panel().getByRole('region', { name });
const agentButton = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const rowOf = (text: string): Locator => changeList().locator('.hm-changes-row').filter({ hasText: text });
async function pick(name = 'Meeting assistant'): Promise<void> { await ensurePicked(agentButton(name)); await expect(panel().getByRole('heading', { level: 2, name })).toBeVisible(); }
async function removeSkill(name: string): Promise<void> { await shelf('Skills').getByRole('button', { name: `Remove ${name}` }).click(); }

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('Ctrl+Z takes the note away with its change: the note and the Save bar say the same thing, and a note about a change that is still there stays', async () => {
  const p = page();
  await pick();
  await removeSkill('Write a reply');
  await expect(note()).toContainText('Removed Write a reply.');
  await expect(barWords()).toHaveText('Removed Write a reply');
  await p.keyboard.press('Control+z');
  await expect(shelf('Skills').getByRole('button', { name: 'Write a reply', exact: true })).toBeVisible();
  await expect(note()).toBeHidden();
  await expect(barWords()).toHaveText('Nothing to save yet');
  await atEverySize(p, 'undo-note-after-ctrl-z');
  // Two removals: Ctrl+Z takes back the second and its note; the first removal's text is not brought back, and the bar names only what is still removed.
  await removeSkill('Summarize a meeting');
  await removeSkill('List action items');
  await expect(note()).toContainText('Removed List action items.');
  await p.keyboard.press('Control+z');
  await expect(note()).toBeHidden();
  await expect(barWords()).toHaveText('Removed Summarize a meeting');
  // Putting it back with Shift+Ctrl+Z does not bring an old note back.
  await p.keyboard.press('Control+Shift+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting and List action items');
  await expect(note()).toBeHidden();
  expect(await budget()).toEqual([]);
});

test('the note\'s own Undo puts the skill back and the bar and the shelf agree with it', async () => {
  const p = page();
  await pick();
  await removeSkill('Write a reply');
  await removeSkill('List action items');
  await expect(barWords()).toHaveText('Removed Write a reply and List action items');
  await note().getByRole('button', { name: 'Undo' }).click();
  await expect(note()).toBeHidden();
  await expect(shelf('Skills').getByRole('button', { name: 'List action items', exact: true })).toBeVisible();
  await expect(barWords()).toHaveText('Removed Write a reply');
  // A second Undo is not offered: nothing in the page names the first removal as a note.
  await expect(p.locator('.hm-toast button')).toHaveCount(0);
});

test('an Undo in the list of changes leaves no note about that change, and the bar and the shelves agree', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting'); await removeSkill('Write a reply'); await removeSkill('List action items');
  await shelf('Tools').getByRole('button', { name: 'Remove Read my calendar' }).click();
  await expect(note()).toContainText('Removed Read my calendar.');
  await toggle().click();
  await expect(changeList()).toBeVisible();
  await expect(note()).toBeHidden();
  await rowOf('Removed Read my calendar').getByRole('button', { name: 'Undo' }).click();
  await expect(shelf('Tools').getByRole('button', { name: 'Read my calendar', exact: true })).toBeVisible();
  await expect(barWords()).toHaveText('3 changes');
  await expect(note()).toBeHidden();
  await p.keyboard.press('Escape');
  await expect(note()).toBeHidden();
  // Ctrl+Z takes back the Undo of the list (the removal is back), and no old note comes with it.
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('4 changes');
  await expect(shelf('Tools').getByRole('button', { name: 'Read my calendar', exact: true })).toHaveCount(0);
  await expect(note()).toBeHidden();
});

test('Undo all changes and Go back leave no note about a change that is gone', async () => {
  const p = page();
  await pick();
  await removeSkill('Write a reply');
  await expect(note()).toBeVisible();
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  await expect(note()).toBeHidden();
  await removeSkill('Write a reply');
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(note()).toBeHidden();
  await p.keyboard.press('Control+z');
  await expect(note()).toBeHidden();
});

test('on the Library page the note after Remove goes with Ctrl+Z, and the count line says what is there now', async () => {
  const p = page();
  await page().locator('nav.hm-nav').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await p.getByRole('button', { name: 'Compare two options', exact: true }).click();
  await p.getByRole('button', { name: 'Remove from library' }).click();
  await p.locator('[data-dialog="remove"]').getByRole('button', { name: 'Remove from library' }).click();
  await expect(p.locator('[data-count]')).toHaveText('Removed Compare two options.');
  await expect(p.locator('[data-dialog="remove"]')).toHaveCount(0);
  await expect(barWords()).toHaveText('Removed Compare two options');
  await p.keyboard.press('Control+z');
  await expect(p.locator('[data-count]')).toHaveText('53 skills');
  await expect(barWords()).toHaveText('Nothing to save yet');
  await expect(p.getByRole('button', { name: 'Compare two options', exact: true })).toBeVisible();
});
