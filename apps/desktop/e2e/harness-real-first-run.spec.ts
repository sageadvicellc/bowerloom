/**
 * The harness-first preview on the person's own folders, in the real window (Electron started with --prototype-v3-real and HOME pointed at a made-up folder, tests/fixtures-real/shell-home.ts).
 * Walk: Welcome, the folders found (with counts, details and "Add a folder"), "Read what is inside?" (nothing is read before "Yes, read them"), the read, the Read list with its count line,
 * "Make a harness from this", the builder graph with the links the files name, the file view, the Library, and the parts that are not in this preview (Install, Start) and the Preview mark.
 * The checks that hold at every step: the made-up key values are nowhere in the page, file text is drawn as text, text is 14 px or more, a button is 32 px, no alert is raised, the bridge has
 * exactly three calls, and the made-up folder is the same, byte for byte, before and after.
 * Then a second read: with a harness made, "Start from a scan" has a way out ("Not now"), a read asks before it starts the preview over ("Cancel" keeps everything), and the ids of new things keep climbing. Set HARNESS_SHOTS to a folder outside the repo to also save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FAKE_TOKEN_IN_TEXT, HOSTILE_SKILL } from '../tests/fixtures-real/build.js';
import { fingerprint } from '../tests/fixtures-real/fingerprint.js';
import { SHELL_SECRET, buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { shot } from './harness-page.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs } from './temp-dirs.js';

let fixture: ShellHome, h: RealHarness, before: string;
const page = (): Page => h.page;
const text = (): Promise<string> => page().locator('body').innerText();
const node = (name: string): Locator => page().locator('.hx-node', { hasText: name }).first();

test.beforeAll(async () => {
  test.setTimeout(240_000);
  fixture = buildShellHome();
  // One more skill whose words are hostile: markup, an order to a reader, and a key that sits in the text.
  const hostile = join(fixture.home, '.claude', 'skills', 'tidy-notes', 'SKILL.md');
  mkdirSync(dirname(hostile), { recursive: true });
  writeFileSync(hostile, HOSTILE_SKILL);
  // The agent of the fixture also names a model, so the reader gives it a model badge.
  writeFileSync(join(fixture.home, '.claude', 'agents', 'ledger-keeper.md'), '---\nname: Ledger keeper\ndescription: Keeps the household ledger tidy and flags odd entries.\nmodel: sonnet\nskills: [pantry-check, shared-tally]\ntools: Read, mcp__ledger-sync__list\n---\nYou keep the ledger.\n');
  // One skill that is not text, so the reader counts something it could not read (and also writes its own note about it).
  const binary = join(fixture.home, '.claude', 'skills', 'not-text', 'SKILL.md');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03, 0x00]));
  before = fingerprint(fixture.root);
  h = await launchReal(fixture.home);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterAll(async () => { try { await h?.app.close(); } finally { fixture?.cleanup(); removeTempDirs(); } });

/** What holds on every screen: no key value, no fixture path, no "undefined", no alert, nothing under 14 px, and on the first screens every button 32 px high. */
async function everyStep(label: string, buttonsAre32 = true): Promise<void> {
  const [body, markup] = [await text(), await page().content()];
  for (const secret of [SHELL_SECRET, FAKE_TOKEN_IN_TEXT]) { expect(markup, `${label}: a key value`).not.toContain(secret); }
  expect(body, `${label}: undefined`).not.toMatch(/undefined|NaN|\[object/);
  expect(body, `${label}: the folder of the made-up home`).not.toContain(fixture.root);
  expect(h.dialogs, `${label}: an alert`).toEqual([]);
  const small = await page().evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-home] *')) {
      const own = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!own || el.getClientRects().length === 0 || el.closest('.hm-sr') !== null) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 13.99) out.push(`${el.tagName} ${size}px "${(el.textContent ?? '').trim().slice(0, 30)}"`);
    }
    return out;
  });
  expect(small, `${label}: words under 14 px`).toEqual([]);
  // The first screens are all buttons of the kit; the app's own screens (the graph's handles, the small map) have their own sizes and are held by their own specs.
  if (!buttonsAre32) return;
  const buttons = await page().evaluate(() => [...document.querySelectorAll('button')].filter(b => b.getClientRects().length > 0).map(b => Math.round(b.getBoundingClientRect().height)));
  expect([...new Set(buttons)], `${label}: button heights`).toEqual([32]);
}

