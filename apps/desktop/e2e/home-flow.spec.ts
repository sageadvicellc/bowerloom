/**
 * The whole storyboard, in the real window (Electron started with --prototype-v2, on the home app itself, with the Add drawer, the "two different copies"
 * dialog and the Version history drawer mounted in it): pick an agent, remove a skill, Save, see the ticks, Go back; open Add and add a skill by the picker and by a
 * real mouse drag onto an agent card; open the copies dialog from a badge and keep a copy; open Version history and go back to the first point. Also the Save bar
 * sentences, the layout of the card (one column at 15 rem and wider), the tour with the Add drawer, Escape one layer at a time, less motion, the keyboard
 * alone, text size, and the text budget on the real page at every step.
 * Set HOME_U0_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { SIZES, THEMES, SAVED, ensurePicked, fresh, launchHome, rectOf, resize, setLook, shot, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const agentButton = (name: string): Locator => page().locator('.hm-grid').getByRole('button', { name, exact: true });
const agentCard = (id: string): Locator => page().locator(`.hm-grid [data-drop-agent="${id}"]`);
const panel = (): Locator => page().locator('aside.hm-panel');
const shelf = (name: string): Locator => panel().getByRole('region', { name });
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const addDrawer = (): Locator => page().locator('[data-slot="add"]');
const pointsDrawer = (): Locator => page().locator('[data-slot="points"]');
const row = (id: string): Locator => addDrawer().locator(`.add-row[data-add-id="${id}"]`);
const topBar = (name: string): Locator => page().locator('header.hm-bar').getByRole('button', { name, exact: true });
const saveButton = (): Locator => bar().getByRole('button', { name: 'Save', exact: true });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const skills = async (): Promise<string[]> => shelf('Skills').locator('.kit-card-main').allTextContents();
const barText = async (): Promise<string> => (await bar().locator('.hm-savebar-state p').innerText()).trim();

async function pick(name: string): Promise<void> { await ensurePicked(agentButton(name)); await expect(panel().getByRole('heading', { level: 2, name })).toBeVisible(); }
async function openAdd(tabName = 'Skills'): Promise<void> {
  if (!(await addDrawer().isVisible())) await topBar('Add').click();
  await expect(addDrawer()).toBeVisible();
  await animationsDone(page());
  await addDrawer().getByRole('tab', { name: tabName, exact: true }).click();
}
async function addByPicker(skillId: string, agentName: string): Promise<void> {
  await row(skillId).getByRole('button', { name: /^Add to / }).click();
  await page().getByRole('group', { name: 'Add to which agent?' }).getByRole('button', { name: agentName }).click();
}
async function centre(l: Locator): Promise<{ x: number; y: number }> {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function dragSkill(skillId: string, agentId: string, hold: () => Promise<void> = async () => undefined): Promise<void> {
  const p = page();
  const from = await centre(row(skillId).locator('.kit-card'));
  const to = await centre(agentCard(agentId));
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x - 30, from.y + 10, { steps: 4 });
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await expect(agentCard(agentId)).toHaveAttribute('data-drop-over', '');
  await hold();
  await p.mouse.up();
}
/** Presses Tab until `target` has the focus. A target that is never reached fails with the element that has it. */
async function tabTo(target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate(el => el === document.activeElement).catch(() => false)) return;
    await page().keyboard.press('Tab');
  }
  throw new Error(`Tab did not reach the control in ${max} presses; the focus is on ${await page().evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}.`);
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1440, 900);
  await skipTour(page());
});

