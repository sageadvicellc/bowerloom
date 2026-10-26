/**
 * Share in the real window (Electron started with --prototype-v2, on the home app itself): the Share section at the foot of the Version history drawer, the Share
 * sheet (counts, what is left out, the agents to leave out, "Create share file"), the round trip into "Open a shared file" (the same counts come back), the agents
 * that Find skipped, the keyboard alone, less motion, Escape one layer at a time, text size, and the text budget on the real page at every step.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { planShare, shareableAgents } from '../shared/home/share-model.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { generateWorld } from '../shared/proto/sample.js';
import { withLibrarySamples } from '../shared/home/library-sample.js';
import { countsLine, leftOutLine } from '../renderer/home/share/share-words.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { SIZES, THEMES, ensurePicked, fresh, keyToNav, launchHome, rectOf, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
// The world the app opens with: the sample copies and the Library's sample pieces (one ready-made skill from outside, held by two agents).
const world = withLibrarySamples(withSampleCopies(generateWorld(1)));
const ids = shareableAgents(world).map(a => a.id);
const all = planShare(world, ids, []);
const topBar = (name: string): Locator => page().locator('nav.hm-nav').getByRole('button', { name, exact: true });
const addDrawer = (): Locator => page().locator('[data-slot="add"]');
const pointsDrawer = (): Locator => page().locator('[data-slot="points"]');
const sheet = (): Locator => page().getByRole('dialog', { name: 'Share my agents' });
const section = (): Locator => pointsDrawer().locator('[data-share-section]');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const counts = (): Locator => sheet().locator('.sh-counts');
const leftOut = (): Locator => sheet().locator('.sh-left');
const rowOf = (name: string): Locator => sheet().locator('.sh-row').filter({ hasText: name });
/** The ids of the agents in the first `n` rows of the sheet (the rows are in the order of the names on the map). */
const firstRows = async (n: number): Promise<string[]> => (await sheet().locator('.sh-row').evaluateAll(rows => rows.map(r => r.getAttribute('data-agent') ?? ''))).slice(0, n);

async function openPoints(): Promise<void> {
  if (!(await pointsDrawer().isVisible())) await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  await animationsDone(page());
}
async function openSheet(): Promise<void> {
  await openPoints();
  await section().getByRole('button', { name: 'Share my agents' }).click();
  await expect(sheet()).toBeVisible();
}
/** Presses Tab until `target` has the focus. The longest walk in this file is 10 presses, so 20 is the limit: a focus lost to the top of the page needs far more and fails here. */
async function tabTo(target: Locator, max = 20): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate(el => el === document.activeElement).catch(() => false)) return;
    await page().keyboard.press('Tab');
  }
  throw new Error(`Tab did not reach the control in ${max} presses; the focus is on ${await page().evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}.`);
}
/** Every piece of visible text that is under 14 px. */
const smallText = async (): Promise<{ text: string; size: number }[]> => page().evaluate(() => {
  const out: { text: string; size: number }[] = [];
  const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim(); const el = n.parentElement;
    if (text === '' || el === null || el.closest('svg, .hm-sr') !== null) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 14) out.push({ text, size });
  }
  return out;
});
/** The buttons and tick boxes in `scope` that are shorter than 32 px (Wave D: was 44 px) (a tick box is judged by the row it sits in). */
const shortTargets = async (scope: Locator): Promise<string[]> => scope.evaluate(root => [...root.querySelectorAll<HTMLElement>('button, [role="tab"], label.sh-row')]
  .filter(b => b.getClientRects().length > 0 && b.getBoundingClientRect().height < 31.5 && !b.classList.contains('kit-remove') && !b.classList.contains('kit-status') && !b.classList.contains('kit-card-main'))
  .map(b => `${(b.textContent ?? b.getAttribute('aria-label') ?? '').trim()} ${Math.round(b.getBoundingClientRect().height)}`));

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1440, 900);
  await skipTour(page());
});

