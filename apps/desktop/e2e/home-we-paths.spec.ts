/**
 * Wave E, group H, in the real window (Electron started with --prototype-v2): the details of an agent, a skill and a tool, on the map and on the Library page, have a quiet
 * "Show where it lives" (closed, with aria-expanded) that lists one sample path for each program that holds the thing, from the sample world's folders and never this
 * machine's; "Copy path" puts the path on the clipboard and says "Copied"; and if the window will not let the page copy, the path is selected and the line says so.
 * Set HOME_WE_SHOTS to a folder to also save the screenshot "path disclosure open".
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { homedir } from 'node:os';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const panel = (): Locator => page().locator('aside.hm-panel');
const disclosure = (): Locator => panel().getByRole('button', { name: /^(Show|Hide) where it lives$/ });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const clipboard = async (): Promise<string> => home.app.evaluate(({ clipboard: c }) => c.readText());
const agent = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await home.app.evaluate(({ clipboard: c }) => c.writeText('before'));
});

test('an agent has "Show where it lives", closed; opened it lists one sample path for each program, from the sample world and not from this machine', async () => {
  const p = page();
  await ensurePicked(agent('Inbox sorter'));
  await expect(disclosure()).toHaveText('Show where it lives');
  await expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
  await expect(panel().locator('[data-places]')).toHaveCount(0);
  await disclosure().click();
  await expect(disclosure()).toHaveText('Hide where it lives');
  await expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
  const rows = panel().locator('.dt-place');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
  const apps = await rows.locator('.dt-place-app').allTextContents();
  expect(new Set(apps).size).toBe(count);
  for (const path of await rows.locator('.dt-path').allTextContents()) {
    expect(path).toMatch(/^~\/Studio\/\.(claude|codex|opencode)\/agents\/inbox-sorter\.(md|toml)$/);
    expect(path).not.toContain('/Users/');
    if (homedir().length > 1) expect(path).not.toContain(homedir());
  }
  expect(await panel().innerText()).not.toContain(homedir().length > 1 ? homedir() : '/Users/test-person');
  expect(await budget()).toEqual([]);
  await atEverySize(p, 'path-disclosure-open', async () => { await disclosure().scrollIntoViewIfNeeded(); });
  await disclosure().click();
  await expect(panel().locator('[data-places]')).toHaveCount(0);
});

test('a skill and a tool have it too, the disclosure starts closed for each, and "Copy path" says "Copied" and copies the path', async () => {
  const p = page();
  await ensurePicked(agent('Meeting assistant'));
  await panel().getByRole('region', { name: 'Skills' }).getByRole('button', { name: 'Write a reply', exact: true }).click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Write a reply' })).toBeVisible();
  await expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
  await disclosure().click();
  const first = panel().locator('.dt-place').first();
  const path = (await first.locator('.dt-path').textContent())!;
  expect(path).toMatch(/^~\/Studio\/\.(claude|codex|opencode)\/skills\/write-a-reply\.md$/);
  await first.getByRole('button', { name: /^Copy path/ }).click();
  await expect(first.locator('.dt-copied')).toHaveText('Copied');
  expect(await clipboard()).toBe(path);
  await expect(p.locator('[data-blocked]')).toHaveCount(0);
  // It says so once, and takes it back after a few seconds.
  await expect(first.locator('.dt-copied')).toHaveText('', { timeout: 6000 });
  // A tool.
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await panel().getByRole('region', { name: 'Tools' }).locator('.kit-card-main').first().click();
  await expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
  await disclosure().click();
  await expect(panel().locator('.dt-path').first()).toContainText('~/Studio/');
  expect(await budget()).toEqual([]);
});

test('the path can always be selected by hand, and when the window will not let the page copy, the path is selected and the line says so', async () => {
  const p = page();
  await ensurePicked(agent('Inbox sorter'));
  await disclosure().click();
  const code = panel().locator('.dt-path').first();
  expect(await code.evaluate(el => getComputedStyle(el).userSelect)).toBe('text');
  await expect(code).toHaveAttribute('tabindex', '0');
  // Make both ways of copying fail, as a window that forbids the clipboard would.
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }, configurable: true });
    document.execCommand = () => false;
  });
  await panel().locator('.dt-place').first().getByRole('button', { name: /^Copy path/ }).click();
  await expect(p.locator('[data-blocked]')).toHaveText('Copying is blocked here. Select the path and copy it.');
  await expect(panel().locator('.dt-copied').first()).toHaveText('');
  expect(await p.evaluate(() => window.getSelection()?.toString().trim())).toBe(await code.innerText());
  expect(await clipboard()).toBe('before');
  expect(await budget()).toEqual([]);
});

test('the Library page has the same disclosure for an agent, a skill and a tool, and none for a set of notes', async () => {
  const p = page();
  await page().locator('nav.hm-nav').getByRole('button', { name: 'Library', exact: true }).click();
  for (const [tab, name] of [['Skills', 'Compare two options'], ['Agents', 'Inbox sorter'], ['Tools', 'Search the web']] as const) {
    await p.getByRole('tab', { name: new RegExp(`^${tab} \\d+$`) }).click();
    await p.locator('.lb-list').getByRole('button', { name, exact: true }).click();
    await expect(panel().locator('#lb-panel-title')).toHaveText(name);
    await expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    await disclosure().click();
    await expect(panel().locator('.dt-path').first()).toContainText('~/');
    await animationsDone(p);
    expect(await panel().innerText()).not.toContain('/Users/');
  }
  await p.getByRole('tab', { name: /^Notes \d+$/ }).click();
  await p.locator('.lb-list .kit-card-main').first().click();
  await expect(disclosure()).toHaveCount(0);
  expect(await budget()).toEqual([]);
});
