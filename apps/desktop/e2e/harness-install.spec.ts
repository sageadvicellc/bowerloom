/**
 * Projects and the install sheet in the real window (Electron started with --prototype-v3): the rows with their statuses and buttons, the three steps, the review with a conflict (Install is blocked
 * until it is settled), the install itself (the statuses change on Projects and on the Harness list, one history entry, "Installed." with Undo), and Undo in Version history. The sheet keeps one height.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { APP, fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const PROJECTS = '#prototype-v3/projects';
const HISTORY = '#prototype-v3/history';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), PROJECTS); });

const row = (p: Page, name: string): Locator => p.locator('.hxp-row', { has: p.getByRole('button', { name, exact: true }) });
const sheet = (p: Page, title = 'Install Weekly report crew'): Locator => p.getByRole('dialog', { name: title });
const go = async (p: Page, hash: string): Promise<void> => { await p.evaluate(x => { location.hash = x; }, hash); };

/** Opens the review of the bowerloom update (10 files, one conflict). */
async function openReview(p: Page): Promise<Locator> {
  await row(p, 'bowerloom').getByRole('button', { name: /^Update/ }).click();
  const s = sheet(p);
  await expect(s).toBeVisible();
  await expect(s.getByText('7 new files, 2 updates and 1 conflict', { exact: false })).toBeVisible();
  return s;
}

