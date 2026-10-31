/**
 * The 0.8 home app shell and card kit, in the real window (Electron started with --prototype-v2 and a temporary data folder).
 * It opens, shows the grid of agents, the kit gallery renders in both looks, the drawers manage the focus, reduce motion yields no animation, there is no
 * bridge, no text is under 14 px, nothing is cropped at the two review sizes, and the real page passes the text budget.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone, framesPainted } from './page-wait.js';
import { SIZES, THEMES, ensurePicked, fresh, launchHome, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1440, 900);
  await skipTour(page());
});

test('it opens on the agents: a left navigation, a top row, a grid of ten agent cards, a details panel, a Save bar, and no bridge', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  expect(await p.title()).toBe('Bowerloom');
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  await expect(p.locator('.kit-card[data-kind="agent"]')).toHaveCount(10);
  // Three columns, as in a desktop app: one navigation landmark at the left, the main place, and the details (complementary) at the right.
  await expect(p.getByRole('navigation')).toHaveCount(1); await expect(p.getByRole('main')).toHaveCount(1); await expect(p.getByRole('complementary')).toHaveCount(1);
  const bar = p.locator('nav.hm-nav');
  for (const name of ['Version history', 'Add', 'Help', 'Share', 'Find more', 'Agents', 'Library']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(p.getByText('Nothing to save yet')).toBeVisible();
  for (const id of ['bar', 'map', 'agent', 'details', 'add', 'save', 'help']) await expect(p.locator(`[data-tour~="${id}"]`)).toHaveCount(1);
});

test('the real page stays inside the text budget: no text node over 12 words, no heading or button over 5, no banned word', async () => {
  const p = page();
  const markup = await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML);
  expect(assertTextBudget(markup)).toEqual([]);
  await ensurePicked(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main'));
  await p.getByRole('button', { name: 'Add' }).first().click();
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
});

test('picking an agent fills the three shelves with the same small card; picking it again empties them', async () => {
  const p = page();
  // The first agent in name order has no tool, so the shelves are checked on one that has all three.
  const first = p.locator('.kit-card[data-kind="agent"]').filter({ hasText: 'Meeting assistant' });
  await first.locator('.kit-card-main').click();
  await expect(first.locator('.kit-card-main')).toHaveAttribute('aria-pressed', 'true');
  const panel = p.locator('aside.hm-panel');
  await expect(panel.getByRole('heading', { level: 2 })).not.toHaveText('Pick an agent');
  for (const shelf of ['Skills', 'Tools']) await expect(panel.getByRole('region', { name: shelf }).locator('.kit-card')).not.toHaveCount(0);
  await expect(panel.locator('.kit-card[data-kind="skill"]').first()).toBeVisible();
  // Skills, tools and notes are one card: the same radius, the same border, the same shadow, the same text size.
  await p.mouse.move(2, 450); await animationsDone(p);
  const look = await panel.locator('.kit-card').evaluateAll(cards => cards.map(c => { const s = getComputedStyle(c); const name = getComputedStyle(c.querySelector('.kit-card-main')!); return [s.borderRadius, s.borderTopWidth, s.borderLeftWidth, s.boxShadow, name.fontSize, name.fontWeight].join('|'); }));
  expect(new Set(look).size).toBe(1);
  // An agent card has the same language: the second card is not selected, and the pointer is away from it.
  await p.mouse.move(2, 450); await animationsDone(p);
  const agentLook = await p.locator('.kit-card[data-kind="agent"]').nth(1).evaluate(c => { const s = getComputedStyle(c); const name = getComputedStyle(c.querySelector('.kit-card-main')!); return [s.borderRadius, s.borderTopWidth, s.borderLeftWidth, s.boxShadow, name.fontSize, name.fontWeight].join('|'); });
  expect(agentLook).toBe(look[0]);
  await first.locator('.kit-card-main').click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Pick an agent');
});

test('a card is 10 px round with a 1 px border on every side, an agent tile is 250 by 124 (the redesigned tile; it was 92) and a row is at least 176 wide and 44 tall (Wave D: 12 px, 240 wide, 130 to 200 tall, 70 to 125 tall)', async () => {
  const p = page();
  await ensurePicked(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main'));
  // The first agent is the one that is picked, and a picked card has a 2 px edge; the card beside it is a plain one, with the 1 px edge on every side.
  const picked = await p.locator('.kit-card[data-kind="agent"]').first().evaluate(c => { const s = getComputedStyle(c); return [s.borderRadius, s.borderTopWidth, s.borderLeftWidth, s.borderRightWidth, s.borderBottomWidth]; });
  expect(picked).toEqual(['10px', '2px', '2px', '2px', '2px']);
  const agent = await p.locator('.kit-card[data-kind="agent"]').nth(1).evaluate(c => { const r = c.getBoundingClientRect(), s = getComputedStyle(c); return { w: r.width, h: r.height, radius: s.borderRadius, top: s.borderTopWidth, left: s.borderLeftWidth, right: s.borderRightWidth, bottom: s.borderBottomWidth }; });
  expect(agent.w).toBe(250); expect(agent.h).toBe(124);   // one tile, whatever the agent holds (Wave D)
  expect([agent.radius, agent.top, agent.left, agent.right, agent.bottom]).toEqual(['10px', '1px', '1px', '1px', '1px']);
  const small = await p.locator('.kit-card[data-size="small"]').first().evaluate(c => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  expect(small.w).toBeGreaterThanOrEqual(176); expect(small.h).toBe(44);
});

test('no text on the page is under 14 px, and the card name, hint, page title, section heading, button and body sizes are 15, 14, 18, 16, 14 and 14 (Wave D: 16, 14, 20, 20, 16 and 16)', async () => {
  const p = page();
  await ensurePicked(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main'));
  const sizes = await p.evaluate(() => {
    const out: { text: string; size: number; tag: string }[] = [];
    const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim(); const el = n.parentElement;
      if (text === '' || el === null || el.closest('svg, .hm-sr')) continue;
      out.push({ text, size: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName });
    }
    return out;
  });
  expect(sizes.length).toBeGreaterThan(30);
  expect(sizes.filter(s => s.size < 14), JSON.stringify(sizes.filter(s => s.size < 14))).toEqual([]);
  const measure = await p.evaluate(() => {
    const px = (sel: string): number => parseFloat(getComputedStyle(document.querySelector(sel)!).fontSize);
    return { label: px('.kit-card-main'), hint: px('.kit-hint'), heading: px('h1.kit-heading'), h2: px('h2.kit-heading'), h3: px('h3.kit-heading'), button: px('.hm-savebar .kit-button, .kit-drawer .kit-button, .hm-stage-tools .kit-button'), body: px('.hm-savebar p') };
  });
  console.log('MEASURED font sizes (px):', JSON.stringify(measure));
  expect(measure).toMatchObject({ label: 15, hint: 14, heading: 18, h2: 16, h3: 16, button: 14, body: 14 });
});

test('the Add and Version history drawers take the focus, close with Escape and the Close button, return the focus, and only one is open', async () => {
  const p = page();
  const add = p.locator('nav.hm-nav').getByRole('button', { name: 'Add' }), points = p.locator('nav.hm-nav').getByRole('button', { name: 'Version history' });
  await add.focus(); await p.keyboard.press('Enter');
  const drawer = p.getByRole('dialog', { name: 'Add' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { level: 2, name: 'Add' })).toBeFocused();
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  const box = (await drawer.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(380.5); expect(box.x + box.width).toBeGreaterThan(1439);
  await animationsDone(p);
  await p.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(add).toBeFocused();
  await points.click();
  await expect(p.getByRole('dialog', { name: 'Version history' })).toBeVisible();
  await add.click();
  await expect(p.getByRole('dialog')).toHaveCount(1); await expect(p.getByRole('dialog', { name: 'Add' })).toBeVisible();
  await p.getByRole('dialog', { name: 'Add' }).getByRole('button', { name: 'Close' }).click();
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(add).toBeFocused();
});

test('the "?" Help button opens one sentence and Show me around; Escape closes it and keeps the focus on the button', async () => {
  const p = page();
  const help = p.getByRole('button', { name: 'Help' });
  await help.click();
  const pop = p.locator('.kit-popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('p')).toHaveText(/tour/i);
  await expect(pop.getByRole('button', { name: 'Show me around' })).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(help).toBeFocused();
});

test('the Tab order follows the reading order: the navigation (its toggle, its one stop, the Preview mark), the top row, then the agents, then the shelves, then Save', async () => {
  const p = page();
  await p.locator('a.skip').focus();
  const names: string[] = [];
  for (let i = 0; i < 18; i += 1) {
    await p.keyboard.press('Tab');
    names.push(await p.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el === null ? '' : (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(); }));
  }
  const at = (n: string): number => names.indexOf(n);
  // The navigation is the toggle, ONE stop for all its items (the arrow keys move inside it), and the Preview mark; then the top row (Sort, the details toggle).
  expect(names.slice(0, 6)).toEqual(['Skip to details', 'Hide navigation', 'Agents', 'About this preview', 'Sort', 'Hide details']);
  for (const word of ['Add', 'Share', 'Version history', 'Help', 'Find more', 'Library']) expect(names.includes(word), `${word} is reached by the arrow keys, not by Tab`).toBe(false);
  // The agents are one stop (the arrow keys reach the others): the tile that is picked, its counts, then the details panel.
  expect(at('Inbox sorter')).toBeGreaterThan(at('Hide details')); expect(at('Interview notetaker')).toBe(-1);
  expect(at('4 skills')).toBe(at('Inbox sorter') + 1); expect(at('Write a short summary')).toBeGreaterThan(at('1 note set'));
});

test('the card kit gallery renders every part in a light and a dark look', async () => {
  const p = page();
  await fresh(p, '#prototype-v2/kit');
  await expect(p.getByRole('heading', { level: 1, name: 'Card kit' })).toBeVisible();
  await expect(p.locator('[data-theme="light"][data-home]')).toHaveCount(1); await expect(p.locator('[data-theme="dark"][data-home]')).toHaveCount(1);
  for (const look of ['light', 'dark']) {
    const scope = p.locator(`[data-theme="${look}"][data-home]`);
    await expect(scope.locator('.kit-card[data-size="tile"]')).toHaveCount(5);   // the five agent tiles of Wave D
    await expect(scope.locator('.kit-card[data-size="small"]')).toHaveCount(5 + 8 + 3 + 8 + 12);   // 5 ready-made agents, 8 cards, 3 and 8 on shelves, and the 12 rows of the open tray
    await expect(scope.locator('.kit-card[data-selected]').first()).toBeVisible();
    await expect(scope.locator('.kit-status[data-tone="warn"]').first()).toBeVisible(); await expect(scope.locator('.kit-status[data-tone="new"]').first()).toBeVisible();
    await expect(scope.locator('.kit-avatar')).toHaveCount(0);
    await expect(scope.locator('.hm-gallery-block:has(h3:text-is("Tiles")) .kit-tile')).toHaveCount(6);
    await expect(scope.getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
    await expect(scope.getByRole('button', { name: 'Show more skills' })).toBeVisible();   // the long list of an agent card
    await expect(scope.locator('.kit-popover')).toBeVisible();
    await expect(scope.locator('.kit-drawer')).toBeVisible();
    await expect(scope.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  }
  // The dark look is really dark: its page is darker than its text.
  const colours = await p.evaluate(() => ['light', 'dark'].map(l => { const el = document.querySelector(`[data-theme="${l}"][data-home]`)!; const s = getComputedStyle(el); return [s.backgroundColor, s.color]; }));
  const lum = (c: string): number => { const m = c.match(/\d+/g)!.map(Number); return (m[0]! + m[1]! + m[2]!) / 3; };
  expect(lum(colours[0]![0]!)).toBeGreaterThan(200); expect(lum(colours[1]![0]!)).toBeLessThan(60); expect(lum(colours[1]![1]!)).toBeGreaterThan(200);
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  // A state stays on one line and inside its card, even in the narrowest small card; a name is never cut to dots.
  const fit = await p.evaluate(() => [...document.querySelectorAll('.kit-card .kit-status')].map(b => { const c = b.closest('.kit-card')!.getBoundingClientRect(), r = b.getBoundingClientRect(); return { h: r.height, inside: r.right <= c.right && r.left >= c.left }; }));
  expect(fit.length).toBeGreaterThan(4); expect(fit.every(f => f.h < 36 && f.inside), JSON.stringify(fit)).toBe(true);
  const cut = await p.evaluate(() => [...document.querySelectorAll('.kit-card-main')].filter(e => e.scrollHeight > e.clientHeight + 1).length);
  expect(cut).toBe(0);
  const badge = await p.locator('.kit-status').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  console.log('MEASURED badge font size (px):', badge);
  expect(badge).toBeGreaterThanOrEqual(14);
});

test('with reduce motion on, the drawer and the cards run no animation and no transition', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p);
  await skipTour(p);
  await p.locator('nav.hm-nav').getByRole('button', { name: 'Add' }).click();
  await expect(p.getByRole('dialog', { name: 'Add' })).toBeVisible();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  const times = await p.evaluate(() => [...document.querySelectorAll('.kit-card, .kit-button, .kit-drawer')].map(e => { const s = getComputedStyle(e); return [s.animationName === 'none' || parseFloat(s.animationDuration) === 0, s.transitionDuration.split(',').every(d => parseFloat(d) === 0)]; }).flat());
  expect(times.every(Boolean)).toBe(true);
  await p.locator('.kit-card[data-kind="agent"]').first().hover();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('the drawer slides in over 220 ms, and the card hover is 90 ms, when motion is on', async () => {
  const p = page();
  const t = await p.evaluate(() => { const s = getComputedStyle(document.documentElement); return { drawer: s.getPropertyValue('--motion-home-drawer-ms'), hover: s.getPropertyValue('--motion-hover-ms'), spot: s.getPropertyValue('--motion-home-tour-spot-ms') }; });
  expect(t).toEqual({ drawer: '220ms', hover: '90ms', spot: '160ms' });
  const card = p.locator('.kit-card[data-kind="agent"]').first();
  expect(await card.evaluate(c => getComputedStyle(c).transitionDuration)).toContain('0.09s');
});

for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} nothing is cropped or overflows: no sideways scroll, every card inside the stage, the panel and the bar in view`, async () => {
    const p = page();
    await resize(p, w, h);
    const stage = await p.evaluate(() => {
      const doc = document.documentElement, stageEl = document.querySelector('main.hm-stage')!.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.hm-grid .kit-card[data-kind="agent"]')].map(c => c.getBoundingClientRect());
      // Wave D: a name and a hint are one line and may be cut sideways, but only with an ellipsis.
      const texts = [...document.querySelectorAll('.kit-card-main, .kit-card-hint')].map(e => ({ over: e.scrollHeight - e.clientHeight, w: getComputedStyle(e).textOverflow === 'ellipsis' ? 0 : e.scrollWidth - e.clientWidth }));
      const panel = document.querySelector('aside.hm-panel')!.getBoundingClientRect(), bar = document.querySelector('.hm-savebar')!.getBoundingClientRect(), top = document.querySelector('.hm-topbar')!.getBoundingClientRect();
      return { sideways: doc.scrollWidth - doc.clientWidth, inside: cards.every(c => c.left >= stageEl.left && c.right <= stageEl.right + 0.5), clipped: texts.filter(t => t.over > 1 || t.w > 1).length, panelRight: panel.right, barBottom: bar.bottom, vw: window.innerWidth, vh: window.innerHeight, topH: top.height, columns: new Set(cards.map(c => Math.round(c.left))).size };
    });
    expect(stage.sideways).toBeLessThanOrEqual(0); expect(stage.inside).toBe(true); expect(stage.clipped).toBe(0);
    expect(stage.panelRight).toBeLessThanOrEqual(stage.vw + 0.5); expect(stage.barBottom).toBeLessThanOrEqual(stage.vh + 0.5);
    expect(stage.columns).toBeGreaterThanOrEqual(2);
    await ensurePicked(p.locator('.kit-card[data-kind="agent"]').first().locator('.kit-card-main'));
    const shelfOk = await p.evaluate(() => [...document.querySelectorAll('aside.hm-panel .kit-card')].every(c => { const r = c.getBoundingClientRect(), panel = document.querySelector('aside.hm-panel')!.getBoundingClientRect(); return r.right <= panel.right + 0.5 && r.left >= panel.left; }));
    expect(shelfOk).toBe(true);
  });
}

if (shotsDirSet()) {
  for (const [w, h] of SIZES) for (const look of THEMES) {
    test(`screenshots at ${w} by ${h}, ${look}: the shell, the kit gallery, the Add drawer`, async () => {
      test.setTimeout(120_000);
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await skipTour(p);
      await shot(p, 'shell', w, h, look);
      await p.locator('.kit-card[data-kind="agent"]').nth(8).locator('.kit-card-main').click();
      await shot(p, 'shell-picked', w, h, look);
      await p.locator('.kit-card[data-kind="agent"]').nth(8).locator('.kit-card-main').click();
      await p.locator('nav.hm-nav').getByRole('button', { name: 'Add' }).click();
      await expect(p.getByRole('dialog', { name: 'Add' })).toBeVisible();
      await shot(p, 'add-drawer', w, h, look);
      await p.keyboard.press('Escape');
      await fresh(p, '#prototype-v2/kit'); await setLook(p, look); await resize(p, w, h);
      await shot(p, 'kit-gallery', w, h, look, true);
    });
  }
}
function shotsDirSet(): boolean { return process.env.HOME_U0_SHOTS !== undefined; }
