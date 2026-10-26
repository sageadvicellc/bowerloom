/**
 * The guided tour of the 0.8 home app, in the real window (Electron started with --prototype-v2). It runs once on first mount, walks seven steps with the
 * keyboard (Next, Back, Escape), lights each target with a hole that contains it, keeps the popover off the target, moves the focus in and gives it back,
 * announces each step, works with reduce motion, survives a missing target and a resize, does not run twice in one session, and replays from Help.
 * Set HOME_U0_SHOTS to a folder to also save tour step 2 at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { SIZES, THEMES, fresh, launchHome, overlaps, rectOf, resize, setLook, shot } from './home-page.js';
import type { Home, Rect } from './home-page.js';

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

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), undefined, { tour: true });
  await resize(page(), 1440, 900);
});

/** The lit hole, the popover and the target, measured once the tour has stopped moving. */
async function measureStep(target: string): Promise<{ hole: Rect; pop: Rect; target: Rect; vw: number; vh: number }> {
  const p = page();
  await animationsDone(p);
  const hole = await rectOf(p, '.tour-spot'), pop = await rectOf(p, '.tour-pop');
  // The target is what a person can see of it: cut to what its scrolling parents show, as the tour cuts its hole. The cards grew taller (chips), so the grid of agents
  // is now taller than the stage it scrolls in, and its lower part is not on the screen.
  const t = await p.evaluate(id => {
    const el = document.querySelector(`[data-tour~="${id}"]`)!;
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top, right = r.right, bottom = r.bottom;
    for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const q = parent.getBoundingClientRect();
      x = Math.max(x, q.left); y = Math.max(y, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom);
    }
    return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
  }, target);
  return { hole, pop, target: t, ...(await p.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }))) };
}
const contains = (outer: Rect, inner: Rect, slack = 1): boolean => outer.x <= inner.x + slack && outer.y <= inner.y + slack && outer.x + outer.w >= inner.x + inner.w - slack && outer.y + outer.h >= inner.y + inner.h - slack;

test('the tour starts by itself on first mount, on step one, with its sentence, the step and the buttons, and the focus is inside it', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  await expect(dialog().getByText(STEPS[0].text)).toBeVisible();
  await expect(dialog().getByText('1 of 7')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused();
  await expect(dialog().getByRole('button', { name: 'Back' })).toHaveCount(0);
  await expect(dialog().getByRole('button', { name: 'Skip tour' })).toBeVisible();
  expect(await p.locator('.tour-dot').count()).toBe(7);
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
});

test('the keyboard walks every step with Next and Back; each step lights its target and the popover never covers it', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i]!;
    await expect(dialog().getByText(step.text)).toBeVisible();
    await expect(dialog().getByText(`${i + 1} of 7`)).toBeVisible();
    const m = await measureStep(step.target);
    expect(contains(m.hole, m.target.w > m.vw || m.target.h > m.vh ? { ...m.target, w: Math.min(m.target.w, m.vw - m.target.x), h: Math.min(m.target.h, m.vh - m.target.y) } : m.target, 2), `step ${i + 1}: the hole holds the target ${JSON.stringify(m)}`).toBe(true);
    expect(overlaps(m.pop, m.target), `step ${i + 1}: the popover covers the target ${JSON.stringify(m)}`).toBe(false);
    expect(overlaps(m.pop, m.hole), `step ${i + 1}: the popover covers the lit hole`).toBe(false);
    expect(m.pop.x).toBeGreaterThanOrEqual(0); expect(m.pop.y).toBeGreaterThanOrEqual(0); expect(m.pop.x + m.pop.w).toBeLessThanOrEqual(m.vw); expect(m.pop.y + m.pop.h).toBeLessThanOrEqual(m.vh);
    if (step.target === 'agent') {
      // Step two waits for the person: Next is in its place all the same, the focus is on the lit agent, and Enter on it is the click that moves the tour on.
      await expect(dialog().getByRole('button', { name: 'Next' })).toBeEnabled();
      await expect(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main')).toBeFocused();
      await p.keyboard.press('Enter');
    } else if (i < STEPS.length - 1) { await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused(); await p.keyboard.press('Enter'); }
  }
  await expect(dialog().getByRole('button', { name: 'Done' })).toBeFocused();
  // Back with the keyboard: Shift+Tab to Back, Enter.
  await p.keyboard.press('Shift+Tab');
  await expect(dialog().getByRole('button', { name: 'Back' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(dialog().getByText(STEPS[5].text)).toBeVisible();
  await expect(dialog().getByText('6 of 7')).toBeVisible();
  await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
  await expect(dialog().getByText(STEPS[6].text)).toBeVisible();
  await p.keyboard.press('Enter');
  await expect(dialog()).toHaveCount(0);
  await expect(p.locator('.tour-layer')).toHaveCount(0);
});

test('Escape skips the tour from any step, and the focus goes back to the first heading when nothing had it', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeFocused();
});

test('the spotlight moves in 160 ms and stops, and the dim blocks the page behind it', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  expect(await p.locator('.tour-spot').evaluate(e => getComputedStyle(e).transitionDuration.split(',')[0])).toBe('0.16s');
  // A click on the lit target does nothing while the tour runs: the layer takes it.
  await p.mouse.click(5, 450);
  await expect(dialog()).toBeVisible();
  await p.locator('.kit-card[data-kind="agent"]').first().click({ force: true, position: { x: 30, y: 30 } });
  await expect(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main')).toHaveAttribute('aria-pressed', 'false');
});

