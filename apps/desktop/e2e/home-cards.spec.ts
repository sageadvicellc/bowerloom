/**
 * Wave A of the 0.8 agents-first preview (kept up to date by Wave D), in the real window (Electron started with --home-sample): the agent tile with its counts and the tray they open,
 * selection as a highlight with no check mark, the details panel for an agent, a skill, a tool and a set of notes, the Version history button with its tooltip,
 * the keyboard path through all of it, reduce motion, the text budget at every step, and two window sizes (1280 by 800 and 900 by 600).
 * Set HOME_U0_SHOTS to a folder to also save screenshots at both sizes, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone, framesPainted } from './page-wait.js';
import { THEMES, WELCOME_PAGE, ensurePicked, fresh, launchHome, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SIZES_A = [[1280, 800], [900, 600]] as const;
const CHECK_PATH = 'M5 12.5l4.5 4.5L19 7.5';

let home: Home;
const page = (): Page => home.page;
const agentCards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
/** The card of one agent, found by its name button. */
const card = (name: string): Locator => agentCards().filter({ has: page().locator('.kit-card-main', { hasText: new RegExp(`^${name}$`) }) });
const main = (name: string): Locator => card(name).locator('.kit-card-main');
const chip = (name: string, label: string): Locator => card(name).getByRole('button', { name: label, exact: true });
const PLURAL = { skill: 'skills', tool: 'tools', note: 'notes' } as const;
/** The tray of one kind of one agent (it sits under the row of the agent's tile, so it is found by its name, not inside the tile). */
const tray = (name: string, kind: 'skill' | 'tool' | 'note'): Locator => page().locator(`.kit-tray[aria-label="${name}: ${PLURAL[kind]}"]`);
const lines = (name: string, kind: 'skill' | 'tool' | 'note'): Locator => tray(name, kind).locator('.kit-card-main');
const line = (name: string, kind: 'skill' | 'tool' | 'note', text: string): Locator => lines(name, kind).filter({ hasText: new RegExp(`^${text}$`) });
const panel = (): Locator => page().locator('aside.hm-panel');
const title = (): Locator => panel().locator('#hm-panel-title');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const topBar = (name: string): Locator => page().locator('nav.hm-nav').getByRole('button', { name, exact: true });
const tip = (): Locator => page().getByRole('tooltip');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const overflowX = async (): Promise<number> => page().evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const heights = async (): Promise<number[]> => agentCards().evaluateAll(list => list.map(c => Math.round(c.getBoundingClientRect().height)));
/** The size of every piece of text in the map and the panel that is under 14 px. */
const smallText = async (): Promise<string[]> => page().evaluate(() => {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const el = n.parentElement;
    if (el === null || (n.textContent ?? '').trim() === '' || el.closest('.hm-sr') !== null) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 14) out.push(`${size}px: ${n.textContent}`);
  }
  return out;
});

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
  await expect(agentCards()).toHaveCount(10);
});

// ---- The agent card says what the agent can do, without a click.
test('every agent tile shows counts for what it holds: "3 skills", "1 tool", "1 note set"; a kind with nothing in it has no count', async () => {
  const want: Record<string, string[]> = {
    'Meeting assistant': ['4 skills', '1 tool', '1 note set'], 'Research assistant': ['3 skills', '2 tools', '1 note set'],
    'Inbox sorter': ['4 skills', '1 note set'], 'Schedule keeper': ['3 skills'],
  };
  for (const [name, chips] of Object.entries(want)) expect(await card(name).locator('.kit-count').allInnerTexts(), name).toEqual(chips);
  const all = await agentCards().locator('.kit-count').allInnerTexts();
  expect(all.length).toBeGreaterThan(20);
  for (const text of all) { expect(text).toMatch(/^[1-9]\d* (skills?|tools?|note sets?)$/); }
  const facts = await agentCards().locator('.kit-count').evaluateAll(list => list.map(c => ({ size: parseFloat(getComputedStyle(c).fontSize), h: c.getBoundingClientRect().height })));
  // A count is a text button of 28 px (Wave D: it was a 32 px chip); its hit area is never under 24 px.
  expect(Math.min(...facts.map(f => f.size))).toBeGreaterThanOrEqual(14); expect(Math.min(...facts.map(f => f.h))).toBeGreaterThanOrEqual(28);
  expect(await agentCards().locator('.kit-avatar').count()).toBe(0);
  // The redesigned tile has no glyph tile and no letters: an accent edge, the name, the job, a bar of what it holds, and the counts.
  expect(await agentCards().locator('.kit-tile').count()).toBe(0);
  expect(await agentCards().locator('.kit-hold').count()).toBe(10);
  expect(await agentCards().locator('[aria-haspopup]').count()).toBe(0);
  expect(await budget()).toEqual([]); expect(await smallText()).toEqual([]);
});

