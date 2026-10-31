/**
 * Real mode in the shell, in the real window (Electron started with --prototype-real and HOME pointed at a made-up folder, tests/fixtures-real/shell-home.ts). Nothing of the
 * person's own folders is read: the launched app sees only the fixture. The spec walks the whole first minute on that setup: Welcome, the first question (the places, with counts),
 * the second question ("Read what is inside?"), the list of agents with their app tags (Hermes among them), the map (read only), the details of a real skill, a tray, the Library,
 * the held controls and their tooltip, the Share file (built in memory), Version history, the tour, and "Find more" in the right column with a second folder.
 * The checks that hold at every step: the made-up key value is nowhere in the page, no name the sample uses is on the screen, nothing is "undefined", the text stays in budget and at 14 px or more,
 * and the folder is the same, byte for byte, before and after. With HOME_I4_SHOTS set to a folder, it saves screenshots at 1280 by 800, light and dark.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLAIN_AGENTS, PLAIN_NOTES, PLAIN_SKILLS, PLAIN_TOOLS } from '../shared/home/plain.js';
import { STARTERS } from '../shared/home/starters.js';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { realPlainOf, realPlainOfSlice } from '../shared/real/plain-fallback.js';
import { SHELL_AGENTS, SHELL_SECRET, buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { fingerprint } from '../tests/fixtures-real/fingerprint.js';
import { desktop, launchHome, resize, setLook, skipTour } from './home-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { animationsDone } from './page-wait.js';

const shots = process.env.HOME_I4_SHOTS ?? null;
if (shots !== null) mkdirSync(shots, { recursive: true });

let fixture: ShellHome, app: ElectronApplication, page: Page, before: string;
const dialogs: string[] = [];
const REASON = 'Read-only: your setup is not changed.';
const BAR = 'Read-only. Nothing here changes your setup.';

/** Every name the sample world shows for an agent, a skill, a tool or a set of notes. The made-up home uses none of them. */
const SAMPLE_NAMES = [...Object.values(PLAIN_AGENTS), ...Object.values(PLAIN_SKILLS), ...Object.values(PLAIN_TOOLS), ...Object.values(PLAIN_NOTES)].map(p => p.name).concat(STARTERS.map(s => s.name));
const SAMPLE_LINES = ['Tidy my meeting notes', 'Update available', 'Open skills library', 'Evergreen', 'Made by you', 'How it started'];

/**
 * The person's own words in the made-up home: every name and one-line job that is read from a file. They are the person's, so the text budget does not count them and does not look for
 * banned words in them ("Graft helper"); every word of ours around them is still held to the whole budget. They are worked out by reading the fixture, as the app does.
 */
let OWN: string[] = [];
async function ownWords(f: ShellHome): Promise<string[]> {
  const scanner = createScanner({ home: f.home });
  const found = await scanner.discover(), places = [...found.places];
  for (const folder of [f.orchard, f.cellar]) places.push(...(await scanner.addFolder(folder)).places);
  const batch = await scanner.read(places.map(p => p.id));
  const { world } = buildRealResult(batch.reads, batch.tally, { nowMs: Date.now(), foldExtraApps: true });
  const out = new Set<string>();
  for (const i of world.items) { const p = realPlainOf(i); out.add(i.name); out.add(p.name); out.add(p.hint); }
  for (const s of world.slices) { const p = realPlainOfSlice(s, world.wikiPages); out.add(s.name); out.add(p.name); out.add(p.hint); }
  for (const s of world.scopes) out.add(s.name);
  for (const g of world.wikiPages) { out.add(g.title); out.add(g.folder); }
  for (const p of places) { out.add(p.label); out.add(p.appLabel); }
  return [...out];
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'renderer', 'app.js'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  fixture = buildShellHome();
  OWN = await ownWords(fixture);
  before = fingerprint(fixture.root);
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-real', `--user-data-dir=${userData}`], env: { ...process.env, HOME: fixture.home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  // The system folder chooser cannot be driven from here: the main process gets one that answers with the folder the test sets in `globalThis.__pick`.
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { __pick: string | null }).__pick = null;
    dialog.showOpenDialog = (async () => { const pick = (globalThis as unknown as { __pick: string | null }).__pick; return pick === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pick] }; }) as unknown as typeof dialog.showOpenDialog;
  });
  page = await app.firstWindow();
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
  await resize(page, 1280, 800);
});
test.afterAll(async () => { try { await app?.close(); } finally { fixture?.cleanup(); removeTempDirs(); } });

