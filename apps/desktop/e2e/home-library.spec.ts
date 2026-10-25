/**
 * The Library page in the real window (Electron started with --prototype-v2, on the test page #prototype-v2/library): a tab for each kind, a live search with a
 * count, two orders, details for any thing (read only, with where it came from), the actions (Add to an agent, Remove from library with its dialog, Make my own
 * copy, Update with the two views, the "different copies" badge), "Add from the web" with the starter sources and a pasted link, the bad links, the
 * keyboard-only path, the order in which Escape closes layers, where the focus goes back to, the text budget after each step, both review sizes and reduce
 * motion. Set HOME_U0_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { MAP_PAGE, SAVED, ensurePicked, fresh, launchHome, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';
import { mkdirSync } from 'node:fs';

const WC_SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (WC_SHOTS !== null) mkdirSync(WC_SHOTS, { recursive: true });

const LIBRARY_PAGE = '#prototype-v2/library';
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;
let home: Home;
const page = (): Page => home.page;

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), LIBRARY_PAGE);
  await resize(page(), 1280, 800);
  await page().waitForSelector('[data-library]');
});

// ---- Small helpers.
const stage = (): Locator => page().locator('main.hm-stage');
const panel = (): Locator => page().locator('.hm-panel');
const rows = (): Locator => page().locator('.lb-row');
const tab = (name: string): Locator => page().getByRole('tab', { name: new RegExp(`^${name} \\d+$`) });
const search = (): Locator => page().getByRole('searchbox', { name: 'Search the library' });
const countLine = (): Locator => page().locator('[data-count]');
const bar = (): Locator => page().locator('.hm-savebar');
const barText = (): Locator => bar().locator('.hm-savebar-state p');
const row = (name: string): Locator => rows().filter({ has: page().getByRole('button', { name, exact: true }) });
const rowButton = (name: string): Locator => page().locator('.lb-list').getByRole('button', { name, exact: true });
const title = (): Locator => page().locator('#lb-panel-title');
const dialog = (kind: string): Locator => page().locator(`[data-dialog="${kind}"]`);
const sheet = (): Locator => page().locator('[data-slot="web"]');
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const focusedText = async (): Promise<string> => page().evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
const names = async (): Promise<string[]> => page().locator('.lb-list .kit-card-main').allTextContents();
async function pick(name: string): Promise<void> { await rowButton(name).click(); await expect(title()).toHaveText(name); }
async function goTab(name: string): Promise<void> { await tab(name).click(); await expect(tab(name)).toHaveAttribute('aria-selected', 'true'); }
async function openWeb(): Promise<void> { await page().getByRole('button', { name: 'Add from the web' }).click(); await expect(sheet()).toBeVisible(); await animationsDone(page()); }
const field = (): Locator => sheet().getByRole('textbox', { name: 'Paste a link' });
const problem = (): Locator => sheet().locator('.lb-problem');
async function openSource(name: string): Promise<void> { await sheet().getByRole('button', { name: `Open ${name}`, exact: true }).click(); await expect(sheet().locator('[data-banner]')).toBeVisible(); }

// ---- The page, the tabs and the list.
test('the page has the title, four tabs with their counts, a search, two orders and the one primary button, and writes nothing', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  for (const [name, n] of [['Skills', 53], ['Agents', 16], ['Tools', 14], ['Notes', 3]] as const) await expect(p.getByRole('tab', { name: `${name} ${n}` })).toBeVisible();
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true');
  await expect(countLine()).toHaveText('53 skills');
  await expect(search()).toBeVisible();
  await expect(p.getByRole('button', { name: 'Name', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.getByRole('button', { name: 'Recently added' })).toHaveAttribute('aria-pressed', 'false');
  await expect(p.getByRole('button', { name: 'Add from the web' })).toBeVisible();
  await expect(title()).toHaveText('Pick something');
  await expect(barText()).toHaveText('Nothing to save yet');
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  expect(await budget()).toEqual([]);
});

test('each tab lists everything of its kind, including what no agent uses, with a status and "Used by N agents"', async () => {
  const p = page();
  await expect(rows()).toHaveCount(53);
  await expect(row('Translate a text').getByText('Not used yet')).toBeVisible();
  await expect(row('Compare two options').getByText('Used by 3 agents')).toBeVisible();
  await expect(row('Sort mail by topic').getByRole('button', { name: '2 different copies' })).toBeVisible();
  await expect(row('Tidy my meeting notes').getByText('Update available')).toBeVisible();
  expect(await budget()).toEqual([]);
  await goTab('Agents');
  await expect(rows()).toHaveCount(16);
  await expect(countLine()).toHaveText('16 agents');
  await expect(row('Note taker').getByText('Ready-made')).toBeVisible();
  await expect(row('Meeting assistant')).toContainText('4 skills and 1 tool');
  expect(await budget()).toEqual([]);
  await goTab('Tools');
  await expect(rows()).toHaveCount(14);
  await expect(row('Read my calendar').getByText('needs a key')).toBeVisible();
  await expect(row('Check files after editing').getByText('Runs code')).toBeVisible();
  await expect(row('Write a meeting agenda').getByText('Not used yet')).toBeVisible();
  expect(await budget()).toEqual([]);
  await goTab('Notes');
  await expect(rows()).toHaveCount(3);
  await expect(countLine()).toHaveText('3 note sets');
  await expect(row('Client list').getByText('Used by 2 agents')).toBeVisible();
  expect(await budget()).toEqual([]);
  await expect(p.locator('.lb-list')).toHaveAttribute('data-kind', 'note');
});

test('the search filters by name and hint as you type, shows how many, and a tab change starts it again', async () => {
  const p = page();
  await search().fill('meeting');
  const n = await rows().count();
  expect(n).toBeGreaterThan(2); expect(n).toBeLessThan(53);
  await expect(countLine()).toHaveText(`${n} of 53 skills`);
  for (const text of await rows().allTextContents()) expect(text.toLowerCase()).toContain('meeting');
  await search().fill('PROS and cons');
  await expect(rows()).toHaveCount(1);
  await expect(row('Compare two options')).toBeVisible();
  await search().fill('zzzz');
  await expect(rows()).toHaveCount(0);
  await expect(p.getByText('Nothing matches your search.')).toBeVisible();
  await expect(countLine()).toHaveText('0 of 53 skills');
  await search().fill('(');
  await expect(rows()).toHaveCount(0);
  await search().fill('');
  await expect(rows()).toHaveCount(53);
  await search().fill('meeting');
  await goTab('Tools');
  await expect(search()).toHaveValue('');
  await expect(rows()).toHaveCount(14);
  expect(await budget()).toEqual([]);
});

test('the two orders: by name (alphabetical) and recently added (newest first, and a thing made now comes first)', async () => {
  const p = page();
  const byName = await names();
  expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
  await p.getByRole('button', { name: 'Recently added' }).click();
  await expect(p.getByRole('button', { name: 'Recently added' })).toHaveAttribute('aria-pressed', 'true');
  const byAdded = await names();
  expect(byAdded).not.toEqual(byName);
  expect([...byAdded].sort()).toEqual([...byName].sort());
  await pick('Compare two options');
  await panel().getByRole('button', { name: 'Make my own copy' }).click();
  await expect(rows().first().getByRole('button')).toHaveText('Compare two options (mine)');
});

// ---- Details.
test('picking a skill from outside fills the panel: what it does, who uses it, where it works, where it came from, the full text', async () => {
  const p = page();
  await pick('Find good sources');
  await expect(panel().getByText('Looks for trusted pages and papers on a topic.')).toBeVisible();
  await expect(panel().locator('[data-used-by]').getByRole('button', { name: 'Research assistant' })).toBeVisible();
  await expect(panel().locator('[data-programs] li').first()).toBeVisible();
  const origin = panel().locator('[data-origin]');
  await expect(origin).toContainText('Open skills library');
  await expect(origin.locator('[data-field="author"]')).not.toHaveText('');
  await expect(origin.locator('[data-field="release"]')).toHaveText(/^v1\.\d$/);
  await expect(origin.locator('[data-field="added"]')).toHaveText(/^\d{1,2} [A-Z][a-z]+ 2026$/);
  await expect(panel().getByRole('button', { name: 'Make my own copy' })).toBeVisible();
  await expect(panel().getByRole('button', { name: 'Remove from library' })).toBeVisible();
  const full = panel().getByRole('button', { name: 'Show the full text' });
  await full.click();
  await expect(panel().getByRole('region', { name: 'Full text' })).toContainText('Prefer sources that name their authors');
  expect(await budget()).toEqual([]);
  await panel().getByRole('button', { name: 'Hide the full text' }).click();
  await expect(panel().getByRole('region', { name: 'Full text' })).toHaveCount(0);
  // read only: there is no field or text box in the panel
  expect(await panel().locator('input, textarea, [contenteditable]').count()).toBe(0);
  await pick('Summarize a meeting');
  await expect(panel().locator('[data-origin]')).toContainText('Made by you');
  await expect(panel().getByRole('button', { name: 'Make my own copy' })).toHaveCount(0);
  await expect(p.locator('[data-origin] [data-field="author"]')).toHaveCount(0);
});

test('a tool says what it can reach (an example host) and how far it can go, and a hook says it runs code', async () => {
  await goTab('Tools');
  await pick('Read my calendar');
  await expect(panel().locator('[data-reach]')).toHaveText('Reaches calendar.example.com');
  await expect(panel().locator('[data-ability]')).toHaveText('Can change things');
  await expect(panel().locator('[data-flags]').getByText('Needs a key')).toBeVisible();
  await expect(panel().getByText('Add this key when asked.')).toBeVisible();
  await pick('Search the web');
  await expect(panel().locator('[data-ability]')).toHaveText('Can only read');
  await expect(panel().getByText('Its key is ready.')).toBeVisible();
  await pick('Check files after editing');
  await expect(panel().locator('[data-flags]').getByText('Runs code')).toBeVisible();
  await expect(panel().getByRole('button', { name: 'Add to an agent' })).toHaveCount(0);
  await expect(panel().getByText('It runs on its own, so it joins no agent.')).toBeVisible();
  await expect(panel().locator('[data-reach]')).toHaveText('This computer only');
  await panel().getByRole('button', { name: 'Show the full text' }).click();
  expect(await budget()).toEqual([]);
});

test('picking an agent lists what it has; picking a set of notes says how many notes; "Used by" opens the agent', async () => {
  const p = page();
  await goTab('Agents');
  await pick('Meeting assistant');
  await expect(panel().locator('[data-has] li')).toHaveCount(6);
  await expect(panel().getByRole('button', { name: 'Add to an agent' })).toHaveCount(0);
  await goTab('Notes');
  await pick('Client list');
  await expect(panel().getByText(/notes? it can read\./)).toBeVisible();
  await expect(panel().locator('[data-used-by] button')).toHaveCount(2);
  await panel().locator('[data-used-by]').getByRole('button').first().click();
  await expect(tab('Agents')).toHaveAttribute('aria-selected', 'true');
  await expect(p.locator('.lb-list .kit-card-main[aria-pressed="true"]')).toHaveCount(1);
  await expect(title()).toBeFocused();
  expect(await budget()).toEqual([]);
});

// ---- Management.
test('"Add to an agent": the picker marks the agents that have it, choosing one stages one change, and the focus comes back to the button', async () => {
  const p = page();
  await pick('Compare two options');
  const open = panel().getByRole('button', { name: 'Add to an agent' });
  await open.click();
  const picker = panel().getByRole('group', { name: 'Add to which agent?' });
  await expect(picker).toBeVisible();
  await expect(picker.locator('.add-pick[data-has]')).toHaveCount(3);
  await expect(picker.getByText('Has it')).toHaveCount(3);
  await expect(picker.locator('.add-pick[data-has] button').first()).toHaveAttribute('aria-disabled', 'true');
  await picker.locator('.add-pick[data-has] button').first().click({ force: true });
  await expect(barText()).toHaveText('Nothing to save yet');
  await picker.getByRole('button', { name: 'Report builder' }).click();
  await expect(picker).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(panel().getByText('Added to Report builder.')).toBeVisible();
  await expect(barText()).toHaveText('Added Compare two options to Report builder');
  await expect(panel().locator('[data-used-by] button')).toHaveCount(4);
  await expect(row('Compare two options').getByText('Used by 4 agents')).toBeVisible();
  await open.click();
  await expect(panel().getByRole('group', { name: 'Add to which agent?' }).locator('.add-pick[data-has]')).toHaveCount(4);
  await p.keyboard.press('Escape');
  await expect(panel().getByRole('group', { name: 'Add to which agent?' })).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await budget()).toEqual([]);
});

test('"Remove from library": the dialog names the agents and says what happens; Cancel and Escape change nothing; Remove stages one change; Discard brings it back', async () => {
  const p = page();
  await pick('Compare two options');
  const remove = panel().getByRole('button', { name: 'Remove from library' });
  await remove.click();
  const d = dialog('remove');
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Remove from the library?' })).toBeFocused();
  await expect(d.getByText('This takes it off 3 agents.')).toBeVisible();
  await expect(d.locator('.lb-names li')).toHaveCount(3);
  await expect(d.getByText('Nothing changes until you press Save.')).toBeVisible();
  expect(await budget()).toEqual([]);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(rows()).toHaveCount(53);
  await remove.click();
  await p.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(barText()).toHaveText('Nothing to save yet');
  await remove.click();
  await d.getByRole('button', { name: 'Remove from library' }).click();
  await expect(d).toHaveCount(0);
  await expect(rows()).toHaveCount(52);
  await expect(row('Compare two options')).toHaveCount(0);
  await expect(barText()).toHaveText('Removed Compare two options');
  await expect(countLine()).toHaveText('Removed Compare two options.');
  await expect(title()).toHaveText('Pick something');
  // the focus lands on the row that took its place
  expect(await page().evaluate(() => document.activeElement?.classList.contains('kit-card-main'))).toBe(true);
  await goTab('Agents');
  await pick('Research assistant');
  await expect(panel().locator('[data-has] li', { hasText: 'Compare two options' })).toHaveCount(0);
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  await goTab('Skills');
  await expect(rows()).toHaveCount(53);
  await expect(row('Compare two options')).toBeVisible();
});

test('removing a thing that no agent uses says so; removing a set of notes takes it off its agents', async () => {
  await pick('Translate a text');
  await panel().getByRole('button', { name: 'Remove from library' }).click();
  await expect(dialog('remove').getByText('No agent uses it yet.')).toBeVisible();
  await expect(dialog('remove').locator('.lb-names')).toHaveCount(0);
  await dialog('remove').getByRole('button', { name: 'Cancel' }).click();
  await goTab('Notes');
  await pick('Client list');
  await panel().getByRole('button', { name: 'Remove from library' }).click();
  await expect(dialog('remove').getByText('This takes it off 2 agents.')).toBeVisible();
  await dialog('remove').getByRole('button', { name: 'Remove from library' }).click();
  await expect(rows()).toHaveCount(2);
  await expect(barText()).toHaveText('Removed Client list');
});

test('"Make my own copy" makes "<name> (mine)", marked Made by you, picks it, and stages one change', async () => {
  await pick('Find good sources');
  await panel().getByRole('button', { name: 'Make my own copy' }).click();
  await expect(title()).toHaveText('Find good sources (mine)');
  await expect(title()).toBeFocused();
  await expect(panel().locator('[data-origin]')).toContainText('Made by you');
  await expect(panel().getByRole('button', { name: 'Make my own copy' })).toHaveCount(0);
  await expect(panel().getByText('Made your own copy.')).toBeVisible();
  await expect(rows()).toHaveCount(54);
  await expect(row('Find good sources (mine)').getByText('Not used yet')).toBeVisible();
  await expect(row('Find good sources')).toHaveCount(1);
  await expect(barText()).toHaveText('Added Find good sources (mine)');
  expect(await budget()).toEqual([]);
});

test('"Update": the two views side by side with the changed lines marked, "Use the update" stages one change, "Cancel" none', async () => {
  const p = page();
  await pick('Tidy my meeting notes');
  await expect(panel().locator('[data-origin] [data-field="release"]')).toHaveText('v1.2');
  const update = panel().getByRole('button', { name: 'Update', exact: true });
  await update.click();
  const d = dialog('update');
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { name: 'What the update changes' })).toBeFocused();
  await expect(d.getByRole('heading', { name: 'Now' })).toBeVisible();
  await expect(d.getByRole('heading', { name: 'After the update' })).toBeVisible();
  await expect(d.locator('[data-side="Now"] .add-line-row')).toHaveCount(3);
  await expect(d.locator('[data-side="After the update"] .add-line-row')).toHaveCount(4);
  await expect(d.locator('[data-side="After the update"] .add-line-row[data-changed]')).toHaveCount(2);
  await expect(d.locator('[data-side="Now"] .add-line-row[data-changed]')).toHaveCount(1);
  await expect(d.locator('[data-side="After the update"] .hm-sr', { hasText: 'Changed' })).toHaveCount(2);
  expect(await budget()).toEqual([]);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
  await expect(update).toBeFocused();
  await expect(barText()).toHaveText('Nothing to save yet');
  await update.click();
  await p.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await update.click();
  await d.getByRole('button', { name: 'Use the update' }).click();
  await expect(d).toHaveCount(0);
  await expect(barText()).toHaveText('Changed Tidy my meeting notes');
  await expect(panel().locator('[data-origin] [data-field="release"]')).toHaveText('v1.3');
  await expect(panel().getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await expect(row('Tidy my meeting notes').getByText('Update available')).toHaveCount(0);
  await expect(title()).toBeFocused();
  await panel().getByRole('button', { name: 'Show the full text' }).click();
  await expect(panel().getByRole('region', { name: 'Full text' })).toContainText('Add a line on what is still open.');
  expect(await budget()).toEqual([]);
});

test('the "2 different copies" badge opens the copies dialog, and keeping one clears the badge', async () => {
  const p = page();
  await row('Sort mail by topic').getByRole('button', { name: '2 different copies' }).click();
  const d = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: /Keep this copy/ }).first().click();
  await expect(d).toHaveCount(0);
  await expect(row('Sort mail by topic').getByRole('button', { name: /different copies/ })).toHaveCount(0);
  await expect(barText()).toHaveText('Kept one copy of Sort mail by topic');
  await pick('Sort mail by topic');
  await expect(panel().locator('[data-flags]')).toHaveCount(0);
});

test('save, version history and go back: each Library change is a row of the history and goes back', async () => {
  const p = page();
  await pick('Compare two options');
  await panel().getByRole('button', { name: 'Remove from library' }).click();
  await dialog('remove').getByRole('button', { name: 'Remove from library' }).click();
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(barText()).toHaveText(SAVED);
  await p.getByRole('button', { name: 'Version history' }).click();
  const points = p.locator('[data-slot="points"]');
  await expect(points.locator('.pt-row').first()).toContainText('Removed Compare two options');
  await p.keyboard.press('Escape');
  await expect(points).toHaveCount(0);
  await bar().getByRole('button', { name: 'Go back' }).click();
  await expect(barText()).toHaveText('Back to how it was');
  await expect(row('Compare two options')).toBeVisible();
  await expect(rows()).toHaveCount(53);
});

// ---- Add from the web.
test('the sheet opens over the whole window with the honest line, a field and three starter sources', async () => {
  const p = page();
  await openWeb();
  await expect(sheet().getByRole('heading', { name: 'Add from the web' })).toBeFocused();
  const box = await sheet().boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });
  await expect(sheet().getByText('This preview opens sample sources only. Nothing is downloaded.')).toBeVisible();
  await expect(field()).toBeVisible();
  await expect(sheet().getByRole('heading', { name: 'Starter sources' })).toBeVisible();
  await expect(sheet().locator('[data-source]')).toHaveCount(3);
  await expect(sheet().locator('[data-source]').first()).toContainText('Everyday office kit');
  await expect(sheet().locator('[data-source]').first()).toContainText('3 skills, 1 agent, 4 tools');
  expect(await budget()).toEqual([]);
  await p.keyboard.press('Escape');
  await expect(sheet()).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Add from the web' })).toBeFocused();
});

test('opening a starter source shows what it holds by kind, with the banner, the flags and the ticks', async () => {
  await openWeb();
  await openSource('Everyday office kit');
  await expect(sheet().getByText('From the web. Read it before you add it.')).toBeVisible();
  await expect(sheet().getByRole('heading', { name: 'Everyday office kit' })).toBeFocused();
  await expect(sheet().locator('[data-address]')).toHaveText('https://github.com/officekit/everyday-kit');
  for (const [kind, n] of [['skill', 3], ['agent', 1], ['tool', 4]] as const) await expect(sheet().locator(`[data-group="${kind}"] .lb-item`)).toHaveCount(n);
  const triage = sheet().locator('[data-item="triage-inbox"]');
  await expect(triage).toContainText('Triage my inbox');
  await expect(triage).toContainText('Sorts new mail into what needs you today and what can wait.');
  await expect(triage.locator('[data-field="author"]')).toHaveText('Made by Dana Whitfield');
  await expect(triage.locator('[data-field="release"]')).toHaveText('v2.1');
  const chat = sheet().locator('[data-item="send-chat"]');
  await expect(chat.locator('[data-reach]')).toHaveText('Reaches chat.example.com');
  await expect(chat.locator('[data-flag="changes"] .lb-flag-name')).toHaveText('Can change things');
  await expect(chat.getByText('Needs a key')).toBeVisible();
  const hook = sheet().locator('[data-item="tidy-files"]');
  await expect(hook.getByText('Runs code')).toBeVisible();
  await expect(hook.getByRole('checkbox')).not.toBeChecked();
  await expect(triage.getByRole('checkbox')).toBeChecked();
  expect(await sheet().getByRole('checkbox', { checked: true }).count()).toBe(7);
  await expect(sheet().getByRole('button', { name: 'Add 7 items' })).toBeEnabled();
  await expect(sheet().getByText('1 will show as two different copies.')).toBeVisible();
  await triage.getByRole('button', { name: 'Show the full text' }).click();
  await expect(triage.getByRole('region', { name: 'Full text' })).toContainText('Read the new mail');
  expect(await budget()).toEqual([]);
  await hook.getByRole('checkbox').check();
  await expect(sheet().getByRole('button', { name: 'Add 8 items' })).toBeVisible();
  await triage.getByRole('checkbox').uncheck();
  await expect(sheet().getByRole('button', { name: 'Add 7 items' })).toBeVisible();
  await sheet().getByRole('button', { name: 'Back to sources' }).click();
  await expect(sheet().locator('[data-source]')).toHaveCount(3);
  await expect(field()).toBeFocused();
});

test('"Add 7 items" stages them in the library on no agent, in one change; the second copy shows its badge; Discard takes them back', async () => {
  const p = page();
  await openWeb();
  await openSource('Everyday office kit');
  await sheet().getByRole('button', { name: 'Add 7 items' }).click();
  await expect(sheet()).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Add from the web' })).toBeFocused();
  await expect(countLine()).toHaveText('Added 7 items to your library.');
  await expect(p.getByRole('button', { name: 'Recently added' })).toHaveAttribute('aria-pressed', 'true');
  await expect(barText()).not.toHaveText('Nothing to save yet');
  await expect(rows()).toHaveCount(55);
  await expect(row('Triage my inbox').getByText('Not used yet')).toBeVisible();
  await expect(row('Summarize a meeting').getByRole('button', { name: '2 different copies' })).toBeVisible();
  await pick('Prepare a meeting brief');
  await expect(panel().locator('[data-origin]')).toContainText('Everyday office kit');
  await expect(panel().locator('[data-origin] [data-field="author"]')).toHaveText('Dana Whitfield');
  await expect(panel().locator('[data-origin] [data-field="release"]')).toHaveText('v2.1');
  await expect(panel().locator('[data-origin] [data-field="added"]')).toHaveText('Added just now');
  await expect(panel().locator('[data-used-by]')).toHaveCount(0);
  await goTab('Agents');
  await expect(row('Mail clerk').getByText('Ready-made')).toBeVisible();
  await goTab('Tools');
  await expect(row('Send a chat message').getByText('needs a key')).toBeVisible();
  await expect(row('Tidy files after saving')).toHaveCount(0);
  expect(await budget()).toEqual([]);
  // asking again: everything is here
  await openWeb();
  await openSource('Everyday office kit');
  await expect(sheet().getByRole('button', { name: 'Add 0 items' })).toBeDisabled();
  await expect(sheet().getByText('Everything you ticked is already here.')).toBeVisible();
  await p.keyboard.press('Escape');
  await bar().getByRole('button', { name: 'Undo all changes' }).click();
  await goTab('Tools');
  await expect(rows()).toHaveCount(14);
});

test('a pasted link of a sample source opens it, with spaces and a slash at the end and in capital letters', async () => {
  const p = page();
  await openWeb();
  await field().fill('  https://github.com/scholarbench/research-habits/  ');
  await sheet().getByRole('button', { name: 'Open link' }).click();
  await expect(sheet().getByRole('heading', { name: 'Research habits' })).toBeFocused();
  await expect(sheet().locator('.lb-item')).toHaveCount(6);
  await expect(sheet().getByText('1 is already here.')).toBeVisible();
  await expect(sheet().getByRole('button', { name: 'Add 5 items' })).toBeVisible();
  await sheet().getByRole('button', { name: 'Back to sources' }).click();
  await field().fill('HTTPS://GITHUB.COM/HomeLedger/Money-Tools');
  await field().press('Enter');
  await expect(sheet().getByRole('heading', { name: 'Home and money tools' })).toBeVisible();
  await expect(sheet().getByRole('button', { name: 'Add 4 items' })).toBeVisible();
  await expect(sheet().locator('[data-item="back-up"]').getByText('Runs code')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(sheet()).toHaveCount(0);
});

test('a link that is not a link to a collection says so; one that is well formed but is not a sample says it cannot open it, and the samples stay listed', async () => {
  await openWeb();
  for (const bad of ['hello', 'http://github.com/a/b', 'https://github.com/a', 'https://github.com/a/b/tree/main', 'javascript:alert(1)', '<b>x</b>', 'https://gitlab.com/a/b']) {
    await field().fill(bad);
    await sheet().getByRole('button', { name: 'Open link' }).click();
    await expect(problem()).toHaveText('That does not look like a link to a collection.');
    await expect(problem()).toHaveAttribute('data-problem', 'bad');
    await expect(sheet().locator('[data-banner]')).toHaveCount(0);
  }
  expect(await budget()).toEqual([]);
  await field().fill('');
  await sheet().getByRole('button', { name: 'Open link' }).click();
  await expect(problem()).toHaveText('Paste a link first.');
  await field().fill('https://github.com/someone/elsewhere');
  await expect(problem()).toHaveText('');
  await sheet().getByRole('button', { name: 'Open link' }).click();
  await expect(problem()).toHaveText('This preview cannot open that link. Try a sample source.');
  await expect(sheet().locator('[data-source]')).toHaveCount(3);
  expect(await budget()).toEqual([]);
  // a link is never made into a link on the page, and the typed text is never put in as markup
  await field().fill('https://github.com/someone/elsewhere"><img src=x onerror=alert(1)>');
  await sheet().getByRole('button', { name: 'Open link' }).click();
  expect(await page().evaluate(() => [document.querySelectorAll('[data-home] a[href]').length, document.querySelectorAll('img').length, document.querySelectorAll('[data-slot="web"] [onerror]').length])).toEqual([0, 0, 0]);
});

test('nothing in the sheet reaches out: no request leaves the page', async () => {
  const p = page();
  const requests: string[] = [];
  p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await openWeb();
  await field().fill('https://github.com/officekit/everyday-kit');
  await field().press('Enter');
  await expect(sheet().locator('[data-banner]')).toBeVisible();
  await sheet().getByRole('button', { name: 'Add 7 items' }).click();
  expect(requests).toEqual([]);
});

// ---- Keyboard and layers.
test('keyboard only: tabs by arrows, the list in one stop, arrows between rows, Enter picks, Tab reaches the actions, a dialog traps and gives the focus back', async () => {
  const p = page();
  await tab('Skills').focus();
  await p.keyboard.press('ArrowRight');
  await expect(tab('Agents')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Agents')).toBeFocused();
  await p.keyboard.press('End');
  await expect(tab('Notes')).toBeFocused();
  await p.keyboard.press('Home');
  await expect(tab('Skills')).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(search()).toBeFocused();
  await p.keyboard.type('compare');
  await expect(rows()).toHaveCount(2);
  await p.keyboard.press('Tab');
  await expect(p.getByRole('button', { name: 'Name', exact: true })).toBeFocused();
  await search().fill('');
  await search().focus();
  // Tab from the search goes through the three sort buttons and the filter to the list, which is one stop
  for (let i = 0; i < 4; i += 1) await p.keyboard.press('Tab');
  await expect(p.getByRole('button', { name: /^Not used yet \d+$/ })).toBeFocused();
  await p.keyboard.press('Tab');
  expect(await page().evaluate(() => document.activeElement?.classList.contains('kit-card-main'))).toBe(true);
  const first = await focusedText();
  await p.keyboard.press('ArrowDown');
  expect(await focusedText()).not.toBe(first);
  await p.keyboard.press('ArrowUp');
  expect(await focusedText()).toBe(first);
  await p.keyboard.press('End');
  expect(await focusedText()).toBe((await names()).at(-1));
  await p.keyboard.press('Home');
  await p.keyboard.press('Enter');
  await expect(title()).toHaveText(first);
  expect(await page().evaluate(() => document.querySelectorAll('.lb-list .kit-card-main[tabindex="0"]').length)).toBe(1);
  await pick('Compare two options');
  await rowButton('Compare two options').focus();
  // The only other stops in the list are the badges that open the copies dialog: a few Tab presses reach the panel, not fifty.
  for (let i = 0; i < 4 && !(await page().evaluate(() => document.activeElement?.closest('.hm-panel') !== null)); i += 1) await p.keyboard.press('Tab');
  await expect(panel().locator(':focus')).toHaveCount(1);
  await panel().getByRole('button', { name: 'Remove from library' }).focus();
  await p.keyboard.press('Enter');
  const d = dialog('remove');
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Remove from the library?' })).toBeFocused();
  for (let i = 0; i < 6; i += 1) await p.keyboard.press('Tab');
  expect(await page().evaluate(() => document.activeElement?.closest('[data-dialog="remove"]') !== null)).toBe(true);
  await p.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(panel().getByRole('button', { name: 'Remove from library' })).toBeFocused();
});

test('Escape closes one layer at a time: the help popover, then the picker, then a dialog, then the sheet; and the sheet closes with its own opener focused', async () => {
  const p = page();
  await openWeb();
  await sheet().getByRole('button', { name: 'About sample sources' }).click();
  await expect(sheet().getByText('Sample sources show how adding from the web will look.')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(sheet().getByText('Sample sources show how adding from the web will look.')).toHaveCount(0);
  await expect(sheet()).toBeVisible();
  await expect(sheet().getByRole('button', { name: 'About sample sources' })).toBeFocused();
  await openSource('Research habits');
  await p.keyboard.press('Escape');
  await expect(sheet()).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Add from the web' })).toBeFocused();
  await pick('Compare two options');
  await panel().getByRole('button', { name: 'Add to an agent' }).click();
  await p.keyboard.press('Escape');
  await expect(panel().getByRole('group', { name: 'Add to which agent?' })).toHaveCount(0);
  await expect(dialog('remove')).toHaveCount(0);
  await expect(title()).toHaveText('Compare two options');
  // The page has no bare "?" of its own: the tip is a line of text.
  await expect(p.getByRole('button', { name: 'About the library' })).toHaveCount(0);
  await expect(p.getByText('Everything you own is here, even what no agent uses.')).toBeVisible();
});

test('the copies dialog opened from a row gives the focus back to the row when its badge goes away', async () => {
  const p = page();
  await row('Sort mail by topic').getByRole('button', { name: '2 different copies' }).click();
  await p.keyboard.press('Escape');
  await expect(row('Sort mail by topic').getByRole('button', { name: '2 different copies' })).toBeFocused();
});

// ---- Looks, sizes, motion.
test('both review sizes show the page without anything cut off or overlapping, in light and dark', async () => {
  const p = page();
  await pick('Compare two options');
  for (const [w, h] of REVIEW) for (const look of LOOKS) {
    await resize(p, w, h); await setLook(p, look);
    const m = await p.evaluate(() => {
      const doc = document.documentElement;
      const box = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      return { scrollX: doc.scrollWidth - doc.clientWidth, stage: box('main.hm-stage'), panel: box('.hm-panel'), bar: box('.hm-savebar'), cols: getComputedStyle(document.querySelector('.lb-list')!).gridTemplateColumns.split(' ').length };
    });
    expect(m.scrollX, `${w}x${h} ${look}`).toBeLessThanOrEqual(0);
    expect(m.stage.r).toBeLessThanOrEqual(m.panel.l + 1);
    expect(m.panel.b).toBeLessThanOrEqual(m.bar.t + 1);
    expect(m.cols).toBe(w >= 1200 ? 2 : 1);
    // text is 14 px or more everywhere
    const small = await p.evaluate(() => [...document.querySelectorAll('[data-home] *')].filter(el => el.childNodes.length > 0 && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '') && parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent?.trim().slice(0, 30)));
    expect(small).toEqual([]);
    expect(await budget()).toEqual([]);
  }
});

test('the dialogs and the sheet fit both review sizes, in light and dark', async () => {
  const p = page();
  for (const [w, h] of REVIEW) for (const look of LOOKS) {
    await resize(p, w, h); await setLook(p, look);
    await fresh(p, LIBRARY_PAGE); await resize(p, w, h); await setLook(p, look);
    await pick('Tidy my meeting notes');
    await panel().getByRole('button', { name: 'Update', exact: true }).click();
    const box = await dialog('update').locator('.add-dialog, :scope').first().boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(w); expect(box!.y + box!.height).toBeLessThanOrEqual(h);
    await p.keyboard.press('Escape');
    await openWeb(); await openSource('Everyday office kit');
    const foot = await sheet().locator('.lb-web-foot').boundingBox();
    expect(foot!.y + foot!.height).toBeLessThanOrEqual(h);
    expect(await sheet().getByRole('button', { name: 'Add 7 items' }).isVisible()).toBe(true);
    await p.keyboard.press('Escape');
  }
});

test('reduce motion: the sheet and the dialogs come and go at once, with no animation running', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await openWeb();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await openSource('Everyday office kit');
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await p.keyboard.press('Escape');
  await expect(sheet()).toHaveCount(0, { timeout: 500 });
  await pick('Compare two options');
  await panel().getByRole('button', { name: 'Remove from library' }).click();
  await expect(dialog('remove')).toBeVisible();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  const times = await p.evaluate(() => [...document.querySelectorAll('.lb-list *, .lb-tabs *, [data-dialog] *')].map(el => getComputedStyle(el).transitionDuration).filter(d => d !== '0s' && d !== ''));
  expect(times).toEqual([]);
  await p.keyboard.press('Escape');
  await expect(dialog('remove')).toHaveCount(0, { timeout: 500 });
});

// ---- Screenshots, only when HOME_U0_SHOTS names a folder.
test('screenshots: each tab, a thing picked, the remove dialog, the update view, the web sheet, a source, a bad link', async () => {
  test.setTimeout(300_000);
  const p = page();
  for (const [w, h] of REVIEW) for (const look of LOOKS) {
    await fresh(p, LIBRARY_PAGE); await resize(p, w, h); await setLook(p, look);
    await shot(p, 'lib-1-skills', w, h, look);
    await goTab('Agents'); await shot(p, 'lib-2-agents', w, h, look);
    await goTab('Tools'); await shot(p, 'lib-3-tools', w, h, look);
    await goTab('Notes'); await shot(p, 'lib-4-notes', w, h, look);
    await goTab('Skills');
    await pick('Find good sources'); await shot(p, 'lib-5-picked', w, h, look);
    await goTab('Tools'); await pick('Read my calendar'); await shot(p, 'lib-5b-tool', w, h, look);
    await goTab('Skills'); await pick('Compare two options');
    await panel().getByRole('button', { name: 'Add to an agent' }).click(); await shot(p, 'lib-5c-picker', w, h, look);
    await p.keyboard.press('Escape');
    await panel().getByRole('button', { name: 'Remove from library' }).click(); await animationsDone(p); await shot(p, 'lib-6-remove', w, h, look);
    await p.keyboard.press('Escape');
    await pick('Tidy my meeting notes');
    await panel().getByRole('button', { name: 'Update', exact: true }).click(); await animationsDone(p); await shot(p, 'lib-7-update', w, h, look);
    await p.keyboard.press('Escape');
    await openWeb(); await shot(p, 'lib-8-web', w, h, look);
    await field().fill('https://github.com/someone/elsewhere'); await sheet().getByRole('button', { name: 'Open link' }).click(); await shot(p, 'lib-9-unknown', w, h, look);
    await field().fill('hello'); await sheet().getByRole('button', { name: 'Open link' }).click(); await shot(p, 'lib-9b-bad', w, h, look);
    await openSource('Everyday office kit'); await shot(p, 'lib-10-source', w, h, look);
    await sheet().locator('[data-item="triage-inbox"]').getByRole('button', { name: 'Show the full text' }).click();
    await sheet().locator('[data-group="tool"]').scrollIntoViewIfNeeded(); await shot(p, 'lib-10b-source-tools', w, h, look);
    await p.keyboard.press('Escape');
  }
});

// ---- Inside the app: the Library behind the switch in the top bar, with the shell's own Save bar and version history.
test.describe('inside the app', () => {
  const header = (): Locator => page().locator('header.hm-bar');
  const switchTab = (name: string): Locator => header().getByRole('tab', { name, exact: true });
  const history = (): Locator => page().locator('[data-slot="points"]');
  test.beforeEach(async () => {
    await fresh(page(), MAP_PAGE);
    await resize(page(), 1280, 800);
    await skipTour(page());
    await expect(page().getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible();
  });

  test('the top bar has a switch, Agents | Library, after the Preview mark: a quiet 32 px tab list, and the arrow keys move between the two', async () => {
    const p = page();
    const list = header().getByRole('tablist', { name: 'Pages' });
    await expect(list.getByRole('tab')).toHaveText(['Agents', 'Library']);
    await expect(switchTab('Agents')).toHaveAttribute('aria-selected', 'true');
    await expect(switchTab('Library')).toHaveAttribute('aria-selected', 'false');
    await expect(switchTab('Agents')).toHaveAttribute('tabindex', '0');
    await expect(switchTab('Library')).toHaveAttribute('tabindex', '-1');
    const box = (await list.boundingBox())!, preview = (await header().locator('[data-preview]').boundingBox())!, clock = (await header().getByRole('button', { name: 'Version history', exact: true }).boundingBox())!;
    expect(Math.round(box.height)).toBe(32);
    expect(box.x).toBeGreaterThanOrEqual(preview.x + preview.width);
    expect(box.x + box.width).toBeLessThanOrEqual(clock.x);
    await switchTab('Agents').focus();
    await p.keyboard.press('ArrowRight');
    await expect(switchTab('Library')).toHaveAttribute('aria-selected', 'true');
    await expect(switchTab('Library')).toBeFocused();
    await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await p.keyboard.press('ArrowRight');
    await expect(switchTab('Agents')).toBeFocused();
    await p.keyboard.press('End');
    await expect(switchTab('Library')).toBeFocused();
    await p.keyboard.press('Home');
    await expect(switchTab('Agents')).toHaveAttribute('aria-selected', 'true');
    await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible();
    expect(await budget()).toEqual([]);
  });

  test('the Library page takes the place of the map inside the same top bar and Save bar; there is one main place and one details panel at a time', async () => {
    const p = page();
    await switchTab('Library').click();
    await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toHaveCount(0);
    await expect(p.locator('main')).toHaveCount(1);
    await expect(p.locator('aside.hm-panel')).toHaveCount(1);
    await expect(header()).toBeVisible();
    await expect(bar()).toBeVisible();
    await expect(header().getByRole('button', { name: 'Add', exact: true })).toBeVisible();
    await expect(header().getByRole('button', { name: 'Share', exact: true })).toBeVisible();
    await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true');
    await expect(rows()).toHaveCount(53);
    expect(await budget()).toEqual([]);
    await switchTab('Agents').click();
    await expect(p.locator('.hm-grid .kit-card[data-kind="agent"]')).toHaveCount(10);
  });

  test('a change made on the Library page lands in the same Save bar and the same version history, and the map shows it', async () => {
    const p = page();
    await switchTab('Library').click();
    await pick('Compare two options');
    await panel().getByRole('button', { name: 'Remove from library' }).click();
    await dialog('remove').getByRole('button', { name: 'Remove from library' }).click();
    await expect(barText()).toHaveText('Removed Compare two options');
    await switchTab('Agents').click();
    await expect(barText()).toHaveText('Removed Compare two options');
    await expect(p.locator('.hm-grid .kit-card[data-kind="agent"]')).toHaveCount(10);
    // A change made on the map joins it.
    await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }));
    await p.locator('aside.hm-panel').getByRole('button', { name: 'Remove Write a reply' }).click();
    await expect(barText()).toHaveText('Removed Write a reply and Compare two options');
    await bar().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
    await header().getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(history()).toBeVisible();
    await expect(history().locator('.pt-row').first().locator('.pt-name')).toHaveText('Removed Write a reply and Compare two options');
    await expect(history().locator('.pt-row')).toHaveCount(2);
    await p.keyboard.press('Escape');
    await switchTab('Library').click();
    await expect(rows()).toHaveCount(52);
    await expect(rows().filter({ has: p.getByRole('button', { name: 'Compare two options', exact: true }) })).toHaveCount(0);
  });

  test('Undo all changes on the Library page puts back what the map removed, and the version history lists a library change', async () => {
    const p = page();
    await switchTab('Library').click();
    await pick('Translate a text');
    await panel().getByRole('button', { name: 'Remove from library' }).click();
    await dialog('remove').getByRole('button', { name: 'Remove from library' }).click();
    await expect(rows()).toHaveCount(52);
    await bar().getByRole('button', { name: 'Undo all changes' }).click();
    await expect(rows()).toHaveCount(53);
    await expect(barText()).toHaveText('Nothing to save yet');
    await pick('Translate a text');
    await panel().getByRole('button', { name: 'Remove from library' }).click();
    await dialog('remove').getByRole('button', { name: 'Remove from library' }).click();
    await bar().getByRole('button', { name: 'Save', exact: true }).click();
    await header().getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(history().locator('.pt-row').first()).toContainText('Removed Translate a text');
    await expect(history().locator('.pt-row').nth(0).locator('.pt-changes')).toHaveText('Removed Translate a text');
    await history().locator('.pt-row').nth(1).getByRole('button', { name: 'Go back to this' }).click();
    await p.keyboard.press('Escape');
    await expect(rows()).toHaveCount(53);
  });

  test('"Used by" on the Library page takes the person to Agents with that agent picked and the focus on its details', async () => {
    const p = page();
    await switchTab('Library').click();
    await pick('Compare two options');
    const first = panel().locator('[data-used-by] button').first();
    const who = (await first.textContent())!.trim();
    await first.click();
    await expect(switchTab('Agents')).toHaveAttribute('aria-selected', 'true');
    await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible();
    await expect(p.locator('aside.hm-panel').getByRole('heading', { level: 2, name: who })).toBeFocused();
    await expect(p.locator('.hm-grid').getByRole('button', { name: who, exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape closes one layer at a time on the Library page inside the app: the sheet first, and the page stays', async () => {
    const p = page();
    await switchTab('Library').click();
    await p.getByRole('button', { name: 'Add from the web' }).click();
    await expect(sheet()).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(sheet()).toHaveCount(0);
    await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Add from the web' })).toBeFocused();
    await header().getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(history()).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(history()).toHaveCount(0);
    await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('"Show me around" from the Library page brings the person back to Agents for the tour', async () => {
    const p = page();
    await switchTab('Library').click();
    await header().getByRole('button', { name: 'Help', exact: true }).click();
    await p.getByRole('button', { name: 'Show me around' }).click();
    await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible();
    await expect(switchTab('Agents')).toHaveAttribute('aria-selected', 'true');
    await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible();
    await p.keyboard.press('Escape');
  });

  for (const [w, h] of REVIEW) for (const look of LOOKS) {
    test(`the Library inside the app fits ${w} by ${h}, ${look}: nothing cut off, no text under 14 px`, async () => {
      const p = page();
      await resize(p, w, h); await setLook(p, look);
      await switchTab('Library').click();
      await pick('Compare two options');
      const m = await p.evaluate(() => {
        const box = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        const small = [...document.querySelectorAll('[data-home] *')].filter(el => el.childNodes.length > 0 && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '') && parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent?.trim().slice(0, 30));
        return { sx: document.documentElement.scrollWidth - document.documentElement.clientWidth, stage: box('main.hm-stage'), panel: box('aside.hm-panel'), bar: box('.hm-savebar'), head: box('header.hm-bar'), small };
      });
      expect(m.sx).toBeLessThanOrEqual(0);
      expect(m.stage.r).toBeLessThanOrEqual(m.panel.l + 1);
      expect(m.panel.b).toBeLessThanOrEqual(m.bar.t + 1);
      expect(m.stage.t).toBeGreaterThanOrEqual(m.head.b - 1);
      expect(m.small).toEqual([]);
      expect(await budget()).toEqual([]);
      if (WC_SHOTS !== null) { await animationsDone(p); await p.screenshot({ path: `${WC_SHOTS}/library-in-shell-${look}-${w}x${h}.png`, scale: 'css' }); }
    });
  }
});
