/**
 * Takes the six screenshots of the landing page (apps/landing/src/screenshots.ts), light and dark, and writes them as WebP files to apps/landing/public/shots.
 * Run it again after a change to the screens: `npm run shots --prefix apps/landing`, or by hand:
 *   LANDING_SHOTS=1 npx playwright test --config playwright.config.ts e2e/landing-shots.spec.ts      (from apps/desktop, after `npm run build` at the root)
 * Without LANDING_SHOTS=1 every test here is skipped, so a normal e2e run never rewrites the images. LANDING_SHOTS_DIR changes where they go.
 *
 * The app starts the default way (real mode, the Beta mark in the sidebar) on a made-up home. Each picture is drawn at 2x so the text stays sharp. Every name comes from landing-shots-fixture.ts
 * or from the kit. Before each picture the test reads the text that the picture shows and fails when it holds this computer's user name, home folder, host name or temp folder,
 * or the path of the made-up home. The command line shot runs the built CLI (dist/apps/cli/src/main.js) on the made-up project and draws its real output in a plain terminal frame.
 */
import { expect, test } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { GIT, NO_GIT_REASON } from './harness-notes-support.js';
import { desktop } from './harness-page.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { extraWindowOptions } from './hidden.js';
import { animationsDone } from './page-wait.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { weeklyFolder } from './landing-shots-fixture.js';

test.skip(process.env.LANDING_SHOTS !== '1', 'Set LANDING_SHOTS=1 to take the landing page shots.');

const OUT = process.env.LANDING_SHOTS_DIR ?? join(desktop, '..', 'landing', 'public', 'shots');
const SCHEMES = ['light', 'dark'] as const;
/** WebP quality (0 to 100) for every picture. Text stays sharp at this level, and each file stays well under 300 KB. */
const QUALITY = 90;
/** Every picture is drawn at twice its size in CSS pixels, so the text stays sharp on a screen with a high pixel density. */
const DENSITY = 2;

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
  const words = [userInfo().username, homedir(), hostname(), tmpdir(), '/var/folders', '/private/var', home, basename(home)];
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

test('fidelity-preview: the install review for both engines, each part with its result, and the weaker rule the person approved', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { skills: [], agents: [], servers: ['plain', 'home'] });
  const p = await start('projects', { width: 1280, height: 800 });
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
  await expect(lines.first()).toContainText('Weakened');
  await lines.first().getByRole('checkbox').check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  for (const word of ['Exact', 'Translated', 'Weakened', 'Absent']) await expect(s.locator('[data-engine]').getByText(word, { exact: true }).first()).toBeVisible();
  // Scroll the review to the top of the Codex card: it holds a result of every kind.
  await s.locator('.hx-sheet-body').evaluate(body => {
    const card = body.querySelector('[data-engine="codex"]')!;
    body.scrollTop += card.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
  });
  await snap(p, 'fidelity-preview');
});

test('builder-graph and save-files: the Builder with a skill linked to an agent, then the Save review that lists the files', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const p = await start('harnesses', { width: 1100, height: 688 });
  const folders = p.locator('[data-section="folders"]');
  await h!.pick(dir);
  await folders.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await folders.getByRole('button', { name: /^Open .* in the builder$/ }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'weekly' })).toBeVisible();
  await expect(node(p, 'agent:drafter')).toBeVisible();
  // Zoom out once, so no node sits under the zoom buttons or the small map.
  await p.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await graphSettled(p);
  // Pan the graph up with the wheel (the wheel alone pans), over an empty spot of the canvas, until the agents are clear of the small map.
  const pane = (await p.locator('.hx-canvas').boundingBox())!;
  await p.mouse.move(pane.x + pane.width * 0.3, pane.y + pane.height * 0.2);
  await p.mouse.wheel(0, 110);
  await graphSettled(p);

  // Drag the skill `summarize` onto the agent `checker`, with real pointer events.
  const skill = (await node(p, 'skill:summarize').boundingBox())!, agent = (await node(p, 'agent:checker').boundingBox())!;
  await p.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await p.mouse.down();
  await p.mouse.move(skill.x + skill.width / 2 - 10, skill.y + skill.height / 2 + 4, { steps: 4 });
  await p.mouse.move(agent.x + agent.width / 2, agent.y + agent.height / 2, { steps: 12 });
  await p.mouse.up();
  await expect(p.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await expect(p.locator('[data-agent="checker"]').getByRole('checkbox', { name: 'summarize: checker' })).toBeChecked();
  await p.mouse.move(1, 1);
  await graphSettled(p);
  await expect(p.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(p.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
  await snap(p, 'builder-graph');

  // A second change in the list under the graph, then the Save review.
  await p.locator('[data-agent="drafter"]').getByRole('checkbox', { name: 'proofread: drafter' }).check();
  await expect(p.locator('[data-draft]')).toContainText('2 changes, not saved yet.');
  await p.locator('[data-builder-save]').click();
  const s = saveSheet(p);
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file]')).toHaveCount(2);
  await expect(review.locator('[data-file=".bowerloom/agents/checker.md"]')).toHaveAttribute('data-action', 'update');
  await expect(review.locator('[data-file=".bowerloom/agents/drafter.md"]')).toHaveAttribute('data-action', 'update');
  await expect(s.getByRole('button', { name: 'Save 2 files', exact: true })).toBeVisible();
  await snap(p, 'save-files');
});