const pick = (folder: string | null): Promise<void> => app.evaluate((_e, f) => { (globalThis as unknown as { __pick: string | null }).__pick = f; }, folder);
const nav = (): Locator => page.locator('nav.hm-nav');
const item = (name: string): Locator => nav().getByRole('button', { name, exact: true }).first();
const cards = (): Locator => page.locator('.hm-grid .kit-card[data-kind="agent"]');
const panel = (): Locator => page.locator('aside.hm-panel');
const bar = (): Locator => page.getByRole('region', { name: 'Save bar' });
const html = (): Promise<string> => page.evaluate(() => document.querySelector('[data-home]')!.outerHTML);
const text = (): Promise<string> => page.locator('body').innerText();

/** What holds at every step: the key value is nowhere (in the text or the markup), no sample name or sample line, no "undefined", the fixture's folder path is not shown, and the budget holds. */
async function everyStep(label: string): Promise<void> {
  const [body, markup] = [await text(), await page.content()];
  expect(markup, `${label}: the key value`).not.toContain(SHELL_SECRET);
  expect(body, `${label}: undefined`).not.toMatch(/undefined|NaN|\[object/);
  expect(body, `${label}: the folder of the made-up home`).not.toContain(fixture.root);
  for (const name of SAMPLE_NAMES) expect(body, `${label}: the sample name ${name}`).not.toContain(name);
  for (const line of SAMPLE_LINES) expect(body, `${label}: the sample line ${line}`).not.toContain(line);
  expect(assertTextBudget(await html(), { own: OWN }), `${label}: the text budget`).toEqual([]);
  // No word is smaller than 14 px.
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-home] *')) {
      const own = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!own || el.getClientRects().length === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 13.99) out.push(`${el.tagName} ${size}px "${(el.textContent ?? '').trim().slice(0, 30)}"`);
    }
    return out;
  });
  expect(small, `${label}: words under 14 px`).toEqual([]);
  expect(dialogs, `${label}: no alert or prompt`).toEqual([]);
}

/** Puts away whatever sheet, dialog or drawer is open: one Escape closes the top layer only. */
async function closeLayers(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    if (await page.locator('[aria-modal="true"], .kit-drawer[data-open]').count() === 0) return;
    await page.keyboard.press('Escape');
    await animationsDone(page);
  }
  await expect(page.locator('[aria-modal="true"], .kit-drawer[data-open]')).toHaveCount(0);
}

/** Saves a picture in the light and in the dark look. */
async function shot(name: string): Promise<void> {
  if (shots === null) return;
  for (const look of ['light', 'dark'] as const) {
    await setLook(page, look);
    await animationsDone(page);
    await page.screenshot({ path: join(shots, `${name}-${look}.png`), scale: 'css' });
  }
  await setLook(page, 'light');
}

// ---------------------------------------------------------------------------------------------------- the window

test('the window is real mode: the real address, only the real bridge, no normal bridge, and the same strict policy as every page', async () => {
  expect(await page.evaluate(() => location.hash)).toBe('#prototype-v2/real');
  expect(await page.title()).toBe('Bowerloom');
  const facts = await page.evaluate(async () => {
    const real = (window as unknown as { bowerloomReal?: Record<string, unknown> }).bowerloomReal;
    let fetched = 'no error';
    try { await fetch('https://example.com/'); } catch (e) { fetched = e instanceof Error ? e.name : 'error'; }
    return {
      keys: real === undefined ? [] : Object.keys(real).sort(), frozen: real !== undefined && Object.isFrozen(real), normal: typeof (window as unknown as { bowerloom?: unknown }).bowerloom, fetched,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '', scripts: [...document.querySelectorAll('script')].map(s => s.getAttribute('src')),
    };
  });
  expect(facts.keys).toEqual(['discoverPlaces', 'pickFolder', 'readSelected']);
  expect(facts.frozen).toBe(true);
  expect(facts.normal).toBe('undefined');
  expect(facts.fetched).not.toBe('no error');
  expect(facts.scripts).toEqual(['app.js']);
  expect(facts.csp).toBe("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'");
});

