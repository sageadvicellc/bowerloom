/**
 * The skills manager and the agents manager (prototype slice S6), in the real prototype window (Electron started with --prototype and a temporary data folder).
 * Walks the part of acceptance journey 2 that these two screens own: install a skill to a project by menu and by drag, add Lantern Works, make a copy of a
 * library agent, attach and reorder a skill, then open the Harness screen and see the change bar count rise. Also checks the keyboard way of every drag, the
 * refusals, hide and keep in a project, the conflict dialog, the 50-row limit, and reduce motion.
 * Set PROTO_SKILLS_AGENTS_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600 there.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { CDPSession, ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animationsDone, framesPainted } from './proto-wait.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import type { AgentItem, SkillItem } from '../shared/proto/types.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_SKILLS_AGENTS_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
const SIZES = [[1440, 900], [900, 600]] as const;

const world = generateWorld(1);
const skillNamed = (id: string): SkillItem => world.items.find((i): i is SkillItem => i.kind === 'skill' && i.id === id)!;
const menuSkill = skillNamed('skill-020'), dragSkill = skillNamed('skill-021'), hideSkill = skillNamed('skill-012');
const owned = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === 'agent-02')!;
const withExtras = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === 'agent-01')!;
const libraryAgent = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === CASE_IDS.newerLibraryItem)!;

let app: ElectronApplication, page: Page, emulation: CDPSession | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  // The prototype runs from the bundle, so the bundle is made fresh from the source in this folder.
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  const userData = mkdtempSync(join(tmpdir(), 'bowerloom-prototype-e2e-'));
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});
test.afterAll(async () => { await app.close(); });

/** The window here may be smaller than the sizes asked for, so the page is shown at the size by emulating the viewport. */
async function resize(w: number, h: number): Promise<void> {
  emulation ??= await page.context().newCDPSession(page);
  await emulation.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(({ w: ww, h: hh }) => window.innerWidth === ww && window.innerHeight === hh, { w, h });
}
async function open(screen: 'Skills' | 'Agents' | 'Harness'): Promise<void> {
  await page.locator('nav.nav').getByRole('button', { name: screen }).click();
  await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible();
}
async function fresh(screen: 'Skills' | 'Agents' | 'Harness' = 'Skills', w = 1440, h = 900): Promise<void> {
  await page.reload();
  await page.waitForSelector('nav.nav');
  await resize(w, h);
  await open(screen);
}
const note = () => page.locator('.lib-note');
const card = (id: string) => page.locator(`article.lib-card[data-item="${id}"]`);
const chip = (label: string) => page.getByRole('group', { name: 'Harness' }).getByRole('button', { name: label, exact: true });
const waiting = () => page.locator('section.lib-waiting');
const waitingCount = async (): Promise<number> => Number(/(\d+) change/.exec(await waiting().locator('.lib-waiting-count').innerText())?.[1] ?? '0');
async function shot(name: string, w: number, h: number): Promise<void> {
  if (shotsDir !== null) { await animationsDone(page); await page.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' }); }
}
/** A drag with the real pointer: press on `from`, move in steps, release over `to`. */
async function pointerDrag(from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>, at = { x: 24, y: 18 }): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + at.x, a.y + at.y);
  await page.mouse.down();
  await page.mouse.move(a.x + at.x + 12, a.y + at.y + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await framesPainted(page); // the move has been handled and the target drawn before the button is released
  await page.mouse.up();
}
/** The ids of the skills in the open agent's list, in order. */
const skillOrder = (): Promise<string[]> => page.locator('ol.agents-skills > li .agents-skill-name').evaluateAll(els => els.map(e => (e.childNodes[0]?.textContent ?? '').trim()));

