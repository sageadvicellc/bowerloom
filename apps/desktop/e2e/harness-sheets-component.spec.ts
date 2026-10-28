/**
 * Component tests of the adopt and install sheets (ruling U14), in a real Electron window: the harness-first app on a test page whose engine answers only
 * when the test says (tests/component/sheets-page.tsx). They cover a write racing a plan (H1), a new folder starting clean (H2), a tick bound to the
 * content read (H3), a failed re-plan leaving no old plan to approve (H4), a changed entry asked again (SM2), the result step after each write (U5),
 * a refusal taking the focus (U9), Plan again (U10), a failed folder list, no bridge, and a chooser that throws (U11), and the words of Confirm (U12).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop, shot } from './harness-page.js';
import { sampleEngineFixtures } from '../shared/engine/sample.js';
import type { AdoptView, FolderInfo, ProjectInput } from '../shared/engine/types.js';

let app: ElectronApplication, page: Page, html: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = mkdtempSync(join(tmpdir(), 'bowerloom-sheets-'));
  // The page is built here, from the source, with React and the app's own CSS.
  const script = `import { build } from 'esbuild'; await build({ entryPoints: ['tests/component/sheets-page.tsx'], outfile: ${JSON.stringify(join(out, 'sheets.js'))}, bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });`;
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  const bundle = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(bundle.stderr);
  html = join(out, 'sheets.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(out, 'sheets.css')).href}"></head><body><script src="${pathToFileURL(join(out, 'sheets.js')).href}"></script></body></html>`);
  const userData = mkdtempSync(join(tmpdir(), 'bowerloom-prototype-e2e-sheets-'));
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-v3', `--user-data-dir=${userData}`] });
  await app.firstWindow();
});
test.afterAll(async () => { await app?.close(); });

async function open(query = ''): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, url) => { const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: 'sheets-test' } }); void w.loadURL(url); }, `${pathToFileURL(html).href}${query}`);
  await expect.poll(() => app.windows().length).toBe(before + 1);
  page = app.windows()[before]!;
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.waitForSelector('[data-home]');
  return page;
}
test.afterEach(async () => { await page?.close().catch(() => undefined); });

interface Call { id: number; name: string; args: unknown[]; settled: boolean }
const calls = (p: Page): Promise<Call[]> => p.evaluate(() => (window as unknown as { __driver: { calls: Call[] } }).__driver.calls.map(c => ({ id: c.id, name: c.name, args: c.args, settled: c.settled })));
const auto = (p: Page, name: string, value: unknown): Promise<void> => p.evaluate(([n, v]) => { (window as unknown as { __driver: { auto: Record<string, unknown> } }).__driver.auto[n as string] = v; }, [name, value] as const);
const answer = (p: Page, id: number, value: unknown): Promise<void> => p.evaluate(([i, v]) => { (window as unknown as { __driver: { answer(i: number, v: unknown): void } }).__driver.answer(i as number, v); }, [id, value] as const);
const fail = (p: Page, id: number, message: string): Promise<void> => p.evaluate(([i, m]) => { (window as unknown as { __driver: { fail(i: number, m: string): void } }).__driver.fail(i as number, m as string); }, [id, message] as const);
/** The newest call of a name that is not answered yet. */
async function waiting(p: Page, name: string): Promise<Call> {
  await expect.poll(async () => (await calls(p)).some(c => c.name === name && !c.settled), { message: `a ${name} call` }).toBe(true);
  return (await calls(p)).filter(c => c.name === name && !c.settled).at(-1)!;
}

const folder = (id: string, name: string, extra: Partial<FolderInfo> = {}): FolderInfo => ({ id, label: `~/Projects/${name}`, name, hasDefinition: false, engines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false }, ...extra });
const A = folder('folder-1', 'alpha'), B = folder('folder-2', 'beta');
const D = folder('folder-3', 'defined', { hasDefinition: true, engines: ['claude-code', 'codex', 'opencode'] });
const fx = sampleEngineFixtures();
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const refused = (code: string, message: string): { ok: false; refusal: { code: string; message: string; paths: string[] } } => ({ ok: false, refusal: { code, message, paths: [] } });
const ready = (v: AdoptView): AdoptView => ({ ...v, conflicts: v.conflicts.map(c => ({ ...c, picked: c.variants[0]!.key })), unmapped: v.unmapped.map(u => ({ ...u, acknowledged: u.gate === 'acknowledge' })), ready: true });

