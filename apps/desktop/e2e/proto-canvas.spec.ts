/**
 * The harness graph canvas (prototype slice S3), in a real window: the real HarnessCanvas with the sample world on a page of its own
 * (tests/perf/proto-canvas-harness.tsx, bundled here by esbuild so no other build file has to change).
 * Checks what a person does (select, open, move with the keys, drag a wire, drop on a node, the menu, the library group, fit, reduce motion)
 * and that after the first fit every node is inside the picture. Set PROTO_CANVAS_SHOTS to a folder to also save screenshots there.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canvasSettled } from './proto-wait.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_CANVAS_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });

let page: Page, app: ElectronApplication, base = '';
const SIZES = [[1440, 900], [900, 600]] as const;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const dir = tempDir('bowerloom-proto-canvas-');
  await build({
    entryPoints: [join(desktop, 'tests/perf/proto-canvas-harness.tsx')], outfile: join(dir, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic',
    loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning',
  });
  writeFileSync(join(dir, 'bar.css'), 'html,body{margin:0;height:100%;background:var(--bg)}.harness-bar{position:fixed;left:0;right:0;top:0;height:34px;display:flex;gap:16px;align-items:center;padding:0 10px;font:13px var(--font-body);color:var(--text);background:var(--surface);border-bottom:1px solid var(--border)}.harness-stage{position:fixed;left:8px;right:8px;top:40px;bottom:8px}#log{color:var(--text-muted);margin-left:auto}');
  const css = (name: string): string => `<link rel="stylesheet" href="${pathToFileURL(join(desktop, 'renderer', name)).href}">`;
  writeFileSync(join(dir, 'harness.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">${css('tokens.css')}${css('styles.css')}<link rel="stylesheet" href="harness.css"><link rel="stylesheet" href="bar.css"></head><body><div id="root"></div><script src="harness.js"></script></body></html>`);
  base = pathToFileURL(join(dir, 'harness.html')).href;
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sample-data', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  await app.firstWindow();
});
test.afterAll(async () => { await app.close(); removeTempDirs(); });

/** Opens the harness page in a second window of the given size. */
async function open(query: string, w = 1440, h = 900): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, { url, width, height }) => { const win = new BrowserWindow({ width, height, useContentSize: true, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: `proto-canvas-${Date.now()}` } }); void win.loadURL(url); }, { url: `${base}?${query}`, width: w, height: h });
  await expect.poll(() => app.windows().length).toBe(before + 1);
  const p = app.windows()[app.windows().length - 1]!;
  await p.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30_000 });
  await p.waitForSelector('.react-flow__node');
  await canvasSettled(p, { fitted: true });
  return p;
}
const close = async (p: Page): Promise<void> => { await app.evaluate(({ BrowserWindow }, title) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getTitle() === title) w.close(); }, await p.title()); };
const node = (p: Page, id: string) => p.locator(`.react-flow__node[data-id="${id}"]`);
const calls = (p: Page): Promise<string[]> => p.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls.map(c => c.join(' ')));
const transform = (p: Page, id: string): Promise<string> => node(p, id).evaluate(e => (e as HTMLElement).style.transform);