// ---- Selection is a highlight, not a check.
test('a selected card, a selected line and the chosen sort item are highlights: no check mark anywhere, and the edge is 2 px', async () => {
  const p = page();
  const checks = async (): Promise<{ marks: number; legacy: number; sortIcons: number }> => p.evaluate(path => ({
    marks: document.querySelectorAll(`.kit-card svg path[d="${path}"], .hm-menu-list svg path[d="${path}"]`).length,
    legacy: document.querySelectorAll('.kit-card-check').length,
    sortIcons: document.querySelectorAll('.hm-menu-list svg').length,
  }), CHECK_PATH);
  expect(await checks()).toEqual({ marks: 0, legacy: 0, sortIcons: 0 });
  await expect(main('Inbox sorter')).toHaveAttribute('aria-pressed', 'true');
  await chip('Meeting assistant', '4 skills').click();
  await line('Meeting assistant', 'skill', 'Write a reply').click();
  await expect(title()).toHaveText('Write a reply');
  expect(await checks()).toEqual({ marks: 0, legacy: 0, sortIcons: 0 });
  await p.getByRole('button', { name: 'Sort', exact: true }).click();
  expect(await checks()).toEqual({ marks: 0, legacy: 0, sortIcons: 0 });
  await p.getByRole('menuitemradio', { name: 'Recently changed' }).click();
  expect(await checks()).toEqual({ marks: 0, legacy: 0, sortIcons: 0 });
  const edge = async (loc: Locator): Promise<{ width: string; colour: string; fill: string }> => loc.evaluate(el => { const s = getComputedStyle(el); return { width: s.borderTopWidth, colour: s.borderTopColor, fill: s.backgroundColor }; });
  await p.mouse.move(2, 450); await animationsDone(p);
  const owner = await edge(card('Meeting assistant')), plain = await edge(card('Money tracker')), row = await edge(tray('Meeting assistant', 'skill').locator('.kit-card[data-selected]'));
  expect(owner.width).toBe('2px'); expect(plain.width).toBe('1px'); expect(row.width).toBe('2px');
  expect(owner.fill).not.toBe(plain.fill); expect(owner.colour).not.toBe(plain.colour);
  console.log('MEASURED selected card edge:', JSON.stringify(owner), 'plain card:', JSON.stringify(plain), 'selected line:', JSON.stringify(row));
  await p.getByRole('button', { name: 'Sort', exact: true }).click();
  const seg = await edge(p.getByRole('menuitemradio', { name: 'Recently changed' }));
  expect(seg.fill).not.toBe(await edge(p.getByRole('menuitemradio', { name: 'Name' })).then(e => e.fill));
  await expect(p.getByRole('menuitemradio', { name: 'Recently changed' })).toHaveAttribute('aria-checked', 'true');
  // The chosen item has the 2 px accent edge (an inset ring), the other has none, and there is no tick.
  const ring = async (name: string): Promise<string> => p.getByRole('menuitemradio', { name }).evaluate(el => getComputedStyle(el).boxShadow);
  expect(await ring('Recently changed')).toMatch(/inset/); expect(await ring('Recently changed')).toMatch(/2px/); expect(await ring('Name')).toBe('none');
  expect(await checks()).toEqual({ marks: 0, legacy: 0, sortIcons: 0 });
  await p.keyboard.press('Escape');
});

