/**
 * "Choose notes" in the real window (Electron started with --prototype-v2, on the test page #prototype-v2/notes): the layer opens from the Notes shelf,
 * topics switch on and off with a live count, parts are left out, notes are picked by hand, "Use these notes" stages exactly one change, "Cancel" stages
 * none, the keyboard-only path, reduce motion, the text budget on the real page, and nothing cropped at the two review sizes.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { SIZES, THEMES, fresh, launchHome, resize, setLook, shot } from './home-page.js';
import type { Home } from './home-page.js';

const NOTES_PAGE = '#prototype-v2/notes';
let home: Home;
const page = (): Page => home.page;

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), NOTES_PAGE);
  await resize(page(), 1440, 900);
});

// ---- Small helpers.
const layer = (): Locator => page().locator('[data-slot="notes"]');
const chooseButton = (): Locator => page().locator('[data-notes-shelf]').getByRole('button', { name: 'Choose notes' });
const bar = (): Locator => page().locator('.hm-savebar');
const barText = (): Locator => bar().locator('.hm-savebar-state p');
const card = (name: string): Locator => layer().locator('.nt-topic .kit-card').filter({ has: page().getByRole('button', { name, exact: true }) });
const topic = (name: string): Locator => layer().getByRole('button', { name, exact: true });
const leaveButton = (of: string): Locator => layer().getByRole('button', { name: `Leave out of ${of}`, exact: true });
const leavePanel = (of: string): Locator => layer().getByRole('group', { name: `Leave out of ${of}` });
/** The button that leaves one part out of a topic. The panel that holds it opens on the way, as a person would open it. */
const chip = (part: string, of: string): Locator => leavePanel(of).getByRole('button', { name: `Leave out ${part}`, exact: true });
async function openLeave(of: string): Promise<void> { if ((await leaveButton(of).getAttribute('aria-expanded')) !== 'true') await leaveButton(of).click(); await expect(leavePanel(of)).toBeVisible(); }
const count = async (): Promise<number> => Number(await layer().locator('.nt-big').getAttribute('data-count'));
const shelfCards = (): Locator => page().locator('[data-notes-shelf] .kit-card');
async function pickAgent(name: string): Promise<void> {
  await page().locator('.hm-grid').getByRole('button', { name, exact: true }).click();
  await expect(page().locator('#nt-panel-title')).toHaveText(name);
}
async function openLayer(agent: string): Promise<void> {
  await pickAgent(agent);
  await chooseButton().click();
  await expect(layer()).toBeVisible();
  await animationsDone(page());
}
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));

// ---- The page and the layer.
test('the test page shows the agents and a Notes shelf whose button waits for an agent', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Choose notes test page' })).toBeVisible();
  await expect(p.locator('.hm-grid .kit-card')).toHaveCount(10);
  await expect(chooseButton()).toBeDisabled();
  await expect(barText()).toHaveText('Nothing to save yet');
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  await pickAgent('Report builder');
  await expect(chooseButton()).toBeEnabled();
  await expect(shelfCards()).toHaveCount(0);
});

