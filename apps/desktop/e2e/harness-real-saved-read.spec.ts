/**
 * The kept read, in the real window (Electron started with no flag, HOME and XDG_STATE_HOME pointed at made-up folders; nothing of the person's own folders is read).
 * Walk: a first read is kept in the state folder (for its owner only, nothing written in the made-up home); the next launch opens on the Read screen with the same read and its time
 * and does not look at the folders again; a changed folder is said while the old read stays on screen, and "Read again" goes through the look and the question and reads anew;
 * a damaged kept read is told in plain words and the app starts as it always did. Set SCAN_CACHE_SHOTS to a folder outside the repository to also save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { lstatSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fingerprint } from '../tests/fixtures-real/fingerprint.js';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

const shotsDir = process.env.SCAN_CACHE_SHOTS ?? null;
let fixture: ShellHome, state: string, h: RealHarness | null = null, bundled = false;
const saved = (): string => join(state, 'bowerloom', 'last-read', 'last-read.json');
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** Starts the app on the made-up home and the shared state folder. The first start builds the bundle. */
async function start(scheme: 'light' | 'dark' = 'light'): Promise<Page> {
  h = await launchReal(fixture.home, { XDG_STATE_HOME: state }, !bundled);
  bundled = true;
  await h.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
  return h.page;
}
async function stop(): Promise<void> { const open = h; h = null; if (open !== null) await open.app.close(); }
/** Saves the screen as it is, light and dark (the scheme the test is in is put back after). */
async function shoot(p: Page, name: string, scheme: 'light' | 'dark'): Promise<void> {
  if (shotsDir === null) return;
  mkdirSync(shotsDir, { recursive: true });
  for (const one of ['light', 'dark'] as const) {
    await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: one });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(shotsDir, `scan-cache-${name}-${one}.png`), scale: 'css' });
  }
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
}
/** The look, the tick, the question and the read, as a person does them. Ends on the Read screen. */
async function readFolders(p: Page): Promise<void> {
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 30_000 });
}
const countLine = (p: Page): Promise<string> => p.locator('[data-count]').innerText();
const lastRead = (p: Page): Promise<string> => p.locator('[data-last-read-time]').innerText();

test.beforeAll(() => { test.setTimeout(240_000); fixture = buildShellHome(); state = tempDir('bowerloom-saved-state-'); });
test.afterEach(async () => { await stop(); });
test.afterAll(async () => { await stop(); fixture?.cleanup(); removeTempDirs(); });

let firstCount = '', firstTime = '', before = '';

