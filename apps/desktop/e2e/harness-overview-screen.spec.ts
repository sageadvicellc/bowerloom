/**
 * The Overview screen of the sample launch (Task 2 lane H review round), on the Graph view: the first view, the focus that never scrolls the stage, the names of the buttons, the zoom floor, and the focus
 * that stays on screen when the wheel zooms out. Hidden window; the lane's own checks. The made-up home and the full journey are the e2e of lane I.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  const p = page();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await fresh(p, '#sample/overview');
  await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
  // The Grid is the first view of a wide window; these checks are about the Graph, so the Graph is chosen.
  await p.getByRole('radio', { name: 'Graph view' }).click();
  await expect(p.locator('.hxo-canvas')).toBeVisible();
});

const scale = (p: Page): Promise<number> => p.locator('.hxo-world').evaluate(el => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 'NaN'));
/** Zooms in with Ctrl and the wheel over the open home until the parts are drawn (the first view fits every place as a box). */
async function intoDetail(p: Page): Promise<void> {
  const box = (await p.locator('[data-cluster="src-caveman"]').boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 60));
  await p.keyboard.down('Control');
  for (let i = 0; i < 30 && (await scale(p)) < 0.6; i += 1) await p.mouse.wheel(0, -30);
  await p.keyboard.up('Control');
  expect(await scale(p)).toBeGreaterThanOrEqual(0.5);
  await expect(p.locator('[data-node]').first()).toBeVisible();
}
const stageScroll = (p: Page): Promise<[number, number]> => p.locator('.hxo-canvas').evaluate(el => [el.scrollLeft, el.scrollTop]);

test('the first view shows every place: all closed but the small home, every box on the page, and the fit is the whole graph', async () => {
  const p = page();
  const heads = p.locator('[data-place-toggle]');
  expect(await heads.count()).toBe(6);
  expect(await p.locator('[data-place-toggle][aria-expanded="true"]').count(), 'only the home is open').toBe(1);
  expect(await p.locator('[data-place-toggle][aria-expanded="true"]').first().getAttribute('data-place-toggle')).toBe('src-caveman');
  const stage = (await p.locator('.hxo-canvas').boundingBox())!;
  for (const id of ['src-caveman', 'src-claude', 'src-codex', 'src-alpha', 'src-beta', 'src-gamma']) {
    const box = (await p.locator(`[data-cluster="${id}"]`).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(stage.x - 1); expect(box.y, id).toBeGreaterThanOrEqual(stage.y - 1);
    expect(box.x + box.width, id).toBeLessThanOrEqual(stage.x + stage.width + 1); expect(box.y + box.height, id).toBeLessThanOrEqual(stage.y + stage.height + 1);
  }
  expect(await scale(p)).toBeGreaterThanOrEqual(0.15);
});

test('a Tab onto a header or a card that is drawn but out of the window never scrolls the stage: the view moves and the thing is in the window', async () => {
  const p = page();
  await intoDetail(p);
  await p.keyboard.press('Tab');
  const stage = (await p.locator('.hxo-canvas').boundingBox())!;
  // The places inside the margin of the cull are in the page and may sit past the edge of the window: take one that does.
  const heads = p.locator('[data-place-toggle]');
  let target = -1;
  for (let i = 0; i < await heads.count(); i += 1) { const b = (await heads.nth(i).boundingBox())!; if (b.x + b.width > stage.x + stage.width || b.x < stage.x) target = i; }
  expect(target, 'a header out of the window is drawn').toBeGreaterThanOrEqual(0);
  await heads.nth(target).focus();
  expect(await stageScroll(p), 'the stage did not scroll').toEqual([0, 0]);
  const inside = async (): Promise<boolean> => p.evaluate(sel => {
    const r = document.activeElement!.getBoundingClientRect(), s = document.querySelector(sel)!.getBoundingClientRect();
    return r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom;
  }, '.hxo-canvas');
  expect(await inside(), 'the header is brought into the window by the view').toBe(true);
  // Tab to the next controls: nothing scrolls.
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  expect(await stageScroll(p)).toEqual([0, 0]);
  expect(await inside()).toBe(true);
});

test('one header is the tab stop and "Skip to the parts" is the first control', async () => {
  const p = page();
  await intoDetail(p);
  expect(await p.locator('[data-place-toggle][tabindex="0"]').count()).toBe(1);
  expect(await p.locator('[data-place-toggle][tabindex="-1"]').count()).toBe((await p.locator('[data-place-toggle]').count()) - 1);
  expect(await p.locator('.hxo-skip').count()).toBe(1);
  expect(await p.locator('.hxo-canvas').evaluate(el => el.querySelector('button, [tabindex="0"]') === el.querySelector('.hxo-skip')), 'the first control of the stage').toBe(true);
  await p.locator('.hxo-skip').focus();
  await p.keyboard.press('Enter');
  expect(await p.evaluate(() => document.activeElement?.getAttribute('data-node') !== null)).toBe(true);
});

test('the name of a place button begins with the words on it (Label in Name)', async () => {
  const p = page();
  const buttons = p.locator('[data-choose-folder], [data-open-builder]');
  const n = await buttons.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    const { text, name } = await buttons.nth(i).evaluate(el => ({ text: (el.textContent ?? '').trim(), name: el.getAttribute('aria-label') ?? '' }));
    expect(name.startsWith(text), `${name} / ${text}`).toBe(true);
  }
  // Some sample places are in Bowerloom, so the sample shows "Open in builder" too.
  await p.getByRole('radio', { name: 'List view' }).click();
  expect(await p.locator('[data-open-builder]').count()).toBeGreaterThan(0);
  await expect(p.locator('.hxo-place', { hasText: 'weekly-report' }).first()).toContainText('In Bowerloom');
});