test('the skills screen opens on the global harness with the three groups, 43 skills of yours, the conflict case and a closed library', async () => {
  await fresh();
  await expect(chip('Studio (global)')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: /^Yours/ })).toContainText('43 skills');
  await expect(page.getByRole('heading', { level: 2, name: /^From libraries/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /^Found in several tools/ })).toContainText('1 skill');
  await expect(page.locator('#lib-yours').locator('xpath=..').locator('article.lib-card')).toHaveCount(43);
  await expect(card(CASE_IDS.tripleSkill)).toContainText('Found in several tools');
  await expect(page.getByText('New version waiting: 2.4.0').first()).toBeVisible();
  await expect(page.getByText('Pinned to version 2.3.0. Read only.')).toBeVisible();
  await expect(waiting()).toContainText('No changes waiting');
  // The card says in words where the skill is.
  await expect(card(menuSkill.id)).toContainText('Studio (global) and all 3 projects');
  await expect(card(menuSkill.id)).toContainText('Claude Code, Codex and OpenCode');
  // The headings never skip a level.
  const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll(els => els.map(e => Number(e.tagName.slice(1))));
  for (let i = 1; i < levels.length; i += 1) expect(levels[i]!, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
});

test('search narrows by name and by description, and the interface chip keeps skills found in that interface', async () => {
  await fresh();
  const search = page.getByLabel('Search skills');
  await search.fill(menuSkill.name);
  await expect(page.locator('article.lib-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p')).toContainText('1 skill of 44 match');
  await search.fill('zzzzqqq');
  await expect(page.locator('article.lib-card')).toHaveCount(0);
  await expect(page.getByText('No skill of yours matches the search.')).toBeVisible();
  await search.fill('');
  const all = await page.locator('article.lib-card').count();
  const codex = page.getByRole('group', { name: 'Found in' }).getByRole('button', { name: 'Codex' });
  await codex.click();
  await expect(codex).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('article.lib-card').count()).toBeLessThan(all);
  await codex.click();
  await expect(page.locator('article.lib-card')).toHaveCount(all);
});

