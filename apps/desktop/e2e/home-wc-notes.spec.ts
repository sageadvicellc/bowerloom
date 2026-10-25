/**
 * Wave C, group 6, in the real window: "Choose notes" says what the agent already reads before any change ("Already included: Clients (86) and Company (18)."), with the
 * numbers adding up to the preview; the "Kept from before" card is in sight when there is such a choice; switching a topic on moves nothing (the room for "Leave out" is kept);
 * and the shelf and the Save bar name a set of notes by up to three of its topics. Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600.
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
const layer = (): Locator => page().locator('[data-slot="notes"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const barText = (): Locator => bar().locator('.hm-savebar-state > p');
const already = (): Locator => layer().locator('[data-already]');
const topic = (name: string): Locator => layer().getByRole('button', { name, exact: true });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const total = async (): Promise<number> => Number(await layer().locator('.nt-big').getAttribute('data-count'));
const shelfName = (): Locator => panel().locator('[data-notes-shelf] .kit-card-main').first();
async function openFor(agent: string): Promise<void> {
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name: agent, exact: true }));
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(layer()).toBeVisible();
  await animationsDone(page());
}
async function useNotes(): Promise<void> { await layer().getByRole('button', { name: 'Use these notes' }).click(); await expect(layer()).toHaveCount(0); }
/** Every number in the line, as a list: "Already included: Meetings (114), Travel (52) and 52 from before." is 114, 52, 52. */
const numbersOf = (text: string): number[] => [...text.matchAll(/\((\d+)\)|\b(\d+) (?:from before|picked by hand)/g)].map(m => Number(m[1] ?? m[2]));
const shot = async (name: string, w: number, h: number, look: string): Promise<void> => { if (SHOTS === null) return; await animationsDone(page()); await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('an agent that reads topics says which, with their counts, before any change; the numbers add up to the preview', async () => {
  const p = page();
  await openFor('Meeting assistant');
  await expect(already()).toHaveText('Already included: Clients (86) and Company (18).');
  expect(numbersOf(await already().innerText()).reduce((a, b) => a + b, 0)).toBe(await total());
  expect(await total()).toBe(104);
  await expect(layer().getByRole('button', { name: 'Use these notes' })).toBeDisabled();
  // The line is at the top of the topics, before them, and beside the preview.
  const [line, grid, big] = [(await already().boundingBox())!, (await layer().locator('.nt-topics').boundingBox())!, (await layer().locator('.nt-big').boundingBox())!];
  expect(line.y).toBeLessThan(grid.y); expect(line.x + line.width).toBeLessThanOrEqual(big.x + 1);
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('notes-already', w, h, look); }
});

test('an agent that reads notes chosen another way shows the "Kept from before" card and says how many notes that is, and the preview says the same number', async () => {
  await openFor('Research assistant');
  await expect(layer().locator('[data-topic="kept"]')).toBeVisible();
  await expect(layer().locator('[data-topic="kept"]').getByRole('button', { name: 'Kept from before' })).toHaveAttribute('aria-pressed', 'true');
  await expect(already()).toHaveText('Already included: 263 from before.');
  expect(await total()).toBe(263);
  expect(numbersOf(await already().innerText())).toEqual([263]);
  await layer().getByRole('button', { name: 'Cancel' }).click();
  await openFor('Writing coach');
  await expect(layer().locator('[data-topic="kept"]')).toBeVisible();
  // The three notes ticked one by one are counted by hand, the links that start from them are from before, and the two add up to the preview.
  await expect(already()).toHaveText(/^Already included: 3 picked by hand and \d+ from before\.$/);
  expect(numbersOf(await already().innerText()).reduce((a, b) => a + b, 0)).toBe(await total());
});

test('after a topic is added to a choice that was made another way, the line lists the topic and what is from before, and the numbers still add up', async () => {
  await openFor('Writing coach');
  const before = numbersOf(await already().innerText()).reduce((a, b) => a + b, 0);
  await topic('Travel').click();
  await useNotes();
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(layer()).toBeVisible();
  await animationsDone(page());
  const line = await already().innerText();
  expect(line).toMatch(/^Already included: Travel \(\d+\), 3 picked by hand and \d+ from before\.$/);
  const [travel, hand, rest] = numbersOf(line) as [number, number, number];
  expect(travel + hand + rest).toBe(await total());
  expect(hand + rest).toBeLessThanOrEqual(before);
  expect(await budget()).toEqual([]);
});

test('an agent that reads nothing says nothing about what is included, and ticking a topic moves no card', async () => {
  const p = page();
  await openFor('Report builder');
  await expect(already()).toHaveCount(0);
  const tops = async (): Promise<number[]> => layer().locator('.nt-topic').evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().top * 10) / 10));
  const heights = async (): Promise<number[]> => layer().locator('.nt-topic').evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().height * 10) / 10));
  const start = await tops(), tall = await heights();
  expect(start.length).toBeGreaterThanOrEqual(8);
  // A topic with parts keeps the room of its "Leave out" row whether it is on or not.
  await topic('Clients').click();
  await animationsDone(p);
  expect(await tops(), 'switching a topic on moves nothing').toEqual(start);
  expect(await heights()).toEqual(tall);
  await topic('Meetings').click(); await topic('Work').click();
  await animationsDone(p);
  expect(await tops()).toEqual(start);
  await topic('Clients').click(); await topic('Meetings').click(); await topic('Work').click();
  await animationsDone(p);
  expect(await tops(), 'and neither does switching them off').toEqual(start);
  await shot('notes-no-shift', 1280, 800, 'light');
});

test('a set of notes is named by up to three of its topics on its shelf and on the Save bar, then by the first and a count', async () => {
  await openFor('Report builder');
  await topic('Meetings').click(); await topic('Clients').click(); await topic('Travel').click();
  await useNotes();
  await expect(shelfName()).toHaveText('Meetings, Clients and Travel notes');
  await expect(barText()).toHaveText('Added Meetings, Clients and Travel notes to Report builder');
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(layer()).toBeVisible(); await animationsDone(page());
  await expect(already()).toHaveText(/^Already included: Meetings \(114\), Clients \(86\) and Travel \(55\)\.$/);
  await topic('Money').click();
  await useNotes();
  await expect(shelfName()).toHaveText('Meetings and 3 more notes');
  expect(await budget()).toEqual([]);
});
