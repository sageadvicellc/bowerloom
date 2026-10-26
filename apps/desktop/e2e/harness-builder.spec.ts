/**
 * The Harness builder (S3) in the real window: the graph, selecting a node (its neighbours stay bright), dragging a node (its place is kept in the manifest and the curves follow),
 * linking by the handle, the Fix sheet, zoom and fit, the list view, and the empty harness.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { WEEKLY, fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const node = (name: string): Locator => page().locator('.hx-node', { hasText: name }).first();

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), `#prototype-v3/builder/${WEEKLY}/graph`); await expect(node('Researcher')).toBeVisible(); });

test('the graph shows the eleven parts and the missing one, with the legend, the zoom buttons and the small map', async () => {
  const p = page();
  await expect(p.locator('.hx-node')).toHaveCount(12);
  await expect(p.locator('.hx-node[data-missing]')).toHaveCount(1);
  await expect(p.locator('.hx-edge')).toHaveCount(10);
  await expect(p.getByText('New in this harness')).toBeVisible();
  await expect(p.getByText('Missing. Fix shows the change first.')).toBeVisible();
  for (const name of ['Zoom in', 'Zoom out', 'Fit to window']) await expect(p.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(p.getByRole('group', { name: 'Small map' })).toBeVisible();
  await expect(p.getByText('11 parts')).toBeVisible();
  await expect(p.getByRole('complementary')).toContainText('Nothing selected');
});

test('selecting a node keeps its neighbours bright and fades the rest; the details show the part', async () => {
  const p = page();
  await node('Researcher').click();
  await expect(node('Researcher')).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Web search', 'Summarize sources', 'Check facts', 'Client list']) await expect(node(name)).not.toHaveAttribute('data-faded', '');
  for (const name of ['Planner', 'Writer', 'Draft outline', 'Spreadsheet', 'Format report', 'Style guide']) await expect(node(name)).toHaveAttribute('data-faded', '');
  await expect(p.locator('.hx-edge[data-on]')).toHaveCount(4);
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'Researcher' })).toBeVisible();
  await expect(panel).toContainText('agents/researcher.md');
  await expect(panel).toContainText('name: researcher');
  await expect(panel).toContainText('Used in 1 other harness');
  for (const name of ['Summarize sources', 'Web search', 'Check facts', 'Client list']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  // A press on the background clears the selection.
  await p.locator('.hx-canvas').click({ position: { x: 300, y: 20 } });
  await expect(p.getByRole('complementary')).toContainText('Nothing selected');
});

test('dragging a node moves it, the curve follows, and the place is kept in the manifest', async () => {
  const p = page();
  const writer = node('Writer');
  const before = (await writer.boundingBox())!;
  const edgeBefore = await p.locator('.hx-edge').last().getAttribute('d');
  const x = before.x + 60, y = before.y + 30;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 30, y - 60, { steps: 6 }); await p.mouse.move(x + 60, y - 120, { steps: 6 });
  const during = await p.locator('.hx-edge').evaluateAll(list => list.map(e => e.getAttribute('d')));
  await p.mouse.up();
  const after = (await writer.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(60); expect(Math.round(before.y - after.y)).toBe(120);
  expect(during.some(d => d !== edgeBefore)).toBe(true);
  // The drag did not select the node.
  await expect(writer).not.toHaveAttribute('aria-pressed', 'true');
  // The place is in the manifest: leave to the list view and come back, and the node is where it was dropped.
  const left = await writer.evaluate(el => (el as HTMLElement).style.left + '|' + (el as HTMLElement).style.top);
  await p.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(p.getByRole('heading', { level: 2, name: /^Agents/ })).toBeVisible();
  await p.getByRole('button', { name: 'Graph view', exact: true }).click();
  await expect(node('Writer')).toBeVisible();
  expect(await node('Writer').evaluate(el => (el as HTMLElement).style.left + '|' + (el as HTMLElement).style.top)).toBe(left);
  expect(left).not.toBe('48px|462px');
});

test('the arrow keys move the focused node, and zoom and fit change the view', async () => {
  const p = page();
  await node('Planner').focus();
  const before = (await node('Planner').boundingBox())!;
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown');
  const after = (await node('Planner').boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x); expect(after.y).toBeGreaterThan(before.y);
  const world = p.locator('.hx-world');
  const t0 = await world.evaluate(el => (el as HTMLElement).style.transform);
  await p.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const t1 = await world.evaluate(el => (el as HTMLElement).style.transform);
  expect(t1).not.toBe(t0);
  await p.getByRole('button', { name: 'Zoom out', exact: true }).click(); await p.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await p.getByRole('button', { name: 'Fit to window', exact: true }).click();
  expect(await world.evaluate(el => (el as HTMLElement).style.transform)).toBe(t0);
  // Panning: drag the background.
  const box = (await p.locator('.hx-canvas').boundingBox())!;
  await p.mouse.move(box.x + 330, box.y + 40); await p.mouse.down(); await p.mouse.move(box.x + 380, box.y + 90, { steps: 5 }); await p.mouse.up();
  expect(await world.evaluate(el => (el as HTMLElement).style.transform)).not.toBe(t0);
});

test('linking: press the handle of an agent, then a part; the link is saved and can be undone', async () => {
  const p = page();
  await node('Researcher').click();
  await p.getByRole('button', { name: 'Link from this agent', exact: true }).click();
  await expect(p.getByText('Pick a part to link from Researcher.')).toBeVisible();
  await expect(node('Format report')).toHaveAttribute('data-candidate', '');
  await expect(node('Web search')).not.toHaveAttribute('data-candidate', '');
  await node('Format report').click();
  await expect(p.getByText('Linked Researcher to Format report.')).toBeVisible();
  await expect(p.getByRole('complementary').getByRole('button', { name: 'Format report', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(p.getByRole('complementary').getByRole('button', { name: 'Format report', exact: true })).toHaveCount(0);
  // Escape stops linking without a link.
  await node('Researcher').click();
  await p.getByRole('button', { name: 'Link from this agent', exact: true }).click();
  await p.keyboard.press('Escape');
  await expect(p.getByText('Pick a part to link from Researcher.')).toHaveCount(0);
});

test('the keyboard can link: "Link to..." in the details, and Enter on the circle, both start linking; a part is picked with the keyboard and the link is saved', async () => {
  const p = page();
  const panel = p.getByRole('complementary');
  const canvas = p.locator('.hx-canvas');
  // Select an agent with the keyboard, press "Link to...", and pick the part that has the focus.
  await node('Researcher').focus();
  await p.keyboard.press('Enter');
  await expect(node('Researcher')).toHaveAttribute('aria-pressed', 'true');
  const linkTo = panel.getByRole('button', { name: 'Link to...', exact: true });
  await linkTo.focus();
  await p.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-linking', '');
  await expect(p.getByText('Pick a part to link from Researcher.')).toBeVisible();
  await expect(p.locator('.hx-node[data-candidate]:focus')).toHaveCount(1);
  const picked = await p.evaluate(() => document.activeElement?.querySelector('.hx-node-name')?.textContent ?? '');
  expect(picked).not.toBe('');
  await p.keyboard.press('Enter');
  await expect(p.getByText(`Linked Researcher to ${picked}.`)).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-linking', '');
  await expect(panel.getByRole('button', { name: picked, exact: true })).toBeVisible();
  // The circle on the node: Enter on it starts the link (the key does not reach the node), and the arrows do not move the node.
  await node('Writer').focus();
  await p.keyboard.press('Enter');
  await p.keyboard.press('Tab');
  const handle = p.getByRole('button', { name: 'Link from this agent', exact: true });
  await expect(handle).toBeFocused();
  const before = await node('Writer').boundingBox();
  await p.keyboard.press('ArrowRight');
  expect(await node('Writer').boundingBox()).toEqual(before);
  await p.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-linking', '');
  await expect(p.getByText('Pick a part to link from Writer.')).toBeVisible();
  const target = p.locator('.hx-node[data-candidate]').first();
  const name = (await target.locator('.hx-node-name').textContent()) ?? '';
  await target.focus();
  await p.keyboard.press('Enter');
  await expect(p.getByText(`Linked Writer to ${name}.`)).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-linking', '');
});

test('Fix opens a short sheet that says what changes, then adds the part', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Fix Translate', exact: true }).click();
  const sheet = p.getByRole('dialog', { name: 'Fix Translate' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Only the manifest changes');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(p.locator('.hx-node[data-missing]')).toHaveCount(1);
  await p.getByRole('button', { name: 'Fix Translate', exact: true }).click();
  await p.getByRole('dialog', { name: 'Fix Translate' }).getByRole('button', { name: 'Add Translate' }).click();
  await expect(p.locator('.hx-node[data-missing]')).toHaveCount(0);
  await expect(p.getByText('12 parts')).toBeVisible();
  await expect(p.getByRole('complementary').getByRole('heading', { level: 2, name: 'Translate' })).toBeVisible();
});

test('Add part opens the Library as a drawer, and Remove takes a part out without deleting its file', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Add part', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Add a part' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Add Answer a common question to Weekly report crew' }).click();
  await expect(p.getByText('12 parts')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await node('Spreadsheet').click();
  const panel = p.getByRole('complementary');
  await expect(panel).toContainText('This does not delete the file.');
  await panel.getByRole('button', { name: 'Remove from this harness' }).click();
  await expect(node('Spreadsheet')).toHaveCount(0);
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(node('Spreadsheet')).toBeVisible();
});

test('the list view groups the parts, marks the new one, and View file opens the read-only file view', async () => {
  const p = page();
  await p.getByRole('button', { name: 'List view', exact: true }).click();
  for (const group of [/^Agents 3/, /^Skills 5/, /^Tools 2/, /^Context 2/]) await expect(p.getByRole('heading', { level: 2, name: group })).toBeVisible();
  await expect(p.locator('.hx-lrow', { hasText: 'Spreadsheet' })).toContainText('New');
  await expect(p.locator('.hx-lrow[data-missing]')).toContainText('Missing. Needed.');
  await p.locator('.hx-lrow', { hasText: 'Researcher' }).getByRole('button', { name: 'Researcher', exact: true }).click();
  await p.getByRole('complementary').getByRole('button', { name: 'View file' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'researcher.md' })).toBeVisible();
  await expect(p.getByText('Read-only in this release')).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Front matter' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Raw file' })).toBeVisible();
  await expect(p.locator('.hx-raw')).toContainText('You find sources for a topic.');
  await expect(p.getByText('Summarize sources, Check facts')).toBeVisible();
});

test('a new harness is empty, and the empty state offers to add parts', async () => {
  const p = page();
  await p.getByRole('button', { name: 'New harness', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'New harness' })).toBeVisible();
  await expect(p.getByText('0 parts')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'This harness is empty' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await p.getByRole('button', { name: 'Add parts', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Add a part' })).toBeVisible();
});