// ---- Counts and trays.
test('a count opens a tray with names, one compact row each; one tray at a time; no tile changes size, and the later rows move down', async () => {
  const p = page();
  const before = await heights();
  const skills = chip('Meeting assistant', '4 skills'), tools = chip('Meeting assistant', '1 tool');
  await expect(skills).toHaveAttribute('aria-expanded', 'false');
  await expect(lines('Meeting assistant', 'skill')).toHaveCount(4); await expect(lines('Meeting assistant', 'skill').first()).toBeHidden();
  const later = (await card('Report builder').boundingBox())!.y;
  await skills.click();
  await expect(skills).toHaveAttribute('aria-expanded', 'true');
  const id = (await skills.getAttribute('aria-controls'))!;
  await expect(p.locator(`[id="${id}"]`)).toHaveAttribute('data-open', '');
  await expect(lines('Meeting assistant', 'skill')).toHaveText(['Summarize a meeting', 'Write a reply', 'List action items', 'Tidy my meeting notes']);
  await animationsDone(p);
  expect(await heights(), 'no tile changes size').toEqual(before);
  expect((await card('Report builder').boundingBox())!.y, 'the later row moves down by the tray').toBeGreaterThan(later + 60);
  // A second count opens its tray and the first closes: one tray at a time.
  await tools.click();
  await expect(tools).toHaveAttribute('aria-expanded', 'true'); await expect(skills).toHaveAttribute('aria-expanded', 'false');
  await expect(lines('Meeting assistant', 'tool')).toHaveText(['Read my calendar']);
  await expect(lines('Meeting assistant', 'skill').first()).toBeHidden();
  await expect(p.locator('.kit-tray[data-open]')).toHaveCount(1);
  // Every row is one row of 44 px, with a glyph, the name, and no more than its name and one line of hint.
  await skills.click(); await animationsDone(p);
  const rows = await tray('Meeting assistant', 'skill').locator('.kit-card').evaluateAll(list => list.map(b => ({ h: b.getBoundingClientRect().height, svg: b.querySelectorAll('svg').length, text: (b.querySelector('.kit-card-main')?.textContent ?? '').trim(), size: parseFloat(getComputedStyle(b.querySelector('.kit-card-main')!).fontSize) })));
  for (const r of rows) { expect(r.h).toBe(44); expect(r.svg).toBe(1); expect(r.size).toBeGreaterThanOrEqual(14); expect(r.text.split(' ').length).toBeLessThanOrEqual(5); }
  // The same count closes its tray, and the later rows move back.
  await skills.click();
  await expect(skills).toHaveAttribute('aria-expanded', 'false');
  await expect(lines('Meeting assistant', 'skill').first()).toBeHidden();
  await animationsDone(p);
  expect(await heights()).toEqual(before);
  expect((await card('Report builder').boundingBox())!.y).toBeCloseTo(later, 0);
  expect(await budget()).toEqual([]);
});