// ---- Where Share lives.
test('Share lives in the Version history drawer, under the list, and not in the main window', async () => {
  const p = page();
  // The navigation holds the toggle (an icon with its name in the aria-label), seven items with their words, and the Preview pill, which is its own help button.
  expect(await p.locator('nav.hm-nav').getByRole('button').allTextContents()).toEqual(['', 'Add', 'Agents', 'Library', 'Find more', 'Share', 'Version history', 'Help', 'Preview']);
  expect(await p.locator('nav.hm-nav').getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')))).toEqual(['Hide navigation', null, null, null, null, null, null, null, 'About this preview']);   // Help is the only "?" (fix list item 3)
  await expect(p.getByRole('button', { name: 'Share my agents' })).toHaveCount(0);
  await openPoints();
  await expect(section().getByRole('heading', { level: 3, name: 'Share' })).toBeVisible();
  await expect(section().getByRole('button')).toHaveText(['Share my agents', 'Open a shared file']);
  const list = await rectOf(p, '.pt-list'), sec = await rectOf(p, '[data-share-section]');
  expect(sec.y).toBeGreaterThanOrEqual(list.y + list.h);
  expect(await budget()).toEqual([]);
});

test('"Open a shared file" in the drawer opens Add on its shared-file tab', async () => {
  const p = page();
  await openPoints();
  await section().getByRole('button', { name: 'Open a shared file' }).click();
  await expect(pointsDrawer()).toHaveCount(0);
  await expect(addDrawer()).toBeVisible();
  await expect(addDrawer().getByRole('tab', { name: 'From a shared file' })).toHaveAttribute('aria-selected', 'true');
  await expect(addDrawer().getByRole('button', { name: 'Choose a file' })).toBeVisible();
  await expect(addDrawer().getByRole('button', { name: 'Open my last copy' })).toHaveCount(0);
  // Add from the top bar still opens on Skills.
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
  await topBar('Add').click();
  await expect(addDrawer().getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
  expect(await budget()).toEqual([]);
});

// ---- The sheet.
test('the sheet says what goes in as counts, what is left out, and that secrets stay out', async () => {
  await openSheet();
  await animationsDone(page());
  await expect(sheet().getByRole('heading', { level: 2, name: 'Share my agents' })).toBeFocused();
  await expect(counts()).toHaveText(countsLine(all.counts));
  await expect(counts()).toHaveText('29 skills, 10 agents, 8 tools, 3 sets of notes');
  await expect(leftOut()).toHaveText(leftOutLine(all.keys, 0, all.readyMade, 0, all.keyNames));
  // The keys are named, by the names of their variables (never a value): the words are "Left out: A_KEY, B_KEY, C_KEY and 1 ready-made item".
  expect(all.keyNames).toHaveLength(3);
  await expect(leftOut()).toHaveText(`Left out: ${all.keyNames.join(', ')} and 1 ready-made item`);
  await expect(sheet().getByText('Passwords and keys that Bowerloom keeps are left out.')).toBeVisible();
  await expect(sheet().getByText('Your own text is included, so read it first.')).toBeVisible();
  await expect(sheet().getByText('Tools that need a key will ask for one.')).toBeVisible();
  await expect(sheet().getByText('Changes you have not saved')).toHaveCount(0);
  await expect(sheet().locator('.sh-row input[type="checkbox"]')).toHaveCount(10);
  // The agents are listed by the names on the map, in the same order.
  const listed = await sheet().locator('.sh-row-name').allTextContents();
  expect(listed).toEqual([...listed].sort((a, b) => a.localeCompare(b)));
  expect(listed).toEqual(await page().locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main').allTextContents());
  for (const box of await sheet().locator('.sh-row input').all()) await expect(box).toBeChecked();
  await expect(sheet().getByRole('button', { name: 'Create share file' })).toBeEnabled();
  const text = (await sheet().innerText()).replace(/\s+/g, ' ');
  expect(text).not.toMatch(/\/Users|\.bowerloom|\.json|SKILL\.md|export|import|harness|slice|token/i);
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
});

test('unticking an agent takes it out and the counts and the left-out line follow; unticking every agent stops Create share file', async () => {
  await openSheet();
  const [first] = await firstRows(1);
  const one = planShare(world, ids, [first!]);
  const name = (await sheet().locator('.sh-row-name').first().textContent())!;
  await rowOf(name).getByRole('checkbox').uncheck();
  await expect(counts()).toHaveText(countsLine(one.counts));
  await expect(leftOut()).toHaveText(leftOutLine(one.keys, 1, one.readyMade, 0, one.keyNames));
  expect(await budget()).toEqual([]);
  await rowOf(name).getByRole('checkbox').check();
  await expect(counts()).toHaveText(countsLine(all.counts));
  await expect(leftOut()).toHaveText(leftOutLine(all.keys, 0, all.readyMade, 0, all.keyNames));
  // Every agent out.
  for (const box of await sheet().locator('.sh-row input').all()) await box.uncheck();
  await expect(counts()).toHaveText('Tick at least one agent to share.');
  await expect(leftOut()).toHaveText('Left out: 10 agents');
  await expect(sheet().getByRole('button', { name: 'Create share file' })).toBeDisabled();
  expect(await budget()).toEqual([]);
  // Leaving agents out can leave keys out: the line is never more than the whole.
  const six = await firstRows(6);
  const some = planShare(world, ids, six);
  for (const box of await sheet().locator('.sh-row input').all().then(l => l.slice(6))) await box.check();
  await expect(counts()).toHaveText(countsLine(some.counts));
  await expect(leftOut()).toHaveText(leftOutLine(some.keys, 6, some.readyMade, 0, some.keyNames));
});

test('changes that wait for Save are not in the copy, and the sheet says so', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
  await p.locator('aside.hm-panel').getByRole('region', { name: 'Skills' }).getByRole('button', { name: 'Remove Write a reply' }).click();
  await openSheet();
  await expect(sheet().getByText('Changes you have not saved are not in the copy.')).toBeVisible();
  await expect(counts()).toHaveText(countsLine(all.counts));
  expect(await budget()).toEqual([]);
});

test('Create share file says Share file ready with a size, writes nothing, and Done goes back to the button that opened the sheet', async () => {
  const p = page();
  const downloads: string[] = [];
  p.on('download', d => downloads.push(d.suggestedFilename()));
  await openSheet();
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  const made = sheet().locator('.sh-made');
  await expect(made.getByRole('heading', { level: 3, name: 'Share file ready' })).toBeFocused();
  await expect(made.locator('.sh-size')).toHaveText(/^About \d+ KB$/);
  expect(await made.locator('.sh-size').innerText()).toBe(`About ${Math.round(all.bytes / 1024)} KB`);
  await expect(made.getByText('Nothing was written to your computer in this preview.')).toBeVisible();
  await expect(sheet().getByRole('button', { name: 'Create share file' })).toHaveCount(0);
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
  expect(await p.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  expect(downloads).toEqual([]);
  // The Save bar did not change: a copy is not a change to the agents.
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  // Changing the choice makes the copy not ready any more.
  await sheet().locator('.sh-row input').first().uncheck();
  await expect(sheet().locator('.sh-made')).toHaveCount(0);
  await expect(sheet().getByRole('button', { name: 'Create share file' })).toBeEnabled();
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  await sheet().getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet()).toHaveCount(0);
  await expect(section().getByRole('button', { name: 'Share my agents' })).toBeFocused();
  await expect(pointsDrawer()).toBeVisible();
});

// ---- The round trip.
test('round trip: Create share file, then Open a shared file, then Open my last copy: everything is already here', async () => {
  const p = page();
  await openSheet();
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  await sheet().getByRole('button', { name: 'Open a shared file' }).click();
  await expect(sheet()).toHaveCount(0);
  await expect(pointsDrawer()).toHaveCount(0);
  await expect(addDrawer().getByRole('tab', { name: 'From a shared file' })).toHaveAttribute('aria-selected', 'true');
  await addDrawer().getByRole('button', { name: 'Open my last copy' }).click();
  await expect(addDrawer().getByText('Everything in this file is already here.')).toBeVisible();
  await expect(addDrawer().getByRole('button', { name: 'Add these' })).toHaveCount(0);
  await expect(addDrawer().getByRole('heading', { name: 'Already here' })).toBeVisible();
  expect(await budget()).toEqual([]);
  expect(await addDrawer().innerText()).not.toMatch(/\/Users|\.bowerloom|SKILL\.md/);
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  void p;
});

/** The copy of a few agents, written as a file for another computer: every id and name made new, so it lands as all new. */
function asNewFile(text: string): string {
  const swap = (s: string): string => `${s}-b`;
  const b = JSON.parse(text) as { items: Record<string, unknown>[]; toolRefs: Record<string, unknown>[]; sliceRules: Record<string, unknown>[] };
  for (const i of b.items) {
    i.id = swap(String(i.id)); i.name = swap(String(i.name));
    const d = i.definition as { name: string; skillIds: string[]; toolAttachments: { toolId: string }[]; sliceId?: string } | undefined;
    if (d !== undefined) { d.name = swap(d.name); d.skillIds = d.skillIds.map(swap); for (const t of d.toolAttachments) t.toolId = swap(t.toolId); if (d.sliceId !== undefined) d.sliceId = swap(d.sliceId); }
  }
  for (const t of b.toolRefs) { t.toolId = swap(String(t.toolId)); t.name = swap(String(t.name)); }
  for (const s of b.sliceRules) { s.sliceId = swap(String(s.sliceId)); s.name = swap(String(s.name)); }
  return JSON.stringify(b);
}

for (const left of [0, 3]) {
  test(`round trip: a copy with ${10 - left} agents opened as a shared file in a place that has none of it shows the same counts`, async () => {
    const p = page();
    await openSheet();
    const plan = planShare(world, ids, await firstRows(left));
    for (const box of (await sheet().locator('.sh-row input').all()).slice(0, left)) await box.uncheck();
    await expect(counts()).toHaveText(countsLine(plan.counts));
    await sheet().getByRole('button', { name: 'Create share file' }).click();
    await expect(sheet().locator('.sh-size')).toHaveText(`About ${Math.round(plan.bytes / 1024)} KB`);
    await sheet().getByRole('button', { name: 'Open a shared file' }).click();
    // The file the other computer would get has the same text; here it is made new, so the preview is of a place that has none of it.
    const file = asNewFile(plan.text);
    await addDrawer().locator('input[type="file"]').setInputFiles({ name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    const willAdd = addDrawer().locator('section').filter({ has: p.getByRole('heading', { name: 'Will be added' }) });
    await expect(willAdd).toBeVisible();
    await expect(willAdd.locator('.kit-hint').first()).toHaveText(countsLine(plan.counts));
    await expect(willAdd.getByText(`${plan.keys} ${plan.keys === 1 ? 'tool needs' : 'tools need'} a key.`)).toHaveCount(plan.keys > 0 ? 1 : 0);
    expect(await addDrawer().innerText()).not.toMatch(/\/Users|\.bowerloom|\.json\b|SKILL\.md/);
    expect(await budget()).toEqual([]);
    expect(await smallText()).toEqual([]);
    // Adding it is one change, and the agents come to the map when it is saved: 10 + the agents in the file.
    await addDrawer().getByRole('button', { name: 'Add these' }).click();
    await expect(addDrawer().getByText(/^Added \d+ things? from the file\.$/)).toBeVisible();
    await expect(bar().getByText('Nothing to save yet')).toHaveCount(0);
    await expect(p.locator('.hm-grid .kit-card[data-kind="agent"]')).toHaveCount(10 + plan.counts.agents);
  });
}

// ---- Agents that Find skipped.
test('agents that Find skipped are not offered in Add or in Share', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true });
  await resize(p, 1440, 900);
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await p.getByRole('button', { name: 'Clear', exact: true }).click();
  await p.getByRole('checkbox', { name: 'Money tracker' }).check(); await p.getByRole('checkbox', { name: 'Trip organizer' }).check();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.locator('.hm-grid .kit-card[data-kind="agent"]')).toHaveCount(2);
  await skipTour(p);
  const names = await p.locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main').allTextContents();
  expect(names).toHaveLength(2);
  // Add: the picker lists the same two agents and no others.
  await topBar('Add').click();
  await animationsDone(p);
  await addDrawer().locator('.add-row').first().getByRole('button', { name: /^Add to / }).click();
  const picker = p.getByRole('group', { name: 'Add to which agent?' });
  await expect(picker.getByRole('button')).toHaveCount(2);
  expect((await picker.getByRole('button').allTextContents()).sort()).toEqual([...names].sort());
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
  // Share: two rows, the counts of those two agents.
  const shown = ids.filter(id => world.items.some(i => i.id === id && i.kind === 'agent' && i.scopeId !== 'global'));
  await openSheet();
  await expect(sheet().locator('.sh-row')).toHaveCount(2);
  expect((await sheet().locator('.sh-row-name').allTextContents()).sort()).toEqual([...names].sort());
  await expect(counts()).toHaveText(countsLine(planShare(world, shown, []).counts));
  expect(await budget()).toEqual([]);
});