test('the window is the real preview: only the read-only bridge with three calls, no normal bridge, and Welcome says what it says', async () => {
  const p = page();
  const facts = await p.evaluate(() => {
    const real = (window as unknown as { bowerloomReal?: Record<string, unknown> }).bowerloomReal;
    return { keys: real === undefined ? [] : Object.keys(real).sort(), kinds: real === undefined ? [] : Object.keys(real).sort().map(k => typeof real[k]), frozen: real !== undefined && Object.isFrozen(real), normal: typeof (window as unknown as { bowerloom?: unknown }).bowerloom };
  });
  expect(facts).toEqual({ keys: ['discoverPlaces', 'pickFolder', 'readSelected'], kinds: ['function', 'function', 'function'], frozen: true, normal: 'undefined' });
  expect(await p.title()).toBe('Bowerloom');
  await expect(p.getByRole('heading', { level: 1, name: 'Bowerloom', exact: true })).toBeVisible();
  await expect(p.getByText('Bowerloom only reads. Nothing changes until you press Install.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Find my files', exact: true })).toBeFocused();
  await everyStep('welcome');
});

test('"Find my files" looks at the folders and lists them with counts; details show the paths with a ~; no path shows before that', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 4 places' })).toBeVisible();
  const rows = p.locator('.hxf-card');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Claude Code at home');
  await expect(rows.nth(0)).toContainText('agents');
  await expect(rows.nth(1)).toContainText('Codex at home');
  await expect(rows.nth(3)).toContainText('Hermes at home');
  for (const box of await p.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await expect(p.getByText('To count what each folder holds, Bowerloom opened settings files and read names and structure. It reads text only in folders you keep ticked.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Not now', exact: true }), 'a first run has no way out of the list: there is nothing to go back to').toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toBeFocused();
  expect(await text()).not.toContain('Ledger keeper');
  await everyStep('places');
  await p.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(p.locator('[data-details]').first()).toContainText('~');
  await everyStep('details');
  await shot(p, 'real-1-places');
  await p.getByRole('button', { name: 'Hide details', exact: true }).click();
});

test('"Add a folder" adds the places in the folder the person picks; closing the chooser adds nothing and says so', async () => {
  const p = page();
  await h.pick(null);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByText('No folder was chosen.')).toBeVisible();
  await expect(p.locator('.hxf-card')).toHaveCount(4);
  await h.pick(fixture.orchard);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  // The folder holds one work folder with its own agent, skill and notes; it is listed as places of its own, after the four at home.
  await expect(p.locator('.hxf-card')).toHaveCount(6);
  await expect(p.locator('.hxf-card').filter({ hasText: 'apple-row' })).toHaveCount(1);
  expect(await text()).not.toContain('Graft helper');
  await everyStep('picked');
});

