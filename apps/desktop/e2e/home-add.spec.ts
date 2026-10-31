/**
 * The Add drawer and the "two different copies" dialog, in the real window (Electron started with --prototype-v2, on the Add test page #prototype-v2/add).
 * Adding by the picker and by a real mouse drag, the shared-file preview and commit, the copies dialog (pick, badge gone, focus trap, Escape), the keyboard-only
 * path, reduce motion, text size, nothing cropped at the two review sizes, and the text budget on the real page.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { sharedFileSample } from '../renderer/home/add/add-sample-file.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { animationsDone, framesPainted } from './page-wait.js';
import { SIZES, THEMES, fresh, launchHome, resize, setLook, shot } from './home-page.js';
import type { Home } from './home-page.js';

const ADD_PAGE = '#prototype-v2/add';
let home: Home;
let folder: string;
const page = (): Page => home.page;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = await launchHome();
  folder = tempDir('bowerloom-prototype-e2e-files-');
});
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), ADD_PAGE);
  await resize(page(), 1440, 900);
});

// ---- Small helpers.
const drawer = (): Locator => page().locator('[data-slot="add"]');
const barAdd = (): Locator => page().locator('header.add-bar').getByRole('button', { name: 'Add', exact: true });
const count = (): Locator => page().locator('.add-count');
const agentCard = (id: string): Locator => page().locator(`[data-drop-agent="${id}"] .kit-card`);
const row = (id: string): Locator => drawer().locator(`.add-row[data-add-id="${id}"]`);
const tab = (name: string): Locator => drawer().getByRole('tab', { name, exact: true });
async function openDrawer(tabName = 'Skills'): Promise<void> {
  await barAdd().click();
  await expect(drawer()).toBeVisible();
  await animationsDone(page());
  await tab(tabName).click();
  await expect(tab(tabName)).toHaveAttribute('aria-selected', 'true');
}
async function centre(l: Locator): Promise<{ x: number; y: number }> {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function addBy(picker: { skill: string; agent: string; agentName: string }): Promise<void> {
  await row(picker.skill).getByRole('button', { name: /^Add to / }).click();
  await page().getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: picker.agentName }).click();
}
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
async function writeFile(name: string, text: string): Promise<string> { const path = join(folder, name); writeFileSync(path, text); return path; }
async function chooseFile(path: string): Promise<void> { await drawer().locator('input[type="file"]').setInputFiles(path); }

// ---- The page.
test('the test page opens with four agents that take a drop, no changes, the Add button, and the skill with the copies badge', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Add test page' })).toBeVisible();
  await expect(p.locator('[data-drop-agent]')).toHaveCount(4);
  for (const id of ['agent-meeting', 'agent-inbox', 'agent-research', 'agent-writing']) await expect(p.locator(`[data-drop-agent="${id}"]`)).toHaveCount(1);
  await expect(count()).toHaveText('No changes yet');
  await expect(p.getByRole('button', { name: 'Go back' })).toBeDisabled();
  await expect(p.getByRole('button', { name: '2 different copies' })).toHaveCount(1);
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  expect(await p.getByText('Gilded').count()).toBe(0);
});

test('the Add drawer opens on Skills with five tabs, plain names, hints, and an "Add to" button on every card', async () => {
  const p = page();
  await openDrawer();
  await expect(drawer().getByRole('tab')).toHaveText(['Skills', 'Tools', 'Notes', 'Agents', 'From a shared file']);
  await expect(drawer().locator('.add-row')).toHaveCount(8);
  await expect(drawer().locator('.add-row .kit-card')).toHaveCount(8);
  await expect(drawer().getByRole('button', { name: 'Add to Summarize a meeting' })).toBeVisible();
  const hint = await row('skill-summarize').locator('.kit-card-hint').textContent();
  expect(hint!.split(/\s+/).length).toBeLessThanOrEqual(12);
  await tab('Tools').click();
  await expect(drawer().locator('.add-row')).toHaveCount(4);
  await expect(drawer().getByText('needs a key')).toBeVisible();
  await expect(drawer().getByText('Format check')).toHaveCount(0);
  await tab('Notes').click();
  await expect(drawer().locator('.add-row')).toHaveCount(3);
  await tab('Agents').click();
  await expect(drawer().locator('.add-row .kit-card[data-kind="agent"]')).toHaveCount(3);
  await expect(drawer().getByRole('button', { name: 'Add agent' })).toHaveCount(3);
  expect(await p.locator('.add-body').evaluate(e => e.textContent)).not.toMatch(/\.bowerloom|\/sample|SKILL\.md/);
});

// ---- Adding.
test('add by the picker: "Add to", choose an agent, one change is staged, the agent card shows it, a wire joins them, and the focus comes back', async () => {
  const p = page();
  await openDrawer();
  const before = await agentCard('agent-inbox').locator('.kit-card-hint').textContent();
  await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
  const picker = p.getByRole('group', { name: 'Add to which agent?' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('button')).toHaveCount(4);
  await expect(picker.getByRole('button').first()).toBeFocused();
  await picker.getByRole('button', { name: 'Inbox sorter' }).click();
  await expect(picker).toHaveCount(0);
  await expect(count()).toHaveText('1 change');
  await expect(p.getByRole('button', { name: 'Go back' })).toBeEnabled();
  await expect(drawer().locator('.add-note')).toHaveText('Added to Inbox sorter.');
  expect(await agentCard('agent-inbox').locator('.kit-card-hint').textContent()).not.toBe(before);
  await expect(agentCard('agent-inbox').locator('.kit-card-hint')).toContainText('1 skill');
  await expect(p.locator('.add-link')).toHaveCount(1);
  await expect(row('skill-reply').getByRole('button', { name: /^Add to / })).toBeFocused();
  await expect(p.locator('.add-link')).toHaveCount(0);
});

test('a card that an agent already has says so in the picker, and choosing it adds nothing', async () => {
  const p = page();
  await openDrawer();
  await addBy({ skill: 'skill-reply', agent: 'agent-inbox', agentName: 'Inbox sorter' });
  await expect(count()).toHaveText('1 change');
  await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
  const mine = p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Inbox sorter' });
  await expect(mine).toHaveAttribute('aria-disabled', 'true');
  await expect(p.getByRole('group', { name: 'Add to which agent?' }).getByText('Has it')).toHaveCount(1);
  await mine.click({ force: true });
  await expect(drawer().locator('.add-note')).toHaveText('Inbox sorter already has it.');
  await expect(count()).toHaveText('1 change');
});

test('a tool and a set of notes are added the same way, and a ready-made agent joins the agents of the person', async () => {
  const p = page();
  await openDrawer('Tools');
  await row('tool-search').getByRole('button', { name: /^Add to / }).click();
  await p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Research assistant' }).click();
  await expect(agentCard('agent-research').locator('.kit-card-hint')).toContainText('1 tool');
  await tab('Notes').click();
  await drawer().locator('.add-row').first().getByRole('button', { name: /^Add to / }).click();
  await p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Writing coach' }).click();
  await expect(drawer().locator('.add-note')).toHaveText('Added to Writing coach.');
  await tab('Agents').click();
  await drawer().getByRole('button', { name: 'Add agent' }).first().click();
  await expect(p.locator('[data-drop-agent]')).toHaveCount(5);
  await expect(drawer().locator('.add-note')).toHaveText(/^Added .+ to your agents\.$/);
  await expect(count()).toHaveText('3 changes');
});

test('add by a real mouse drag: the agent card lights up under the pointer, a label follows, and dropping stages one change', async () => {
  const p = page();
  await openDrawer();
  const from = await centre(row('skill-spelling').locator('.kit-card'));
  const to = await centre(agentCard('agent-inbox'));
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x - 30, from.y + 10, { steps: 4 });
  await expect(p.locator('[data-follow]')).toHaveText('Check my spelling');
  await expect(p.locator('[data-drop-agent][data-drop-ready]')).toHaveCount(4);
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await expect(p.locator('[data-drop-agent="agent-inbox"]')).toHaveAttribute('data-drop-over', '');
  // The label travels with the pointer: it sits a few pixels below and right of it.
  const label = (await p.locator('[data-follow]').boundingBox())!;
  expect(Math.abs(label.x - (to.x + 14))).toBeLessThan(4);
  expect(Math.abs(label.y - (to.y + 14))).toBeLessThan(4);
  await expect(p.locator('[data-drop-agent][data-drop-over]')).toHaveCount(1);
  await p.mouse.up();
  await expect(p.locator('[data-follow]')).toHaveCount(0);
  await expect(p.locator('[data-drop-ready]')).toHaveCount(0);
  await expect(count()).toHaveText('1 change');
  await expect(agentCard('agent-inbox').locator('.kit-card-hint')).toContainText('1 skill');
  await expect(drawer().locator('.add-note')).toHaveText('Added to Inbox sorter.');
  await expect(p.getByRole('group', { name: 'Add to which agent?' })).toHaveCount(0);
});

test('a drag that lets go in the wrong place adds nothing and says where to drop; Escape cancels a drag', async () => {
  const p = page();
  await openDrawer();
  const from = await centre(row('skill-spelling').locator('.kit-card'));
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x - 60, from.y + 200, { steps: 8 });
  await p.mouse.up();
  await expect(count()).toHaveText('No changes yet');
  await expect(drawer().locator('.add-note')).toHaveText('Drop it on an agent card.');
  const to = await centre(agentCard('agent-inbox'));
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 8 });
  await expect(p.locator('[data-follow]')).toHaveCount(1);
  await p.keyboard.press('Escape');
  await expect(p.locator('[data-follow]')).toHaveCount(0);
  await p.mouse.up();
  await expect(count()).toHaveText('No changes yet');
  // The drawer closes with a slide, so wait for any slide to end before asserting that it stayed.
  await animationsDone(p);
  await expect(drawer()).toHaveCount(1);
  await expect(drawer()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(drawer()).toHaveCount(0);
});

test('a plain click on a card opens the picker, and "Go back" takes the added skill away again', async () => {
  const p = page();
  await openDrawer();
  await row('skill-email').locator('.kit-card-main').click();
  await expect(p.getByRole('group', { name: 'Add to which agent?' })).toBeVisible();
  await p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Inbox sorter' }).click();
  await expect(count()).toHaveText('1 change');
  await p.getByRole('button', { name: 'Go back' }).click();
  await expect(count()).toHaveText('No changes yet');
  await expect(agentCard('agent-inbox').locator('.kit-card-hint')).not.toContainText('skill');
});

test('with reduce motion on, no wire is drawn and the plain "Added" note says it instead', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p, ADD_PAGE);
  await openDrawer();
  await addBy({ skill: 'skill-reply', agent: 'agent-inbox', agentName: 'Inbox sorter' });
  await expect(drawer().locator('.add-note')).toHaveText('Added to Inbox sorter.');
  await framesPainted(p);
  expect(await p.locator('.add-link').count()).toBe(0);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('the wire is the only new motion: it draws in 240 ms with the strong ease-out and leaves by itself', async () => {
  const p = page();
  await openDrawer();
  await addBy({ skill: 'skill-reply', agent: 'agent-inbox', agentName: 'Inbox sorter' });
  const wire = p.locator('.add-link-path');
  await expect(wire).toHaveCount(1);
  const timing = await wire.evaluate(e => { const s = getComputedStyle(e); return { name: s.animationName, duration: s.animationDuration, ease: s.animationTimingFunction }; });
  expect(timing.name).toBe('add-link-draw');
  expect(timing.duration).toBe('0.24s');
  expect(timing.ease).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
  console.log('MEASURED wire timing:', JSON.stringify(timing));
  await expect(p.locator('.add-link')).toHaveCount(0);
});

// ---- The keyboard.
test('keyboard only: open Add, move between tabs with the arrows, choose a card and an agent, and Escape steps back one layer at a time', async () => {
  const p = page();
  await barAdd().focus();
  await p.keyboard.press('Enter');
  await expect(drawer()).toBeVisible();
  await expect(drawer().getByRole('heading', { level: 2, name: 'Add' })).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(drawer().getByRole('button', { name: 'Close' })).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(tab('Skills')).toBeFocused();
  await p.keyboard.press('ArrowRight');
  await expect(tab('Tools')).toBeFocused();
  await expect(tab('Tools')).toHaveAttribute('aria-selected', 'true');
  await p.keyboard.press('End');
  await expect(tab('From a shared file')).toBeFocused();
  await p.keyboard.press('Home');
  await expect(tab('Skills')).toBeFocused();
  await p.keyboard.press('ArrowLeft');
  await expect(tab('From a shared file')).toBeFocused();
  await p.keyboard.press('ArrowRight');
  await expect(tab('Skills')).toBeFocused();
  // Down into the list: the first card, then its "Add to" button.
  await p.keyboard.press('Tab');
  await expect(drawer().locator('.add-row').first().locator('.kit-card-main')).toBeFocused();
  await p.keyboard.press('Tab');
  const first = drawer().locator('.add-row').first().getByRole('button', { name: /^Add to / });
  await expect(first).toBeFocused();
  await p.keyboard.press('Enter');
  const picker = p.getByRole('group', { name: 'Add to which agent?' });
  await expect(picker.getByRole('button').first()).toBeFocused();
  await p.keyboard.press('ArrowDown');
  await expect(picker.getByRole('button').nth(1)).toBeFocused();
  await p.keyboard.press('ArrowUp');
  await expect(picker.getByRole('button').first()).toBeFocused();
  // Escape closes the picker only and puts the focus back on its button; the drawer stays.
  await p.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(first).toBeFocused();
  await expect(drawer()).toBeVisible();
  await p.keyboard.press('Enter');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await expect(count()).toHaveText('1 change');
  await expect(first).toBeFocused();
  await expect(drawer().locator('.add-note')).toHaveText(/^Added to .+\.$/);
  await p.keyboard.press('Escape');
  await expect(drawer()).toHaveCount(0);
  await expect(barAdd()).toBeFocused();
});

// ---- From a shared file.
test('a shared file: choose it, read what it will add in plain words with no path, add it, and see the cards', async () => {
  const p = page();
  await openDrawer('From a shared file');
  await expect(drawer().getByRole('group', { name: 'Shared file drop area' })).toBeVisible();
  await expect(drawer().getByRole('button', { name: 'Choose a file' })).toBeVisible();
  await chooseFile(await writeFile('colleague.json', sharedFileSample()));
  const preview = drawer().locator('.add-preview[data-step="preview"]');
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('heading', { level: 3, name: 'Will be added' })).toBeVisible();
  await expect(preview.getByRole('heading', { level: 3, name: 'Two different copies' })).toBeVisible();
  await expect(preview.getByRole('heading', { level: 3, name: 'Already here' })).toBeVisible();
  await expect(preview).toContainText('Prepare for a call');
  await expect(preview).toContainText('Call preparer');
  await expect(preview).toContainText('Sort my inbox');
  await expect(preview).toContainText('Write a reply');
  await expect(preview).toContainText('1 tool needs a key.');
  const text = (await preview.textContent())!;
  expect(text).not.toMatch(/\/|\.json|\.md|bowerloom/i);
  await expect(count()).toHaveText('No changes yet');
  expect(await budget()).toEqual([]);
  await preview.getByRole('button', { name: 'Add these' }).click();
  const done = drawer().locator('.add-preview[data-step="done"]');
  await expect(done.locator('.add-lead')).toHaveText(/^Added \d+ things from the file\.$/);
  await expect(count()).not.toHaveText('No changes yet');
  await tab('Skills').click();
  await expect(drawer().getByRole('button', { name: 'Add to Prepare for a call' })).toBeVisible();
  await expect(drawer().getByRole('button', { name: 'Add to Sort my inbox (from file)' })).toBeVisible();
  await tab('From a shared file').click();
  await chooseFile(await writeFile('colleague-again.json', sharedFileSample()));
  await expect(drawer().locator('.add-preview[data-step="preview"]')).toContainText('Everything in this file is already here.');
  await expect(drawer().getByRole('button', { name: 'Add these' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Go back' }).click();
  await expect(count()).toHaveText('No changes yet');
});

test('a file dropped on the drop area opens like a chosen one, a file Bowerloom cannot read is refused in plain words, and nothing is added', async () => {
  const p = page();
  await openDrawer('From a shared file');
  const dt = await p.evaluateHandle(text => { const t = new DataTransfer(); t.items.add(new File([text], 'shared.json', { type: 'application/json' })); return t; }, sharedFileSample());
  await p.locator('.add-drop').dispatchEvent('dragover', { dataTransfer: dt });
  await expect(p.locator('.add-drop')).toHaveAttribute('data-over', '');
  await expect(p.locator('.add-drop')).toContainText('Let go to open this file.');
  await p.locator('.add-drop').dispatchEvent('drop', { dataTransfer: dt });
  await expect(drawer().locator('.add-preview[data-step="preview"]')).toBeVisible();
  await drawer().getByRole('button', { name: 'Choose another file' }).click();
  await chooseFile(await writeFile('notes.json', 'this is not a shared file'));
  const failed = drawer().locator('.add-preview[data-step="failed"]');
  await expect(failed.getByRole('alert')).toHaveText('Bowerloom cannot read this file.');
  await expect(failed).toContainText('Nothing was added.');
  await expect(count()).toHaveText('No changes yet');
  expect(await budget()).toEqual([]);
  await failed.getByRole('button', { name: 'Choose another file' }).click();
  await drawer().getByRole('button', { name: 'Try a sample file' }).click();
  await expect(drawer().locator('.add-preview[data-step="preview"]')).toBeVisible();
});

// ---- Two different copies.
test('the badge opens the copies side by side with the changed lines marked, and picking one removes the badge and stages one change', async () => {
  const p = page();
  await p.getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2, name: 'Two different copies' })).toBeFocused();
  await expect(dialog).toContainText('Weekly review');
  await expect(dialog.locator('.add-copy')).toHaveCount(2);
  const a = dialog.locator('.add-copy').nth(0), b = dialog.locator('.add-copy').nth(1);
  await animationsDone(p);   // the dialog rises 4 px as it comes in: measure it once it has landed
  const boxes = [await a.boundingBox(), await b.boundingBox()];
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1);
  await expect(a).toContainText('Found in Claude Code and OpenCode');
  await expect(b).toContainText('Found in Codex');
  await expect(a.locator('.add-line-row[data-changed]')).toHaveCount(2);
  await expect(b.locator('.add-line-row[data-changed]')).toHaveCount(3);
  await expect(a).toContainText('2 lines changed');
  await expect(a.locator('.add-line-row[data-changed]').first().locator('.hm-sr')).toHaveText('Changed: ');
  // A changed line is marked by more than colour: a mark, and a heavier weight.
  const weights = await dialog.evaluate(d => ({ changed: getComputedStyle(d.querySelector('.add-line-row[data-changed]')!).fontWeight, plain: getComputedStyle(d.querySelector('.add-line-row:not([data-changed])')!).fontWeight, mark: d.querySelector('.add-line-row[data-changed] .add-mark')!.textContent }));
  expect(Number(weights.changed)).toBeGreaterThan(Number(weights.plain));
  expect(weights.mark).toBe('≠');
  expect(await budget()).toEqual([]);
  await expect(b.getByRole('button', { name: 'Keep this copy Copy 2' })).toBeVisible();
  await b.getByRole('button', { name: 'Keep this copy' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(p.getByRole('button', { name: '2 different copies' })).toHaveCount(0);
  await expect(count()).toHaveText('1 change');
  await expect(p.locator('.add-kept')).toHaveText('Kept Copy 2 of Weekly review.');
  await expect(p.locator('.kit-shelf .kit-card-main', { hasText: 'Weekly review' })).toBeFocused();
  await p.getByRole('button', { name: 'Go back' }).click();
  await expect(p.getByRole('button', { name: '2 different copies' })).toHaveCount(1);
  await expect(count()).toHaveText('No changes yet');
});

test('Escape closes the copies dialog without a change and returns the focus to the badge; the focus stays inside; the page behind is out of reach', async () => {
  const p = page();
  const badge = p.getByRole('button', { name: '2 different copies' });
  await badge.focus();
  await p.keyboard.press('Enter');
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  expect(await p.locator('main#main').evaluate(e => e.closest('[inert]') !== null)).toBe(true);
  await expect(p.locator('header.add-bar')).toHaveAttribute('inert', '');
  for (let i = 0; i < 9; i += 1) {
    await p.keyboard.press('Tab');
    expect(await dialog.evaluate(d => d.contains(document.activeElement)), `Tab ${i + 1}`).toBe(true);
  }
  for (let i = 0; i < 9; i += 1) {
    await p.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(d => d.contains(document.activeElement)), `Shift+Tab ${i + 1}`).toBe(true);
  }
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(badge).toBeFocused();
  await expect(count()).toHaveText('No changes yet');
  expect(await p.locator('main#main').evaluate(e => e.closest('[inert]') === null)).toBe(true);
  // The close button and the scrim close it too.
  await badge.click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(badge).toBeFocused();
  await badge.click();
  await p.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);
});

test('the badge in the Add drawer opens the same dialog, and the Escape inside it closes the dialog and not the drawer', async () => {
  const p = page();
  await openDrawer();
  await row('skill-weekly').getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(drawer()).toBeVisible();
  await row('skill-weekly').getByRole('button', { name: '2 different copies' }).click();
  await dialog.locator('.add-copy').nth(0).getByRole('button', { name: 'Keep this copy' }).click();
  await expect(row('skill-weekly').getByRole('button', { name: '2 different copies' })).toHaveCount(0);
  await expect(row('skill-weekly').locator('.kit-badge')).toHaveCount(0);
});

// ---- Text, size and fit.
test('the real page stays inside the text budget in every state: each tab, an open picker, a note, and the dialog', async () => {
  const p = page();
  expect(await budget()).toEqual([]);
  await openDrawer();
  expect(await budget()).toEqual([]);
  await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
  expect(await budget()).toEqual([]);
  await p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Writing coach' }).click();
  expect(await budget()).toEqual([]);
  for (const name of ['Tools', 'Notes', 'Agents', 'From a shared file']) { await tab(name).click(); expect(await budget(), name).toEqual([]); }
  await p.getByRole('button', { name: '2 different copies' }).click();
  expect(await budget()).toEqual([]);
});

test('no text is under 14 px, and the drawer and the dialog use the kit sizes', async () => {
  const p = page();
  await openDrawer();
  await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
  await addBy({ skill: 'skill-email', agent: 'agent-inbox', agentName: 'Inbox sorter' });
  await row('skill-weekly').getByRole('button', { name: '2 different copies' }).click();
  const sizes = await p.evaluate(() => {
    const out: { text: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim(); const el = n.parentElement;
      if (text === '' || el === null || el.closest('svg, .hm-sr')) continue;
      out.push({ text, size: parseFloat(getComputedStyle(el).fontSize) });
    }
    return out;
  });
  expect(sizes.length).toBeGreaterThan(40);
  expect(sizes.filter(s => s.size < 14), JSON.stringify(sizes.filter(s => s.size < 14))).toEqual([]);
  const measure = await p.evaluate(() => {
    const px = (sel: string): number => parseFloat(getComputedStyle(document.querySelector(sel)!).fontSize);
    return { tab: px('.add-tab'), line: px('.add-line-row'), note: px('.add-note'), card: px('.add-row .kit-card-main'), button: px('.add-row-main .kit-button') };
  });
  console.log('MEASURED font sizes (px):', JSON.stringify(measure));
  // Wave D: the type scale is about 90 percent of the first, so a tab is 14 px (the floor for every word), not 16.
  expect(measure.tab).toBeGreaterThanOrEqual(14);
  expect(measure.line).toBeGreaterThanOrEqual(14);
});

test('every control is at least 32 px tall: tabs, the Add to buttons, the picker rows, and Keep this copy (Wave D: 44 px became 32 px)', async () => {
  const p = page();
  await openDrawer();
  await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
  const small = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.add-tab, .add-row-main .kit-button, .add-pick')].map(e => ({ cls: e.className, h: e.getBoundingClientRect().height })).filter(e => e.h < 31.5));
  expect(small, JSON.stringify(small)).toEqual([]);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: '2 different copies' }).first().click();
  const dialogSmall = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.add-dialog .kit-button')].map(e => e.getBoundingClientRect()).filter(r => r.height < 31.5 || r.width < 31.5));
  expect(dialogSmall).toEqual([]);
});

for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} nothing is cropped: the drawer, the dialog and every row stay inside the window, with no sideways scroll`, async () => {
    const p = page();
    await resize(p, w, h);
    await openDrawer();
    const drawerFit = await p.evaluate(() => {
      const d = document.querySelector('[data-slot="add"]')!.getBoundingClientRect(), body = document.querySelector('.kit-drawer-body')!;
      const rows = [...document.querySelectorAll('.add-row-main')].map(r => r.getBoundingClientRect());
      // Wave D: a name and a hint are one line each. They may be cut sideways, but only with an ellipsis; they never run over the row or grow it.
      const cards = [...document.querySelectorAll('.add-row .kit-card-main, .add-row .kit-card-hint')].map(e => ({ v: e.scrollHeight - e.clientHeight, h: getComputedStyle(e).textOverflow === 'ellipsis' ? 0 : e.scrollWidth - e.clientWidth }));
      return { right: d.right, vw: window.innerWidth, sideways: body.scrollWidth - body.clientWidth, rowsInside: rows.every(r => r.left >= d.left && r.right <= d.right + 0.5), clipped: cards.filter(c => c.v > 1 || c.h > 1).length, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(drawerFit.right).toBeLessThanOrEqual(drawerFit.vw + 0.5);
    expect(drawerFit.sideways).toBeLessThanOrEqual(0); expect(drawerFit.doc).toBeLessThanOrEqual(0);
    expect(drawerFit.rowsInside).toBe(true); expect(drawerFit.clipped).toBe(0);
    await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
    const pickerFit = await p.evaluate(() => { const d = document.querySelector('[data-slot="add"]')!.getBoundingClientRect(), pk = document.querySelector('.add-picker')!.getBoundingClientRect(); return pk.left >= d.left && pk.right <= d.right + 0.5; });
    expect(pickerFit).toBe(true);
    await p.keyboard.press('Escape');
    for (const name of ['Tools', 'Notes', 'Agents', 'From a shared file']) {
      await tab(name).click();
      const sideways = await p.evaluate(() => { const b = document.querySelector('.kit-drawer-body')!; return b.scrollWidth - b.clientWidth; });
      expect(sideways, name).toBeLessThanOrEqual(0);
    }
    await p.getByRole('button', { name: '2 different copies' }).first().click();
    const dialogFit = await p.evaluate(() => {
      const d = document.querySelector('.add-dialog')!.getBoundingClientRect(), copies = [...document.querySelectorAll('.add-copy')].map(c => c.getBoundingClientRect()), keep = [...document.querySelectorAll('.add-copy .kit-button')].map(b => b.getBoundingClientRect());
      return { inside: d.left >= 0 && d.top >= 0 && d.right <= window.innerWidth + 0.5 && d.bottom <= window.innerHeight + 0.5, copiesInside: copies.every(c => c.left >= d.left && c.right <= d.right + 0.5), keepVisible: keep.every(k => k.bottom <= window.innerHeight && k.top >= 0), doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, count: copies.length };
    });
    console.log(`MEASURED dialog at ${w}x${h}:`, JSON.stringify(dialogFit));
    expect(dialogFit).toMatchObject({ inside: true, copiesInside: true, keepVisible: true, count: 2 });
    expect(dialogFit.doc).toBeLessThanOrEqual(0);
  });
}

// ---- Screenshots (only when HOME_U0_SHOTS names a folder).
if (process.env.HOME_U0_SHOTS !== undefined) {
  for (const [w, h] of SIZES) for (const look of THEMES) {
    test(`screenshots at ${w} by ${h}, ${look}: each tab, mid-drag, after an add, the copies dialog, the shared-file preview`, async () => {
      test.setTimeout(180_000);
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await shot(p, 'add-page', w, h, look);
      await openDrawer('Skills');
      await shot(p, 'add-skills', w, h, look);
      await tab('Tools').click(); await shot(p, 'add-tools', w, h, look);
      await tab('Notes').click(); await shot(p, 'add-notes', w, h, look);
      await tab('Agents').click(); await shot(p, 'add-agents', w, h, look);
      await tab('From a shared file').click(); await shot(p, 'add-file', w, h, look);
      await chooseFile(await writeFile('colleague.json', sharedFileSample()));
      await expect(drawer().locator('.add-preview[data-step="preview"]')).toBeVisible();
      await shot(p, 'add-file-preview', w, h, look);
      await drawer().getByRole('button', { name: 'Choose another file' }).click();
      await tab('Skills').click();
      // Mid-drag.
      const from = await centre(row('skill-spelling').locator('.kit-card'));
      const to = await centre(agentCard('agent-inbox'));
      await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x - 20, from.y + 10, { steps: 3 }); await p.mouse.move(to.x, to.y, { steps: 10 });
      await shot(p, 'add-drag', w, h, look);
      // The picker, open.
      await p.keyboard.press('Escape'); await p.mouse.up();
      await row('skill-reply').getByRole('button', { name: /^Add to / }).click();
      await shot(p, 'add-picker', w, h, look);
      await p.getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: 'Inbox sorter' }).click();
      await expect(p.locator('.add-link')).toHaveCount(1);
      await shot(p, 'add-after-wire', w, h, look);
      await expect(p.locator('.add-link')).toHaveCount(0);
      await shot(p, 'add-after', w, h, look);
      await p.getByRole('button', { name: '2 different copies' }).first().click();
      await shot(p, 'copies-dialog', w, h, look);
    });
  }
}
