/**
 * The Harness list (S2) in the real window (Electron started with --prototype-v3): the four rows with the statuses of the design, selecting a row fills the details column,
 * and "Start" and the play button open the start sheet. Escape closes a sheet. There is no bridge to the computer.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { APP, WEEKLY, fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), APP); });

test('it opens on four rows with the statuses of the design, and no bridge', async () => {
  const p = page();
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  const rows = p.locator('.hx-row-harness');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Needs an update in 1 of 2 projects');
  await expect(rows.nth(1)).toContainText('Out of date in 1 project');
  await expect(rows.nth(2)).toContainText('Not installed');
  await expect(rows.nth(3)).toContainText('Conflict in 1 project');
  await expect(rows.nth(0)).toContainText('3 agents · 5 skills · 2 tools · 2 context');
  await expect(p.locator('.hx-row[data-selected]')).toHaveCount(1);
});

test('selecting a row fills the details, and a selected row is a highlight with no tick', async () => {
  const p = page();
  await p.locator('.hx-row-harness', { hasText: 'Caveman pack' }).getByRole('button', { name: 'Caveman pack', exact: true }).click();
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'Caveman pack' })).toBeVisible();
  await expect(panel).toContainText('garden');
  await expect(panel).toContainText('Claude Code out of date');
  await expect(p.locator('.hx-row[data-selected]')).toHaveCount(1);
  await expect(p.locator('.hx-row[data-selected]')).toContainText('Caveman pack');
  await p.locator('.hx-row-harness', { hasText: 'Weekly report crew' }).getByRole('button', { name: 'Weekly report crew', exact: true }).click();
  await expect(panel).toContainText('site-redesign');
  await expect(panel).toContainText('All installed');
});

test('Start in the details and the play button of a row open the start sheet; Escape closes it and gives the focus back', async () => {
  const p = page();
  await p.getByRole('complementary').getByRole('button', { name: 'Start', exact: true }).click();
  const sheet = p.getByRole('dialog', { name: 'Start Weekly report crew' });
  await expect(sheet).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(p.getByRole('complementary').getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await p.getByRole('button', { name: 'Start Research desk', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Start Research desk' })).toBeVisible();
  await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(p.getByRole('dialog')).toHaveCount(0);
});

test('Assign to project opens the install sheet; Open in builder on a sample harness says why and opens "From a folder"; a folder opens the Builder', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Assign to project', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Install Weekly report crew' })).toBeVisible();
  await p.keyboard.press('Escape');
  // The Builder edits one folder's harness, so a harness of the sample world opens the sheet that makes one from a folder.
  await p.getByRole('complementary').getByRole('button', { name: 'Open in builder', exact: true }).click();
  await expect(p.getByText('Each folder holds one harness. Make a new one from a folder.')).toBeVisible();
  await expect(p.getByRole('dialog', { name: 'New harness from a folder' })).toBeVisible();
  await p.keyboard.press('Escape');
  await p.locator('[data-section="folders"]').getByRole('button', { name: 'Open weekly-report in the builder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'weekly-report' })).toBeVisible();
  await expect(p.locator('[data-draft]')).toContainText('No change yet.');
});

test('Cmd or Ctrl+B puts the navigation away to a rail and brings it back', async () => {
  const p = page();
  const nav = p.locator('nav.hm-nav');
  await expect(nav).toHaveAttribute('data-mode', 'open');
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  await expect(nav).toHaveAttribute('data-mode', 'rail');
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  await expect(nav).toHaveAttribute('data-mode', 'open');
  await p.getByRole('button', { name: 'About this preview' }).click();
  await expect(p.getByText('Nothing is written to your disk.')).toBeVisible();
  await expect(p.getByText('Not in this preview')).toBeVisible();
});

const hash = (p: Page): Promise<string> => p.evaluate(() => location.hash);

test('picking a row goes to the address of that harness, so the address and the details agree, also after "Make a harness" opened another one', async () => {
  const p = page();
  const panel = p.getByRole('complementary');
  await p.evaluate(id => { location.hash = `#prototype-v3/harnesses/${id}`; }, 'harness-research-desk');
  await expect(panel.getByRole('heading', { level: 2, name: 'Research desk' })).toBeVisible();
  await p.locator('.hx-row-harness', { hasText: 'Caveman pack' }).getByRole('button', { name: 'Caveman pack', exact: true }).click();
  expect(await hash(p)).toBe('#prototype-v3/harnesses/harness-caveman-pack');
  await expect(panel.getByRole('heading', { level: 2, name: 'Caveman pack' })).toBeVisible();
  await expect(p.locator('.hx-row[data-selected]')).toContainText('Caveman pack');
  // The play button starts the harness of its row, and the details show that harness.
  await p.getByRole('button', { name: 'Start Inbox helper', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Start Inbox helper' })).toBeVisible();
  expect(await hash(p)).toBe('#prototype-v3/harnesses/harness-inbox-helper');
  await p.keyboard.press('Escape');
  await expect(panel.getByRole('heading', { level: 2, name: 'Inbox helper' })).toBeVisible();
  await expect(p.locator('.hx-row[data-selected]')).toContainText('Inbox helper');
  await p.getByRole('complementary').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Start Inbox helper' })).toBeVisible();
});

test('an address that names nothing says so, and does not show the first item', async () => {
  const p = page();
  for (const [route, words, back] of [
    ['harnesses/harness-nope', 'That harness is not here.', 'Harnesses'], ['runs/run-nope', 'That run is not here.', 'Runs'],
    ['projects/project-nope', 'That project is not here.', 'Projects'], ['library/skill/skill-nope', 'That part is not here.', 'Library'],
  ] as const) {
    await fresh(p, `#prototype-v3/${route}`);
    await expect(p.getByText(words)).toBeVisible();
    await expect(p.getByRole('complementary')).toHaveCount(0);
    await expect(p.locator('.hx-row')).toHaveCount(0);
    await p.locator('main').getByRole('button', { name: back, exact: true }).click();
    await expect(p.locator('.hx-row').first()).toBeVisible();
  }
  await fresh(p, `#prototype-v3/harnesses/${WEEKLY}`);
  await expect(p.getByRole('complementary').getByRole('heading', { level: 2, name: 'Weekly report crew' })).toBeVisible();
});

test('a button that is not in the preview says so when it is pressed', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/projects');
  // The buttons are marked aria-disabled (they stay in the tab order and say so), which Playwright treats as off; a real press is forced.
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click({ force: true });
  await expect(p.locator('[data-toast]')).toContainText('Not in this preview.');
  await fresh(p, '#prototype-v3/library/skill');
  await p.getByRole('button', { name: 'Add', exact: true }).click({ force: true });
  await expect(p.locator('[data-toast]')).toContainText('Not in this preview.');
});

test('the Start button says why it is off, beside it', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Start Inbox helper', exact: true }).click();
  const sheet = p.getByRole('dialog', { name: 'Start Inbox helper' });
  const start = sheet.getByRole('button', { name: /^Review and start/ });
  await expect(start).toBeDisabled();
  await expect(sheet.getByText('Write an instruction to start.')).toBeVisible();
  await shot(p, 'start-why');
  await sheet.getByRole('textbox', { name: 'Instruction' }).fill('Sort the inbox.');
  await expect(sheet.getByText('Write an instruction to start.')).toHaveCount(0);
  await expect(start).toBeEnabled();
  await sheet.locator('[data-iface="claude-code"] input').uncheck();
  await expect(sheet.getByText('Tick an interface to start.')).toBeVisible();
  await expect(start).toBeDisabled();
});

test('Tab stays inside a sheet after a press on its padding, the page behind it cannot be reached, and closing frees it again', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Start Research desk', exact: true }).click();
  const dialog = p.getByRole('dialog', { name: 'Start Research desk' });
  await expect(dialog).toBeVisible();
  const inside = (): Promise<boolean> => p.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null);
  await expect(p.locator('nav.hm-nav')).toHaveAttribute('inert', '');
  await expect(p.locator('.hm-col')).toHaveAttribute('inert', '');
  const box = (await dialog.boundingBox())!;
  await p.mouse.click(box.x + 4, box.y + 4);
  for (let n = 0; n < 14; n += 1) { await p.keyboard.press('Tab'); expect(await inside(), `Tab ${n + 1}`).toBe(true); }
  await p.mouse.click(box.x + 4, box.y + 4);
  for (let n = 0; n < 14; n += 1) { await p.keyboard.press('Shift+Tab'); expect(await inside(), `Shift+Tab ${n + 1}`).toBe(true); }
  // A press on the page behind lands on the sheet's scrim, which closes the sheet; the page itself is never the target.
  await p.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(p.locator('nav.hm-nav')).not.toHaveAttribute('inert', '');
  await expect(p.locator('.hm-col')).not.toHaveAttribute('inert', '');
  await expect(p.getByRole('button', { name: 'Start Research desk', exact: true })).toBeFocused();
});
