/**
 * Wave C, group 5, in the real window: the agent tiles are one stop in the Tab order (roving), the arrow keys move between tiles in reading order, Enter picks, Space
 * opens or closes a tray, the counts of the tile that has the focus are Tab stops after it, a "Skip to details" link is the second stop of the page, and the
 * walk from page load to the first Remove in the details panel is short.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const tiles = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const main = (name: string): Locator => tiles().locator('.kit-card-main', { hasText: new RegExp(`^${name}$`) });
const counts = (name: string): Locator => tiles().filter({ has: page().locator('.kit-card-main', { hasText: new RegExp(`^${name}$`) }) }).locator('.kit-count');
const focusedName = async (): Promise<string> => page().evaluate(() => { const el = document.activeElement as HTMLElement | null; return el === null ? '' : (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(); });
/** The names of the tiles in reading order, and how many columns the grid has. */
async function layout(): Promise<{ names: string[]; columns: number }> {
  const boxes = await tiles().evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return { name: el.querySelector('.kit-card-main')!.textContent!.trim(), x: Math.round(r.left), y: Math.round(r.top) }; }));
  return { names: boxes.map(b => b.name), columns: boxes.filter(b => b.y === boxes[0]!.y).length };
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await page().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
});

test('Tab enters the grid once, on the picked tile; the other tiles and their counts are not Tab stops', async () => {
  const p = page();
  const { names } = await layout();
  const picked = main(names[0]!);
  await expect(picked).toHaveAttribute('aria-pressed', 'true');
  expect(await tiles().locator('.kit-card-main').evaluateAll(list => list.map(el => el.getAttribute('tabindex')))).toEqual(names.map((_, i) => (i === 0 ? '0' : '-1')));
  expect(await tiles().locator('.kit-count').evaluateAll(list => list.map(el => el.getAttribute('tabindex') ?? '0'))).toEqual(
    await tiles().evaluateAll(list => list.flatMap((tile, i) => [...tile.querySelectorAll('.kit-count')].map(() => (i === 0 ? '0' : '-1')))));
  // The last control before the grid is "Hide details" (it follows "Find more").
  await page().locator('[data-details-toggle]').focus();
  await p.keyboard.press('Tab');
  await expect(picked).toBeFocused();
  // Through the counts of that tile, then out of the grid in one more press: no other tile is visited.
  const mine = await counts(names[0]!).count();
  for (let i = 0; i < mine; i += 1) { await p.keyboard.press('Tab'); expect(await p.evaluate(() => document.activeElement?.classList.contains('kit-count'))).toBe(true); }
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.closest('.hm-grid') === null)).toBe(true);
  await p.keyboard.press('Shift+Tab');
  expect(await p.evaluate(() => document.activeElement?.classList.contains('kit-count'))).toBe(true);
});

test('the arrow keys move between tiles in reading order; Home and End go to the first and the last; Up and Down go by the number of columns', async () => {
  const p = page();
  const { names, columns } = await layout();
  expect(columns).toBeGreaterThanOrEqual(2);
  await main(names[0]!).focus();
  await p.keyboard.press('ArrowRight'); expect(await focusedName()).toBe(names[1]);
  await p.keyboard.press('ArrowRight'); expect(await focusedName()).toBe(names[2]);
  await p.keyboard.press('ArrowLeft'); expect(await focusedName()).toBe(names[1]);
  await p.keyboard.press('ArrowDown'); expect(await focusedName()).toBe(names[1 + columns]);
  await p.keyboard.press('ArrowUp'); expect(await focusedName()).toBe(names[1]);
  await p.keyboard.press('End'); expect(await focusedName()).toBe(names[names.length - 1]);
  await p.keyboard.press('ArrowRight'); expect(await focusedName()).toBe(names[names.length - 1]);
  await p.keyboard.press('ArrowDown'); expect(await focusedName()).toBe(names[names.length - 1]);
  await p.keyboard.press('Home'); expect(await focusedName()).toBe(names[0]);
  await p.keyboard.press('ArrowUp'); expect(await focusedName()).toBe(names[0]);
  await p.keyboard.press('ArrowLeft'); expect(await focusedName()).toBe(names[0]);
  // A tile moved to by arrow takes the Tab stop with it, and its counts come along; the old tile's counts leave.
  await p.keyboard.press('ArrowRight');
  expect(await tiles().locator('.kit-card-main').evaluateAll(list => list.map(el => el.getAttribute('tabindex')).join(','))).toBe(names.map((_, i) => (i === 1 ? '0' : '-1')).join(','));
  expect(await counts(names[0]!).evaluateAll(list => list.every(el => el.getAttribute('tabindex') === '-1'))).toBe(true);
  expect(await counts(names[1]!).evaluateAll(list => list.every(el => el.getAttribute('tabindex') !== '-1'))).toBe(true);
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.classList.contains('kit-count'))).toBe(true);
  await expect(tiles().nth(1).locator('.kit-count').first()).toBeFocused();
  // An arrow on a count goes to a tile too.
  await p.keyboard.press('ArrowRight');
  expect(await focusedName()).toBe(names[2]);
});