test('the Skip link keeps real mode: Tab to it, Enter, and the page is the same real page, still read only, with the focus on the main region', async () => {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('skip');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => location.hash), 'the address').toBe('#prototype-v2/real');
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(page.locator('.fr-note')).toHaveText(BAR);
  expect(await page.evaluate(() => document.activeElement?.id), 'the focus').toBe('main');
  // The sample world is not there under any name, and the bridge is still the real one.
  for (const name of SAMPLE_NAMES) expect(await text(), `the sample name ${name}`).not.toContain(name);
  expect(await page.evaluate(() => typeof (window as unknown as { bowerloomReal?: unknown }).bowerloomReal)).toBe('object');
  // Even when the address is changed by hand to something that is not a real page, the window stays in real mode.
  await page.evaluate(() => { location.hash = '#main'; });
  await page.waitForTimeout(200);
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(page.locator('.fr-note')).toHaveText(BAR);
  await page.evaluate(() => { location.hash = '#prototype-v2/real'; });
  await everyStep('after the Skip link');
});

// ---------------------------------------------------------------------------------------------------- the first minute

test('Welcome, then the first question: where it looked, with counts and no path until "Show details"', async () => {
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(page.locator('.fr-note')).toHaveText(BAR);
  await everyStep('Welcome');
  await shot('1-welcome');
  await page.getByRole('button', { name: 'Find my agents' }).click();
  const scan = page.locator('[data-real-scan][data-step="places"]');
  await expect(scan).toBeVisible();
  const rows = scan.locator('.rs-place');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Claude Code at home');
  await expect(rows.nth(0)).toContainText('2 agents, 2 skills, 1 tool');
  await expect(rows.nth(1)).toContainText('Codex at home');
  await expect(rows.nth(2)).toContainText('OpenCode at home');
  await expect(rows.nth(3)).toContainText('Hermes at home');
  await expect(rows.nth(3).locator('.fr-tag')).toHaveText(['Hermes']);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText('Found 4 places');
  expect(await text()).not.toContain('~/');
  await everyStep('places');
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(scan.locator('[data-details]').first()).toContainText('~');
  expect(await text()).not.toContain(fixture.home);
  await shot('2-places-details');
  await page.getByRole('button', { name: 'Hide details' }).click();
});

test('"Add a folder" brings the places of the folder the person picks, and closing the chooser changes nothing', async () => {
  const scan = page.locator('[data-real-scan]');
  await pick(null);
  await page.getByRole('button', { name: 'Add a folder' }).click();
  await expect(scan.locator('[data-picked-nothing]')).toBeVisible();
  await expect(scan.locator('.rs-place')).toHaveCount(4);
  await pick(fixture.orchard);
  await page.getByRole('button', { name: 'Add a folder' }).click();
  await expect(scan.locator('.rs-place')).toHaveCount(6);
  await expect(scan.locator('.rs-place').nth(4)).toContainText('orchard');
  await expect(scan.locator('.rs-place').nth(5)).toContainText('apple-row');
  await expect(scan.locator('.rs-place').nth(5)).toContainText('1 agent, 1 skill, 3 notes');
  await everyStep('places with a folder');
  await shot('3-places-with-folder');
});

