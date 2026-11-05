/**
 * Takes the desktop screenshots of the documentation (apps/docs/src/visuals), light and dark, 16:10, and writes them as WebP files to apps/docs/public/visuals.
 * The ids come from tools/docs-visuals/plan.json: every entry of kind `shot` has one recipe below, and a missing recipe fails the run. Run it by hand, after `npm run build` at the root:
 *   DOCS_SHOTS=1 npx playwright test --config playwright.config.ts e2e/docs-shots.spec.ts      (from apps/desktop; the tools/docs-visuals/capture-shots.mjs script takes the machine lock first)
 * Without DOCS_SHOTS=1 every test here is skipped, so a normal e2e run never rewrites the images. DOCS_SHOTS_DIR changes where they go, and DOCS_SHOTS_ONLY (a comma list of ids) takes only those.
 *
 * It follows landing-shots.spec.ts: the app starts the default way (real mode) on a made-up home, hidden (e2e/hidden.ts), at twice the size, with the same quality. Every name comes from
 * landing-shots-fixture.ts or from this file. Before each picture the test reads the text that the picture shows, and fails when it holds this computer's user name, home folder, host name or temp folder.
 */
import { expect, test } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { GIT, NO_GIT_REASON } from './harness-notes-support.js';
import { desktop } from './harness-page.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { animationsDone } from './page-wait.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { weeklyFolder } from './landing-shots-fixture.js';
import { buildMadeUpHome } from '../tools/made-up-home.js';
import type { MadeUpHome } from '../tools/made-up-home.js';

test.skip(process.env.DOCS_SHOTS !== '1', 'Set DOCS_SHOTS=1 to take the documentation shots.');

const OUT = process.env.DOCS_SHOTS_DIR ?? join(desktop, '..', 'docs', 'public', 'visuals');
const PLAN = JSON.parse(readFileSync(join(desktop, '..', '..', 'tools', 'docs-visuals', 'plan.json'), 'utf8')) as { id: string; kind: string }[];
const IDS = PLAN.filter(entry => entry.kind === 'shot').map(entry => entry.id);
const ONLY = (process.env.DOCS_SHOTS_ONLY ?? '').split(',').map(id => id.trim()).filter(id => id !== '');
const wanted = (...ids: string[]): boolean => ids.some(id => IDS.includes(id) && (ONLY.length === 0 || ONLY.includes(id)));
const SCHEMES = ['light', 'dark'] as const;
/** WebP quality (0 to 100) for every picture, the same as the landing shots. */
const QUALITY = 90;
/** Every picture is drawn at twice its size in CSS pixels, so the text stays sharp on a screen with a high pixel density. */
const DENSITY = 2;
const SMALL = { width: 1100, height: 688 };
const LARGE = { width: 1280, height: 800 };

let h: RealHarness | undefined, home: string;
const page = (): Page => h!.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); mkdirSync(OUT, { recursive: true }); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); h = undefined; });

/** A private made-up home. Its real path is looked up, because the temp folder of this computer is a link. */
function newHome(): string {
  const dir = realpathSync(tempDir('bowerloom-shots-home-'));
  chmodSync(dir, 0o700);
  return dir;
}

/** Starts the app the default way on `home`, at `route`, with the window as large as the shot needs. */
async function start(route: string, size: { width: number; height: number }, options: { freshTour?: boolean } = {}): Promise<Page> {
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false, options);
  const p = page();
  await frame(p, size);
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await p.evaluate(r => { location.hash = `#app/${r}`; location.reload(); }, route);
  await p.waitForLoadState('domcontentloaded');
  await p.waitForSelector('[data-home]');
  return p;
}

/** The words that must never be in a picture. */
function forbidden(): string[] {
  const words = [userInfo().username, homedir(), hostname(), tmpdir(), '/var/folders', '/private/var', home, ...(basename(home) === 'home' ? [] : [basename(home)])];
  return [...new Set(words.filter(word => word.length >= 4))];
}

/**
 * The text that a picture of the page shows: every text node whose box lies inside the window and inside each box that clips or scrolls it. Text under a scrolled-away
 * edge, a closed drawer, or a hidden element is left out, because the picture does not show it.
 */
function shownText(p: Page): Promise<string> {
  return p.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (text === '' || el === null || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      const inside = (box: DOMRect, r: DOMRect): boolean => r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
      const view = new DOMRect(0, 0, innerWidth, innerHeight);
      const shown = rects.some(r => {
        if (!inside(view, r)) return false;
        for (let up: HTMLElement | null = el; up !== null; up = up.parentElement) {
          const style = getComputedStyle(up);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (up !== document.body && /(auto|scroll|hidden|clip)/.test(style.overflowY + style.overflowX) && !inside(up.getBoundingClientRect(), r)) return false;
        }
        return true;
      });
      if (shown) out.push(text);
      // The accessible names and values that an input shows are text too.
      if (shown && el instanceof HTMLElement) out.push(el.getAttribute('title') ?? '');
    }
    for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) out.push(input.value);
    return out.join('\n');
  });
}

