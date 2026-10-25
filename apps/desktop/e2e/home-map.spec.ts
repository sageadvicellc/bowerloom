/**
 * The map and its side panel, in the real window (Electron started with --prototype-v2): ten plain agents in one grid with no groups, a hint on every card,
 * the three shelves of the agent that is picked, a quiet Remove on every shelf card that stages one change, the Save bar that counts the changes, saves,
 * shows the three ticks and goes back, the sort toggle, the text budget on the real page in every state, and a path through all of it by keyboard alone.
 * Set HOME_U1_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark: start, agent picked, one change, saved.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { SIZES, THEMES, SAVED, ensurePicked, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const NAMES = ['Inbox sorter', 'Interview notetaker', 'Meeting assistant', 'Money tracker', 'Report builder', 'Research assistant', 'Schedule keeper', 'Support writer', 'Trip organizer', 'Writing coach'];
const BY_RECENT = ['Inbox sorter', 'Research assistant', 'Money tracker', 'Meeting assistant', 'Support writer', 'Trip organizer', 'Writing coach', 'Schedule keeper', 'Report builder', 'Interview notetaker'];

let home: Home;
const page = (): Page => home.page;
const agentCards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const agentButton = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });
const panel = (): Locator => page().locator('aside.hm-panel');
const shelf = (name: string): Locator => panel().getByRole('region', { name });
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const names = async (): Promise<string[]> => agentCards().locator('.kit-card-main').allTextContents();
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const pick = async (name = 'Meeting assistant'): Promise<void> => { await ensurePicked(agentButton(name)); await expect(panel().getByRole('heading', { level: 2, name })).toBeVisible(); };

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1440, 900);
  await skipTour(page());
});

test('the map is one plain grid of ten agents in name order: no groups, no group nodes, no sample nonsense, and a hint of what each can do', async () => {
  const p = page();
  expect(await names()).toEqual(NAMES);
  await expect(p.locator('.hm-grid')).toHaveCount(1);
  await expect(p.locator('[class*="group"], [data-kind="group"], [data-group]')).toHaveCount(0);
  const columns = await agentCards().evaluateAll(cards => new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(columns).toBeGreaterThanOrEqual(2);
  const hints = await agentCards().locator('.kit-card-hint').allTextContents();
  expect(hints).toHaveLength(10);
  for (const h of hints) { expect(countWords(h), h).toBeLessThanOrEqual(12); expect(h, h).not.toMatch(/\bwith \d+ (skills?|tools?)\b/); expect(h).toMatch(/^[A-Z].*\.$/); }
  expect(hints[2]).toBe('Summarizes meetings and writes replies.');
  const text = await p.locator('[data-home]').innerText();
  for (const old of ['Gilded', 'Gantry', 'Crisp', 'Mallet', 'Velvet', 'Weaver', 'Archivist', 'Forager']) expect(text).not.toContain(old);
  expect(text).not.toMatch(/\/Users\/|\.(md|json|toml)\b/);
});

test('every agent card carries data-drop-agent with the id of its agent, and the tour ids are still on the same things', async () => {
  const p = page();
  const ids = await agentCards().evaluateAll(cards => cards.map(c => c.getAttribute('data-drop-agent')));
  expect(ids).toHaveLength(10); expect(new Set(ids).size).toBe(10); expect(ids.every(id => /^agent-\d\d$/.test(id ?? ''))).toBe(true);
  expect(await p.locator('.hm-panel .kit-card[data-drop-agent]').count()).toBe(0);
  for (const id of ['bar', 'map', 'agent', 'details', 'add', 'save', 'help']) await expect(p.locator(`[data-tour~="${id}"]`)).toHaveCount(1);
  await expect(agentCards().first()).toHaveAttribute('data-tour', 'agent');
});

test('picking an agent fills the three shelves; every card is the same card, with a hint of at most 12 words and a quiet Remove', async () => {
  const p = page();
  // The map picks its first agent on its own; with that pick put down, the panel is empty, and picking an agent fills it.
  await expect(agentButton('Inbox sorter')).toHaveAttribute('aria-pressed', 'true');
  await agentButton('Inbox sorter').click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Pick an agent' })).toBeVisible();
  await expect(panel().locator('.kit-card')).toHaveCount(0);
  await pick();
  await expect(shelf('Skills').locator('.kit-card')).toHaveCount(3);
  await expect(shelf('Tools').locator('.kit-card')).toHaveCount(1);
  await expect(shelf('Notes').locator('.kit-card')).toHaveCount(1);
  expect(await shelf('Skills').locator('.kit-card-main').allTextContents()).toEqual(['Summarize a meeting', 'Write a reply', 'List action items']);
  expect(await shelf('Tools').locator('.kit-card-main').allTextContents()).toEqual(['Read my calendar']);
  expect(await shelf('Notes').locator('.kit-card-main').allTextContents()).toEqual(['Client list']);
  await expect(shelf('Tools').getByText('needs a key')).toBeVisible();
  await expect(panel().getByText('Summarizes meetings and writes replies.')).toBeVisible();
  const cards = panel().locator('.kit-card');
  await expect(cards).toHaveCount(5);
  for (const hint of await cards.locator('.kit-card-hint').allTextContents()) { expect(countWords(hint), hint).toBeGreaterThanOrEqual(3); expect(countWords(hint), hint).toBeLessThanOrEqual(12); }
  expect(await cards.locator('.kit-card-hint').count()).toBe(5);
  await expect(cards.getByRole('button', { name: /^Remove / })).toHaveCount(5);
  await p.mouse.move(2, 450); await animationsDone(p);
  const look = await cards.evaluateAll(list => list.map(c => { const s = getComputedStyle(c), r = c.getBoundingClientRect(), n = getComputedStyle(c.querySelector('.kit-card-main')!), h = getComputedStyle(c.querySelector('.kit-card-hint')!); return [s.borderRadius, s.borderTopWidth, s.boxShadow, n.fontSize, n.fontWeight, h.fontSize, Math.round(r.left), Math.round(r.width)].join('|'); }));
  expect(new Set(look).size, look.join('\n')).toBe(1);
  const remove = await cards.first().getByRole('button', { name: /^Remove / }).evaluate(b => { const s = getComputedStyle(b), r = b.getBoundingClientRect(); return { size: parseFloat(s.fontSize), h: r.height, w: r.width }; });
  console.log('MEASURED Remove button:', JSON.stringify(remove));
  expect(remove.size).toBeGreaterThanOrEqual(14); expect(remove.h).toBeGreaterThanOrEqual(32);
  expect(await budget()).toEqual([]);
});

test('Remove stages one change: the card goes, the bar says what it was, Save turns on, nothing is saved yet, and the agent hint follows its skills', async () => {
  const p = page();
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' }).click();
  await expect(shelf('Skills').locator('.kit-card')).toHaveCount(2);
  expect(await shelf('Skills').locator('.kit-card-main').allTextContents()).toEqual(['Write a reply', 'List action items']);
  await expect(bar().getByText('Removed Summarize a meeting', { exact: true })).toBeVisible();
  await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(panel().getByText('Writes replies and lists action items.')).toBeVisible();
  await expect(agentButton('Meeting assistant').locator('xpath=ancestor::div[contains(@class,"kit-card")][1]').locator('.kit-card-hint')).toHaveText('Writes replies and lists action items.');
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await shelf('Tools').getByRole('button', { name: 'Remove Read my calendar' }).click();
  await expect(bar().getByText('Removed Summarize a meeting and Read my calendar', { exact: true })).toBeVisible();
  await expect(shelf('Tools').locator('.kit-card')).toHaveCount(0);
  await expect(shelf('Tools').getByText('Nothing here yet.')).toBeVisible();
  await shelf('Notes').getByRole('button', { name: 'Remove Client list' }).click();
  await expect(bar().getByText('3 changes', { exact: true })).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('Save makes a save point and shows "Saved" with three ticks; Go back undoes it and the card comes back', async () => {
  const p = page();
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await shelf('Skills').getByRole('button', { name: 'Remove List action items' }).click();
  await expect(bar().getByText('Removed Write a reply and List action items', { exact: true })).toBeVisible();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  const ticks = bar().locator('.hm-tick');
  await expect(ticks).toHaveText(['Claude Code', 'Codex', 'OpenCode']);
  await expect(bar().getByRole('list', { name: 'Would update' })).toBeVisible();
  await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(bar().getByRole('button', { name: 'Go back' })).toBeFocused();
  expect(await shelf('Skills').locator('.kit-card-main').allTextContents()).toEqual(['Summarize a meeting']);
  // The save point is real: the Version history drawer is a placeholder in this slice, so read the store through the page's own words instead: Save is off and the bar is calm.
  await expect(bar().getByText('Nothing to save yet')).toHaveCount(0);
  expect(await budget()).toEqual([]);
  await bar().getByRole('button', { name: 'Go back' }).click();
  await expect(bar().getByText('Back to how it was')).toBeVisible();
  await expect(bar().locator('.hm-tick')).toHaveCount(0);
  await expect(bar().getByRole('button', { name: 'Go back' })).toHaveCount(0);
  await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(await shelf('Skills').locator('.kit-card-main').allTextContents()).toEqual(['Summarize a meeting', 'Write a reply', 'List action items']);
  await expect(panel().getByText('Summarizes meetings and writes replies.')).toBeVisible();
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeFocused();
  // A new change after going back starts the count again.
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await expect(bar().getByText('Removed Write a reply', { exact: true })).toBeVisible();
  expect(await budget()).toEqual([]);
  await p.mouse.move(2, 450);
});

test('a second save, and a go back from it, return to the save point before it and not to the start', async () => {
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await shelf('Skills').getByRole('button', { name: 'Remove List action items' }).click();
  await expect(bar().getByText('Removed List action items', { exact: true })).toBeVisible();
  await expect(bar().getByText(SAVED, { exact: true })).toHaveCount(0);
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await bar().getByRole('button', { name: 'Go back' }).click();
  expect(await shelf('Skills').locator('.kit-card-main').allTextContents()).toEqual(['Summarize a meeting', 'List action items']);
});

test('Discard changes puts everything back and the bar goes calm', async () => {
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Discard changes' }).click();
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  await expect(shelf('Skills').locator('.kit-card')).toHaveCount(3);
  await expect(bar().getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
});

test('the sort toggle orders the map by name or by recent change; an agent changed in this session comes first', async () => {
  const p = page();
  const toggle = p.getByRole('group', { name: 'Order of the agents' });
  await expect(toggle.getByRole('button', { name: 'Name' })).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle.getByRole('button', { name: 'Recently changed' })).toHaveAttribute('aria-pressed', 'false');
  await toggle.getByRole('button', { name: 'Recently changed' }).click();
  await expect(toggle.getByRole('button', { name: 'Recently changed' })).toHaveAttribute('aria-pressed', 'true');
  expect(await names()).toEqual(BY_RECENT);
  await pick('Writing coach');
  await shelf('Skills').getByRole('button', { name: 'Remove Improve a draft' }).click();
  expect((await names())[0]).toBe('Writing coach');
  await toggle.getByRole('button', { name: 'Name' }).click();
  expect(await names()).toEqual(NAMES);
  await expect(panel().getByRole('heading', { level: 2, name: 'Writing coach' })).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('the tour still works: step 3 shows the shelves with content, the six steps run, and Help replays them', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  const dialog = p.getByRole('dialog', { name: 'Tour' });
  await expect(dialog).toBeVisible();
  await expect(panel().locator('.kit-card')).toHaveCount(0);
  await p.keyboard.press('Enter');
  await expect(dialog.getByText('Click an agent to see what it can do.')).toBeVisible();
  await expect(panel().locator('.kit-card')).toHaveCount(0);
  // Step two waits for the person: the Enter that moves on is a press on the first agent (the focus is on it), and the panel shows that agent.
  await p.keyboard.press('Enter');
  await expect(dialog.getByText('Skills are what it knows how to do.')).toBeVisible();
  await expect(panel().locator('.kit-card').first()).toBeVisible();
  expect(await panel().locator('.kit-card').count()).toBeGreaterThanOrEqual(3);
  await expect(panel().getByRole('heading', { level: 2, name: 'Inbox sorter' })).toBeVisible();
  expect(await budget()).toEqual([]);
  for (let i = 0; i < 4; i += 1) await p.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(panel().locator('.kit-card').first()).toBeVisible();
  await p.getByRole('button', { name: 'Help' }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(dialog.getByText('These are your AI agents, from every tool.')).toBeVisible();
  await expect(dialog.getByText('1 of 6')).toBeVisible();
});

test('the text budget holds on the real page in every state, nothing is under 14 px, and no file path shows', async () => {
  const p = page();
  const sizes = async (): Promise<{ text: string; size: number }[]> => p.evaluate(() => {
    const out: { text: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim(), el = n.parentElement;
      if (text === '' || el === null || el.closest('svg, .hm-sr')) continue;
      out.push({ text, size: parseFloat(getComputedStyle(el).fontSize) });
    }
    return out;
  });
  const check = async (state: string): Promise<void> => {
    expect(await budget(), state).toEqual([]);
    const small = (await sizes()).filter(s => s.size < 14);
    expect(small, `${state}: ${JSON.stringify(small)}`).toEqual([]);
    expect(await p.locator('[data-home]').innerText(), state).not.toMatch(/\/Users\/|\.(md|json|toml|sh)\b|harness|conflict|version/i);
  };
  await check('start');
  await pick(); await check('picked');
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click(); await check('one change');
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().locator('.hm-tick')).toHaveCount(3); await check('saved');
  await bar().getByRole('button', { name: 'Go back' }).click(); await check('went back');
  await p.getByRole('button', { name: 'Recently changed' }).click(); await check('recent order');
});

test('the keyboard does all of it: reach an agent, pick it, reach Remove, remove, reach Save, save, go back', async () => {
  const p = page();
  await agentButton('Meeting assistant').focus();
  await p.keyboard.press('Enter');
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeVisible();
  const first = shelf('Skills').locator('.kit-card-main').first();
  await first.focus();
  await p.keyboard.press('Tab');
  const remove = shelf('Skills').getByRole('button', { name: 'Remove Summarize a meeting' });
  await expect(remove).toBeFocused();
  expect(await p.evaluate(() => { const r = document.activeElement!; return parseFloat(getComputedStyle(r).outlineWidth); }), 'the ring on Remove').toBeGreaterThanOrEqual(3);
  await p.keyboard.press('Enter');
  await expect(bar().getByText('Removed Summarize a meeting', { exact: true })).toBeVisible();
  await expect(shelf('Skills').locator('.kit-card-main').first()).toBeFocused();
  await expect(shelf('Skills').locator('.kit-card-main').first()).toHaveText('Write a reply');
  // Space works on Remove too, and the focus moves to the next card each time.
  await p.keyboard.press('Tab'); await p.keyboard.press('Space');
  await expect(bar().getByText('Removed Summarize a meeting and Write a reply', { exact: true })).toBeVisible();
  // Tab on to Save: through the rest of the shelves and the "?" of Tools.
  let reached = false;
  for (let i = 0; i < 40 && !reached; i += 1) {
    await p.keyboard.press('Tab');
    reached = await p.evaluate(() => (document.activeElement?.textContent ?? '').trim() === 'Save' && document.activeElement?.closest('[aria-label="Save bar"]') !== null);
  }
  expect(reached, 'Save is reachable by Tab').toBe(true);
  await p.keyboard.press('Enter');
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await expect(bar().getByRole('button', { name: 'Go back' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(bar().getByText('Back to how it was')).toBeVisible();
  await expect(shelf('Skills').locator('.kit-card')).toHaveCount(3);
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeFocused();
});

test('the sort toggle works by keyboard, and its buttons show a ring', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Name', exact: true }).focus();
  await p.keyboard.press('Tab');
  await expect(p.getByRole('button', { name: 'Recently changed' })).toBeFocused();
  await p.keyboard.press('Enter');
  expect(await names()).toEqual(BY_RECENT);
  expect(await p.evaluate(() => parseFloat(getComputedStyle(document.activeElement!).outlineWidth))).toBeGreaterThanOrEqual(3);
});

test('with reduce motion on, saving runs no animation: the ticks appear at once', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().locator('.hm-tick')).toHaveCount(3);
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await bar().locator('.hm-tick').first().evaluate(e => { const s = getComputedStyle(e); return s.animationName === 'none' || parseFloat(s.animationDuration) === 0; })).toBe(true);
});

test('with motion on, the chips come in together over 140 ms, with no delay between them, and stop', async () => {
  const p = page();
  await pick();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  // The three chips share one short fade (the overlay token, 140 ms); the old 64 and 128 ms delays between them are gone.
  expect(await bar().locator('.hm-would').evaluate(e => getComputedStyle(e).animationDuration)).toBe('0.14s');
  expect(await bar().locator('.hm-tick').evaluateAll(list => list.map(e => getComputedStyle(e).animationDelay))).toEqual(['0s', '0s', '0s']);
  expect(await bar().locator('.hm-would').evaluate(e => getComputedStyle(e).animationDelay)).toBe('0s');
  await animationsDone(p);
  expect(await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
});

for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} nothing is cropped in any state: no sideways scroll, the cards inside the panel, hints whole, the bar in view`, async () => {
    const p = page();
    await resize(p, w, h);
    const measure = async (state: string): Promise<void> => {
      const m = await p.evaluate(() => {
        const doc = document.documentElement, pn = document.querySelector('aside.hm-panel')!.getBoundingClientRect(), sb = document.querySelector('.hm-savebar')!.getBoundingClientRect();
        const cards = [...document.querySelectorAll('aside.hm-panel .kit-card')];
        const clipped = [...document.querySelectorAll('.kit-card-main, .kit-card-hint, .kit-remove, .hm-seg-button, .hm-tick')].filter(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
        const inside = cards.every(c => { const r = c.getBoundingClientRect(); return r.left >= pn.left && r.right <= pn.right + 0.5; });
        const barKids = [...document.querySelectorAll('.hm-savebar > *, .hm-savebar button, .hm-savebar li')].every(e => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 0.5 && r.left >= 0; });
        const stage = document.querySelector('.hm-stage-head')!.getBoundingClientRect();
        return { sideways: doc.scrollWidth - doc.clientWidth, clipped, inside, barBottom: sb.bottom, vh: window.innerHeight, barKids, stageRight: stage.right, stageW: document.querySelector('main.hm-stage')!.getBoundingClientRect().right };
      });
      expect(m.sideways, state).toBeLessThanOrEqual(0); expect(m.clipped, state).toEqual([]); expect(m.inside, state).toBe(true);
      expect(m.barBottom, state).toBeLessThanOrEqual(m.vh + 0.5); expect(m.barKids, state).toBe(true); expect(m.stageRight, state).toBeLessThanOrEqual(m.stageW + 0.5);
    };
    await measure('start');
    await pick(); await measure('picked');
    await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click(); await measure('one change');
    await bar().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar().locator('.hm-tick')).toHaveCount(3); await animationsDone(p); await measure('saved');
    // The panel can be scrolled to every card.
    const last = panel().locator('.kit-card').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
}

const shotsDir = process.env.HOME_U1_SHOTS ?? null;
if (shotsDir !== null) {
  mkdirSync(shotsDir, { recursive: true });
  for (const [w, h] of SIZES) for (const look of THEMES) {
    test(`screenshots at ${w} by ${h}, ${look}: start, agent picked, one change, saved`, async () => {
      test.setTimeout(120_000);
      const p = page();
      await setLook(p, look); await resize(p, w, h);
      const shot = async (name: string): Promise<void> => { await p.mouse.move(2, h - 2); await animationsDone(p); await p.screenshot({ path: join(shotsDir, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };
      await shot('1-start');
      await pick(); await shot('2-picked');
      await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click(); await shot('3-one-change');
      await bar().getByRole('button', { name: 'Save', exact: true }).click();
      await expect(bar().locator('.hm-tick')).toHaveCount(3); await shot('4-saved');
    });
  }
}