test('the wheel that zooms out under the detail zoom moves the focus to the header of the place, as the keys do, and "Fit to window" shows every place', async () => {
  const p = page();
  await intoDetail(p);
  await p.locator('[data-node]').first().focus();
  const box = (await p.locator('.hxo-canvas').boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.keyboard.down('Control');
  for (let i = 0; i < 8; i += 1) await p.mouse.wheel(0, 200);
  await p.keyboard.up('Control');
  expect(await scale(p)).toBeLessThan(0.5);
  expect(await p.evaluate(() => document.activeElement?.hasAttribute('data-place-toggle') === true), 'the focus is on a header, not the page').toBe(true);
  await p.getByRole('button', { name: 'Fit to window' }).click();
  expect(await p.locator('[data-cluster]').count()).toBe(6);
});

test('the keys + - 0 move the view, and 0 keeps the focus on the page', async () => {
  const p = page();
  await intoDetail(p);
  await p.locator('[data-node]').first().focus();
  const k0 = await scale(p);
  await p.keyboard.press('+');
  expect(await scale(p)).toBeGreaterThan(k0);
  await p.keyboard.press('0');
  expect(await scale(p)).toBeLessThan(0.5);
  expect(await p.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('at the detail zoom the header buttons and the place buttons are at least 24 px high on the screen', async () => {
  const p = page();
  await intoDetail(p);
  const heights = await p.locator('.hxo-world [data-place-toggle], .hxo-world [data-choose-folder], .hxo-world [data-open-builder]').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const hgt of heights) expect(hgt).toBeGreaterThanOrEqual(23.5);
});

test('a drag that starts on a card pans the view, and the click that ends it selects nothing; a plain click on a card selects it', async () => {
  const p = page();
  await intoDetail(p);
  const stage = (await p.locator('.hxo-canvas').boundingBox())!, cards = p.locator('[data-node]');
  let at = -1;
  for (let i = 0; i < await cards.count() && at < 0; i += 1) {
    const b = (await cards.nth(i).boundingBox())!;
    if (b.x > stage.x + 10 && b.y > stage.y + 10 && b.x + b.width < stage.x + stage.width - 80 && b.y + b.height < stage.y + stage.height - 120) at = i;
  }
  expect(at, 'a card fully in the window').toBeGreaterThanOrEqual(0);
  const card = cards.nth(at), box = (await card.boundingBox())!, before = await p.locator('.hxo-world').evaluate(el => (el as HTMLElement).style.transform);
  await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x + 60, box.y + 40, { steps: 4 }); await p.mouse.up();
  expect(await p.locator('.hxo-world').evaluate(el => (el as HTMLElement).style.transform)).not.toBe(before);
  expect(await p.locator('[data-node][data-selected]').count()).toBe(0);
  const now = (await card.boundingBox())!;
  await p.mouse.click(now.x + now.width / 2, now.y + now.height / 2);
  expect(await p.locator('[data-node][data-selected]').count()).toBe(1);
});

test('at the smallest detail zoom (0.5) the place button is still 24 px high, and in boxes mode every header toggle stays inside its box', async () => {
  const p = page();
  await intoDetail(p);
  const box = (await p.locator('.hxo-canvas').boundingBox())!;
  await p.mouse.move(box.x + 300, box.y + 300);
  await p.keyboard.down('Control');
  for (let i = 0; i < 40 && (await scale(p)) > 0.52; i += 1) await p.mouse.wheel(0, 8);
  await p.keyboard.up('Control');
  const k = await scale(p);
  expect(k).toBeGreaterThanOrEqual(0.5); expect(k).toBeLessThan(0.56);
  const heights = await p.locator('.hxo-world [data-choose-folder], .hxo-world [data-open-builder]').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const hgt of heights) expect(hgt).toBeGreaterThanOrEqual(23.5);
  await p.getByRole('button', { name: 'Fit to window' }).click();
  expect(await scale(p)).toBeLessThan(0.5);
  const pairs = await p.locator('[data-cluster]').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(), t = e.querySelector('[data-place-toggle]')!.getBoundingClientRect(); return { top: t.top - b.top, bottom: b.bottom - t.bottom, left: t.left - b.left, right: b.right - t.right }; }));
  for (const d of pairs) { expect(d.top).toBeGreaterThanOrEqual(-0.5); expect(d.bottom).toBeGreaterThanOrEqual(-0.5); expect(d.left).toBeGreaterThanOrEqual(-0.5); expect(d.right).toBeGreaterThanOrEqual(-0.5); }
});