test('"Looks right" asks "Read what is inside?" and names the folders; nothing is read until "Yes, read them"; Escape goes back', async () => {
  const p = page();
  await p.locator('.hxf-card', { hasText: 'Hermes at home' }).getByRole('checkbox').uncheck();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  const consent = p.locator('[data-consent]');
  await expect(consent.locator('li[data-place]')).toHaveCount(4);
  await expect(consent).toContainText('Claude Code at home');
  await expect(consent).toContainText('~/.claude');
  await expect(consent).toContainText('apple-row');
  await expect(consent).not.toContainText('Hermes at home');
  await expect(consent).toContainText('Your files are not changed.');
  await expect(consent).toContainText('Known key and password shapes are hidden, but check anything private.');
  // What is really read: the whole folder for notes pages, their first lines, and linked folders followed. The title has the focus, as on every step.
  await expect(consent.locator('li[data-place]', { hasText: 'apple-row' })).toContainText('first lines of notes pages');
  await expect(consent).toContainText('It looks through the whole folder for notes pages. It reads the first lines of up to 2000 of them.');
  await expect(consent).toContainText('It reads skills, agents, prompts and first lines of notes pages.');
  await expect(consent).toContainText('Linked folders are followed to where they point.');
  await expect(consent.locator('[data-replace]'), 'nothing is replaced on a first read').toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeFocused();
  await expect(p.getByRole('button', { name: 'Yes, read them', exact: true })).not.toBeFocused();
  expect(await text()).not.toContain('Ledger keeper');
  await everyStep('consent');
  await shot(p, 'real-2-consent');
  await p.keyboard.press('Escape');
  await expect(p.getByRole('heading', { level: 1, name: 'Found 6 places' })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 6 places' })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
});

test('"Yes, read them" reads the ticked folders and opens the Read list: a count line, the sources from the files, and no key value', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await expect(p.locator('[data-count]')).toContainText('parts in all');
  const cards = p.locator('.hxf-card');
  await expect(cards.filter({ hasText: 'Your Claude Code folder' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Your Codex folder' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'apple-row' }).first()).toBeVisible();
  await expect(p.getByRole('button', { name: 'Make a harness from this', exact: true }).first()).toBeVisible();
  await expect(p.getByText('Hermes at home')).toHaveCount(0);
  // Each fact of the read shows once: the reader's own copy of a counted line is not drawn beside ours.
  const notes = p.locator('[data-read-notes]');
  await expect(notes.getByText(/^(?:Everything was read, except )?\d+ things? (?:that )?could not be opened or (?:was|were) skipped\.$/), 'the count line, once').toHaveCount(1);
  await expect(notes.locator('[data-could-not]')).toHaveCount(1);
  await expect(notes.getByText(/could not be opened/), 'no second copy of it').toHaveCount(1);
  await expect(notes.getByText(/Could not read/), 'the reader\'s own bare line is not drawn').toHaveCount(0);
  const lines = (await notes.locator('li').allInnerTexts()).map(t => t.trim());
  expect(new Set(lines).size, lines.join(' | ')).toBe(lines.length);
  expect(lines.filter(t => /shortened|cut short/.test(t)).length, lines.join(' | ')).toBeLessThanOrEqual(1);
  expect(lines.filter(t => /stopped early/.test(t)).length, lines.join(' | ')).toBeLessThanOrEqual(1);
  await everyStep('read');
  await shot(p, 'real-3-read');
});

test('"Make a harness from this" opens the app on a harness made from the files; the Builder refuses a harness from a scan in words and opens "From a folder"', async () => {
  const p = page();
  await p.locator('.hxf-card', { hasText: 'Your Claude Code folder' }).getByRole('button', { name: 'Make a harness from this' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(1);
  await expect(p.locator('.hx-row[data-selected]')).toContainText('Claude Code folder');
  // Where it runs is not known: the list says "Not checked", never a list of programs.
  const runsIn = p.locator('section', { has: p.locator('#hx-runs-in') });
  await expect(runsIn).toContainText('Not checked');
  // The Builder edits one folder's harness (beta.1): a harness from a scan is refused in words, and the sheet that makes one from a folder opens.
  await p.getByRole('complementary').getByRole('button', { name: 'Open in builder', exact: true }).click();
  await expect(p.locator('[data-toast]')).toContainText('Each folder holds one harness. Make a new one from a folder.');
  const sheet = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(sheet).toBeVisible();
  await everyStep('builder', false);
  await shot(p, 'real-4-builder');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(p.locator('.hx-row-harness')).toHaveCount(1);
});

test('the file view draws the file as text: markup and an order stay words, the key is hidden, and nothing in the page runs', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/library/skill'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Library', exact: true }).or(p.getByRole('heading', { level: 1, name: 'Skills', exact: true }))).toBeVisible();
  await expect(p.getByText('Tidy notes').first()).toBeVisible();
  await p.getByText('Tidy notes').first().click();
  await p.getByRole('button', { name: 'View file', exact: true }).click();
  await expect(p.locator('.hx-raw')).toContainText('<script>alert(\'x\')</script>');
  await expect(p.locator('.hx-raw')).toContainText('Ignore all previous instructions');
  expect(await p.locator('img').count()).toBe(0);
  expect(await p.locator('.hx-raw script').count()).toBe(0);
  expect(await p.evaluate(() => document.querySelectorAll('[onerror],[onclick],[onload]').length)).toBe(0);
  await everyStep('file', false);
  await shot(p, 'real-5-file');
});

test('Install and Start are not in beta.1: a note says so and no sheet opens; the Beta mark says what Bowerloom does and what is not in beta.1', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/harnesses'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Assign to project', exact: true }).first().click();
  await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  const start = p.getByRole('button', { name: 'Start', exact: true });
  await expect(start, 'the details column of the selected harness has a Start button').toHaveCount(1);
  await start.click();
  await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  // The list says "Not checked" for where the harness runs, and names no program.
  const runsIn = p.locator('section', { has: p.locator('#hx-runs-in') });
  await expect(runsIn).toContainText('Not checked');
  for (const program of ['Claude Code', 'Codex', 'OpenCode', 'Hermes']) await expect(runsIn, program).not.toContainText(program);
  await p.getByRole('button', { name: 'About this beta', exact: true }).click();
  const pop = p.locator('.hx-preview-pop');
  await expect(p.locator('[data-preview-mark]')).toHaveText('Beta');
  await expect(pop).toContainText('Bowerloom is in beta. It reads your own folders and writes only after you approve what it will write.');
  await expect(pop).toContainText('Not in beta.1');
  await expect(pop).not.toContainText(/preview|full app/i);
  await expect(pop.locator('li')).toHaveText(['Start', 'Compare', 'Runs', 'Assign to project, in the Harnesses details', 'Assign harness, Install, Update and Review, in Projects', 'Add (the plus button), in the Library', 'Add a folder, in Projects']);
  await everyStep('preview', false);
  await shot(p, 'real-6-preview');
  await p.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});