async function adoptReview(p: Page, view: AdoptView = fx.adopt): Promise<void> {
  await auto(p, 'folders', [A, B]);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await p.getByRole('dialog', { name: 'New harness from a folder' }).getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planAdoption')).id, ok(view));
}
const sheet = (p: Page, name = 'New harness from a folder') => p.getByRole('dialog', { name });

test('H2, U2: a new folder starts clean: no picks, no acknowledgements, no ticks, no old plan, no old refusal', async () => {
  const p = await open();
  await adoptReview(p);
  const s = sheet(p);
  await s.locator('[data-conflict]').getByRole('radio').first().click();
  const replan = await waiting(p, 'planAdoption');
  expect((replan.args[1] as { picks: Record<string, string> }).picks).toEqual({ 'system-prompt/AGENTS.md': 'AGENTS.md' });
  await fail(p, replan.id, 'FAILED');
  await expect(s.getByRole('alert')).toBeVisible();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(s.getByRole('alert')).toHaveCount(0);
  await s.locator('[data-folder="folder-2"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const forB = await waiting(p, 'planAdoption');
  expect(forB.args[0]).toBe('folder-2');
  expect(forB.args[1]).toEqual({ picks: {}, acknowledged: [] });
  await expect(s.locator('[data-section]')).toHaveCount(0);
});

test('H3, U3, U8: a tick names the content read; a re-plan that changes it clears the tick; each box names its item', async () => {
  const p = await open();
  const v = ready(fx.adopt);
  await adoptReview(p, v);
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const boxes = s.locator('[data-section="approvals"] input[type="checkbox"]');
  await expect(boxes).toHaveCount(3);
  const names = await boxes.evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? ''));
  expect(new Set(names).size).toBe(3);
  expect(names[1]).toContain('mail');
  for (const b of await boxes.all()) await b.check();
  await expect(s.getByRole('button', { name: /^Write \d+ files$/ })).toBeEnabled();
  // An acknowledgement re-plans; the answer changes what the mail approval covers.
  await s.locator('[data-section="acknowledgements"] input').first().click();
  const changed: AdoptView = { ...v, approvals: v.approvals.map(a => (a.key === 'mcp/mail' ? { ...a, text: [{ path: '.bowerloom/mcp.json', text: '{ "command": "curl", "args": ["evil.example"] }' }], hash: 'e'.repeat(64) } : a)) };
  await answer(p, (await waiting(p, 'planAdoption')).id, ok(changed));
  await expect(s.locator('[data-tick="mcp/mail"] input')).not.toBeChecked();
  await expect(s.locator('[data-tick="mcp/mail"]')).toContainText('evil.example');
  await expect(s.locator('[data-tick="hooks/pre-tool-use-9c03e1f2"] input')).toBeChecked();
  await expect(s.getByRole('button', { name: /^Write \d+ files$/ })).toBeDisabled();
});

test('H1, U1, U5: while a write runs, a plan cannot start and every choice is held; the write\'s answer is shown as a result step', async () => {
  const p = await open();
  await adoptReview(p, ready(fx.adopt));
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  for (const b of await s.locator('[data-section="approvals"] input').all()) await b.check();
  await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
  const write = await waiting(p, 'runAdoption');
  for (const box of await s.locator('input[type="checkbox"]').all()) await expect(box).toBeDisabled();
  await expect(s.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  const before = (await calls(p)).length;
  await s.locator('[data-section="acknowledgements"] input').first().click({ force: true }).catch(() => undefined);
  expect((await calls(p)).length, 'no plan starts during a write').toBe(before);
  await answer(p, write.id, ok({ written: ['.bowerloom/harness.json', '.bowerloom/mcp.json'] }));
  const result = s.locator('[data-done]');
  await expect(result).toBeVisible();
  await expect(result).toContainText('.bowerloom/harness.json');
  await expect(result).toContainText('.bowerloom/mcp.json');
  await shot(p, 'F1-adopt-result');
});

test('H4, U4, U9, U10: a re-plan clears the old plan and its approval; a refusal shows alone, takes the focus, and offers Plan again', async () => {
  const p = await open();
  await auto(p, 'folders', [D]);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = sheet(p, 'Install a folder\'s harness');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-engine="codex"] input')).toBeChecked();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const input: ProjectInput = { engines: ['claude-code', 'codex', 'opencode'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
  await answer(p, (await waiting(p, 'planProjection')).id, ok({ kind: 'plan', plan: fx.project(input) }));
  await s.locator('[data-approve-plan] input').check();
  await s.locator('[data-section="drift"]').getByRole('radio', { name: /Keep both/ }).click();
  const replan = await waiting(p, 'planProjection');
  expect((replan.args[1] as ProjectInput).reconcile).toBe('keep-both');
  await expect(s.locator('[data-approve-plan]')).toHaveCount(0);
  await expect(s.locator('[data-section="loss"]')).toHaveCount(0);
  await answer(p, replan.id, refused('PORTABLE_DRIFT', 'A file Bowerloom projected changed since the plan. Nothing more was changed.'));
  const alert = s.getByRole('alert');
  await expect(alert).toBeFocused();
  await expect(s.locator('[data-section="loss"]')).toHaveCount(0);
  await expect(s.getByRole('button', { name: /^Write/ })).toBeDisabled();
  await alert.getByRole('button', { name: 'Plan again', exact: true }).click();
  const again = await waiting(p, 'planProjection');
  expect((again.args[1] as ProjectInput).reconcile).toBe('keep-both');
  await shot(p, 'F2-install-refusal');
});

