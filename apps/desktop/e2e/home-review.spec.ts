/**
 * The fixes from the three reviews of the agents-first prototype, in the real window (Electron started with --prototype-v2, on the home app itself):
 * Escape reaches only the top layer even when the focus left it, the Save bar forgets "Saved" when a new change starts, a shared file's missing references,
 * an empty file and a refused file in plain words, a drag that is cancelled or ended with the mouse, Find more with changes that wait, and the "Preview" badge.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { SIZES, THEMES, SAVED, ensurePicked, fresh, launchHome, overlaps, rectOf, resize, setLook, shot } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const topBar = (name: string): Locator => page().locator('header.hm-bar').getByRole('button', { name, exact: true });
const addDrawer = (): Locator => page().locator('[data-slot="add"]');
const pointsDrawer = (): Locator => page().locator('[data-slot="points"]');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const barText = async (): Promise<string> => (await bar().locator('.hm-savebar-state p').innerText()).trim();
const panel = (): Locator => page().locator('aside.hm-panel');
const row = (id: string): Locator => addDrawer().locator(`.add-row[data-add-id="${id}"]`);
const agentCard = (id: string): Locator => page().locator(`.hm-grid [data-drop-agent="${id}"]`);
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const focusIsOnPage = async (): Promise<boolean> => page().evaluate(() => document.activeElement === document.body);

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1440, 900);
});

async function pick(name: string): Promise<void> {
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name, exact: true }));
  await expect(panel().getByRole('heading', { level: 2, name })).toBeVisible();
}
async function openAdd(tabName = 'Skills'): Promise<void> {
  if (!(await addDrawer().isVisible())) await topBar('Add').click();
  await expect(addDrawer()).toBeVisible();
  await animationsDone(page());
  await addDrawer().getByRole('tab', { name: tabName, exact: true }).click();
}
async function removeFirstSkill(): Promise<void> { await panel().locator('.kit-card[data-kind="skill"] .kit-remove').first().click(); }

// ---- Item 2: Escape reaches only the top layer, wherever the focus is.
test('Escape closes the copies dialog and not the Add drawer under it, even after a click on plain text in the dialog (review item 2)', async () => {
  const p = page();
  await pick('Inbox sorter');
  await openAdd();
  await addDrawer().getByRole('button', { name: 'Show more' }).click();
  await row('skill-014').getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await dialog.locator('.add-dialog-name').click();
  expect(await focusIsOnPage()).toBe(true);
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await animationsDone(p);
  await expect(addDrawer()).toBeVisible();
  await expect(topBar('Add')).toHaveAttribute('aria-expanded', 'true');
});

test('Escape closes the Share sheet and not the Version history drawer under it, even after a click on plain text in the sheet (review item 2)', async () => {
  const p = page();
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  await animationsDone(p);
  await pointsDrawer().getByRole('button', { name: 'Share my agents' }).click();
  const sheet = p.getByRole('dialog', { name: 'Share my agents' });
  await expect(sheet).toBeVisible();
  await sheet.locator('.sh-counts').click();
  expect(await focusIsOnPage()).toBe(true);
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await animationsDone(p);
  await expect(pointsDrawer()).toBeVisible();
  await expect(topBar('Version history')).toHaveAttribute('aria-expanded', 'true');
});

test('Escape closes an open help popover and not the drawer under it (review item 2)', async () => {
  const p = page();
  await openAdd();
  await topBar('Help').click();
  await expect(p.getByRole('group', { name: 'Help' })).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('group', { name: 'Help' })).toHaveCount(0);
  await animationsDone(p);
  await expect(addDrawer()).toBeVisible();
  await expect(topBar('Add')).toHaveAttribute('aria-expanded', 'true');
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
});

// ---- Item 5: the Save bar forgets what it said when a new change starts.
test('after Save, a new change and Discard, the bar says nothing waits and not "Saved" again (review item 5)', async () => {
  const p = page();
  await pick('Meeting assistant');
  await removeFirstSkill();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  expect(await barText()).toBe(SAVED);
  await removeFirstSkill();
  await expect(bar().getByRole('button', { name: 'Undo all changes' })).toBeVisible();
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  expect(await barText()).toBe('Nothing to save yet');
  await expect(bar().getByRole('button', { name: 'Go back' })).toHaveCount(0);
  await expect(p.locator('.hm-ticks')).toHaveCount(0);
});

test('after Go back, a new change and Discard, the bar does not say "Back to how it was" again (review item 5)', async () => {
  await pick('Meeting assistant');
  await removeFirstSkill();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await bar().getByRole('button', { name: 'Go back' }).click();
  expect(await barText()).toBe('Back to how it was');
  await removeFirstSkill();
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  expect(await barText()).toBe('Nothing to save yet');
});

test('Find more does not make the bar forget that it just saved (review items 5 and 12)', async () => {
  const p = page();
  await pick('Meeting assistant');
  await removeFirstSkill();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  expect(await barText()).toBe(SAVED);
  await p.getByRole('button', { name: 'Find more' }).click();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible();
  expect(await barText()).toBe(SAVED);
  await expect(bar().getByRole('button', { name: 'Go back' })).toBeVisible();
});

// ---- Item 12: Find more with agents that have changes.
test('a place whose agents have changes that wait stays ticked, and the screen says why (review item 12)', async () => {
  const p = page();
  await pick('Meeting assistant');
  await removeFirstSkill();
  await p.getByRole('button', { name: 'Find more' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  const note = p.locator('.fr-unsaved');
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText(/^\d+ agents? here (has|have) changes you have not saved\.$/);
  const box = note.locator('xpath=ancestor::li[1]').getByRole('checkbox');
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();
  expect(await budget()).toEqual([]);
  for (const [w, h] of SIZES) for (const look of THEMES) {
    await resize(p, w, h); await setLook(p, look); await shot(p, 'find-unsaved', w, h, look);
  }
  await resize(p, 1440, 900); await setLook(p, 'light');
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(bar().getByText(/Removed/)).toBeVisible();
});

// ---- Items 6 and 7: a shared file.
const EMPTY_FILE = JSON.stringify({ scopeIds: [], items: [], toolRefs: [], sliceRules: [] });
const skillItem = (n: number): object => ({ id: `rf-${n}`, kind: 'skill', name: `Review skill ${n}`, scopeId: 'global', description: 'd', library: null, foundAt: [] });
const agentItem = (): object => ({ id: 'rf-agent', kind: 'agent', name: 'Review agent', scopeId: 'global', library: null, foundAt: [], extras: [],
  definition: { name: 'Review agent', role: 'reviewer', instructions: 'Do the review.', skillIds: ['rf-gone-1', 'rf-gone-2'], toolAttachments: [{ toolId: 'rf-gone-tool', access: 'read-only' }] } });
async function openFileTab(): Promise<void> { await openAdd('From a shared file'); }
async function chooseText(name: string, text: string): Promise<void> {
  await addDrawer().locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('a file with nothing in it says so, and offers no Add button (review item 7)', async () => {
  await openFileTab();
  await chooseText('empty.json', EMPTY_FILE);
  const preview = addDrawer().locator('.add-preview[data-step="preview"]');
  await expect(preview).toContainText('There is nothing in this file.');
  await expect(preview).not.toContainText('Everything in this file is already here.');
  await expect(preview.getByRole('button', { name: 'Add these' })).toHaveCount(0);
  expect(await budget()).toEqual([]);
  for (const [w, h] of SIZES) for (const look of THEMES) {
    await resize(page(), w, h); await setLook(page(), look); await shot(page(), 'file-empty', w, h, look);
  }
});

test('a file whose agent points to things that are not here says how many (review item 6)', async () => {
  await openFileTab();
  await chooseText('points.json', JSON.stringify({ scopeIds: ['global'], items: [agentItem()], toolRefs: [], sliceRules: [] }));
  const preview = addDrawer().locator('.add-preview[data-step="preview"]');
  await expect(preview.getByText('3 things this file points to are not here.')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Add these' })).toBeVisible();
  expect(await budget()).toEqual([]);
  for (const [w, h] of SIZES) for (const look of THEMES) {
    await resize(page(), w, h); await setLook(page(), look); await shot(page(), 'file-points', w, h, look);
  }
});

test('a file past the limit, nested too deeply, or with a repeated id is refused in plain words (review items 7 and 8)', async () => {
  await openFileTab();
  const failed = addDrawer().locator('.add-preview[data-step="failed"]');
  await chooseText('many.json', JSON.stringify({ scopeIds: [], items: Array.from({ length: 201 }, (_, i) => skillItem(i)), toolRefs: [], sliceRules: [] }));
  await expect(failed.getByRole('alert')).toHaveText('This file has too many things to read.');
  await failed.getByRole('button', { name: 'Choose another file' }).click();
  let deep: unknown = 1;
  for (let i = 0; i < 12; i += 1) deep = { a: deep };
  await chooseText('deep.json', JSON.stringify({ scopeIds: [], items: [], toolRefs: [], sliceRules: [], deep }));
  await expect(failed.getByRole('alert')).toHaveText('This file is nested too deeply.');
  await failed.getByRole('button', { name: 'Choose another file' }).click();
  await chooseText('same.json', JSON.stringify({ scopeIds: [], items: [skillItem(1), skillItem(1)], toolRefs: [], sliceRules: [] }));
  await expect(failed.getByRole('alert')).toHaveText('Two parts of this file share one id.');
  expect(await budget()).toEqual([]);
});

test('several files let go at once: the first is read, and the screen says so (review item 7)', async () => {
  await openFileTab();
  await page().evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['{"scopeIds":[],"items":[],"toolRefs":[],"sliceRules":[]}'], 'one.json', { type: 'application/json' }));
    data.items.add(new File(['{}'], 'two.json', { type: 'application/json' }));
    const target = document.querySelector('.add-drop')!;
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  const preview = addDrawer().locator('.add-preview[data-step="preview"]');
  await expect(preview).toContainText('Only the first file was read.');
  await expect(preview).toContainText('There is nothing in this file.');
});

// ---- Items 6 and 9: the Share sheet.
test('the Share sheet says what is true about keys and text (review item 9); the one ready-made skill of the sample travels as a name only, and the sheet says so (review item 6)', async () => {
  const p = page();
  await topBar('Version history').click();
  await pointsDrawer().getByRole('button', { name: 'Share my agents' }).click();
  const sheet = p.getByRole('dialog', { name: 'Share my agents' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Keys that Bowerloom keeps are left out.')).toBeVisible();
  await expect(sheet.getByText('Your own text is included, so read it first.')).toBeVisible();
  await expect(sheet.locator('.sh-left')).toHaveText('Left out: 3 keys and 1 ready-made item');
  await expect(sheet.getByText('Ready-made items travel as a name only.')).toBeVisible();
  expect(await budget()).toEqual([]);
  for (const [w, h] of SIZES) for (const look of THEMES) {
    await resize(p, w, h); await setLook(p, look); await shot(p, 'share-wording', w, h, look);
  }
});

// ---- Item 11: drags.
async function centre(l: Locator): Promise<{ x: number; y: number }> {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('Escape while a card is dragged cancels the drag, and letting go over the card does not press it (review item 11)', async () => {
  const p = page();
  await openAdd();
  const card = row('skill-017').locator('.kit-card');
  const from = await centre(card), to = await centre(agentCard('agent-04'));
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 10 });
  await expect(agentCard('agent-04')).toHaveAttribute('data-drop-over', '');
  await p.keyboard.press('Escape');
  await expect(agentCard('agent-04')).not.toHaveAttribute('data-drop-over', '');
  await p.mouse.move(from.x, from.y, { steps: 10 });
  await p.mouse.up();
  await expect(addDrawer()).toBeVisible();
  await expect(row('skill-017').getByRole('button', { name: /^Add to / })).toHaveAttribute('aria-expanded', 'false');
  await expect(p.locator('.add-picker')).toHaveCount(0);
});

test('Escape during a press that has not moved far enough to be a drag leaves the drawer open (review item 11)', async () => {
  const p = page();
  await openAdd();
  const from = await centre(row('skill-017').locator('.kit-card'));
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 2, from.y + 1);
  await p.keyboard.press('Escape');
  await animationsDone(p);
  await expect(addDrawer()).toBeVisible();
  await expect(topBar('Add')).toHaveAttribute('aria-expanded', 'true');
  await p.mouse.up();
  await animationsDone(p);
  await expect(addDrawer()).toBeVisible();
});

test('after a drop with the mouse, Enter on a card from the keyboard still presses it (review item 11)', async () => {
  const p = page();
  await openAdd();
  const from = await centre(row('skill-017').locator('.kit-card')), to = await centre(agentCard('agent-04'));
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 10 });
  await p.mouse.up();
  await expect(bar().getByText(/Added/)).toBeVisible();
  const other = addDrawer().locator('.add-row:not([data-add-id="skill-017"])').first();
  await other.locator('.kit-card-main').focus();
  await p.keyboard.press('Enter');
  await expect(other.getByRole('button', { name: /^Add to / })).toHaveAttribute('aria-expanded', 'true');
});

// ---- Item 16: the honest label.
test('a "Preview" badge with its own help sits in the top bar and says nothing is written (review item 16)', async () => {
  const p = page();
  const badge = p.locator('header.hm-bar [data-preview] .kit-status');
  await expect(badge).toHaveText('Preview');
  await expect(badge).toBeVisible();
  const about = p.locator('header.hm-bar').getByRole('button', { name: 'About this preview', exact: true });
  await about.click();
  await expect(p.getByRole('group', { name: 'About this preview' })).toContainText('This is a preview. Nothing is written to your computer.');
  expect(await budget()).toEqual([]);
  for (const [w, h] of SIZES) for (const look of THEMES) {
    await resize(p, w, h); await setLook(p, look);
    await expect(badge).toBeVisible();
    const pop = await rectOf(p, 'header.hm-bar [data-preview] .kit-popover');
    expect(pop.x).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.w).toBeLessThanOrEqual(w);
    await shot(p, 'preview-badge', w, h, look);
  }
  await p.keyboard.press('Escape');
  await resize(p, 900, 600);
  const b = await rectOf(p, 'header.hm-bar [data-preview]');
  for (const name of ['Version history', 'Add', 'Help']) expect(overlaps(b, await rectOf(p, `header.hm-bar button[aria-label="${name}"], header.hm-bar button:has-text("${name}")`)), name).toBe(false);
  const header = await rectOf(p, 'header.hm-bar');
  expect(b.x + b.w).toBeLessThanOrEqual(header.w);
  expect(header.h).toBeLessThan(90);
});
