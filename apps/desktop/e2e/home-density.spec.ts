/**
 * Wave D of the 0.8 home app, in the real window (Electron started with --prototype-v2): one tile for every agent, a tray for its lists, one row for every skill, tool and
 * note, a state that is a dot and words, and the whole window at about 90 percent of its first size. It measures what a person sees: every agent tile has the same
 * width and height (with a long name and with no tools), the counts do not wrap, a tray opens under the tile's row and pushes the later rows down, one tray at a time,
 * every row has one height, every word is 14 px or more on every screen, no filled pill is left, a state is a dot and words, and a target is never under 24 px square
 * (a button is 32 px). Each screen is visited at 1280 by 800 and 900 by 600, in the light and the dark look. Set HOME_U0_SHOTS to a folder to also save a screenshot of each.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { THEMES, fresh, launchHome, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SIZES_D = [[1280, 800], [900, 600]] as const;
const TILE = { w: 250, h: 92 }, ROW_H = 44;

let home: Home;
const page = (): Page => home.page;
const tiles = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const tile = (name: string): Locator => tiles().filter({ has: page().locator('.kit-card-main', { hasText: new RegExp(`^${name}$`) }) });
const count = (name: string, label: string): Locator => tile(name).getByRole('button', { name: label, exact: true });
const trays = (): Locator => page().locator('.kit-tray[data-open]');
const panel = (): Locator => page().locator('aside.hm-panel');
const topBar = (name: string): Locator => page().locator('nav.hm-nav').getByRole('button', { name, exact: true });

interface Box { x: number; y: number; w: number; h: number }
const boxOf = async (el: Locator): Promise<Box> => el.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const trayFor = async (button: Locator): Promise<Locator> => page().locator(`[id="${await button.getAttribute('aria-controls')}"]`);

/** Every visible word under 14 px, with its size. A word counts when its element has a box and is not hidden (a closed tray is hidden). */
const smallText = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const el = n.parentElement;
    if (el === null || (n.textContent ?? '').trim() === '' || el.closest('.hm-sr, .nt-say') !== null) continue;
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    const size = parseFloat(style.fontSize);
    if (size < 14) out.push(`${size}px: ${(n.textContent ?? '').trim().slice(0, 40)}`);
  }
  return out;
});

/** Elements that look like a filled pill: a wide box with round ends and a fill. A circle (a round button, a dot) is not one, and neither is a bar. */
const pills = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-home] *')) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden') continue;
    const radius = parseFloat(s.borderTopLeftRadius);
    const filled = !/^rgba\(\d+, \d+, \d+, 0\)$|transparent/.test(s.backgroundColor);
    if (filled && r.width > r.height * 1.25 && radius >= r.height / 2 - 1 && !/^(METER|PROGRESS)$/.test(el.tagName)) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of document.querySelectorAll('.kit-badge, .kit-chip, .kit-pill, .kit-acc')) out.push(`old class ${el.className}`);
  return out;
});

/** Every state on the page as dot plus words: the dot is 8 px and round, the words are there, the state has no fill and no border, and its words are 14 px. */
const badStates = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.kit-status')) {
    const s = getComputedStyle(el), dot = el.querySelector<HTMLElement>('.kit-dot'), text = (el.textContent ?? '').trim();
    const box = dot?.getBoundingClientRect();
    if (box === undefined || Math.round(box.width) !== 8 || Math.round(box.height) !== 8 || getComputedStyle(dot!).borderRadius !== '50%') out.push(`no 8 px round dot: ${text}`);
    if (text === '') out.push('a state with no words');
    if (!/^rgba\(\d+, \d+, \d+, 0\)$/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) !== 0) out.push(`a state with a fill or a border: ${text}`);
    if (parseFloat(s.fontSize) < 14) out.push(`small state: ${text}`);
  }
  return out;
});

