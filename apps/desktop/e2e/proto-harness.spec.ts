/**
 * The harness editor (prototype slice S5), in the real prototype window (Electron started with --prototype and a temporary data folder).
 * Walks acceptance journey 2 on screen: connect a skill to an agent, hide an inherited skill in a project, read the files for all three
 * interfaces, Apply, read the result and the version number, see Undo off, and reload to a fresh world.
 * Also checks the access chooser, the refusals, the conflict dialog (keyboard and focus), a drop on a harness, and reduce motion.
 * Set PROTO_HARNESS_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600 there.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { CDPSession, ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import type { AgentItem } from '../shared/proto/types.js';
import { animationsDone, canvasSettled } from './proto-wait.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_HARNESS_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
const SIZES = [[1440, 900], [900, 600]] as const;

const world = generateWorld(1);
const agent = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === 'agent-01')!;
const freeSkill = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && i.id !== CASE_IDS.hiddenSkill && i.id !== CASE_IDS.tripleSkill && !agent.definition.skillIds.includes(i.id))!;
const freeTool = world.items.find(i => i.kind === 'tool' && i.toolKind === 'mcp' && i.scopeId === 'global' && i.id !== CASE_IDS.mcpMissing && i.id !== CASE_IDS.mcpPresent && !agent.definition.toolAttachments.some(t => t.toolId === i.id))
  ?? world.items.find(i => i.kind === 'tool' && i.toolKind === 'prompt' && i.scopeId === 'global' && !agent.definition.toolAttachments.some(t => t.toolId === i.id))!;
const inheritedSkill = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && i.id !== CASE_IDS.hiddenSkill && i.id !== CASE_IDS.tripleSkill && i.id !== freeSkill.id && i.id !== 'skill-005')!;

let app: ElectronApplication, page: Page, emulation: CDPSession | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  // The prototype runs from the bundle, so the bundle is made fresh from the source in this folder.
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});
test.afterAll(async () => { try { await app.close(); } finally { removeTempDirs(); } });

/** The screen here may be smaller than the sizes asked for, so the page is shown at the size by emulating the viewport. */
async function resize(w: number, h: number): Promise<void> {
  // The session stays open: the override ends when it closes.
  emulation ??= await page.context().newCDPSession(page);
  await emulation.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(({ w: ww, h: hh }) => window.innerWidth === ww && window.innerHeight === hh, { w, h });
}
/** The first view as a person gets it: a long list of skills is one group. */
async function freshFolded(w = 1440, h = 900): Promise<void> {
  await page.reload();
  await page.waitForSelector('nav.nav');
  await resize(w, h);
  await page.locator('nav.nav').getByRole('button', { name: 'Harness' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harness' })).toBeVisible();
  await page.waitForSelector('.react-flow__node');
  await canvasSettled(page, { fitted: true });
}
/** Opens the group of the global skills (and, in a small window, the groups of the agents and tools), so the nodes the rules work on are there. */
async function openGroups(): Promise<void> {
  for (const id of ['group:agents:global', 'group:tools:global', 'group:slices:global', 'group:skills:global']) {
    const toggle = node(id).locator('.hc-toggle');
    if (await toggle.count() > 0 && (await toggle.innerText()) === 'Open') { await toggle.click(); await expect(toggle).toHaveText('Close'); }
  }
  await canvasSettled(page, { fitted: true });
}
/** The first view with every group open: the skills, and in a small window the agents, tools and slices, are nodes of their own. */
async function fresh(w = 1440, h = 900): Promise<void> {
  await freshFolded(w, h);
  await openGroups();
}
const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const message = () => page.locator('.harness-message');
const bar = () => page.locator('section.harness-bar');
async function scope(id: string): Promise<void> {
  await page.getByLabel('Scope').selectOption(id);
  await expect(node(`scope:${id}`)).toBeAttached();
  await canvasSettled(page, { fitted: true });
}
async function shot(name: string, w: number, h: number): Promise<void> {
  if (shotsDir !== null) { await animationsDone(page); await page.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' }); }
}
/** Connects two nodes with the keyboard: C on the first, then Enter on the second. */
async function wire(from: string, to: string): Promise<void> {
  await node(from).focus(); await page.keyboard.press('c');
  await expect(page.locator('.hc-banner')).toHaveCount(1);
  await node(to).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.hc-banner')).toHaveCount(0);
}

test('journey 2: wire a skill to an agent, hide an inherited skill in a project, read the files, apply, read the result, undo is off, reload resets', async () => {
  test.setTimeout(180_000);
  await fresh();
  await expect(bar()).toContainText('No changes waiting');
  await expect(bar().getByRole('button', { name: 'Apply' })).toBeDisabled();
  await expect(bar()).toContainText('There is nothing to apply. Make a change first.');
  await expect(page.getByLabel('Scope').locator('option')).toHaveCount(world.scopes.length);

  // Look at the agent before the change.
  await node(agent.id).click();
  const inspector = page.getByRole('complementary', { name: 'Details of the selected item' });
  await expect(inspector.getByRole('heading', { level: 2, name: agent.name })).toBeVisible();
  const before = await inspector.locator('.harness-facts').innerText();

  // Wire a skill to the agent with the keyboard.
  await wire(freeSkill.id, agent.id);
  await expect(message()).toContainText(`${agent.name} now uses the skill ${freeSkill.name}.`);
  await expect(bar()).toContainText(/1 edit waiting\. \d+ files would change\./);
  await node(agent.id).click();
  expect(await inspector.locator('.harness-facts').innerText()).not.toBe(before);

  // In a project, hide an inherited skill.
  await scope('scope-copperfen');
  await expect(page.getByLabel('Show inherited')).toBeChecked();
  await node(inheritedSkill.id).click();
  await expect(inspector.getByRole('heading', { level: 2, name: inheritedSkill.name })).toBeVisible();
  await expect(inspector).toContainText('Inherited from Studio.');
  await expect(inspector.getByRole('button', { name: 'Keep from global' })).toHaveAttribute('aria-pressed', 'true');
  await inspector.getByRole('button', { name: 'Hide here' }).click();
  await expect(message()).toContainText('is hidden in Copperfen');
  await expect(node(inheritedSkill.id).locator('.hc-node')).toHaveClass(/is-hidden/);
  await expect(inspector.getByRole('button', { name: 'Hide here' })).toHaveAttribute('aria-pressed', 'true');
  // A ghost comes back.
  await inspector.getByRole('button', { name: 'Keep from global' }).click();
  await expect(node(inheritedSkill.id).locator('.hc-node')).not.toHaveClass(/is-hidden/);
  await inspector.getByRole('button', { name: 'Hide here' }).click();

  // The files that will be written, for all three interfaces.
  const toggle = bar().getByRole('button', { name: 'See what will be written' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) await expect(bar().getByRole('region', { name })).toBeVisible();
  await expect(bar().locator('.harness-plan .chip').first()).toBeVisible();
  const files = await bar().locator('.harness-plan li').count();
  await expect(bar().locator('.harness-count')).toContainText(`${files} files would change`);
  await bar().locator('.harness-plan summary').first().click();
  await expect(bar().locator('.harness-plan pre.file').first()).toBeVisible();

  // Apply with a short label.
  await bar().getByLabel('Short label for this version').fill('Wire a skill and hide one');
  await bar().getByRole('button', { name: 'Apply' }).click();
  await expect(message()).toContainText('The changes are written (simulated)');
  const result = page.locator('section.harness-result');
  await expect(result.getByRole('heading', { level: 2, name: 'Written to Claude Code, Codex and OpenCode (simulated)' })).toBeVisible();
  await expect(result).toContainText('Saved as version 1: Wire a skill and hide one');
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) await expect(result.getByRole('region', { name })).toBeVisible();
  expect(await result.locator('li').count()).toBe(files);
  await expect(bar()).toContainText('No changes waiting');
  await expect(bar().getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(bar().getByRole('button', { name: 'Apply' })).toBeDisabled();
  await expect(result.getByRole('heading', { level: 2 })).toBeFocused();

  // Another change closes the result; Undo works for it, and stops at the applied version.
  await inspector.getByRole('button', { name: 'Keep from global' }).click();
  await expect(result).toHaveCount(0);
  await expect(bar().getByRole('button', { name: 'Undo' })).toBeEnabled();
  await bar().getByRole('button', { name: 'Undo' }).click();
  await expect(message()).toContainText('Undid the last change.');
  await expect(message()).not.toContainText('is kept from');
  await expect(bar()).toContainText('No changes waiting');
  await expect(bar().getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(bar().getByRole('button', { name: 'Redo' })).toBeEnabled();
  await bar().getByRole('button', { name: 'Redo' }).click();
  await expect(message()).toContainText('Redid it.');
  await bar().getByRole('button', { name: 'Undo' }).click();

  // A reload starts from a fresh world: the wire is gone and nothing waits.
  await fresh();
  await expect(bar()).toContainText('No changes waiting');
  await node(agent.id).click();
  expect(await page.getByRole('complementary', { name: 'Details of the selected item' }).locator('.harness-facts').innerText()).toBe(before);
});

test('a tool wired to an agent opens the access chooser with the placeholder words; focus is kept inside and goes back on Escape', async () => {
  test.setTimeout(120_000);
  await fresh();
  await wire(freeTool.id, agent.id);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByLabel('read only')).toBeChecked();
  await expect(dialog.getByLabel('read and write')).toBeVisible();
  // Tab never leaves the dialog.
  for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe(agent.id);
  await expect(bar()).toContainText('No changes waiting');
  // Again, and pick read and write.
  await wire(freeTool.id, agent.id);
  await dialog.getByLabel('read and write').check();
  await dialog.getByRole('button', { name: 'Attach tool' }).click();
  await expect(message()).toContainText(`${agent.name} now has the tool ${freeTool.name}, with access: read and write.`);
  await expect(bar()).toContainText(/\d+ edits? waiting\. \d+ files? would change\./);
});

test('a wire that cannot be made does nothing and says why in the live region: a hook, a library item, two skills', async () => {
  test.setTimeout(120_000);
  await fresh();
  const live = page.locator('.harness-message[role="status"][aria-live="polite"]');
  await wire(CASE_IDS.hook, agent.id);
  await expect(live).toContainText('Nothing changed.');
  await expect(live).toContainText('never creates, copies, connects or changes one');
  await wire(freeSkill.id, CASE_IDS.tripleSkill);
  await expect(live).toContainText('A skill and a skill do not connect');
  // A refused wire is not announced to a screen reader as connected, and the canvas says it could not.
  await expect(page.locator('.hc-sr')).not.toContainText('Connected');
  await expect(page.locator('.hc-sr')).toContainText('Could not connect');
  await node(`group:${CASE_IDS.newerLibrary}`).locator('.hc-toggle').click();
  await page.waitForSelector(`.react-flow__node[data-id="${CASE_IDS.newerLibraryItem}"]`);
  await wire(freeSkill.id, CASE_IDS.newerLibraryItem);
  await expect(live).toContainText('comes from the library Evergreen Kit and is read only');
  await expect(bar()).toContainText('No changes waiting');
  // Selecting the library item offers a copy, and the copy is a change.
  await node(CASE_IDS.newerLibraryItem).click();
  await page.getByRole('button', { name: 'Make an editable copy' }).click();
  await expect(message()).toContainText('Installed an editable copy');
  await expect(bar()).toContainText(/\d+ edits? waiting\. \d+ files? would change\./);
});

test('a conflict opens a dialog with the copies side by side; keyboard works, focus stays inside and returns; keep one or keep both', async () => {
  test.setTimeout(120_000);
  await fresh();
  await node(CASE_IDS.tripleSkill).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(3);
  const boxes = await dialog.locator('.harness-copy').evaluateAll(list => list.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }));
  expect(new Set(boxes.map(b => Math.round(b.y))).size, 'the copies sit in one row').toBe(1);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) await expect(dialog.getByRole('button', { name: `Keep the copy from ${name}` })).toBeVisible();
  for (let i = 0; i < 10; i += 1) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe(CASE_IDS.tripleSkill);
  // Keep one.
  await node(CASE_IDS.tripleSkill).focus(); await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Keep the copy from Codex' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(message()).toContainText('Kept the copy from Codex');
  await expect(node(CASE_IDS.tripleSkill).locator('.hc-node')).not.toHaveClass(/is-conflict/);
  // Keep both on a fresh world, with a name that is already taken, then a good one.
  await fresh();
  await node(CASE_IDS.tripleSkill).click();
  await page.getByRole('button', { name: 'Resolve the conflict' }).click();
  await dialog.getByRole('button', { name: 'Keep both under their own names' }).click();
  const names = dialog.getByRole('textbox');
  await expect(names).toHaveCount(3);
  await names.nth(1).fill(await names.nth(0).inputValue());
  await expect(dialog).toContainText('Each copy needs its own name.');
  await expect(dialog.getByRole('button', { name: 'Keep both under these names' })).toBeDisabled();
  await names.nth(1).fill('Second copy name');
  await dialog.getByRole('button', { name: 'Keep both under these names' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(message()).toContainText('Kept both copies');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Second copy name' })).toHaveCount(1);
});

test('a drop on a harness installs an editable copy there, and the interface filter and the inherited toggle change what is drawn', async () => {
  test.setTimeout(120_000);
  await fresh();
  await scope('scope-copperfen');
  const drawn = await page.locator('.react-flow__node').count();
  const drawnNow = (): Promise<number> => page.locator('.react-flow__node').count();
  await page.getByLabel('Show inherited').uncheck();
  await expect.poll(drawnNow).toBeLessThan(drawn / 2);
  await page.getByLabel('Show inherited').check();
  await expect.poll(drawnNow).toBe(drawn);
  const chip = page.getByRole('group', { name: 'Show only items found in' }).getByRole('button', { name: 'Codex' });
  await chip.click(); await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(drawnNow).toBeLessThan(drawn);
  await chip.click(); await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(drawnNow).toBe(drawn);
  await canvasSettled(page);
  // Drag a skill onto the project's harness node.
  const from = (await node(inheritedSkill.id).boundingBox())!, to = (await node('scope:scope-copperfen').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2 - 30, to.y + to.height / 2, { steps: 20 }); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(message()).toContainText(`Installed a copy of ${inheritedSkill.name} into Copperfen.`);
  // The copy has the same name and text as the inherited skill, so the files it writes are the same ones: the draft changed, no file does.
  await expect(bar()).toContainText('1 edit waiting. No file would change.');
  await expect(bar().getByRole('button', { name: 'Apply' })).toBeEnabled();
});

test('leaving the Harness screen right after a drop on a node leaves no timer behind and raises no error', async () => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  const onError = (e: Error): void => { problems.push(`pageerror: ${e.message}`); };
  const onConsole = (m: { type(): string; text(): string }): void => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); };
  await fresh();
  page.on('pageerror', onError); page.on('console', onConsole);
  try {
    const from = (await node(freeSkill.id).boundingBox())!, to = (await node(agent.id).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2 - 30, to.y + to.height / 2, { steps: 20 }); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(bar().getByRole('button', { name: 'Apply' }), 'the drop reached the screen').toBeEnabled();
    // The canvas leaves the page while the node is still settling back: its "settling" timer is waiting.
    await page.locator('nav.nav').getByRole('button', { name: 'Skills' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Skills' })).toBeVisible();
    await expect(page.locator('.hc-root')).toHaveCount(0);
    // Wait on the page's own clock for longer than the drop and its grace, so a timer that was left behind would have run by now.
    await page.evaluate(() => new Promise<void>(resolve => { const end = performance.now() + 1000; const tick = (): void => (performance.now() >= end ? resolve() : void requestAnimationFrame(tick)); tick(); }));
    expect(problems).toEqual([]);
    // And the Harness screen still works when it comes back.
    await page.locator('nav.nav').getByRole('button', { name: 'Harness' }).click();
    await page.waitForSelector('.react-flow__node');
    expect(problems).toEqual([]);
  } finally { page.off('pageerror', onError); page.off('console', onConsole); }
});

const otherSkill = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && i.id !== CASE_IDS.hiddenSkill && i.id !== CASE_IDS.tripleSkill && i.id !== freeSkill.id && i.id !== inheritedSkill.id && !agent.definition.skillIds.includes(i.id))!;
const undo = () => bar().getByRole('button', { name: 'Undo' });
const focusedId = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute('data-id') ?? null);

