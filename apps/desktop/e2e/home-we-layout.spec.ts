/**
 * Wave E, group J, in the real window (Electron started with --prototype-v2): a state label is never cut ("2 different copi..."): a narrow card says "2 copies" and
 * the full words stay in the page; the map shows four columns of tiles where the stage can hold four (the panel can be put away); the job line of a tile keeps one line and
 * has its whole text as a tooltip; the picker of "Add to which agent?" lists the agent that is picked first and says "Selected"; and the version history names each
 * point by what changed, with the time, and the warning says which changes would go.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const panel = (): Locator => page().locator('aside.hm-panel');
const tiles = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const agentButton = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });
/** How many columns the grid has now, from its computed tracks, checked against where the tiles really are. */
const columns = async (): Promise<number> => page().evaluate(() => {
  const tracks = getComputedStyle(document.querySelector('.hm-grid')!).gridTemplateColumns.split(/\s+/).filter(t => t !== '').length;
  const lefts = new Set([...document.querySelectorAll('.hm-grid .kit-card[data-kind="agent"]')].map(el => Math.round(el.getBoundingClientRect().left))).size;
  return Math.min(tracks, lefts);
});
const toggle = (): Locator => page().locator('[data-details-toggle]');
/** The words of every visible state that a row cuts short with an ellipsis. */
const cutStates = async (): Promise<string[]> => page().evaluate(() => [...document.querySelectorAll('.kit-status > span:not(.kit-dot)')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 2 && el.scrollWidth > el.clientWidth + 0.5; }).map(el => el.textContent ?? ''));

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('a state is never cut: "2 different copies" fits, or the narrow card says "2 copies" and keeps the full words in the page', async () => {
  const p = page();
  for (const [w, h] of [[900, 600], [1280, 800], [1440, 900], [1000, 700]] as const) {
    await resize(p, w, h);
    await ensurePicked(agentButton('Inbox sorter'));
    await p.locator('.hm-grid').getByRole('button', { name: /^\d+ skills?$/ }).first().click();
    await animationsDone(p);
    expect(await cutStates(), `${w}: no state is cut`).toEqual([]);
    // The state in the panel row, and the same state in the tray.
    const inPanel = panel().locator('.kit-card', { hasText: 'Sort mail by topic' }).locator('.kit-status');
    await expect(inPanel).toHaveCount(1);
    const shown = await inPanel.evaluate(el => ({ full: (el.querySelector('span:not(.kit-dot):not(.kit-status-short)') as HTMLElement).getBoundingClientRect().width, short: (el.querySelector('.kit-status-short') as HTMLElement).getBoundingClientRect().width }));
    expect(shown.full > 2 || shown.short > 2, `${w}: one of the two forms is drawn`).toBe(true);
    expect(shown.full > 2 && shown.short > 2, `${w}: not both`).toBe(false);
    // A screen reader hears the full words in either form.
    await expect(inPanel).toContainText('2 different copies');
    await expect(panel().getByRole('button', { name: /2 different copies/ }).first()).toBeVisible();
    if (w === 900) { expect(shown.short).toBeGreaterThan(2); await expect(inPanel).toBeVisible(); }
    if (w >= 1280) expect(shown.full).toBeGreaterThan(2);
  }
  // The dialog it opens still says "Two different copies".
  await resize(p, 900, 600);
  await panel().getByRole('button', { name: /2 different copies/ }).first().click();
  await expect(p.getByRole('dialog', { name: 'Two different copies' })).toBeVisible();
  await p.keyboard.press('Escape');
  expect(await budget()).toEqual([]);
  await atEverySize(p, 'copies-state-narrow', async () => { await ensurePicked(agentButton('Inbox sorter')); });
});

test('the map shows as many columns as the stage holds: with the navigation and the panel open two at 1280 and three at 1440, four at 1634 (the navigation takes 232 px), and one more when the panel is put away', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await expect(toggle()).toHaveAttribute('aria-label', 'Hide details');
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(columns, { message: 'columns' }).toBe(2);
  await toggle().click();
  await expect(toggle()).toHaveAttribute('aria-label', 'Show details');
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  await expect(panel()).toBeHidden();
  await animationsDone(p);
  await expect.poll(columns, { message: 'columns' }).toBe(3);
  // The right strip is no longer empty: the third column reaches towards the edge of the window.
  const right = await tiles().evaluateAll(list => Math.max(...list.map(el => el.getBoundingClientRect().right)));
  expect(1280 - right).toBeLessThanOrEqual(250);
  // The tiles are the same size in every column, and the grid fits the stage.
  const sizes = await tiles().evaluateAll(list => [...new Set(list.map(el => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))]);
  expect(sizes).toEqual(['250x92']);
  expect(await p.evaluate(() => document.querySelector('main.hm-stage')!.scrollWidth <= document.querySelector('main.hm-stage')!.clientWidth + 1)).toBe(true);
  await atEverySize(p, 'map-three-columns', async () => undefined);
  await toggle().click();
  await expect(panel()).toBeVisible();
  await expect.poll(columns, { message: 'columns' }).toBe(2);
  await resize(p, 1440, 900);
  await expect.poll(columns, { message: 'columns' }).toBe(3);
  await resize(p, 1634, 900);
  await expect.poll(columns, { message: 'columns' }).toBe(4);
  await resize(p, 1633, 900);
  await expect.poll(columns, { message: 'columns' }).toBe(3);
  // With the navigation put away to its rail, four columns come at 1450.
  await p.locator('[data-nav-toggle]:visible').click();
  await resize(p, 1450, 900);
  await expect.poll(columns, { message: 'columns' }).toBe(4);
  await resize(p, 900, 600);
  await expect.poll(columns, { message: 'columns' }).toBe(2);
  await toggle().click();
  await expect.poll(columns, { message: 'columns' }).toBe(3);
});

