/**
 * Wave E, group D, in the real window (Electron started with --home-sample): "Already included" follows every switch of Choose notes and its numbers (each topic,
 * the notes picked by hand, and what comes from older handles) add up to the preview's total exactly; there is one such line and one "What is included" list, never a
 * stale second copy; and the open "Leave out" panel lies over the cards under it and leaves no hole in the grid.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const layer = (): Locator => page().locator('[data-slot="notes"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const already = (): Locator => layer().locator('[data-already]');
const topic = (name: string): Locator => layer().getByRole('button', { name, exact: true });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const total = async (): Promise<number> => Number(await layer().locator('.nt-big').getAttribute('data-count'));
/** Every number in the line: "Already included: Clients (86), Company (18) and 2 picked by hand." is 86, 18, 2. */
const numbersOf = (text: string): number[] => [...text.matchAll(/\((\d+)\)|\b(\d+) (?:from before|picked by hand|notes in all)/g)].map(m => Number(m[1] ?? m[2]));
const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);
async function openFor(agent: string): Promise<void> {
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name: agent, exact: true }));
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(layer()).toBeVisible();
  await animationsDone(page());
}
/** The line and the preview agree: the numbers of the line add up to the number of the preview, whatever the person switched. */
async function agree(): Promise<void> {
  const n = await total();
  if (n === 0) { await expect(already()).toHaveCount(0); return; }
  await expect(already()).toHaveCount(1);
  expect(sum(numbersOf(await already().innerText())), await already().innerText()).toBe(n);
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('"Already included" follows each topic that is switched on or off, and always adds up to the total of the preview', async () => {
  await openFor('Meeting assistant');
  await expect(already()).toHaveText('Already included: Clients (86) and Company (18).');
  await agree();
  await topic('Meetings').click();
  await expect(already()).toContainText('Meetings (114)');
  await expect(already()).toContainText('Clients (86)');
  await agree();
  expect(await total()).toBe(104 + 114);
  await topic('Clients').click();
  await expect(already()).not.toContainText('Clients');
  await agree();
  // The two notes this agent's older choice named one by one are still there when the topics go: they are counted by hand, and the line says so.
  await topic('Company').click(); await topic('Meetings').click();
  await expect(already()).toHaveText('Already included: 2 picked by hand.');
  expect(await total()).toBe(2);
  await agree();
  await topic('Travel').click(); await topic('Money').click(); await topic('Writing').click(); await topic('Work').click(); await topic('Research').click();
  await agree();
  expect(await budget()).toEqual([]);
});

test('an agent that reads nothing gets the line as soon as something is switched on, and loses it when everything is off', async () => {
  await openFor('Report builder');
  await expect(already()).toHaveCount(0);
  await topic('Clients').click();
  await expect(already()).toHaveText('Already included: Clients (86).');
  await agree();
  await topic('Clients').click();
  await expect(already()).toHaveCount(0);
  await agree();
});

test('notes picked one by one are part of the sum and are shown: "and 2 picked by hand"', async () => {
  const p = page();
  await openFor('Meeting assistant');
  await layer().getByRole('button', { name: 'Choose one by one' }).click();
  await layer().getByRole('button', { name: 'Money', exact: true }).click();
  const rows = layer().locator('.nt-row');
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  await expect(already()).toHaveText('Already included: Clients (86), Company (18) and 2 picked by hand.');
  await agree();
  expect(await total()).toBe(106);
  await rows.nth(1).getByRole('checkbox').uncheck();
  await expect(already()).toHaveText('Already included: Clients (86), Company (18) and 1 picked by hand.');
  await agree();
  await layer().getByRole('button', { name: 'Done picking' }).click();
  await agree();
  // A note that a topic already holds is not counted twice: switch Money on and the hand pick joins its topic.
  await topic('Money').click();
  await expect(already()).toContainText('Money (');
  await expect(already()).not.toContainText('picked by hand');
  await agree();
  expect(await budget()).toEqual([]);
});

test('one line of what is included and one list of "What is included": no stale second copy', async () => {
  const p = page();
  await openFor('Meeting assistant');
  const count = async (): Promise<{ lines: number; headings: number; bigs: number }> => ({
    lines: await layer().locator('.nt-already').count(), headings: await layer().getByRole('heading', { name: 'What is included' }).count(), bigs: await layer().locator('.nt-big').count(),
  });
  expect(await count()).toEqual({ lines: 1, headings: 1, bigs: 1 });
  await topic('Travel').click();
  await layer().getByRole('button', { name: 'Choose one by one' }).click();
  expect(await count()).toEqual({ lines: 1, headings: 1, bigs: 1 });
  await layer().getByRole('button', { name: 'All topics' }).click();
  await topic('Travel').click(); await topic('Clients').click(); await topic('Company').click();
  expect(await count()).toEqual({ lines: 1, headings: 1, bigs: 1 });
  // The words of the list follow the same switches as the line.
  await expect(already()).toHaveText('Already included: 2 picked by hand.');
  expect(await layer().locator('.nt-lines li').allTextContents()).toEqual(['2 notes picked by hand.']);
  await topic('Meetings').click();
  expect(await layer().locator('.nt-lines li').allTextContents()).toEqual(['All notes about Meetings.', '2 notes picked by hand.']);
  await expect(already()).toContainText('Meetings (114)');
  await expect(already()).toContainText('2 picked by hand');
  void p;
  await atEverySize(p, 'notes-already-included', async () => { /* the sheet stays as it is */ });
});

test('"Leave out" opens a panel over the cards under it: nothing moves, no card leaves a hole, and it closes without a trace', async () => {
  const p = page();
  await openFor('Report builder');
  await topic('Clients').click();
  const boxes = async (): Promise<string> => JSON.stringify(await layer().locator('.nt-topic').evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })));
  const before = await boxes();
  // Every card of the grid has the same height, so a card that is on has no row to grow into and a card that is off leaves no hole.
  const heights = await layer().locator('.nt-topic').evaluateAll(list => [...new Set(list.map(el => Math.round(el.getBoundingClientRect().height)))]);
  expect(heights).toHaveLength(1);
  await layer().getByRole('button', { name: 'Leave out of Clients' }).click();
  const group = layer().getByRole('group', { name: 'Leave out of Clients' });
  await expect(group).toBeVisible();
  await animationsDone(p);
  expect(await boxes(), 'the grid does not move while the panel is open').toBe(before);
  const geometry = await group.evaluate(el => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const style = getComputedStyle(el), under = document.elementFromPoint(cx, cy);
    return { position: style.position, zIndex: style.zIndex, onTop: under !== null && el.contains(under), covers: [...document.querySelectorAll('.nt-topic')].filter(c => { const b = c.getBoundingClientRect(); return b.top < r.bottom && b.bottom > r.top && b.left < r.right && b.right > r.left; }).length };
  });
  expect(geometry.position).toBe('absolute');
  expect(geometry.onTop).toBe(true);
  expect(geometry.covers, 'the panel lies over at least one card under it').toBeGreaterThanOrEqual(1);
  await atEverySize(p, 'notes-leave-out-open');
  await p.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  expect(await boxes()).toBe(before);
  expect(await budget()).toEqual([]);
});