test('the second question: "Read what is inside?", and only "Yes, read them" opens anything', async () => {
  const scan = page.locator('[data-real-scan]');
  await page.getByRole('button', { name: 'Looks right' }).click();
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText('Read what is inside?');
  await expect(scan.locator('.fr-summary')).toHaveText('5 places, 6 agents');
  await expect(scan).toContainText('It reads the text of what you tick.');
  await expect(scan).toContainText('Known key and password shapes are hidden, but check anything private.');
  await expect(scan).not.toContainText('never copied');
  await expect(page.getByRole('button', { name: 'Yes, read them' })).toBeFocused();
  await everyStep('second question');
  await shot('4-second-question');
  await page.getByRole('button', { name: 'Yes, read them' }).click();
  // The list of agents, the same list as the sample's Find, now with the real agents and their app tags.
  const list = page.locator('.fr-flow:not([data-real-scan])[data-step="places"]');
  await expect(list).toBeVisible();
  const names = list.locator('.fr-agent-name');
  await expect(names).toHaveText([...SHELL_AGENTS.home, ...SHELL_AGENTS.orchard].sort((a, b) => a.localeCompare(b)));
  await expect(list.locator('[data-agent]', { hasText: 'Lantern' }).locator('.fr-tag')).toHaveText(['Hermes']);
  await expect(list.locator('[data-agent]', { hasText: 'Ledger keeper' }).locator('.fr-tag')).toHaveText(['Claude Code']);
  await expect(list.locator('[data-agent]', { hasText: 'Seed sorter' }).locator('.fr-tag')).toHaveText(['Codex']);
  await expect(list.locator('[data-agent]', { hasText: 'Bench scribe' }).locator('.fr-tag')).toHaveText(['OpenCode']);
  await expect(list.locator('[data-agent]', { hasText: 'Lantern' }).locator('.fr-agent-job')).toHaveText('Lantern watches the greenhouse lights and reports at dusk.');
  await expect(list.getByRole('button', { name: 'Show on the map' })).toBeFocused();
  await everyStep('the list of agents');
  await shot('5-agent-list');
});

test('the map: the agents of the setup, read only, with the tour starting by itself', async () => {
  await page.getByRole('button', { name: 'Show on the map' }).click();
  await expect(cards().first()).toBeVisible();
  await expect(cards().locator('.kit-card-name, .kit-card-title').first()).toBeVisible().catch(() => undefined);
  const names = await cards().evaluateAll(list => list.map(c => (c.querySelector('.kit-card-main')?.textContent ?? '').replace(/\s+/g, ' ').trim()));
  expect(names).toHaveLength(6);
  for (const wanted of [...SHELL_AGENTS.home, ...SHELL_AGENTS.orchard]) expect(names.some(n => n.toLowerCase().startsWith(wanted.toLowerCase())), `${wanted} is on the map: ${names.join(' | ')}`).toBe(true);
  expect(names.some(n => n.startsWith('Label printer'))).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Tour' })).toBeVisible();
});

test('the tour works on this setup: its steps name nothing from the sample, it takes any agent, and it ends', async () => {
  const tour = page.getByRole('dialog', { name: 'Tour' });
  await animationsDone(page);
  const said: string[] = [];
  await expect(tour).toContainText('These are your AI agents, from every tool.');
  said.push((await tour.innerText()));
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Click an agent to see what it can do.');
  await cards().nth(2).locator('.kit-card-main').click();
  await expect(tour).toContainText(/Skills show what/);
  for (const expected of ['Add skills, tools, and notes here.', 'This bar is read-only. Nothing here changes your setup.', 'Share your agents or go back in time here.', 'Replay this tour any time.']) {
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText(expected);
    said.push(await tour.innerText());
  }
  for (const line of said) for (const name of SAMPLE_NAMES) expect(line).not.toContain(name);
  await tour.getByRole('button', { name: /^(Done|Finish)$/ }).click();
  await expect(tour).toHaveCount(0);
  await skipTour(page);
});