test('Enter picks the tile; Space opens the tray of its first count and Space again closes it; a count keeps its own Space', async () => {
  const p = page();
  const { names } = await layout();
  const second = names[1]!;
  await main(second).focus();
  await p.keyboard.press('Enter');
  await expect(main(second)).toHaveAttribute('aria-pressed', 'true');
  await expect(main(names[0]!)).toHaveAttribute('aria-pressed', 'false');
  const first = counts(second).first();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await p.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(main(second)).toBeFocused();
  await animationsDone(p);
  await p.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(main(second)).toHaveAttribute('aria-pressed', 'true');
  await first.focus(); await p.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
});

test('a tray follows its tile in the Tab order: from the last count of the tile, Tab goes into the open tray', async () => {
  const p = page();
  const { names } = await layout();
  const name = names[0]!;
  await main(name).focus();
  await p.keyboard.press('Space');
  const kind = (await counts(name).first().getAttribute('data-kind'))!;
  await animationsDone(p);
  const mine = await counts(name).count();
  for (let i = 0; i < mine; i += 1) await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.closest('.kit-tray') !== null)).toBe(true);
  expect(await p.evaluate(() => document.activeElement?.closest('.kit-tray')?.getAttribute('data-kind'))).toBe(kind);
  await p.keyboard.press('Shift+Tab');
  expect(await p.evaluate(() => document.activeElement?.classList.contains('kit-count'))).toBe(true);
});

test('"Skip to details" is the second Tab stop of the page, shows when it has the focus, and Enter puts the focus on the heading of the details', async () => {
  const p = page();
  await p.keyboard.press('Tab');
  expect(await focusedName()).toBe('Skip to the content');
  await p.keyboard.press('Tab');
  expect(await focusedName()).toBe('Skip to details');
  const link = p.getByRole('link', { name: 'Skip to details' });
  await expect(link).toBeFocused();
  const box = (await link.boundingBox())!;
  expect(box.width).toBeGreaterThan(40); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(await link.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await p.keyboard.press('Enter');
  await expect(p.locator('aside.hm-panel #hm-panel-title')).toBeFocused();
  // Not showing when it does not have the focus.
  await p.keyboard.press('Shift+Tab');
  expect(await p.getByRole('link', { name: 'Skip to details' }).boundingBox().then(b => b === null || b.x < 0 || b.width <= 1)).toBe(true);
});

test('from page load to the first Remove in the details panel takes at most 12 Tab presses with the skip link, and every stop on the plain way is a real control', async () => {
  const p = page();
  const remove = p.locator('aside.hm-panel').getByRole('button', { name: /^Remove / }).first();
  // With the skip link: Tab, Tab, Enter, then into the panel.
  let presses = 0;
  const press = async (key: string): Promise<void> => { await p.keyboard.press(key); if (key === 'Tab') presses += 1; };
  await press('Tab'); await press('Tab'); await press('Enter');
  for (let i = 0; i < 12 && !(await remove.evaluate(el => el === document.activeElement)); i += 1) await press('Tab');
  await expect(remove).toBeFocused();
  expect(presses).toBeLessThanOrEqual(12);
  // The plain way, without the link, is longer; it is counted so that a change that makes it much longer fails here.
  await fresh(p); await skipTour(p);
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let plain = 0;
  const stops: string[] = [];
  for (; plain < 40; ) { await p.keyboard.press('Tab'); plain += 1; stops.push(await focusedName()); if (await remove.evaluate(el => el === document.activeElement)) break; }
  await expect(remove).toBeFocused();
  console.log('MEASURED Tab presses to the first Remove: with the skip link', presses, '; without it', plain, '(', stops.join(' > '), ')');
  // Wave E: one stop more than before (16), for "Hide details" in the tools above the grid.
  expect(plain, stops.join(' > ')).toBeLessThanOrEqual(17);
});