test('Tab stays inside the popover, in both directions', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < 7; i += 1) { await p.keyboard.press('Tab'); expect(await p.evaluate(() => document.activeElement?.closest('.tour-pop') !== null)).toBe(true); }
  for (let i = 0; i < 7; i += 1) { await p.keyboard.press('Shift+Tab'); expect(await p.evaluate(() => document.activeElement?.closest('.tour-pop') !== null)).toBe(true); }
});

test('each step is announced in a polite live region: the step and the sentence', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  const live = p.locator('.hm-sr[role="status"]');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText(`Step 1 of 7 ${STEPS[0].text}`);
  await p.keyboard.press('Enter');
  await expect(live).toHaveText(`Step 2 of 7 ${STEPS[1].text}`);
  await p.keyboard.press('Escape');
  await expect(live).toHaveText('');
});

test('the tour does not run twice in one session, and replays from Help with "Show me around"; Escape then gives the focus back to Help', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  // To the kit gallery and back: the app mounts again, and the tour stays away.
  await p.evaluate(() => { location.hash = '#prototype-v2/kit'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Card kit' })).toBeVisible();
  await p.evaluate(() => { location.hash = '#prototype-v2/map/tour'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await framesPainted(p);
  await expect(dialog()).toHaveCount(0);
  // Nothing was written anywhere to remember it.
  expect(await p.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  const help = p.getByRole('button', { name: 'Help' });
  await help.click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(dialog()).toBeVisible();
  await expect(dialog().getByText(STEPS[0].text)).toBeVisible();
  await expect(dialog().getByText('1 of 7')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(help).toBeFocused();
  // A reload is a new session, and the tour runs again.
  await fresh(p, undefined, { tour: true });
  await expect(dialog()).toBeVisible();
});

test('a target that is not on the page leaves a centered popover on a plain dim, and the tour carries on', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  await p.evaluate(() => { document.querySelector('[data-tour~="add"]')!.setAttribute('data-tour', 'gone'); });
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await expect(dialog().getByText(STEPS[3].text)).toBeVisible();
  await animationsDone(p);
  const pop = await rectOf(p, '.tour-pop'), vp = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(Math.abs(pop.x + pop.w / 2 - vp.w / 2)).toBeLessThanOrEqual(2); expect(Math.abs(pop.y + pop.h / 2 - vp.h / 2)).toBeLessThanOrEqual(2);
  await expect(p.locator('.tour-layer')).toHaveAttribute('data-missing', '');
  expect(await p.locator('.tour-dim').evaluate(e => getComputedStyle(e).display)).toBe('block');
  await p.keyboard.press('Enter');
  await expect(dialog().getByText(STEPS[4].text)).toBeVisible();
  await expect(p.locator('.tour-layer')).not.toHaveAttribute('data-missing', '');
});

test('the spotlight follows its target when the window is resized', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < 3; i += 1) await p.keyboard.press('Enter');
  await expect(dialog().getByText(STEPS[3].text)).toBeVisible();
  for (const [w, h] of [[900, 600], [1440, 900], [1100, 700]] as const) {
    await resize(p, w, h);
    const m = await measureStep('add');
    expect(contains(m.hole, m.target, 2), `at ${w} by ${h}`).toBe(true);
    expect(overlaps(m.pop, m.target), `at ${w} by ${h}`).toBe(false);
    expect(m.pop.x + m.pop.w).toBeLessThanOrEqual(w); expect(m.pop.y + m.pop.h).toBeLessThanOrEqual(h);
  }
});

test('the popover keeps off every target at 900 by 600 as well', async () => {
  const p = page();
  await resize(p, 900, 600);
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < STEPS.length; i += 1) {
    const m = await measureStep(STEPS[i]!.target);
    expect(overlaps(m.pop, { ...m.target, w: Math.min(m.target.w, m.vw - m.target.x), h: Math.min(m.target.h, m.vh - m.target.y) }), `step ${i + 1} ${JSON.stringify(m)}`).toBe(false);
    expect(m.pop.x).toBeGreaterThanOrEqual(0); expect(m.pop.x + m.pop.w).toBeLessThanOrEqual(m.vw);
    if (i < STEPS.length - 1) await p.keyboard.press('Enter');
  }
});

test('with reduce motion on, the tour runs no animation and no transition at all', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p, undefined, { tour: true });
  await expect(dialog()).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await framesPainted(p);
    expect(await p.evaluate(() => document.getAnimations().length), `step ${i + 1}`).toBe(0);
    expect(await p.evaluate(() => [...document.querySelectorAll('.tour-spot, .tour-pop')].every(e => getComputedStyle(e).transitionDuration.split(',').every(d => parseFloat(d) === 0)))).toBe(true);
    await p.keyboard.press('Enter');
  }
  await expect(dialog().getByText(STEPS[5].text)).toBeVisible();
});

test('the tour uses no storage and the tour text passes the text budget on the real page', async () => {
  const p = page();
  await expect(dialog()).toBeVisible();
  const { assertTextBudget } = await import('../shared/home/textbudget.js');
  for (let i = 0; i < STEPS.length; i += 1) { expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML)), `step ${i + 1}`).toEqual([]); await p.keyboard.press('Enter'); }
  expect(await p.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

if (process.env.HOME_U0_SHOTS !== undefined) {
  for (const [w, h] of SIZES) for (const look of THEMES) {
    test(`screenshot: tour step 2 at ${w} by ${h}, ${look}`, async () => {
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await expect(dialog()).toBeVisible();
      await p.keyboard.press('Enter');
      await expect(dialog().getByText(STEPS[1].text)).toBeVisible();
      await shot(p, 'tour-step-2', w, h, look);
      await p.keyboard.press('Enter');
      await shot(p, 'tour-step-3', w, h, look);
    });
  }
}