test('the layer opens titled "Choose notes" with one plain sentence, eight topics by size, and a preview that reads 0 of 700', async () => {
  const p = page();
  await openLayer('Report builder');
  await expect(layer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
  await expect(layer().getByText('Pick the notes this agent can read.')).toBeVisible();
  await expect(layer().locator('.nt-agent')).toHaveText('Report builder');
  const names = await layer().locator('.nt-topic .kit-card-main').allTextContents();
  const sizes = await layer().locator('.nt-topic .kit-card-hint').allTextContents();
  expect(names).toEqual(['Work', 'Meetings', 'Research', 'Clients', 'Writing', 'Money', 'Travel', 'Company']);
  expect(sizes.map(s => parseInt(s, 10))).toEqual([143, 114, 108, 86, 73, 69, 55, 52]);
  await expect(layer().locator('.nt-num')).toHaveText('0');
  await expect(layer().getByText('of 700 notes')).toBeVisible();
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeDisabled();
  await expect(layer().getByText('Pick at least one note first.')).toBeVisible();
  await expect(layer().getByText('Nothing is picked yet.')).toBeVisible();
  // The layer is a sheet over the whole window, not a narrow drawer.
  const box = await layer().boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
  expect(await budget()).toEqual([]);
  expect(await p.locator('.nt-layer').count()).toBe(1);
});

test('switching topics on and off changes the count and the preview at once', async () => {
  await openLayer('Report builder');
  await topic('Work').click();
  await expect(topic('Work')).toHaveAttribute('aria-pressed', 'true');
  expect(await count()).toBe(143);
  await expect(layer().getByText('All notes about Work.')).toBeVisible();
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeEnabled();
  await topic('Clients').click();
  expect(await count()).toBe(229);
  await expect(layer().locator('.nt-titles li').first()).toContainText('Clients'.toLowerCase().slice(0, 3), { ignoreCase: true });   // the newest topic is listed first
  await topic('Work').click();
  expect(await count()).toBe(86);
  await expect(layer().getByText('All notes about Work.')).toHaveCount(0);
  await topic('Clients').click();
  expect(await count()).toBe(0);
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeDisabled();
  // The size line says what it keeps in mind, in pages.
  await topic('Meetings').click();
  await expect(layer().locator('.nt-cost')).toHaveText(/^Keeps about \d+ pages? in mind at once\.$/);
});

test('the preview lists the first eight titles, "Show more" opens the rest, and "Show less" folds them back', async () => {
  await openLayer('Report builder');
  await topic('Work').click();
  const titles = layer().locator('.nt-titles li');
  await expect(titles).toHaveCount(8);
  const more = layer().getByRole('button', { name: 'Show more' });
  await more.click();
  await expect(layer().getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  await expect(titles).toHaveCount(143);
  await layer().getByRole('button', { name: 'Show less' }).click();
  await expect(titles).toHaveCount(8);
  await topic('Work').click();
  await expect(layer().getByRole('button', { name: /Show/ })).toHaveCount(0);
});

test('"Leave out" takes a part away from a topic that is on: the count drops, the words say "except", and putting it back restores both', async () => {
  await openLayer('Report builder');
  await expect(leaveButton('Work')).toHaveCount(0);
  await topic('Work').click();
  await expect(leaveButton('Work')).toBeVisible();
  await expect(leaveButton('Work')).toHaveAttribute('aria-expanded', 'false');
  await openLeave('Work');
  await expect(leavePanel('Work').getByRole('button')).toHaveCount(6);
  const before = await card('Work').boundingBox();
  await chip('Archived', 'Work').click();
  await expect(chip('Archived', 'Work')).toHaveAttribute('aria-pressed', 'true');
  expect(await count()).toBe(143 - 26);
  await expect(layer().getByText('All notes about Work, except Archived.')).toBeVisible();
  await expect(card('Work').locator('.kit-card-hint')).toHaveText('117 of 143 notes');
  await expect(leaveButton('Work').locator('.nt-leave-n')).toHaveText('1');
  await chip('Finished', 'Work').click();
  await expect(layer().getByText('All notes about Work, except Finished and Archived.').or(layer().getByText('All notes about Work, except Archived and Finished.'))).toBeVisible();
  await chip('Archived', 'Work').click(); await chip('Finished', 'Work').click();
  expect(await count()).toBe(143);
  await expect(layer().getByText('All notes about Work.')).toBeVisible();
  await expect(leaveButton('Work').locator('.nt-leave-n')).toHaveCount(0);
  // The cards do not move when the panel opens or a part goes.
  expect(await card('Work').boundingBox()).toEqual(before);
  // A press elsewhere closes the panel, and Escape closes only the panel.
  await topic('Meetings').click();
  await expect(leavePanel('Work')).toHaveCount(0);
  await openLeave('Work');
  await page().keyboard.press('Escape');
  await expect(leavePanel('Work')).toHaveCount(0);
  await expect(leaveButton('Work')).toBeFocused();
  await expect(layer()).toBeVisible();
  // Turning the topic off hides the button and forgets what was left out.
  await openLeave('Work'); await chip('Archived', 'Work').click();
  await topic('Work').click();
  await expect(leaveButton('Work')).toHaveCount(0);
  await topic('Work').click();
  expect(await count()).toBe(143 + 114);
});

test('"Pick by hand": open a topic, search, tick two notes, and they are counted; a note its topic already includes is ticked and cannot change', async () => {
  const p = page();
  await openLayer('Report builder');
  await layer().getByRole('button', { name: 'Pick by hand' }).click();
  await expect(layer().getByRole('heading', { level: 3, name: 'Pick by hand' })).toBeFocused();
  await expect(layer().locator('.nt-pills .nt-pill')).toHaveCount(8);
  await expect(layer().getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await layer().getByRole('button', { name: 'Money', exact: true }).click();
  const rows = layer().locator('.nt-rows li');
  await expect(rows).toHaveCount(69);
  const search = layer().getByRole('searchbox', { name: 'Search notes' });
  await search.fill('invoices');
  const found = await rows.count();
  expect(found).toBeGreaterThan(0); expect(found).toBeLessThan(69);
  await expect(rows.first()).toContainText('Invoices');
  await search.fill('zzzz');
  await expect(layer().getByText('No notes match your search.')).toBeVisible();
  await search.fill('invoices');
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  await expect(layer().getByText('2 picked by hand')).toBeVisible();
  expect(await count()).toBe(2);
  await expect(layer().getByRole('button', { name: 'Money, 2 picked' })).toBeVisible();
  expect(await budget()).toEqual([]);
  // Back to the topics: the ticks stay, and the words say so.
  await layer().getByRole('button', { name: 'All topics' }).click();
  await expect(layer().getByRole('button', { name: 'Pick by hand' })).toBeFocused();
  await expect(layer().getByText('2 notes picked by hand.')).toBeVisible();
  await topic('Money').click();
  expect(await count()).toBe(69);
  await layer().getByRole('button', { name: 'Pick by hand' }).click();
  await layer().getByRole('button', { name: /^Money/ }).click();
  const locked = rows.nth(5).getByRole('checkbox');
  await expect(locked).toBeChecked();
  await expect(locked).toBeDisabled();
  await expect(rows.nth(5)).toContainText('Already included by its topic.');
  await p.keyboard.press('Escape');
  await expect(layer()).toHaveCount(0);
});

test('"Use these notes" stages ONE change: the layer closes, the shelf shows the new notes, and the Save bar says what changed', async () => {
  await openLayer('Report builder');
  await topic('Clients').click();
  await openLeave('Clients'); await chip('Contracts', 'Clients').click();
  await topic('Money').click();
  await layer().getByRole('button', { name: 'Use these notes' }).click();
  await expect(layer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(shelfCards()).toHaveCount(1);
  await expect(shelfCards().first().locator('.kit-card-main')).toHaveText('Report Builder Notes');
  await expect(barText()).toHaveText('Added Report Builder Notes to Report builder');
  await expect(shelfCards().first()).toHaveAttribute('data-fresh', '');
  // Opening it again shows what was chosen.
  await chooseButton().click();
  await expect(topic('Clients')).toHaveAttribute('aria-pressed', 'true');
  await expect(topic('Money')).toHaveAttribute('aria-pressed', 'true');
  await openLeave('Clients');
  await expect(chip('Contracts', 'Clients')).toHaveAttribute('aria-pressed', 'true');
  expect(await count()).toBe(86 - 23 + 69);
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeDisabled();
  await expect(layer().getByText('Nothing has changed yet.')).toBeVisible();
  // Choose differently: still one change, the same set.
  await topic('Travel').click();
  await layer().getByRole('button', { name: 'Use these notes' }).click();
  await expect(barText()).toHaveText('Added Report Builder Notes to Report builder');
  await expect(shelfCards()).toHaveCount(1);
  // Save, and it is one save point; then it reads as saved.
  await bar().getByRole('button', { name: 'Save' }).click();
  await expect(barText()).toHaveText('Saved');
  await expect(shelfCards()).toHaveCount(1);
});

test('the Save bar counts one change, and Discard changes puts everything back', async () => {
  await openLayer('Report builder');
  await topic('Work').click();
  await layer().getByRole('button', { name: 'Use these notes' }).click();
  await expect(barText()).not.toHaveText('Nothing to save yet');
  await expect(bar().getByRole('button', { name: 'Discard changes' })).toBeVisible();
  await bar().getByRole('button', { name: 'Discard changes' }).click();
  await expect(barText()).toHaveText('Nothing to save yet');
  await expect(shelfCards()).toHaveCount(0);
});

test('"Cancel", "Close" and Escape stage nothing, and the focus goes back to the button', async () => {
  const p = page();
  await openLayer('Report builder');
  await topic('Work').click(); await topic('Money').click();
  await layer().getByRole('button', { name: 'Cancel' }).click();
  await expect(layer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(barText()).toHaveText('Nothing to save yet');
  await expect(shelfCards()).toHaveCount(0);
  await chooseButton().click();
  await topic('Work').click();
  await layer().getByRole('button', { name: 'Close' }).click();
  await expect(layer()).toHaveCount(0);
  await expect(barText()).toHaveText('Nothing to save yet');
  await chooseButton().click();
  await expect(topic('Work')).toHaveAttribute('aria-pressed', 'false');     // it starts afresh each time
  await topic('Work').click();
  await p.keyboard.press('Escape');
  await expect(layer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(barText()).toHaveText('Nothing to save yet');
});

test('an agent that already reads notes opens on them; "Use these notes" waits for a change; a shared set is not changed for the other agent', async () => {
  await openLayer('Meeting assistant');
  await expect(topic('Clients')).toHaveAttribute('aria-pressed', 'true');
  await expect(topic('Company')).toHaveAttribute('aria-pressed', 'true');
  await openLeave('Company');
  await expect(chip('Handbook', 'Company')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Culture', 'Company')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Hiring', 'Company')).toHaveAttribute('aria-pressed', 'false');
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeDisabled();
  const before = await count();
  await topic('Money').click();
  expect(await count()).toBe(before + 69);
  await layer().getByRole('button', { name: 'Use these notes' }).click();
  await expect(barText()).toHaveText('Added Meeting Assistant Notes to Meeting assistant');
  await pickAgent('Inbox sorter');
  await expect(shelfCards().first().locator('.kit-card-main')).toHaveText('Client list');
  await pickAgent('Meeting assistant');
  await expect(shelfCards().first().locator('.kit-card-main')).toHaveText('Meeting Assistant Notes');
});

test('notes that were chosen another way show as "Kept from before", and can be dropped', async () => {
  await openLayer('Research assistant');
  const kept = card('Kept from before');
  await expect(kept).toHaveCount(1);
  await expect(kept.locator('.kit-card-main')).toHaveAttribute('aria-pressed', 'true');
  const start = await count();
  expect(start).toBeGreaterThan(0);
  await expect(layer().getByText(/notes? kept from before\./)).toBeVisible();
  await topic('Money').click();
  expect(await count()).toBeGreaterThanOrEqual(69);
  await layer().getByRole('button', { name: 'Kept from before' }).click();
  expect(await count()).toBe(69);
  await expect(layer().getByText(/kept from before\./)).toHaveCount(0);
  await layer().getByRole('button', { name: 'Use these notes' }).click();
  await expect(barText()).toHaveText('Changed Reading list');
});

// ---- The keyboard.
test('keyboard only: open the layer, switch a topic on, leave a part out, pick by hand, use the notes, and Escape comes back to the button', async () => {
  const p = page();
  await pickAgent('Report builder');
  await chooseButton().focus();
  await p.keyboard.press('Enter');
  await expect(layer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
  const reach = async (target: Locator, max = 40): Promise<void> => {
    for (let i = 0; i < max; i += 1) { if (await target.evaluate(el => el === document.activeElement)) return; await p.keyboard.press('Tab'); }
    throw new Error('The keyboard did not reach the control.');
  };
  await reach(topic('Work'));
  await p.keyboard.press('Space');
  await expect(topic('Work')).toHaveAttribute('aria-pressed', 'true');
  expect(await count()).toBe(143);
  await reach(leaveButton('Work'));
  await p.keyboard.press('Enter');
  await reach(chip('Archived', 'Work'));
  await p.keyboard.press('Enter');
  expect(await count()).toBe(117);
  await p.keyboard.press('Escape');
  await expect(leaveButton('Work')).toBeFocused();
  await expect(layer()).toBeVisible();
  await reach(layer().getByRole('button', { name: 'Pick by hand' }));
  await p.keyboard.press('Enter');
  await expect(layer().getByRole('heading', { level: 3, name: 'Pick by hand' })).toBeFocused();
  await reach(layer().getByRole('button', { name: 'Money', exact: true }));
  await p.keyboard.press('Space');
  const first = layer().locator('.nt-rows li').first().getByRole('checkbox');
  await reach(first);
  await p.keyboard.press('Space');
  await expect(first).toBeChecked();
  expect(await count()).toBe(118);
  // The list is one stop: the arrows move inside it, Tab leaves it.
  await p.keyboard.press('ArrowDown');
  await expect(layer().locator('.nt-rows li').nth(1).getByRole('checkbox')).toBeFocused();
  await p.keyboard.press('End');
  await expect(layer().locator('.nt-rows li').last().getByRole('checkbox')).toBeFocused();
  await p.keyboard.press('Home');
  await expect(first).toBeFocused();
  await p.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await reach(layer().getByRole('button', { name: 'Done picking' }));
  await p.keyboard.press('Enter');
  await expect(layer().getByRole('button', { name: 'Pick by hand' })).toBeFocused();
  await reach(layer().getByRole('button', { name: 'Use these notes' }));
  await p.keyboard.press('Enter');
  await expect(layer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(barText()).toHaveText('Added Report Builder Notes to Report builder');
  await p.keyboard.press('Enter');
  await expect(layer()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(layer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
});

test('every control shows a focus ring that is seen', async () => {
  const p = page();
  await openLayer('Report builder');
  await topic('Work').click();
  await openLeave('Work');
  for (const target of [layer().locator('.nt-topic .kit-card-main').first(), leaveButton('Work'), chip('Archived', 'Work'), layer().getByRole('button', { name: 'Pick by hand' }), layer().getByRole('button', { name: 'Cancel' })]) {
    await target.focus();
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    const ring = await target.evaluate(el => {
      const own = getComputedStyle(el), box = el.closest('.kit-card') !== null ? getComputedStyle(el.closest('.kit-card')!) : own;
      return Math.max(parseFloat(own.outlineWidth) * (own.outlineStyle === 'none' ? 0 : 1), parseFloat(box.outlineWidth) * (box.outlineStyle === 'none' ? 0 : 1));
    });
    expect(ring).toBeGreaterThanOrEqual(2);
  }
});

// ---- Less motion.
test('reduce motion: the layer appears and goes at once, with no animation running', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await pickAgent('Report builder');
  await chooseButton().click();
  await expect(layer()).toBeVisible();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await topic('Work').click();
  await openLeave('Work'); await chip('Archived', 'Work').click();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  const times = await p.evaluate(() => [...document.querySelectorAll('.nt-layer *')].map(el => getComputedStyle(el).transitionDuration).filter(d => d !== '0s' && d !== ''));
  expect(times).toEqual([]);
  await p.keyboard.press('Escape');                       // the first Escape closes the small panel
  await expect(leavePanel('Work')).toHaveCount(0, { timeout: 500 });
  await p.keyboard.press('Escape');
  await expect(layer()).toHaveCount(0, { timeout: 500 });
});

test('with motion allowed the layer slides in and settles', async () => {
  const p = page();
  await pickAgent('Report builder');
  await chooseButton().click();
  await expect(layer()).toBeVisible();
  await animationsDone(p);
  expect(await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
});

// ---- The text budget, on the real page, in every step.
test('the text budget holds on the real page: topics, parts left out, the hand step, an expanded preview, and with notes kept from before', async () => {
  await openLayer('Report builder');
  expect(await budget()).toEqual([]);
  await topic('Work').click(); await topic('Meetings').click(); await openLeave('Work'); await chip('Archived', 'Work').click();
  expect(await budget()).toEqual([]);
  await layer().getByRole('button', { name: 'Show more' }).click();
  expect(await budget()).toEqual([]);
  await layer().getByRole('button', { name: 'Pick by hand' }).click();
  expect(await budget()).toEqual([]);
  await layer().locator('.nt-rows li').first().getByRole('checkbox').check();
  expect(await budget()).toEqual([]);
  await page().keyboard.press('Escape');
  await openLayer('Research assistant');
  expect(await budget()).toEqual([]);
  const text = await layer().innerText();
  expect(text).not.toMatch(/\b(slice|token|folder|harness|scope|rule)\b/i);
  expect(text).not.toMatch(/alderhythe|tarnwick|brindle|sedgefield|fennrow|quillmoor|cinderlow|marrowdeep|\.md\b|\//);
});

// ---- Size, fit and the two review sizes.
for (const [w, h] of SIZES) {
  test(`at ${w} by ${h}: the layer fits the window, the buttons stay in view, nothing is cut off, and all text is 14 px or more`, async () => {
    const p = page();
    await resize(p, w, h);
    await openLayer('Report builder');
    await topic('Work').click(); await topic('Clients').click(); await openLeave('Work'); await chip('Archived', 'Work').click();
    const fit = await p.evaluate(() => {
      const d = document.querySelector('[data-slot="notes"]')!.getBoundingClientRect(), foot = document.querySelector('.nt-foot')!.getBoundingClientRect();
      const use = [...document.querySelectorAll('.nt-foot button')].map(b => b.getBoundingClientRect());
      const cols = document.querySelector('.nt-cols')!.getBoundingClientRect(), right = document.querySelector('.nt-right')!.getBoundingClientRect();
      const small: string[] = [];
      for (const el of document.querySelectorAll('[data-slot="notes"] *')) {
        if (![...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 14) small.push(`${el.className}:${size}`);
      }
      return {
        inside: d.left >= 0 && d.top >= 0 && d.right <= window.innerWidth + 0.5 && d.bottom <= window.innerHeight + 0.5, footInside: foot.bottom <= window.innerHeight + 0.5 && foot.top >= 0,
        buttonsInside: use.every(b => b.bottom <= window.innerHeight && b.right <= window.innerWidth), colsInside: cols.bottom <= foot.top + 0.5, rightInside: right.right <= window.innerWidth + 0.5,
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.querySelector('.kit-drawer-body')!.scrollWidth - document.querySelector('.kit-drawer-body')!.clientWidth, small, width: d.width,
      };
    });
    console.log(`MEASURED layer at ${w}x${h}:`, JSON.stringify(fit));
    expect(fit).toMatchObject({ inside: true, footInside: true, buttonsInside: true, colsInside: true, rightInside: true, small: [] });
    expect(fit.doc).toBeLessThanOrEqual(0); expect(fit.body).toBeLessThanOrEqual(0);
    expect(fit.width).toBeGreaterThanOrEqual(w - 1);
    // The topics scroll inside their column, so every topic can be reached.
    const last = layer().locator('.nt-topic').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // The preview column scrolls on its own, and "Show more" can be reached.
    await layer().getByRole('button', { name: 'Show more' }).scrollIntoViewIfNeeded();
    await expect(layer().getByRole('button', { name: 'Show more' })).toBeInViewport();
  });

  test(`at ${w} by ${h}: the controls are easy to hit (36 px or more) and the cards are the kit's own`, async () => {
    await resize(page(), w, h);
    await openLayer('Report builder');
    await topic('Work').click();
    const sizes = await page().evaluate(() => [...document.querySelectorAll('[data-slot="notes"] button, [data-slot="notes"] .kit-card, [data-slot="notes"] input')].filter(el => (el as HTMLElement).offsetParent !== null).map(el => { const r = el.getBoundingClientRect(); return { name: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30), w: r.width, h: r.height, tag: el.tagName, card: el.classList.contains('kit-card-main') }; }));
    for (const s of sizes.filter(x => x.tag === 'BUTTON' && !x.card)) expect(s.h, s.name).toBeGreaterThanOrEqual(35.5);
    for (const s of sizes.filter(x => x.tag === 'DIV')) expect(s.h, s.name).toBeGreaterThanOrEqual(35.5);
    await expect(layer().locator('.nt-topic .kit-card')).toHaveCount(8);
    await expect(layer().locator('.nt-topic .kit-card[data-kind="note"][data-size="small"]')).toHaveCount(8);
  });
}

// ---- Screenshots (only when HOME_U0_SHOTS names a folder).
if (process.env.HOME_U0_SHOTS !== undefined) {
  for (const [w, h] of SIZES) for (const look of THEMES) {
    test(`screenshots at ${w} by ${h}, ${look}: the page, first open, a few topics on, pick by hand, the preview open`, async () => {
      test.setTimeout(180_000);
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await pickAgent('Report builder');
      await shot(p, 'notes-page', w, h, look);
      await chooseButton().click();
      await expect(layer()).toBeVisible();
      await shot(p, 'notes-1-first-open', w, h, look);
      await topic('Clients').click(); await topic('Work').click(); await openLeave('Work'); await chip('Archived', 'Work').click();
      await shot(p, 'notes-2-topics-on', w, h, look);
      await layer().getByRole('button', { name: 'Show more' }).click();
      await shot(p, 'notes-4-preview-expanded', w, h, look);
      await layer().getByRole('button', { name: 'Show less' }).click();
      await layer().getByRole('button', { name: 'Pick by hand' }).click();
      await layer().getByRole('button', { name: 'Money', exact: true }).click();
      await layer().locator('.nt-rows li').nth(2).getByRole('checkbox').check();
      await layer().locator('.nt-rows li').nth(5).getByRole('checkbox').check();
      await shot(p, 'notes-3-pick-by-hand', w, h, look);
      await layer().getByRole('button', { name: 'All topics' }).click();
      await layer().getByRole('button', { name: 'Use these notes' }).click();
      await shot(p, 'notes-5-after-use', w, h, look);
      await pickAgent('Research assistant');
      await chooseButton().click();
      await shot(p, 'notes-6-kept-from-before', w, h, look);
    });
  }
}
