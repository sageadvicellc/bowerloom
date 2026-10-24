/**
 * Journey 1 in the real prototype window (launched with --prototype and a temporary data folder): welcome, pick the two roots,
 * scan, tick, review a conflict, bring in, and land on the Harness screen. Set PROTO_SETUP_SHOTS to a folder to also save screenshots
 * at 1440 by 900 and 900 by 600. Run `npm run bundle` first, so dist matches the source.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animationsDone, framesPainted } from './proto-wait.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_SETUP_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
const SIZES = [[1440, 900], [900, 600]] as const;

let app: ElectronApplication, page: Page;

test.beforeEach(async () => {
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
});
test.afterEach(async () => { try { await app.close(); } finally { removeTempDirs(); } });

async function resize(w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(size.w, size.h); }, { w, h });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(w);
  await framesPainted(page); // the resized page has been laid out and drawn once

}
/** Saves the current screen at both sizes, then leaves the window at the first size. */
async function shoot(name: string, prepare?: () => Promise<void>): Promise<void> {
  if (shotsDir === null) return;
  for (const [w, h] of [...SIZES].reverse()) { await resize(w, h); if (prepare !== undefined) await prepare(); await animationsDone(page); await page.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' }); }
}
const step = (name: string) => page.getByRole('heading', { level: 2, name, exact: true });

async function toPlaces(): Promise<void> {
  await expect(step('Welcome')).toBeVisible();
  await expect(page.getByText('A harness is everything around an AI model that is not the model itself.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Harness root' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose where your harness lives' }).click();
  await expect(page.getByRole('button', { name: 'Continue to the scan' })).toBeDisabled();
  await page.getByRole('group', { name: 'Harness root' }).getByRole('radio', { name: '/Users/sample/Studio', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Continue to the scan' })).toBeDisabled();
  await page.getByRole('group', { name: 'Knowledge root' }).getByRole('radio', { name: '/Users/sample/Studio/knowledge', exact: true }).check();
  await expect(page.getByText('The knowledge root is inside the harness root. That is fine.')).toBeVisible();
}

test('journey 1: welcome, roots, scan, tick, settle a conflict, bring in, and land on the Harness screen', async () => {
  test.setTimeout(120_000);
  await shoot('01-welcome');
  await toPlaces();
  await shoot('01b-roots');
  await page.getByRole('button', { name: 'Continue to the scan' }).click();

  // Step one: places and counts only.
  await expect(step('Look for settings folders')).toBeFocused();
  await expect(page.getByText('This shows places and counts only. It reads no file contents.')).toBeVisible();
  await expect(page.locator('.sx-place')).toHaveCount(0);
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await expect(page.locator('.sx-found')).toBeFocused();
  for (const group of ['Claude Code', 'Codex', 'OpenCode', 'Older Bowerloom layouts', 'Project folders']) await expect(page.getByRole('heading', { level: 3, name: group })).toBeVisible();
  await expect(page.getByText('No older Bowerloom layouts found.')).toBeVisible();
  const places = await page.locator('.sx-place').count();
  expect(places).toBeGreaterThan(8);
  await expect(page.locator('.sx-place').first()).toContainText('Studio: .claude');
  await expect(page.locator('.sx-place').first()).toContainText(/\d+ skills, \d+ agents, \d+ tools/);
  await expect(page.locator('.sx-place').last()).toHaveCSS('opacity', '1');
  await animationsDone(page); // the places have finished their reveal
  await shoot('02-places');

  // Step two: tick. Only the three Studio settings folders.
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await expect(step('Choose what to read')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Read the ticked places' })).toBeDisabled();
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByRole('status').filter({ hasText: /places ticked/ })).toContainText(`${places} of ${places} places ticked`);
  await page.getByRole('button', { name: 'Select none' }).click();
  await expect(page.getByRole('status').filter({ hasText: /places ticked/ })).toContainText(`0 of ${places} places ticked`);
  for (const folder of ['.claude', '.codex', '.opencode']) await page.getByRole('checkbox', { name: new RegExp(`^Studio: \\${folder}\\b`) }).check();
  await expect(page.getByRole('status').filter({ hasText: /places ticked/ })).toContainText(`3 of ${places} places ticked`);
  await page.getByRole('button', { name: 'Read the ticked places' }).click();

  // Review: the conflict stops the way on until it is settled.
  await expect(step('Review what was found')).toBeFocused();
  await expect(page.getByText('runs code').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Needs a secret' })).toBeVisible();
  await expect(page.getByText(/LANTERN_TOKEN, an environment variable, and it is not set/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Same item, different text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByText('Settle 1 item above to go on.')).toBeVisible();
  // All three copies are in view at once: there is no button to open them.
  await expect(page.getByRole('button', { name: /^Choose a version of / })).toHaveCount(0);
  for (const who of ['Claude Code', 'Codex', 'OpenCode']) {
    const copy = page.getByRole('region', { name: new RegExp(`^${who}'s copy, at `) });
    await expect(copy).toBeVisible();
    await expect(copy.getByRole('button', { name: 'Keep this copy' })).toBeVisible();
    await expect(copy.locator('.sx-path')).toHaveAttribute('title', /\//);
    await expect(copy.locator('.sx-path .sr')).toContainText('Path: /');
  }
  // The other two copies mark the lines that differ from the first, with the word "changed" and a background.
  const marked = page.getByRole('region', { name: /^Codex's copy, at / }).locator('.sx-line.is-changed');
  expect(await marked.count(), 'Codex differs from Claude Code').toBeGreaterThan(0);
  await expect(marked.first().locator('.sx-mark')).toHaveText('changed');
  await expect(marked.first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('region', { name: /^Claude Code's copy, at / }).locator('.sx-line.is-changed')).toHaveCount(0);
  await shoot('03-review-conflict', () => page.getByRole('heading', { level: 3, name: 'Same item, different text' }).evaluate(el => { el.scrollIntoView({ block: 'start' }); }));
  await page.getByRole('button', { name: "Keep this copy: Codex's copy" }).click();
  await expect(page.getByText(/kept Codex's copy\./)).toBeVisible();
  await expect(page.getByText('Settled').first()).toBeVisible();
  // The card that had the keyboard is gone, and no conflict is left, so the keyboard is on Continue.
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Bring in.
  await expect(step('Bring these in')).toBeFocused();
  await expect(page.getByText('Bowerloom copies. Your original files stay as they are.')).toBeVisible();
  await page.getByRole('button', { name: 'Bring these in', exact: true }).click();
  await expect(step('Everything is brought in')).toBeFocused();
  await expect(page.getByText('Version 1 was made: Brought in from this computer.')).toBeVisible();
  await shoot('04-done');

  // The Harness screen opens, and the Versions screen has the first version.
  await page.getByRole('button', { name: 'Go to the Harness screen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harness' })).toBeVisible();
  await expect(page.locator('nav.nav').getByRole('button', { name: 'Harness' })).toHaveAttribute('aria-current', 'page');
  await page.locator('nav.nav').getByRole('button', { name: 'Versions' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Version 1' })).toBeVisible();
  await expect(page.getByText('Brought in from this computer', { exact: true })).toBeVisible();
  // Back on Setup the finished state is still there, and Start again resets only the screen.
  await page.locator('nav.nav').getByRole('button', { name: 'Setup' }).click();
  await expect(step('Everything is brought in')).toBeVisible();
  await expect(page.getByText('Resets these steps only. The version and your harness changes stay. Use Versions to go back.')).toBeVisible();
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(step('Welcome')).toBeVisible();
  await page.locator('nav.nav').getByRole('button', { name: 'Versions' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Version 1' })).toBeVisible();
});

test('Start again says what it does not undo, and a second run that changes nothing does not claim the first version', async () => {
  test.setTimeout(120_000);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await expect(page.getByText('Resets these steps only. Changes already made stay.')).toBeVisible();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  await page.getByRole('button', { name: "Keep this copy: Codex's copy" }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Bring these in', exact: true }).click();
  await expect(page.getByText('Version 1 was made: Brought in from this computer.')).toBeVisible();
  // Second run: the conflict is already settled in the harness, so nothing changes and no version is made.
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(step('Welcome')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Harness root' })).toHaveCount(0);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await page.getByRole('checkbox', { name: /^Studio: \.claude\b/ }).check();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  await expect(page.getByText('No item was found twice with different text.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Bring these in', exact: true }).click();
  await expect(page.getByText(/no version was made/)).toBeVisible();
  await expect(page.getByText(/Version 1 was made/)).toHaveCount(0);
});

test('an item found in two ticked places counts once in the running total', async () => {
  test.setTimeout(120_000);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  const total = async (): Promise<number> => Number(/(\d+) items? in them/.exec(await page.getByRole('status').filter({ hasText: /places ticked/ }).innerText())?.[1]);
  await page.getByRole('button', { name: 'Select all' }).click();
  const all = await total();
  // The same text, summed place by place, is bigger: read it from the places step.
  const sum = (await page.locator('.sx-tick .small.muted').allInnerTexts()).reduce((n, t) => n + [...t.matchAll(/(\d+) (?:skills?|agents?|tools?)/g)].reduce((m, x) => m + Number(x[1]), 0), 0);
  expect(sum, 'summed place by place').toBeGreaterThan(all);
  expect(all).toBeGreaterThan(0);
});

test('keep both: names must differ and be free, then three items replace the one', async () => {
  test.setTimeout(120_000);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  await expect(page.getByText(/from a library, kept as a reference/)).toBeVisible();
  await expect(page.getByText(/120 items from Evergreen Kit 2\.3\.0/)).toBeVisible();
  const first = page.getByLabel(/^Name for Claude Code's copy$/), second = page.getByLabel(/^Name for Codex's copy$/);
  await second.fill(await first.inputValue());
  await page.getByRole('button', { name: 'Keep all 3 copies' }).click();
  await expect(page.getByText('Each copy needs its own name.')).toBeVisible();
  await second.fill('');
  await page.getByRole('button', { name: 'Keep all 3 copies' }).click();
  await expect(page.getByText('Every copy needs a name.')).toBeVisible();
  await second.fill((await first.inputValue()) + ' (Codex)');
  await page.getByRole('button', { name: 'Keep all 3 copies' }).click();
  await expect(page.getByText(/kept all 3 copies under separate names/)).toBeVisible();
  await expect(page.getByText('3 different copies')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Bring these in', exact: true }).click();
  await expect(page.getByText('Version 1 was made: Brought in from this computer.')).toBeVisible();
});

test('untouched world: bringing in with nothing settled makes no version, and a single ticked place has no conflict', async () => {
  test.setTimeout(120_000);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await page.getByRole('checkbox', { name: /^Studio: \.claude\b/ }).check();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  await expect(page.getByText('No item was found twice with different text.')).toBeVisible();
  await expect(page.getByText(/Library cache/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Bring these in', exact: true }).click();
  await expect(page.getByText(/no version was made/)).toBeVisible();
  await page.locator('nav.nav').getByRole('button', { name: 'Versions' }).click();
  await expect(page.getByText('No versions yet.')).toBeVisible();
});

test('the reveal uses the Jhey tokens, and reduce motion makes them zero', async () => {
  const read = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  expect(await read('--motion-setup-reveal-ms')).toBe('280ms');
  expect(await read('--motion-setup-reveal-stagger')).toBe('40ms');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => read('--motion-setup-reveal-ms')).toBe('0ms');
  expect(await read('--motion-setup-reveal-stagger')).toBe('0ms');
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await expect(page.locator('.sx-place').last()).toHaveCSS('opacity', '1');
  await expect(page.locator('.sx-place').last()).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => read('--motion-setup-reveal-ms')).toBe('280ms');
});

/** The footer of the step is on the screen without any scrolling, and the title of the screen and the heading of the step are both in view. */
async function expectWayOnInView(label: string, entry = true): Promise<void> {
  const view = await page.evaluate(() => ({ h: window.innerHeight, main: document.querySelector('main')!.scrollTop }));
  const footer = await page.locator('.sx-footer').boundingBox(), heading = await page.locator('#sx-heading').boundingBox(), title = await page.getByRole('heading', { level: 1, name: 'Setup' }).boundingBox();
  expect(footer, `${label}: footer`).not.toBeNull(); expect(heading, `${label}: heading`).not.toBeNull(); expect(title, `${label}: title`).not.toBeNull();
  expect(footer!.y + footer!.height, `${label}: the footer ends inside the window`).toBeLessThanOrEqual(view.h);
  expect(footer!.y, `${label}: the footer starts inside the window`).toBeGreaterThan(0);
  if (!entry) return; // the person has scrolled to reach a control: only the way on has to stay in view
  expect(title!.y, `${label}: the screen title is not cut off`).toBeGreaterThanOrEqual(0);
  expect(heading!.y, `${label}: the step heading is not cut off`).toBeGreaterThanOrEqual(0);
  expect(heading!.y + heading!.height, `${label}: the step heading is above the footer`).toBeLessThan(footer!.y);
}

test('every step has its way on in view without scrolling, opens at its heading, and the disabled button is explained in words', async () => {
  test.setTimeout(120_000);
  await resize(900, 600);
  await expectWayOnInView('welcome');
  await toPlaces();
  await expectWayOnInView('roots', false);
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await expectWayOnInView('places before the scan');
  await expect(page.locator('.sx-footer').getByRole('button', { name: 'Look for settings folders' })).toBeEnabled();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  // The scan makes a long list, and the next step is still in view at the bottom of the window. There is no greyed scan button.
  await expect(page.locator('.sx-place').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Look for settings folders' })).toHaveCount(0);
  await expectWayOnInView('places after the scan');
  await expect(page.locator('.sx-footer').getByRole('button', { name: 'Choose which places to read' })).toBeVisible();
  // Scroll away, then go on: the next step opens at the top, with the title and the heading in view.
  await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await expect(step('Choose what to read')).toBeFocused();
  expect(await page.locator('main').evaluate(el => el.scrollTop), 'the new step starts at the top').toBe(0);
  await expectWayOnInView('contents');
  await expect(page.locator('.sx-footer').getByRole('button', { name: 'Read the ticked places' })).toBeDisabled();
  await expect(page.locator('.sx-footer')).toContainText('Tick at least one place to go on.');
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  await expectWayOnInView('review');
  await expect(page.locator('.sx-footer')).toContainText('Settle 1 item above to go on.');
  await expect(page.locator('.sx-footer').getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  // The path of a copy is on one line, and its last part is whole.
  const path = page.locator('.sx-variant .sx-path').first(), box = await path.boundingBox(), line = await path.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
  expect(box!.height, 'one line').toBeLessThanOrEqual(line + 2);
  const tail = page.locator('.sx-variant .sx-path-tail').first();
  expect(await tail.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'the end of the path is not cut').toBe(true);
});

test('the reveal of the found places plays the first time only, and the list is simply there after Back', async () => {
  test.setTimeout(120_000);
  await toPlaces();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await expect(page.locator('.sx-place.sx-reveal')).toHaveCount(await page.locator('.sx-place').count());
  await animationsDone(page);
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(step('Look for settings folders')).toBeVisible();
  const count = await page.locator('.sx-place').count();
  expect(count).toBeGreaterThan(8);
  await expect(page.locator('.sx-place.sx-reveal'), 'no place is revealed a second time').toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a instanceof CSSAnimation && a.playState === 'running').map(a => (a as CSSAnimation).animationName)), 'no reveal is playing').toEqual([]);
});