test('SM2, U15: a re-plan that names a changed entry with a new key asks again, unticked', async () => {
  const p = await open();
  await auto(p, 'folders', [D]);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = sheet(p, 'Install a folder\'s harness');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-engine="codex"] input')).toBeChecked();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planProjection')).id, ok({ kind: 'approve', lines: fx.approveLines, approvedSoFar: [] }));
  for (const b of await s.locator('[data-section="approve-lines"] input').all()) await b.check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  const second = await waiting(p, 'planProjection');
  const keys = (second.args[1] as ProjectInput).approve;
  expect(keys).toEqual(fx.approveLines.map(l => l.key));
  const changed = fx.approveLines.map((l, i) => (i === 0 ? { ...l, key: `${l.key}-changed`, reason: 'The rule changed.' } : l));
  await answer(p, second.id, ok({ kind: 'approve', lines: changed, approvedSoFar: keys.slice(1) }));
  await expect(s.locator('[data-section="approve-lines"] input').first()).not.toBeChecked();
  await expect(s.getByRole('button', { name: 'Plan with these approvals', exact: true })).toBeDisabled();
});

test('U11: a failed folder list is a refusal, not an empty list; a chooser that throws is reported; with no bridge the button says why', async () => {
  const p = await open();
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = sheet(p);
  await fail(p, (await waiting(p, 'folders')).id, 'FAILED');
  await expect(s.getByRole('alert')).toContainText('could not');
  await expect(s.getByText('No folder yet. Choose one to start.')).toHaveCount(0);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await fail(p, (await waiting(p, 'chooseFolder')).id, 'BAD_ARGUMENT');
  await expect(s.getByRole('alert')).toContainText('Close the sheet and open it again');
  await p.close();
  const q = await open('?bridge=none');
  await q.getByRole('button', { name: 'From a folder', exact: true }).click();
  const t = sheet(q);
  const choose = t.getByRole('button', { name: 'Choose a folder', exact: true });
  await expect(choose).toBeDisabled();
  await expect(t).toContainText('This window cannot reach Bowerloom.');
});

test('U12: Confirm repeats the problems and the files, says "Ready to write." when nothing waits, and names why when the plan is not ready', async () => {
  const p = await open();
  await adoptReview(p, ready(fx.adopt));
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  for (const b of await s.locator('[data-section="approvals"] input').all()) await b.check();
  await expect(s.locator('[data-waiting]')).toHaveText('Ready to write.');
  await expect(s.locator('[data-waiting]')).not.toContainText('Still waiting for: Nothing');
  await expect(s).toContainText('Writes 7 files into the .bowerloom folder.');
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Next', exact: true }).click();
  const notReady: AdoptView = { ...ready(fx.adopt), ready: false, problems: [{ code: 'DEFINITION_INVALID', path: 'harness.json', message: 'The planned harness does not load.' }] };
  await answer(p, (await waiting(p, 'planAdoption')).id, ok(notReady));
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="problems"]')).toContainText('The planned harness does not load.');
  await expect(s.locator('[data-waiting]')).toContainText('1 problem');
});