/** Fails when the picture would show something private. `label` names the picture in the failure. */
async function assertClean(p: Page, label: string): Promise<void> {
  const text = await shownText(p);
  for (const word of forbidden()) expect(text.includes(word), `${label}: the picture shows text that holds a private word (${word.length} characters long)`).toBe(false);
  expect(text, `${label}: a path outside the made-up home`).not.toMatch(/\/Users\/|\/home\/[a-z]|C:\\\\Users/);
  expect(text, `${label}: a broken value`).not.toMatch(/undefined|NaN|\[object/);
}

const sessions = new WeakMap<Page, CDPSession>();
/** Sets the size of the page in CSS pixels and draws it at twice that, through the browser's own device settings. */
async function frame(p: Page, size: { width: number; height: number }): Promise<void> {
  await p.setViewportSize(size);
  let cdp = sessions.get(p);
  if (cdp === undefined) { cdp = await p.context().newCDPSession(p); sessions.set(p, cdp); }
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: DENSITY, mobile: false });
}

/** The page as a WebP picture, drawn by the browser itself, so the tool needs no image package. */
async function capture(p: Page): Promise<Buffer> {
  const shot = await sessions.get(p)!.send('Page.captureScreenshot', { format: 'webp', quality: QUALITY });
  return Buffer.from(shot.data, 'base64');
}

/** Takes the page as it is in light and in dark, checks the text of each, and writes `<name>-light.webp` and `<name>-dark.webp`. */
async function snap(p: Page, name: string): Promise<void> {
  for (const scheme of SCHEMES) {
    await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
    await animationsDone(p);
    await assertClean(p, `${name}-${scheme}`);
    const webp = await capture(p);
    expect(webp.byteLength, `${name}-${scheme}: size in bytes`).toBeLessThan(300 * 1024);
    writeFileSync(join(OUT, `${name}-${scheme}.webp`), webp);
  }
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
}

