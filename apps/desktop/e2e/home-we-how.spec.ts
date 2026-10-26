/**
 * Wave E, group I, in the real window (Electron started with --prototype-v2): the Preview popover has a link "How it will work" that opens a short sheet. The sheet has two
 * lists, "What is decided" (each statement with its source, "Decided in the plan") and "Not decided yet"; it is a modal dialog (the focus starts on its title and
 * stays inside, Escape closes it and gives the focus back to the Preview mark), its words pass the budget, no text in it is under 14 px, and at 900 by 600 its body
 * scrolls while the title and Done stay in view.
 * Set HOME_WE_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { DECIDED, NOT_DECIDED } from '../renderer/home/trust/how-words.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { atEverySize } from './home-we-shots.js';

let home: Home;
const page = (): Page => home.page;
const dialog = (): Locator => page().getByRole('dialog', { name: 'How it will work' });
const preview = (): Locator => page().locator('[data-preview]').getByRole('button', { name: 'About this preview' });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
async function open(): Promise<void> {
  await preview().click();
  await page().getByRole('button', { name: 'How it will work' }).click();
  await expect(dialog()).toBeVisible();
  await animationsDone(page());
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('the Preview popover says what it said and has a quiet link "How it will work" that opens the sheet', async () => {
  const p = page();
  await preview().click();
  const popover = p.getByRole('group', { name: 'About this preview' });
  await expect(popover).toContainText('This is a preview. It sends nothing, stores nothing, and writes nothing to your computer.');
  const link = popover.getByRole('button', { name: 'How it will work' });
  await expect(link).toHaveAttribute('data-variant', 'text');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  await link.click();
  await expect(dialog()).toBeVisible();
  await expect(dialog().getByRole('heading', { level: 2, name: 'How it will work' })).toBeFocused();
  await expect(popover).toHaveCount(0);
  expect(await budget()).toEqual([]);
});

test('the sheet lists what is decided, each with "Decided in the plan", and what is not decided yet, word for word', async () => {
  await open();
  await expect(dialog().getByRole('heading', { level: 3 })).toHaveText(['What is decided', 'Not decided yet']);
  const statements = dialog().locator('[data-statement]');
  await expect(statements).toHaveCount(DECIDED.length);
  for (const d of DECIDED) {
    const item = dialog().locator(`[data-statement="${d.id}"]`);
    for (const text of d.paragraphs) await expect(item.getByText(text, { exact: true })).toBeVisible();
    await expect(item.locator('[data-source]')).toHaveText('Decided in the plan');
  }
  await expect(dialog().locator('[data-source]')).toHaveCount(DECIDED.length);
  const undecided = dialog().locator('[data-not-decided]');
  await expect(undecided.locator('[data-open-question]')).toHaveText(NOT_DECIDED.map(q => q.text));
  await expect(undecided.locator('[data-source]')).toHaveCount(0);
  for (const text of await dialog().locator('[data-budget="paragraph"]').allTextContents()) expect(countWords(text), text).toBeLessThanOrEqual(25);
  expect(await budget()).toEqual([]);
});

test('every word in the sheet is 14 px or more, and nothing is cut off or runs sideways, at both review sizes in both looks', async () => {
  const p = page();
  await open();
  for (const [w, h] of [[1280, 800], [900, 600]] as const) {
    await resize(p, w, h);
    await animationsDone(p);
    const facts = await dialog().evaluate(el => {
      const small = [...el.querySelectorAll('*')].filter(n => n.childNodes.length > 0 && [...n.childNodes].some(c => c.nodeType === 3 && (c.textContent ?? '').trim() !== '') && parseFloat(getComputedStyle(n).fontSize) < 14).map(n => n.textContent);
      const box = el.getBoundingClientRect(), body = el.querySelector('.hw-body')!, foot = el.querySelector('.hw-foot')!.getBoundingClientRect(), head = el.querySelector('.hw-head')!.getBoundingClientRect();
      return { small, inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, sideways: body.scrollWidth > body.clientWidth + 1, scrolls: body.scrollHeight > body.clientHeight, footVisible: foot.bottom <= window.innerHeight && foot.top >= head.bottom, headTop: head.top };
    });
    expect(facts.small, `${w}: text under 14 px`).toEqual([]);
    expect(facts.inside, `${w}: the sheet fits the window`).toBe(true);
    expect(facts.sideways).toBe(false);
    expect(facts.footVisible).toBe(true);
    if (w === 900) expect(facts.scrolls, 'at 900 by 600 the body scrolls').toBe(true);
  }
  await dialog().locator('.hw-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(dialog().getByRole('button', { name: 'Done' })).toBeInViewport();
  await expect(dialog().locator('[data-open-question]').last()).toBeInViewport();
  await resize(p, 1280, 800);
  await atEverySize(p, 'how-it-will-work', async () => { await dialog().locator('.hw-body').evaluate(el => { el.scrollTop = 0; }); });
});

test('it is a modal dialog: Tab stays inside, Escape and Done and Close and the scrim close it, and the focus goes back to the Preview mark', async () => {
  const p = page();
  await open();
  const inside = (): Promise<boolean> => p.evaluate(() => document.activeElement?.closest('[data-how]') !== null);
  for (let i = 0; i < 6; i += 1) { await p.keyboard.press('Tab'); expect(await inside()).toBe(true); }
  for (let i = 0; i < 6; i += 1) { await p.keyboard.press('Shift+Tab'); expect(await inside()).toBe(true); }
  expect(await p.locator('header.hm-bar').evaluate(el => el.closest('[inert]') !== null || el.hasAttribute('inert'))).toBe(true);
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(preview()).toBeFocused();
  await open(); await dialog().getByRole('button', { name: 'Done' }).click();
  await expect(dialog()).toHaveCount(0); await expect(preview()).toBeFocused();
  await open(); await dialog().getByRole('button', { name: 'Close' }).click();
  await expect(dialog()).toHaveCount(0);
  await open();
  await p.mouse.click(5, 400);
  await expect(dialog()).toHaveCount(0);
  // Ctrl+Z does nothing while it is open, and the sheet writes nothing.
  await open();
  await p.keyboard.press('Control+z');
  await expect(dialog()).toBeVisible();
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
});

test('with less motion the sheet comes and goes at once', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await open();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
});