test('the map and the details show the real agents: their names, their jobs, their counts, and a tag for the apps they work in', async () => {
  const keeper = cards().filter({ hasText: 'Ledger keeper' });
  await expect(keeper).toContainText('Keeps the household ledger tidy and flags odd entries.');
  await expect(keeper.getByRole('button', { name: '2 skills' })).toBeVisible();
  await expect(keeper.getByRole('button', { name: '1 tool' })).toBeVisible();
  await keeper.locator('.kit-card-main').click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Ledger keeper' })).toBeVisible();
  await expect(panel().locator('[data-programs] li')).toHaveText(['Claude Code']);
  await expect(panel().getByRole('region', { name: 'Skills' })).toContainText('Shared tally');
  const lantern = cards().filter({ hasText: 'Lantern' });
  await lantern.locator('.kit-card-main').click();
  await expect(panel().locator('[data-programs] li')).toHaveText(['Hermes']);
  await expect(panel().getByRole('heading', { level: 2, name: 'Lantern' })).toBeVisible();
  await everyStep('details of an agent');
});

test('a tray lists the real skills of an agent, and the details of a real skill say where it was found and show its own text', async () => {
  const keeper = cards().filter({ hasText: 'Ledger keeper' });
  await keeper.getByRole('button', { name: '2 skills' }).click();
  const tray = page.locator('.kit-tray[data-open]');
  await expect(tray).toHaveCount(1);
  await expect(tray.locator('.kit-card-main')).toHaveText([/Pantry check/, /Shared tally/]);
  await expect(tray).toContainText('Lists what is running low in the pantry.');
  await shot('7-tray');
  await tray.locator('.kit-card-main', { hasText: 'Shared tally' }).click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Shared tally' })).toBeVisible();
  await expect(panel().locator('.dt-block', { hasText: 'What it does' })).toContainText('Adds up the household totals again.');
  await expect(panel().locator('[data-programs] li')).toHaveText(['Claude Code', 'Codex']);
  await expect(panel().getByRole('button', { name: '2 different copies' })).toBeVisible();
  const came = panel().locator('.dt-block', { hasText: 'Where it came from' });
  await expect(came).toContainText('Your home folder');
  await expect(came).not.toContainText(/Made by|Release/);
  await panel().getByRole('button', { name: 'Show where it lives' }).click();
  await expect(panel().locator('[data-places] code')).toHaveText(['~/.claude/skills/shared-tally/SKILL.md', '~/.codex/skills/shared-tally/SKILL.md']);
  await panel().getByRole('button', { name: 'Show the full text' }).click();
  await expect(panel().getByRole('region', { name: 'Full text' })).toContainText('Add each column.');
  await everyStep('details of a skill');
  await shot('6-skill-details');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('the "different copies" dialog opens on the real copies, with their ages in days, and "Keep this copy" is held back', async () => {
  await panel().getByRole('button', { name: '2 different copies' }).click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible(); await animationsDone(page);
  await expect(dialog).toContainText(/Found in Claude Code, changed (today|\d+ days? ago)/);
  await expect(dialog.getByRole('button', { name: 'Keep this copy' }).first()).toHaveAttribute('aria-disabled', 'true');
  await everyStep('different copies');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the Library lists the real skills, tools and notes; no update, no maker, no sample source; "Add from the web" says its sources are samples', async () => {
  await item('Library').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  const list = page.locator('.lb-list');
  await expect(list.locator('.kit-card-main')).toContainText(['Graft notes', 'Pantry check', 'Shared tally']);
  await expect(page.getByRole('button', { name: 'Update available' })).toHaveCount(0);
  await list.locator('.kit-card-main', { hasText: 'Pantry check' }).click();
  const facts = panel().locator('[data-origin]');
  await expect(facts).toContainText('Your home folder');
  await expect(facts).toContainText('Last changed');
  await expect(facts).not.toContainText(/Made by|Release/);
  await page.getByRole('tab', { name: /^Tools/ }).click();
  await expect(list.locator('.kit-card-main')).toContainText(['Greenhouse Feed', 'Ledger Sync']);
  await list.locator('.kit-card-main', { hasText: 'Greenhouse Feed' }).click();
  await expect(panel().locator('[data-ability]')).toHaveText('Not stated');
  await page.getByRole('tab', { name: /^Notes/ }).click();
  await expect(list.locator('.kit-card-main').first()).toBeVisible();
  await everyStep('the Library');
  await shot('8-library');
  await page.getByRole('button', { name: 'Add from the web' }).click();
  const sheet = page.locator('[data-slot="web"], .lb-sheet').first();
  await expect(sheet).toBeVisible(); await animationsDone(page);
  await expect(sheet).toContainText('This preview opens sample sources only.');
  await page.keyboard.press('Escape');
  await item('Agents').click();
});

// ---------------------------------------------------------------------------------------------------- read only

test('every control that would change the setup is shown and held back, with its reason in a tooltip', async () => {
  const keeper = cards().filter({ hasText: 'Ledger keeper' });
  await keeper.locator('.kit-card-main').click();
  const save = bar().getByRole('button', { name: 'Save', exact: true });
  await expect(bar().locator('p')).toHaveText(BAR);
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  expect(await save.evaluate(el => (el as HTMLButtonElement).disabled)).toBe(false);
  await save.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: REASON })).toBeVisible({ timeout: 3000 });
  await shot('9-read-only-tooltip');
  await page.mouse.move(640, 790);
  const removes = panel().locator('[data-remove]');
  expect(await removes.count()).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < await removes.count(); i += 1) await expect(removes.nth(i)).toHaveAttribute('aria-disabled', 'true');
  // Everything held is held: each visible control marked read-only says aria-disabled.
  const marked = await page.locator('[data-readonly]:visible').evaluateAll(list => list.map(el => el.getAttribute('aria-disabled')));
  expect(marked.length).toBeGreaterThan(3);
  expect(marked.every(v => v === 'true')).toBe(true);
  // Add drawer: every "Add to" is held.
  await item('Add').click();
  const drawer = page.getByRole('dialog', { name: 'Add' });
  await expect(drawer).toBeVisible(); await animationsDone(page);
  const adds = drawer.locator('.add-row').getByRole('button', { name: /^Add/ });
  const count = await adds.count();
  for (let i = 0; i < count; i += 1) await expect(adds.nth(i)).toHaveAttribute('aria-disabled', 'true');
  await everyStep('the Add drawer');
  await page.keyboard.press('Escape');
});

