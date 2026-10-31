/**
 * The Builder of one folder's harness, in the real window on the sample launch (--prototype-v3): the sample engine's folders, in memory, nothing read or
 * written. The folder list, drag to link with real pointer events, a drag that only moves, Unlink, Undo and Redo, a refusal in words, Save through the save
 * sheet's review and its Install, the Save points drawer with Go back, "Discard N changes?" when leaving, New harness opening "From a folder", a folder with
 * no harness, and an id main does not know. Set HARNESS_SHOTS to a folder to save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const WEEKLY = 'sample-weekly-report';
const BUILDER = `#prototype-v3/builder/${WEEKLY}`;
const node = (id: string): Locator => page().locator(`.hx-node[data-node="${id}"]`);
const count = (p: Page): Locator => p.locator('[data-draft]');
const tick = (p: Page, agent: string, skill: string): Locator => p.locator(`[data-agent="${agent}"]`).getByRole('checkbox', { name: `${skill}: ${agent}` });

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); });

/** Drags one node onto a point of another with real pointer events, in steps, as a person would. */
async function drag(p: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
  const a = (await from.boundingBox())!;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 6, { steps: 4 });
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await p.mouse.up();
}
const middle = async (l: Locator): Promise<{ x: number; y: number }> => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

async function openWeekly(p: Page): Promise<void> {
  await fresh(p, BUILDER);
  await expect(node('agent:editor')).toBeVisible();
  await expect(count(p)).toContainText('No change yet.');
}

test('the folder list opens a folder in the Builder, which draws its harness as a graph with no change yet', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/harnesses');
  const folders = p.locator('[data-section="folders"]');
  await expect(folders.locator('[data-folder-row]')).toHaveCount(3);
  await expect(folders.getByRole('button', { name: 'Open weekly-report in the builder', exact: true })).toBeVisible();
  await expect(folders.locator('[data-folder-row="sample-inbox-tools"]').getByRole('button', { name: 'From a folder', exact: true })).toBeVisible();
  await folders.getByRole('button', { name: 'Open weekly-report in the builder', exact: true }).click();
  await expect(p).toHaveURL(new RegExp(`#prototype-v3/builder/${WEEKLY}$`));
  await expect(p.getByRole('heading', { level: 1, name: 'weekly-report' })).toBeVisible();
  for (const id of ['agent:editor', 'agent:writer', 'skill:check-facts', 'skill:draft-outline']) await expect(node(id)).toBeVisible();
  await expect(p.locator('.hx-edge')).toHaveCount(1);
  await expect(count(p)).toContainText('No change yet.');
  await expect(p.locator('[data-builder-save]')).toBeDisabled();
  await expect(p.locator('[data-builder-undo]')).toBeDisabled();
  await expect(p.locator('[data-drop-hint]')).toHaveText('Drag a skill onto an agent to link them.');
  // The editor in the window has no save points of its own: they are in the drawer.
  await expect(p.locator('main [data-section="save-points"]')).toHaveCount(0);
  await shot(p, 'B1-builder');
});

test('drag to link: a skill dropped on an agent links them, and goes back to its place; a drop on empty ground only moves it', async () => {
  const p = page();
  await openWeekly(p);
  const skill = node('skill:check-facts'), before = (await skill.boundingBox())!;
  await drag(p, skill, await middle(node('agent:editor')));
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(tick(p, 'editor', 'check-facts')).toBeChecked();
  await expect(p.locator('.hx-edge')).toHaveCount(2);
  const back = (await skill.boundingBox())!;
  expect(Math.round(back.x - before.x)).toBe(0); expect(Math.round(back.y - before.y)).toBe(0);
  await shot(p, 'B2-builder-linked');
  // A drag to empty ground moves the node and changes nothing in the draft.
  const outline = node('skill:draft-outline'), was = (await outline.boundingBox())!;
  await drag(p, outline, { x: was.x + was.width / 2 + 40, y: was.y + was.height / 2 + 90 });
  const moved = (await outline.boundingBox())!;
  expect(Math.abs(moved.y - was.y)).toBeGreaterThan(40);
  await expect(count(p)).toContainText('1 change, not saved yet.');
});

test('Unlink in the details takes a link off; Undo and Redo step through the unsaved changes, with the keys too', async () => {
  const p = page();
  await openWeekly(p);
  await drag(p, node('skill:check-facts'), await middle(node('agent:editor')));
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await node('agent:writer').click();
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'writer' })).toBeVisible();
  await panel.getByRole('button', { name: 'Unlink writer and draft-outline', exact: true }).click();
  await expect(count(p)).toContainText('2 changes, not saved yet.');
  await expect(tick(p, 'writer', 'draft-outline')).not.toBeChecked();
  await expect(p.locator('.hx-edge')).toHaveCount(1);
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(tick(p, 'writer', 'draft-outline')).toBeChecked();
  await p.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(count(p)).toContainText('2 changes, not saved yet.');
  await p.locator('.hx-canvas').click({ position: { x: 300, y: 12 } });
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(count(p)).toContainText('No change yet.');
  await expect(p.locator('[data-builder-undo]')).toBeDisabled();
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
  await expect(count(p)).toContainText('1 change, not saved yet.');
});

test('a skill selected offers Remove, which says it deletes the files at Save, and Keep takes it back', async () => {
  const p = page();
  await openWeekly(p);
  await node('skill:check-facts').click();
  const panel = p.getByRole('complementary');
  await expect(panel).toContainText('Remove deletes the skill\'s files when you save.');
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(node('skill:check-facts')).toHaveCount(0);
  await expect(p.locator('[data-skill-row="check-facts"]')).toHaveAttribute('data-removed', '');
  await panel.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(count(p)).toContainText('No change yet.');
  await expect(node('skill:check-facts')).toBeVisible();
});

