/**
 * Start from a harness of the list, on the person's own folders (windows hidden). A harness there is made from a scan and has no project folder, so the Start sheet must not pick a
 * folder for the person: it says so in plain words, shows "Choose a project", and keeps the button off until a project is chosen. It never falls back to another folder.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { teamFolder } from '../tests/helpers-engine/folders.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs } from './temp-dirs.js';

let fixture: ShellHome, h: RealHarness;
const page = (): Page => h.page;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  fixture = buildShellHome();
  h = await launchReal(fixture.home);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterAll(async () => { try { await h?.app.close(); } finally { fixture?.cleanup(); removeTempDirs(); } });

test('a harness made from a scan has no folder: Start asks for the project, picks none, and keeps the button off until one is chosen', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#app/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await h.pick(fixture.orchard);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.locator('.hxf-card').filter({ hasText: 'apple-row' })).toHaveCount(1);
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.locator('.hxf-card', { hasText: 'Your Claude Code folder' }).getByRole('button', { name: 'Make a harness from this' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
  await p.locator('[data-nav-key="harnesses"]').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  // One project folder with a harness is registered. It must not be chosen for the person.
  await h.pick(teamFolder(fixture.home));
  await p.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(p.locator('[data-folder-row]')).toHaveCount(1);
  await p.getByRole('button', { name: 'Start', exact: true }).click();
  const sheet = p.locator('[data-slot="start"]');
  await expect(sheet.getByRole('heading', { name: 'Start in a project', exact: true })).toBeVisible();
  await expect(sheet.locator('[data-start-harness]')).toHaveText('This harness is not in a project folder. Choose the project to start in.');
  await expect(sheet.locator('#hs-project')).toHaveValue('');
  await expect(sheet.locator('#hs-project option').first()).toHaveText('Choose a project');
  await expect(sheet.locator('[data-engine]')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Show the command', exact: true })).toBeDisabled();
  await expect(sheet).toContainText('Choose a project that has a harness.');
  await sheet.locator('#hs-project').selectOption({ label: 'team' });
  await expect(sheet.locator('[data-engine]')).toHaveCount(2);
  await expect(sheet.locator('[data-start-harness]')).toHaveCount(0);
  await p.keyboard.press('Escape');
});
