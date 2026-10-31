/**
 * Launches the real app, in sample-data mode, and looks at every screen at 1100 by 760 in light and dark. Screenshots go
 * to apps/desktop/screenshots. Also checks the window's security from the inside.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTempDirs, tempDir } from './proto-temp.js';

// Every folder this file made in the temp folder goes when its tests are done, also when one failed.
test.afterAll(() => { removeTempDirs(); });

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });

async function launch(args: string[], extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = tempDir('bowerloom-viewer-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, ...args, `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

async function snap(page: Page, name: string, theme: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `${name}-${theme}.png`), scale: 'css' });
}
const nav = (page: Page, label: string) => page.locator('nav.nav').getByRole('button', { name: label });

test('welcome screen offers the two choices', async () => {
  const { app, page } = await launch([]);
  try {
    await expect(page.getByRole('heading', { name: 'See everything Bowerloom looks after' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Look at my Bowerloom' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try it with sample data' })).toBeVisible();
    await snap(page, '00-welcome', 'light');
    await page.getByRole('button', { name: 'Try it with sample data' }).click();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  } finally { await app.close(); }
});

test('security: the window is locked down', async () => {
  const { app, page } = await launch(['--sample-data']);
  try {
    const prefs = await app.evaluate(({ BrowserWindow }) => { const p = (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences(); return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity, webviewTag: p.webviewTag }; });
    expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });
    expect(await page.evaluate(() => [typeof (globalThis as { require?: unknown }).require, typeof (globalThis as { process?: unknown }).process, typeof (globalThis as { Buffer?: unknown }).Buffer])).toEqual(['undefined', 'undefined', 'undefined']);
    const names = await page.evaluate(() => Object.keys((window as unknown as { bowerloom: object }).bowerloom).sort());
    expect(names).toEqual(['addRoot', 'checkForUpdates', 'chooseMode', 'copyText', 'deleteSketch', 'getFileText', 'getInfo', 'getItemContent', 'getKnowledgeGraph', 'getPageText', 'getSettings', 'getSnapshot', 'listSketches', 'loadSketch', 'openLink', 'removeRoot', 'saveSketch', 'setIncludeExamples', 'setMapLayout', 'setRole', 'setTheme']);
    // An inline script is refused by the policy.
    const blocked = await page.evaluate(() => new Promise<boolean>(resolve => {
      document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
      const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.append(s);
      setTimeout(() => resolve((window as unknown as { __ran?: boolean }).__ran !== true), 500);
    }));
    expect(blocked).toBe(true);
    // Navigation and new windows to the outside are refused.
    const before = page.url();
    await page.evaluate(() => { window.open('https://example.com/'); });
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    expect(app.windows().length).toBe(1);
    // A link that is not on the allowlist is refused by the main process.
    expect(await page.evaluate(() => (window as unknown as { bowerloom: { openLink(u: string): Promise<boolean> } }).bowerloom.openLink('https://example.com/'))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { bowerloom: { openLink(u: string): Promise<boolean> } }).bowerloom.openLink('file:///etc/passwd'))).toBe(false);
    // The page asks for another item with a path trick; it gets a refusal, not a file.
    const trick = await page.evaluate(() => (window as unknown as { bowerloom: { getItemContent(r: unknown): Promise<{ files: unknown[]; note: string | null }> } }).bowerloom.getItemContent({ kind: 'skill', id: '../../etc/passwd', projectKey: null }));
    expect(trick.files).toEqual([]);
    // The page asks for a page of a store that was never listed, or for a graph of the whole disk; it gets a refusal.
    const evil = await page.evaluate(async () => { const b = (window as unknown as { bowerloom: { getPageText(r: unknown): Promise<{ text: string | null }>; getKnowledgeGraph(k: string): Promise<{ ok: boolean }> } }).bowerloom; return { page: (await b.getPageText({ storeKey: '/', page: 'etc/passwd.md' })).text, graph: (await b.getKnowledgeGraph('/')).ok }; });
    expect(evil).toEqual({ page: null, graph: false });
  } finally { await app.close(); }
});

for (const theme of ['light', 'dark'] as const) {
  test(`every screen in ${theme}`, async () => {
    const { app, page } = await launch(['--sample-data']);
    try {
      await nav(page, 'Settings').click();
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      await nav(page, 'Home').click();
      await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
      await snap(page, '01-home', theme);

      await nav(page, 'Library').click();
      await snap(page, '02-library-skills', theme);
      await page.getByRole('tab', { name: /Prompts/ }).click();
      await snap(page, '03-library-prompts', theme);
      await page.getByRole('tab', { name: /Teams/ }).click();
      await snap(page, '04-library-teams', theme);
      await page.getByRole('tab', { name: /Skills/ }).click();
      await page.getByRole('button', { name: /Brand voice/ }).click();
      await expect(page.getByRole('heading', { name: 'Brand voice' })).toBeVisible();
      await snap(page, '05-item-pinned-skill', theme);
      await page.getByRole('button', { name: /Back/ }).click();
      await page.getByRole('button', { name: /House style/ }).click();
      await expect(page.getByText('Write in short sentences')).toBeVisible();
      await snap(page, '06-item-skill', theme);

      await nav(page, 'Projects').click();
      await snap(page, '07-projects', theme);
      await page.getByRole('button', { name: /studio-site/ }).click();
      await expect(page.locator('h1', { hasText: 'studio-site' })).toBeVisible();
      await snap(page, '08-project-healthy', theme);
      await page.getByRole('heading', { name: /Reading lists/ }).scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('main')!.scrollBy(0, 120));
      await expect(page.getByText('This project may show the title of each file from this folder.')).toBeVisible();
      await snap(page, '08b-project-live-heading-and-frontmatter', theme);
      await nav(page, 'Projects').click();
      await page.getByRole('button', { name: /newsletter/ }).click();
      await expect(page.getByText('What is different, and why')).toBeVisible();
      await snap(page, '09-project-drifted', theme);
      await page.getByRole('heading', { name: /Reading lists/ }).scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('main')!.scrollBy(0, 250));
      await snap(page, '09b-project-held-not-allowed', theme);
      await page.locator('.card.slice .warning', { hasText: 'An older permission without a style needs to be set again.' }).scrollIntoViewIfNeeded();
      await snap(page, '09c-project-held-older-permission', theme);
      await page.locator('.card.slice .warning', { hasText: 'too big to load at the start' }).scrollIntoViewIfNeeded();
      await snap(page, '09e-project-held-too-large', theme);
      await page.getByText('A folder permission holds one style per project, so only one of these can be live.').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('main')!.scrollBy(0, 150));
      await snap(page, '09d-project-conflict-side-by-side', theme);
      await page.getByRole('button', { name: 'Show the raw files' }).click();
      await expect(page.locator('.file-name', { hasText: 'bowerloom.json' }).first()).toBeVisible();
      await page.locator('.file-name', { hasText: 'bowerloom.json' }).first().scrollIntoViewIfNeeded();
      await snap(page, '10-project-raw-files', theme);
      await nav(page, 'Projects').click();
      await page.getByRole('button', { name: /old-archive/ }).click();
      await expect(page.getByText('The lock file cannot be read').first()).toBeVisible();
      await snap(page, '11-project-bad-lock', theme);

      await nav(page, 'Projects').click();
      await page.getByRole('button', { name: /studio-office/ }).click();
      await expect(page.getByText('Set up the older way (a .bowerloom folder). The shared library from beta.3 is not used here yet.')).toBeVisible();
      await snap(page, '11b-project-older-way', theme);
      await page.getByRole('button', { name: /First team \(team\)/ }).click();
      await expect(page.getByRole('heading', { name: 'First team' })).toBeVisible();
      await snap(page, '11c-older-way-team-detail', theme);

      await nav(page, 'Knowledge folders').click();
      await expect(page.getByRole('heading', { name: 'Knowledge folders' })).toBeVisible();
      await snap(page, '12-folders', theme);
      await page.getByRole('heading', { name: /Reading lists \(slices\) in each project/ }).scrollIntoViewIfNeeded();
      await page.getByRole('heading', { name: 'newsletter' }).scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('main')!.scrollBy(0, 400));
      await snap(page, '12b-slices-size-bars', theme);
      await nav(page, 'Storage').click();
      await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
      await snap(page, '13-storage', theme);
      await nav(page, 'Settings').click();
      await snap(page, '14-settings', theme);
    } finally { await app.close(); }
  });
}

test('a 900 pixel wide window never scrolls sideways', async () => {
  const { app, page } = await launch(['--sample-data']);
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setContentSize(900, 640); });
    await page.waitForTimeout(300);
    const screens = ['Home', 'Map', 'Library', 'Projects', 'Knowledge folders', 'Storage', 'Settings'];
    for (const label of screens) {
      await nav(page, label).click();
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => { const m = document.getElementById('main')!; return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: m.scrollWidth - m.clientWidth }; });
      expect(overflow, label).toEqual({ page: 0, main: 0 });
    }
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: /newsletter/ }).click();
    await page.getByRole('button', { name: 'Show the raw files' }).click();
    await page.waitForTimeout(200);
    await snap(page, '15-project-at-900px', 'light');
    const o = await page.evaluate(() => { const m = document.getElementById('main')!; return m.scrollWidth - m.clientWidth; });
    expect(o).toBe(0);
  } finally { await app.close(); }
});

test('after a screen change the keyboard moves to the heading and a screen reader is told; Home shows the sample banner and the time', async () => {
  const { app, page } = await launch(['--sample-data']);
  try {
    await expect(page.getByText('You are looking at sample data')).toBeVisible();
    await expect(page.getByText(/^As of /)).toBeVisible();
    await nav(page, 'Library').click();
    await expect(page.locator('main h1')).toBeFocused();
    await expect(page.locator('#live')).toHaveText('Library');
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: /studio-site/ }).click();
    await expect(page.locator('main h1')).toBeFocused();
    await expect(page.locator('#live')).toHaveText('studio-site');
    await expect(page.locator('main[role="main"] main, main main')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Look again' }).first()).toBeVisible();
    // Details for the curious is collapsed and holds the path.
    const details = page.locator('details', { hasText: 'Details for the curious' }).first();
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.locator('pre')).toContainText('Folder: ');
  } finally { await app.close(); }
});