test('builder-agent: the Builder with the agent drafter selected, its details open, and the skill it uses linked', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const p = await start('harnesses', { width: 1100, height: 688 });
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
  // Select the agent that already uses a skill: the details column shows what it does and the skill it uses, with Unlink. Nothing is changed, so nothing is waiting to be saved.
  await node(p, 'agent:drafter').click();
  const details = p.locator('[data-links="agent:drafter"]');
  await expect(details).toContainText('outline');
  await expect(details.getByRole('button', { name: 'Unlink drafter and outline', exact: true })).toBeVisible();
  await p.mouse.move(1, 1);
  await graphSettled(p);
  await snap(p, 'builder-agent');
});

test('notes-keeper-tour: the first-run tour at the step that builds the Notes keeper', async () => {
  test.skip(GIT === null, NO_GIT_REASON);
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const notes = join(home, 'Documents', 'field-notes');
  mkdirSync(notes, { recursive: true });
  const p = await start('notes', { width: 1100, height: 688 }, { freshTour: true });
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
  await snap(p, 'notes-keeper-tour');
});

/** The terminal frame: plain, with a monospace face, and the colours of the site's light and dark themes. No prompt of the person, no host name. */
function terminalHtml(command: string, output: string): string {
  const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colour = (line: string): string => {
    const html = escape(line);
    if (/^ {2}create /.test(line)) return html.replace('create', '<span class="verb">create</span>');
    if (/^ {2}translated /.test(line)) return html.replace('translated', '<span class="alt">translated</span>');
    if (/^Revision: /.test(line)) return html.replace('Revision:', '<span class="key">Revision:</span>');
    if (/^Approval required\./.test(line)) return `<span class="key">${html}</span>`;
    return html;
  };
  return `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: light; --ground: #F6EEE8; --surface: #FFF9F4; --ink: #373A32; --muted: #655D61; --line: #D5C9C8; --action: #80515B; --verb: #4F6B3C; --alt: #A25B3B; }
    @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ground: #27262B; --surface: #343238; --ink: #F6EEE8; --muted: #D0BEC6; --line: #665B63; --action: #E8B3BF; --verb: #C5D4AC; --alt: #E0A17D; } }
    html, body { margin: 0; height: 100%; background: var(--ground); }
    body { display: flex; align-items: center; justify-content: center; font: 15px/1.55 ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink); }
    .frame { box-sizing: border-box; width: 960px; height: 590px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; display: flex; flex-direction: column; }
    .bar { flex: 0 0 38px; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--line); }
    .bar i { width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
    pre { margin: 0; padding: 16px 20px; flex: 1; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    .cmd { color: var(--action); font-weight: 600; } .cmd b { color: var(--muted); font-weight: 400; }
    .verb { color: var(--verb); } .alt { color: var(--alt); } .key { color: var(--action); }
  </style><div class="frame"><div class="bar"><i></i><i></i><i></i></div><pre><span class="cmd"><b>$</b> ${escape(command)}</span>\n${output.split('\n').map(colour).join('\n')}</pre></div>`;
}

test('cli-plan: the real output of `bowerloom harness install` for both engines, drawn in a plain terminal frame', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const dir = weeklyFolder(home, 'weekly', { hook: false, servers: [] });
  const cli = join(desktop, '..', '..', 'dist', 'apps', 'cli', 'src', 'main.js');
  expect(existsSync(cli), 'Build the CLI first: npm run build at the root.').toBe(true);
  const args = ['harness', 'install', '--engine', 'claude-code', '--engine', 'codex'];
  const ran = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, XDG_STATE_HOME: join(home, '.local', 'state'), NO_COLOR: '1' } });
  // The install only prints the plan and asks for approval, so it exits 3 and writes nothing.
  expect(ran.status).toBe(3);
  expect(ran.stderr).toBe('');
  expect(existsSync(join(dir, 'AGENTS.md')), 'nothing is written before the person approves').toBe(false);
  const output = ran.stdout.replace(/\n$/, '');
  expect(output).toMatch(/^Install to claude-code, codex: \d+ files to change\./);
  expect(output).toMatch(/\nRevision: [0-9a-f]{64}\nApproval required\. Run the same command again with --approve [0-9a-f]{64}$/);
  // The only edit: the command is shown as the person types it. Nothing in the output holds an absolute path, so nothing else is shortened.
  for (const word of forbidden()) expect(output.includes(word), 'a private word in the CLI output').toBe(false);

  // Draw it in a window of its own (hidden like every window of the run).
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  const before = h.app.windows().length;
  await h.app.evaluate(({ BrowserWindow }, { options, html }) => {
    // A session of its own: the app's session cancels every request that is not one of the app's files, a data page included.
    const w = new BrowserWindow({ width: 1000, height: 625, useContentSize: true, ...options, webPreferences: { partition: 'landing-shots-terminal', sandbox: true } });
    void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }, { options: extraWindowOptions(), html: terminalHtml(`bowerloom ${args.join(' ')}`, output) });
  await expect.poll(() => h!.app.windows().length).toBe(before + 1);
  const t = h.app.windows().find(w => w !== h!.page)!;
  await t.waitForSelector('pre');
  await frame(t, { width: 1000, height: 625 });
  // The frame holds every line: nothing is cut off at the bottom.
  const cut = await t.evaluate(() => { const pre = document.querySelector('pre')!; return pre.scrollHeight > pre.clientHeight + 1; });
  expect(cut, 'the terminal text fits the frame').toBe(false);
  await snap(t, 'cli-plan');
});