test('a refused drop says why in words, the draft does not change, and the node goes back to its place', async () => {
  const p = page();
  await openWeekly(p);
  const outline = node('skill:draft-outline'), before = (await outline.boundingBox())!;
  await drag(p, outline, await middle(node('agent:writer')));
  await expect(p.getByText('That link is there already.')).toBeVisible();
  await expect(count(p)).toContainText('No change yet.');
  const after = (await outline.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(0); expect(Math.round(after.y - before.y)).toBe(0);
});

test('the keyboard links too: "Link to..." in the details, then Enter on the part with the focus', async () => {
  const p = page();
  await openWeekly(p);
  await node('agent:editor').focus();
  await p.keyboard.press('Enter');
  const linkTo = p.getByRole('complementary').getByRole('button', { name: 'Link to...', exact: true });
  await linkTo.focus();
  await p.keyboard.press('Enter');
  await expect(p.locator('.hx-canvas')).toHaveAttribute('data-linking', '');
  await expect(p.locator('.hx-node[data-candidate]:focus')).toHaveCount(1);
  await p.keyboard.press('Enter');
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(p.locator('.hx-canvas')).not.toHaveAttribute('data-linking', '');
});

test('Save opens the save sheet on its review step with the Builder\'s draft; Done offers Install; the Save points drawer goes back', async () => {
  const p = page();
  await openWeekly(p);
  await drag(p, node('skill:check-facts'), await middle(node('agent:editor')));
  await p.locator('[data-builder-save]').click();
  const s = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
  const review = s.locator('[data-save-review="save"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-file]')).toHaveCount(1);
  await expect(review.locator('[data-file=".bowerloom/agents/editor.md"]')).toHaveAttribute('data-action', 'update');
  await expect(review.locator('[data-agent-after="editor"]')).toContainText('check-facts');
  await shot(p, 'B3-builder-save-review');
  // Back to the edit in the sheet: the same draft as the Builder's.
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(tick(p, 'editor', 'check-facts').filter({ visible: true }).first()).toBeChecked();
  await expect(s.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Save 1 file', exact: true }).click();
  await expect(s.locator('[data-version-kept]')).toHaveAttribute('data-version-kept', 'v2');
  await expect(s.locator('[data-install-next]')).toHaveText('Install it');
  await s.locator('[data-install-next]').click();
  const install = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(install).toBeVisible();
  await install.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(install).toHaveCount(0);

  // The Builder reads the folder again: the link is saved, and nothing waits.
  await expect(count(p)).toContainText('No change yet.');
  await expect(tick(p, 'editor', 'check-facts')).toBeChecked();
  await p.getByRole('button', { name: 'Save points', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Save points' });
  await expect(drawer.locator('[data-version]')).toHaveCount(2);
  await expect(drawer.locator('[data-version="v2"]')).toHaveAttribute('data-current', '');
  await shot(p, 'B4-builder-save-points');
  await drawer.getByRole('button', { name: 'Go back to v1', exact: true }).click();
  const back = s.locator('[data-save-review="restore"]');
  await expect(back.locator('[data-going-back="v1"]')).toContainText(/as it was/i);
  await back.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Go back to v1', exact: true }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(tick(p, 'editor', 'check-facts')).not.toBeChecked();
});

test('leaving a folder with unsaved changes asks "Discard N changes?": Keep editing stays, Discard drops the draft and goes', async () => {
  const p = page();
  await openWeekly(p);
  await drag(p, node('skill:check-facts'), await middle(node('agent:editor')));
  await p.locator('nav').getByRole('button', { name: 'Harnesses', exact: true }).first().click();
  const ask = p.getByRole('dialog', { name: 'Discard 1 change?' });
  await expect(ask).toBeVisible();
  await shot(p, 'B5-builder-discard');
  await ask.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(p).toHaveURL(new RegExp(`builder/${WEEKLY}$`));
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await p.locator('nav').getByRole('button', { name: 'Harnesses', exact: true }).first().click();
  await p.getByRole('dialog', { name: 'Discard 1 change?' }).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await p.locator('[data-section="folders"]').getByRole('button', { name: 'Open weekly-report in the builder', exact: true }).click();
  await expect(count(p)).toContainText('No change yet.');
  // With no change, leaving asks nothing.
  await p.locator('nav').getByRole('button', { name: 'Harnesses', exact: true }).first().click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
});

test('New harness is refused in words and opens "From a folder"; a folder with no harness offers it too', async () => {
  const p = page();
  await openWeekly(p);
  await p.getByRole('button', { name: 'New harness', exact: true }).click();
  await expect(p.getByText('Each folder holds one harness. Make a new one from a folder.')).toBeVisible();
  const adopt = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(adopt).toBeVisible();
  await adopt.getByRole('button', { name: 'Cancel', exact: true }).click();
  await fresh(p, '#prototype-v3/builder/sample-inbox-tools');
  await expect(p.locator('[data-no-harness]')).toContainText('No harness here yet.');
  await p.locator('[data-no-harness]').getByRole('button', { name: 'From a folder', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'New harness from a folder' })).toBeVisible();
});

test('a store harness\'s "Open in builder" opens "From a folder", and an id main does not know goes back to the folder list', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/harnesses');
  await p.getByRole('complementary').getByRole('button', { name: 'Open in builder', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'New harness from a folder' })).toBeVisible();
  await p.keyboard.press('Escape');
  await fresh(p, '#prototype-v3/builder/folder-99');
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.getByText('That folder is not open. Choose it again.')).toBeVisible();
});
