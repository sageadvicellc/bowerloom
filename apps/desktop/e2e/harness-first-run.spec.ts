/**
 * The first three screens of the harness-first preview in the real window (Electron started with --sample): Welcome, Choose sources (a short look first, then three sources with ticks),
 * Read sources, and then the app. "Make a harness from this", "Make all 3" and "Not now" each open the app. Text is 14 px or more and a button is 32 px.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { WELCOME, fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), WELCOME); });

/** The smallest text on the page, in px, and the height of every button. */
async function measure(p: Page): Promise<{ smallest: number; buttons: number[] }> {
  return p.evaluate(() => {
    let smallest = 99;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el === null || (n.textContent ?? '').trim() === '' || el.closest('.hm-sr') !== null) continue;
      smallest = Math.min(smallest, parseFloat(getComputedStyle(el).fontSize));
    }
    return { smallest, buttons: [...document.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)) };
  });
}

async function toRead(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read 3 sources. Make a harness from each.' })).toBeVisible();
}

test('Welcome says what the design says, has no navigation, and "Find my files" has the focus and goes to Choose', async () => {
  const p = page();
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  await expect(p.getByRole('heading', { level: 1, name: 'Bowerloom', exact: true })).toBeVisible();
  await expect(p.getByText('Build a harness from your agents and skills.')).toBeVisible();
  await expect(p.getByText('Then run it in any interface you use.')).toBeVisible();
  await expect(p.getByText('A harness is a saved bundle of your AI helpers.')).toBeVisible();
  await expect(p.getByText('Bowerloom only reads. Nothing changes until you press Install.')).toBeVisible();
  await expect(p.getByRole('navigation')).toHaveCount(0);
  const find = p.getByRole('button', { name: 'Find my files', exact: true });
  await expect(find).toBeFocused();
  const m = await measure(p);
  expect(m.smallest).toBeGreaterThanOrEqual(14);
  expect(m.buttons).toEqual([32]);
  await shot(p, 'S1.1-welcome');
  await p.keyboard.press('Enter');
  await expect(p.getByRole('heading', { level: 1, name: 'Found 3 sources' })).toBeVisible();
});

test('the sample window has no bridge at all: no page global, no preload on the window, no preload script on the session', async () => {
  const p = page();
  const globals = await p.evaluate(() => [typeof (window as unknown as { bowerloomReal?: unknown }).bowerloomReal, typeof (window as unknown as { bowerloom?: unknown }).bowerloom]);
  expect(globals).toEqual(['undefined', 'undefined']);
  const main = await h.app.evaluate(({ BrowserWindow, session }) => {
    const windows = BrowserWindow.getAllWindows(), contents = windows[0]!.webContents as unknown as { getLastWebPreferences?: () => { preload?: string } };
    return { windows: windows.length, hasApi: typeof contents.getLastWebPreferences === 'function', preload: contents.getLastWebPreferences?.().preload ?? null, sessionPreloads: session.defaultSession.getPreloads(), sessionScripts: session.defaultSession.getPreloadScripts().length };
  });
  expect(main.windows).toBe(1);
  expect(main.hasApi, 'the window can report the settings it was made with').toBe(true);
  expect(main.preload).toBeNull();
  expect(main.sessionPreloads).toEqual([]);
  expect(main.sessionScripts).toBe(0);
});

test('Choose sources looks for a moment (a bar that fills), then shows three ticked sources with their counts', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Looking for your files' })).toBeVisible();
  await expect(p.getByRole('progressbar', { name: 'Search progress' })).toBeVisible();
  await expect(p.getByRole('list', { name: 'Sources' })).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: 'Found 3 sources' })).toBeVisible({ timeout: 4000 });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const cards = p.locator('.hxf-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Caveman (plug-in)');
  await expect(cards.nth(0)).toContainText('4 agents · 14 skills');
  await expect(cards.nth(0)).toContainText('Claude Code');
  await expect(cards.nth(1)).toContainText('Your Claude Code folder');
  await expect(cards.nth(1)).toContainText('6 agents · 22 skills · 2 tools');
  await expect(cards.nth(2)).toContainText('2 agents · 5 skills');
  await expect(cards.nth(2)).toContainText('Codex');
  await expect(p.getByText('Hermes')).toHaveCount(0);
  await expect(p.getByRole('checkbox')).toHaveCount(3);
  for (const box of await p.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await expect(p.getByText('Untick a source to skip it. Bowerloom reads the names and text of the files you keep. The text stays on this computer.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toBeFocused();
  const m = await measure(p);
  expect(m.smallest).toBeGreaterThanOrEqual(14);
  expect(new Set(m.buttons)).toEqual(new Set([32]));
  await shot(p, 'S1.2-choose-sources');
});

test('Show details lists the parts of each source in plain words, Add a folder says it is not in the preview, and an unticked source is skipped', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 3 sources' })).toBeVisible();
  await p.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(p.locator('.hxf-card-names')).toHaveCount(3);
  await expect(p.getByRole('button', { name: 'Hide details', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await p.getByRole('button', { name: 'Hide details', exact: true }).click();
  await expect(p.locator('.hxf-card-names')).toHaveCount(0);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('status')).toHaveText('Not in this preview.');
  await p.getByRole('checkbox').nth(2).uncheck();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read 2 sources. Make a harness from each.' })).toBeVisible();
  await expect(p.locator('.hxf-card')).toHaveCount(2);
  await expect(p.getByText('Your Codex folder')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Make all 2', exact: true })).toBeVisible();
});

test('"Looks right" waits for at least one tick', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 3 sources' })).toBeVisible();
  for (const box of await p.getByRole('checkbox').all()) await box.uncheck();
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toBeDisabled();
  await expect(p.getByRole('status')).toHaveText('Tick at least one source.');
  await p.getByRole('checkbox').first().check();
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toBeEnabled();
});

test('Read sources shows the three sources; "Make a harness from this" makes one harness from that source and opens the app on it', async () => {
  const p = page();
  await toRead(p);
  await expect(p.getByText('A harness is a saved list of agents and skills. Bowerloom stores it as one small file in the project you install it to.')).toBeVisible();
  await expect(p.locator('.hxf-card')).toHaveCount(3);
  await expect(p.getByRole('button', { name: 'Make a harness from this', exact: true })).toHaveCount(3);
  await expect(p.getByRole('button', { name: 'Make all 3', exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Not now', exact: true })).toBeVisible();
  const m = await measure(p);
  expect(m.smallest).toBeGreaterThanOrEqual(14);
  expect(new Set(m.buttons)).toEqual(new Set([32]));
  await shot(p, 'S1.3-make-harnesses');
  await p.locator('.hxf-card', { hasText: 'Your Codex folder' }).getByRole('button', { name: 'Make a harness from this' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(5);
  await expect(p.locator('.hx-row[data-selected]')).toContainText('Codex folder');
  await expect(p.locator('.hx-row[data-selected]')).toContainText('2 agents · 5 skills');
  await p.getByRole('link', { name: 'Version history', exact: true }).or(p.getByRole('button', { name: 'Version history', exact: true })).first().click();
  await expect(p.locator('.hxh-row').first()).toContainText('Made Codex folder from a scan');
});

test('"Make all 3" makes three harnesses, "Not now" opens the app on the sample', async () => {
  const p = page();
  await toRead(p);
  await p.getByRole('button', { name: 'Make all 3', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(7);
  await expect(p.getByRole('navigation')).toBeVisible();
  await fresh(p, WELCOME);
  await toRead(p);
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(4);
});