test('Projects shows the five rows of the design with their statuses and the button each one needs', async () => {
  const p = page();
  await expect(p.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
  await expect(p.getByText('5 projects. Each shows where a harness is installed.')).toBeVisible();
  const rows = p.locator('.hxp-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('bowerloom');
  await expect(rows.nth(0)).toContainText('Weekly report crew');
  await expect(rows.nth(0)).toContainText('~/Sage Advice/code/internal-tools/bowerloom');
  for (const words of ['Claude Code installed', 'Codex out of date', 'OpenCode not installed']) await expect(rows.nth(0)).toContainText(words);
  await expect(rows.nth(0).getByRole('button', { name: /^Update/ })).toBeVisible();
  await expect(rows.nth(1)).toContainText('Claude Code installed');
  await expect(rows.nth(1)).toContainText('Codex installed');
  await expect(rows.nth(1).getByRole('button')).toHaveCount(1);
  await expect(rows.nth(2)).toContainText('Research desk');
  await expect(rows.nth(2)).toContainText('Codex has a conflict');
  await expect(rows.nth(2).getByRole('button', { name: /^Review/ })).toBeVisible();
  await expect(rows.nth(3)).toContainText('Claude Code out of date');
  await expect(rows.nth(3).getByRole('button', { name: /^Update/ })).toBeVisible();
  await expect(rows.nth(4)).toContainText('No harness yet');
  await expect(rows.nth(4).getByRole('button', { name: 'Assign harness', exact: true })).toBeVisible();
  await expect(p.locator('.hxp-row[data-selected]')).toHaveCount(1);
  await expect(p.locator('.hxp-row[data-selected]')).toContainText('bowerloom');
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'bowerloom' })).toBeVisible();
  await expect(panel).toContainText('Saved in the project as .bowerloom/harness.json. Commit it to share the harness.');
  await expect(panel.locator('.hxp-iface')).toHaveCount(3);
  await expect(panel.locator('.hxp-iface').nth(1)).toContainText('Out of date');
  await expect(panel.getByRole('button', { name: 'Assign another harness', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Remove from project', exact: true })).toBeVisible();
  await expect(panel).toContainText('This does not delete your files. It removes only what Bowerloom wrote.');
  await shot(p, 'S6-projects');
  await p.getByRole('button', { name: 'garden', exact: true }).click();
  await expect(p.locator('.hxp-row[data-selected]')).toContainText('garden');
  await expect(panel.getByRole('heading', { level: 2, name: 'garden' })).toBeVisible();
  await expect(panel).toContainText('Caveman pack');
});

test('the review lists all 10 files grouped by interface, and a conflict blocks Install until one of its three choices is pressed', async () => {
  const p = page();
  const s = await openReview(p);
  await expect(s.locator('.hxi-file')).toHaveCount(10);
  await expect(s.locator('[data-group="claude-code"] .hxi-file')).toHaveCount(5);
  await expect(s.locator('[data-group="codex"] .hxi-file')).toHaveCount(4);
  await expect(s.locator('[data-file=".bowerloom/harness.json"]')).toContainText('New');
  await expect(s.locator('[data-file=".claude/agents/writer.md"]')).toContainText('Update');
  await expect(s.locator('[data-file=".codex/agents/writer.toml"]')).toContainText('Conflict');
  await expect(s.getByText('Bowerloom manifest. Commit this file to share the harness.')).toBeVisible();
  await expect(s.getByText('Nothing changes until you press Install. You can undo in Version history.')).toBeVisible();
  await expect(s.getByText('Conflict: .codex/agents/writer.toml already exists. Pick one.')).toBeVisible();
  const choices = s.getByRole('radio');
  await expect(choices).toHaveCount(3);
  await expect(choices.nth(0)).toContainText('Keep mine');
  await expect(choices.nth(0)).toContainText('Your file stays as it is.');
  await expect(choices.nth(1)).toContainText('Use the harness copy');
  await expect(choices.nth(1)).toContainText('Your file is replaced. Undo brings it back.');
  await expect(choices.nth(2)).toContainText('Keep both');
  await expect(choices.nth(2)).toContainText('Saves the harness copy next to yours as writer.harness.toml.');
  await expect(choices.nth(0)).toHaveAttribute('aria-checked', 'true');
  const install = s.getByRole('button', { name: 'Install 10 files', exact: true });
  await expect(install).toBeDisabled();
  await expect(s.getByText('Pick one to continue.')).toBeVisible();
  await shot(p, 'S7.3-install-review-blocked');
  await choices.nth(0).click();
  await expect(install).toBeEnabled();
  await expect(s.getByText('Settled. Keep mine.')).toBeVisible();
  await choices.nth(2).click();
  await expect(choices.nth(2)).toHaveAttribute('aria-checked', 'true');
  await expect(choices.nth(0)).toHaveAttribute('aria-checked', 'false');
  await expect(s.getByText('Settled. Keep both.')).toBeVisible();
  await choices.nth(2).press('ArrowLeft');
  await expect(choices.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(choices.nth(1)).toBeFocused();
  await choices.nth(0).click();
  await s.getByRole('button', { name: 'Show the difference', exact: true }).click();
  await expect(s.getByText('Harness copy', { exact: true })).toBeVisible();
  await expect(s.getByText('Your file', { exact: true })).toBeVisible();
  await shot(p, 'S7.3-install-review');
});

test('Install changes the statuses on Projects and on the Harness list, adds one history entry, shows "Installed. Undo", and Undo in Version history restores everything', async () => {
  const p = page();
  const s = await openReview(p);
  await s.getByRole('radio').nth(0).click();
  await s.getByRole('button', { name: 'Install 10 files', exact: true }).click();
  await expect(sheet(p)).toHaveCount(0);
  const toast = p.locator('[data-toast]');
  await expect(toast).toContainText('Installed.');
  await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  const first = row(p, 'bowerloom');
  await expect(first).toContainText('Claude Code installed');
  await expect(first).toContainText('Codex installed');
  await expect(first).not.toContainText('out of date');
  await expect(first.getByRole('button', { name: /^Update/ })).toHaveCount(0);
  await expect(p.getByRole('complementary').locator('.hxp-iface').nth(1)).toContainText('Installed');
  await go(p, APP);
  await expect(p.locator('.hx-row-harness').nth(0)).toContainText('Installed in 2 projects');
  await go(p, HISTORY);
  const entries = p.locator('.hxh-row');
  await expect(entries).toHaveCount(5);
  await expect(entries.nth(0)).toContainText('Installed Weekly report crew in bowerloom');
  await expect(entries.nth(0)).toContainText('Today');
  await expect(entries.nth(0)).toContainText('Robin · this Mac · 9 files written');
  // The older install of the same project and harness waits for the newer one.
  await expect(entries.nth(1)).toContainText('Undo the newer change first');
  await expect(entries.nth(1).getByRole('button', { name: /^Undo/ })).toBeDisabled();
  await entries.nth(0).getByRole('button', { name: /^Undo/ }).click();
  await expect(entries.nth(0)).toContainText('Undid: Installed Weekly report crew in bowerloom');
  await expect(entries.nth(1)).toContainText('Undone');
  await go(p, PROJECTS);
  await expect(row(p, 'bowerloom')).toContainText('Codex out of date');
  await expect(row(p, 'bowerloom').getByRole('button', { name: /^Update/ })).toBeVisible();
  await go(p, APP);
  await expect(p.locator('.hx-row-harness').nth(0)).toContainText('Needs an update in 1 of 2 projects');
});

test('the Undo in the note after an install puts the old statuses back', async () => {
  const p = page();
  const s = await openReview(p);
  await s.getByRole('radio').nth(1).click();
  await s.getByRole('button', { name: 'Install 10 files', exact: true }).click();
  await expect(row(p, 'bowerloom')).not.toContainText('Codex out of date');
  await p.locator('[data-toast]').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(p.locator('[data-toast]')).toHaveCount(0);
  await expect(row(p, 'bowerloom')).toContainText('Codex out of date');
  await go(p, HISTORY);
  await expect(p.locator('.hxh-row').nth(0)).toContainText('Undid: Installed Weekly report crew in bowerloom');
});

test('Assign to project walks the three steps at one sheet height: pick the folder, tick the interfaces, review; Back and Escape work', async () => {
  const p = page();
  await go(p, APP);
  await p.getByRole('button', { name: 'Assign to project', exact: true }).click();
  const s = sheet(p);
  await expect(s).toBeVisible();
  await expect(s.getByText('Pick the folder to install into.')).toBeVisible();
  const cards = s.locator('.hxi-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(0)).toContainText('~/Sage Advice/code/internal-tools/bowerloom');
  await expect(s.getByRole('button', { name: 'Add a folder', exact: true })).toBeVisible();
  const heights: number[] = [];
  const height = async (): Promise<number> => Math.round((await s.boundingBox())!.height);
  heights.push(await height());
  await shot(p, 'S7.1-install-project');
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await cards.nth(0).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByText('Each interface gets its own files. Pick the ones to install for.')).toBeVisible();
  const boxes = s.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toBeChecked(); await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(2)).not.toBeChecked(); await expect(boxes.nth(2)).toBeDisabled();
  await expect(s).toContainText('Found. Uses all 11 parts.');
  await expect(s).toContainText('Found. Cannot use 1 tool: Spreadsheet.');
  await expect(s).toContainText('Found. Its config file has a problem, so it is off.');
  heights.push(await height());
  await shot(p, 'S7.2-install-interfaces');
  await boxes.nth(1).uncheck();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('.hxi-file')).toHaveCount(6);
  await expect(s.locator('[data-group="codex"]')).toHaveCount(0);
  await expect(s.getByRole('radio')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Install 6 files', exact: true })).toBeEnabled();
  heights.push(await height());
  expect(new Set(heights).size, `heights ${heights.join(', ')}`).toBe(1);
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(s.getByRole('checkbox').nth(1)).not.toBeChecked();
  await s.getByRole('checkbox').nth(1).check();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(s.getByText('Pick the folder to install into.')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(sheet(p)).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Assign to project', exact: true })).toBeFocused();
});

test('Assign harness on a project with none asks for the harness, then installs it: the row and the Harness list agree', async () => {
  const p = page();
  await row(p, 'archive').getByRole('button', { name: 'Assign harness', exact: true }).click();
  const s = sheet(p, 'Install a harness');
  await expect(s).toBeVisible();
  await expect(s.getByText('Pick the harness to install.')).toBeVisible();
  await expect(s.locator('.hxi-card')).toHaveCount(4);
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await s.locator('.hxi-card', { hasText: 'Inbox helper' }).click();
  const named = sheet(p, 'Install Inbox helper');
  await expect(named).toBeVisible();
  await named.getByRole('button', { name: 'Next', exact: true }).click();
  await named.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(named.locator('.hxi-file').first()).toContainText('.bowerloom/harness.json');
  await expect(named.getByRole('radio')).toHaveCount(0);
  await named.getByRole('button', { name: /^Install \d+ files$/ }).click();
  await expect(sheet(p, 'Install Inbox helper')).toHaveCount(0);
  await expect(row(p, 'archive')).toContainText('Inbox helper');
  await expect(row(p, 'archive')).toContainText('Claude Code installed');
  await expect(row(p, 'archive')).toContainText('Codex installed');
  await go(p, APP);
  await expect(p.locator('.hx-row-harness', { hasText: 'Inbox helper' })).toContainText('Installed in 1 project');
});

test('the details buttons of a project open the review for Update and Review, and Remove from project takes the harness away and can be undone', async () => {
  const p = page();
  await p.getByRole('complementary').getByRole('button', { name: 'Update Codex', exact: true }).click();
  await expect(sheet(p).getByText('7 new files, 2 updates and 1 conflict', { exact: false })).toBeVisible();
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'notes', exact: true }).click();
  await p.getByRole('complementary').getByRole('button', { name: 'Review Codex', exact: true }).click();
  await expect(sheet(p, 'Install Research desk')).toBeVisible();
  await expect(sheet(p, 'Install Research desk').locator('[data-conflict]')).toHaveCount(1);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'site-redesign', exact: true }).click();
  await p.getByRole('complementary').getByRole('button', { name: 'Remove from project', exact: true }).click();
  await expect(p.locator('[data-toast]')).toContainText('Removed Weekly report crew.');
  await expect(row(p, 'site-redesign')).toContainText('No harness yet');
  await p.locator('[data-toast]').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row(p, 'site-redesign')).toContainText('Codex installed');
});