test('a tray opens and closes in 160 ms with the strong ease-out (measured), and nothing runs under reduce motion', async () => {
  const p = page();
  const facts = await tray('Meeting assistant', 'skill').evaluate(el => { const s = getComputedStyle(el); return { duration: s.transitionDuration, ease: s.transitionTimingFunction, property: s.transitionProperty }; });
  expect(facts).toEqual({ duration: '0.16s', ease: 'cubic-bezier(0.23, 1, 0.32, 1)', property: 'grid-template-rows' });
  // Measure the height of the list, frame by frame, from the press.
  const measure = async (name: string, label: string): Promise<{ ms: number; final: number }> => p.evaluate(({ name: n, label: l }) => new Promise<{ ms: number; final: number }>(resolve => {
    const cards = [...document.querySelectorAll<HTMLElement>('.hm-grid .kit-card[data-kind="agent"]')];
    const c = cards.find(x => x.querySelector('.kit-card-main')?.textContent === n)!;
    const button = [...c.querySelectorAll<HTMLButtonElement>('.kit-count')].find(b => b.textContent === l)!;
    const acc = document.getElementById(button.getAttribute('aria-controls')!)!;
    const opening = button.getAttribute('aria-expanded') === 'false';
    const t0 = performance.now(); button.click();
    const start = acc.getBoundingClientRect().height;
    let last = -1, since = t0, reached = t0;
    const tick = (): void => {
      const h = acc.getBoundingClientRect().height, now = performance.now();
      if (h !== last) { last = h; since = now; }
      if (opening ? h > start : h < start) reached = now;
      if (now - since > 120) resolve({ ms: Math.round(since - t0), final: Math.round(h) });
      else requestAnimationFrame(tick);
      void reached;
    };
    requestAnimationFrame(tick);
  }), { name, label });
  const opened = await measure('Meeting assistant', '4 skills');
  const closed = await measure('Meeting assistant', '4 skills');
  console.log('MEASURED accordion open:', JSON.stringify(opened), 'close:', JSON.stringify(closed));
  expect(opened.ms).toBeGreaterThanOrEqual(100); expect(opened.ms).toBeLessThanOrEqual(260); expect(opened.final).toBeGreaterThan(60);
  expect(closed.ms).toBeGreaterThanOrEqual(100); expect(closed.ms).toBeLessThanOrEqual(260); expect(closed.final).toBe(0);
  // With reduce motion nothing is timed at all.
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--motion-reduced') === '1');
  expect(await tray('Meeting assistant', 'skill').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await chip('Meeting assistant', '4 skills').click();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(lines('Meeting assistant', 'skill').first()).toBeVisible();
  expect(await tray('Meeting assistant', 'skill').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(60);
});

test('a tray shows twelve rows and a Show more icon; the kit gallery draws a long one', async () => {
  const p = page();
  await fresh(p, '#prototype-v2/kit');
  const longTray = p.locator('[data-theme="light"][data-home] .hm-gallery-tray .kit-tray');
  await expect(longTray).toHaveCount(1);
  const rows = longTray.locator('.kit-card-main');
  await expect(rows).toHaveCount(12);
  const more = longTray.getByRole('button', { name: 'Show more skills' });
  expect((await more.innerText()).trim()).toBe(''); expect(await more.locator('svg').count()).toBe(1);   // an icon with a name, not words
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(rows).toHaveCount(14);
  const less = longTray.getByRole('button', { name: 'Show less skills' });
  expect((await less.innerText()).trim()).toBe(''); await expect(less).toHaveAttribute('aria-expanded', 'true'); await less.click();
  await expect(rows).toHaveCount(12);
});

// ---- Pressing the card, a chip and a line.
test('pressing the tile selects the agent and shows its details; a count selects nothing; a row selects its item and the agent keeps the highlight as owner', async () => {
  const p = page();
  await expect(title()).toHaveText('Inbox sorter');
  // The hint is part of the card: pressing it selects the agent.
  // The hint sits under the name button's cover, which is the point: a press on it is a press on the card.
  await card('Research assistant').locator('.kit-card-hint').click({ force: true });
  await expect(main('Research assistant')).toHaveAttribute('aria-pressed', 'true'); await expect(main('Inbox sorter')).toHaveAttribute('aria-pressed', 'false');
  await expect(title()).toHaveText('Research assistant');
  // A chip only opens its list.
  await chip('Meeting assistant', '4 skills').click();
  await expect(main('Meeting assistant')).toHaveAttribute('aria-pressed', 'false'); await expect(title()).toHaveText('Research assistant');
  await expect(card('Meeting assistant')).not.toHaveAttribute('data-selected', '');
  // A line selects its item.
  await line('Meeting assistant', 'skill', 'Write a reply').click();
  await expect(title()).toHaveText('Write a reply');
  await expect(card('Meeting assistant')).toHaveAttribute('data-owner', ''); await expect(main('Meeting assistant')).toHaveAttribute('aria-current', 'true');
  await expect(line('Meeting assistant', 'skill', 'Write a reply')).toHaveAttribute('aria-pressed', 'true');
  await expect(card('Research assistant')).not.toHaveAttribute('data-selected', ''); await expect(card('Research assistant')).not.toHaveAttribute('data-owner', '');
  expect(await tray('Meeting assistant', 'skill').locator('.kit-card[data-selected]').count()).toBe(1);
  // Pressing the card again selects the agent; pressing it once more puts it down.
  await main('Meeting assistant').click();
  await expect(title()).toHaveText('Meeting assistant'); await expect(card('Meeting assistant')).toHaveAttribute('data-selected', '');
  await expect(card('Meeting assistant')).not.toHaveAttribute('data-owner', '');
  await main('Meeting assistant').click();
  await expect(title()).toHaveText('Pick an agent'); await expect(p.locator('.hm-grid [data-selected], .hm-grid [data-owner]')).toHaveCount(0);
});

// ---- The details panel.
test('an agent\'s details: its job, where it works, and its skills, tools and notes as cards with Remove', async () => {
  const p = page();
  await ensurePicked(main('Meeting assistant'));
  await expect(title()).toHaveText('Meeting assistant');
  await expect(panel().getByText('Summarizes meetings and writes replies.')).toBeVisible();
  await expect(panel().getByRole('heading', { level: 3 })).toHaveText(['Where it works', 'Skills', 'Tools', 'Notes']);
  expect(await panel().locator('[data-programs] .dt-chip').allInnerTexts()).toEqual(['Claude Code', 'Codex', 'OpenCode']);
  await expect(panel().locator('.kit-card')).toHaveCount(6);
  await expect(panel().getByRole('button', { name: 'Choose notes' })).toBeVisible();
  // A card in the panel opens that item's details.
  await panel().locator('.kit-card-main', { hasText: /^Read my calendar$/ }).click();
  await expect(title()).toHaveText('Read my calendar'); await expect(card('Meeting assistant')).toHaveAttribute('data-owner', '');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await expect(title()).toHaveText('Meeting assistant');
  expect(await budget()).toEqual([]); void p;
});

test('a skill\'s details: what it does, who uses it, where it works, where it came from, the full text on request, and Remove with its way back', async () => {
  const p = page();
  await chip('Meeting assistant', '4 skills').click();
  await line('Meeting assistant', 'skill', 'Summarize a meeting').click();
  await expect(title()).toHaveText('Summarize a meeting');
  await expect(panel().getByRole('heading', { level: 3 })).toHaveText(['What it does', 'Used by', 'Where it works', 'Where it came from']);
  await expect(panel().getByText('Turns a long meeting into a few clear points.')).toBeVisible();
  expect((await panel().locator('[data-used-by] .dt-agent').allInnerTexts()).sort()).toEqual(['Interview notetaker', 'Meeting assistant']);
  expect(await panel().locator('[data-programs] .dt-chip').allInnerTexts()).toEqual(['Claude Code']);
  await expect(panel().getByText('Made by you', { exact: true })).toBeVisible();
  // The full text is closed until asked for; it is plain, and it is the skill's own text.
  await expect(panel().locator('[data-budget="content"]')).toHaveCount(0);
  const show = panel().getByRole('button', { name: 'Show the full text' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await show.click();
  await expect(panel().getByRole('button', { name: 'Hide the full text' })).toHaveAttribute('aria-expanded', 'true');
  expect(await panel().locator('[data-budget="content"] p').allInnerTexts()).toEqual(['Read the notes or the transcript of the meeting.', 'List the three to five points that matter most.', 'Say who decided what, and keep it short.']);
  expect(await budget()).toEqual([]);
  expect(await panel().locator('[data-budget="content"]').evaluate(el => /cobalt|dovetail|inkwell|satchel/i.test(el.textContent ?? ''))).toBe(false);
  // "Used by" opens that agent.
  await panel().locator('[data-used-by]').getByRole('button', { name: 'Interview notetaker' }).click();
  await expect(title()).toHaveText('Interview notetaker'); await expect(main('Interview notetaker')).toHaveAttribute('aria-pressed', 'true');
  // Remove from the agent: one change on the bar, the agent is selected again, and Discard puts it back.
  await line('Meeting assistant', 'skill', 'Summarize a meeting').click();
  await panel().getByRole('button', { name: 'Remove from Meeting assistant' }).click();
  await expect(bar().getByText('Removed Summarize a meeting', { exact: true })).toBeVisible();
  await expect(title()).toHaveText('Meeting assistant'); await expect(title()).toBeFocused();
  await expect(chip('Meeting assistant', '3 skills')).toBeVisible();
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  await expect(chip('Meeting assistant', '4 skills')).toBeVisible();
  await expect(bar().getByText('Nothing to save yet')).toBeVisible(); void p;
});

test('a tool\'s details: what it can reach, how far it may go, a key that is needed or ready (never a value), who uses it, and no "Runs code" in the lists', async () => {
  const p = page();
  await chip('Meeting assistant', '1 tool').click();
  await expect(tray('Meeting assistant', 'tool').locator('.kit-status')).toHaveText('needs a key');
  expect(await tray('Meeting assistant', 'tool').locator('button.kit-status').count()).toBe(0);
  await line('Meeting assistant', 'tool', 'Read my calendar').click();
  await expect(title()).toHaveText('Read my calendar');
  await expect(panel().getByRole('heading', { level: 3 })).toHaveText(['What it can reach', 'Reaches', 'How far it can go', 'Used by']);
  await expect(panel().locator('[data-reaches]')).toHaveText('calendar.example.com');
  await expect(panel().getByText('Looks at your calendar to find the right times.')).toBeVisible();
  // Wave E: a tool named "Read ..." can only read, wherever its access is shown.
  await expect(panel().locator('[data-access]')).toHaveText('Can only read');
  await expect(panel().locator('[data-key="missing"]')).toContainText('needs a key'); await expect(panel().locator('[data-key="missing"]')).toContainText('Add this key when asked.');
  expect(await panel().innerText()).not.toMatch(/[A-Z]{3,}_[A-Z_]+|secret|token/i);
  await expect(panel().getByText('Runs code')).toHaveCount(0);
  // Another agent, another tool: it may only read, and its key is ready.
  await chip('Research assistant', '2 tools').click();
  await line('Research assistant', 'tool', 'Search the web').click();
  await expect(panel().locator('[data-access]')).toHaveText('Can only read'); await expect(panel().locator('[data-key="ready"]')).toHaveText('Its key is ready.');
  await expect(panel().getByText('needs a key')).toHaveCount(0);
  // The same tool for two agents can carry two access words.
  await chip('Writing coach', '2 tools').click();
  await line('Writing coach', 'tool', 'Draft a polite message').click();
  await expect(panel().locator('[data-access]')).toHaveText('Can only read');
  await line('Writing coach', 'tool', 'Suggest three titles').click();
  await expect(panel().locator('[data-access]')).toHaveText('Can change things');
  // No tool of any list runs code (hooks stay out of the lists).
  for (const name of ['Meeting assistant', 'Research assistant', 'Writing coach', 'Report builder']) {
    const count = await card(name).locator('.kit-count[data-kind="tool"]').count();
    if (count === 0) continue;
    const toolChip = card(name).locator('.kit-count[data-kind="tool"]');
    if ((await toolChip.getAttribute('aria-expanded')) !== 'true') await toolChip.click();
    for (const row of await lines(name, 'tool').all()) { await row.click(); await expect(panel().getByText('Runs code')).toHaveCount(0); }
  }
  expect(await budget()).toEqual([]); void p;
});

test('a set of notes\' details: what it covers, how many notes it can read, five titles, who reads it, Choose notes and Remove', async () => {
  const p = page();
  await chip('Meeting assistant', '1 note set').click();
  await line('Meeting assistant', 'note', 'Client list').click();
  await expect(title()).toHaveText('Client list');
  await expect(panel().getByRole('heading', { level: 3 })).toHaveText(['What it covers', 'Some of the notes', 'Used by']);
  await expect(panel().getByText(/^\d+ notes it can read\.$/)).toBeVisible();
  expect(await panel().locator('.dt-titles li').count()).toBe(5);
  expect((await panel().locator('[data-used-by] .dt-agent').allInnerTexts()).sort()).toEqual(['Inbox sorter', 'Meeting assistant']);
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await expect(p.getByRole('dialog', { name: /Choose notes/ }).or(p.getByRole('heading', { name: 'Choose notes' })).first()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(panel().getByRole('button', { name: 'Choose notes' })).toBeFocused();
  await panel().getByRole('button', { name: 'Remove from Meeting assistant' }).click();
  await expect(bar().getByText('Removed Client list', { exact: true })).toBeVisible();
  await expect(title()).toHaveText('Meeting assistant');
  await expect(card('Meeting assistant').getByRole('button', { name: '1 note set' })).toHaveCount(0);
  expect(await budget()).toEqual([]);
});

test('a row keeps its states: "needs a key" is dot and words and "2 different copies" is a text button that opens the copies dialog', async () => {
  const p = page();
  await chip('Inbox sorter', '4 skills').click();
  const badge = tray('Inbox sorter', 'skill').locator('button.kit-status');
  await expect(badge).toHaveText('2 different copies');
  await badge.click();
  const dialog = p.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(badge).toBeFocused();
  // The details of that skill carry the badge too, and it opens the same dialog.
  await line('Inbox sorter', 'skill', 'Sort mail by topic').click();
  await panel().locator('button.kit-status').click();
  await expect(dialog).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a new selection starts the panel at its top, even when the one before it was scrolled', async () => {
  const p = page();
  await resize(p, 900, 600);
  await ensurePicked(main('Meeting assistant'));
  await panel().evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await panel().evaluate(el => el.scrollTop)).toBeGreaterThan(50);
  await chip('Meeting assistant', '4 skills').click();
  await line('Meeting assistant', 'skill', 'Write a reply').click();
  await expect(title()).toHaveText('Write a reply');
  expect(await panel().evaluate(el => el.scrollTop)).toBe(0);
  await expect(panel().getByRole('button', { name: 'Back to agent' })).toBeInViewport();
});

// ---- Icon buttons and their tooltips (the Version history item has its words in the navigation; the toggle of the details is an icon only).
test('the details toggle is an icon-only button with a tooltip: 400 ms on hover, at once on focus, Escape hides it, and it never covers its button', async () => {
  const p = page();
  const button = p.locator('[data-details-toggle]');
  await expect(button).toBeVisible(); expect(await button.innerText()).toBe('');
  await expect(button).toHaveAttribute('aria-label', 'Hide details');
  expect(await button.locator('svg').count()).toBe(1);
  const tooltipId = (await button.getAttribute('aria-describedby'))!;
  expect(await p.evaluate(id => document.getElementById(id)?.getAttribute('role'), tooltipId)).toBe('tooltip');
  await expect(tip()).toHaveCount(0);   // closed: it is not in the accessibility tree
  // Hover: not at once, and then after about 400 ms.
  const t0 = Date.now();
  await button.hover();
  await expect(tip()).toBeHidden();
  await expect(tip()).toBeVisible({ timeout: 2000 });
  const waited = Date.now() - t0;
  console.log('MEASURED tooltip delay on hover (ms, includes the move of the pointer):', waited);
  expect(waited).toBeGreaterThanOrEqual(350); expect(waited).toBeLessThan(1000);
  await expect(tip()).toHaveText(/^Hide details \((?:Ctrl\+Shift\+B|⇧⌘B)\)$/);
  const b = await button.boundingBox(), t = await tip().boundingBox();
  // It sits under the button at the top right, lined up with its right edge: never over the button, and always inside the window.
  expect(t!.y).toBeGreaterThanOrEqual(b!.y + b!.height + 4); expect(t!.x + t!.width).toBeLessThanOrEqual(1280 + 0.5); expect(t!.x).toBeGreaterThanOrEqual(0);
  expect(Math.abs((t!.x + t!.width) - (b!.x + b!.width))).toBeLessThanOrEqual(1);
  expect(await tip().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  expect(await tip().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  // Escape hides it, and nothing else happens.
  await p.keyboard.press('Escape');
  await expect(tip()).toBeHidden(); await expect(p.getByRole('dialog')).toHaveCount(0); await expect(panel()).toBeVisible();
  // Leaving and coming back shows it again; leaving hides it.
  await p.mouse.move(2, 450); await p.mouse.move(2, 460);
  await button.hover(); await expect(tip()).toBeVisible({ timeout: 2000 });
  await p.mouse.move(2, 450);
  await expect(tip()).toBeHidden();
  // A press hides it and does its work, and it stays hidden while the pointer is still there.
  await button.hover(); await expect(tip()).toBeVisible({ timeout: 2000 });
  await button.click();
  await expect(panel()).toBeHidden();
  await expect(tip()).toBeHidden();
  expect(await budget()).toEqual([]);
});

test('the keyboard shows the tooltip at once, Escape hides it first and the drawer next, and the tooltip fades with no motion under reduce motion', async () => {
  const p = page();
  const toggle = p.locator('[data-details-toggle]');
  await p.getByRole('button', { name: 'Sort', exact: true }).focus();
  await p.keyboard.press('Escape'); await expect(tip()).toBeHidden();   // the tooltip of the button before it, put away
  await p.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await expect(tip()).toBeVisible({ timeout: 300 });
  await p.keyboard.press('Escape');
  await expect(tip()).toBeHidden();
  await p.keyboard.press('Enter');
  await expect(panel()).toBeHidden(); await expect(tip()).toBeHidden(); await expect(toggle).toBeFocused();
  await p.keyboard.press('Enter'); await expect(panel()).toBeVisible();
  // A drawer: the tooltip of its Close icon goes first, the drawer next, and the focus goes back to the item that opened it.
  await topBar('Version history').click();
  const drawer = p.getByRole('dialog', { name: 'Version history' });
  await expect(drawer).toBeVisible(); await expect(drawer.getByRole('heading', { name: 'Version history' })).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused(); await expect(tip()).toBeVisible({ timeout: 300 });
  await expect(tip()).toHaveText('Close');
  await p.keyboard.press('Escape');
  await expect(tip()).toBeHidden(); await expect(drawer).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0); await expect(topBar('Version history')).toBeFocused();
  // Reduce motion: the tooltip has no transition at all.
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--motion-reduced') === '1');
  await toggle.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  await expect(tip()).toBeVisible({ timeout: 300 });
  const facts = await tip().evaluate(el => ({ durations: getComputedStyle(el).transitionDuration.split(', '), opacity: getComputedStyle(el).opacity }));
  expect(facts.durations.every(d => d === '0s')).toBe(true); expect(facts.opacity).toBe('1');
});

test('the drawer, its list and every word on screen say Version history, never save points; each item keeps "Go back to this"', async () => {
  const p = page();
  await chip('Meeting assistant', '4 skills').click();
  await line('Meeting assistant', 'skill', 'Write a reply').click();
  await panel().getByRole('button', { name: 'Remove from Meeting assistant' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await topBar('Version history').click();
  const drawer = p.getByRole('dialog', { name: 'Version history' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { level: 2, name: 'Version history' })).toBeVisible();
  await expect(drawer.getByRole('list', { name: 'Version history' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Go back to this/ })).toHaveCount(1);
  const everything = await p.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label], [title], [alt]')].map(e => `${e.getAttribute('aria-label')} ${e.getAttribute('title')} ${e.getAttribute('alt')}`)].join('\n'));
  expect(everything).not.toMatch(/save point/i); expect(everything).toMatch(/Version history/);
  expect(await budget()).toEqual([]);
  await p.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

// ---- The keyboard does all of it.
test('the keyboard order is the tile that has the stop, its counts, then the rows of the tray that is open (it follows the last tile of the row); Enter opens a tray and Space on a row shows its details', async () => {
  const p = page();
  const focused = async (): Promise<string> => p.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el === null ? '' : (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(); });
  await main('Meeting assistant').focus();
  await p.keyboard.press('Tab'); expect(await focused()).toBe('4 skills');
  await p.keyboard.press('Tab'); expect(await focused()).toBe('1 tool');
  await p.keyboard.press('Tab'); expect(await focused()).toBe('1 note set');
  // The other tiles are not stops (the arrow keys reach them) and closed lists cannot be reached: the next stop is outside the grid.
  await p.keyboard.press('Tab'); expect(await p.evaluate(() => document.activeElement?.closest('.hm-grid') === null)).toBe(true);
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab');
  expect(await focused()).toBe('4 skills');
  await p.keyboard.press('Enter');
  await expect(chip('Meeting assistant', '4 skills')).toHaveAttribute('aria-expanded', 'true');
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  expect(await focused()).toBe('1 note set');
  // Meeting assistant is the last tile of its row, so its tray comes right after it.
  await p.keyboard.press('Tab'); expect(await focused()).toBe('Summarize a meeting');
  await p.keyboard.press('Tab'); expect(await focused()).toBe('Write a reply');
  await p.keyboard.press('Space');
  await expect(title()).toHaveText('Write a reply');
  await expect(line('Meeting assistant', 'skill', 'Write a reply')).toBeFocused();
  // Space on a chip closes it again, and the lines can no longer be reached.
  await chip('Meeting assistant', '4 skills').focus(); await p.keyboard.press('Space');
  await expect(chip('Meeting assistant', '4 skills')).toHaveAttribute('aria-expanded', 'false');
  await expect(lines('Meeting assistant', 'skill').first()).toBeHidden();
});

// ---- Two sizes: the text budget at every step, nothing cut off, nothing under 14 px.
for (const [w, h] of SIZES_A) {
  test(`at ${w} by ${h}: the map, an open tray, a skill, a tool, a set of notes and the drawer all fit, pass the text budget and have no text under 14 px`, async () => {
    const p = page();
    await resize(p, w, h);
    const check = async (state: string): Promise<void> => {
      await animationsDone(p);
      expect(await budget(), state).toEqual([]);
      expect(await smallText(), state).toEqual([]);
      expect(await overflowX(), `${state}: sideways scroll`).toBeLessThanOrEqual(0);
      const cut = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.kit-card, .kit-count')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).length);
      expect(cut, `${state}: cut off on the right`).toBe(0);
    };
    await check('map');
    await chip('Meeting assistant', '1 note set').click(); await check('tray of notes open');
    await chip('Meeting assistant', '1 tool').click(); await check('tray of tools open');
    await chip('Meeting assistant', '4 skills').click(); await check('tray of skills open');
    await line('Meeting assistant', 'skill', 'Summarize a meeting').click();
    await panel().getByRole('button', { name: 'Show the full text' }).click();
    await check('skill details');
    await chip('Meeting assistant', '1 tool').click(); await line('Meeting assistant', 'tool', 'Read my calendar').click(); await check('tool details');
    await chip('Meeting assistant', '1 note set').click(); await line('Meeting assistant', 'note', 'Client list').click(); await check('notes details');
    await main('Meeting assistant').click(); await check('agent details');
    await topBar('Version history').click(); await expect(p.getByRole('dialog', { name: 'Version history' })).toBeVisible(); await check('version history');
    // The tiles still line up: no tile is wider than the grid, and the counts of a tile stay inside it.
    const inside = await agentCards().evaluateAll(list => list.every(c => [...c.querySelectorAll('.kit-count')].every(k => { const a = k.getBoundingClientRect(), b = c.getBoundingClientRect(); return a.width === 0 || (a.left >= b.left - 1 && a.right <= b.right + 1); })));
    expect(inside).toBe(true);
  });
}

// ---- Screenshots, when HOME_U0_SHOTS names a folder.
for (const [w, h] of SIZES_A) {
  for (const look of THEMES) {
    test(`screenshots at ${w} by ${h}, ${look}: trays closed, a tray open, skill, tool, notes and agent details, the tooltip, Version history, Find, Welcome`, async () => {
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      await p.mouse.move(2, h - 4);
      await shot(p, 'map-chips-closed', w, h, look);
      await chip('Meeting assistant', '4 skills').click();
      await line('Meeting assistant', 'skill', 'Write a reply').click();
      await p.mouse.move(2, h - 4);
      await shot(p, 'card-two-chips-open', w, h, look);
      await panel().getByRole('button', { name: 'Show the full text' }).click();
      await shot(p, 'skill-details', w, h, look);
      await chip('Meeting assistant', '1 tool').click(); await line('Meeting assistant', 'tool', 'Read my calendar').click(); await p.mouse.move(2, h - 4);
      await shot(p, 'tool-details', w, h, look);
      await chip('Meeting assistant', '1 note set').click(); await line('Meeting assistant', 'note', 'Client list').click(); await p.mouse.move(2, h - 4);
      await shot(p, 'notes-details', w, h, look);
      await main('Research assistant').click(); await p.mouse.move(2, h - 4);
      await shot(p, 'agent-details', w, h, look);
      await p.locator('[data-details-toggle]').hover(); await expect(tip()).toBeVisible({ timeout: 2000 });
      await shot(p, 'tooltip', w, h, look);
      await p.mouse.move(2, h - 4);
      await topBar('Version history').click();
      await expect(p.getByRole('dialog', { name: 'Version history' })).toBeVisible();
      await shot(p, 'version-history', w, h, look);
      await fresh(p, WELCOME_PAGE, { welcome: true });
      await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
      await shot(p, 'welcome', w, h, look);
      await p.getByRole('button', { name: 'Find my agents' }).click();
      await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
      await shot(p, 'find', w, h, look);
    });
  }
}
