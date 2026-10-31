/**
 * Wave F, the shell as a desktop app, in the real window (Electron started with --home-sample): three columns as in the Claude and ChatGPT desktop apps. The left navigation
 * (232 px open, a 48 px icon rail when put away, hidden under 900 px where its toggle opens it over the page), the middle (a slim top row with the page title and the page's icon
 * buttons, then the stage), and the details at the right (put away with its own icon at the top right). Both toggles are real buttons with a name, aria-expanded, aria-controls
 * and a tooltip that names the shortcut (Ctrl or Cmd + B for the navigation, with Shift for the details). The state of both lives in memory only.
 * Checked at 1280 by 800 and 900 by 600: column widths, collapse and expand with the icons and with the keys, the landmarks, the Tab order and the arrow keys of the navigation,
 * Escape one layer at a time, no sideways scroll.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';
import { fresh, launchHome, rectOf, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const nav = (): Locator => page().locator('nav.hm-nav');
const navToggle = (): Locator => page().locator('[data-nav-toggle]:visible');
const detailsToggle = (): Locator => page().locator('[data-details-toggle]');
const panel = (): Locator => page().locator('aside.hm-panel');
const item = (name: string): Locator => nav().getByRole('button', { name, exact: true });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const sideways = async (): Promise<number> => page().evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const widthOf = async (selector: string): Promise<number> => (await rectOf(page(), selector)).w;

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

// ---- 1. Three columns at 1280 by 800.
test('at 1280 by 800 there are three columns: a 232 px navigation, the middle, and a 320 px details column; the Save bar sits under the middle and the right', async () => {
  const p = page();
  await expect(nav()).toBeVisible(); await expect(p.locator('main.hm-stage')).toBeVisible(); await expect(panel()).toBeVisible();
  const n = await rectOf(p, 'nav.hm-nav'), m = await rectOf(p, 'main.hm-stage'), d = await rectOf(p, 'aside.hm-panel'), s = await rectOf(p, '.hm-savebar'), t = await rectOf(p, '.hm-topbar');
  expect(n.w).toBe(232); expect(n.x).toBe(0); expect(n.h).toBe(800);   // the navigation is the full height of the window
  expect(d.w).toBe(320); expect(d.x + d.w).toBe(1280);
  expect(m.x).toBe(232); expect(m.x + m.w).toBe(d.x);   // the middle fills what is left, with no gap and no overlap
  expect(t.x).toBe(232); expect(t.w).toBe(1048); expect(t.h).toBe(52);   // the top row spans the middle and the details
  expect(s.x).toBe(232); expect(s.w).toBe(1048); expect(s.y + s.h).toBe(800);
  expect(await sideways()).toBeLessThanOrEqual(0);
  expect(await budget()).toEqual([]);
});

test('the navigation lists, from the top: Add; the section Workspace with Agents and Library; the section More with Find more, Share and Version history; Help and the Preview mark at the foot', async () => {
  const p = page();
  // The Library's four pages are folded away on the Agents page, so they are not on show (they are in the page, but unseen and not reachable).
  const labels = await nav().locator('[data-nav-item]:visible').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()));
  expect(labels).toEqual(['Add', 'Workspace', 'Agents', 'Library', 'More', 'Find more', 'Share', 'Version history', 'Help']);
  const ys = await nav().locator('[data-nav-item]:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  // The toggle is the very first thing at the top left, with the mark and the name beside it; the lower group is pinned to the foot, with the Preview mark last.
  const toggle = await rectOf(p, 'nav.hm-nav [data-nav-toggle]'), brand = await rectOf(p, 'nav.hm-nav .hm-brand');
  expect(toggle.x).toBeLessThan(16); expect(toggle.y).toBeLessThan(16); expect(brand.x).toBeGreaterThan(toggle.x + toggle.w);
  const preview = await rectOf(p, 'nav.hm-nav .hm-preview'), help = await rectOf(p, 'nav.hm-nav [data-tour="help"]');
  expect(preview.y).toBeGreaterThan(help.y); expect(preview.y + preview.h).toBeGreaterThan(740);
  await expect(nav().locator('.hm-preview')).toContainText('Preview');
  // Add is the one primary item. No item is a check mark or a tab.
  expect(await item('Add').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(nav().getByRole('tab')).toHaveCount(0);
});

// ---- 2. The navigation toggle.
test('the navigation toggle puts the navigation away to a 48 px rail and brings it back: icon, Ctrl or Cmd + B, aria-expanded, aria-controls and the focus stays on it', async () => {
  const p = page();
  const toggle = navToggle();
  await expect(toggle).toHaveAttribute('aria-label', 'Hide navigation'); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(toggle).toHaveAttribute('aria-controls', 'hm-nav');
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
  expect(await toggle.locator('svg').count()).toBe(1); expect((await toggle.innerText()).trim()).toBe('');
  const box = (await toggle.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Show navigation'); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(48);
  expect(await widthOf('main.hm-stage')).toBe(1280 - 48 - 320);
  await expect(toggle).toBeFocused();
  // In the rail the words are not on show, every item is an icon with a name, and the lower group stays in the window.
  for (const name of ['Add', 'Agents', 'Library', 'Find more', 'Share', 'Version history', 'Help']) {
    const b = (await item(name).boundingBox())!;
    expect(b.width, name).toBeGreaterThanOrEqual(32); expect(b.height, name).toBeGreaterThanOrEqual(32); expect(b.x + b.width, name).toBeLessThanOrEqual(48);
    expect(await item(name).evaluate(el => (el.querySelector('.hm-nav-label') as HTMLElement).getBoundingClientRect().width), name).toBeLessThanOrEqual(1);
  }
  expect(await sideways()).toBeLessThanOrEqual(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(232);
  // The keyboard does the same, from anywhere on the page (the focus is on the agent tile here).
  await p.locator('.kit-card[data-kind="agent"] .kit-card-main').first().focus();
  await p.keyboard.press('ControlOrMeta+b');
  await animationsDone(p); expect(await widthOf('nav.hm-nav')).toBe(48);
  await p.keyboard.press('ControlOrMeta+b');
  await animationsDone(p); expect(await widthOf('nav.hm-nav')).toBe(232);
  expect(await budget()).toEqual([]);
});

test('the navigation state is kept in memory only: a reload starts again from the window width', async () => {
  const p = page();
  await navToggle().click(); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(48);
  expect(await p.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  await fresh(p); await resize(p, 1280, 800); await skipTour(p);
  expect(await widthOf('nav.hm-nav')).toBe(232);
});

// ---- 3. The details toggle.
test('the details toggle is an icon at the top right of the window: it puts the details column away and brings it back, with the icon and with Ctrl or Cmd + Shift + B', async () => {
  const p = page();
  const toggle = detailsToggle();
  await expect(toggle).toHaveAttribute('aria-label', 'Hide details'); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(toggle).toHaveAttribute('aria-controls', 'hm-panel');
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+B Meta+Shift+B');
  expect((await toggle.innerText()).trim()).toBe('');
  const t = (await toggle.boundingBox())!;
  expect(t.x + t.width).toBeGreaterThan(1280 - 20); expect(t.y).toBeLessThan(16); expect(t.width).toBeGreaterThanOrEqual(32); expect(t.height).toBeGreaterThanOrEqual(32);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Show details'); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel()).toBeHidden();
  expect(await widthOf('main.hm-stage')).toBe(1280 - 232);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(panel()).toBeVisible(); expect(await widthOf('aside.hm-panel')).toBe(320);
  await p.keyboard.press('ControlOrMeta+Shift+b');
  await expect(panel()).toBeHidden();
  await p.keyboard.press('ControlOrMeta+Shift+b');
  await expect(panel()).toBeVisible();
  // The two toggles do not move each other.
  await p.keyboard.press('ControlOrMeta+b'); await animationsDone(p);
  await expect(panel()).toBeVisible(); expect(await widthOf('nav.hm-nav')).toBe(48);
  await p.keyboard.press('ControlOrMeta+b'); await animationsDone(p);
  expect(await sideways()).toBeLessThanOrEqual(0);
});

test('the toggles say their shortcut in the tooltip, and the old "Show details" text link and the "Agents | Library" switch are gone', async () => {
  const p = page();
  await navToggle().hover();
  const tip = p.getByRole('tooltip');
  await expect(tip).toBeVisible({ timeout: 2000 });
  await expect(tip).toHaveText(/^Hide navigation \((?:Ctrl\+B|⌘B)\)$/);
  await p.mouse.move(640, 500); await expect(tip).toBeHidden();
  await detailsToggle().hover();
  await expect(tip).toBeVisible({ timeout: 2000 });
  await expect(tip).toHaveText(/^Hide details \((?:Ctrl\+Shift\+B|⇧⌘B)\)$/);
  // The tooltip sits under the toggle at the top right, inside the window, and never covers the button.
  const b = (await detailsToggle().boundingBox())!, t = (await tip.boundingBox())!;
  expect(t.y).toBeGreaterThanOrEqual(b.y + b.height); expect(t.x + t.width).toBeLessThanOrEqual(1280 + 0.5); expect(t.x).toBeGreaterThanOrEqual(0);
  await p.mouse.move(640, 500);
  await expect(p.getByRole('button', { name: 'Show details', exact: true })).toHaveCount(0);   // while the column is open the only toggle says Hide
  await expect(p.getByRole('tablist')).toHaveCount(0);
  await expect(p.locator('.hm-switch')).toHaveCount(0);
  await expect(p.locator('.hm-stage-tools')).toHaveCount(0);
});

// ---- 4. Landmarks and headings.
test('the landmarks are one navigation, one main place and one complementary column, and the page title is the one h1', async () => {
  const p = page();
  await expect(p.getByRole('navigation', { name: 'Main menu' })).toHaveCount(1);
  await expect(p.getByRole('main')).toHaveCount(1);
  await expect(p.getByRole('complementary')).toHaveCount(1);
  await expect(p.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Agents');
  // The page you are on is marked with aria-current, and nothing else is.
  await expect(item('Agents')).toHaveAttribute('aria-current', 'page');
  await expect(nav().locator('[aria-current="page"]')).toHaveCount(1);
  // A soft fill and a medium weight (the branching look has no edge), and no check mark.
  const look = await item('Agents').evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, weight: s.fontWeight }; });
  expect(look.bg).not.toBe('rgba(0, 0, 0, 0)'); expect(look.weight).toBe('500');
  expect(await nav().locator('svg path[d*="M5 12.5l4.5 4.5L19 7.5"]').count()).toBe(0);
});

// ---- 5. The keyboard.
test('the navigation is one Tab stop; Up and Down move through its items, Home and End jump, Enter presses; the stop is where the focus left', async () => {
  const p = page();
  await navToggle().focus();
  await p.keyboard.press('Tab');
  await expect(item('Agents')).toBeFocused();   // the stop is the page you are on
  // The two section headers are items too; the folded Library pages are skipped.
  const order = ['Add', 'Workspace', 'Agents', 'Library', 'More', 'Find more', 'Share', 'Version history', 'Help'];
  await p.keyboard.press('ArrowUp'); await expect(item('Workspace')).toBeFocused();
  await p.keyboard.press('ArrowUp'); await expect(item('Add')).toBeFocused();
  await p.keyboard.press('ArrowUp'); await expect(item('Add')).toBeFocused();   // it stops at the top
  for (const name of order.slice(1)) { await p.keyboard.press('ArrowDown'); await expect(item(name)).toBeFocused(); }
  await p.keyboard.press('ArrowDown'); await expect(item('Help')).toBeFocused();   // and at the foot
  await p.keyboard.press('Home'); await expect(item('Add')).toBeFocused();
  await p.keyboard.press('End'); await expect(item('Help')).toBeFocused();
  // Tab leaves the group, and Shift+Tab comes back to the item that had the focus last.
  await p.keyboard.press('Tab'); await expect(p.getByRole('button', { name: 'About this preview' })).toBeFocused();
  await p.keyboard.press('Shift+Tab'); await expect(item('Help')).toBeFocused();
  // Enter presses the focused item: Library opens its pages.
  for (let i = 0; i < 5; i += 1) await p.keyboard.press('ArrowUp');   // History, Share, Find more, More, Library
  await expect(item('Library')).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Library');
  await expect(item('Library')).toBeFocused();
});

// ---- 6. Library inside the navigation.
test('Library opens in place into Skills, Agents, Tools and Notes; each opens the Library on that tab, and the tab you are on is marked', async () => {
  const p = page();
  // Folded on the Agents page: the pages are drawn but unseen, and the folder says it is closed.
  await expect(item('Library')).toHaveAttribute('aria-expanded', 'false'); await expect(nav().locator('.hm-nav-sub')).toBeHidden();
  await item('Library').click();
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Library');
  await expect(item('Library')).toHaveAttribute('aria-expanded', 'true');
  const sub = nav().locator('.hm-nav-sub');
  await expect(sub.getByRole('button')).toHaveText(['Skills', 'Agents', 'Tools', 'Notes']);
  await expect(sub.getByRole('button', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
  await expect(p.getByRole('tab', { name: /^Skills/ })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Tools', 'Notes', 'Agents', 'Skills']) {
    await sub.getByRole('button', { name, exact: true }).click();
    await expect(p.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-selected', 'true');
    await expect(sub.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav().locator('[aria-current="page"]')).toHaveCount(1);
  }
  // The tabs in the page and the items in the navigation say the same thing.
  await p.getByRole('tab', { name: /^Notes/ }).click();
  await expect(sub.getByRole('button', { name: 'Notes', exact: true })).toHaveAttribute('aria-current', 'page');
  // Library again folds its pages, Agents goes back to the map.
  await item('Library').click(); await expect(item('Library')).toHaveAttribute('aria-expanded', 'false'); await expect(nav().locator('.hm-nav-sub')).toBeHidden();
  await item('Agents').click();
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Agents'); await expect(item('Agents')).toHaveAttribute('aria-current', 'page');
  expect(await budget()).toEqual([]);
});

// ---- 7. Escape closes one layer at a time.
test('Escape closes the top layer only: a tooltip, then a popover, then a drawer', async () => {
  const p = page();
  await item('Add').click();
  const drawer = p.getByRole('dialog', { name: 'Add' });
  await expect(drawer).toBeVisible(); await animationsDone(p);
  // A tooltip over the drawer goes first (the keyboard shows it at once).
  await p.keyboard.press('Tab');   // from the heading of the drawer to its Close icon
  await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();
  await expect(p.getByRole('tooltip')).toBeVisible({ timeout: 1000 });
  await p.keyboard.press('Escape');
  await expect(p.getByRole('tooltip')).toBeHidden(); await expect(drawer).toBeVisible();
  // A popover in the navigation goes before the drawer.
  await item('Help').click();
  await expect(p.locator('.kit-popover')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.locator('.kit-popover')).toHaveCount(0); await expect(drawer).toBeVisible();
  await expect(item('Help')).toBeFocused();
  // Then the drawer. The focus was on Help, not in the drawer, so it stays there (the drawer gives the focus back only when it is still the drawer's).
  await p.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(item('Help')).toBeFocused();
});

// ---- 8. 900 by 600: the rail, and the details beside the map.
test('at 900 by 600 the navigation starts as a rail, the details stay a column, the map holds two columns of agents, and nothing scrolls sideways', async () => {
  const p = page();
  await resize(p, 900, 600);
  await expect(nav()).toBeVisible(); await animationsDone(p);
  const n = await rectOf(p, 'nav.hm-nav'), d = await rectOf(p, 'aside.hm-panel'), m = await rectOf(p, 'main.hm-stage'), s = await rectOf(p, '.hm-savebar');
  expect(n.w).toBe(48); expect(d.w).toBe(272); expect(d.x + d.w).toBe(900); expect(m.x).toBe(48); expect(m.x + m.w).toBe(d.x);
  expect(s.y + s.h).toBe(600); expect(await sideways()).toBeLessThanOrEqual(0);
  const columns = await p.evaluate(() => new Set([...document.querySelectorAll('.hm-grid .kit-card[data-kind="agent"]')].map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(columns).toBe(2);
  const inside = await p.evaluate(() => { const stage = document.querySelector('main.hm-stage')!.getBoundingClientRect(); return [...document.querySelectorAll('.hm-grid .kit-card[data-kind="agent"]')].every(c => { const r = c.getBoundingClientRect(); return r.left >= stage.left && r.right <= stage.right + 0.5; }); });
  expect(inside).toBe(true);
  // Open again with the toggle, it is the full 232 px, and the map still holds a column of agents without a sideways scroll.
  await navToggle().click(); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(232); expect(await sideways()).toBeLessThanOrEqual(0);
  // The details put away give the map room for three columns again.
  await detailsToggle().click(); await animationsDone(p);
  expect(await sideways()).toBeLessThanOrEqual(0);
  expect(await budget()).toEqual([]);
});

test('at 900 by 600 every part of the shell is in the window: the top row, the Save bar, the lower group of the navigation and the details toggle', async () => {
  const p = page();
  await resize(p, 900, 600);
  for (const selector of ['.hm-topbar', '.hm-savebar', 'nav.hm-nav [data-tour="help"]', 'nav.hm-nav .hm-preview', '[data-details-toggle]', 'nav.hm-nav [data-nav-toggle]']) {
    const r = await rectOf(p, selector);
    expect(r.x, selector).toBeGreaterThanOrEqual(0); expect(r.y, selector).toBeGreaterThanOrEqual(0); expect(r.x + r.w, selector).toBeLessThanOrEqual(900.5); expect(r.y + r.h, selector).toBeLessThanOrEqual(600.5);
  }
  const preview = await rectOf(p, 'nav.hm-nav .hm-preview'), save = await rectOf(p, '.hm-savebar');
  expect(preview.y + preview.h).toBeLessThanOrEqual(600);
  expect(save.h).toBeGreaterThanOrEqual(40);
});

// ---- 9. Under 900: the navigation is a drawer over the page.
test('under 900 px wide the navigation is hidden and its toggle in the top row opens it over the page; Escape, a press outside or choosing an item closes it', async () => {
  const p = page();
  await resize(p, 880, 600);
  await expect(nav()).toBeHidden();
  const toggle = p.locator('.hm-topbar [data-nav-toggle]');
  await expect(toggle).toHaveCount(1); await expect(toggle).toHaveAttribute('aria-label', 'Show navigation'); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect((await rectOf(p, 'main.hm-stage')).x).toBe(0);
  await toggle.click();
  await expect(nav()).toBeVisible(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await animationsDone(p);
  const n = await rectOf(p, 'nav.hm-nav');
  expect(n.x).toBe(0); expect(n.w).toBe(232); expect(n.h).toBe(600);
  expect((await rectOf(p, 'main.hm-stage')).x).toBe(0);   // over the page, not beside it
  // Escape closes it and the focus goes back to the toggle.
  await p.keyboard.press('Escape');
  await expect(nav()).toBeHidden(); await expect(toggle).toBeFocused();
  // A press outside closes it.
  await toggle.click(); await expect(nav()).toBeVisible();
  await p.mouse.click(700, 300);
  await expect(nav()).toBeHidden();
  // Choosing an item does its work and closes it.
  await toggle.click(); await item('Library').click();
  await expect(nav()).toBeHidden(); await expect(p.getByRole('heading', { level: 1 })).toHaveText('Library');
  // The shortcut opens and closes it as well.
  await p.keyboard.press('ControlOrMeta+b'); await expect(nav()).toBeVisible();
  await p.keyboard.press('ControlOrMeta+b'); await expect(nav()).toBeHidden();
  expect(await sideways()).toBeLessThanOrEqual(0);
  await resize(p, 1280, 800);
  await expect(nav()).toBeVisible(); expect(await widthOf('nav.hm-nav')).toBe(232);
});

test('widening the window past 900 px shows the navigation as a rail, and past 1100 px open, until the person chooses', async () => {
  const p = page();
  await resize(p, 1000, 700); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(48);
  await resize(p, 1100, 700); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(232);
  await navToggle().click(); await animationsDone(p);
  await resize(p, 1400, 800); await animationsDone(p);
  expect(await widthOf('nav.hm-nav')).toBe(48);   // a choice stays a choice
});

// ---- 10. The tour finds its targets in the new homes.
test('the tour lights the Add item, the pair Share and Version history, Help, the map, an agent, the details and the Save bar, in the new places', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  await resize(p, 1280, 800);
  const dialog = p.getByRole('dialog', { name: 'Tour' });
  await expect(dialog).toBeVisible();
  const targets: Record<string, string> = { map: '.hm-grid', agent: '.hm-grid .kit-card[data-kind="agent"]', details: 'aside.hm-panel', add: 'nav.hm-nav [data-tour="add"]', save: '.hm-savebar', share: 'nav.hm-nav [data-tour="share"]', help: 'nav.hm-nav [data-tour="help"]' };
  for (const [id, selector] of Object.entries(targets)) {
    await expect(p.locator(`[data-tour~="${id}"]`), id).toHaveCount(1);
    expect(await p.locator(selector).first().evaluate((el, i) => el.matches(`[data-tour~="${i}"]`) || el.closest(`[data-tour~="${i}"]`) !== null, id), id).toBe(true);
  }
  // Step through: each step's lit box is on the thing it names, and the popover never covers it.
  const lit = async (): Promise<Locator> => p.locator('.tour-spot');
  const sentences = ['These are your AI agents, from every tool.', 'Click an agent to see what it can do.'];
  await expect(dialog.getByText(sentences[0]!)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText(sentences[1]!)).toBeVisible();
  await p.locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main').first().click();
  await expect(dialog.getByText('3 of 7')).toBeVisible();
  const details = await rectOf(p, 'aside.hm-panel');
  await expect.poll(async () => Math.abs(((await (await lit()).boundingBox())!).x - details.x), { timeout: 3000 }).toBeLessThanOrEqual(8);
  const spot3 = (await (await lit()).boundingBox())!;
  expect(spot3.x + spot3.width).toBeGreaterThanOrEqual(details.x + details.w - 8);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Add skills, tools, and notes here.')).toBeVisible();
  const add = await rectOf(p, 'nav.hm-nav [data-tour="add"]');
  await expect.poll(async () => Math.abs(((await (await lit()).boundingBox())!).x - (add.x - 6)), { timeout: 3000 }).toBeLessThanOrEqual(2);
  const spot4 = (await (await lit()).boundingBox())!;
  expect(Math.abs(spot4.x - (add.x - 6))).toBeLessThanOrEqual(2); expect(spot4.width).toBeGreaterThanOrEqual(add.w);
  const pop = (await dialog.boundingBox())!;
  expect(pop.x >= spot4.x + spot4.width || pop.y >= spot4.y + spot4.height || pop.y + pop.height <= spot4.y || pop.x + pop.width <= spot4.x, 'the tour card keeps off the Add item').toBe(true);
  await dialog.getByRole('button', { name: 'Next' }).click(); await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Share your agents or go back in time here.')).toBeVisible();
  const pair = await rectOf(p, 'nav.hm-nav [data-tour="share"]');
  await expect.poll(async () => ((await (await lit()).boundingBox())!).y, { timeout: 3000 }).toBeLessThanOrEqual(pair.y);
  const spot6 = (await (await lit()).boundingBox())!;
  expect(spot6.y).toBeLessThanOrEqual(pair.y); expect(spot6.y + spot6.height).toBeGreaterThanOrEqual(pair.y + pair.h);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Replay this tour any time.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});

// ---- 11. Nothing scrolls sideways in any state.
for (const [w, h] of [[1280, 800], [900, 600]] as const) {
  test(`at ${w} by ${h} nothing scrolls sideways with the navigation open or put away, the details open or put away, and a drawer open`, async () => {
    const p = page();
    await resize(p, w, h);
    for (const navOpen of [true, false]) for (const detailsOpen of [true, false]) {
      const isOpen = (await widthOf('nav.hm-nav')) > 100;
      if (isOpen !== navOpen) await navToggle().click();
      const column = (await panel().count()) > 0 && (await panel().isVisible());
      if (column !== detailsOpen) await detailsToggle().click();
      await animationsDone(p);
      expect(await sideways(), `nav ${navOpen}, details ${detailsOpen}`).toBeLessThanOrEqual(0);
      await item('Add').click(); await expect(p.getByRole('dialog', { name: 'Add' })).toBeVisible(); await animationsDone(p);
      expect(await sideways(), `nav ${navOpen}, details ${detailsOpen}, drawer`).toBeLessThanOrEqual(0);
      const stage = await rectOf(p, 'main.hm-stage'), save = await rectOf(p, '.hm-savebar');
      expect(stage.x + stage.w).toBeLessThanOrEqual(w + 0.5); expect(save.y + save.h).toBeLessThanOrEqual(h + 0.5);
      await p.keyboard.press('Escape'); await expect(p.getByRole('dialog', { name: 'Add' })).toHaveCount(0);
    }
    expect(await budget()).toEqual([]);
  });
}
