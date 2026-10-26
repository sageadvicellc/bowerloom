/**
 * The real-setup reader, driven end to end in Electron with HOME pointed at a made-up folder (tests/fixtures-real). Nothing of the person's own folders is read: the
 * launched app sees only the fixture. The spec walks the two questions (Find my setup, tick, Read what is inside?), adds a folder (the system chooser is replaced in the
 * main process by one that answers with the fixture's work folder), and checks the page: no key value anywhere in its text, text drawn as text, the bridge has three calls, and
 * the fixture is the same, byte for byte, before and after. With HOME_REAL_SHOTS set to a folder, it saves screenshots of the bare list at 1280 by 800, light and dark.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_SECRET, FAKE_TOKEN_IN_TEXT, buildFixture } from '../tests/fixtures-real/build.js';
import type { Fixture } from '../tests/fixtures-real/build.js';
import { fingerprint } from '../tests/fixtures-real/fingerprint.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.HOME_REAL_SHOTS ?? null;
if (shots !== null) mkdirSync(shots, { recursive: true });

let fixture: Fixture, app: ElectronApplication, page: Page, before: string;
const dialogs: string[] = [];

test.beforeAll(async () => {
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'renderer', 'app.js'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  fixture = buildFixture();
  before = fingerprint(fixture.root);
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [desktop, '--prototype-real', `--user-data-dir=${userData}`],
    env: { ...process.env, HOME: fixture.home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  // The system folder chooser cannot be driven from here; the main process gets one that answers with the fixture's work folder.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog; }, fixture.work);
  page = await app.firstWindow();
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
  await page.waitForLoadState('domcontentloaded');
  // The real address opens the shell now (see home-real-shell.spec.ts). This spec drives the reader's own bare list, which the same page shows at its test address.
  await page.evaluate(() => { location.hash = '#prototype-v2/real-harness'; location.reload(); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-real]');
});

test.afterAll(async () => {
  await app?.close();
  fixture?.cleanup();
  removeTempDirs();
});

const bodyText = (): Promise<string> => page.locator('body').innerText();
const step = (name: string) => page.locator(`[data-real][data-step="${name}"]`);

test('the page opens in real mode: the address, the window, the title, and the Read-only reminder', async () => {
  expect(await page.evaluate(() => location.hash)).toBe('#prototype-v2/real-harness');
  expect(await page.title()).toBe('Bowerloom');
  const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  expect(size[0]).toBeGreaterThanOrEqual(1200);
  await expect(step('start')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find my setup' })).toBeVisible();
  await expect(page.locator('[data-readonly]')).toContainText('Read-only');
  await expect(page.locator('footer')).toContainText('Read-only');
});

test('the bridge has exactly three calls, no normal bridge is there, and nothing leaves the window', async () => {
  const facts = await page.evaluate(async () => {
    const real = (window as unknown as { bowerloomReal?: Record<string, unknown> }).bowerloomReal;
    const normal = (window as unknown as { bowerloom?: unknown }).bowerloom;
    let fetched = 'no error';
    try { await fetch('https://example.com/'); } catch (e) { fetched = e instanceof Error ? e.name : 'error'; }
    return { keys: real === undefined ? [] : Object.keys(real).sort(), frozen: real !== undefined && Object.isFrozen(real), normal: typeof normal, fetched, requireType: typeof (window as unknown as { require?: unknown }).require };
  });
  expect(facts.keys).toEqual(['discoverPlaces', 'pickFolder', 'readSelected']);
  expect(facts.frozen).toBe(true);
  expect(facts.normal).toBe('undefined');
  expect(facts.fetched).not.toBe('no error');
  expect(facts.requireType).toBe('undefined');
  // A call with a place that was never listed is refused with a short code, not with a path or a stack.
  const refusal = await page.evaluate(async () => {
    try { await (window as unknown as { bowerloomReal: { readSelected(ids: string[]): Promise<unknown> } }).bowerloomReal.readSelected(['place-000000000000']); return 'answered'; } catch (e) { return (e as Error).message; }
  });
  expect(refusal).toBe('UNKNOWN_PLACE');
});

test('step one: Find my setup lists the home places with counts, and shows no path until Show details', async () => {
  await page.getByRole('button', { name: 'Find my setup' }).click();
  await expect(step('places')).toBeVisible();
  const rows = page.locator('.rl-place');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Claude Code at home');
  await expect(rows.nth(0)).toContainText('2 agents, 6 skills, 3 tools, 1 hook');
  await expect(rows.nth(1)).toContainText('Codex at home');
  await expect(rows.nth(2)).toContainText('OpenCode at home');
  await expect(rows.nth(3)).toContainText('Hermes at home');
  await expect(page.locator('[data-could-not]')).toContainText('Could not read');
  const text = await bodyText();
  expect(text).not.toContain(fixture.home);
  expect(text).not.toContain('write-reply');
  expect(text).not.toContain(FAKE_SECRET);
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.locator('[data-details]').first()).toContainText('~');
  expect(await bodyText()).not.toContain(fixture.home);
  await page.getByRole('button', { name: 'Hide details' }).click();
  if (shots !== null) await page.screenshot({ path: join(shots, 'real-1-places-light.png') });
});

test('a folder the person picks adds its places; nothing is read yet', async () => {
  await page.getByRole('button', { name: 'Add a folder' }).click();
  await expect(page.locator('.rl-place')).toHaveCount(6);
  await expect(page.locator('.rl-place').nth(4)).toContainText('work');
  await expect(page.locator('.rl-place').nth(5)).toContainText('alpha');
  await expect(page.locator('.rl-place').nth(5)).toContainText('2 skills, 1 tool, 3 notes');
  expect(await bodyText()).not.toContain('Alpha skill');
});

test('step two: untick a place, confirm with "Yes, read them", and only then is anything opened', async () => {
  await page.locator('.rl-place', { hasText: 'Hermes at home' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Looks right' }).click();
  await expect(step('confirm')).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Read what is inside?');
  await expect(page.locator('.rl-summary')).toContainText('5 places');
  await expect(page.locator('body')).toContainText('Keys and passwords are never copied.');
  if (shots !== null) await page.screenshot({ path: join(shots, 'real-2-confirm-light.png') });
  await page.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(step('list')).toBeVisible();
});

test('the list: the agents, skills and tools found, from the ticked places only, with no key value anywhere', async () => {
  await expect(page.locator('[data-summary]')).toContainText('5 agents');
  const agents = page.locator('[data-list="agent"] [data-item]');
  await expect(agents).toHaveCount(5);
  await expect(page.locator('[data-list="agent"]')).toContainText('Reviewer');
  await expect(page.locator('[data-list="skill"]')).toContainText('Write a reply');
  await expect(page.locator('[data-list="skill"]')).toContainText('Alpha skill');
  await expect(page.locator('[data-list="skill"]')).toContainText('Check the totals');
  await expect(page.locator('[data-list="tool"]')).toContainText('Connects to api.example.test.');
  const text = await bodyText();
  expect(text).not.toContain(FAKE_SECRET);
  expect(text).not.toContain(FAKE_TOKEN_IN_TEXT);
  expect(text).not.toContain('Pixel');
  expect(text).not.toContain('tidy-up');
  expect(text).not.toContain('Outside skill');
  expect(text).not.toContain('plugin skill');
  expect(text).not.toContain(fixture.home);
  await expect(page.locator('[data-note]').first()).toBeVisible();
});

test('text from a file stays text: a markup string and an order in a skill are shown as words, and nothing in the page runs', async () => {
  const hostile = page.locator('[data-list="skill"] [data-item]', { hasText: 'Tidy notes' });
  await expect(hostile).toContainText('<img src=x onerror="alert(1)"> Tidies notes.');
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.locator('script').count()).toBe(1);
  expect(await page.evaluate(() => document.querySelectorAll('[onerror],[onclick],[onload]').length)).toBe(0);
  expect(dialogs).toEqual([]);
});

test('the fixture is the same after all of it, byte for byte', async () => {
  expect(fingerprint(fixture.root)).toBe(before);
});

test('screenshots of the bare list at 1280 by 800, light and dark', async () => {
  test.skip(shots === null, 'HOME_REAL_SHOTS is not set');
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const look of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: look });
    await page.waitForFunction(l => document.documentElement.getAttribute('data-theme') === l, look);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(shots!, `real-list-${look}.png`) });
    await page.screenshot({ path: join(shots!, `real-list-${look}-full.png`), fullPage: true });
  }
});