/** Targets under the size they must have: 24 px square for any control (a tick box is judged by its row), 32 px high for a button, a tab or a toggle of words. */
const smallTargets = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  const thirtyTwo = '.kit-button, .add-tab, .nt-pill, .nt-chip, .nt-leave-button, .kit-tray-more, .nt-search';
  for (const el of document.querySelectorAll<HTMLElement>('[data-home] button, [data-home] [role="tab"], [data-home] input, [data-home] a[href]')) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || el.closest('.hm-sr, [inert]') !== null) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) { const row = el.closest('label'); if (row !== null && row.getBoundingClientRect().height >= 32) continue; }
    // The name of a card is a button that covers the whole card, so the card is its target; the legs of the tour's hole are not controls.
    if (el.classList.contains('kit-card-main')) { const card = el.closest('.kit-card')!.getBoundingClientRect(); if (card.width >= 24 && card.height >= 24) continue; }
    if (r.width < 23.5 || r.height < 23.5) out.push(`${el.tagName}.${el.className} ${r.width.toFixed(1)}x${r.height.toFixed(1)} under 24 px`);
    else if (el.matches(thirtyTwo) && r.height < 31.5) out.push(`${el.tagName}.${el.className} is ${r.height.toFixed(1)} px high, under 32`);
  }
  return out;
});

/** The text of every `.kit-card-main` and hint is on one line with an ellipsis, and nothing in a tile or a row is clipped without one. */
const clippedWithoutDots = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.kit-card-main, .kit-card-hint')) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || s.visibility === 'hidden') continue;
    const line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3;
    if (r.height > line * 1.2) out.push(`wrapped: ${el.textContent}`);
    if (el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis') out.push(`clipped without an ellipsis: ${el.textContent}`);
  }
  for (const el of document.querySelectorAll<HTMLElement>('.kit-summary')) if (el.scrollWidth > el.clientWidth + 1) out.push(`the counts do not fit: ${el.textContent}`);
  return out;
});

/** In a row that has a state and a Remove, the words of the state end before Remove begins (the two share the second line of a narrow row). */
const statesOverRemove = async (): Promise<string[]> => page().evaluate(() => [...document.querySelectorAll('.kit-card')].flatMap(card => {
  const words = card.querySelector('.kit-status > span:last-child'), remove = card.querySelector('.kit-remove');
  if (words === null || remove === null || words.getBoundingClientRect().width === 0 || getComputedStyle(words).visibility === 'hidden') return [];
  const w = words.getBoundingClientRect(), r = remove.getBoundingClientRect();
  return w.right > r.left + 0.5 ? [`${words.textContent} runs into Remove by ${(w.right - r.left).toFixed(1)} px`] : [];
}));

/** Nothing sticks out past the window sideways. */
const overflowX = async (): Promise<number> => page().evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await expect(tiles()).toHaveCount(10);
});