test('Interfaces: a switch decides whether an interface is offered in the install sheet, and the change is in Version history', async () => {
  const p = page();
  await go(p, '#prototype-v3/interfaces');
  await expect(p.getByRole('heading', { level: 1, name: 'Interfaces', exact: true })).toBeVisible();
  await expect(p.getByText('3 interfaces. Bowerloom installs only for the ones that are switched on.')).toBeVisible();
  const rows = p.locator('.hxn-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Found at ~/.claude');
  await expect(rows.nth(1)).toContainText('Found at ~/.codex and ~/.agents');
  await expect(rows.nth(2)).toContainText('Config file has a problem');
  const switches = p.getByRole('switch');
  await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(switches.nth(2)).toHaveAttribute('aria-checked', 'false');
  await rows.nth(1).getByRole('button', { name: 'Codex', exact: true }).click();
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'Codex' })).toBeVisible();
  await expect(panel).toContainText('.codex/agents/<name>.toml');
  await expect(panel).toContainText('.agents/skills/<name>/SKILL.md');
  await expect(panel).toContainText('Tools that only Claude Code supports. The install sheet names each one.');
  await panel.getByRole('button', { name: 'Look again', exact: true }).click();
  await expect(panel).toContainText('Looked again. Nothing changed.');
  await shot(p, 'S10-interfaces');
  await switches.nth(1).click();
  await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'false');
  await go(p, PROJECTS);
  await p.getByRole('complementary').getByRole('button', { name: 'Assign another harness', exact: true }).click();
  const s = sheet(p, 'Install a harness');
  await s.locator('.hxi-card', { hasText: 'Weekly report crew' }).click();
  const named = sheet(p);
  await named.getByRole('button', { name: 'Next', exact: true }).click();
  const boxes = named.getByRole('checkbox');
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(named).toContainText('Found. Switched off in Interfaces.');
  await expect(boxes.nth(0)).toBeChecked();
  await p.keyboard.press('Escape');
  await go(p, HISTORY);
  await expect(p.locator('.hxh-row').nth(0)).toContainText('Turned off Codex');
  await p.locator('.hxh-row').nth(0).getByRole('button', { name: /^Undo/ }).click();
  await go(p, '#prototype-v3/interfaces');
  await expect(p.getByRole('switch').nth(1)).toHaveAttribute('aria-checked', 'true');
});