// ---- Layers and keys.
test('Escape closes one layer at a time: the Share sheet, then the Version history drawer', async () => {
  const p = page();
  await openSheet();
  await p.keyboard.press('Escape');
  await expect(sheet()).toHaveCount(0);
  await expect(pointsDrawer()).toBeVisible();
  await expect(section().getByRole('button', { name: 'Share my agents' })).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(pointsDrawer()).toHaveCount(0);
  await expect(topBar('Version history')).toBeFocused();
  // Close and the scrim close the sheet too, and the page behind it is out of reach while it is open.
  await openSheet();
  await expect(p.locator('nav.hm-nav')).toHaveAttribute('inert', '');
  await expect(p.locator('.hm-col')).toHaveAttribute('inert', '');
  await sheet().getByRole('button', { name: 'Close' }).click();
  await expect(sheet()).toHaveCount(0);
  await expect(pointsDrawer()).toBeVisible();
});

test('the tour closes the Share sheet when it starts', async () => {
  const p = page();
  await openSheet();
  // The sheet covers the Help button and makes it unreachable, so the tour is started the way the page would start it: a click on the button itself.
  await p.evaluate(() => { document.querySelector<HTMLElement>('nav.hm-nav button[data-tour="help"]')?.click(); });
  await p.evaluate(() => { [...document.querySelectorAll<HTMLElement>('button')].find(b => b.textContent?.trim() === 'Show me around')?.click(); });
  await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible();
  await expect(sheet()).toHaveCount(0);
  await expect(pointsDrawer()).toHaveCount(0);
});