/** What must hold after the first fit: every node of the model is drawn, inside the canvas, and nothing is below the window. */
async function assertFits(p: Page, label: string): Promise<void> {
  const r = await p.evaluate(() => {
    const c = document.querySelector('.hc-root')!.getBoundingClientRect(), outside: string[] = [];
    for (const n of document.querySelectorAll('.react-flow__node')) { const b = n.getBoundingClientRect(); if (b.left < c.left - 2 || b.right > c.right + 2 || b.top < c.top - 2 || b.bottom > c.bottom + 2) outside.push(n.getAttribute('data-id') ?? '?'); }
    return { outside, drawn: document.querySelectorAll('.react-flow__node').length, expected: (window as unknown as { __counts: { nodes: number } }).__counts.nodes, scroll: document.documentElement.scrollHeight - window.innerHeight, low: c.bottom > window.innerHeight + 1 };
  });
  expect(r.drawn, `${label}: every node is drawn`).toBe(r.expected);
  expect(r.outside, `${label}: nodes outside the picture`).toEqual([]);
  expect(r.scroll, `${label}: the page scrolls`).toBeLessThanOrEqual(1);
  expect(r.low, `${label}: below the window`).toBe(false);
}
async function shot(p: Page, name: string, w: number, h: number): Promise<void> { if (shotsDir !== null) await p.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' }); }

for (const [w, h] of SIZES) {
  for (const [name, query] of [['a-global', 'scope=global'], ['b-project', 'scope=scope-copperfen'], ['c-ghost', 'scope=scope-reedmarsh'], ['d-group-open', 'scope=global&expand=group:evergreen-kit'], ['e-500', 'n=500']] as const) {
    test(`${name} fits a ${w} by ${h} window, nothing clipped`, async () => {
      test.setTimeout(120_000);
      const p = await open(query, w, h);
      await assertFits(p, `${name} ${w}x${h}`);
      await shot(p, name, w, h);
      await close(p);
    });
  }
}

test('select, open, arrow keys, the wire from one node to another, a drop on a node, the library button, fit, and the pane click', async () => {
  test.setTimeout(120_000);
  const p = await open('scope=global');
  await node(p, 'skill-010').click();
  expect(await calls(p)).toContain('select skill-010');
  await expect(node(p, 'skill-010').locator('.hc-node')).toHaveClass(/is-selected/);
  await p.mouse.click(1300, 130);
  expect(await calls(p)).toContain('select ');
  await node(p, 'skill-011').dblclick();
  expect(await calls(p)).toContain('menu skill-011 open');
  await node(p, 'skill-012').focus();
  expect(await node(p, 'skill-012').getAttribute('aria-label')).toMatch(/^Skill, .+\. .* \d+ wires?\.$/);
  await p.keyboard.press('Enter');
  expect(await calls(p)).toContain('menu skill-012 open');
  const before = await transform(p, 'skill-012');
  await p.keyboard.press('ArrowRight');
  await expect.poll(() => transform(p, 'skill-012')).not.toBe(before);
  await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe('skill-012');

  // A wire from the left side of an agent to a skill.
  const a = (await node(p, 'agent-01').boundingBox())!, s = (await node(p, 'skill-020').boundingBox())!;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.move(a.x + 1, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(a.x - 60, a.y + 10, { steps: 6 }); await p.mouse.move(s.x + s.width - 2, s.y + s.height / 2, { steps: 15 }); await p.mouse.up();
  await expect.poll(() => calls(p)).toContain('connect agent-01 skill-020');
  // The same with the keyboard.
  await node(p, 'agent-02').focus(); await p.keyboard.press('c');
  await expect(p.locator('.hc-banner')).toHaveCount(1);
  await node(p, 'tool-prompt-01').focus(); await p.keyboard.press('Enter');
  await expect.poll(() => calls(p)).toContain('connect agent-02 tool-prompt-01');
  // A drop on a node: reported, and the dropped node goes back.
  const home = await transform(p, 'skill-021');
  const p1 = (await node(p, 'skill-021').boundingBox())!, p2 = (await node(p, 'agent-03').boundingBox())!;
  await p.mouse.move(p1.x + p1.width / 2, p1.y + p1.height / 2); await p.mouse.down();
  await p.mouse.move(p2.x + p2.width / 2 - 30, p2.y + p2.height / 2, { steps: 20 }); await p.mouse.move(p2.x + p2.width / 2, p2.y + p2.height / 2, { steps: 5 }); await p.mouse.up();
  await expect.poll(() => calls(p)).toContain('drop skill-021 agent-03');
  await expect.poll(() => transform(p, 'skill-021')).toBe(home);
  await expect(p.locator('.hc-root')).not.toHaveClass(/is-settling/);
  // The library button asks to open the group; the page draws its items.
  await node(p, 'group:evergreen-kit').locator('.hc-toggle').click();
  await expect.poll(() => calls(p)).toContain('menu group:evergreen-kit expand');
  await expect(p.locator('.react-flow__node[data-id^="agent-lib"]').first()).toBeAttached();
  // Fit brings everything back into view.
  await p.getByRole('button', { name: 'Fit to view' }).click();
  await canvasSettled(p, { fitted: true });
  await assertFits(p, 'after fit');
  await close(p);
});

test('the menu of a node: right click, the keyboard, hide, and a ghost that can be shown again', async () => {
  test.setTimeout(120_000);
  const p = await open('scope=scope-copperfen');
  await node(p, 'skill-010').click({ button: 'right' });
  await expect(p.locator('.hc-menu-item')).toHaveText(['Open details', 'Hide in this project', 'Replace in this project']);
  await expect(p.locator('.hc-menu')).toHaveAttribute('role', 'menu');
  await expect(p.locator('.hc-menu-item').first(), 'the menu has the keyboard before a key is pressed').toBeFocused();
  await shot(p, 'menu', 1440, 900);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await expect.poll(() => calls(p)).toContain('menu skill-010 hide');
  await expect(node(p, 'skill-010').locator('.hc-node')).toHaveClass(/is-hidden/);
  // The first menu gives the keyboard back to the node on the next frame; a second menu opened before that would lose it again.
  await expect(node(p, 'skill-010')).toBeFocused();
  await p.keyboard.press('m');
  await expect(p.locator('.hc-menu-item')).toHaveText(['Open details', 'Show again in this project']);
  await expect(p.locator('.hc-menu-item').first(), 'the menu has the keyboard before Escape is pressed').toBeFocused();
  await p.keyboard.press('Escape');
  await expect(p.locator('.hc-menu')).toHaveCount(0);
  await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe('skill-010'); // the menu gives the keyboard back on the next frame
  await close(p);
});

test('reduce motion sets every duration to 0 and stops the animations; with motion on the durations are the MOTION.map ones', async () => {
  test.setTimeout(120_000);
  const read = (p: Page) => p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.hc-root')!); return { enter: cs.getPropertyValue('--hc-enter-ms'), drop: cs.getPropertyValue('--hc-drop-ms'), hover: cs.getPropertyValue('--hc-hover-ms'), select: cs.getPropertyValue('--hc-select-ms'), connect: cs.getPropertyValue('--hc-connect-ms'), animation: getComputedStyle(document.querySelector('.hc-node')!).animationName }; });
  const still = await open('scope=global&reduce=1');
  expect(await read(still)).toEqual({ enter: '0ms', drop: '0ms', hover: '0ms', select: '0ms', connect: '0ms', animation: 'none' });
  await close(still);
  const moving = await open('scope=global');
  expect(await read(moving)).toMatchObject({ enter: '160ms', drop: '220ms', hover: '90ms', select: '120ms', connect: '260ms' });
  await close(moving);
});

test('a screen that keeps the places: a moved node stays where it was put; changing scope draws the new scope and fits it', async () => {
  test.setTimeout(120_000);
  const p = await open('scope=global&positions=1');
  const b1 = (await node(p, 'skill-030').boundingBox())!;
  await p.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2); await p.mouse.down(); await p.mouse.move(b1.x + 40, b1.y + 200, { steps: 10 }); await p.mouse.up();
  await expect.poll(async () => Math.abs((await node(p, 'skill-030').boundingBox())!.y - b1.y)).toBeGreaterThan(100);
  await p.selectOption('select', 'scope-copperfen');
  await expect(node(p, 'scope:scope-copperfen')).toBeAttached();
  await canvasSettled(p, { fitted: true });
  await assertFits(p, 'after the scope changed');
  await close(p);
});
