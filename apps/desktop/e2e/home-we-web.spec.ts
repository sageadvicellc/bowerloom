/**
 * Wave E, group C, in the real window (Electron started with --home-sample, on the Library test page): the "Add from the web" sheet gives weight to what needs care.
 * "Runs code" and "Can change things" are bold with an amber dot, "Needs a key" has the same dot at the normal weight, each with one plain sentence under it; the column
 * of the sheet is centred and about 760 px wide; the line about what starts ticked is reworded; and "Add N items" still counts what is ticked.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { fresh, launchHome, resize } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const sheet = (): Locator => page().locator('[data-slot="web"]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
async function openOffice(): Promise<void> {
  await page().getByRole('button', { name: 'Add from the web' }).click();
  await expect(sheet()).toBeVisible();
  await animationsDone(page());
  await sheet().getByRole('button', { name: 'Open Everyday office kit', exact: true }).click();
  await expect(sheet().locator('[data-banner]')).toBeVisible();
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), '#prototype-v2/library');
  await resize(page(), 1280, 800);
  await page().waitForSelector('[data-library]');
});

test('what runs code and what can change things are bold with an amber dot, a key has the dot at the normal weight, and each has one plain sentence', async () => {
  await openOffice();
  const hook = sheet().locator('[data-item="tidy-files"]'), chat = sheet().locator('[data-item="send-chat"]'), find = sheet().locator('[data-item="find-contact"]');
  await expect(hook.locator('[data-flag="runs"]')).toHaveText('Runs code: it can run steps on its own.');
  await expect(hook.locator('[data-flag="changes"]')).toHaveText('Can change things: it can edit, not just read.');
  await expect(chat.locator('[data-flag="changes"]')).toHaveText('Can change things: it can edit, not just read.');
  await expect(chat.locator('[data-flag="key"]')).toHaveText('Needs a key: you add a key when asked.');
  await expect(chat.locator('[data-flag="runs"]')).toHaveCount(0);
  await expect(hook.locator('[data-flag="key"]')).toHaveCount(0);
  // A tool that only reads has none of them: it says so in plain words.
  await expect(find.locator('[data-flag]')).toHaveCount(0);
  await expect(find.locator('[data-ability]')).toHaveText('Can only read');
  const look = async (flag: Locator): Promise<{ weight: string; dot: string; amber: string; one: boolean }> => flag.evaluate(el => {
    const name = el.querySelector('.lb-flag-name')!, dot = el.querySelector('.kit-dot')!;
    const probe = document.createElement('i'); probe.style.color = getComputedStyle(document.querySelector('[data-home]')!).getPropertyValue('--hm-amber'); document.body.appendChild(probe);
    const amber = getComputedStyle(probe).color; probe.remove();
    return { weight: getComputedStyle(name).fontWeight, dot: getComputedStyle(dot).backgroundColor, amber, one: el.children.length === 2 };
  });
  for (const flag of [hook.locator('[data-flag="runs"]'), hook.locator('[data-flag="changes"]'), chat.locator('[data-flag="changes"]')]) {
    const l = await look(flag);
    expect(Number(l.weight)).toBeGreaterThanOrEqual(700);
    expect(l.dot).toBe(l.amber);
  }
  const key = await look(chat.locator('[data-flag="key"]'));
  expect(Number(key.weight)).toBeLessThanOrEqual(400);
  expect(key.dot).toBe(key.amber);
  // The sentence is normal weight, so the name carries the weight.
  expect(await hook.locator('[data-flag="runs"]').evaluate(el => getComputedStyle(el).fontWeight)).toBe('400');
  expect(await budget()).toEqual([]);
  await atEverySize(page(), 'web-sheet-flagged', async () => { await sheet().locator('[data-item="send-chat"]').scrollIntoViewIfNeeded(); await sheet().locator('[data-item="tidy-files"]').scrollIntoViewIfNeeded(); });
});

test('the column is centred and about 760 px wide, the notes and the buttons line up with it, and it never hugs the left edge', async () => {
  const p = page();
  await openOffice();
  for (const [w, h] of [[1280, 800], [1440, 900], [900, 600]] as const) {
    await resize(p, w, h);
    const geometry = await p.evaluate(() => {
      const body = document.querySelector('.lb-web-body')!, kids = [...body.children].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
      const foot = document.querySelector('.lb-web-foot')!, buttons = [...foot.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      const bodyBox = body.getBoundingClientRect(), scroll = body.scrollWidth - body.clientWidth;
      return { kids, bodyLeft: bodyBox.left, bodyRight: bodyBox.right, scroll, footRight: Math.max(...buttons.map(b => b.right)), width: window.innerWidth };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(1);
    for (const kid of geometry.kids) {
      expect(kid.width).toBeLessThanOrEqual(760 + 1);
      const gapLeft = kid.left - geometry.bodyLeft, gapRight = geometry.bodyRight - kid.right;
      expect(Math.abs(gapLeft - gapRight), `${w}: centred`).toBeLessThanOrEqual(12);
    }
    if (w >= 1280) { expect(Math.min(...geometry.kids.map(k => k.left))).toBeGreaterThan(100); expect(geometry.kids.some(k => k.width >= 700)).toBe(true); }
    // The buttons at the foot end where the column ends, not at the far edge of a wide window.
    if (w >= 1280) expect(Math.abs(geometry.footRight - geometry.kids[0]!.right)).toBeLessThanOrEqual(24);
  }
});

test('the line about what starts ticked says it plainly, and "Add N items" counts what is ticked', async () => {
  const p = page();
  await openOffice();
  await expect(sheet().getByText('Items that run code start unticked. Others start ticked.')).toBeVisible();
  await expect(sheet().getByRole('button', { name: 'Add 7 items' })).toBeVisible();
  await sheet().locator('[data-item="tidy-files"]').getByRole('checkbox').check();
  await expect(sheet().getByRole('button', { name: 'Add 8 items' })).toBeVisible();
  await sheet().locator('[data-item="send-chat"]').getByRole('checkbox').uncheck();
  await expect(sheet().getByRole('button', { name: 'Add 7 items' })).toBeVisible();
  await sheet().getByRole('button', { name: 'Add 7 items' }).click();
  await expect(sheet()).toBeHidden();
  await expect(p.locator('[data-count]')).toHaveText('Added 7 items to your library.');
});
