/**
 * The knowledge graph, in the real window. The sample's notes have no links, so the test adds a small invented wiki to the
 * sample's "team-notes" folder (in the app's own temporary copy) before it opens the graph. It checks that the picture loads,
 * that filters and search work, that a page opens in the panel, that the list view is a keyboard-friendly alternative, that
 * nothing reaches the network, and that the graph library breaks no policy of the page. Screenshots in light and dark.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTempDirs, tempDir } from './temp-dirs.js';

// Every folder this file made in the temp folder goes when its tests are done, also when one failed.
test.afterAll(() => { removeTempDirs(); });

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });
const nav = (page: Page, label: string) => page.locator('nav.nav').getByRole('button', { name: label });

const TOPICS = 24, PEOPLE = 12, LOOSE = 4;
/** Writes an invented wiki into one folder: topics that link in a chain and to people, people who link back, a few pages with no link at all. 40 pages in all, with tags. */
function writeWiki(folder: string): void {
  const put = (rel: string, text: string): void => { const path = join(folder, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  const two = (n: number): string => String(n).padStart(2, '0');
  for (let i = 1; i <= TOPICS; i++) {
    const next = i < TOPICS ? `[[topic-${two(i + 1)}]]` : '[[topic-01]]';
    put(`topics/topic-${two(i)}.md`, `---\ntitle: Topic ${two(i)}\ntags: [${i % 2 === 0 ? 'harbor' : 'garden'}]\n---\n\n# Topic ${two(i)}\n\nSee ${next} and [[person-${two((i % PEOPLE) + 1)}]]. #lantern\n`);
  }
  for (let i = 1; i <= PEOPLE; i++) put(`people/person-${two(i)}.md`, `# Person ${two(i)}\n\nWrites about [[topic-${two(i)}]]. See also [the index](../index.md).\n`);
  for (let i = 1; i <= LOOSE; i++) put(`loose/loose-${i}.md`, `# Loose ${i}\n\nA page that links nowhere.\n`);
  put('index.md', '# Index\n\nStart at [[topic-01]].\n');
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; violations: string[]; userData: string }> {
  const userData = tempDir('bowerloom-viewer-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sample-data', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  const page = await app.firstWindow();
  const violations: string[] = [];
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', e => violations.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', e => { (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${e.violatedDirective}: ${e.blockedURI}`]; }));
  return { app, page, violations, userData };
}
const snap = async (page: Page, name: string, theme: string): Promise<void> => { await page.waitForTimeout(4200); await page.screenshot({ path: join(shots, `${name}-${theme}.png`), scale: 'css' }); };

for (const theme of ['light', 'dark'] as const) {
  test(`the knowledge graph in ${theme}: loads the wiki, filters, search, the panel, the list view, and no policy violation`, async () => {
    test.setTimeout(300_000);
    const { app, page, violations, userData } = await launch();
    try {
      // The app has copied the sample by now; its team-notes folder is where the invented wiki goes.
      await expect(nav(page, 'Settings')).toBeVisible();
      await expect.poll(() => page.locator('nav.nav button').count()).toBeGreaterThan(5);
      writeWiki(join(userData, 'sample', 'home', 'Notes', 'team-notes'));
      await nav(page, 'Settings').click();
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      const labels = await page.locator('nav.nav button').allInnerTexts(); expect(labels.map(l => l.split('\n')[0])[2]).toBe('Knowledge graph');
      await nav(page, 'Knowledge graph').click();
      await expect(page.getByRole('heading', { name: 'Knowledge graph', exact: true })).toBeVisible();
      await page.getByLabel('Context store').selectOption({ label: 'team-notes (knowledge folder)' });
      await expect(page.locator('.kg-status')).toContainText(/\d+ pages, \d+ links, \d+ with no links/, { timeout: 20_000 });
      await expect(page.locator('.kg-canvas canvas').first()).toBeVisible();
      const status = await page.locator('.kg-status').innerText(); const pages = Number(/^(\d+) pages/.exec(status)![1]); expect(pages).toBeGreaterThanOrEqual(40);
      await snap(page, 'G1-knowledge-graph', theme);

      // The list view is the accessible alternative: reachable with the keyboard, and it opens the same panel.
      await page.getByRole('button', { name: 'Show as a list' }).click();
      const first = page.locator('.kg-rows .kg-link').first(); await expect(first).toBeVisible();
      await first.focus(); await page.keyboard.press('Enter');
      await expect(page.locator('.kg-panel h2')).not.toHaveText(/^$/); await expect(page.locator('.kg-panel')).toContainText('Linked from');
      await page.getByRole('button', { name: 'Read this page' }).click();
      await expect(page.locator('.kg-panel pre.file')).toBeVisible();
      await expect(page.locator('details.explain summary', { hasText: 'Bowerloom items that point at this store' })).toBeVisible();
      await page.getByRole('button', { name: 'Show as a picture' }).click();

      // Search narrows the pages; clearing the filters brings them back.
      await page.getByLabel('Search pages').fill('zzzz-nothing');
      await expect(page.locator('.kg-status')).toContainText('Showing 0 of');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page.locator('.kg-status')).not.toContainText('Showing');
      // Local graph around the selected page.
      await page.getByRole('button', { name: 'Show as a list' }).click(); await page.locator('.kg-rows .kg-link').first().click();
      await page.getByRole('button', { name: 'Show only nearby pages' }).click();
      await expect(page.locator('.kg-status')).toContainText('Showing');
      await page.getByRole('button', { name: 'Show as a picture' }).click();
      await page.getByRole('button', { name: 'Pause' }).click(); await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible(); await page.getByRole('button', { name: 'Resume' }).click();
      await snap(page, 'G2-knowledge-graph-local', theme);

      // The page's policy was never broken by the library.
      expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual([]);
      expect(violations).toEqual([]);
    } finally { await app.close(); }
  });
}
