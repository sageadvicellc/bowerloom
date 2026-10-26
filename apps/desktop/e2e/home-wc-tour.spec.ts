/**
 * Wave C, group 4, in the real window: the tour has seven steps; Next stays in the same place on every step (also on the step that waits for a click); Back is a
 * quiet text button; the click step says it can be done from the keyboard; every card sits beside its target and never over it (step three also keeps off the
 * agent it describes); step five tells the truth when seen; a new step lights the clock and Share together; and the note after the first Save is just the saved line.
 * Set HOME_WC_SHOTS to a folder to also save tour step 3 and step 6 at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { SAVED, fresh, launchHome, overlaps, rectOf, resize, setLook } from './home-page.js';
import type { Home, Rect } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });

const STEPS = [
  { target: 'map', text: 'These are your AI agents, from every tool.' },
  { target: 'agent', text: 'Click an agent to see what it can do.' },
  { target: 'details', text: 'Skills show what the agent you picked can do.' },
  { target: 'add', text: 'Add skills, tools, and notes here.' },
  { target: 'save', text: 'This bar shows your changes. Press Save to keep them.' },
  { target: 'share', text: 'Share your agents or go back in time here.' },
  { target: 'help', text: 'Replay this tour any time.' },
] as const;

let home: Home;
const page = (): Page => home.page;
const dialog = (): ReturnType<Page['getByRole']> => page().getByRole('dialog', { name: 'Tour' });
const SIZES = [[1280, 800], [900, 600]] as const;

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), undefined, { tour: true });
  await resize(page(), 1280, 800);
});

/** What a person can see of a target: its box cut to what its scrolling parents show, as the tour cuts its hole. */
async function visibleTarget(id: string): Promise<Rect> {
  return page().evaluate(target => {
    const el = document.querySelector(`[data-tour~="${target}"]`)!;
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top, right = r.right, bottom = r.bottom;
    for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const q = parent.getBoundingClientRect();
      x = Math.max(x, q.left); y = Math.max(y, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom);
    }
    return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
  }, id);
}
/** The third step says one thing when the person clicked an agent and another when the tour had to pick one (Next was pressed on the step that waits for a click). */
const PICKED = 'We picked an agent. Skills show what it can do.';
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stepText = async (i: number): Promise<void> => {
  await expect(dialog().getByText(i === 2 ? new RegExp(`^(${escape(STEPS[2].text)}|${escape(PICKED)})$`) : STEPS[i]!.text, { exact: true })).toBeVisible();
  await expect(dialog().getByText(`Step ${i + 1} of 7`)).toBeVisible();
  await animationsDone(page());
};
const next = (): ReturnType<Page['getByRole']> => dialog().getByRole('button', { name: /^(Next|Done)$/ });
async function nextPlace(): Promise<{ right: number; bottom: number; w: number; h: number; label: string }> {
  const [n, pop] = [(await next().boundingBox())!, await rectOf(page(), '.tour-pop')];
  return { right: Math.round(n.x + n.width - (pop.x + pop.w)), bottom: Math.round(n.y + n.height - (pop.y + pop.h)), w: Math.round(n.width), h: Math.round(n.height), label: (await next().textContent())!.trim() };
}

test('the tour has seven steps, in order, each with its sentence and its target lit', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  expect(await p.locator('.tour-dot').count()).toBe(7);
  for (let i = 0; i < STEPS.length; i += 1) {
    await stepText(i);
    const hole = await rectOf(p, '.tour-spot'), target = await visibleTarget(STEPS[i]!.target);
    expect(hole.x, `step ${i + 1}`).toBeLessThanOrEqual(target.x + 2); expect(hole.y).toBeLessThanOrEqual(target.y + 2);
    expect(hole.x + hole.w).toBeGreaterThanOrEqual(target.x + target.w - 2); expect(hole.y + hole.h).toBeGreaterThanOrEqual(target.y + target.h - 2);
    if (i < STEPS.length - 1) { await next().click(); } 
  }
  await expect(next()).toHaveText('Done');
  await next().click();
  await expect(dialog()).toHaveCount(0);
});