test('putting the details away is a choice that the tour, "Skip to details" and "Show" on the Add note take back', async () => {
  const p = page();
  await toggle().click();
  await expect(panel()).toBeHidden();
  // The tour needs the panel, so it opens it.
  await p.getByRole('button', { name: 'Help', exact: true }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible();
  await expect(panel()).toBeVisible();
  await expect(toggle()).toHaveAttribute('aria-label', 'Hide details');
  await p.keyboard.press('Escape');
  // Skip to details opens it and puts the focus on its heading.
  await toggle().click();
  await expect(panel()).toBeHidden();
  await p.getByRole('link', { name: 'Skip to details' }).focus();
  await p.keyboard.press('Enter');
  await expect(panel()).toBeVisible();
  await expect(panel().locator('[tabindex="-1"]').first()).toBeFocused();
  // "Show" on the note after an add shows where the card went, so it opens the panel too.
  await toggle().click();
  await expect(panel()).toBeHidden();
  await p.getByRole('button', { name: 'Add', exact: true }).first().click();
  await p.locator('.add-list .add-row').first().getByRole('button', { name: /^Add to/ }).click();
  await p.locator('[data-picker] .add-pick-main:not([aria-disabled="true"])').first().click();
  await p.getByRole('button', { name: 'Show what was added' }).click();
  await expect(panel()).toBeVisible();
});

test('a tile keeps its job on one line, and the whole job is its tooltip and is in the details panel', async () => {
  const p = page();
  const tile = tiles().filter({ hasText: 'Meeting assistant' });
  const job = tile.locator('.kit-card-hint');
  const full = (await job.textContent())!;
  await expect(job).toHaveAttribute('title', full);
  expect(await job.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBeLessThanOrEqual(24);
  expect(await tiles().evaluateAll(list => [...new Set(list.map(el => Math.round(el.getBoundingClientRect().height)))])).toEqual([92]);
  await ensurePicked(agentButton('Meeting assistant'));
  await expect(panel().getByText(full, { exact: true })).toBeVisible();
  expect(await budget()).toEqual([]);
  void p;
});

test('the picker lists the agent that is picked first and says "Selected": in the Add drawer and on the Library page', async () => {
  const p = page();
  await ensurePicked(agentButton('Money tracker'));
  await p.getByRole('button', { name: 'Add', exact: true }).first().click();
  const row = p.locator('.add-list .add-row').first();
  await row.getByRole('button', { name: /^Add to/ }).click();
  const names = async (): Promise<string[]> => p.locator('[data-picker] .add-pick-main').allTextContents();
  const list = await names();
  expect(list[0]).toBe('Money tracker');
  expect([...list.slice(1)].sort((a, b) => a.localeCompare(b))).toEqual(list.slice(1));
  await expect(p.locator('[data-picker] .add-pick').first().locator('.add-pick-note')).toContainText('Selected');
  expect(await p.locator('[data-picker] .add-pick-note[data-selected]').count()).toBe(1);
  expect(await budget()).toEqual([]);
  await p.keyboard.press('Escape');
  // Another agent picked, another one first.
  await p.keyboard.press('Escape');
  await ensurePicked(agentButton('Trip organizer'));
  await p.getByRole('button', { name: 'Library', exact: true }).click();
  await p.getByRole('button', { name: 'Translate a text', exact: true }).click();
  await p.getByRole('button', { name: 'Add to an agent' }).click();
  const group = p.getByRole('group', { name: 'Add to which agent?' });
  await expect(group).toBeVisible();
  const first = group.locator('.add-pick-main').first();
  await expect(first).toHaveText('Trip organizer');
  await expect(group.locator('.add-pick').first().locator('.add-pick-note')).toContainText('Selected');
  await atEverySize(p, 'add-picker-selected-first');
});

test('the version history names each point by what changed with the time it was made, and the warning says which changes would go', async () => {
  const p = page();
  await ensurePicked(agentButton('Meeting assistant'));
  const remove = (name: string): Promise<void> => panel().getByRole('region', { name: 'Skills' }).getByRole('button', { name: `Remove ${name}` }).click();
  await remove('Summarize a meeting'); await remove('Write a reply'); await remove('List action items');
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  await remove('Tidy my meeting notes');
  await p.getByRole('button', { name: 'Version history' }).click();
  const drawer = p.locator('[data-slot="points"]');
  await expect(drawer).toBeVisible();
  await animationsDone(p);
  // The warning names what would go.
  await expect(drawer.locator('[data-which]')).toHaveText('Removed Tidy my meeting notes');
  await expect(drawer).toContainText('Changes you have not saved will go away.');
  const rows = drawer.locator('.pt-row');
  await expect(rows).toHaveCount(2);
  // The newest point is named for its changes, not "3 changes", and has the clock time.
  await expect(rows.first().locator('.pt-name')).toHaveText('Removed Summarize a meeting, Write a reply and 1 more');
  await expect(rows.first().locator('[data-clock]')).toHaveText(/^(Today|Yesterday|\w+ \d+), \d+:\d\d [AP]M$/);
  expect(await rows.first().locator('.pt-name').textContent()).not.toMatch(/^\d+ changes$/);
  // The line under the name says nothing twice.
  await expect(rows.first().locator('.pt-changes')).toHaveCount(0);
  await expect(rows.last().locator('.pt-name')).toHaveText('How it started');
  expect(await budget()).toEqual([]);
  await atEverySize(p, 'version-history-rows');
});
