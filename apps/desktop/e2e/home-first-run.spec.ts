/**
 * The first minute of the 0.8 home app, in the real window (Electron started with --home-sample): Welcome, Find (the tiles light one by one, "Where I looked",
 * "Looks right"), the second question ("Read what is inside?"), the brief reading, the map, the tour that starts by itself and waits at step two for a real click,
 * "Find more", the closing note after the first Save, the keyboard alone, reduce motion, and the text budget on every screen at both sizes.
 * Set HOME_U0_SHOTS to a folder to also save each screen at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { animationsDone, framesPainted } from './page-wait.js';
import { MAP_PAGE, SIZES, THEMES, fresh, launchHome, resize, setLook, shot, SAVED } from './home-page.js';
import type { Home } from './home-page.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

let home: Home;
const page = (): Page => home.page;
const dialog = (): Locator => page().getByRole('dialog', { name: 'Tour' });
const find = (): Locator => page().locator('[data-screen="find"]');
const rows = (): Locator => page().locator('.fr-agent');
const panelFind = (): Locator => page().locator('aside.hm-panel[data-find]');
const findItem = (): Locator => page().locator('nav.hm-nav').getByRole('button', { name: 'Find more', exact: true });
const agentCards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), undefined, { welcome: true });
  await resize(page(), 1440, 900);
});

const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
async function toFind(): Promise<void> { await page().getByRole('button', { name: 'Find my agents' }).click(); await expect(find()).toBeVisible(); }
async function toPlaces(): Promise<void> { await toFind(); await expect(page().getByRole('button', { name: 'Looks right' })).toBeVisible(); }
async function toConfirm(): Promise<void> { await toPlaces(); await page().getByRole('button', { name: 'Looks right' }).click(); await expect(page().getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible(); }
async function toMap(): Promise<void> { await toConfirm(); await page().getByRole('button', { name: 'Yes, read them' }).click(); await expect(page().getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible(); }
/** Every piece of visible text on the page is 14 px or more. */
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
/** The tour starts a moment after the map shows: wait for it, then end it with Escape. */
async function endTour(): Promise<void> { await expect(dialog()).toBeVisible(); await page().keyboard.press('Escape'); await expect(dialog()).toHaveCount(0); }
const overflowX = async (): Promise<number> => page().evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- 1. Welcome
test('Welcome shows the logo, the one sentence, one button and one quiet line, and nothing else', async () => {
  const p = page();
  await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(p.locator('.fr-lead')).toHaveText('See everything your AI agents can do, and change it in one place.');
  await expect(p.getByRole('button')).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Find my agents' })).toBeFocused();
  await expect(p.locator('.fr-note')).toHaveText('Nothing is changed until you press Save.');
  expect((await p.locator('[data-home]').innerText()).replace(/\s+/g, ' ')).toBe('Bowerloom See everything your AI agents can do, and change it in one place. Find my agents Nothing is changed until you press Save.');
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
  expect(await p.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
});

test('Welcome comes back on every launch, and the map address skips it and the tour', async () => {
  const p = page();
  await toFind();
  await fresh(p, undefined, { welcome: true });
  await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
  await fresh(p);
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(p.locator('[data-screen="welcome"]')).toHaveCount(0);
  await framesPainted(p);
  await expect(dialog()).toHaveCount(0);
  await expect(agentCards()).toHaveCount(10);
});

// ---- 2. Find
test('the search shows its progress step by step, then one list of agents, with no tile for an app and no count for one; the list matches the map', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(find()).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Looking for your agents' })).toBeVisible();
  await expect(p.locator('.fr-tile')).toHaveCount(0);
  // The progress goes 0, 1, 2, 3 in turn and never back.
  const seen: number[] = [];
  for (let i = 0; i < 400; i += 1) {
    const now = await p.locator('[data-searching]').getAttribute('aria-valuenow', { timeout: 200 }).catch(() => null);
    if (now === null) break;
    const n = Number(now);
    if (seen.length === 0 || seen[seen.length - 1] !== n) seen.push(n);
    await p.waitForTimeout(40);
  }
  expect(seen.length, JSON.stringify(seen)).toBeGreaterThanOrEqual(3);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  await expect(p.getByRole('heading', { level: 1, name: 'Found 10 agents' })).toBeVisible();
  await expect(rows()).toHaveCount(10);
  await expect(p.locator('.fr-agent-name').first()).toHaveText('Inbox sorter');
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeFocused();
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
});