/** Waits until the graph has stopped moving: every node keeps its place for 15 frames in a row. */
async function graphSettled(p: Page): Promise<void> {
  await p.evaluate(() => new Promise<void>((resolve, reject) => {
    let last = '', same = 0, tries = 0;
    const tick = (): void => {
      const now = [...document.querySelectorAll('.hx-node')].map(n => { const b = n.getBoundingClientRect(); return `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)}`; }).join('|');
      same = now === last && now !== '' ? same + 1 : 0;
      last = now; tries += 1;
      if (same >= 15) resolve(); else if (tries > 900) reject(new Error('The graph never stood still.')); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

const node = (p: Page, id: string): Locator => p.locator(`.hx-node[data-node="${id}"]`);
const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });


const put = (dir: string, rel: string, text: string): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

/** Opens the folder's harness in the Builder, zoomed out, with the graph at rest. */
async function openBuilder(dir: string, size = SMALL): Promise<Page> {
  const p = await start('harnesses', size);
  const folders = p.locator('[data-section="folders"]');
  await h!.pick(dir);
  await folders.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await folders.getByRole('button', { name: /^Open .* in the builder$/ }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'weekly' })).toBeVisible();
  await expect(node(p, 'agent:drafter')).toBeVisible();
  await p.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await graphSettled(p);
  const pane = (await p.locator('.hx-canvas').boundingBox())!;
  await p.mouse.move(pane.x + pane.width * 0.3, pane.y + pane.height * 0.2);
  await p.mouse.wheel(0, 110);
  await graphSettled(p);
  return p;
}

/** A made-up home of the app's own tests: Claude Code and Codex at home, and three projects. Every name in it is invented. */
function madeUp(): MadeUpHome {
  const made = buildMadeUpHome(tempDir('bowerloom-shots-made-'), { git: null });
  home = made.home;
  return made;
}

/** Starts the app on a made-up home and goes through the first run: the list of places (with the folder of projects added), the question, and the read. `stop` ends the run at a step. */
async function firstRun(made: MadeUpHome, stop: 'welcome' | 'choose' | 'read' | 'overview'): Promise<Page> {
  h = await launchReal(made.home, { XDG_STATE_HOME: join(made.home, '.local', 'state') }, false, { freshTour: false });
  const p = page();
  await frame(p, SMALL);
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await p.evaluate(() => { location.hash = '#app/'; location.reload(); });
  await p.waitForLoadState('domcontentloaded');
  await p.waitForSelector('[data-home]');
  if (stop === 'welcome') return p;
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await h.pick(made.projects);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 6 places' })).toBeVisible();
  if (stop === 'choose') return p;
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.locator('[data-count]')).toContainText('parts in all', { timeout: 20_000 });
  if (stop === 'read') return p;
  await p.getByRole('button', { name: /^Make all/ }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
  return p;
}

const away = (p: Page): Promise<void> => p.mouse.move(1, SMALL.height - 1);

test('app-welcome: the welcome screen of a first start', async () => {
  test.skip(!wanted('app-welcome'));
  test.setTimeout(180_000);
  const p = await firstRun(madeUp(), 'welcome');
  await away(p);
  await snap(p, 'app-welcome');
});

test('app-find-files: the list of what the first read found', async () => {
  test.skip(!wanted('app-find-files'));
  test.setTimeout(180_000);
  const p = await firstRun(madeUp(), 'choose');
  await away(p);
  await snap(p, 'app-find-files');
});

test('app-overview, app-engines, app-install-history and app-help: the screens after the first run', async () => {
  test.skip(!wanted('app-overview', 'app-engines', 'app-install-history', 'app-help'));
  test.setTimeout(240_000);
  const p = await firstRun(madeUp(), 'overview');
  const expand = p.getByRole('button', { name: 'Expand all', exact: true });
  if (await expand.count() > 0 && await expand.isVisible()) await expand.click();
  await graphSettled(p).catch(() => undefined);
  await away(p);
  if (wanted('app-overview')) await snap(p, 'app-overview');
  for (const [id, route] of [['app-engines', 'interfaces'], ['app-install-history', 'history'], ['app-help', 'help']] as const) {
    if (!wanted(id)) continue;
    await p.evaluate(r => { location.hash = `#app/${r}`; }, route);
    await p.waitForSelector('[data-home]');
    await animationsDone(p);
    await away(p);
    await snap(p, id);
  }
});

test('app-adopt-sheet: New harness from a folder, at the review step', async () => {
  test.skip(!wanted('app-adopt-sheet'));
  test.setTimeout(180_000);
  const dir = madeUp().ferry;
  const p = await start('projects', LARGE);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'New harness from a folder' });
  await h!.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await p.mouse.move(1, LARGE.height - 1);
  await snap(p, 'app-adopt-sheet');
});

test('app-install-review: the install review for both engines', async () => {
  test.skip(!wanted('app-install-review'));
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { skills: [], agents: [], servers: ['plain', 'home'] });
  const p = await start('projects', LARGE);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await h!.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
  await expect(s.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const lines = s.locator('[data-section="approve-lines"] [data-tick]');
  await expect(lines).toHaveCount(1);
  await lines.first().getByRole('checkbox').check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  for (const word of ['Exact', 'Translated', 'Weakened', 'Absent']) await expect(s.locator('[data-engine]').getByText(word, { exact: true }).first()).toBeVisible();
  await s.locator('.hx-sheet-body').evaluate(body => {
    const card = body.querySelector('[data-engine="codex"]')!;
    body.scrollTop += card.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
  });
  await snap(p, 'app-install-review');
});

test('app-builder and app-save-review: the Builder with one link, then the Save review', async () => {
  test.skip(!wanted('app-builder', 'app-save-review'));
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const p = await openBuilder(dir);
  const skill = (await node(p, 'skill:summarize').boundingBox())!, agent = (await node(p, 'agent:checker').boundingBox())!;
  await p.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await p.mouse.down();
  await p.mouse.move(skill.x + skill.width / 2 - 10, skill.y + skill.height / 2 + 4, { steps: 4 });
  await p.mouse.move(agent.x + agent.width / 2, agent.y + agent.height / 2, { steps: 12 });
  await p.mouse.up();
  await expect(p.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await p.mouse.move(1, 1);
  await graphSettled(p);
  if (wanted('app-builder')) await snap(p, 'app-builder');
  await p.locator('[data-builder-save]').click();
  const s = saveSheet(p);
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file]')).toHaveCount(1);
  await expect(s.getByRole('button', { name: 'Save 1 file', exact: true })).toBeVisible();
  if (wanted('app-save-review')) await snap(p, 'app-save-review');
});