test('Undo stops at a version: off after Apply and after a restore, on after a new change, and on after Discard', async () => {
  test.setTimeout(120_000);
  await fresh();
  await expect(undo()).toBeDisabled();
  await wire(freeSkill.id, agent.id);
  await expect(undo()).toBeEnabled();
  // Discard says that Undo brings the changes back, so Undo is on while nothing waits.
  await bar().getByRole('button', { name: 'Discard' }).click();
  await expect(bar()).toContainText('No changes waiting');
  await expect(undo()).toBeEnabled();
  await undo().click();
  await expect(bar()).toContainText(/\d+ edits? waiting\. \d+ files? would change\./);
  await bar().getByLabel('Short label for this version').fill('One');
  await bar().getByRole('button', { name: 'Apply' }).click();
  const result = page.locator('section.harness-result');
  await expect(result.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(result.locator('h2 svg'), 'the result has an icon as well as words').toBeVisible();
  await expect(undo()).toBeDisabled();
  await wire(otherSkill.id, agent.id);
  await bar().getByLabel('Short label for this version').fill('Two');
  await bar().getByRole('button', { name: 'Apply' }).click();
  await expect(result).toContainText('Saved as version 2: Two');
  await expect(undo()).toBeDisabled();
  // Restore version 1 from Versions; back on this screen, Undo is still off until there is a new change.
  await page.locator('nav.nav').getByRole('button', { name: 'Versions' }).click();
  await page.getByRole('button', { name: /^Restore this version: version 1,/ }).click();
  await expect(page.getByText(/Version 1 was restored as a new version, version 3\./)).toBeVisible();
  await page.locator('nav.nav').getByRole('button', { name: 'Harness' }).click();
  await page.waitForSelector('.react-flow__node');
  await openGroups();
  await expect(undo()).toBeDisabled();
  await wire(otherSkill.id, agent.id);
  await expect(undo()).toBeEnabled();
});

test('the places a person gives the nodes are kept when the scope changes and when the screen is left and opened again', async () => {
  test.setTimeout(120_000);
  await fresh();
  const y = async (): Promise<number> => (await node(freeSkill.id).boundingBox())!.y;
  const startY = await y();
  const b = (await node(freeSkill.id).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 160, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Math.abs((await y()) - startY)).toBeGreaterThan(100);
  const moved = await node(freeSkill.id).evaluate(e => (e as HTMLElement).style.transform);
  await scope('scope-copperfen');
  await scope('global');
  expect(await node(freeSkill.id).evaluate(e => (e as HTMLElement).style.transform), 'after a visit to another scope').toBe(moved);
  await page.locator('nav.nav').getByRole('button', { name: 'Skills' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Skills' })).toBeVisible();
  await page.locator('nav.nav').getByRole('button', { name: 'Harness' }).click();
  await page.waitForSelector('.react-flow__node');
  await canvasSettled(page, { fitted: true });
  await openGroups();
  expect(await node(freeSkill.id).evaluate(e => (e as HTMLElement).style.transform), 'after a visit to another screen').toBe(moved);
  // A reload is a new session: the places are gone.
  await fresh();
  expect(Math.abs((await y()) - startY)).toBeLessThan(2);
});

test('closing the details sends the keyboard to the node, and a button that removes itself sends it to the heading', async () => {
  test.setTimeout(120_000);
  await fresh();
  await node(agent.id).click();
  const inspector = page.getByRole('complementary', { name: 'Details of the selected item' });
  await inspector.getByRole('button', { name: 'Close the details' }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
  await expect.poll(focusedId, { message: 'the node that was open' }).toBe(agent.id);
  // A button that goes away: remove a skill from the open agent with the keyboard.
  await node(agent.id).click();
  const remove = inspector.getByRole('button', { name: /^Remove the skill / });
  const before = await remove.count();
  await remove.first().focus();
  await page.keyboard.press('Enter');
  await expect(remove).toHaveCount(before - 1);
  await expect(inspector.getByRole('heading', { level: 2, name: agent.name })).toBeFocused();
});

test('an inherited agent can be copied into a project with the keyboard, and the note names the button as well as the drop', async () => {
  test.setTimeout(120_000);
  await fresh();
  await scope('scope-copperfen');
  await node(agent.id).click();
  const inspector = page.getByRole('complementary', { name: 'Details of the selected item' });
  await expect(inspector).toContainText('Inherited from');
  await expect(inspector.locator('.harness-note')).toContainText('press Copy to this harness');
  await expect(inspector.locator('.harness-note')).toContainText('drop it on this harness');
  const copy = inspector.getByRole('button', { name: 'Copy to this harness' });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(message()).toContainText(`Installed a copy of ${agent.name} into Copperfen.`);
  await expect(bar().getByRole('button', { name: 'Apply' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body), { message: 'the keyboard is not lost' }).toBe(false);
  // A skill that is not inherited does not offer it.
  await scope('global');
  await node(freeSkill.id).click();
  await expect(inspector.getByRole('button', { name: 'Copy to this harness' })).toHaveCount(0);
});

test('in the conflict dialog the keyboard never leaves when a button swaps for a form, the page behind is inert, and everything comes back on close', async () => {
  test.setTimeout(120_000);
  await fresh();
  const dialog = page.getByRole('dialog');
  const inertCount = (): Promise<number> => page.evaluate(() => document.querySelectorAll('[inert]').length);
  const inside = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  await node(CASE_IDS.tripleSkill).focus(); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  expect(await inertCount(), 'the page behind is inert while the dialog is open').toBeGreaterThan(0);
  await expect(page.locator('aside.sidebar')).toHaveJSProperty('inert', true);
  await expect(page.locator('.harness-body')).toHaveJSProperty('inert', true);
  // Swap the button for the form with the keyboard: the button that had the keyboard is gone.
  await dialog.getByRole('button', { name: 'Keep both under their own names' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('textbox')).toHaveCount(3);
  await expect(dialog.getByRole('textbox').first()).toBeFocused();
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Tab'); expect(await inside(), `Tab ${i + 1}`).toBe(true); }
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Shift+Tab'); expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true); }
  // And back: the form goes, the button comes back, and the keyboard goes to it.
  await dialog.getByRole('button', { name: 'Back' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Keep both under their own names' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(inertCount, { message: 'nothing stays inert' }).toBe(0);
  await expect.poll(focusedId, { message: 'the keyboard is back on the node that opened the dialog' }).toBe(CASE_IDS.tripleSkill);
  // The dialog can also be closed by keeping one copy, which removes the opener's state: the keyboard still lands on the screen.
  await node(CASE_IDS.tripleSkill).focus(); await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Keep the copy from Codex' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(inertCount).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body), { message: 'the keyboard is not lost' }).toBe(false);
});

/** The smallest text on screen in the canvas, in pixels: the font size times the zoom of the picture. */
const textSizes = (): Promise<Record<string, number>> => page.evaluate(() => {
  const z = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a, out: Record<string, number> = {};
  for (const [k, sel] of Object.entries({ name: '.hc-label', kind: '.hc-kind', chip: '.hc-chip', toggle: '.hc-toggle' })) {
    const list = [...document.querySelectorAll(sel)].filter(e => (e as HTMLElement).offsetParent !== null && getComputedStyle(e).display !== 'none').map(e => parseFloat(getComputedStyle(e).fontSize) * z);
    if (list.length > 0) out[k] = Math.round(Math.min(...list) * 100) / 100;
  }
  return out;
});

for (const [w, h, floor] of [[1440, 900, 12], [900, 600, 11]] as const) {
  test(`the first view of the global harness is readable at ${w} by ${h}: every name is ${floor} pixels or more, the kind words and chips 12, and nothing is cropped`, async () => {
    test.setTimeout(120_000);
    await freshFolded(w, h);
    const sizes = await textSizes();
    expect(Object.keys(sizes).sort(), 'names, kind words, chips and group buttons are all there').toEqual(['chip', 'kind', 'name', 'toggle']);
    expect(sizes.name, `names at ${w}x${h}`).toBeGreaterThanOrEqual(floor);
    for (const k of ['kind', 'chip', 'toggle'] as const) expect(sizes[k], `${k} at ${w}x${h}`).toBeGreaterThanOrEqual(12);
    const r = await page.evaluate(() => {
      const c = document.querySelector('.hc-root')!.getBoundingClientRect();
      return {
        outside: [...document.querySelectorAll('.react-flow__node')].filter(n => { const b = n.getBoundingClientRect(); return b.left < c.left - 1 || b.right > c.right + 1 || b.top < c.top - 1 || b.bottom > c.bottom + 1; }).length,
        cut: [...document.querySelectorAll('.hc-node')].filter(n => { const t = n.querySelector('.hc-text')!; return t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1; }).length,
        nodes: document.querySelectorAll('.react-flow__node').length, canvas: [Math.round(c.width), Math.round(c.height)],
      };
    });
    expect(r.outside, 'every node is inside the picture').toBe(0);
    expect(r.cut, 'no node has text cut off at its edge').toBe(0);
    expect(r.nodes, 'the first view shows few enough nodes to read').toBeLessThanOrEqual(30);
    await expect(node('group:skills:global')).toContainText('44 skills');
    if (w < 1100) expect(r.canvas[0], 'in a narrow window the canvas has the full width').toBeGreaterThan(w - 260);
  });
}

test('the folded skills open with the group button, and the group says what it holds in its details', async () => {
  test.setTimeout(120_000);
  await freshFolded();
  await expect(page.locator('.react-flow__node[data-id^="skill-"]')).toHaveCount(0);
  await node('group:skills:global').click();
  const inspector = page.getByRole('complementary', { name: 'Details of the selected item' });
  await expect(inspector.getByRole('heading', { level: 2, name: '44 skills' })).toBeVisible();
  await expect(inspector).toContainText('Holds ');
  await inspector.getByRole('button', { name: 'Show all 44 skills' }).click();
  await expect(message()).toContainText('The group is open');
  await expect(page.locator('.react-flow__node[data-id^="skill-"]').first()).toBeAttached();
  await expect(inspector.getByRole('button', { name: 'Show as one group' })).toBeVisible();
});

test('the entrance plays once: a second visit and a scope switch only crossfade', async () => {
  test.setTimeout(120_000);
  await freshFolded();
  const watch = (): Promise<void> => page.evaluate(() => { const w = window as unknown as { __names: string[] }; w.__names = []; const t = (): void => { for (const a of document.getAnimations()) if (a.playState === 'running' && (a as CSSAnimation).animationName) w.__names.push((a as CSSAnimation).animationName); requestAnimationFrame(t); }; t(); });
  const names = (): Promise<string[]> => page.evaluate(() => [...new Set((window as unknown as { __names: string[] }).__names)]);
  await watch();
  await page.locator('nav.nav').getByRole('button', { name: 'Skills' }).click();
  await page.locator('nav.nav').getByRole('button', { name: 'Harness' }).click();
  await page.waitForSelector('.react-flow__node'); await canvasSettled(page, { fitted: true });
  await page.getByLabel('Scope').selectOption('scope-copperfen');
  await expect(node('scope:scope-copperfen')).toBeAttached(); await canvasSettled(page, { fitted: true });
  const seen = await names();
  expect(seen).toContain('hc-fade');
  expect(seen).not.toContain('hc-enter'); expect(seen).not.toContain('hc-edge-draw');
});

test('in a narrow window the details float over the canvas on the side away from the chosen node, and they close', async () => {
  test.setTimeout(120_000);
  await freshFolded(900, 600);
  const inspector = page.getByRole('complementary', { name: 'Details of the selected item' });
  await expect(inspector, 'nothing is chosen, so no panel takes room').toBeHidden();
  const wide = await page.evaluate(() => document.querySelector('.hc-root')!.getBoundingClientRect().width);
  await node('interface:codex').click();
  await expect(inspector).toBeVisible();
  const box = await page.evaluate(() => { const c = document.querySelector('.hc-root')!.getBoundingClientRect(), i = document.querySelector('.harness-inspector')!.getBoundingClientRect(), n = document.querySelector('.react-flow__node[data-id="interface:codex"]')!.getBoundingClientRect(); return { canvas: c.width, inside: i.left >= c.left && i.right <= c.right + 1, over: i.left < n.right && n.left < i.right }; });
  expect(box.canvas, 'the canvas keeps its width').toBe(wide);
  expect(box.inside).toBe(true);
  expect(box.over, 'the chosen node is not under the panel').toBe(false);
  await inspector.getByRole('button', { name: 'Close the details' }).click();
  await expect(inspector).toBeHidden();
  await expect.poll(focusedId).toBe('interface:codex');
  await node('interface:codex').click(); await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Close the details' }).focus(); await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
});

test('reduce motion makes every duration 0, including the slide of the change bar; with motion on they come from the tokens', async () => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh();
  const read = (): Promise<Record<string, string>> => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement), hc = getComputedStyle(document.querySelector('.hc-root')!);
    return { slide: root.getPropertyValue('--motion-panel-slide-ms').trim(), hover: root.getPropertyValue('--motion-hover-ms').trim(), select: hc.getPropertyValue('--hc-select-ms').trim(), drop: hc.getPropertyValue('--hc-drop-ms').trim() };
  });
  expect(await read()).toEqual({ slide: '0ms', hover: '0ms', select: '0ms', drop: '0ms' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await fresh();
  expect(await read()).toEqual({ slide: '220ms', hover: '90ms', select: '120ms', drop: '220ms' });
});

for (const [w, h] of SIZES) {
  test(`screenshots at ${w} by ${h}: first view, a selected item, the conflict dialog, the change bar open, the result`, async () => {
    test.skip(shotsDir === null, 'Set PROTO_HARNESS_SHOTS to save screenshots.');
    test.setTimeout(180_000);
    await fresh(w, h);
    await shot('1-first-view', w, h);
    // A selected agent with the inspector. Nothing under the inspector may sit on the canvas.
    await node(agent.id).click();
    await expect(page.locator('.harness-inspector')).toBeVisible();
    const gap = await page.evaluate(() => { const c = document.querySelector('.hc-root')!.getBoundingClientRect(), i = document.querySelector('.harness-inspector')!.getBoundingClientRect(); return { beside: i.left - c.right, inside: i.left >= c.left && i.right <= c.right + 1 && i.top >= c.top - 1 && i.bottom <= c.bottom + 1 }; });
    if (w >= 1100) expect(gap.beside, 'the inspector sits beside the canvas, not over it').toBeGreaterThanOrEqual(0);
    else expect(gap.inside, 'in a narrow window the inspector floats inside the canvas').toBe(true);
    await shot('2-selected-with-inspector', w, h);
    // The conflict dialog.
    await node(CASE_IDS.tripleSkill).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('3-conflict-dialog', w, h);
    await page.keyboard.press('Escape');
    // Changes, the list open.
    await wire(freeSkill.id, agent.id);
    await scope('scope-copperfen');
    await node(inheritedSkill.id).click();
    await page.getByRole('button', { name: 'Hide here' }).click();
    await bar().getByRole('button', { name: 'See what will be written' }).click();
    await shot('4-change-bar-open', w, h);
    // Every control of the bar is inside the window.
    const low = await page.evaluate(() => [...document.querySelectorAll('.harness-bar button, .harness-bar input')].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1; }).length);
    expect(low, 'bar controls inside the window').toBe(0);
    await bar().getByLabel('Short label for this version').fill('Wire a skill and hide one');
    await bar().getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('section.harness-result')).toBeVisible();
    await shot('5-result', w, h);
  });
}
