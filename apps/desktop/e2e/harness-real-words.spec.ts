/**
 * The words of the harness-first preview on the person's own folders (Electron started with --prototype-v3-real and HOME pointed at a made-up folder). The owner's rules: real mode says "Beta";
 * a feature that is truly absent says "Not in beta.1"; the app never claims that a blocked feature works; and "Install history" is the install undo list.
 * Walk: Welcome, Runs, Help, Projects, Library and Install history, after a read. No screen may say that a run starts ("Press Start"), that a harness runs in any engine, or that an install is undone in Install history.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs } from './temp-dirs.js';

let fixture: ShellHome, h: RealHarness;
const page = (): Page => h.page;
const text = (): Promise<string> => page().locator('body').innerText();

/** What no screen of this mode may say, because the thing it says is blocked or has no list. */
const FALSE_CLAIMS = /Press Start|press Install|run it in any engine|undo an install in Install history|You can undo in Install history|Newest first\. Undo puts back/i;
async function noFalseClaim(label: string): Promise<void> {
  expect(await text(), `${label}: a claim that a blocked feature works`).not.toMatch(FALSE_CLAIMS);
}
const go = async (hash: string): Promise<void> => { await page().evaluate(to => { location.hash = to; }, hash); };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  fixture = buildShellHome();
  h = await launchReal(fixture.home);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterAll(async () => { try { await h?.app.close(); } finally { fixture?.cleanup(); removeTempDirs(); } });

test.beforeEach(async () => {
  // Every run starts from Welcome with nothing read.
  await page().evaluate(() => { location.hash = '#prototype-v3-real'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
  await h.pick(null);
});

test('real mode words: Welcome, Runs, Help, Projects, Library, Install history and the Beta mark', async () => {
  const p = page();
  await test.step('Welcome says that running is not in beta.1, and keeps "Find my files"', async () => {
    await expect(p.getByRole('heading', { level: 1, name: 'Bowerloom', exact: true })).toBeVisible();
    await expect(p.getByText('Build a harness from your agents and skills.')).toBeVisible();
    await expect(p.getByText('Running one is not in beta.1.')).toBeVisible();
    await noFalseClaim('welcome');
    await expect(p.getByRole('button', { name: 'Find my files', exact: true })).toBeVisible();
  });
  await test.step('Help: the lines about running and about undo say what is true in this mode', async () => {
    await go('#prototype-v3/help');
    await expect(p.getByRole('heading', { level: 1, name: 'Help', exact: true })).toBeVisible();
    await expect(p.getByText('Build one from your agents and skills. Running one is not in beta.1.')).toBeVisible();
    await expect(p.getByText('Bowerloom only reads until you approve a write. To undo a folder install, press Undo, then approve the removal.')).toBeVisible();
    await noFalseClaim('help');
  });
  await test.step('Runs: an empty list says runs are not in beta.1, and does not point to Start', async () => {
    await go('#prototype-v3/runs');
    await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
    await expect(p.getByText('Runs are not in beta.1.')).toBeVisible();
    await expect(p.getByText('No runs yet. Press Start on a harness.')).toHaveCount(0);
    await noFalseClaim('runs');
  });
  await test.step('Install history: with nothing installed, the list says nothing is listed and how to undo a folder install', async () => {
    await go('#prototype-v3/history');
    await expect(p.getByRole('heading', { level: 1, name: 'Install history', exact: true })).toBeVisible();
    await expect(p.getByText('Nothing is listed yet. Installs from Projects are not in beta.1.')).toBeVisible();
    await expect(p.getByText('To undo a folder install, press Undo, then approve the removal.')).toBeVisible();
    await noFalseClaim('history');
  });
  await go('#prototype-v3/choose');
  await test.step('read the folders (with a picked folder, so Projects has a row) and open the app', async () => {
    await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
    await h.pick(fixture.orchard);
    await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
    await expect(p.locator('.hxf-card').filter({ hasText: 'apple-row' })).toHaveCount(1);
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
    await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
    await p.locator('.hxf-card', { hasText: 'Your Claude Code folder' }).getByRole('button', { name: 'Make a harness from this' }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  });
  await test.step('Projects: "Add a folder" and "Assign harness" say "Not in beta.1", and Install from a folder is still there', async () => {
    await go('#prototype-v3/projects');
    await expect(p.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
    await expect(p.locator('.hxp-row').filter({ hasText: 'apple-row' })).toHaveCount(1);
    const add = p.getByRole('button', { name: 'Add a folder', exact: true });
    await expect(add).toHaveAccessibleDescription('Not in beta.1.');
    // The button is aria-disabled (so a screen reader says it is off) but still takes a press that shows the note; Playwright counts aria-disabled as not enabled.
    await add.click({ force: true });
    await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
    await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
    await p.locator('.hxp-row').filter({ hasText: 'apple-row' }).getByRole('button', { name: 'Assign harness', exact: true }).click();
    await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
    await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Install from a folder', exact: true })).toBeVisible();
    await noFalseClaim('projects');
  });
  await test.step('Library: "Add" says "Not in beta.1"', async () => {
    await go('#prototype-v3/library/skill');
    await expect(p.getByRole('heading', { level: 1, name: 'Library', exact: true })).toBeVisible();
    const add = p.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toHaveAccessibleDescription('Not in beta.1.');
    // The button is aria-disabled (so a screen reader says it is off) but still takes a press that shows the note; Playwright counts aria-disabled as not enabled.
    await add.click({ force: true });
    await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
    await noFalseClaim('library');
  });
  await test.step('Install history: after a harness is made from a scan, the list holds it with Undo, and says only what is true', async () => {
    await go('#prototype-v3/history');
    await expect(p.getByRole('heading', { level: 1, name: 'Install history', exact: true })).toBeVisible();
    await expect(p.getByText('Newest first. Undo puts back what the change replaced.')).toBeVisible();
    await expect(p.getByRole('button', { name: /^Undo Made .* from a scan$/ })).toBeVisible();
    await expect(p.getByText('Nothing is listed yet.')).toHaveCount(0);
  });
  await test.step('the Beta mark lists every blocked control, and no line could mean Install from a folder', async () => {
    await go('#prototype-v3/harnesses');
    await p.getByRole('button', { name: 'About this beta', exact: true }).click();
    const lines = await p.locator('.hx-preview-pop li').allInnerTexts();
    expect(lines).toEqual(['Start', 'Compare', 'Runs', 'Assign to project, in the Harnesses details', 'Assign harness, Install, Update and Review, in Projects', 'Add (the plus button), in the Library', 'Add a folder, in Projects']);
    for (const line of lines) expect(line).not.toMatch(/from a folder/i);
    await p.keyboard.press('Escape');
  });
});
