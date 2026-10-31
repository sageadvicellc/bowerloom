/**
 * A file path is out of sight until "Show details" is pressed (Library, Projects, File view), by one shared disclosure. The button is a real button: Enter and Space open and close it,
 * the focus stays on it, aria-expanded and aria-controls follow it, and its name says what it opens. The sample launch (--prototype-v3) is used: it has parts and projects with paths.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); });

/** The disclosure must keep a closed path out of the page for sight and for a screen reader, and show it after the press. */
async function exercise(p: Page, box: Locator, pathText: RegExp): Promise<void> {
  const button = box.locator('[data-path-disclosure] > button').first();
  await expect(button).toHaveAccessibleName(/^Show details for /);
  await expect(button).toHaveText('Show details');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  const controls = (await button.getAttribute('aria-controls'))!;
  const target = p.locator(`[id="${controls}"]`);
  await expect(target, 'aria-controls names an element that is in the page').toHaveCount(1);
  await expect(target).toBeHidden();
  await expect(box.getByText(pathText)).toBeHidden();
  // Enter opens it, and the focus stays on the button.
  await button.focus(); await p.keyboard.press('Enter');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toHaveAccessibleName(/^Hide details for /); await expect(button).toHaveText('Hide details');
  await expect(target).toBeVisible(); await expect(target).toHaveText(pathText);
  // Space closes it.
  await p.keyboard.press('Space');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(target).toBeHidden();
  // A press opens it again, and a long path wraps: the column does not scroll sideways.
  await button.click(); await expect(target).toBeVisible();
  expect(await p.evaluate(() => { const m = document.querySelector('main'); return m === null ? 0 : m.scrollWidth - m.clientWidth; })).toBeLessThanOrEqual(1);
}

test('Library: the path of the picked part is behind "Show details"', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/library/skill');
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 3, name: 'File', exact: true })).toBeVisible();
  expect(await p.evaluate(() => document.body.innerText), 'a closed path is not in the text a person sees').not.toMatch(/skills\/[a-z-]+\/SKILL\.md/);
  await exercise(p, panel, /^skills\/[a-z-]+\/SKILL\.md$/);
});

test('Projects: the path of each project is behind "Show details", in the row and in the details column', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/projects');
  await expect(p.locator('.hxp-row').first().locator('[data-path-disclosure]')).toHaveCount(1);
  expect(await p.evaluate(() => document.body.innerText), 'a closed path is not in the text a person sees').not.toMatch(/~\/|\/Users\//);
  await exercise(p, p.locator('.hxp-row').first(), /~\/|\/Users\//);
  await exercise(p, p.getByRole('complementary'), /~\/|\/Users\//);
});

test('File view: the path is behind "Show details" and the title is the file name', async () => {
  const p = page();
  await fresh(p, '#prototype-v3/library/skill');
  const id = (await p.locator('[data-part]').first().getAttribute('data-part'))!;
  await fresh(p, `#prototype-v3/file/${id}`);
  await expect(p.getByRole('heading', { level: 1, name: 'SKILL.md' })).toBeVisible();
  await expect(p.getByText('Read-only', { exact: true })).toBeVisible();
  await expect(p.getByText('Read-only in this release')).toHaveCount(0);
  await exercise(p, p.locator('[data-screen="file"] .hx-file'), /^skills\/[a-z-]+\/SKILL\.md$/);
});