test('the keyboard does all of it: open Version history, open the sheet, untick, Create share file, Done, Open a shared file, Open my last copy', async () => {
  const p = page();
  await keyToNav(p, 'Version history');
  await p.keyboard.press('Enter');
  await expect(pointsDrawer().getByRole('heading', { name: 'Version history' })).toBeFocused();
  await tabTo(section().getByRole('button', { name: 'Share my agents' }));
  await p.keyboard.press('Enter');
  await expect(sheet().getByRole('heading', { level: 2 })).toBeFocused();
  // The first Tab reaches Close, the next ones the tick boxes; Space unticks one.
  await p.keyboard.press('Tab');
  await expect(sheet().getByRole('button', { name: 'Close' })).toBeFocused();
  const first = sheet().locator('.sh-row input').first();
  await p.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await p.keyboard.press('Space');
  await expect(first).not.toBeChecked();
  await expect(leftOut()).toContainText('1 agent');
  await tabTo(sheet().getByRole('button', { name: 'Create share file' }));
  await p.keyboard.press('Enter');
  await expect(sheet().getByRole('heading', { name: 'Share file ready' })).toBeFocused();
  // Tab stays inside the sheet.
  for (let i = 0; i < 12; i += 1) { await p.keyboard.press('Tab'); expect(await p.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-labelledby') !== undefined)).toBe(true); }
  await tabTo(sheet().getByRole('button', { name: 'Open a shared file' }));
  await p.keyboard.press('Enter');
  await expect(addDrawer().getByRole('tab', { name: 'From a shared file' })).toHaveAttribute('aria-selected', 'true');
  const last = addDrawer().getByRole('button', { name: 'Open my last copy' });
  await tabTo(last);
  await p.keyboard.press('Enter');
  await expect(addDrawer().getByText('Everything in this file is already here.')).toBeVisible();
  expect(await budget()).toEqual([]);
});

// ---- Less motion.
test('with less motion nothing animates in the Share section or the sheet', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p);
  await skipTour(p);
  await openPoints();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await section().getByRole('button', { name: 'Share my agents' }).click();
  await expect(sheet()).toBeVisible();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await p.evaluate(() => [...document.querySelectorAll('.sh-dialog, .sh-row, .sh-foot')].map(el => getComputedStyle(el).transitionDuration))).toEqual(expect.arrayContaining(['0s']));
});

