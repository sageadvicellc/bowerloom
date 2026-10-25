/**
 * Wave C, group 2, in the real window (Electron started with --prototype-v2): the labeled Share button next to Add, the Help button with its word, the note after
 * Remove (eight seconds, pauses on hover and focus, fades) with its Undo, the Save bar's "N changes" as a button that opens a list with one Undo for each change
 * (one change taken back alone; a change another one needs says why it cannot go), "Undo all changes", Ctrl+Z and Shift+Ctrl+Z, and the same bar and list on the Library page.
 * Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { ensurePicked, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;

let home: Home;
const page = (): Page => home.page;
const header = (): Locator => page().locator('header.hm-bar');
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
async function shot(name: string, w: number, h: number, look: string): Promise<void> {
  if (SHOTS === null) return;
  await animationsDone(page());
  await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' });
}

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('the top bar has a Share button with its word next to Add, a clock with a tooltip, and Help as a word, not a bare question mark', async () => {
  const p = page();
  const buttons = await header().getByRole('button').evaluateAll(els => els.map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()));
  expect(buttons).toEqual(['About this preview', 'Version history', 'Share', 'Add', 'Help']);
  await expect(header().getByRole('button', { name: 'Share', exact: true })).toHaveText('Share');
  await expect(header().getByRole('button', { name: 'Help', exact: true })).toHaveText('Help');
  expect(await header().evaluate(el => el.textContent)).not.toContain('?');
  const rects = await header().getByRole('button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { h: r.height, w: r.width }; }));
  for (const r of rects) { expect(r.h).toBeGreaterThanOrEqual(32); expect(r.w).toBeGreaterThanOrEqual(32); }
  // The clock keeps its tooltip.
  const clock = header().getByRole('button', { name: 'Version history', exact: true });
  await clock.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  await expect(p.getByRole('tooltip')).toHaveText('Version history');
  await p.keyboard.press('Escape');
  // Share is also still in the version history.
  await clock.click();
  await expect(p.locator('[data-slot="points"] [data-share-section]').getByRole('button', { name: 'Share my agents' })).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('Share opens the Share sheet directly, and Escape gives the focus back to the Share button', async () => {
  const p = page();
  const share = header().getByRole('button', { name: 'Share', exact: true });
  await share.click();
  const sheet = p.getByRole('dialog', { name: 'Share my agents' });
  await expect(sheet).toBeVisible();
  await expect(p.locator('[data-slot="points"]')).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(share).toBeFocused();
  // By keyboard alone.
  await share.focus(); await p.keyboard.press('Enter');
  await expect(sheet).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(share).toBeFocused();
});

test('Remove shows "Removed <name>. Undo" above the Save bar at the left; Undo puts that one skill back and the bar is calm again', async () => {
  const p = page();
  await pick();
  await removeSkill('Write a reply');
  await expect(note()).toBeVisible();
  await expect(note()).toContainText('Removed Write a reply.');
  await expect(note().getByRole('button', { name: 'Undo' })).toBeVisible();
  const n = await note().boundingBox(), b = await bar().boundingBox();
  expect(n!.y + n!.height).toBeLessThanOrEqual(b!.y + 1);
  expect(n!.x).toBeLessThan(400);
  await expect(barWords()).toHaveText('Removed Write a reply');
  await note().getByRole('button', { name: 'Undo' }).click();
  await expect(shelf('Skills').getByRole('button', { name: 'Write a reply', exact: true })).toBeVisible();
  await expect(barWords()).toHaveText('Nothing to save yet');
  await expect(note()).toBeHidden();
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeFocused();
  expect(await p.locator('.hm-toast').count()).toBe(1);
  expect(await budget()).toEqual([]);
});

test('the note stays eight seconds and fades, waits while the pointer is on it, and waits while the focus is on its button', async () => {
  test.setTimeout(120_000);
  const p = page();
  await pick();
  // A watcher in the page writes down when the note opens and when it starts to fade, so no poll can miss either.
  await p.evaluate(() => {
    const times: Record<string, number> = {};
    (window as unknown as { __undoNote: Record<string, number> }).__undoNote = times;
    new MutationObserver(() => {
      const t = document.querySelector('.hm-toast'); if (t === null) return;
      const now = performance.now();
      if (t.hasAttribute('data-open') && times.open === undefined) times.open = now;
      if (t.hasAttribute('data-leaving') && times.leaving === undefined) times.leaving = now;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await removeSkill('Write a reply');
  await expect(note()).toBeVisible();
  await expect(note()).toBeHidden({ timeout: 11_000 });
  const t = await p.evaluate(() => (window as unknown as { __undoNote: Record<string, number> }).__undoNote);
  expect(t.leaving! - t.open!).toBeGreaterThanOrEqual(7_900);
  expect(t.leaving! - t.open!).toBeLessThan(9_000);
  // Held by the pointer: it is still there well after eight seconds.
  await removeSkill('List action items');
  await expect(note()).toBeVisible();
  await note().hover();
  await p.waitForTimeout(9_500);
  await expect(note()).toBeVisible();
  await p.mouse.move(640, 300);
  await expect(note()).toBeHidden({ timeout: 11_000 });
  // Held by the keyboard focus.
  await removeSkill('Summarize a meeting');
  await expect(note()).toBeVisible();
  await note().getByRole('button', { name: 'Undo' }).focus();
  await p.waitForTimeout(9_500);
  await expect(note()).toBeVisible();
});

test('the note fades out with a quick fade and with less motion it goes at once; a second Remove replaces the first note', async () => {
  const p = page();
  await pick();
  await removeSkill('Write a reply');
  await removeSkill('List action items');
  await expect(note()).toContainText('Removed List action items.');
  await expect(note()).not.toContainText('Write a reply');
  await note().getByRole('button', { name: 'Undo' }).click();
  await expect(shelf('Skills').getByRole('button', { name: 'List action items', exact: true })).toBeVisible();
  await expect(shelf('Skills').getByRole('button', { name: 'Write a reply', exact: true })).toHaveCount(0);
  await expect(barWords()).toHaveText('Removed Write a reply');
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p); await pick();
  await removeSkill('Write a reply');
  await note().getByRole('button', { name: 'Undo' }).click();
  await expect(note()).toBeHidden();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('"4 changes" is a button; it opens a list above the bar with a row and an Undo for each change, and one Undo takes back only its own change', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting');
  await shelf('Tools').getByRole('button', { name: 'Remove Read my calendar' }).click();
  await shelf('Notes').getByRole('button', { name: 'Remove Client list' }).click();
  // One change and two changes are named in a sentence, with no list.
  await expect(barWords()).toHaveText('3 changes');
  await removeSkill('Write a reply');
  await expect(toggle()).toHaveText('4 changes');
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  await expect(changeList()).toHaveCount(0);
  await toggle().click();
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  await expect(changeList()).toBeVisible();
  await expect(changeList().locator('.hm-changes-row')).toHaveCount(4);
  const list = await changeList().boundingBox(), b = await bar().boundingBox();
  expect(list!.y + list!.height).toBeLessThanOrEqual(b!.y + 1);
  for (const text of ['Removed Summarize a meeting', 'Removed Read my calendar', 'Removed Client list', 'Removed Write a reply']) await expect(rowOf(text).getByRole('button', { name: 'Undo' })).toBeEnabled();
  await rowOf('Removed Read my calendar').getByRole('button', { name: 'Undo' }).click();
  await expect(shelf('Tools').getByRole('button', { name: 'Read my calendar', exact: true })).toBeVisible();
  await expect(shelf('Skills').getByRole('button', { name: 'Summarize a meeting', exact: true })).toHaveCount(0);
  await expect(shelf('Skills').getByRole('button', { name: 'Write a reply', exact: true })).toHaveCount(0);
  await expect(shelf('Notes').getByRole('button', { name: 'Client list', exact: true })).toHaveCount(0);
  await expect(toggle()).toHaveText('3 changes');
  await expect(changeList().locator('.hm-changes-row')).toHaveCount(3);
  await expect(toggle()).toBeFocused();
  await rowOf('Removed Client list').getByRole('button', { name: 'Undo' }).click();
  await expect(shelf('Notes').getByRole('button', { name: 'Client list', exact: true })).toBeVisible();
  // Two changes are left: the bar names them in a sentence, the list closes, and the focus goes to Save.
  await expect(changeList()).toHaveCount(0);
  await expect(toggle()).toHaveCount(0);
  await expect(barWords()).toHaveText('Removed Summarize a meeting and Write a reply');
  await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  expect(await budget()).toEqual([]);
});

test('Escape closes the list and keeps the focus on the button; a press elsewhere closes it too; a drawer under it stays open', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting'); await removeSkill('Write a reply'); await removeSkill('List action items');
  await toggle().click();
  await expect(changeList()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(changeList()).toHaveCount(0);
  await expect(toggle()).toBeFocused();
  await toggle().click();
  await expect(changeList()).toBeVisible();
  await p.locator('main.hm-stage h1').click();
  await expect(changeList()).toHaveCount(0);
  // With the Version history drawer open, Escape closes the list first and the drawer next.
  await header().getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(p.locator('[data-slot="points"]')).toBeVisible();
  await toggle().click();
  await expect(changeList()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(changeList()).toHaveCount(0);
  await expect(p.locator('[data-slot="points"]')).toBeVisible();
});

test('the list opens by keyboard, Undo works by keyboard, and the focus never falls to the page', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting'); await removeSkill('Write a reply'); await removeSkill('List action items'); await removeSkill('Tidy my meeting notes');
  await toggle().focus();
  await p.keyboard.press('Enter');
  await expect(changeList()).toBeVisible();
  await p.keyboard.press('Tab');
  await expect(rowOf('Removed Summarize a meeting').getByRole('button', { name: 'Undo' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(shelf('Skills').getByRole('button', { name: 'Summarize a meeting', exact: true })).toBeVisible();
  expect(await p.evaluate(() => document.activeElement === document.body)).toBe(false);
  await expect(toggle()).toBeFocused();
  await expect(toggle()).toHaveText('3 changes');
});

test('"Discard changes" is now "Undo all changes", and it puts everything back at once', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting'); await removeSkill('Write a reply');
  await expect(bar().getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  await expect(barWords()).toHaveText('Nothing to save yet');
  await expect(shelf('Skills').locator('.kit-card')).toHaveCount(4);
  await expect(note()).toBeHidden();
  expect(await budget()).toEqual([]);
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting and Write a reply');
});

test('Ctrl+Z takes back the last change and Shift+Ctrl+Z puts it back, in the order of the changes', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting'); await removeSkill('Write a reply'); await removeSkill('List action items');
  await expect(toggle()).toHaveText('3 changes');
  await p.keyboard.press('Control+z');
  await expect(shelf('Skills').getByRole('button', { name: 'List action items', exact: true })).toBeVisible();
  await expect(barWords()).toHaveText('Removed Summarize a meeting and Write a reply');
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting');
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Nothing to save yet');
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Nothing to save yet');
  await p.keyboard.press('Control+Shift+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting');
  await p.keyboard.press('Control+Shift+z'); await p.keyboard.press('Control+Shift+z');
  await expect(toggle()).toHaveText('3 changes');
  await p.keyboard.press('Meta+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting and Write a reply');
  await p.keyboard.press('Meta+Shift+z');
  await expect(toggle()).toHaveText('3 changes');
});

test('Ctrl+Z does nothing while the focus is in a text field, while a dialog is open, and after a save', async () => {
  const p = page();
  await pick();
  await removeSkill('Summarize a meeting');
  // A text field keeps its own undo.
  await header().getByRole('button', { name: 'Add', exact: true }).click();
  const drawer = p.locator('[data-slot="add"]');
  await expect(drawer).toBeVisible();
  await p.evaluate(() => { const input = document.createElement('input'); input.id = 'wc-probe'; input.setAttribute('aria-label', 'Probe'); document.querySelector('[data-slot="add"]')!.appendChild(input); input.focus(); });
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting');
  await p.evaluate(() => document.getElementById('wc-probe')!.remove());
  await p.keyboard.press('Escape');
  // A dialog holds the page.
  await header().getByRole('button', { name: 'Share', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Share my agents' })).toBeVisible();
  await p.keyboard.press('Control+z');
  await expect(barWords()).toHaveText('Removed Summarize a meeting');
  await p.keyboard.press('Escape');
  // After a save there is nothing to take back.
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText('Saved in this preview. Your files are untouched.', { exact: true })).toBeVisible();
  await p.keyboard.press('Control+z');
  await expect(bar().getByText('Saved in this preview. Your files are untouched.', { exact: true })).toBeVisible();
  await expect(shelf('Skills').getByRole('button', { name: 'Summarize a meeting', exact: true })).toHaveCount(0);
});

test('on the Library page the same bar counts the change, the list has its Undo, and a change another one needs says so in plain words', async () => {
  const p = page();
  await header().getByRole('tab', { name: 'Library' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await p.getByRole('button', { name: 'Compare two options', exact: true }).click();
  await p.getByRole('button', { name: 'Remove from library' }).click();
  await p.locator('[data-dialog="remove"]').getByRole('button', { name: 'Remove from library' }).click();
  await expect(barWords()).toHaveText('Removed Compare two options');
  await p.getByRole('button', { name: 'Add from the web' }).click();
  const sheet = p.locator('[data-slot="web"]');
  await expect(sheet).toBeVisible(); await animationsDone(p);
  await sheet.getByRole('button', { name: 'Open Everyday office kit', exact: true }).click();
  await expect(sheet.locator('[data-banner]')).toBeVisible();
  await sheet.getByRole('button', { name: /^Add \d+ items?$/ }).click();
  await expect(sheet).toBeHidden();
  await expect(barWords()).toHaveText('8 changes');
  await expect(toggle()).toBeVisible();
  await toggle().click();
  const rows = changeList().locator('.hm-changes-row');
  expect(await rows.count()).toBe(2);
  await expect(rowOf('Removed Compare two options').getByRole('button', { name: 'Undo' })).toBeEnabled();
  // The run of additions is one row that goes whole.
  const added = rows.filter({ hasNotText: 'Removed' });
  await expect(added.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await added.getByRole('button', { name: 'Undo' }).click();
  await expect(barWords()).toHaveText('Removed Compare two options');
  expect(await budget()).toEqual([]);
});

test('a change that a later one needs cannot be undone alone: its Undo is off and the row says the later change goes first', async () => {
  const p = page();
  await header().getByRole('tab', { name: 'Library' }).click();
  await p.getByRole('button', { name: 'Add from the web' }).click();
  const sheet = p.locator('[data-slot="web"]');
  await expect(sheet).toBeVisible(); await animationsDone(p);
  await sheet.getByRole('button', { name: 'Open Research habits', exact: true }).click();
  await expect(sheet.locator('[data-banner]')).toBeVisible();
  await sheet.getByRole('button', { name: /^Add \d+ items?$/ }).click();
  await expect(sheet).toBeHidden();
  // Put the newest skill on an agent.
  await p.getByRole('tab', { name: /^Skills \d+$/ }).click();
  const firstRow = p.locator('.lb-list .kit-card-main').first();
  const name = (await firstRow.textContent())!;
  await firstRow.click();
  await p.getByRole('button', { name: 'Add to an agent' }).click();
  await p.locator('.add-pick-main').first().click();
  await expect(toggle()).toBeVisible();
  await toggle().click();
  const disabled = changeList().locator('.hm-changes-row').filter({ hasText: 'Undo the later change first.' });
  await expect(disabled).toHaveCount(1);
  await expect(disabled.getByRole('button', { name: 'Undo' })).toBeDisabled();
  const later = changeList().locator('.hm-changes-row').filter({ hasText: ` to ` });
  await expect(later.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await later.getByRole('button', { name: 'Undo' }).click();
  await expect(changeList().locator('.hm-changes-row').filter({ hasText: 'Undo the later change first.' })).toHaveCount(0);
  expect(name.length).toBeGreaterThan(0);
});

for (const [w, h] of REVIEW) for (const look of LOOKS) {
  test(`the top bar, the note, and the list of changes fit at ${w} by ${h}, ${look}, with no text under 14 px`, async () => {
    const p = page();
    await setLook(p, look); await resize(p, w, h);
    await shot('top-bar', w, h, look);
    await pick();
    await removeSkill('Summarize a meeting');
    await expect(note()).toBeVisible();
    await shot('undo-note', w, h, look);
    await removeSkill('Write a reply'); await removeSkill('List action items');
    await toggle().click();
    await expect(changeList()).toBeVisible();
    await shot('change-list', w, h, look);
    const m = await p.evaluate(() => {
      const r = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      const small = [...document.querySelectorAll('[data-home] *')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '') && parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent?.trim().slice(0, 30));
      return { list: r('[data-changes-list]'), bar: r('.hm-savebar'), header: r('header.hm-bar'), sx: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, headerOverflow: (document.querySelector('header.hm-bar') as HTMLElement).scrollWidth - (document.querySelector('header.hm-bar') as HTMLElement).clientWidth };
    });
    expect(m.small).toEqual([]);
    expect(m.sx).toBeLessThanOrEqual(0);
    expect(m.headerOverflow).toBeLessThanOrEqual(0);
    expect(m.list.l).toBeGreaterThanOrEqual(0); expect(m.list.r).toBeLessThanOrEqual(w); expect(m.list.b).toBeLessThanOrEqual(m.bar.t + 1); expect(m.list.t).toBeGreaterThanOrEqual(m.header.b);
    expect(await budget()).toEqual([]);
  });
}
