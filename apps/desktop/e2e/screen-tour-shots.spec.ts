/**
 * Takes a picture of every screen and sheet of the sample launch, in light and in dark, so a change to the look can be reviewed screen by screen.
 * Every test here is skipped unless SCREEN_SHOTS names a folder outside the repo:
 *   SCREEN_SHOTS=/some/folder npx playwright test --config playwright.config.ts e2e/screen-tour-shots.spec.ts      (from apps/desktop)
 * The window stays hidden (e2e/hidden.ts). The sample reads and writes nothing of the person's own folders.
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { desktop, fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { animationsDone } from './page-wait.js';
import { removeTempDirs } from './temp-dirs.js';

const OUT = process.env.SCREEN_SHOTS ?? '';
test.skip(OUT === '', 'Set SCREEN_SHOTS to a folder to take the screen tour pictures.');

const SCHEMES = ['light', 'dark'] as const;
const SIZE = { width: 1280, height: 820 };
let h: Harness;
const page = (): Page => h.page;

/** A style sheet to lay over every picture, to compare a proposed look with the current one: SCREEN_EXTRA_CSS names a .css file, which is copied into the built page (dist, never the source) after the start. A test-only switch. */
const EXTRA_FILE = process.env.SCREEN_EXTRA_CSS ?? '';
const EXTRA = EXTRA_FILE === '' ? '' : basename(EXTRA_FILE);
if (EXTRA !== '' && !/^[\w.-]+\.css$/.test(EXTRA)) throw new Error('SCREEN_EXTRA_CSS must name a .css file. It is a test-only switch.');

test.beforeAll(async () => {
  test.setTimeout(240_000); mkdirSync(OUT, { recursive: true }); h = await launchHarness(); await page().setViewportSize(SIZE);
  if (EXTRA_FILE !== '') copyFileSync(EXTRA_FILE, join(desktop, 'dist', 'renderer', EXTRA));
});
test.afterAll(async () => {
  if (missed.length > 0) console.warn(`The screen tour took no picture after these buttons, which it did not find: ${missed.join(', ')}`);
  try { await h?.app.close(); } finally { removeTempDirs(); }
});

/** Writes `<name>-light.png` and `<name>-dark.png` of the page as it is now. */
async function snap(p: Page, name: string): Promise<void> {
  // The pointer leaves the page content, so no hover state or tooltip is in the picture.
  await p.mouse.move(1, SIZE.height - 1);
  const extra = EXTRA;
  if (extra !== '') await p.evaluate(href => { if (document.querySelector(`link[href="${href}"]`) === null) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); } }, extra);
  for (const scheme of SCHEMES) {
    await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
    await animationsDone(p);
    await p.screenshot({ path: join(OUT, `${name}-${scheme}.png`), scale: 'css' });
  }
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
}

/** The buttons the tour looked for and did not find; each one costs a picture. They are said at the end, so a renamed button never drops a screen quietly. */
const missed: string[] = [];

/** Presses the first button that can be pressed among the names given, in order. When none can, it notes them all as one miss and returns false. */
async function press(p: Page, ...names: Array<string | RegExp>): Promise<boolean> {
  for (const name of names) {
    const button = p.getByRole('button', { name, exact: typeof name === 'string' }).first();
    if (await button.count() === 0 || !(await button.isVisible()) || !(await button.isEnabled()) || await button.getAttribute('aria-disabled') === 'true') continue;
    await button.click();
    return true;
  }
  missed.push(names.map(String).join(' or '));
  return false;
}

const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ['01-welcome', '#sample'],
  ['05-overview', '#sample/overview'],
  ['06-harnesses', '#sample/harnesses'],
  ['07-harness-detail', '#sample/harnesses/harness-weekly-report-crew'],
  ['09-library-skills', '#sample/library/skill'],
  ['10-library-agents', '#sample/library/agent'],
  ['11-projects', '#sample/projects'],
  ['12-runs', '#sample/runs'],
  ['13-interfaces', '#sample/interfaces'],
  ['14-history', '#sample/history'],
  ['15-help', '#sample/help'],
];

test('every screen, light and dark', async () => {
  test.setTimeout(600_000);
  const p = page();
  for (const [name, hash] of SCREENS) {
    await fresh(p, hash);
    await snap(p, name);
  }
  // The first run, one step at a time.
  await fresh(p, '#sample');
  if (await press(p, 'Find my files')) await snap(p, '02-choose');
  if (await press(p, 'Looks right')) await snap(p, '03-read');
  if (await press(p, /^Make all/)) await snap(p, '04-after-first-run');
  // The Builder of the first folder.
  await fresh(p, '#sample/builder/sample-weekly-report');
  await snap(p, '08-builder');
});

test('the sheets and the tour', async () => {
  test.setTimeout(600_000);
  const p = page();
  await fresh(p, '#sample/harnesses/harness-weekly-report-crew');
  if (await press(p, /^Install \d/, 'Update')) { await snap(p, '20-install-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/harnesses');
  if (await press(p, 'New harness')) { await snap(p, '21-new-harness-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/harnesses/harness-weekly-report-crew');
  if (await press(p, 'Open in builder') && await press(p, /^Export/)) { await snap(p, '22-export-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/harnesses');
  if (await press(p, 'Import from a file')) { await snap(p, '23-import-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/harnesses');
  if (await press(p, 'From a folder')) { await snap(p, '24-from-folder-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/harnesses/harness-weekly-report-crew');
  if (await press(p, 'Start')) { await snap(p, '26-start-sheet'); await p.keyboard.press('Escape'); }
  await fresh(p, '#sample/help');
  if (await press(p, 'Show me around')) await snap(p, '25-tour');
});