test('install to a project by the menu, with the keyboard alone: a menu, a plain confirmation, and the waiting list', async () => {
  await fresh();
  const trigger = card(menuSkill.id).getByRole('button', { name: 'Install to' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Studio (global)'); await expect(items.nth(0)).toContainText('Already there'); await expect(items.nth(0)).toHaveAttribute('aria-disabled', 'true');
  await expect(items.nth(0)).toBeFocused();
  // Escape closes the menu and gives the focus back.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  // The global harness is refused, in words.
  await page.keyboard.press('Enter');
  await expect(note()).toContainText('Nothing changed.'); await expect(note()).toContainText(`${menuSkill.name} is already in Studio.`);
  await expect(waiting()).toContainText('No changes waiting');
  // A project takes it.
  await trigger.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await expect(items.nth(2)).toBeFocused(); await expect(items.nth(2)).toContainText('Copperfen (project)');
  await page.keyboard.press('Enter');
  await expect(note()).toContainText(`Installed a copy of ${menuSkill.name} into Copperfen.`);
  await expect(note()).toContainText('Apply on the Harness screen.');
  await expect(waiting()).toContainText('Changes waiting');
  await expect(waiting().getByRole('heading', { level: 2, name: 'Waiting to apply' })).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('drag a card onto a harness chip installs it there; the chip shows where it will land, and the settle ends', async () => {
  await fresh();
  const target = chip('Reedmarsh (project)');
  await pointerDrag(card(dragSkill.id), target);
  await expect(note()).toContainText(`Installed a copy of ${dragSkill.name} into Reedmarsh.`);
  await expect(note()).toContainText('Apply on the Harness screen.');
  // The drop on the global harness is refused for a skill that is already there.
  await pointerDrag(card(menuSkill.id), chip('Studio (global)'));
  await expect(note()).toContainText(`${menuSkill.name} is already in Studio.`);
  // The copy is in Reedmarsh now.
  await chip('Reedmarsh (project)').click();
  await expect(card(`${dragSkill.id}-copy`)).toBeVisible();
  await expect(card(`${dragSkill.id}-copy`)).toContainText('Reedmarsh');
});

test('hide in a project and keep from global use the editor\'s own words; the hidden card stays so it can come back', async () => {
  await fresh();
  await chip('Reedmarsh (project)').click();
  const c = card(hideSkill.id);
  await expect(c).toContainText('Inherited from Studio');
  await c.getByRole('button', { name: 'Hide in this project' }).click();
  await expect(note()).toContainText(`${hideSkill.name} is hidden in Reedmarsh.`);
  await expect(c).toContainText('Hidden in this project');
  await expect(c).toHaveClass(/is-hidden/);
  await c.getByRole('button', { name: 'Keep from global' }).click();
  await expect(note()).toContainText(`${hideSkill.name} is kept from Studio again.`);
  await expect(c).toContainText('Inherited from Studio');
  await expect(page.locator(`article.lib-card[data-item="${CASE_IDS.hiddenSkill}"]`)).toContainText('Hidden in this project');
  // A skill of the global harness has no such choice there.
  await chip('Studio (global)').click();
  await expect(card(hideSkill.id).getByRole('button', { name: 'Hide in this project' })).toHaveCount(0);
});

test('the conflict case opens the same side-by-side dialog the harness editor has, with the keyboard and focus kept', async () => {
  await fresh();
  const trigger = card(CASE_IDS.tripleSkill).getByRole('button', { name: 'Resolve the conflict' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toContainText('has different text in different interfaces');
  await expect(dialog.locator('.harness-copy')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  // Keep one copy: the skill is no longer in the conflict group.
  await trigger.click();
  await dialog.getByRole('button', { name: /^Keep the copy from/ }).first().click();
  await expect(note()).toContainText('Kept the copy from');
  await expect(page.getByRole('heading', { level: 2, name: /^Found in several tools/ })).toContainText('0 skills');
  await expect(page.getByText('Nothing is found in several tools with different text.')).toBeVisible();
});

test('Add skills: a folder lists what it found and reads nothing; Lantern Works is added, opens under From libraries, and its skills install as editable copies', async () => {
  await fresh();
  const toggle = page.getByRole('button', { name: 'Add skills', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('#lib-add-panel');
  await expect(panel.getByRole('heading', { level: 2, name: 'Add skills' })).toBeFocused();
  await expect(panel.getByRole('heading', { level: 3, name: 'From a folder' })).toBeVisible();
  await expect(panel.getByRole('heading', { level: 3, name: 'From a library' })).toBeVisible();
  await expect(panel).toContainText('A library stays a reference until you edit an item.');
  await expect(panel).toContainText('Evergreen Kit'); await expect(panel.getByText('Installed', { exact: true })).toBeVisible();
  // A folder: tick two skills, press the button. Nothing is added.
  const before = await waitingCount();
  const folder = panel.getByRole('group', { name: 'Harbour notes' });
  await expect(folder.getByRole('button', { name: /Tick a skill to add it/ })).toBeDisabled();
  await folder.getByRole('checkbox').nth(0).check(); await folder.getByRole('checkbox').nth(1).check();
  await folder.getByRole('button', { name: /Add the 2 ticked skills/ }).click();
  await expect(note()).toContainText('Noted.');
  await expect(note()).toContainText('Bowerloom reads a folder only after you approve it, so nothing was added.');
  await expect(waiting()).toContainText('No changes waiting'); expect(await waitingCount()).toBe(before);
  // A library: Lantern Works.
  await panel.getByRole('button', { name: /Add this library/ }).click();
  await expect(note()).toContainText('Lantern Works is added: 6 skills and 3 agents.');
  await expect(note()).toContainText('Changes waiting. No file would change. Apply on the Harness screen.');
  await expect(panel.getByRole('button', { name: /Add this library/ })).toHaveCount(0);
  const lantern = page.getByRole('button', { name: /^Lantern Works/ });
  await expect(lantern).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.lib-group', { hasText: 'Lantern Works' }).locator('article.lib-card')).toHaveCount(6);
  await expect(page.getByText('Pinned to version 1.2.0. Read only.')).toBeVisible();
  // A library skill installs as an editable copy.
  const oil = card('lantern-works-oil-topping');
  await expect(oil).toContainText('Read only');
  await oil.getByRole('button', { name: 'Install to' }).click();
  await expect(page.getByRole('menu', { name: 'Install an editable copy of oil-topping to' })).toBeVisible();
  await page.getByRole('menuitem', { name: /Studio \(global\)/ }).click();
  await expect(note()).toContainText('Installed a copy that you can edit of oil-topping into Studio.');
  await expect(card('lantern-works-oil-topping-copy')).toBeVisible();
  // The library closes and opens again.
  await lantern.click(); await expect(lantern).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.lib-group', { hasText: 'Lantern Works' }).locator('article.lib-card')).toHaveCount(0);
});

test('the agents screen: yours first, Evergreen Kit 50 rows at a time, search, and the definition of the selected agent', async () => {
  await fresh('Agents');
  await expect(page.getByRole('heading', { level: 2, name: /^Yours/ })).toContainText('10 agents');
  await expect(page.getByRole('heading', { level: 2, name: /^Evergreen Kit/ })).toContainText('120 agents');
  await expect(page.locator('.agents-row')).toHaveCount(60);
  await page.getByRole('button', { name: 'Show 50 more' }).click();
  await expect(page.locator('.agents-row')).toHaveCount(110);
  await expect(page.getByRole('button', { name: 'Show 20 more' })).toBeVisible();
  await page.getByRole('button', { name: 'Show 20 more' }).click();
  await expect(page.locator('.agents-row')).toHaveCount(130);
  await expect(page.getByRole('button', { name: /^Show \d+ more/ })).toHaveCount(0);
  // Search by role.
  const search = page.getByLabel('Search agents');
  await search.fill(libraryAgent.definition.role);
  const hits = await page.locator('.agents-row').count();
  expect(hits).toBeGreaterThan(0); expect(hits).toBeLessThan(130);
  await expect(page.getByText(/\d+ of 120 match/)).toBeVisible();
  await search.fill('');
  await expect(page.locator('.agents-row')).toHaveCount(60);
  // The first of yours is on show, with the definition.
  const detail = page.locator('article.agents-detail');
  await expect(detail.getByRole('heading', { level: 2 })).toBeVisible();
  for (const h of ['Instructions', 'Skills, in order', 'Tools', 'Knowledge slice', 'Only in some interfaces', 'Where it lands']) await expect(detail.getByRole('heading', { level: 3, name: h })).toBeVisible();
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) await expect(detail.getByRole('heading', { level: 4, name })).toBeVisible();
  await expect(detail.locator('pre.agents-instructions')).not.toBeEmpty();
  // An agent with an extra shows its badge.
  await page.locator('.agents-row', { hasText: world.items.find(i => i.id === 'agent-01')!.name }).first().click();
  await expect(detail).toContainText(/(Claude Code|Codex|OpenCode) only/);
  // The arrow keys move through the rows.
  const rows = page.locator('.agents-row');
  await rows.nth(0).focus(); await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
});

test('a library agent is read only: its controls explain, the copy goes to the chosen harness, and the copy can be changed', async () => {
  await fresh('Agents');
  await page.getByLabel('Search agents').fill(libraryAgent.name);
  await page.locator('.agents-row', { hasText: libraryAgent.name }).first().click();
  await page.getByLabel('Search agents').fill('');
  const detail = page.locator('article.agents-detail');
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(libraryAgent.name);
  await expect(detail).toContainText('Read-only: it comes from Evergreen Kit.');
  await expect(detail).toContainText('New version waiting: 2.4.0');
  await expect(detail).toContainText('Nothing is written. A library agent is a reference.');
  // Editing is refused in plain words.
  await detail.getByRole('button', { name: 'Attach a skill' }).click({ force: true });
  await expect(note()).toContainText('Nothing changed.');
  await expect(note()).toContainText(`${libraryAgent.name} comes from the library Evergreen Kit and is read only. Make an editable copy first, then change the copy.`);
  await expect(waiting()).toContainText('No changes waiting');
  // Make my own copy, into Copperfen.
  await detail.getByLabel('Copy into').selectOption('scope-copperfen');
  await detail.getByRole('button', { name: 'Make my own copy' }).click();
  await expect(note()).toContainText(`Installed a copy that you can edit of ${libraryAgent.name} into Copperfen.`);
  await expect(detail).not.toContainText('Read-only: it comes from');
  await expect(detail).toContainText('Lives in Copperfen');
  await expect(page.locator('.agents-row[aria-current="true"]')).toContainText(libraryAgent.name);
  // The copy is written to every installed interface when the changes are applied.
  await expect(detail).toContainText('would be written');
  await expect(waiting()).toContainText(/\d+ changes? waiting/);
});

test('attach a skill with the combobox, reorder with the buttons and by drag, detach, and change a tool\'s access; then the Harness screen shows the count', async () => {
  test.setTimeout(180_000);
  await fresh('Agents');
  await page.locator('.agents-row', { hasText: owned.name }).first().click();
  const detail = page.locator('article.agents-detail');
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(owned.name);
  const start = await skillOrder();
  expect(start.length).toBe(owned.definition.skillIds.length);

  // Attach: a combobox with a list, driven by the keyboard.
  const combo = detail.getByRole('combobox', { name: 'Attach a skill' });
  const free = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && !owned.definition.skillIds.includes(i.id) && i.id !== CASE_IDS.tripleSkill)!;
  await combo.fill(free.name);
  await expect(combo).toHaveAttribute('aria-expanded', 'true');
  const option = detail.getByRole('option', { name: new RegExp(free.name) });
  await expect(option.first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(note()).toContainText(`${owned.name} now uses the skill ${free.name}.`);
  await expect(note()).toContainText('Apply on the Harness screen.');
  expect(await skillOrder()).toEqual([...start, free.name]);
  const afterAttach = await waitingCount();
  expect(afterAttach).toBeGreaterThanOrEqual(3);

  // Reorder with the buttons.
  await detail.getByRole('button', { name: `Move up: ${free.name}` }).click();
  await expect(note()).toContainText(`Moved the skill ${free.name} to place ${start.length} of ${start.length + 1} for ${owned.name}.`);
  expect(await skillOrder()).toEqual([...start.slice(0, -1), free.name, start.at(-1)!]);
  await detail.getByRole('button', { name: `Move down: ${free.name}` }).click();
  expect(await skillOrder()).toEqual([...start, free.name]);
  // The ends say so.
  await detail.getByRole('button', { name: `Move down: ${free.name}` }).click({ force: true });
  await expect(note()).toContainText(`${free.name} is already last in the list.`);
  await expect(note()).toContainText('Nothing changed.');
  // Reorder by drag: the last one goes to the top.
  await pointerDrag(detail.locator('ol.agents-skills > li .agents-handle').last(), detail.locator('ol.agents-skills > li').first(), { x: 8, y: 9 });
  expect(await skillOrder()).toEqual([free.name, ...start]);
  await expect(note()).toContainText(`Moved the skill ${free.name} to place 1 of ${start.length + 1} for ${owned.name}.`);
  // Detach it again.
  await detail.getByRole('button', { name: `Detach: ${free.name}` }).click();
  await expect(note()).toContainText(`${owned.name} no longer uses the skill ${free.name}.`);
  expect(await skillOrder()).toEqual(start);

  // Tools: change an access class, attach a tool, detach it.
  const access = detail.locator('.agents-tools select').first();
  const now = await access.inputValue();
  await access.selectOption(now === 'read-only' ? 'read-write' : 'read-only');
  await expect(note()).toContainText('with access: ' + (now === 'read-only' ? 'read and write' : 'read only') + '.');
  await detail.getByRole('button', { name: 'Attach tool' }).click();
  await expect(note()).toContainText(`${owned.name} now has the tool`);
  // A slice: none, then back.
  const slice = detail.getByLabel('Slice this agent reads');
  await slice.selectOption('');
  await expect(note()).toContainText(`${owned.name} reads no slice now.`);

  // The Harness screen shows the count in its change bar.
  const here = await waitingCount();
  expect(here).toBeGreaterThan(afterAttach - 1);
  await open('Harness');
  await expect(page.locator('section.harness-bar .harness-count')).toContainText(/\d+ changes? waiting/);
  const onHarness = Number(/(\d+) change/.exec(await page.locator('section.harness-bar .harness-count').innerText())?.[1]);
  expect(onHarness).toBe(here);
  await expect(page.locator('section.harness-bar').getByRole('button', { name: 'Apply' })).toBeEnabled();
  // Back on the Agents screen the same count waits.
  await open('Agents');
  expect(await waitingCount()).toBe(here);
});

test('the skills and agents screens share one store: an install on Skills shows in the Harness change bar, and the count is the same on Agents', async () => {
  await fresh();
  await card(CASE_IDS.hiddenSkill).getByRole('button', { name: 'Install to' }).click();
  await page.getByRole('menuitem', { name: /Reedmarsh/ }).click();
  await expect(note()).toContainText('Installed a copy of');
  const n = await waitingCount();
  await open('Harness');
  await expect(page.locator('section.harness-bar .harness-count')).toContainText(n === 0 ? 'Changes waiting. No file would change.' : `${n} change`);
  await expect(page.locator('section.harness-bar').getByRole('button', { name: 'Apply' })).toBeEnabled();
});

test('reduce motion makes the settle and the hover durations 0; with motion on they come from the tokens', async () => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh();
  const read = (): Promise<Record<string, string>> => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { settle: root.getPropertyValue('--motion-drop-settle-ms').trim(), hover: root.getPropertyValue('--motion-hover-ms').trim() };
  });
  expect(await read()).toEqual({ settle: '0ms', hover: '0ms' });
  await pointerDrag(card(dragSkill.id), chip('Copperfen (project)'));
  await expect(note()).toContainText(`Installed a copy of ${dragSkill.name} into Copperfen.`);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.lib-scopechip.is-settle-b, .lib-scopechip.is-settle-a')!).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await fresh();
  expect(await read()).toEqual({ settle: '220ms', hover: '90ms' });
  await pointerDrag(card(dragSkill.id), chip('Copperfen (project)'));
  await expect(note()).toContainText('Installed a copy of');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.lib-scopechip.is-settle-b, .lib-scopechip.is-settle-a')!).animationDuration)).toBe('0.22s');
});

for (const [w, h] of SIZES) {
  test(`screenshots at ${w} by ${h}: skills grid, install menu, add skills panel, agent list, agent definition, reorder state`, async () => {
    test.skip(shotsDir === null, 'Set PROTO_SKILLS_AGENTS_SHOTS to save screenshots.');
    test.setTimeout(180_000);
    const noSideScroll = async (): Promise<void> => {
      const over = await page.evaluate(() => { const m = document.querySelector('main')!; return { page: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth }; });
      expect(over.page, 'the page does not scroll sideways').toBeLessThanOrEqual(1); expect(over.main, 'the main area does not scroll sideways').toBeLessThanOrEqual(1);
    };
    await fresh('Skills', w, h);
    await shot('1-skills-grid', w, h);
    await noSideScroll();
    // The install menu, on the first card.
    const first = page.locator('#lib-yours').locator('xpath=..').locator('article.lib-card').first();
    await first.getByRole('button', { name: 'Install to' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await shot('2-install-menu', w, h);
    const box = (await page.getByRole('menu').boundingBox())!;
    expect(box.x + box.width, 'the menu is inside the window').toBeLessThanOrEqual(w + 1); expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
    await page.keyboard.press('Escape');
    // The add skills panel.
    await page.getByRole('button', { name: 'Add skills', exact: true }).click();
    await page.getByRole('button', { name: /Add this library/ }).click();
    await page.locator('#lib-add-panel').scrollIntoViewIfNeeded();
    await shot('3-add-skills-panel', w, h);
    await noSideScroll();
    // The agents.
    await open('Agents');
    await shot('4-agent-list', w, h);
    await noSideScroll();
    await page.locator('.agents-row', { hasText: withExtras.name }).first().click();
    await shot('5-agent-definition', w, h);
    await page.locator('article.agents-detail').getByRole('heading', { level: 3, name: 'Where it lands' }).scrollIntoViewIfNeeded();
    await page.locator('article.agents-detail summary').first().click();
    await shot('5b-agent-where-it-lands', w, h);
    await page.locator('article.agents-detail').getByRole('heading', { level: 3, name: 'Skills, in order' }).scrollIntoViewIfNeeded();
    await page.locator('article.agents-detail').getByRole('button', { name: /^Move down:/ }).first().click();
    await shot('6-agent-reorder', w, h);
    await noSideScroll();
    const bar = (await waiting().boundingBox())!;
    expect(bar.y + bar.height, 'the waiting list is inside the window').toBeLessThanOrEqual(h + 1);
    // A library agent is read only.
    await page.getByLabel('Search agents').fill(libraryAgent.name);
    await page.locator('.agents-row', { hasText: libraryAgent.name }).first().click();
    await shot('7-library-agent-readonly', w, h);
    await noSideScroll();
  });
}