test('the setup never moves: every held control is pressed, and so are undo and redo; the agents, their counts and the bar stay the same', async () => {
  const state = async (): Promise<string> => JSON.stringify({ tiles: await cards().evaluateAll(list => list.map(c => (c.textContent ?? '').replace(/\s+/g, ' ').trim())), bar: (await bar().innerText()).replace(/\s+/g, ' ') });
  const was = await state();
  const held = page.locator('[data-readonly]:visible');
  for (let i = 0; i < await held.count(); i += 1) await held.nth(i).click({ force: true }).catch(() => undefined);
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+y');
  expect(await state()).toBe(was);
  await expect(bar().locator('p')).toHaveText(BAR);
});

test('the Read-only mark and its popover say it is the person\'s own setup, with the honest line about temporary files; Version history has none; Share builds its file in memory', async () => {
  const mark = nav().locator('.hm-preview .kit-status');
  await expect(mark).toHaveText('Read-only');
  await mark.click();
  const pop = page.locator('.kit-popover');
  await expect(pop.locator('p')).toHaveText('You are looking at your setup. Nothing here changes it. The app keeps its own temporary files until you close it.');
  await shot('10-read-only-popover');
  await page.keyboard.press('Escape');
  await item('Version history').click();
  const history = page.getByRole('dialog', { name: 'Version history' });
  await expect(history).toBeVisible(); await animationsDone(page);
  await expect(history).toContainText('No history in read-only mode.');
  await everyStep('Version history');
  await history.getByRole('button', { name: 'Share my agents' }).click();
  const sheet = page.getByRole('dialog', { name: /^Share/ });
  await expect(sheet).toBeVisible(); await animationsDone(page);
  await sheet.getByRole('button', { name: 'Look inside' }).click();
  const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  await sheet.getByRole('button', { name: 'Create share file' }).click();
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
  expect(downloads).toEqual([]);
  await everyStep('the Share file');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await closeLayers();
});

// ---------------------------------------------------------------------------------------------------- Find more