test('app-save-points: the Save points list after two saves', async () => {
  test.skip(!wanted('app-save-points'));
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const p = await openBuilder(dir);
  const link = async (skillId: string, agentId: string): Promise<void> => {
    const skill = (await node(p, `skill:${skillId}`).boundingBox())!, agent = (await node(p, `agent:${agentId}`).boundingBox())!;
    await p.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
    await p.mouse.down();
    await p.mouse.move(skill.x + skill.width / 2 - 10, skill.y + skill.height / 2 + 4, { steps: 4 });
    await p.mouse.move(agent.x + agent.width / 2, agent.y + agent.height / 2, { steps: 12 });
    await p.mouse.up();
    await p.mouse.move(1, 1);
    await graphSettled(p);
  };
  const save = async (): Promise<void> => {
    await p.locator('[data-builder-save]').click();
    const s = saveSheet(p), review = s.locator('[data-save-review="save"]');
    await expect(review).toBeVisible();
    await review.locator('[data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    await s.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(s).toBeHidden();
  };
  await link('summarize', 'checker');
  await save();
  await link('proofread', 'drafter');
  await save();
  await p.getByRole('button', { name: 'Save points', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Save points' });
  await expect(drawer.locator('[data-version]')).toHaveCount(3);
  await p.mouse.move(1, 1);
  await snap(p, 'app-save-points');
});

test('app-export-sheet and app-import-sheet: the Export sheet, then the Import sheet with the file it wrote', async () => {
  test.skip(!wanted('app-export-sheet', 'app-import-sheet'));
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const target = join(home, 'Projects', 'new-place');
  put(target, 'README.md', '# New place\n');
  const file = join(home, 'Desktop', 'weekly.bowerloom.json');
  mkdirSync(join(home, 'Desktop'), { recursive: true });
  const p = await openBuilder(dir, LARGE);
  await h!.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as unknown as typeof dialog.showSaveDialog;
  }, file);
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const e = p.getByRole('dialog', { name: 'Export a harness' });
  await expect(e.locator('[data-export-file]')).toHaveAttribute('data-export-file', 'weekly.bowerloom.json');
  await p.mouse.move(1, LARGE.height - 1);
  if (wanted('app-export-sheet')) await snap(p, 'app-export-sheet');
  await e.locator('[data-export-write]').click();
  await expect(e.locator('[data-done]')).toBeVisible();
  expect(existsSync(file)).toBe(true);
  await e.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(e).toBeHidden();
  await p.evaluate(() => { location.hash = '#app/harnesses'; });
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Import a harness' });
  await h!.pick(file);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await expect(s.locator('[data-bundle-name]')).toContainText('weekly.bowerloom.json');
  await p.mouse.move(1, LARGE.height - 1);
  if (wanted('app-import-sheet')) await snap(p, 'app-import-sheet');
});

test('app-notes-tour: the first-run tour at the step that builds the Notes keeper', async () => {
  test.skip(!wanted('app-notes-tour'));
  test.skip(GIT === null, NO_GIT_REASON);
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const notes = join(home, 'Documents', 'field-notes');
  mkdirSync(notes, { recursive: true });
  const p = await start('notes', SMALL, { freshTour: true });
  await h!.pick(notes);
  await p.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await p.locator('[data-notes-step="starter"]').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(p.locator('[data-notes-done="created"]')).toBeVisible();
  await p.getByRole('button', { name: 'Build my Notes keeper', exact: true }).click();
  const s = saveSheet(p);
  await h!.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const t = p.getByRole('dialog', { name: 'Tour' });
  await expect(t).toContainText('Step 1 of 7');
  for (let i = 0; i < 3; i++) await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t).toContainText('Step 4 of 7');
  const tray = s.locator('[data-section="keeper-build"]');
  const shelf = s.locator('[data-shelf="skills"]');
  await tray.locator('[data-card="add-source"]').dragTo(shelf);
  await expect(shelf.locator('[data-on-shelf="add-source"]')).toBeVisible();
  await s.getByRole('button', { name: 'Add the other skills', exact: true }).click();
  await expect(shelf.locator('[data-on-shelf]')).toHaveCount(6);
  await expect(t).toContainText('Step 4 of 7');
  await snap(p, 'app-notes-tour');
});

test('every shot of the plan has a recipe', () => {
  const recipes = new Set(['app-welcome', 'app-find-files', 'app-install-history', 'app-engines', 'app-help', 'app-overview', 'app-adopt-sheet', 'app-install-review', 'app-builder', 'app-save-review', 'app-save-points', 'app-export-sheet', 'app-import-sheet', 'app-notes-tour']);
  expect(IDS.filter(id => !recipes.has(id)), 'a shot of the plan with no recipe').toEqual([]);
  expect([...recipes].filter(id => !IDS.includes(id)), 'a recipe with no shot in the plan').toEqual([]);
});