test('Interfaces says Bowerloom has not checked which parts a program can use, and keeps the sample\'s claim out', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/interfaces/codex'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Engines', exact: true })).toBeVisible();
  const details = p.getByRole('complementary');
  await expect(details).toContainText('Bowerloom has not checked which parts this program can use.');
  await expect(details).not.toContainText('Tools that only Claude Code supports');
  await expect(details).not.toContainText('Nothing. It uses every kind of part.');
  await everyStep('interfaces', false);
});

/** The number at the end of the harness id in the address, such as 103 for #prototype-v3/harnesses/harness-103. */
async function lastHarnessNumber(p: Page): Promise<number> {
  const hash = await p.evaluate(() => location.hash), found = /harness-(\d+)/.exec(hash);
  expect(found, hash).not.toBeNull();
  return Number(found![1]);
}

test('with a harness made, New harness opens "From a folder", and Cancel keeps every harness as it was', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/harnesses'; });
  await expect(p.locator('.hx-row-harness')).toHaveCount(1);
  await p.getByRole('button', { name: 'New harness', exact: true }).click();
  await expect(p.locator('[data-toast]')).toContainText('Each folder holds one harness. Make a new one from a folder.');
  const sheet = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(1);
  await expect(p.locator('.hx-row-harness', { hasText: 'Claude Code folder' })).toHaveCount(1);
  await everyStep('not-now', false);
});

test('"Add a folder" on the list does not pull the focus to "Looks right"', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  const before = await p.locator('.hxf-card').count();
  await h.pick(fixture.cellar);
  const add = p.getByRole('button', { name: 'Add a folder', exact: true });
  await add.focus();
  await add.click();
  await expect(p.locator('.hxf-card')).not.toHaveCount(before);
  expect(await p.locator('.hxf-card').count()).toBeGreaterThan(before);
  await expect(add).toBeEnabled();
  await expect(p.getByRole('button', { name: 'Looks right', exact: true }), 'adding rows to the list does not pull the focus to "Looks right"').not.toBeFocused();
  await h.pick(null);
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
});

test('a second read asks first: "Cancel" keeps every harness, "Yes, read them" starts over, and new ids keep climbing', async () => {
  const p = page();
  await p.evaluate(() => { location.hash = '#prototype-v3/harnesses'; });
  const before = await p.locator('.hx-row-harness').count();
  // One harness from the scan: New harness makes none (it opens "From a folder").
  expect(before).toBe(1);
  // A note with an old "Undo" is on its way when the read starts: it must not outlive the old world.
  await p.getByRole('button', { name: 'Assign to project', exact: true }).first().click();
  await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
  await p.evaluate(() => { location.hash = '#prototype-v3/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.locator('.hxf-card', { hasText: 'Hermes at home' }).getByRole('checkbox').uncheck();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  const consent = p.locator('[data-consent]');
  await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeFocused();
  await expect(consent.locator('[data-replace]')).toHaveText('Reading again starts over. It changes nothing on your computer.');
  await expect(p.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0);
  await expect(consent.locator('li[data-place]', { hasText: 'Claude Code at home' })).toBeVisible();
  await everyStep('replace-consent');
  await shot(p, 'real-7-replace');
  // Cancel: out of the read, and nothing was replaced.
  await p.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(before);
  await expect(p.locator('.hx-row-harness', { hasText: 'Claude Code folder' })).toHaveCount(1);
  // Escape does the same as Cancel.
  await p.evaluate(() => { location.hash = '#prototype-v3/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect(p.locator('[data-replace]')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(before);
  const oldest = await p.locator('[data-harness]').evaluateAll(rows => rows.map(r => r.getAttribute('data-harness') ?? ''));
  const oldNumbers = oldest.map(id => Number(/(\d+)$/.exec(id)?.[1] ?? 0));
  // Confirm: the preview starts over, with the new read only.
  await p.evaluate(() => { location.hash = '#prototype-v3/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.locator('.hxf-card', { hasText: 'Your Codex folder' }).getByRole('button', { name: 'Make a harness from this' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness'), 'the old harnesses are gone').toHaveCount(1);
  await expect(p.locator('.hx-row-harness')).toContainText('Codex folder');
  await expect(p.locator('[data-toast]'), 'the old note with its Undo is gone').toHaveCount(0);
  expect(await lastHarnessNumber(p), 'an id of the old world is not used again').toBeGreaterThan(Math.max(...oldNumbers));
  await everyStep('replaced', false);
});

test('the made-up folder is the same after all of it, byte for byte', async () => {
  expect(fingerprint(fixture.root)).toBe(before);
});