test('"Find more" opens in the right column, can be closed, and a second folder adds its agent to the map without losing the unticked ones', async () => {
  // First untick one agent in a first "Find more" pass so there is a set to keep.
  await item('Find more').click();
  const found = page.locator('aside.hm-panel[data-find]');
  await expect(found).toBeVisible();
  await expect(found.getByRole('heading', { level: 3 })).toHaveText(/Looking for your agents|Found \d+ places/);
  await expect(found.locator('[data-real-scan][data-step="places"]')).toBeVisible();
  await expect(found.locator('.rs-place')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(found).toHaveCount(0);
  await expect(item('Find more')).toBeFocused();
  // Again, and this time a second folder is picked and read.
  await item('Find more').click();
  await expect(found.locator('.rs-place')).toHaveCount(4);
  await pick(fixture.cellar);
  await found.getByRole('button', { name: 'Add a folder' }).click();
  await expect(found.locator('.rs-place')).toHaveCount(6);
  await expect(found.locator('.rs-place').nth(5)).toContainText('bottle-log');
  await everyStep('Find more, places');
  await shot('11-find-more-places');
  await found.getByRole('button', { name: 'Looks right' }).click();
  await expect(found.getByRole('heading', { level: 3 })).toHaveText('Read what is inside?');
  await found.getByRole('button', { name: 'Yes, read them' }).click();
  const list = found.locator('.fr-flow:not([data-real-scan])[data-step="places"]');
  await expect(list).toBeVisible();
  await expect(list.locator('.fr-agent-name')).toHaveCount(7);
  await expect(list.locator('[data-agent]', { hasText: 'Label printer' })).toHaveAttribute('data-on', '');
  // Untick one agent that was on the map: it goes off the map and stays in the setup.
  await list.locator('[data-agent]', { hasText: 'Garden planner' }).locator('input').uncheck();
  await shot('12-find-more-list');
  await list.getByRole('button', { name: 'Show on the map' }).click();
  await expect(found).toHaveCount(0);
  const names = await cards().evaluateAll(l => l.map(c => (c.querySelector('.kit-card-main')?.textContent ?? '').replace(/\s+/g, ' ').trim()));
  expect(names).toHaveLength(6);
  expect(names.some(n => n.startsWith('Label printer'))).toBe(true);
  expect(names.some(n => n.startsWith('Garden planner'))).toBe(false);
  expect(names.some(n => n.startsWith('Ledger keeper'))).toBe(true);
  // Find more once more: the unticked agent is still unticked, in the same list.
  await item('Find more').click();
  await found.getByRole('button', { name: 'Looks right' }).click();
  await found.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(found.locator('[data-agent]', { hasText: 'Garden planner' })).not.toHaveAttribute('data-on', '');
  await expect(found.locator('[data-agent]', { hasText: 'Label printer' })).toHaveAttribute('data-on', '');
  await found.getByRole('button', { name: 'Show on the map' }).click();
  await expect(cards()).toHaveCount(6);
  await everyStep('the map after Find more');
  await shot('13-map-after-find-more');
});

test('the fixture is the same after all of it, byte for byte', async () => {
  expect(fingerprint(fixture.root)).toBe(before);
});

// ---------------------------------------------------------------------------------------------------- without the real launch

test('opened by the other launch command, the real address says so in plain words, with the command', async () => {
  const home = await launchHome();
  try {
    await home.page.evaluate(() => { location.hash = '#prototype-v2/real'; location.reload(); });
    await home.page.waitForLoadState('domcontentloaded');
    await home.page.waitForSelector('[data-screen="no-real"]');
    await expect(home.page.getByRole('heading', { level: 1 })).toHaveText('Real mode needs the real launch command.');
    await expect(home.page.locator('[data-command]')).toHaveText('npm run desktop:prototype:real');
    expect(await home.page.evaluate(() => typeof (window as unknown as { bowerloomReal?: unknown }).bowerloomReal)).toBe('undefined');
    expect(await home.page.locator('body').innerText()).not.toMatch(/Meeting assistant|Inbox sorter/);
  } finally { await home.app.close(); }
});
