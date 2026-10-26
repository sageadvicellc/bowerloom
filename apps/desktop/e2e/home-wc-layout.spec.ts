/**
 * Wave C, group 8, in the real window: the Save bar stays on one line at every size (below 1000 px the "Would update" words are dropped and the sentence and the buttons stay),
 * and the note after Remove or after the first Save sits above the Save bar at the left in a strip of its own, so it never lies over a tile.
 * Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { SAVED, ensurePicked, fresh, launchHome, overlaps, rectOf, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;

let home: Home;
const page = (): Page => home.page;
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const panel = (): Locator => page().locator('aside.hm-panel');
const shelf = (name: string): Locator => panel().getByRole('region', { name });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const shot = async (name: string, w: number, h: number, look: string): Promise<void> => { if (SHOTS === null) return; await animationsDone(page()); await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };
/** The height of the Save bar and whether anything in it sits on a second line. */
const oneLine = async (): Promise<{ h: number; rows: number; right: number }> => page().evaluate(() => {
  const el = document.querySelector('.hm-savebar')!;
  const r = el.getBoundingClientRect();
  // The things in the bar are centred on their line, so a line is told by the middle of each thing.
  const middles = [...el.querySelectorAll('.hm-savebar-state > p, .hm-savebar-actions button, .hm-would, .hm-tick')].filter(e => e.getClientRects().length > 0).map(e => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; });
  return { h: Math.round(r.height), rows: Math.max(...middles) - Math.min(...middles) > 10 ? 2 : 1, right: Math.round(r.right) };
});

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await ensurePicked(page().locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }));
});

for (const [w, h] of [[900, 600], [1100, 700], [1280, 800]] as const) {
  test(`at ${w} by ${h} the Save bar is one line in every state: nothing waits, a sentence, N changes, saved, and back`, async () => {
    const p = page();
    await resize(p, w, h);
    const base = await oneLine();
    expect(base.h).toBe(48);
    await shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' }).click();
    await shelf('Tools').getByRole('button', { name: 'Remove Read my calendar' }).click();
    expect(await bar().locator('.hm-savebar-state > p').innerText()).toBe('Removed Summarize a meeting and Read my calendar');
    const sentence = await oneLine();
    expect(sentence.h, 'a sentence of two changes').toBe(48);
    await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
    await expect(bar().locator('.hm-changes-toggle')).toHaveText('3 changes');
    expect((await oneLine()).h, '3 changes').toBe(48);
    await bar().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
    const saved = await oneLine();
    expect(saved.h, 'saved, with its buttons').toBe(48);
    expect(saved.rows).toBe(1);
    await bar().getByRole('button', { name: 'Go back' }).click();
    await expect(bar().getByText('Back to how it was')).toBeVisible();
    expect((await oneLine()).h).toBe(48);
    expect(await budget()).toEqual([]);
  });
}

test('below 1000 px of the middle and right columns the "Would update" words are dropped and the sentence and buttons stay; from 1000 px (a 1232 px window with the navigation open) they are there, still on one line', async () => {
  const p = page();
  await shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  for (const [w, h, shown] of [[1280, 800, true], [1232, 700, true], [1231, 700, false], [1000, 700, false], [900, 600, false]] as const) {
    await resize(p, w, h);
    const would = bar().locator('.hm-would');
    if (shown) { await expect(would).toBeVisible(); await expect(bar().locator('.hm-tick')).toHaveText(['Claude Code', 'Codex', 'OpenCode']); } else await expect(would).toBeHidden();
    await expect(bar().getByRole('button', { name: 'Go back' })).toBeVisible();
    await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
    const line = await oneLine();
    expect(line.h, `${w} px: one line`).toBe(48);
    expect(line.rows, `${w} px: one row`).toBe(1);
  }
});

test('the note after Remove sits above the Save bar at the left in a strip of its own and never lies over a tile, even with the map scrolled to its end', async () => {
  const p = page();
  await resize(p, 900, 600);
  await p.locator('main.hm-stage').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' }).click();
  const note = p.locator('.hm-toast[data-note]');
  await expect(note).toBeVisible();
  await animationsDone(p);
  const n = await rectOf(p, '.hm-toast[data-note]'), b = await rectOf(p, '.hm-savebar'), stage = await rectOf(p, 'main.hm-stage');
  expect(n.y + n.h).toBeLessThanOrEqual(b.y + 1);
  expect(n.x - (await rectOf(p, '.hm-savebar')).x).toBeLessThan(60);   // at the left of the middle column, where the Save bar starts
  expect(stage.y + stage.h, 'the page above ends where the note starts').toBeLessThanOrEqual(n.y + 1);
  // What of a tile can be seen: its box cut to the page that scrolls it.
  for (const t of await p.locator('.hm-grid .kit-card').all()) {
    const box = (await t.boundingBox())!;
    const top = Math.max(box.y, stage.y), bottom = Math.min(box.y + box.height, stage.y + stage.h);
    if (bottom > top) expect(overlaps(n, { x: box.x, y: top, w: box.width, h: bottom - top }), 'a tile or a row of a tray').toBe(false);
  }
  await shot('note-above-bar', 900, 600, 'light');
  // It leaves, and the strip takes no room: the page grows back to the bar.
  await expect(note).toBeHidden({ timeout: 10_000 });
  const after = await rectOf(p, 'main.hm-stage');
  expect(after.y + after.h).toBeLessThanOrEqual(b.y + 1);
  expect(after.h).toBeGreaterThan(stage.h);
});

for (const [w, h] of REVIEW) for (const look of LOOKS) {
  test(`the Save bar and the note at ${w} by ${h}, ${look}: saved, and a change with its note`, async () => {
    const p = page();
    await setLook(p, look); await resize(p, w, h);
    await shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' }).click();
    await shot('footer-note', w, h, look);
    await bar().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
    await shot('footer-saved', w, h, look);
    const m = await oneLine();
    expect(m.h).toBe(48);
    expect(m.right).toBeLessThanOrEqual(w);
  });
}