// ---- One tile for every agent.
for (const [w, h] of SIZES_D) {
  for (const look of THEMES) {
    test(`at ${w} by ${h}, ${look}: every agent tile has the same width and the same height, the name and the job are one line, and the counts do not wrap`, async () => {
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      const sizes = await tiles().evaluateAll(list => list.map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
      expect(sizes).toHaveLength(10);
      expect(new Set(sizes.map(s => s.join('x'))).size, JSON.stringify(sizes)).toBe(1);
      expect(sizes[0]).toEqual([TILE.w, TILE.h]);
      const fold = await p.evaluate(() => { const stage = document.querySelector('.hm-stage')!.getBoundingClientRect(), list = [...document.querySelectorAll('.hm-grid .kit-card[data-kind="agent"]')].map(c => c.getBoundingClientRect()); return { whole: list.filter(c => c.bottom <= stage.bottom).length, touched: list.filter(c => c.top < stage.bottom).length, rows: new Set(list.map(c => Math.round(c.top / 20))).size, columns: new Set(list.map(c => Math.round(c.left))).size }; });
      console.log(`MEASURED tiles at ${w} by ${h}, ${look}:`, JSON.stringify(fold));
      // A tile with a 0-tool agent, one with three counts and one with a single count are the same size as the rest (Schedule keeper has skills and nothing else).
      expect(await boxOf(tile('Schedule keeper'))).toMatchObject({ w: TILE.w, h: TILE.h }); expect(await boxOf(tile('Meeting assistant'))).toMatchObject({ w: TILE.w, h: TILE.h });
      expect(await clippedWithoutDots()).toEqual([]);
      // The counts sit on one line: every count button of a tile has the same top.
      const lines = await tiles().evaluateAll(list => list.map(c => [...new Set([...c.querySelectorAll('.kit-count')].map(b => Math.round(b.getBoundingClientRect().top)))].length));
      expect(lines.every(n => n <= 1), lines.join()).toBe(true);
      expect(await smallText()).toEqual([]);
      await shot(p, 'density-map', w, h, look);
    });
  }
}

test('the gallery draws a long name, a long job, a tile with no tools and a tile with 14 skills at the very same size as the map', async () => {
  const p = page();
  await fresh(p, '#prototype-v2/kit');
  await expect(p.getByRole('heading', { level: 1, name: 'Card kit' })).toBeVisible();
  const all = p.locator('.hm-gallery-theme .kit-card[data-size="tile"]');
  expect(await all.count()).toBeGreaterThanOrEqual(10);
  const sizes = await all.evaluateAll(list => list.map(c => { const r = c.getBoundingClientRect(); return `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`; }));
  expect(new Set(sizes), sizes.join()).toEqual(new Set([`${TILE.w}x${TILE.h}`]));
  const long = p.locator('.hm-gallery-theme').first().locator('.kit-card[data-size="tile"]').filter({ hasText: 'The Quarterly Review Of Everything' }).first();
  const facts = await long.evaluate(c => { const n = c.querySelector<HTMLElement>('.kit-card-main')!, j = c.querySelector<HTMLElement>('.kit-card-hint')!; return { nameWrapped: n.getBoundingClientRect().height > 24, nameClipped: n.scrollWidth > n.clientWidth, jobClipped: j.scrollWidth > j.clientWidth, ellipsis: getComputedStyle(n).textOverflow }; });
  expect(facts).toEqual({ nameWrapped: false, nameClipped: true, jobClipped: true, ellipsis: 'ellipsis' });
  expect(await clippedWithoutDots()).toEqual([]);
  const rows = await p.locator('.hm-gallery-theme .kit-card[data-size="small"]').evaluateAll(list => [...new Set(list.map(c => Math.round(c.getBoundingClientRect().height)))]);
  expect(rows, 'every row of the gallery has one height').toEqual([ROW_H]);
  expect(await smallText()).toEqual([]); expect(await pills()).toEqual([]); expect(await badStates()).toEqual([]);
});

test('selecting an agent, opening a tray and a long window do not change the size of any tile', async () => {
  const p = page();
  const before = await tiles().evaluateAll(list => list.map(c => { const r = c.getBoundingClientRect(); return [r.width, r.height]; }));
  await tile('Meeting assistant').locator('.kit-card-main').click();
  await count('Research assistant', '2 tools').click();
  await animationsDone(p);
  const after = await tiles().evaluateAll(list => list.map(c => { const r = c.getBoundingClientRect(); return [r.width, r.height]; }));
  expect(after).toEqual(before);
});

// ---- Counts open a tray.
test('a count opens a tray under its tile\'s row, as wide as the row, and pushes the later rows down; the same count closes it', async () => {
  const p = page();
  // The navigation takes 232 px, so the map holds three columns from 1440 px (it held three at 1280 before).
  await resize(p, 1440, 900);
  const button = count('Interview notetaker', '4 skills');
  await expect(button).toHaveAttribute('aria-expanded', 'false'); await expect(button).toHaveAttribute('aria-controls', /^tray-agent-\d+-skill$/);
  const tray = await trayFor(button);
  await expect(tray).toHaveAttribute('inert', '');
  const rowTiles = await tiles().evaluateAll(list => list.slice(0, 3).map(c => c.getBoundingClientRect().bottom)), grid = await boxOf(p.locator('.hm-grid'));
  const money = await boxOf(tile('Money tracker'));
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true'); await expect(tray).toHaveAttribute('data-open', ''); await expect(tray).not.toHaveAttribute('inert', '');
  await animationsDone(p);
  const body = await boxOf(tray.locator('.kit-tray-body'));
  const rowBottom = Math.max(...rowTiles);
  expect(body.y, 'the tray starts under the row of its tile').toBeGreaterThanOrEqual(rowBottom); expect(body.y - rowBottom, 'and close to it').toBeLessThanOrEqual(16);
  expect(Math.abs(body.x - grid.x)).toBeLessThanOrEqual(1);
  expect(body.w, 'as wide as the grid of the row').toBeGreaterThanOrEqual(3 * TILE.w + 2 * 14 - 2);
  const pushed = await boxOf(tile('Money tracker'));
  expect(pushed.y - money.y, 'the later rows move down by the tray').toBeGreaterThanOrEqual(body.h);
  expect(await tray.locator('.kit-card[data-size="small"]').evaluateAll(list => list.map(c => Math.round(c.getBoundingClientRect().height)))).toEqual([ROW_H, ROW_H, ROW_H, ROW_H]);
  await expect(tile('Interview notetaker')).toHaveAttribute('data-tray', '');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false'); await animationsDone(p);
  await expect(tray).toHaveAttribute('inert', ''); await expect(trays()).toHaveCount(0);
  expect(Math.round((await boxOf(tile('Money tracker'))).y)).toBe(Math.round(money.y));
});

test('one tray is open at a time: opening another count closes the first, in the same row or another', async () => {
  const p = page();
  const a = count('Meeting assistant', '4 skills'), b = count('Meeting assistant', '1 tool'), c = count('Research assistant', '3 skills');
  await a.click(); await expect(trays()).toHaveCount(1); await expect(a).toHaveAttribute('aria-expanded', 'true');
  await b.click(); await expect(trays()).toHaveCount(1); await expect(a).toHaveAttribute('aria-expanded', 'false'); await expect(b).toHaveAttribute('aria-expanded', 'true');
  await c.click(); await expect(trays()).toHaveCount(1); await expect(b).toHaveAttribute('aria-expanded', 'false'); await expect(c).toHaveAttribute('aria-expanded', 'true');
  await animationsDone(p);
  expect(await p.locator('.kit-count[aria-expanded="true"]').count()).toBe(1);
  // Only the open tray can be reached: every other tray is inert and hidden.
  expect(await p.locator('.kit-tray:not([data-open])').evaluateAll(list => list.every(t => t.hasAttribute('inert') && getComputedStyle(t.querySelector('.kit-tray-inner')!).visibility === 'hidden'))).toBe(true);
});

test('a tray row selects its item and the details panel shows it; the tile keeps the highlight as the owner, and the tray stays open', async () => {
  const p = page();
  const button = count('Inbox sorter', '4 skills');
  await button.click(); await animationsDone(p);
  const tray = await trayFor(button);
  await tray.getByRole('button', { name: 'Sort mail by topic', exact: true }).click();
  await expect(panel().locator('#hm-panel-title')).toHaveText('Sort mail by topic');
  await expect(tile('Inbox sorter')).toHaveAttribute('data-owner', ''); await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(tray.getByRole('button', { name: 'Sort mail by topic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await expect(panel().locator('#hm-panel-title')).toHaveText('Inbox sorter');
});

test('a tray shows 12 rows and "Show more" after that; the counts are Tab stops and the rows are buttons', async () => {
  const p = page();
  const button = count('Writing coach', '5 skills');
  await button.focus(); await p.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const tray = await trayFor(button);
  expect(await tray.locator('.kit-card-main').count()).toBe(5);
  expect(await tray.locator('.kit-tray-more').count()).toBe(0);
  // The counts of the tile that has the keyboard are Tab stops (the counts of the other tiles are reached by the arrow keys).
  expect(await tile('Writing coach').locator('.kit-count').evaluateAll(list => list.every(b => b.tagName === 'BUTTON' && b.getAttribute('tabindex') === '0'))).toBe(true);
  expect(await tile('Money tracker').locator('.kit-count').evaluateAll(list => list.every(b => b.getAttribute('tabindex') === '-1'))).toBe(true);
  await p.keyboard.press('Space'); await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('with less motion a tray is open at once, and the sizes are the same', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await resize(p, 1280, 800); await skipTour(p);
  const button = count('Interview notetaker', '4 skills');
  await button.click();
  const body = await boxOf((await trayFor(button)).locator('.kit-tray-body'));
  expect(body.h, 'the tray has its whole height in the same frame as the click').toBeGreaterThan(40);
  expect(await tiles().evaluateAll(list => new Set(list.map(c => `${c.getBoundingClientRect().width}x${c.getBoundingClientRect().height}`)).size)).toBe(1);
});

test('every row, in a tray, the details panel, the Add drawer and Choose notes, is the same height', async () => {
  const p = page();
  const heights = async (scope: Locator): Promise<number[]> => scope.locator('.kit-card[data-size="small"]').evaluateAll(list => [...new Set(list.filter(c => c.getBoundingClientRect().height > 0).map(c => Math.round(c.getBoundingClientRect().height)))]);
  for (const [name, label] of [['Research assistant', '3 skills'], ['Research assistant', '2 tools'], ['Research assistant', '1 note set']] as const) {
    const b = count(name, label); await b.click(); await animationsDone(p);
    expect(await heights(await trayFor(b)), `${name} ${label}`).toEqual([ROW_H]);
  }
  await tile('Research assistant').locator('.kit-card-main').click();
  expect(await heights(panel())).toEqual([ROW_H]);
  await topBar('Add').click(); await animationsDone(p);
  for (const tab of ['Skills', 'Tools', 'Notes', 'Agents']) {
    await p.locator('[data-slot="add"]').getByRole('tab', { name: tab, exact: true }).click(); await animationsDone(p);
    expect(await heights(p.locator('[data-slot="add"]')), `Add: ${tab}`).toEqual([ROW_H]);
  }
  await p.keyboard.press('Escape');
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(p.getByRole('dialog', { name: /Choose notes/ })).toBeVisible(); await animationsDone(p);
  expect(await heights(p.getByRole('dialog', { name: /Choose notes/ }))).toEqual([ROW_H]);
});

test('a state is a dot and words, on the second line of its row at the right end, in a tray and in the panel; "2 different copies" is a text button that opens the dialog', async () => {
  const p = page();
  const b = count('Inbox sorter', '4 skills'); await b.click(); await animationsDone(p);
  const tray = await trayFor(b);
  const status = tray.locator('.kit-status', { hasText: '2 different copies' });
  await expect(status).toHaveCount(1); expect(await status.evaluate(e => e.tagName)).toBe('BUTTON');
  expect(await badStates()).toEqual([]);
  // The state is on the second line of its row, at the right end, under the name and in the same size of type as the hint it replaces; the row keeps its height.
  const line = await tray.locator('.kit-card', { has: p.locator('.kit-status', { hasText: '2 different copies' }) }).evaluate(card => {
    const c = card.getBoundingClientRect(), s = card.querySelector('.kit-status')!.getBoundingClientRect(), n = card.querySelector('.kit-card-main')!.getBoundingClientRect(), hint = card.querySelector('.kit-card-hint');
    return { h: c.height, below: s.top + s.height / 2 > n.bottom - 2, rightGap: c.right - s.right, size: getComputedStyle(card.querySelector('.kit-status')!).fontSize, hintShown: hint !== null && hint.getBoundingClientRect().width > 0 };
  });
  expect(line.h).toBe(ROW_H); expect(line.below, 'the state is on the second line').toBe(true); expect(line.rightGap, 'at the right end of the row').toBeLessThanOrEqual(24); expect(line.size).toBe('14px'); expect(line.hintShown, 'it replaces the hint, so it is never squeezed against it').toBe(false);
  await status.click();
  await expect(p.getByRole('dialog', { name: 'Two different copies' }).or(p.getByRole('dialog', { name: /different copies/ }))).toBeVisible();
  await p.keyboard.press('Escape');
});

// ---- Every screen, at both sizes and in both looks: nothing under 14 px, no pill, a state is a dot and words, targets, no overflow, and a screenshot.
interface Screen { name: string; go(p: Page): Promise<void> }
const toFind = async (p: Page): Promise<void> => { await fresh(p, undefined, { welcome: true }); await p.getByRole('button', { name: 'Find my agents' }).click(); await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible(); await animationsDone(p); };
const SCREENS: readonly Screen[] = [
  { name: 'map', go: async p => { await fresh(p); await skipTour(p); await expect(tiles()).toHaveCount(10); } },
  { name: 'tray-skills', go: async p => { await fresh(p); await skipTour(p); await count('Inbox sorter', '4 skills').click(); await animationsDone(p); } },
  { name: 'details-skill', go: async p => { await fresh(p); await skipTour(p); const b = count('Inbox sorter', '4 skills'); await b.click(); await animationsDone(p); await (await trayFor(b)).getByRole('button', { name: 'Sort mail by topic', exact: true }).click(); await animationsDone(p); } },
  { name: 'details-tool', go: async p => { await fresh(p); await skipTour(p); const b = count('Research assistant', '2 tools'); await b.click(); await animationsDone(p); await (await trayFor(b)).locator('.kit-card-main').first().click(); await animationsDone(p); } },
  { name: 'add-drawer', go: async p => { await fresh(p); await skipTour(p); await topBar('Add').click(); await expect(p.locator('[data-slot="add"]')).toBeVisible(); await animationsDone(p); } },
  { name: 'share-sheet', go: async p => { await fresh(p); await skipTour(p); await topBar('Version history').click(); await p.getByRole('button', { name: 'Share my agents' }).click(); await expect(p.getByRole('dialog', { name: 'Share my agents' })).toBeVisible(); await animationsDone(p); } },
  { name: 'choose-notes', go: async p => { await fresh(p); await skipTour(p); await panel().getByRole('button', { name: 'Choose notes' }).click(); await expect(p.getByRole('dialog', { name: /Choose notes/ })).toBeVisible(); await animationsDone(p); } },
  { name: 'copies-dialog', go: async p => { await fresh(p); await skipTour(p); await panel().getByRole('button', { name: /different copies/ }).first().click(); await expect(p.getByRole('dialog', { name: /different copies/ })).toBeVisible(); await animationsDone(p); } },
  { name: 'find', go: toFind },
  { name: 'welcome', go: async p => { await fresh(p, undefined, { welcome: true }); await expect(p.getByRole('button', { name: 'Find my agents' })).toBeVisible(); await animationsDone(p); } },
  { name: 'version-history', go: async p => { await fresh(p); await skipTour(p); await topBar('Version history').click(); await expect(p.locator('[data-slot="points"]')).toBeVisible(); await animationsDone(p); } },
  { name: 'tour-1', go: async p => { await fresh(p, undefined, { tour: true }); await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible(); await animationsDone(p); } },
  { name: 'tour-3', go: async p => { await fresh(p, undefined, { tour: true }); await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible(); await p.getByRole('button', { name: 'Next' }).click(); await tiles().first().locator('.kit-card-main').click(); await expect(p.getByRole('dialog', { name: 'Tour' }).getByText('3 of 7')).toBeVisible(); await animationsDone(p); } },
];

for (const [w, h] of SIZES_D) {
  for (const look of THEMES) {
    test(`at ${w} by ${h}, ${look}: on every screen no word is under 14 px, no pill is left, a state is a dot and words, and every target is 24 px or more`, async () => {
      test.setTimeout(180_000);
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      for (const screen of SCREENS) {
        await screen.go(p);
        await framesPainted(p);
        expect(await smallText(), `${screen.name}: words under 14 px`).toEqual([]);
        expect(await pills(), `${screen.name}: pills`).toEqual([]);
        expect(await badStates(), `${screen.name}: states`).toEqual([]);
        expect(await statesOverRemove(), `${screen.name}: a state and Remove`).toEqual([]);
        expect(await smallTargets(), `${screen.name}: targets`).toEqual([]);
        expect(await clippedWithoutDots(), `${screen.name}: clipped`).toEqual([]);
        expect(await overflowX(), `${screen.name}: sideways scroll`).toBeLessThanOrEqual(0);
        await shot(p, screen.name, w, h, look);
      }
    });
  }
}
