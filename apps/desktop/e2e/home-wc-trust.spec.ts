/**
 * Wave C, group 9, in the real window: the trust text, as plain and as honest as a preview can make it. The Preview popover says what the preview does and does not do; a tool
 * says what it reaches and whether it can only read or can change things; a skill from outside says who made it and which release it is; and each row of the Version history
 * shows the time the point was made, read from the computer's clock when it was saved, with how long ago in words as a second line.
 * Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { SAVED, ensurePicked, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;

let home: Home;
const page = (): Page => home.page;
const header = (): Locator => page().locator('header.hm-bar');
const panel = (): Locator => page().locator('aside.hm-panel');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const history = (): Locator => page().locator('[data-slot="points"]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const title = (): Locator => panel().locator('#hm-panel-title');
const shot = async (name: string, w: number, h: number, look: string): Promise<void> => { if (SHOTS === null) return; await animationsDone(page()); await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };
async function open(agent: string, line: string): Promise<void> {
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name: agent, exact: true }));
  await panel().getByRole('button', { name: line, exact: true }).click();
}

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('the Preview popover says what the preview sends, stores and writes, in at most 25 words', async () => {
  const p = page();
  await header().getByRole('button', { name: 'About this preview' }).click();
  const pop = p.locator('.kit-popover');
  await expect(pop.locator('p')).toHaveText('This is a preview. It sends nothing, stores nothing, and writes nothing to your computer.');
  expect(countWords(await pop.locator('p').innerText())).toBeLessThanOrEqual(25);
  await expect(pop.getByRole('button')).toHaveText(['How it will work']);
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('trust-preview', w, h, look); }
});

test('a tool says what it reaches and whether it can only read or can change things, from the Library\'s own facts', async () => {
  await open('Meeting assistant', 'Read my calendar');
  await expect(title()).toHaveText('Read my calendar');
  const block = panel().locator('section', { has: page().getByRole('heading', { level: 3, name: 'Reaches' }) });
  await expect(block).toBeVisible();
  await expect(block.locator('[data-reaches]')).toHaveText('calendar.example.com');
  // Wave E: a tool named "Read ..." can only read, wherever it is shown (it said it could change things).
  await expect(block.locator('[data-can]')).toHaveText('Can only read');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await panel().getByRole('button', { name: 'Remove from Meeting assistant' }).count();
  // A tool that only reads, and a saved prompt, which reaches nothing outside.
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name: 'Research assistant', exact: true }));
  const tools = await panel().getByRole('region', { name: 'Tools' }).locator('.kit-card-main').allInnerTexts();
  expect(tools.length).toBeGreaterThanOrEqual(1);
  await panel().getByRole('region', { name: 'Tools' }).locator('.kit-card-main').first().click();
  const reach = panel().locator('[data-reaches]');
  await expect(reach).toBeVisible();
  expect((await reach.innerText()).trim().length).toBeGreaterThan(3);
  await expect(panel().locator('[data-can]')).toHaveText(/^Can only read$|^Can change things$/);
  expect(await panel().innerText()).not.toMatch(/\/Users\/|\.json|\.md\b/);
  expect(await budget()).toEqual([]);
});

test('a skill from outside says who made it and which release it is; a skill of the person\'s own says only that it is theirs', async () => {
  const p = page();
  await open('Meeting assistant', 'Tidy my meeting notes');
  await expect(title()).toHaveText('Tidy my meeting notes');
  const facts = panel().locator('[data-origin]');
  await expect(facts.locator('dt')).toHaveText(['Made by', 'Release']);
  await expect(facts.locator('[data-field="author"]')).toHaveText('Priya Raman');
  await expect(facts.locator('[data-field="release"]')).toHaveText('v1.2');
  await expect(panel().getByText('Open skills library', { exact: true })).toBeVisible();
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('trust-skill', w, h, look); }
  await resize(p, 1280, 800); await setLook(p, 'light');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await panel().getByRole('button', { name: 'Write a reply', exact: true }).click();
  await expect(title()).toHaveText('Write a reply');
  await expect(panel().locator('[data-origin]')).toHaveCount(0);
  await expect(panel().getByText('Made by you', { exact: true })).toBeVisible();
});

test('each point of the Version history has the time it was made from the clock, and how long ago as a second line', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }));
  const before = new Date();
  await panel().getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  const after = new Date();
  await panel().getByRole('button', { name: 'Remove List action items' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await header().getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(history()).toBeVisible();
  const rows = history().locator('.pt-row');
  await expect(rows).toHaveCount(3);
  // The newest first: a time, "just now", and what changed. The first of all has no time (the session started with it) and says "when you began".
  const clock = rows.nth(0).locator('[data-clock]');
  await expect(clock).toHaveText(/^Today, \d{1,2}:\d{2}(?: ?[AP]M)?$/);
  await expect(rows.nth(0).locator('.pt-when')).toHaveText('just now');
  await expect(rows.nth(1).locator('[data-clock]')).toHaveText(/^Today, \d{1,2}:\d{2}(?: ?[AP]M)?$/);
  await expect(rows.nth(1).locator('.pt-when')).toHaveText('1 save ago');
  await expect(rows.nth(2).locator('[data-clock]')).toHaveCount(0);
  await expect(rows.nth(2).locator('.pt-when')).toHaveText('when you began');
  // The time is the computer's own: it is between the moment before the first Save and now, to the minute.
  const text = (await rows.nth(1).locator('[data-clock]').innerText()).replace(/^Today, /, '');
  const parse = (d: Date): string => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/[  ]/g, ' ');
  expect([parse(before), parse(after), parse(new Date(before.getTime() - 60_000)), parse(new Date(after.getTime() + 60_000))]).toContain(text);
  // The line under the name is the clock, then the words, then what changed: in that order.
  const order = await rows.nth(0).locator('.pt-text > *').evaluateAll(list => list.map(el => el.className.split(' ')[0]));
  expect(order.slice(0, 3)).toEqual(['pt-name', 'pt-clock', 'kit-hint']);
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('trust-history', w, h, look); }
});

test('going back to a point makes a point with its own time, and the time is not stored in the saved copies themselves', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }));
  await panel().getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await bar().getByRole('button', { name: 'Go back' }).click();
  await header().getByRole('button', { name: 'Version history', exact: true }).click();
  const rows = history().locator('.pt-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('[data-clock]')).toHaveText(/^Today, /);
  await expect(rows.nth(0).locator('.pt-name')).toContainText('Went back to');
  // Nothing about the clock is in the text that a share file holds.
  const stored = await p.evaluate(() => document.documentElement.outerHTML.includes('madeAt'));
  expect(stored).toBe(false);
});