test('a first read is kept in the state folder, for its owner only, and nothing is written in the made-up home', async () => {
  before = fingerprint(fixture.root);
  const p = await start();
  await expect(p.getByRole('button', { name: 'Find my files', exact: true })).toBeVisible();
  await expect(p.locator('[data-last-read]'), 'nothing is kept before a read').toHaveCount(0);
  await expect(p.locator('[data-saved-damaged]')).toHaveCount(0);
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await readFolders(p);
  await expect(p.locator('[data-last-read]')).toBeVisible();
  firstTime = await lastRead(p);
  expect(firstTime).toMatch(/^Last read: [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d{1,2}:\d\d (?:AM|PM)\.$/);
  await expect(p.locator('[data-last-read]').getByRole('button', { name: 'Read again', exact: true })).toBeVisible();
  await expect(p.getByText(/Showing what Bowerloom read last time/), 'a read made just now is not the kept one').toHaveCount(0);
  firstCount = await countLine(p);
  await shoot(p, 'last-read', 'light');
  expect(lstatSync(saved()).mode & 0o777, 'the file is for its owner only').toBe(0o600);
  expect(lstatSync(dirname(saved())).mode & 0o777, 'the folder is for its owner only').toBe(0o700);
  const text = readFileSync(saved(), 'utf8');
  expect(text.includes(fixture.root), 'no absolute path of the made-up home is in the file').toBe(false);
  expect(text).not.toContain('xq4-NOT-A-REAL-VALUE-5519');
  expect(fingerprint(fixture.root), 'the made-up home is the same, byte for byte').toBe(before);
});

test('the next launch opens on the Read screen with the same read and its time, and does not look at the folders', async () => {
  const p = await start();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await expect(p.getByRole('button', { name: 'Find my files', exact: true }), 'the Welcome screen is skipped').toHaveCount(0);
  await expect(p.getByText('Looking at your folders')).toHaveCount(0);
  expect(await lastRead(p)).toBe(firstTime);
  expect(await countLine(p)).toBe(firstCount);
  await expect(p.getByText('Showing what Bowerloom read last time. No folder was read just now.')).toBeVisible({ timeout: 20_000 });
  await expect(p.locator('[data-folder-changed]'), 'nothing changed').toHaveCount(0);
  await expect(p.getByText('Checking your folders for changes.')).toHaveCount(0);
  await expect(p.locator('.hxf-card', { hasText: 'Your Claude Code folder' })).toHaveCount(1);
  expect(await p.locator('body').innerText()).not.toMatch(/undefined|NaN|\[object/);
  expect(await p.locator('body').innerText()).not.toContain(fixture.root);
  await shoot(p, 'launch-saved', 'light');
  expect(fingerprint(fixture.root), 'the made-up home is the same, byte for byte').toBe(before);
});

test('a changed folder is said, the old read stays on screen, and Read again asks first and reads anew', async () => {
  put(join(fixture.home, '.claude', 'skills', 'fresh-skill', 'SKILL.md'), '---\nname: Fresh skill\ndescription: Added after the first read.\n---\n\nDo the new thing.\n');
  const p = await start();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await expect(p.locator('[data-folder-changed]')).toHaveText('Some folders changed since this read.', { timeout: 20_000 });
  expect(await lastRead(p), 'the old read is still the one on screen').toBe(firstTime);
  expect(await countLine(p), 'and it was not read again by itself').toBe(firstCount);
  await expect(p.getByText('Fresh skill')).toHaveCount(0);
  await shoot(p, 'folder-changed', 'light');
  await p.locator('[data-last-read]').getByRole('button', { name: 'Read again', exact: true }).click();
  // The first question runs again, and the second one is still asked before anything is opened.
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  const before2 = readFileSync(saved(), 'utf8');
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 30_000 });
  await expect(p.locator('[data-folder-changed]')).toHaveCount(0);
  expect(await countLine(p), 'the new read holds the new skill').not.toBe(firstCount);
  expect(readFileSync(saved(), 'utf8'), 'and it is the one kept now').not.toBe(before2);
  await stop();
  const again = await start();
  await expect(again.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await expect(again.getByText('Showing what Bowerloom read last time. No folder was read just now.')).toBeVisible({ timeout: 20_000 });
  await expect(again.locator('[data-folder-changed]')).toHaveCount(0);
});

test('a kept read that is damaged is told in plain words, and the app starts on the Welcome screen as it always did', async () => {
  writeFileSync(saved(), '{"version":1,"savedAtMs":');
  utimesSync(saved(), new Date(), new Date());
  const p = await start('dark');
  await expect(p.getByRole('button', { name: 'Find my files', exact: true })).toBeVisible();
  await expect(p.locator('[data-saved-damaged]')).toHaveText('The saved read could not be used, so Bowerloom starts fresh.');
  await expect(p.locator('[data-last-read]')).toHaveCount(0);
  await shoot(p, 'damaged', 'dark');
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await readFolders(p);
  await expect(p.locator('[data-saved-damaged]')).toHaveCount(0);
  
  expect(JSON.parse(readFileSync(saved(), 'utf8')).version, 'a fresh read replaced the damaged file').toBe(1);
});

test('a kept read of another version, and an empty file, each start fresh and say so', async () => {
  for (const make of [
    () => writeFileSync(saved(), '{"version":2}'),
    () => writeFileSync(saved(), ''),
  ]) {
    make();
    const p = await start();
    await expect(p.locator('[data-saved-damaged]')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Find my files', exact: true })).toBeVisible();
    await stop();
  }
});