test('Next stays in the same place on every step, also on the step that waits for a click, and Done takes its place on the last', async () => {
  const first = await nextPlace();
  for (let i = 0; i < STEPS.length; i += 1) {
    await stepText(i);
    const here = await nextPlace();
    expect(here.right, `step ${i + 1}: the right edge`).toBe(first.right);
    expect(here.bottom, `step ${i + 1}: the bottom edge`).toBe(first.bottom);
    expect(here.h).toBe(first.h);
    expect(here.label).toBe(i === STEPS.length - 1 ? 'Done' : 'Next');
    await expect(next()).toBeEnabled();
    if (i < STEPS.length - 1) await next().click();
  }
});

test('Back is a quiet text button left of Next, absent on step one; Skip tour stays at the far left; going back and forth moves nothing', async () => {
  const p = page();
  await stepText(0);
  await expect(dialog().getByRole('button', { name: 'Back' })).toHaveCount(0);
  const skip = (await dialog().getByRole('button', { name: 'Skip tour' }).boundingBox())!, n0 = (await next().boundingBox())!;
  await next().click();
  await stepText(1);
  const back = dialog().getByRole('button', { name: 'Back' });
  await expect(back).toHaveAttribute('data-variant', 'text');
  await expect(next()).toHaveAttribute('data-variant', 'primary');
  const b = (await back.boundingBox())!, n1 = (await next().boundingBox())!, skip1 = (await dialog().getByRole('button', { name: 'Skip tour' }).boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(n1.x + 1);
  expect(b.x).toBeGreaterThan(skip1.x + skip1.width);
  expect(Math.abs(skip1.x - skip.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(n1.x + n1.width - (n0.x + n0.width))).toBeLessThanOrEqual(1);
  await back.click();
  await stepText(0);
  await p.keyboard.press('Escape');
});

test('the click step says it can be done from the keyboard, and Enter on the lit agent moves the tour on', async () => {
  const p = page();
  await next().click();
  await stepText(1);
  await expect(dialog().getByText('Click an agent, or select one and press Enter.', { exact: true })).toBeVisible();
  const lit = p.locator('.hm-grid .kit-card[data-kind="agent"]').first().locator('.kit-card-main');
  await expect(lit).toBeFocused();
  await p.keyboard.press('Enter');
  await stepText(2);
  await expect(p.locator('.hm-grid .kit-card[data-selected]')).toHaveCount(1);
  expect(await p.evaluate(() => (document.querySelector('[role="dialog"][aria-label="Tour"]')?.textContent ?? ''))).not.toContain('Click any agent.');
});

test('a person who presses Next on the click step is not stuck: step three opens an agent that has something to show', async () => {
  await next().click();
  await stepText(1);
  await next().click();
  await stepText(2);
  await expect(page().locator('aside.hm-panel').getByRole('heading', { level: 2 })).not.toHaveText('Pick an agent');
  // ... and the card says that the tour picked it.
  await expect(dialog().getByText(PICKED, { exact: true })).toBeVisible();
});

for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} every card sits beside its target and covers neither the target nor its lit hole`, async () => {
    const p = page();
    await resize(p, w, h);
    for (let i = 0; i < STEPS.length; i += 1) {
      await stepText(i);
      const pop = await rectOf(p, '.tour-pop'), hole = await rectOf(p, '.tour-spot'), target = await visibleTarget(STEPS[i]!.target);
      expect(overlaps(pop, target), `step ${i + 1} covers its target`).toBe(false);
      expect(overlaps(pop, hole), `step ${i + 1} covers its hole`).toBe(false);
      expect(pop.x).toBeGreaterThanOrEqual(0); expect(pop.y).toBeGreaterThanOrEqual(0); expect(pop.x + pop.w).toBeLessThanOrEqual(w); expect(pop.y + pop.h).toBeLessThanOrEqual(h);
      // Beside means close: no more than a card's width or height away from the hole.
      const gapX = Math.max(0, hole.x - (pop.x + pop.w), pop.x - (hole.x + hole.w)), gapY = Math.max(0, hole.y - (pop.y + pop.h), pop.y - (hole.y + hole.h));
      expect(Math.max(gapX, gapY), `step ${i + 1} is beside its target`).toBeLessThanOrEqual(w < 1000 ? 200 : 120);
      if (i < STEPS.length - 1) await next().click();
    }
  });

  test(`step three at ${w} by ${h}: the card does not cover the details it describes, nor the agent that is picked`, async () => {
    const p = page();
    await resize(p, w, h);
    await next().click(); await next().click();
    await stepText(2);
    const pop = await rectOf(p, '.tour-pop'), panel = await rectOf(p, '[data-tour~="details"]');
    const picked = await rectOf(p, '.hm-grid .kit-card[data-selected]');
    expect(overlaps(pop, panel), 'the details panel').toBe(false);
    expect(overlaps(pop, picked), 'the agent that is picked').toBe(false);
    await expect(p.locator('.hm-grid .kit-card[data-selected]')).toHaveCount(1);
  });
}

test('step five tells the truth when seen: the bar shows the changes, and Save keeps them', async () => {
  const p = page();
  for (let i = 0; i < 4; i += 1) await next().click();
  await stepText(4);
  await expect(dialog().getByText('This bar shows your changes. Press Save to keep them.', { exact: true })).toBeVisible();
  await expect(p.getByRole('region', { name: 'Save bar' })).toBeVisible();
  expect(await p.evaluate(() => document.querySelector('.hm-savebar')!.textContent)).toContain('Nothing to save yet');
  expect(await p.evaluate(() => document.querySelector('[role="dialog"][aria-label="Tour"]')!.textContent)).not.toContain('until you press');
});

test('step six lights Share and Version history together and says what they are for', async () => {
  const p = page();
  for (let i = 0; i < 5; i += 1) await next().click();
  await stepText(5);
  const hole = await rectOf(p, '.tour-spot');
  const clock = (await p.locator('nav.hm-nav').getByRole('button', { name: 'Version history', exact: true }).boundingBox())!, share = (await p.locator('nav.hm-nav').getByRole('button', { name: 'Share', exact: true }).boundingBox())!;
  for (const b of [clock, share]) {
    expect(hole.x).toBeLessThanOrEqual(b.x + 1); expect(hole.x + hole.w).toBeGreaterThanOrEqual(b.x + b.width - 1);
    expect(hole.y).toBeLessThanOrEqual(b.y + 1); expect(hole.y + hole.h).toBeGreaterThanOrEqual(b.y + b.height - 1);
  }
  // Add is the item at the top of the navigation, not part of the lit pair: it sits above the hole.
  const add = (await p.locator('nav.hm-nav').getByRole('button', { name: 'Add', exact: true }).boundingBox())!;
  expect(add.y + add.height).toBeLessThanOrEqual(hole.y + 1);
  expect(await p.locator('[data-tour~="share"]').count()).toBe(1);
});

test('every step passes the text budget on the real page, and the steps walk by keyboard alone', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < STEPS.length; i += 1) {
    expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML)), `step ${i + 1}`).toEqual([]);
    await stepText(i);
    await p.keyboard.press('Enter');
  }
  await expect(dialog()).toHaveCount(0);
});

test('after the first Save the note is just the saved line, with no sentence about the tour', async () => {
  const p = page();
  await p.keyboard.press('Escape');
  await p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }).click();
  await p.locator('aside.hm-panel').getByRole('button', { name: 'Remove Write a reply' }).click();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  const note = p.locator('.hm-toast[data-note]');
  await expect(note).toHaveText(SAVED);
  expect(await note.textContent()).not.toMatch(/tour|Help|replay/i);
});

if (SHOTS !== null) {
  for (const [w, h] of SIZES) for (const look of ['light', 'dark'] as const) {
    test(`screenshots: tour step 3 and step 6 at ${w} by ${h}, ${look}`, async () => {
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      for (let i = 0; i < 2; i += 1) await next().click();
      await stepText(2);
      await p.screenshot({ path: join(SHOTS, `tour-step-3-${look}-${w}x${h}.png`), scale: 'css' });
      for (let i = 0; i < 3; i += 1) await next().click();
      await stepText(5);
      await p.screenshot({ path: join(SHOTS, `tour-step-6-${look}-${w}x${h}.png`), scale: 'css' });
    });
  }
}
