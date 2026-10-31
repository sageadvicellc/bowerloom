/**
 * Wave E, groups F and G, in the real window (Electron started with --prototype-v2): the Share sheet names the keys it leaves out (by the names of their variables,
 * never a value), says in two lines that it makes one file and that the real app asks where to save it, says it again with "Share file ready" and its size, and
 * offers "Show what is in it", which opens Look inside; the text of a tool in Look inside is plain words; the copies dialog dates each copy and says which is newer; and
 * the Save bar says which agent two added skills went to.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { generateWorld } from '../shared/world/sample.js';
import { planShare, shareableAgents } from '../shared/home/share-model.js';
import { withLibrarySamples } from '../shared/home/library-sample.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { withStarterAgents } from '../shared/home/starters.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

const world = withLibrarySamples(withStarterAgents(withSampleCopies(generateWorld(1))));
const all = planShare(world, shareableAgents(world).map(a => a.id), []);

let home: Home;
const page = (): Page => home.page;
const sheet = (): Locator => page().getByRole('dialog', { name: 'Share my agents' });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const header = (): Locator => page().locator('nav.hm-nav');
async function openSheet(): Promise<void> { await header().getByRole('button', { name: 'Share', exact: true }).click(); await expect(sheet()).toBeVisible(); await animationsDone(page()); }

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('the sheet names the keys it leaves out, by their names and never a value', async () => {
  await openSheet();
  expect(all.keyNames).toEqual(['CALENDAR_KEY', 'SEARCH_KEY', 'WORKSPACE_KEY']);
  await expect(sheet().locator('.sh-left')).toHaveText('Left out: CALENDAR_KEY, SEARCH_KEY, WORKSPACE_KEY and 1 ready-made item');
  // Leaving the agent that holds a key out takes that key off the line, so the line follows the choice.
  const holder = sheet().locator('.sh-row').filter({ hasText: 'Meeting assistant' });
  await holder.getByRole('checkbox').uncheck();
  const names = (await sheet().locator('.sh-left').innerText()).replace(/^Left out: /, '');
  expect(names).toMatch(/^[A-Z_, a-z0-9-]+$/);
  expect(await sheet().innerText()).not.toMatch(/sk-|ghp_|password=|secret=/i);
  expect(await budget()).toEqual([]);
});

test('the sheet says in two lines that it makes one file and that the real app asks where to save it', async () => {
  await openSheet();
  await expect(sheet().locator('[data-file-is]')).toHaveText('One file you can send.');
  await expect(sheet().locator('[data-where-saved]')).toHaveText('In the real app you choose where it is saved.');
  const [a, b] = [(await sheet().locator('[data-file-is]').boundingBox())!, (await sheet().locator('[data-where-saved]').boundingBox())!];
  expect(b.y).toBeGreaterThan(a.y + a.height - 2);
  for (const [w, h] of [[1280, 800], [900, 600]] as const) { await resize(page(), w, h); await expect(sheet().locator('[data-where-saved]')).toBeInViewport(); }
});

test('"Create share file" ends in "Share file ready" with its size, the same line about where it goes, and a link that shows what is in it', async () => {
  const p = page();
  await openSheet();
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  await expect(sheet().getByRole('heading', { level: 3, name: 'Share file ready' })).toBeFocused();
  await expect(sheet().locator('.sh-size')).toHaveText(/^About \d+ KB$|^Under 1 KB$|^About [\d.]+ MB$/);
  await expect(sheet().locator('.sh-made [data-where-saved]')).toHaveText('In the real app you choose where it is saved.');
  await expect(sheet().getByText('Nothing was written to your computer in this preview.')).toBeVisible();
  // Look inside is closed; the link opens it and takes the focus to its list.
  await expect(sheet().locator('.sh-look-list')).toHaveCount(0);
  const link = sheet().getByRole('button', { name: 'Show what is in it' });
  await expect(link).toHaveAttribute('data-variant', 'text');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  await link.click();
  await expect(sheet().locator('.sh-look-list')).toBeVisible();
  await expect(sheet().locator('.sh-look-list')).toBeFocused();
  await expect(link).toHaveAttribute('aria-expanded', 'true');
  expect(await budget()).toEqual([]);
  await atEverySize(p, 'share-ready-named-keys', async () => { await sheet().locator('.sh-look-list').scrollIntoViewIfNeeded(); });
});

test('Look inside shows a tool as words: its plain name and the name of its key, and nothing that reads like a password', async () => {
  await openSheet();
  await sheet().getByRole('button', { name: 'Look inside' }).click();
  const calendar = sheet().locator('[data-look="tool-mcp-missing"]');
  await calendar.getByRole('button', { name: 'Show text' }).click();
  await expect(calendar.locator('.sh-text p')).toHaveText(['Read my calendar', 'Key name: CALENDAR_KEY']);
  const texts = await sheet().locator('[data-kind="tool"]').evaluateAll(list => list.map(el => el.textContent ?? ''));
  expect(texts.length).toBeGreaterThanOrEqual(5);
  for (const hook of ['tool-mcp-01', 'tool-prompt-01']) {
    const item = sheet().locator(`[data-look="${hook}"]`);
    await item.getByRole('button', { name: 'Show text' }).click();
    expect(await item.locator('.sh-text').innerText()).not.toMatch(/[a-z]+-[a-z]+/);
  }
  await expect(sheet().locator('[data-flagged]')).toHaveCount(0);
});

test('the dialog of two different copies dates each copy and says which is newer', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
  await p.locator('aside.hm-panel').getByRole('button', { name: /2 different copies|2 copies/ }).first().click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await animationsDone(p);
  await expect(dialog.locator('[data-copy="1"] [data-found]')).toHaveText('Found in Claude Code and OpenCode, changed 3 days ago');
  await expect(dialog.locator('[data-copy="2"] [data-found]')).toHaveText('Found in Codex, changed 9 days ago');
  await expect(dialog.locator('[data-newer]')).toHaveText('Copy 1 is the newer one.');
  expect(await budget()).toEqual([]);
  await atEverySize(p, 'copies-dialog-dates');
});

test('two skills added to the same agent are named with that agent on the Save bar', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
  await header().getByRole('button', { name: 'Add', exact: true }).click();
  const add = async (name: string): Promise<void> => {
    const row = p.locator('.add-list .add-row').filter({ has: p.getByRole('button', { name, exact: true }) });
    await row.getByRole('button', { name: /^Add to/ }).click();
    await p.locator('[data-picker] .add-pick-main', { hasText: 'Inbox sorter' }).click();
  };
  await add('Check a link'); await add('Check a price list');
  await expect(p.getByRole('region', { name: 'Save bar' }).locator('.hm-savebar-state > p')).toHaveText('Added Check a link and Check a price list to Inbox sorter');
});
