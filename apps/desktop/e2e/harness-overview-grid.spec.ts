/**
 * The Grid view of the Overview (beta.2), in a hidden window. At the smallest, the default and two larger window sizes: every tile is inside the stage, no two tiles overlap, nothing a tile
 * lists is cut by the tile, and the page never scrolls sideways. A large workspace (a made-up home with many agents and skills) lists a few parts per tile, and "and N more" opens the List
 * at that place. Movement: a place that opens or closes makes the tiles below it glide, and under reduced motion nothing animates.
 * Set HARNESS_SHOTS to a folder outside the repository to save a screenshot of each size.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { framesPainted } from './page-wait.js';
import { newMadeUpHome, startApp } from './journey-support.js';
import type { RealHarness } from './harness-real-page.js';

const SIZES = [{ w: 900, h: 600 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }] as const;
let h: Harness;
let real: RealHarness | null = null;
test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); await real?.app.close(); } finally { removeTempDirs(); } });

const page = (): Page => h.page;

/** The checks of one drawn Grid, read from the page. Returns the plain problems it found; an empty list is a pass. */
async function problems(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const out: string[] = [];
    const stage = document.querySelector<HTMLElement>('#main')!, stageBox = stage.getBoundingClientRect();
    if (stage.scrollWidth > stage.clientWidth + 1) out.push(`the stage scrolls sideways: ${stage.scrollWidth} > ${stage.clientWidth}`);
    const cells = [...document.querySelectorAll<HTMLElement>('.hxo-cell')];
    if (cells.length === 0) out.push('no tile is drawn');
    const boxes = cells.map(c => ({ id: c.dataset['tile']!, r: c.getBoundingClientRect() }));
    for (const { id, r } of boxes) {
      if (r.left < stageBox.left - 0.5 || r.right > stageBox.right + 0.5) out.push(`${id} is outside the stage sideways`);
      if (r.width < 60 || r.height < 60) out.push(`${id} is too small: ${r.width} x ${r.height}`);
    }
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!.r, b = boxes[j]!.r;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${boxes[i]!.id} overlaps ${boxes[j]!.id}`);
    }
    for (const c of cells) {
      const box = c.getBoundingClientRect(), id = c.dataset['tile']!;
      for (const part of c.querySelectorAll<HTMLElement>('.hxo-cell-head, .hxo-cell-item, .hxo-cell-more')) {
        const r = part.getBoundingClientRect();
        if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5 || r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`${id}: ${part.className} sticks out of its tile`);
      }
      for (const name of c.querySelectorAll<HTMLElement>('.hxo-cell-name')) {
        if (name.scrollWidth > name.clientWidth + 1 && getComputedStyle(name).textOverflow !== 'ellipsis') out.push(`${id}: a name is cut with no ellipsis`);
      }
    }
    for (const head of document.querySelectorAll<HTMLElement>('.hxo-place-head')) {
      const box = head.getBoundingClientRect();
      for (const el of head.querySelectorAll<HTMLElement>('button')) {
        const r = el.getBoundingClientRect();
        if (r.right > box.right + 0.5 || r.left < box.left - 0.5) out.push(`a header button leaves its header: ${el.textContent}`);
      }
    }
    return out;
  });
}

async function openAll(p: Page): Promise<void> {
  const button = p.locator('[data-expand-all]');
  if ((await button.getAttribute('aria-label')) === 'Expand all') await button.click();
  await expect(p.locator('[data-place-toggle][aria-expanded="false"]')).toHaveCount(0);
  await framesPainted(p);
}

for (const { w, h: height } of SIZES) {
  test(`the sample Grid at ${w} by ${height}: tiles fit the stage, none overlaps another, nothing is cut`, async () => {
    const p = page();
    await p.setViewportSize({ width: w, height });
    await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await fresh(p, '#sample/overview');
    await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
    await expect(p.getByRole('radio', { name: 'Grid view' })).toHaveAttribute('aria-checked', 'true');
    await openAll(p);
    expect(await problems(p)).toEqual([]);
    expect(await p.locator('.hxo-cell').count()).toBeGreaterThan(6);
    await shot(p, `overview-grid-${w}x${height}`);
    // Without the details column the stage is wider, so the grid has more columns; the rules hold there too.
    await p.getByRole('button', { name: 'Hide details' }).click();
    await framesPainted(p);
    expect(await problems(p)).toEqual([]);
    await shot(p, `overview-grid-${w}x${height}-no-details`);
  });
}

test('the Grid, the Graph and the List switch with the radio buttons and the arrow keys, and keep the selection', async () => {
  const p = page();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await fresh(p, '#sample/overview');
  const radios = p.getByRole('radiogroup', { name: 'Grid, graph or list' }).getByRole('radio');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  const item = p.locator('.hxo-cell-item .hxo-cell-pick').first();
  const id = await p.locator('.hxo-cell-item').first().getAttribute('data-node');
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator(`[data-details-node="${id}"]`)).toBeVisible();
  await radios.nth(0).focus();
  await p.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(p.locator('.hxo-canvas')).toBeVisible();
  await p.keyboard.press('ArrowRight');
  await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  await expect(p.locator('.hxo-row[data-selected]')).toHaveCount(1);
  await p.keyboard.press('ArrowRight');
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(p.locator('.hxo-cell-item[data-selected]')).toHaveCount(1);
});

/** The animations that move a tile of the Grid right now. */
const tileAnimations = (p: Page): Promise<number> => p.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect | null)?.target instanceof HTMLElement && ((a.effect as KeyframeEffect).target as HTMLElement).classList.contains('hxo-cell')).length);

test('a place that closes makes the tiles below it glide softly, and under reduced motion nothing moves', async () => {
  const p = page();
  await p.setViewportSize({ width: 1440, height: 900 });
  for (const reduced of [false, true]) {
    await p.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: 'light' });
    await fresh(p, '#sample/overview');
    await openAll(p);
    expect(await tileAnimations(p), 'nothing glides while the page just sits').toBe(0);
    await p.locator('[data-place-toggle]').first().click();
    await expect(p.locator('[data-place-toggle]').first()).toHaveAttribute('aria-expanded', 'false');
    if (reduced) {
      await framesPainted(p);
      expect(await tileAnimations(p), 'reduced motion: no tile animates').toBe(0);
    } else {
      expect(await tileAnimations(p), 'the tiles below the closed place glide').toBeGreaterThan(0);
      await expect.poll(() => tileAnimations(p), { timeout: 5000 }).toBe(0);
    }
    // After the glide the tiles rest where the grid puts them.
    expect(await problems(p)).toEqual([]);
  }
});

test('a large workspace lists a few parts in each tile, "and N more" opens the List at that place, and the tiles still fit at every size', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome();
  for (let i = 0; i < 45; i += 1) {
    const dir = join(home.home, '.claude', 'skills', `skill-${String(i).padStart(2, '0')}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: skill-${String(i).padStart(2, '0')}\ndescription: Does step ${i} of the chart work.\n---\n\nDo step ${i}.\n`);
  }
  for (let i = 0; i < 14; i += 1) writeFileSync(join(home.home, '.claude', 'agents', `helper-${String(i).padStart(2, '0')}.md`), `---\nname: helper-${String(i).padStart(2, '0')}\ndescription: Helps with job ${i}.\n---\nYou help with job ${i}.\n`);
  real = await startApp(home, 'overview');
  const p = real.page;
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await real.pick(home.projects);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.locator('[data-count]')).toContainText('parts in all', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
  await openAll(p);
  for (const { w, h: height } of SIZES) {
    await p.setViewportSize({ width: w, height });
    await framesPainted(p);
    await expect(p.getByRole('radio', { name: 'Grid view' })).toHaveAttribute('aria-checked', 'true');
    await expect(p.locator('.hxo-cell').first()).toBeVisible();
    expect(await problems(p), `${w} by ${height}`).toEqual([]);
    const sizes = await p.locator('.hxo-cell').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['size']));
    expect(sizes, 'a place with many skills has a large tile').toContain('large');
    expect(await p.locator('[data-more]').count()).toBeGreaterThan(0);
    if (process.env.HARNESS_SHOTS !== undefined) await p.screenshot({ path: join(process.env.HARNESS_SHOTS, `overview-grid-large-${w}x${height}.png`), scale: 'css' });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  const more = p.locator('[data-more]').first();
  const placeId = (await more.getAttribute('data-more'))!.split('/')[0]!;
  await more.click();
  await expect(p.getByRole('radio', { name: 'List view' })).toHaveAttribute('aria-checked', 'true');
  await expect(p.locator(`[data-place-toggle="${placeId}"]`)).toBeFocused();
});