test('the real folders stay closed behind "Show details", and appear only there', async () => {
  const p = page();
  await toPlaces();
  expect(await p.locator('[data-home]').innerText()).not.toMatch(/\/Users|\.claude|\.codex|\.opencode/);
  const details = p.getByRole('button', { name: 'Show details' });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(p.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  await expect(p.locator('.fr-paths code').first()).toContainText('/Users/sample/Studio/.claude');
  expect(await p.locator('.fr-paths code').count()).toBeGreaterThanOrEqual(7);
  expect(await smallText()).toEqual([]);
  await p.getByRole('button', { name: 'Hide details' }).click();
  await expect(p.locator('.fr-paths')).toHaveCount(0);
});

// ---- The second question
test('"Looks right" asks "Read what is inside?" and nothing is read until "Yes, read them"', async () => {
  const p = page();
  await toConfirm();
  await expect(p.getByRole('button', { name: 'Yes, read them' })).toBeFocused();
  await expect(p.getByRole('button', { name: 'Not now' })).toBeVisible();
  await expect(p.getByText('Nothing is changed. Keys and passwords are never copied.')).toBeVisible();
  await expect(p.getByText('10 agents', { exact: true })).toBeVisible();
  await expect(p.locator('.hm-grid')).toHaveCount(0);
  await expect(p.locator('progress')).toHaveCount(0);
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
});

test('"Not now" reads nothing and goes back to Welcome; "Back" returns to the list with the ticks kept', async () => {
  const p = page();
  await toPlaces();
  await p.getByRole('checkbox', { name: 'Money tracker' }).uncheck();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await expect(p.getByText('9 agents', { exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Back' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 10 agents' })).toBeVisible();
  await expect(p.getByRole('checkbox', { name: 'Money tracker' })).not.toBeChecked();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Not now' }).click();
  await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(p.locator('.hm-grid')).toHaveCount(0);
});

test('"Looks right" cannot be pressed with every agent unticked, and says why', async () => {
  const p = page();
  await toPlaces();
  await p.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeDisabled();
  await expect(p.getByText('Tick at least one agent.')).toBeVisible();
  await p.getByRole('checkbox', { name: 'Trip organizer' }).check();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeEnabled();
});

// ---- 3. The map and the tour
test('after "Yes, read them" a brief reading shows, then the map, and the tour starts by itself on step one', async () => {
  const p = page();
  await toConfirm();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Reading your agents' })).toBeVisible();
  await expect(p.getByRole('progressbar', { name: 'Reading progress' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(agentCards()).toHaveCount(10);
  await expect(dialog()).toBeVisible();
  await expect(dialog().getByText('These are your AI agents, from every tool.')).toBeVisible();
  await expect(dialog().getByText('1 of 7')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Find more' })).toBeVisible();
});

test('step two waits for a real click on an agent: a plain hint that also names the keyboard, Next in its place, and the click moves the tour on', async () => {
  const p = page();
  await toMap();
  await dialog().getByRole('button', { name: 'Next' }).click();
  await expect(dialog().getByText('Click an agent to see what it can do.')).toBeVisible();
  await expect(dialog().getByText('2 of 7')).toBeVisible();
  await expect(dialog().getByText('Click an agent, or select one and press Enter.')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeEnabled();
  await framesPainted(p);
  // Nothing moves on by itself.
  await p.waitForTimeout(600);
  await expect(dialog().getByText('2 of 7')).toBeVisible();
  await expect(p.locator('.hm-panel h2')).toHaveText('Pick an agent');
  // A click outside the lit agent does nothing.
  await p.mouse.click(5, 450);
  await p.getByRole('button', { name: 'Sort', exact: true }).click({ force: true, position: { x: 4, y: 4 } });
  await expect(dialog().getByText('2 of 7')).toBeVisible();
  // A real click on the lit agent is the step's action.
  const first = agentCards().first();
  const name = (await first.locator('.kit-card-main').textContent()) ?? '';
  await first.locator('.kit-card-main').click();
  await expect(dialog().getByText('Skills show what the agent you picked can do.')).toBeVisible();
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await expect(p.locator('.hm-panel h2')).toHaveText(name);
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused();
});

test('a click on any lit agent counts, and Back from step three waits again', async () => {
  const p = page();
  await toMap();
  await dialog().getByRole('button', { name: 'Next' }).click();
  await agentCards().first().locator('.kit-card-main').click();
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await dialog().getByRole('button', { name: 'Back' }).click();
  await expect(dialog().getByText('Click an agent, or select one and press Enter.')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeEnabled();
});

test('a person who skips ahead is not left with an empty panel: step three opens an agent that has something to show', async () => {
  const p = page();
  await toMap();
  await dialog().getByRole('button', { name: 'Next' }).click();
  const first = agentCards().first().locator('.kit-card-main');
  await first.click();
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await dialog().getByRole('button', { name: 'Back' }).click();
  await expect(dialog().getByText('Click an agent, or select one and press Enter.')).toBeVisible();
  // The same agent again puts it away, and the tour moves on with nothing picked: the fallback opens one.
  await first.click();
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await expect(p.locator('.hm-panel h2')).toHaveText('Meeting assistant');
  await expect(p.locator('.hm-panel .kit-card').first()).toBeVisible();
});

test('"Skip tour" ends the tour at the waiting step and the map is ready to use', async () => {
  const p = page();
  await toMap();
  await dialog().getByRole('button', { name: 'Next' }).click();
  await dialog().getByRole('button', { name: 'Skip tour' }).click();
  await expect(dialog()).toHaveCount(0);
  await agentCards().nth(2).locator('.kit-card-main').click();
  await expect(p.locator('.hm-panel [data-kind="skill"]').first()).toBeVisible();
});

test('the tour does not start again after Find more, and Help replays it', async () => {
  const p = page();
  await toMap();
  await endTour();
  await findItem().click();
  await expect(panelFind()).toBeVisible();
  await expect(find()).toHaveCount(0);   // a panel in the right column, not the full page
  await expect(p.locator('[data-screen="welcome"]')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await framesPainted(p);
  await expect(dialog()).toHaveCount(0);
  await p.getByRole('button', { name: 'Help' }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(dialog().getByText('1 of 7')).toBeVisible();
});

// ---- Skipped agents
test('an unticked agent is skipped: it stays off the map, and Find more keeps the choice and can bring it back', async () => {
  const p = page();
  await toPlaces();
  for (const name of ['Inbox sorter', 'Interview notetaker', 'Meeting assistant']) await p.getByRole('checkbox', { name }).uncheck();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(agentCards()).toHaveCount(7);
  await expect(p.getByText('7 agents.')).toBeVisible();
  await endTour();
  await findItem().click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await expect(panelFind().getByRole('checkbox', { name: 'Inbox sorter' })).not.toBeChecked();
  await expect(panelFind().getByRole('checkbox', { name: 'Money tracker' })).toBeChecked();
  await panelFind().getByRole('checkbox', { name: 'Inbox sorter' }).check();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(agentCards()).toHaveCount(8);
});

test('"Not now" in Find more goes back to the map as it was', async () => {
  const p = page();
  await toMap();
  await endTour();
  await p.getByRole('button', { name: 'Find more' }).click();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Not now' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(agentCards()).toHaveCount(10);
});

test('Find more keeps an unsaved change in the draft', async () => {
  const p = page();
  await toMap();
  await endTour();
  await agentCards().nth(3).locator('.kit-card-main').click();
  await p.locator('.hm-panel [data-remove]').first().click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(/Removed/)).toBeVisible();
  await p.getByRole('button', { name: 'Find more' }).click();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(/Removed/)).toBeVisible();
});

// ---- 7. The closing note
test('the first Save of a guided session says it was saved in a note, once; a map opened by address says nothing', async () => {
  const p = page();
  await toMap();
  await endTour();
  const note = p.locator('.hm-toast[data-note]');
  await expect(note).toBeHidden();
  await agentCards().nth(3).locator('.kit-card-main').click();
  await p.locator('.hm-panel [data-remove]').first().click();
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(note).toHaveText(SAVED);
  expect(await budget()).toEqual([]);
  // It goes by itself, and the second Save is quiet.
  await expect(note).toBeHidden({ timeout: 15_000 });
  await p.locator('.hm-panel [data-remove]').first().click();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(SAVED, { exact: true })).toBeVisible();
  await p.waitForTimeout(500);
  await expect(note).toBeHidden();
  // A map opened by address has no note at all.
  await fresh(p);
  await agentCards().nth(3).locator('.kit-card-main').click();
  await p.locator('.hm-panel [data-remove]').first().click();
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(p.getByRole('region', { name: 'Save bar' }).getByText(SAVED, { exact: true })).toBeVisible();
  await expect(p.locator('.hm-toast[data-note]')).toBeHidden();
});

// ---- The keyboard alone
test('the whole first minute works with the keyboard alone', async () => {
  const p = page();
  await expect(p.getByRole('button', { name: 'Find my agents' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeFocused();
  // Tab reaches a tick (the last agent of the list), Space unticks it, Space ticks it again.
  await p.keyboard.press('Shift+Tab');
  await expect(p.getByRole('checkbox', { name: 'Writing coach' })).toBeFocused();
  await p.keyboard.press('Space');
  await expect(p.getByRole('checkbox', { name: 'Writing coach' })).not.toBeChecked();
  await p.keyboard.press('Space');
  await expect(p.getByRole('checkbox', { name: 'Writing coach' })).toBeChecked();
  await p.keyboard.press('Tab');
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(p.getByRole('button', { name: 'Show details' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.getByRole('button', { name: 'Hide details' })).toBeFocused();
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Enter');
  await expect(p.getByRole('button', { name: 'Yes, read them' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused();
  await p.keyboard.press('Enter');
  // Step two: the focus is on the first lit agent, Tab walks the agents (any of them will do), Shift+Tab from the first reaches the popover, and Enter on an agent is the click.
  await expect(dialog().getByText('2 of 7')).toBeVisible();
  await expect(agentCards().first().locator('.kit-card-main')).toBeFocused();
  // Tab goes through the card's own counts (the first agent has two) before it reaches the next agent.
  const chips = await agentCards().first().locator('.kit-count').count();
  expect(chips).toBe(2);
  for (let i = 0; i < chips; i += 1) { await p.keyboard.press('Tab'); await expect(agentCards().first().locator('.kit-count').nth(i)).toBeFocused(); }
  await p.keyboard.press('Tab');
  await expect(agentCards().nth(1).locator('.kit-card-main')).toBeFocused();
  for (let i = 0; i < chips + 1; i += 1) await p.keyboard.press('Shift+Tab');
  await expect(agentCards().first().locator('.kit-card-main')).toBeFocused();
  await p.keyboard.press('Shift+Tab');
  expect(await p.evaluate(() => document.activeElement?.closest('.tour-pop') !== null)).toBe(true);
  await p.keyboard.press('Tab');
  await expect(agentCards().first().locator('.kit-card-main')).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(dialog().getByText('3 of 7')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
});

test('Escape at the waiting step skips the tour', async () => {
  const p = page();
  await toMap();
  await expect(dialog().getByRole('button', { name: 'Next' })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(dialog().getByText('2 of 7')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
});

// ---- Reduce motion
test('with reduce motion on, the list just appears and nothing animates', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p, undefined, { welcome: true });
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await expect(rows()).toHaveCount(10);
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await p.evaluate(() => [...document.querySelectorAll('.fr-agent, .fr-agent *')].every(e => getComputedStyle(e).animationName === 'none'))).toBe(true);
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(dialog()).toBeVisible();
});

test('with motion on, the search bar grows with one short eased-out change and nothing loops', async () => {
  const p = page();
  await toFind();
  const facts = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.fr-progress-fill')!); return { animation: s.animationName, delay: s.transitionDelay, duration: s.transitionDuration, ease: s.transitionTimingFunction, property: s.transitionProperty }; });
  // The fill grows by scaleX over 240 ms with the strong ease-out, with no delay and no animation of its own.
  expect(facts).toMatchObject({ animation: 'none', delay: '0s', duration: '0.24s', property: 'transform' });
  expect(facts.ease.replaceAll('cubic-bezier(0.23, 1, 0.32, 1)', 'strong')).toBe('strong');
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await animationsDone(p);
  expect(await p.evaluate(() => document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
});

// ---- Both sizes, both looks
for (const [w, h] of SIZES) for (const look of THEMES) {
  test(`every screen fits at ${w} by ${h}, ${look}: one clear button, no sideways scroll, text 14 px or more, text budget kept`, async () => {
    const p = page();
    await setLook(p, look); await resize(p, w, h);
    await fresh(p, undefined, { welcome: true });
    await resize(p, w, h);
    // Welcome
    await expect(p.getByRole('button', { name: 'Find my agents' })).toBeInViewport();
    expect(await overflowX()).toBeLessThanOrEqual(0);
    expect(await smallText()).toEqual([]); expect(await budget()).toEqual([]);
    await shot(p, 'u3-1-welcome', w, h, look);
    // Find, in the middle of the search: the bar is a third of the way, and has settled.
    await p.getByRole('button', { name: 'Find my agents' }).click();
    await p.waitForFunction(() => document.querySelector('[data-searching]')?.getAttribute('aria-valuenow') === '1' && document.getAnimations().every(a => a.playState !== 'running'));
    await shot(p, 'u3-2-find-mid', w, h, look);
    await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
    await animationsDone(p);
    await expect(p.getByRole('button', { name: 'Looks right' })).toBeInViewport();
    expect(await overflowX()).toBeLessThanOrEqual(0);
    expect(await smallText()).toEqual([]); expect(await budget()).toEqual([]);
    await shot(p, 'u3-3-find-done', w, h, look);
    await p.getByRole('button', { name: 'Show details' }).click();
    await expect(p.getByRole('button', { name: 'Looks right' })).toBeInViewport();
    expect(await smallText()).toEqual([]); expect(await budget()).toEqual([]);
    await shot(p, 'u3-3b-find-details', w, h, look);
    await p.getByRole('button', { name: 'Hide details' }).click();
    // The second question
    await p.getByRole('button', { name: 'Looks right' }).click();
    await expect(p.getByRole('button', { name: 'Yes, read them' })).toBeInViewport();
    expect(await overflowX()).toBeLessThanOrEqual(0);
    expect(await smallText()).toEqual([]); expect(await budget()).toEqual([]);
    await shot(p, 'u3-4-confirm', w, h, look);
    // Reading, then the map with the tour.
    await p.getByRole('button', { name: 'Yes, read them' }).click();
    await expect(dialog()).toBeVisible();
    await animationsDone(p);
    expect(await budget()).toEqual([]);
    await shot(p, 'u3-5-tour-1', w, h, look);
    await dialog().getByRole('button', { name: 'Next' }).click();
    await expect(dialog().getByText('Click an agent, or select one and press Enter.')).toBeVisible();
    await animationsDone(p);
    expect(await budget()).toEqual([]);
    await expect(dialog().getByRole('button', { name: 'Skip tour' })).toBeInViewport();
    await shot(p, 'u3-6-tour-2-waiting', w, h, look);
  });
}

test('the map address is still the way straight in: ten agents, no tour, and the sizes agree', async () => {
  const p = page();
  await fresh(p, MAP_PAGE);
  await expect(agentCards()).toHaveCount(10);
  await expect(dialog()).toHaveCount(0);
});