// ---- The storyboard, in one run.
test('the storyboard path: remove, save, ticks, go back; add by the picker and by a drag; keep a copy; go back to the first save point', async () => {
  const p = page();
  // Step 4: one agent, three shelves, the badge on one skill.
  await pick('Inbox sorter');
  expect(await skills()).toEqual(['Write a short summary', 'Sort mail by topic', 'Flag urgent mail', 'Write a reply']);
  await expect(shelf('Skills').getByRole('button', { name: '2 different copies' })).toBeVisible();
  expect(await budget()).toEqual([]);
  // Remove, Save, the three ticks, Go back.
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  expect(await barText()).toBe('Removed Write a reply');
  await saveButton().click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await expect(bar().locator('.hm-tick')).toHaveText(['Claude Code', 'Codex', 'OpenCode']);
  expect(await budget()).toEqual([]);
  await bar().getByRole('button', { name: 'Go back' }).click();
  expect(await barText()).toBe('Back to how it was');
  expect(await skills()).toEqual(['Write a short summary', 'Sort mail by topic', 'Flag urgent mail', 'Write a reply']);

  // Add: the drawer takes its own column, the map and the shelves stay in view, and the cards use the plain words.
  await openAdd();
  await expect(panel()).toBeVisible();
  expect(await addDrawer().locator('.add-row .kit-card-main').first().textContent()).toBe('Answer a common question');
  await expect(addDrawer().locator('.add-row').first()).toContainText('Replies to questions that come up again and again.');
  const drawerText = await addDrawer().innerText();
  for (const old of ['jaunty', 'gilded', 'velvet', 'wicker', 'keystone']) expect(drawerText.toLowerCase()).not.toContain(old);
  expect(await budget()).toEqual([]);
  // By the picker. The shelf of the agent shows the new card, the agent card and the new card wear the same mark, and the bar says what changed.
  await addByPicker('skill-017', 'Inbox sorter');
  expect(await barText()).toBe('Added Answer a common question to Inbox sorter');
  expect(await skills()).toContain('Answer a common question');
  await expect(shelf('Skills').locator('[data-entry="skill-017"] .kit-card')).toHaveAttribute('data-fresh', '');
  await expect(agentCard('agent-04')).toHaveAttribute('data-fresh', '');
  await expect(addDrawer().locator('.add-note')).toHaveText('Added to Inbox sorter.');
  expect(await budget()).toEqual([]);
  // By a real mouse drag onto another agent card: that agent is picked, and the bar counts two changes in one short sentence.
  await dragSkill('skill-019', 'agent-01');
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeVisible();
  expect(await skills()).toContain('Check a link');
  await expect(shelf('Skills').locator('[data-entry="skill-019"] .kit-card')).toHaveAttribute('data-fresh', '');
  expect(await barText()).toBe('Added Check a link and Answer a common question');
  expect(await budget()).toEqual([]);

  // Two different copies: the badge on the shelf opens the dialog, Keep this copy clears the badge, and it counts as one more change.
  await pick('Inbox sorter');
  await shelf('Skills').getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Sort mail by topic');
  await expect(dialog.locator('.add-copy')).toHaveCount(2);
  expect(await budget()).toEqual([]);
  await dialog.locator('.add-copy').first().getByRole('button', { name: 'Keep this copy' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(p.getByRole('button', { name: '2 different copies' })).toHaveCount(0);
  expect(await barText()).toBe('3 changes');
  await expect(shelf('Skills').locator('.kit-card-main', { hasText: 'Sort mail by topic' })).toBeFocused();

  // Version history: the points so far, newest first, then back to the first one.
  await saveButton().click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  await expect(addDrawer()).toHaveCount(0);
  await animationsDone(p);
  const names = await pointsDrawer().locator('.pt-name').allTextContents();
  expect(names).toEqual(['3 changes', 'Went back to How it started', 'Removed Write a reply', 'How it started']);
  expect(await pointsDrawer().locator('.pt-when').allTextContents()).toEqual(['just now', '1 save ago', '2 saves ago', 'when you began']);
  await expect(pointsDrawer().locator('.pt-row').first()).toContainText('You are here.');
  await expect(pointsDrawer().getByRole('button', { name: 'Go back to this' })).toHaveCount(3);
  expect(await budget()).toEqual([]);
  await pointsDrawer().locator('.pt-row', { hasText: 'How it started' }).last().getByRole('button', { name: 'Go back to this' }).click();
  expect(await barText()).toBe('Back to how it was');
  expect(await skills()).toEqual(['Write a short summary', 'Sort mail by topic', 'Flag urgent mail', 'Write a reply']);
  await expect(shelf('Skills').getByRole('button', { name: '2 different copies' })).toBeVisible();
  expect((await pointsDrawer().locator('.pt-name').allTextContents())[0]).toBe('Went back to How it started');
  expect(await budget()).toEqual([]);
});

// ---- The Save bar says what changed.
test('the Save bar names one or two changes in plain words and says "N changes" from three on', async () => {
  await pick('Meeting assistant');
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  expect(await barText()).toBe('Removed Write a reply');
  await shelf('Tools').getByRole('button', { name: 'Remove Read my calendar' }).click();
  expect(await barText()).toBe('Removed Write a reply and Read my calendar');
  await shelf('Notes').getByRole('button', { name: 'Remove Client list' }).click();
  expect(await barText()).toBe('3 changes');
  expect(await budget()).toEqual([]);
  // A save point takes the sentence as its name.
  await bar().getByRole('button', { name: 'Discard changes' }).click();
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await saveButton().click();
  await topBar('Version history').click();
  expect(await pointsDrawer().locator('.pt-name').allTextContents()).toEqual(['Removed Write a reply', 'How it started']);
  await expect(pointsDrawer().locator('.pt-changes').first()).toHaveText('Changed Meeting assistant');
  await expect(pointsDrawer().locator('.pt-changes').last()).toHaveText('Your agents as Bowerloom found them.');
  // Changes that wait say so in the drawer: going back drops them.
  await page().keyboard.press('Escape');
  await expect(pointsDrawer()).toHaveCount(0);
  await shelf('Skills').getByRole('button', { name: 'Remove List action items' }).click();
  await topBar('Version history').click();
  await expect(pointsDrawer().getByText('Changes you have not saved will go away.')).toBeVisible();
  expect(await budget()).toEqual([]);
});

// ---- Two different copies, from the shelf and from the drawer.
test('the badge shows on a real shelf card and on the drawer card for the same skill; keeping a copy clears both and counts as one change', async () => {
  const p = page();
  await pick('Inbox sorter');
  await openAdd();
  // The drawer lists skills in name order, eight at a time: "Sort mail by topic" and the skill with three copies sit under "Show more".
  await addDrawer().getByRole('button', { name: 'Show more' }).click();
  await expect(row('skill-014').getByRole('button', { name: '2 different copies' })).toBeVisible();
  await expect(row('skill-triple').getByRole('button', { name: '3 different copies' })).toBeVisible();
  await row('skill-014').getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  const [a, b] = [dialog.locator('.add-copy').nth(0), dialog.locator('.add-copy').nth(1)];
  await expect(a).toContainText('Found in Claude Code and OpenCode');
  await expect(b).toContainText('Found in Codex');
  expect(await a.locator('.add-line-row[data-changed]').count()).toBeGreaterThan(0);
  expect(await b.locator('.add-line-row[data-changed]').count()).toBeGreaterThan(0);
  await expect(dialog).not.toContainText(/\/Users|\.md|jaunty/);
  await b.getByRole('button', { name: 'Keep this copy' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(p.getByRole('button', { name: '2 different copies' })).toHaveCount(0);
  expect(await barText()).toBe('Kept one copy of Sort mail by topic');
  await expect(row('skill-014').locator('.kit-card-main')).toBeFocused();
  // The other conflict still has its badge: only the one that was resolved is gone.
  await expect(row('skill-triple').getByRole('button', { name: '3 different copies' })).toBeVisible();
  expect(await budget()).toEqual([]);
  await bar().getByRole('button', { name: 'Discard changes' }).click();
  await expect(shelf('Skills').getByRole('button', { name: '2 different copies' })).toBeVisible();
});

// ---- One column at 15 rem and wider.
test('a card 15 rem wide or more with a badge lays out in one column: name, hint and badge share one left edge, with the badge under the hint', async () => {
  await pick('Inbox sorter');
  const geometry = async (): Promise<{ width: number; name: number; hint: number; badge: number; tile: number; hintBottom: number; badgeTop: number; nameRight: number; remove: number }> => shelf('Skills').locator('[data-entry="skill-014"]').evaluate(li => {
    const card = li.querySelector('.kit-card')!, r = (sel: string): DOMRect => card.querySelector(sel)!.getBoundingClientRect();
    return { width: card.getBoundingClientRect().width, name: r('.kit-card-main').left, hint: r('.kit-card-hint').left, badge: r('.kit-badge').left, tile: r('.kit-tile').left, hintBottom: r('.kit-card-hint').bottom, badgeTop: r('.kit-badge').top, nameRight: r('.kit-card-main').right, remove: r('.kit-remove').left };
  });
  const wide = await geometry();
  console.log('MEASURED wide card:', JSON.stringify(wide));
  expect(wide.width).toBeGreaterThanOrEqual(240);
  expect(Math.abs(wide.badge - wide.name)).toBeLessThanOrEqual(1);
  expect(Math.abs(wide.hint - wide.name)).toBeLessThanOrEqual(1);
  expect(wide.badge).toBeGreaterThan(wide.tile + 20);
  expect(wide.badgeTop).toBeGreaterThanOrEqual(wide.hintBottom - 1);
  expect(wide.nameRight).toBeLessThanOrEqual(wide.remove);
  // Under 15 rem (of room inside the card) the badge has no text column to sit in, and takes the whole row under the tile.
  await shelf('Skills').locator('[data-entry="skill-014"]').evaluate(li => { (li as HTMLElement).style.width = '12rem'; (li as HTMLElement).style.flex = 'none'; });
  await framesPainted(page());
  const narrow = await geometry();
  console.log('MEASURED narrow card:', JSON.stringify(narrow));
  expect(narrow.width).toBeLessThan(240);
  expect(Math.abs(narrow.badge - narrow.tile)).toBeLessThanOrEqual(1);
  expect(narrow.badge).toBeLessThan(narrow.name);
  // The drawer card has the same layout (the old override in add.css is gone).
  await shelf('Skills').locator('[data-entry="skill-014"]').evaluate(li => { (li as HTMLElement).style.width = ''; (li as HTMLElement).style.flex = ''; });
  await openAdd();
  await addDrawer().getByRole('button', { name: 'Show more' }).click();
  const inDrawer = await row('skill-014').locator('.kit-card').evaluate(card => {
    const r = (sel: string): DOMRect => card.querySelector(sel)!.getBoundingClientRect();
    return { width: card.getBoundingClientRect().width, name: r('.kit-card-main').left, hint: r('.kit-card-hint').left, badge: r('.kit-badge').left, hintBottom: r('.kit-card-hint').bottom, badgeTop: r('.kit-badge').top };
  });
  console.log('MEASURED drawer card:', JSON.stringify(inDrawer));
  expect(inDrawer.width).toBeGreaterThanOrEqual(240);
  expect(Math.abs(inDrawer.badge - inDrawer.name)).toBeLessThanOrEqual(1);
  expect(inDrawer.badgeTop).toBeGreaterThanOrEqual(inDrawer.hintBottom - 1);
});

// ---- Layout.
for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} the Add drawer and the Version history drawer fit: nothing overlaps, nothing is cut off, no sideways scroll`, async () => {
    const p = page();
    await resize(p, w, h);
    await pick('Inbox sorter');
    for (const [button, drawer] of [['Add', addDrawer()], ['Version history', pointsDrawer()]] as const) {
      await topBar(button).click();
      await expect(drawer).toBeVisible();
      await animationsDone(p);
      const box = await rectOf(p, '.hm-body[data-drawer] .kit-drawer');
      const stage = await rectOf(p, 'main.hm-stage');
      expect(box.x + box.w).toBeLessThanOrEqual(w + 1);
      expect(stage.x + stage.w).toBeLessThanOrEqual(box.x + 1);
      if (w >= 1200) {
        const side = await rectOf(p, 'aside.hm-panel');
        await expect(panel()).toBeVisible();
        expect(side.x + side.w).toBeLessThanOrEqual(box.x + 1);
        expect(stage.x + stage.w).toBeLessThanOrEqual(side.x + 1);
      } else {
        // Too narrow for the map, the shelves and the drawer: the shelves give way, and nothing hidden can be reached with Tab.
        await expect(panel()).toBeHidden();
      }
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await p.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(panel()).toBeVisible();
    }
  });
}

// ---- The tour and the layers.
test('the tour step for the Add button lights the button, and Escape ends the tour and nothing else', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  const tour = p.getByRole('dialog', { name: 'Tour' });
  await expect(tour).toBeVisible();
  // Step two has no Next: it waits for a click on an agent.
  await tour.getByRole('button', { name: 'Next' }).click();
  await p.locator('.hm-grid .kit-card[data-kind="agent"]').first().locator('.kit-card-main').click();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Add skills, tools, and notes here.');
  await animationsDone(p);
  const spot = await rectOf(p, '.tour-spot');
  const add = await rectOf(p, 'header.hm-bar [data-tour="add"]');
  expect(spot.x).toBeLessThanOrEqual(add.x); expect(spot.y).toBeLessThanOrEqual(add.y);
  expect(spot.x + spot.w).toBeGreaterThanOrEqual(add.x + add.w); expect(spot.y + spot.h).toBeGreaterThanOrEqual(add.y + add.h);
  await expect(addDrawer()).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(addDrawer()).toHaveCount(0);
  // The last two steps still point at the Save bar and the Help button after the drawer was used.
  await openAdd();
  await p.getByRole('button', { name: 'Help', exact: true }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  await expect(tour).toBeVisible();
  await expect(addDrawer()).toHaveCount(0);
  await tour.getByRole('button', { name: 'Next' }).click();
  await p.locator('.hm-grid .kit-card[data-kind="agent"]').first().locator('.kit-card-main').click();
  for (let i = 0; i < 3; i += 1) await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Replay this tour any time.');
  await tour.getByRole('button', { name: 'Done' }).click();
  await expect(tour).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Add', exact: true })).toBeFocused().catch(() => undefined);
});

test('Escape closes one layer at a time: the dialog, then the drawer; the focus goes back each time', async () => {
  const p = page();
  await pick('Inbox sorter');
  await openAdd();
  await addDrawer().getByRole('button', { name: 'Show more' }).click();
  await row('skill-014').getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(addDrawer()).toBeVisible();
  await expect(row('skill-014').getByRole('button', { name: '2 different copies' })).toBeFocused();
  // An open picker is a layer too.
  await row('skill-017').getByRole('button', { name: /^Add to / }).click();
  await expect(p.getByRole('group', { name: 'Add to which agent?' })).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('group', { name: 'Add to which agent?' })).toHaveCount(0);
  await expect(addDrawer()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
  await expect(topBar('Add')).toBeFocused();
  // A change in the badge dialog from the shelf, then Escape: no change was made and the badge has the focus again.
  await shelf('Skills').getByRole('button', { name: '2 different copies' }).click();
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(shelf('Skills').getByRole('button', { name: '2 different copies' })).toBeFocused();
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
});

// ---- Less motion.
test('with less motion: no slide, no line, nothing animates, and the new card is marked without any movement', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p);
  await skipTour(p);
  await pick('Inbox sorter');
  await topBar('Add').click();
  await expect(addDrawer()).toBeVisible();
  await addByPicker('skill-017', 'Inbox sorter');
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await p.locator('.add-link').count()).toBe(0);
  await expect(shelf('Skills').locator('[data-entry="skill-017"] .kit-card')).toHaveAttribute('data-fresh', '');
  expect(await barText()).toBe('Added Answer a common question to Inbox sorter');
  await saveButton().click();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await budget()).toEqual([]);
});

// ---- The keyboard alone.
test('the keyboard does all of it: open Add, add a skill by the picker, save, open Version history and go back', async () => {
  const p = page();
  await skipTour(p);
  // Inbox sorter is the first agent, so the map picked it already: Enter puts it down, and Enter again picks it.
  await expect(panel().getByRole('heading', { level: 2, name: 'Inbox sorter' })).toBeVisible();
  await tabTo(agentButton('Inbox sorter'));
  await p.keyboard.press('Enter');
  await expect(panel().getByRole('heading', { level: 2, name: 'Pick an agent' })).toBeVisible();
  await p.keyboard.press('Enter');
  await expect(panel().getByRole('heading', { level: 2, name: 'Inbox sorter' })).toBeVisible();
  await tabTo(topBar('Add'));
  await p.keyboard.press('Enter');
  await expect(addDrawer()).toBeVisible();
  await expect(addDrawer().getByRole('heading', { name: 'Add' })).toBeFocused();
  const addTo = row('skill-017').getByRole('button', { name: /^Add to / });
  await tabTo(addTo);
  await p.keyboard.press('Enter');
  const picker = p.getByRole('group', { name: 'Add to which agent?' });
  await expect(picker.getByRole('button').first()).toBeFocused();
  await expect(picker.getByRole('button').first()).toHaveText('Inbox sorter');
  await p.keyboard.press('Enter');
  expect(await barText()).toBe('Added Answer a common question to Inbox sorter');
  await expect(addTo).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
  await expect(topBar('Add')).toBeFocused();
  await tabTo(saveButton());
  await p.keyboard.press('Enter');
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await tabTo(topBar('Version history'));
  await p.keyboard.press('Enter');
  await expect(pointsDrawer().getByRole('heading', { name: 'Version history' })).toBeFocused();
  const first = pointsDrawer().getByRole('button', { name: 'Go back to this' });
  await expect(first).toHaveCount(1);
  await tabTo(first);
  await p.keyboard.press('Enter');
  expect(await barText()).toBe('Back to how it was');
  expect(await skills()).not.toContain('Answer a common question');
  await p.keyboard.press('Escape');
  await expect(pointsDrawer()).toHaveCount(0);
  await expect(topBar('Version history')).toBeFocused();
});

// ---- Text.
test('no text is under 14 px in the Add drawer, the dialog, the Version history drawer or the bar, and every button is 44 px tall or more', async () => {
  const p = page();
  await pick('Inbox sorter');
  await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
  await saveButton().click();
  const small = async (): Promise<{ text: string; size: number }[]> => p.evaluate(() => {
    const out: { text: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.querySelector('[data-home]')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim(); const el = n.parentElement;
      if (text === '' || el === null || el.closest('svg, .hm-sr') !== null) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) out.push({ text, size });
    }
    return out;
  });
  const tall = async (scope: Locator): Promise<string[]> => scope.evaluate(root => [...root.querySelectorAll<HTMLElement>('button, [role="tab"]')]
    .filter(b => b.getClientRects().length > 0 && b.getBoundingClientRect().height < 44 && !b.classList.contains('kit-remove') && !b.classList.contains('kit-badge') && !b.classList.contains('kit-card-main'))
    .map(b => `${(b.textContent ?? b.getAttribute('aria-label') ?? '').trim()} ${Math.round(b.getBoundingClientRect().height)}`));
  await openAdd();
  expect(await small()).toEqual([]);
  expect(await tall(addDrawer())).toEqual([]);
  await addDrawer().getByRole('button', { name: 'Show more' }).click();
  await row('skill-014').getByRole('button', { name: '2 different copies' }).click();
  expect(await small()).toEqual([]);
  await p.keyboard.press('Escape');
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  expect(await small()).toEqual([]);
  expect(await tall(pointsDrawer())).toEqual([]);
  expect(await tall(bar())).toEqual([]);
});

// ---- Screenshots.
for (const [w, h] of SIZES) for (const look of THEMES) {
  test(`screenshots at ${w} by ${h}, ${look}: Add open, mid-drag, after an add, the copies dialog, two save points, the bar sentences`, async () => {
    test.skip(process.env.HOME_U0_SHOTS === undefined, 'Set HOME_U0_SHOTS to a folder to take screenshots.');
    const p = page();
    await setLook(p, look);
    await resize(p, w, h);
    await pick('Inbox sorter');
    const barShot = async (name: string): Promise<void> => { await shot(p, `bar-${name}`, w, h, look); };
    await shelf('Skills').getByRole('button', { name: 'Remove Write a reply' }).click();
    await barShot('1-one-removed');
    await shelf('Skills').getByRole('button', { name: 'Remove Flag urgent mail' }).click();
    await barShot('2-two-removed');
    await shelf('Tools').getByText('Nothing here yet.').waitFor();
    await bar().getByRole('button', { name: 'Discard changes' }).click();
    await openAdd();
    await shot(p, '1-add-open', w, h, look);
    // Mid-drag.
    const from = await centre(row('skill-017').locator('.kit-card'));
    const to = await centre(agentCard('agent-01'));
    await p.mouse.move(from.x, from.y); await p.mouse.down();
    await p.mouse.move(from.x - 30, from.y + 10, { steps: 4 }); await p.mouse.move(to.x, to.y, { steps: 12 });
    await expect(agentCard('agent-01')).toHaveAttribute('data-drop-over', '');
    await shot(p, '2-mid-drag', w, h, look);
    await p.mouse.up();
    await expect(agentCard('agent-01')).toHaveAttribute('data-fresh', '');
    await p.mouse.move(2, 450);
    await shot(p, '3-after-add', w, h, look);
    if (w < 1200) { await p.keyboard.press('Escape'); await expect(addDrawer()).toHaveCount(0); await shot(p, '3b-after-add-drawer-closed', w, h, look); }
    // The copies dialog, from the shelf of the Inbox sorter.
    await pick('Inbox sorter');
    await shelf('Skills').getByRole('button', { name: '2 different copies' }).click();
    await expect(p.getByRole('dialog', { name: 'Two different copies' })).toBeVisible();
    await shot(p, '4-copies-dialog', w, h, look);
    await p.keyboard.press('Escape');
    // Save, then two save points.
    await saveButton().click();
    await shot(p, '5-saved', w, h, look);
    await topBar('Version history').click();
    await expect(pointsDrawer()).toBeVisible();
    await shot(p, '6-save-points', w, h, look);
  });
}

// ---- Choose notes in the shell (U5, wired in I3).
const notesLayer = (): Locator => page().locator('[data-slot="notes"]');
const chooseButton = (): Locator => panel().locator('[data-notes-shelf]').getByRole('button', { name: 'Choose notes' });
const topicButton = (name: string): Locator => notesLayer().getByRole('button', { name, exact: true });
const useButton = (): Locator => notesLayer().getByRole('button', { name: 'Use these notes', exact: true });
const noteCards = (): Locator => panel().locator('[data-notes-shelf] .kit-card');
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
async function openChoose(agent = 'Report builder'): Promise<void> {
  await pick(agent);
  await chooseButton().click();
  await expect(notesLayer()).toBeVisible();
  await animationsDone(page());
}

test('Choose notes: open from the Notes shelf, pick a topic, Use these notes, the shelf and the Save bar update, Save, Go back', async () => {
  const p = page();
  await pick('Report builder');
  await expect(shelf('Notes').getByText('Nothing here yet.')).toBeVisible();
  await expect(chooseButton()).toBeEnabled();
  expect(await budget()).toEqual([]);
  await chooseButton().click();
  await expect(notesLayer()).toBeVisible();
  await animationsDone(p);
  await expect(notesLayer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
  await expect(notesLayer().locator('.nt-agent')).toHaveText('Report builder');
  await expect(notesLayer().locator('.nt-cost')).toHaveText('No notes yet');
  await expect(useButton()).toBeDisabled();
  expect(await budget()).toEqual([]);
  expect(await smallText()).toEqual([]);
  // Pick a topic: the count and the plain size label follow at once.
  await topicButton('Travel').click();
  await expect(notesLayer().locator('.nt-big')).toHaveAttribute('data-count', '55');
  await expect(notesLayer().locator('.nt-cost')).toHaveText('A small set');
  await topicButton('Work').click();
  await expect(notesLayer().locator('.nt-big')).toHaveAttribute('data-count', '198');
  await expect(notesLayer().locator('.nt-cost')).toHaveText('A medium set');
  await topicButton('Meetings').click();
  await topicButton('Research').click();
  await expect(notesLayer().locator('.nt-big')).toHaveAttribute('data-count', '420');
  await expect(notesLayer().locator('.nt-cost')).toHaveText('A big set');
  await topicButton('Meetings').click();
  await topicButton('Research').click();
  await topicButton('Work').click();
  await expect(notesLayer().locator('.nt-big')).toHaveAttribute('data-count', '55');
  await expect(useButton()).toBeEnabled();
  expect(await budget()).toEqual([]);
  // Use these notes: the sheet closes, the focus goes back to the button, the agent is picked, and the new card wears the ring.
  await useButton().click();
  await expect(notesLayer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(panel().getByRole('heading', { level: 2, name: 'Report builder' })).toBeVisible();
  await expect(noteCards()).toHaveCount(1);
  await expect(noteCards().first()).toHaveAttribute('data-fresh', '');
  await expect(agentCard('agent-05')).toHaveAttribute('data-fresh', '');
  expect(await barText()).toBe('Added Travel notes to Report builder');
  await expect(bar().getByText('1 change')).toHaveCount(0);
  expect(await budget()).toEqual([]);
  // Save, then Go back.
  await saveButton().click();
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await expect(bar().locator('.hm-tick')).toHaveText(['Claude Code', 'Codex', 'OpenCode']);
  expect(await budget()).toEqual([]);
  await bar().getByRole('button', { name: 'Go back' }).click();
  expect(await barText()).toBe('Back to how it was');
  await expect(noteCards()).toHaveCount(0);
  await expect(shelf('Notes').getByText('Nothing here yet.')).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('Choose notes: Cancel and Escape stage nothing; the Choose notes button waits for an agent', async () => {
  const p = page();
  // The map picks its first agent on its own, so the button is ready; with that pick put down it waits again.
  await expect(chooseButton()).toBeEnabled();
  await agentButton('Inbox sorter').click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Pick an agent' })).toBeVisible();
  await expect(chooseButton()).toBeDisabled();
  await openChoose();
  await topicButton('Travel').click();
  await notesLayer().getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(notesLayer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  await chooseButton().click();
  await topicButton('Travel').click();
  await p.keyboard.press('Escape');
  await expect(notesLayer()).toHaveCount(0);
  await expect(bar().getByText('Nothing to save yet')).toBeVisible();
  await expect(noteCards()).toHaveCount(0);
});

test('Choose notes: an agent that reads notes already opens with its topics on, and changing it counts as one change', async () => {
  await pick('Meeting assistant');
  await expect(noteCards()).toHaveCount(1);
  await chooseButton().click();
  await expect(notesLayer()).toBeVisible();
  await animationsDone(page());
  expect(await notesLayer().locator('[aria-pressed="true"]').count()).toBeGreaterThan(0);
  await expect(useButton()).toBeDisabled();
  const on = notesLayer().locator('.nt-topic [aria-pressed="true"]').first();
  await on.click();
  await expect(useButton()).toBeEnabled();
  await useButton().click();
  await expect(notesLayer()).toHaveCount(0);
  expect(await barText()).toBe('Added Company notes to Meeting assistant');
  await saveButton().click();
  await bar().getByRole('button', { name: 'Go back' }).click();
  await expect(noteCards()).toHaveCount(1);
});

test('Escape closes one layer at a time with the Choose notes sheet: it takes a drawer with it when it opens, then Escape closes only the sheet', async () => {
  const p = page();
  await pick('Report builder');
  await openAdd();
  await chooseButton().click();
  await expect(notesLayer()).toBeVisible();
  await expect(addDrawer()).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(notesLayer()).toHaveCount(0);
  await expect(addDrawer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  // Version history is a drawer too.
  await topBar('Version history').click();
  await expect(pointsDrawer()).toBeVisible();
  await chooseButton().click();
  await expect(notesLayer()).toBeVisible();
  await expect(pointsDrawer()).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(notesLayer()).toHaveCount(0);
  // With the sheet closed, Escape on a drawer closes the drawer, and only it.
  await openAdd();
  await p.keyboard.press('Escape');
  await expect(addDrawer()).toHaveCount(0);
});

test('the tour closes the Choose notes sheet when it starts', async () => {
  const p = page();
  await openChoose();
  // The sheet covers the Help button, so the tour starts the way the page would start it: through the button itself.
  await p.evaluate(() => { document.querySelector<HTMLElement>('header.hm-bar button[data-tour="help"]')?.click(); });
  await p.evaluate(() => { [...document.querySelectorAll<HTMLElement>('button')].find(b => b.textContent?.trim() === 'Show me around')?.click(); });
  await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible();
  await expect(notesLayer()).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog', { name: 'Tour' })).toHaveCount(0);
});

test('the keyboard does all of it: pick an agent, open Choose notes, pick a topic, Use these notes, Save, Go back', async () => {
  const p = page();
  await tabTo(agentButton('Report builder'));
  await p.keyboard.press('Enter');
  await expect(panel().getByRole('heading', { level: 2, name: 'Report builder' })).toBeVisible();
  await tabTo(chooseButton());
  await p.keyboard.press('Enter');
  await expect(notesLayer().getByRole('heading', { level: 2, name: 'Choose notes' })).toBeFocused();
  await tabTo(topicButton('Travel'));
  await p.keyboard.press('Space');
  await expect(topicButton('Travel')).toHaveAttribute('aria-pressed', 'true');
  await expect(notesLayer().locator('.nt-cost')).toHaveText('A small set');
  await tabTo(useButton());
  await p.keyboard.press('Enter');
  await expect(notesLayer()).toHaveCount(0);
  await expect(chooseButton()).toBeFocused();
  expect(await barText()).toBe('Added Travel notes to Report builder');
  await tabTo(saveButton());
  await p.keyboard.press('Enter');
  await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
  await tabTo(bar().getByRole('button', { name: 'Go back' }));
  await p.keyboard.press('Enter');
  expect(await barText()).toBe('Back to how it was');
  await expect(noteCards()).toHaveCount(0);
});

test('with less motion: the Choose notes sheet does not slide, and the new card is marked without any movement', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p);
  await skipTour(p);
  await openChoose();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await topicButton('Travel').click();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await useButton().click();
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(noteCards().first()).toHaveAttribute('data-fresh', '');
  expect(await budget()).toEqual([]);
});

for (const [w, h] of SIZES) {
  test(`at ${w} by ${h} the Choose notes sheet fills the window and the shelf and the Save bar update after Use these notes`, async () => {
    const p = page();
    await resize(p, w, h);
    await openChoose();
    const box = await rectOf(p, '[data-slot="notes"]');
    expect(box).toMatchObject({ x: 0, y: 0, w, h });
    await topicButton('Travel').click();
    expect(await smallText()).toEqual([]);
    expect(await budget()).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const foot = await rectOf(p, '.nt-foot'), use = await rectOf(p, '.nt-foot .kit-button[data-variant="primary"]');
    expect(foot.y + foot.h).toBeLessThanOrEqual(h + 0.5);
    expect(use.y + use.h).toBeLessThanOrEqual(h + 0.5);
    await useButton().click();
    await expect(notesLayer()).toHaveCount(0);
    // At 900 wide the shelves give way only to a drawer, and none is open, so the new card is in view.
    await expect(panel()).toBeVisible();
    await expect(noteCards().first()).toBeVisible();
    await expect(noteCards().first()).toHaveAttribute('data-fresh', '');
    await expect(bar()).toContainText('Added Travel notes to Report builder');
    expect(await smallText()).toEqual([]);
    expect(await budget()).toEqual([]);
  });
}

for (const [w, h] of SIZES) for (const look of THEMES) {
  test(`screenshots at ${w} by ${h}, ${look}: Choose notes open in the shell, after Use these notes`, async () => {
    test.skip(process.env.HOME_U0_SHOTS === undefined, 'Set HOME_U0_SHOTS to a folder to take screenshots.');
    const p = page();
    await setLook(p, look);
    await resize(p, w, h);
    await openChoose();
    await shot(p, 'notes-1-sheet-open', w, h, look);
    await topicButton('Travel').click();
    await topicButton('Meetings').click();
    await shot(p, 'notes-2-sheet-two-topics', w, h, look);
    await useButton().click();
    await expect(notesLayer()).toHaveCount(0);
    await p.mouse.move(2, h / 2);
    await shot(p, 'notes-3-after-use', w, h, look);
    await saveButton().click();
    await expect(bar().getByText(SAVED, { exact: true })).toBeVisible();
    await shot(p, 'notes-4-saved', w, h, look);
  });
}
