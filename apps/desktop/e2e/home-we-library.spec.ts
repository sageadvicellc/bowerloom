/**
 * Wave E, group A (and the source lines of group G), in the real window (Electron started with --prototype-v2, on the Library test page): the "Not used yet"
 * switch with its count, the third order "Most used", search that also finds the words of a status, a row that is not used keeps its hint and the height of
 * every other row and shows its status as grey words with a grey dot, the note that explains the count on the Agents tab, no bare "?" next to the title, and a
 * source line under every card of the Add drawer.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { MAP_PAGE, chooseSort, expectSort, fresh, launchHome, openSort, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

const LIBRARY_PAGE = '#prototype-v2/library';
let home: Home;
const page = (): Page => home.page;
const rows = (): Locator => page().locator('.lb-row');
const tab = (name: string): Locator => page().getByRole('tab', { name: new RegExp(`^${name} \\d+$`) });
const countLine = (): Locator => page().locator('[data-count]');
const filter = (): Locator => page().locator('[data-filter-unused]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const row = (name: string): Locator => rows().filter({ has: page().getByRole('button', { name, exact: true }) });

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), LIBRARY_PAGE);
  await resize(page(), 1280, 800);
  await page().waitForSelector('[data-library]');
});

test('"Not used yet" is a quiet switch beside the sort with the number of things nobody uses, and it keeps only those', async () => {
  const p = page();
  await expect(filter()).toHaveAttribute('aria-pressed', 'false');
  const label = (await filter().textContent())!.trim();
  const n = Number(/(\d+)$/.exec(label)![1]);
  expect(label).toMatch(/^Not used yet \d+$/);
  expect(n).toBeGreaterThanOrEqual(20);
  await expect(rows()).toHaveCount(53);
  await filter().click();
  await expect(filter()).toHaveAttribute('aria-pressed', 'true');
  await expect(rows()).toHaveCount(n);
  await expect(countLine()).toHaveText(`${n} of 53 skills`);
  await expect(row('Translate a text')).toBeVisible();
  await expect(row('Compare two options')).toHaveCount(0);
  for (const text of await rows().locator('[data-used] .lb-used-note').allTextContents()) expect(text.trim()).toBe('Not used yet');
  // It sits in the same line as the sort, and the sort has its third button.
  const toggleBox = await filter().boundingBox(), sortBox = await p.getByRole('button', { name: 'Sort', exact: true }).boundingBox();
  expect(Math.abs((toggleBox!.y + toggleBox!.height / 2) - (sortBox!.y + sortBox!.height / 2))).toBeLessThan(6);
  const menu = await openSort(p);
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Name', 'Recently added', 'Most used']);
  await p.keyboard.press('Escape');
  // Together with a search, and off again.
  await p.getByRole('searchbox', { name: 'Search the library' }).fill('translate');
  await expect(rows()).toHaveCount(1);
  await p.getByRole('searchbox', { name: 'Search the library' }).fill('');
  await filter().click();
  await expect(filter()).toHaveAttribute('aria-pressed', 'false');
  await expect(rows()).toHaveCount(53);
  expect(await budget()).toEqual([]);
});

test('"Most used" puts the skills that most agents hold first', async () => {
  const p = page();
  await chooseSort(p, 'Most used');
  await expectSort(p, 'Most used');
  const counts = (await rows().locator('[data-used] .lb-used-note').allTextContents()).map(t => Number(/Used by (\d+)/.exec(t)?.[1] ?? 0));
  expect(counts[0]).toBeGreaterThanOrEqual(3);
  expect([...counts].sort((a, b) => b - a)).toEqual(counts);
});

test('search also finds the words of a status', async () => {
  const p = page(), search = p.getByRole('searchbox', { name: 'Search the library' });
  await search.fill('not used');
  await expect(row('Translate a text')).toBeVisible();
  await expect(row('Compare two options')).toHaveCount(0);
  await tab('Tools').click();
  await search.fill('needs a key');
  await expect(rows()).toHaveCount(1);
  await expect(row('Read my calendar')).toBeVisible();
  await search.fill('runs code');
  await expect(row('Run a check after editing')).toBeVisible();
  await tab('Skills').click();
  await search.fill('copies');
  await expect(row('Sort mail by topic')).toBeVisible();
});

test('a row that is not used keeps its hint, has the height of every other row, and shows grey words with a grey dot, never a green one', async () => {
  const p = page();
  const heights = await rows().evaluateAll(els => [...new Set(els.map(el => Math.round(el.getBoundingClientRect().height)))]);
  expect(heights).toHaveLength(1);
  const idle = row('Translate a text'), busy = row('Compare two options');
  await expect(idle.locator('.kit-card-hint')).toBeVisible();
  await expect(idle.locator('.kit-card-hint')).not.toHaveText('');
  const slot = async (r: Locator): Promise<{ dot: string; text: string; accent: string; muted: string }> => r.locator('[data-used]').evaluate(el => {
    const dot = el.querySelector('.lb-dot')!, root = getComputedStyle(document.querySelector('[data-home]')!);
    const probe = document.createElement('i'); probe.style.color = root.getPropertyValue('--accent-strong'); document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.style.color = root.getPropertyValue('--text-muted'); const muted = getComputedStyle(probe).color; probe.remove();
    return { dot: getComputedStyle(dot).backgroundColor, text: getComputedStyle(el).color, accent, muted };
  });
  const a = await slot(idle), b = await slot(busy);
  expect(a.dot).toBe(a.text);
  expect(a.dot).toBe(a.muted);
  expect(a.dot).not.toBe(a.accent);
  expect(b.dot).toBe(b.muted);
  // "Not used yet" and "Used by N agents" sit in the same place of the row.
  const yA = (await idle.locator('[data-used] .lb-used-note').boundingBox())!, yB = (await busy.locator('[data-used] .lb-used-note').boundingBox())!;
  expect(Math.abs((yA.y - (await idle.boundingBox())!.y) - (yB.y - (await busy.boundingBox())!.y))).toBeLessThan(2);
  expect(Math.abs(yA.x - (await idle.boundingBox())!.x - (yB.x - (await busy.boundingBox())!.x))).toBeLessThan(2);
  // A hook has a state of its own words and is not counted as unused.
  await tab('Tools').click();
  await expect(row('Run a check after editing').locator('[data-used]')).toContainText('Runs on its own');
  await expect(p.locator('.lb-list').getByText('Runs code').first()).toBeVisible();
});

test('every row shows where it came from, at the right of the line under its card', async () => {
  const p = page();
  await expect(row('Summarize a meeting').locator('.lb-used-source')).toHaveText('Made by you');
  await expect(row('Compare two options').locator('.lb-used-source')).toHaveText('Open skills library');
  await tab('Agents').click();
  const sources = await rows().locator('.lb-used-source').allTextContents();
  expect(sources.every(t => t.trim() !== '')).toBe(true);
  void p;
});

test('the Agents tab explains its count: Yours and Ready-made, and a one-line note', async () => {
  const p = page();
  await expect(tab('Agents')).toHaveText(/Agents\s*16/);
  await tab('Agents').click();
  await expect(p.locator('[data-agents-note]')).toHaveText('Yours 10 · Ready-made 6. Ready-made agents come with Bowerloom.');
  await expect(rows()).toHaveCount(16);
  const ready = await rows().locator('[data-used] .lb-used-note').filter({ hasText: 'Ready-made' }).count();
  expect(ready).toBe(6);
  // There is no filter and no "Most used" on the agents, which nobody uses.
  await expect(filter()).toHaveCount(0);
  await expect((await openSort(p)).getByRole('menuitemradio', { name: 'Most used' })).toHaveCount(0);
  await p.keyboard.press('Escape');
  await tab('Skills').click();
  await expect(p.locator('[data-agents-note]')).toHaveCount(0);
  expect(await budget()).toEqual([]);
});

test('the page has no bare "?" next to the title: the tip is a line of text, at both review sizes', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(p.locator('.lb-title-line button')).toHaveCount(0);
  for (const [w, h] of [[1280, 800], [900, 600]] as const) {
    await resize(p, w, h);
    await expect(p.getByText('Everything you own is here, even what no agent uses.')).toBeVisible();
  }
});

test('screenshots: the Library with the filter on', async () => {
  const p = page();
  await filter().click();
  await expect(filter()).toHaveAttribute('aria-pressed', 'true');
  await atEverySize(p, 'library-filter-on');
});

test('each card of the Add drawer shows where it came from', async () => {
  const p = page();
  await fresh(p, MAP_PAGE);
  await skipTour(p);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  const list = p.locator('.add-list');
  await expect(list).toBeVisible();
  const sources = await list.locator('.add-row-source').allTextContents();
  const cards = await list.locator('.add-row').count();
  expect(sources).toHaveLength(cards);
  expect(sources.every(t => t.trim() !== '')).toBe(true);
  expect(sources).toContain('Made by you');
  expect(sources).toContain('Open skills library');
  for (const name of ['Tools', 'Notes', 'Agents'] as const) {
    await p.getByRole('tablist', { name: 'What to add' }).getByRole('tab', { name, exact: true }).click();
    const here = await p.locator('.add-list .add-row').count(), said = await p.locator('.add-list .add-row-source').allTextContents();
    expect(said).toHaveLength(here);
  }
  expect(await budget()).toEqual([]);
});