test('Version history lists the sample entries newest first, grouped by day, each with its words and Undo', async () => {
  const p = page();
  await go(p, HISTORY);
  await expect(p.getByRole('heading', { level: 1, name: 'Version history', exact: true })).toBeVisible();
  await expect(p.getByText('Newest first. Undo puts back what the change replaced.')).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Yesterday', exact: true })).toBeVisible();
  const rows = p.locator('.hxh-row');
  await expect(rows).toHaveCount(4);
  // The first two are minutes old (Today, or Yesterday just after midnight); the other two are from the day before.
  await expect(rows.nth(0)).toContainText('Installed Weekly report crew in bowerloom');
  await expect(rows.nth(0)).toContainText(/(Today|Yesterday) \d\d:\d\d · Robin · this Mac · 10 files written/);
  await expect(rows.nth(1)).toContainText(/(Today|Yesterday) \d\d:\d\d · Robin · this Mac · manifest changed/);
  await expect(rows.nth(2)).toContainText('Yesterday 16:30 · Robin · this Mac · manifest changed');
  await expect(rows.nth(3)).toContainText('Yesterday 16:02 · Robin · this Mac · manifest created');
  await expect(p.getByRole('button', { name: /^Undo/ })).toHaveCount(4);
  // The newest change of a harness goes first: the link and the harness wait for the part that was added after them.
  await expect(rows.nth(0).getByRole('button', { name: /^Undo/ })).toBeEnabled();
  await expect(rows.nth(1).getByRole('button', { name: /^Undo/ })).toBeEnabled();
  for (const n of [2, 3]) { await expect(rows.nth(n).getByRole('button', { name: /^Undo/ })).toBeDisabled(); await expect(rows.nth(n)).toContainText('Undo the newer change first'); }
  await shot(p, 'S11-version-history');
  await rows.nth(1).getByRole('button', { name: /^Undo/ }).click();
  await expect(rows.nth(0)).toContainText('Undid: Added Spreadsheet to Weekly report crew');
  await expect(rows.nth(2)).toContainText('Undone');
  await expect(rows.nth(2).getByRole('button')).toHaveCount(0);
  await expect(rows.nth(0).getByRole('button')).toHaveCount(0);
  await expect(rows.nth(2)).toBeFocused();
});
