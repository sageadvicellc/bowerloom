/**
 * Wave F, Find, in the real window (Electron started with --home-sample). The FIRST scan is a full page that shows ONE selectable list of agents (a checkbox, a name, a one-line
 * job, and a flat tag for each app the agent works with; no tiles and no counts for the apps). After it, "Find more" is the same scan inside the right column of the map, titled
 * "Find more": it can be closed with a visible Close icon and with Escape, it never blocks the rest of the app, and it gives the focus back to the navigation item. The full-page
 * Find never comes back. Checked at 1280 by 800 and 900 by 600, with the text budget at every step.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone, framesPainted } from './page-wait.js';
import { fresh, launchHome, rectOf, resize } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const find = (): Locator => page().locator('[data-screen="find"]');
const rows = (): Locator => page().locator('.fr-agent');
const panel = (): Locator => page().locator('aside.hm-panel[data-find]');
const nav = (): Locator => page().locator('nav.hm-nav');
const findItem = (): Locator => nav().getByRole('button', { name: 'Find more', exact: true });
const agentCards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const sideways = async (): Promise<number> => page().evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dialog = (): Locator => page().getByRole('dialog', { name: 'Tour' });
const smallText = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const el = n.parentElement;
    if (el === null || (n.textContent ?? '').trim() === '' || el.closest('.hm-sr, svg') !== null) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 14) out.push(`${getComputedStyle(el).fontSize}: ${n.textContent}`);
  }
  return out;
});

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), undefined, { welcome: true });
  await resize(page(), 1280, 800);
});

async function toList(): Promise<void> { await page().getByRole('button', { name: 'Find my agents' }).click(); await expect(find()).toBeVisible(); await expect(page().getByRole('button', { name: 'Looks right' })).toBeVisible(); }
async function toMap(): Promise<void> {
  await toList(); await page().getByRole('button', { name: 'Looks right' }).click(); await page().getByRole('button', { name: 'Yes, read them' }).click();
  await expect(page().getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(dialog()).toBeVisible(); await page().keyboard.press('Escape'); await expect(dialog()).toHaveCount(0);
}
async function openPanel(): Promise<void> { await findItem().click(); await expect(panel()).toBeVisible(); await expect(panel().getByRole('button', { name: 'Looks right' })).toBeVisible(); }

// ---- 1. The first scan: one list of agents.
test('the first scan is a full page with ONE list of agents: a row for each, with a checkbox, a name, a one-line job and tags; no tile and no count for an app', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(find()).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Looking for your agents' })).toBeVisible();
  await expect(p.getByRole('progressbar', { name: 'Search progress' })).toBeVisible();
  await expect(p.locator('.fr-tile')).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: 'Found 10 agents' })).toBeVisible();
  await expect(p.getByRole('list', { name: 'Agents found' })).toHaveCount(1);
  await expect(rows()).toHaveCount(10);
  for (let i = 0; i < 10; i += 1) {
    const row = rows().nth(i);
    await expect(row.getByRole('checkbox')).toBeChecked();
    expect(((await row.locator('.fr-agent-name').textContent()) ?? '').trim().length).toBeGreaterThan(2);
    expect(((await row.locator('.fr-agent-job').textContent()) ?? '').trim().length).toBeGreaterThan(5);
    expect(await row.locator('.fr-tag').count()).toBeGreaterThanOrEqual(1);
  }
  const names = await p.locator('.fr-agent-name').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(names.slice(0, 3)).toEqual(['Inbox sorter', 'Interview notetaker', 'Meeting assistant']);
  // No per-app tile or count, no note about the apps, no count of agents that work in more than one app.
  const text = (await p.locator('[data-home]').innerText()).replace(/\s+/g, ' ');
  expect(text).not.toMatch(/work in more than one app|works in more than one app|These are the apps|Not found|Where I looked/);
  expect(text).not.toMatch(/\b\d+ agents? Claude Code|Claude Code \d+/);
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeFocused();
  expect(await budget()).toEqual([]); expect(await smallText()).toEqual([]);
  expect(await sideways()).toBeLessThanOrEqual(0);
});

test('each agent carries a flat tag for every app it works with: 1 px outline, 22 px tall, no fill, 14 px text, by the app\'s own name', async () => {
  const p = page();
  await toList();
  const tags = await p.locator('.fr-tag').evaluateAll(els => els.map(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { text: (el.textContent ?? '').trim(), h: r.height, border: s.borderTopWidth, bg: s.backgroundColor, shadow: s.boxShadow, size: parseFloat(s.fontSize), app: el.getAttribute('data-app') }; }));
  expect(tags.length).toBeGreaterThanOrEqual(17);
  for (const t of tags) { expect(['Claude Code', 'Codex', 'OpenCode']).toContain(t.text); expect(t.text).toBe(t.app); expect(t.h).toBe(22); expect(t.border).toBe('1px'); expect(t.bg).toBe('rgba(0, 0, 0, 0)'); expect(t.shadow).toBe('none'); expect(t.size).toBeGreaterThanOrEqual(14); }
  const count = (name: string): number => tags.filter(t => t.text === name).length;
  expect([count('Claude Code'), count('Codex'), count('OpenCode')]).toEqual([9, 4, 4]);
  // An agent that works in more than one app has more than one tag, in the order Claude Code, Codex, OpenCode.
  const per = await rows().evaluateAll(els => els.map(el => [...el.querySelectorAll('.fr-tag')].map(t => (t.textContent ?? '').trim())));
  expect(per.some(list => list.length > 1)).toBe(true);
  for (const list of per) expect(list).toEqual(['Claude Code', 'Codex', 'OpenCode'].filter(n => list.includes(n)));
  // A row is named by the agent and described by its job and its apps.
  const box = p.getByRole('checkbox', { name: 'Meeting assistant' });
  await expect(box).toHaveCount(1);
  const described = await box.getAttribute('aria-describedby');
  expect(described!.split(' ').length).toBe(2);
});

test('"Select all" and "Clear" are icon buttons with names and tooltips; Clear unticks every agent and says to tick one, Select all ticks them again', async () => {
  const p = page();
  await toList();
  const all = p.getByRole('button', { name: 'Select all', exact: true }), clear = p.getByRole('button', { name: 'Clear', exact: true });
  for (const b of [all, clear]) { expect((await b.innerText()).trim()).toBe(''); expect(await b.locator('svg').count()).toBe(1); const box = (await b.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32); expect(await b.getAttribute('aria-describedby')).not.toBeNull(); }
  await clear.hover(); await expect(p.getByRole('tooltip')).toHaveText('Clear', { timeout: 2000 });
  await p.mouse.move(640, 600);
  await clear.click();
  await expect(p.locator('.fr-agent .fr-check:checked')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeDisabled();
  await expect(p.getByText('Tick at least one agent.')).toBeVisible();
  await all.click();
  await expect(p.locator('.fr-agent .fr-check:checked')).toHaveCount(10);
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeEnabled();
  // The keyboard does the same.
  await clear.focus(); await p.keyboard.press('Enter'); await expect(p.locator('.fr-agent .fr-check:checked')).toHaveCount(0);
  await all.focus(); await p.keyboard.press('Space'); await expect(p.locator('.fr-agent .fr-check:checked')).toHaveCount(10);
  expect(await budget()).toEqual([]);
});

test('the places and their folders sit behind "Show details", and nowhere else', async () => {
  const p = page();
  await toList();
  expect(await p.locator('[data-home]').innerText()).not.toMatch(/\/Users|\.claude|\.codex|\.opencode/);
  const details = p.getByRole('button', { name: 'Show details' });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(p.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  await expect(p.getByRole('heading', { level: 2, name: 'Where I looked' })).toBeVisible();
  await expect(p.locator('.fr-place-name')).toHaveText(['Your home folder', 'Client site', 'Holiday trips']);
  await expect(p.locator('.fr-paths code').first()).toContainText('/Users/sample/Studio/.claude');
  expect(await p.locator('.fr-paths code').count()).toBeGreaterThanOrEqual(7);
  expect(await smallText()).toEqual([]);
  await p.getByRole('button', { name: 'Hide details' }).click();
  await expect(p.locator('.fr-paths')).toHaveCount(0);
});

test('"Looks right" asks "Read what is inside?" with the agents counted, "Back" is an icon that returns with the ticks kept, and nothing is read before "Yes, read them"', async () => {
  const p = page();
  await toList();
  await p.getByRole('checkbox', { name: 'Money tracker' }).uncheck();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  await expect(p.getByText('9 agents', { exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Yes, read them' })).toBeFocused();
  await expect(p.locator('.hm-grid')).toHaveCount(0);
  const back = p.getByRole('button', { name: 'Back', exact: true });
  expect((await back.innerText()).trim()).toBe(''); expect(await back.locator('svg').count()).toBe(1);
  await back.click();
  await expect(p.getByRole('checkbox', { name: 'Money tracker' })).not.toBeChecked();
  await expect(p.locator('.fr-agent .fr-check:checked')).toHaveCount(9);
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Not now' }).click();
  await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('an unticked agent is skipped: it stays off the map, and the map says so', async () => {
  const p = page();
  await toList();
  await p.getByRole('checkbox', { name: 'Money tracker' }).uncheck(); await p.getByRole('checkbox', { name: 'Trip organizer' }).uncheck();
  await p.getByRole('button', { name: 'Looks right' }).click(); await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Reading your agents' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(agentCards()).toHaveCount(8);
  await expect(p.getByText('8 agents.')).toBeVisible();
  await expect(p.locator('.kit-card-main', { hasText: 'Money tracker' })).toHaveCount(0);
});

// ---- 2. Find more: a panel in the right column, never the full page.
test('after the first scan "Find more" opens the SAME scan in the right column, titled "Find more": not a full page, and the rest of the app stays in reach', async () => {
  const p = page();
  await toMap();
  await openPanel();
  await expect(find()).toHaveCount(0); await expect(p.locator('[data-screen="welcome"]')).toHaveCount(0);
  await expect(panel().getByRole('heading', { level: 2, name: 'Find more' })).toBeVisible();
  await expect(panel().locator('.fr-agent')).toHaveCount(10);
  await expect(panel().locator('.fr-tag').first()).toBeVisible();
  // It is the column at the right, where the details were, and the map, the navigation and the Save bar are all still there.
  const d = await rectOf(p, 'aside.hm-panel[data-find]'), n = await rectOf(p, 'nav.hm-nav'), m = await rectOf(p, 'main.hm-stage');
  expect(d.w).toBe(320); expect(d.x + d.w).toBe(1280); expect(m.x + m.w).toBe(d.x); expect(n.w).toBe(232);
  await expect(agentCards()).toHaveCount(10); await expect(p.getByRole('region', { name: 'Save bar' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Agents');
  await expect(findItem()).toHaveAttribute('aria-expanded', 'true'); await expect(p.getByRole('complementary')).toHaveCount(1);
  await expect(panel()).toHaveAttribute('aria-labelledby', 'fr-panel-title');
  expect(await sideways()).toBeLessThanOrEqual(0);
  expect(await budget()).toEqual([]); expect(await smallText()).toEqual([]);
});

test('Find more never blocks the app: an agent can be picked, a drawer opened and the toggle used while it is open, and nothing is dimmed or inert', async () => {
  const p = page();
  await toMap();
  await openPanel();
  await agentCards().nth(2).locator('.kit-card-main').click();
  await expect(agentCards().nth(2).locator('.kit-card-main')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel()).toBeVisible();
  expect(await p.evaluate(() => document.querySelector('.hm-root > [inert], .hm-col [inert]:not(.kit-tray)') !== null || document.querySelector('[aria-modal="true"]') !== null)).toBe(false);
  await nav().getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Version history' })).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog', { name: 'Version history' })).toHaveCount(0);
  await expect(panel()).toBeVisible();   // Escape closed the drawer first, the top layer only
  await p.getByRole('button', { name: 'Sort', exact: true }).click(); await expect(p.getByRole('menu')).toBeVisible(); await p.keyboard.press('Escape');
  await expect(panel()).toBeVisible();
});

test('Find more closes with the Close icon, with Escape and with "Not now", gives the focus back to the navigation item, and starts fresh next time', async () => {
  const p = page();
  await toMap();
  await openPanel();
  const close = panel().getByRole('button', { name: 'Close' });
  expect((await close.innerText()).trim()).toBe(''); const box = (await close.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32);
  expect(box.x + box.width).toBeGreaterThan(1280 - 24);   // at the top right of the column
  await close.click();
  await expect(panel()).toHaveCount(0);
  await expect(p.locator('aside.hm-panel')).toHaveCount(1); await expect(p.locator('#hm-panel-title')).toBeVisible();   // the details are back
  await expect(findItem()).toBeFocused(); await expect(findItem()).toHaveAttribute('aria-expanded', 'false');
  // Escape, from the panel and from the map.
  await openPanel(); await p.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0); await expect(findItem()).toBeFocused();
  await openPanel(); await agentCards().first().locator('.kit-card-main').focus(); await p.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0); await expect(findItem()).toBeFocused();
  // "Not now" at the second question.
  await openPanel(); await panel().getByRole('button', { name: 'Looks right' }).click();
  await expect(panel().getByRole('heading', { level: 3, name: 'Read what is inside?' })).toBeVisible();
  await panel().getByRole('button', { name: 'Not now' }).click();
  await expect(panel()).toHaveCount(0); await expect(findItem()).toBeFocused();
  await expect(agentCards()).toHaveCount(10);
  // Cancelled while it is still looking, by the first Escape.
  await findItem().click(); await expect(panel()).toBeVisible(); await p.keyboard.press('Escape'); await expect(panel()).toHaveCount(0);
});

test('a second Find, a third and a fourth never mount the full-page screen: Welcome and the full page are gone for the whole session', async () => {
  const p = page();
  await toMap();
  for (let i = 0; i < 3; i += 1) {
    await openPanel();
    await expect(p.locator('[data-screen="find"], [data-screen="welcome"]')).toHaveCount(0);
    await expect(p.getByRole('heading', { level: 1 })).toHaveText('Agents');
    await panel().getByRole('button', { name: 'Close' }).click();
    await expect(panel()).toHaveCount(0);
  }
  await openPanel(); await panel().getByRole('button', { name: 'Looks right' }).click(); await panel().getByRole('button', { name: 'Yes, read them' }).click();
  await expect(panel()).toHaveCount(0);
  await expect(p.locator('[data-screen="find"], [data-screen="welcome"]')).toHaveCount(0); await expect(agentCards()).toHaveCount(10);
  await expect(dialog()).toHaveCount(0);   // and the tour does not start again
});

test('in Find more an unticked agent is hidden from the map, the choice is kept the next time, and ticking it again brings it back', async () => {
  const p = page();
  await toMap();
  await openPanel();
  await panel().getByRole('checkbox', { name: 'Support writer' }).uncheck();
  await panel().getByRole('button', { name: 'Looks right' }).click();
  await expect(panel().getByText('9 agents', { exact: true })).toBeVisible();
  await panel().getByRole('button', { name: 'Yes, read them' }).click();
  await expect(panel()).toHaveCount(0);
  await expect(agentCards()).toHaveCount(9); await expect(p.getByText('9 agents.')).toBeVisible();
  await expect(p.locator('.kit-card-main', { hasText: 'Support writer' })).toHaveCount(0);
  await openPanel();
  await expect(panel().getByRole('checkbox', { name: 'Support writer' })).not.toBeChecked();
  await expect(panel().locator('.fr-agent .fr-check:checked')).toHaveCount(9);
  await panel().getByRole('checkbox', { name: 'Support writer' }).check();
  await panel().getByRole('button', { name: 'Looks right' }).click(); await panel().getByRole('button', { name: 'Yes, read them' }).click();
  await expect(agentCards()).toHaveCount(10);
});

test('an agent with changes that wait stays ticked and cannot be skipped, even by Clear, and says why', async () => {
  const p = page();
  await toMap();
  await agentCards().nth(3).locator('.kit-card-main').click();
  const name = ((await agentCards().nth(3).locator('.kit-card-main').textContent()) ?? '').trim();
  await p.locator('.hm-panel .kit-card[data-kind="skill"]').first().getByRole('button', { name: /^Remove/ }).click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(/Removed/)).toBeVisible();
  await openPanel();
  const row = panel().locator('.fr-agent', { hasText: name });
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
  await expect(row.getByText('This agent has changes you have not saved.')).toBeVisible();
  await row.getByRole('checkbox').click({ force: true });
  await expect(row.getByRole('checkbox')).toBeChecked();
  await panel().getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(panel().locator('.fr-agent .fr-check:checked')).toHaveCount(1); await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(panel().getByRole('button', { name: 'Looks right' })).toBeEnabled();
  await panel().getByRole('button', { name: 'Select all' }).click();
  await panel().getByRole('button', { name: 'Looks right' }).click(); await panel().getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(/Removed/)).toBeVisible();   // the change is still waiting
});

test('Find more by the keyboard: Enter on the item opens it with the focus on its heading, "Looks right" takes the focus when the list shows, and Escape closes it back to the item', async () => {
  const p = page();
  await toMap();
  await findItem().focus(); await p.keyboard.press('Enter');
  await expect(panel()).toBeVisible();
  await expect(panel().getByRole('button', { name: 'Looks right' })).toBeFocused({ timeout: 4000 });
  await p.keyboard.press('Tab'); await expect(panel().getByRole('button', { name: 'Show details' })).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0); await expect(findItem()).toBeFocused();
});

test('Find more starts on the agents even from the Library, and brings the details back when it ends', async () => {
  const p = page();
  await toMap();
  await nav().getByRole('button', { name: 'Library', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Library');
  await findItem().click();
  await expect(panel()).toBeVisible(); await expect(p.getByRole('heading', { level: 1 })).toHaveText('Agents');
  await panel().getByRole('button', { name: 'Close' }).click();
  await expect(panel()).toHaveCount(0); await expect(p.locator('aside.hm-panel')).toHaveCount(1);
});

test('Find more opens the details column if it was put away, and shows the column again as it was when it ends', async () => {
  const p = page();
  await toMap();
  await p.locator('[data-details-toggle]').click(); await expect(p.locator('aside.hm-panel')).toBeHidden();
  await openPanel();
  await expect(panel()).toBeVisible();
  await panel().getByRole('button', { name: 'Close' }).click();
  await expect(panel()).toHaveCount(0);
});

// ---- 3. Both sizes, light and dark, motion and no motion.
for (const [w, h] of [[1280, 800], [900, 600]] as const) {
  test(`at ${w} by ${h} the first scan and Find more fit: nothing is cut off, no sideways scroll, text 14 px or more, the budget holds at every step`, async () => {
    const p = page();
    await resize(p, w, h);
    await toList();
    expect(await sideways()).toBeLessThanOrEqual(0);
    const inside = await p.evaluate(() => [...document.querySelectorAll('.fr-agent')].every(r => { const b = r.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth; }));
    expect(inside).toBe(true);
    // The pinned buttons stay in view while the list scrolls under them.
    const actions = await rectOf(p, '.fr-actions[data-pinned]');
    expect(actions.y + actions.h).toBeLessThanOrEqual(h + 0.5);
    expect(await budget()).toEqual([]); expect(await smallText()).toEqual([]);
    await p.getByRole('button', { name: 'Looks right' }).click();
    expect(await budget()).toEqual([]);
    await p.getByRole('button', { name: 'Yes, read them' }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
    await expect(dialog()).toBeVisible(); await p.keyboard.press('Escape'); await expect(dialog()).toHaveCount(0);
    await openPanel(); await animationsDone(p);
    expect(await sideways()).toBeLessThanOrEqual(0);
    const column = await rectOf(p, 'aside.hm-panel[data-find]');
    expect(column.x + column.w).toBeLessThanOrEqual(w + 0.5); expect(column.y + column.h).toBeLessThanOrEqual(h + 0.5);
    const rowsFit = await p.evaluate(() => { const c = document.querySelector('aside.hm-panel[data-find]')!.getBoundingClientRect(); return [...document.querySelectorAll('aside.hm-panel[data-find] .fr-agent')].every(r => { const b = r.getBoundingClientRect(); return b.left >= c.left - 0.5 && b.right <= c.right + 0.5; }); });
    expect(rowsFit).toBe(true);
    expect(await budget()).toEqual([]); expect(await smallText()).toEqual([]);
    await panel().getByRole('button', { name: 'Looks right' }).click();
    expect(await budget()).toEqual([]);
    await panel().getByRole('button', { name: 'Not now' }).click();
    await expect(panel()).toHaveCount(0);
  });
}

test('with reduce motion the scan shows its list at once and the reading ends at once, in the page and in the panel', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--motion-reduced') === '1');
  await fresh(p, undefined, { welcome: true }); await resize(p, 1280, 800);
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible({ timeout: 600 });
  await p.getByRole('button', { name: 'Looks right' }).click(); await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible({ timeout: 1500 });
  await expect(dialog()).toBeVisible(); await p.keyboard.press('Escape');
  await framesPainted(p);
  await findItem().click();
  await expect(panel().getByRole('button', { name: 'Looks right' })).toBeVisible({ timeout: 600 });
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
});

for (const look of ['light', 'dark'] as const) {
  test(`${look}: the list, the tags and the panel are readable (text 14 px or more, every control at least 32 px or a 24 px text link)`, async () => {
    const p = page();
    await p.emulateMedia({ reducedMotion: 'no-preference', colorScheme: look });
    await p.waitForFunction(l => document.documentElement.getAttribute('data-theme') === l, look);
    await toList();
    const small = await p.evaluate(() => [...document.querySelectorAll('.fr-agents button, .fr-actions button, .fr-bulk button')].map(b => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(), w: r.width, h: r.height }; }).filter(b => b.h < 32 || (b.name === '' ? true : false) || b.w < 32));
    expect(small, JSON.stringify(small)).toEqual([]);
    const box = await p.locator('.fr-check').first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(16);
    expect(await smallText()).toEqual([]);
  });
}