// ---- Layout.
for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} the Share section and the sheet fit: nothing cut off, the buttons in view, no sideways scroll, targets 32 px`, async () => {
    const p = page();
    await resize(p, w, h);
    await openPoints();
    expect(await shortTargets(pointsDrawer())).toEqual([]);
    const sec = await rectOf(p, '[data-share-section]');
    expect(sec.x).toBeGreaterThanOrEqual(0);
    await section().scrollIntoViewIfNeeded();
    await section().getByRole('button', { name: 'Share my agents' }).click();
    await expect(sheet()).toBeVisible();
    await animationsDone(p);
    const box = await rectOf(p, '.sh-dialog');
    console.log(`MEASURED sheet at ${w}x${h}:`, JSON.stringify(box));
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(w); expect(box.y + box.h).toBeLessThanOrEqual(h);
    for (const name of ['Create share file', 'Cancel']) {
      const b = await rectOf(p, `.sh-dialog button:has-text("${name}")`);
      expect(b.y + b.h).toBeLessThanOrEqual(box.y + box.h + 0.5); expect(b.y).toBeGreaterThanOrEqual(box.y);
    }
    const head = await rectOf(p, '.sh-summary');
    expect(head.y + head.h).toBeLessThanOrEqual(box.y + box.h);
    const list = await p.locator('.sh-pick').evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    console.log(`MEASURED agent list at ${w}x${h}:`, JSON.stringify(list));
    expect(list.client).toBeGreaterThanOrEqual(100);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await sheet().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await shortTargets(sheet())).toEqual([]);
    expect(await smallText()).toEqual([]);
    // The last agent can be reached by scrolling the list, and ticked by the mouse.
    const lastRow = sheet().locator('.sh-row').last();
    await lastRow.scrollIntoViewIfNeeded();
    await lastRow.getByRole('checkbox').uncheck();
    await expect(leftOut()).toContainText('1 agent');
    await sheet().getByRole('button', { name: 'Create share file' }).click();
    await expect(sheet().locator('.sh-made')).toBeVisible();
    const done = await rectOf(p, '.sh-dialog button:has-text("Open a shared file")');
    expect(done.y + done.h).toBeLessThanOrEqual(h);
    expect(await shortTargets(sheet())).toEqual([]);
    expect(await smallText()).toEqual([]);
    expect(await budget()).toEqual([]);
  });
}

// ---- Screenshots.
for (const [w, h] of SIZES) for (const look of THEMES) {
  test(`screenshots at ${w} by ${h}, ${look}: Version history with Share, the Share sheet, after Create share file`, async () => {
    test.skip(process.env.HOME_U0_SHOTS === undefined, 'Set HOME_U0_SHOTS to a folder to take screenshots.');
    const p = page();
    await setLook(p, look);
    await resize(p, w, h);
    await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
    await openPoints();
    await shot(p, 'share-1-save-points', w, h, look);
    await section().getByRole('button', { name: 'Share my agents' }).click();
    await expect(sheet()).toBeVisible();
    await animationsDone(p);
    await shot(p, 'share-2-sheet', w, h, look);
    await rowOf((await sheet().locator('.sh-row-name').nth(2).textContent())!).getByRole('checkbox').uncheck();
    await shot(p, 'share-3-sheet-one-left-out', w, h, look);
    await sheet().getByRole('button', { name: 'Create share file' }).click();
    await expect(sheet().locator('.sh-made')).toBeVisible();
    await shot(p, 'share-4-copy-ready', w, h, look);
    await sheet().getByRole('button', { name: 'Open a shared file' }).click();
    await addDrawer().getByRole('button', { name: 'Open my last copy' }).click();
    await expect(addDrawer().getByText('Everything in this file is already here.')).toBeVisible();
    await shot(p, 'share-5-open-last-copy', w, h, look);
  });
}
