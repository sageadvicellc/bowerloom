/**
 * Component tests of the adopt and install sheets (ruling U14), in a real Electron window: the harness-first app on a test page whose engine answers only
 * when the test says (tests/component/sheets-page.tsx). They cover a write racing a plan (H1), a new folder starting clean (H2), a tick bound to the
 * content read (H3), a failed re-plan leaving no old plan to approve (H4), a changed entry asked again (SM2), the result step after each write (U5),
 * a refusal taking the focus (U9), Plan again (U10), a failed folder list, no bridge, and a chooser that throws (U11), and the words of Confirm (U12).
 * Step 5: the two actions of a mode drift line and the plain refusal of Keep new mode (D5A), and the recovery of a stopped Merge (D4A).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop, shot } from './harness-page.js';
import { sampleEngineFixtures } from '../shared/engine/sample.js';
import type { AdoptView, FolderInfo, ProjectInput } from '../shared/engine/types.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

let app: ElectronApplication, page: Page, html: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = tempDir('bowerloom-sheets-');
  // The page is built here, from the source, with React and the app's own CSS.
  const script = `import { build } from 'esbuild'; await build({ entryPoints: ['tests/component/sheets-page.tsx'], outfile: ${JSON.stringify(join(out, 'sheets.js'))}, bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });`;
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  const bundle = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(bundle.stderr);
  html = join(out, 'sheets.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(out, 'sheets.css')).href}"></head><body><script src="${pathToFileURL(join(out, 'sheets.js')).href}"></script></body></html>`);
  const userData = tempDir('bowerloom-prototype-e2e-sheets-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-v3', `--user-data-dir=${userData}`] });
  await app.firstWindow();
});
test.afterAll(async () => { await app?.close(); removeTempDirs(); });

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
  expect(forB.args[1]).toEqual({ picks: {}, acknowledged: [], everyEngine: [] });
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
  await expect(s.locator('[data-section="approvals"] input')).not.toHaveCount(0);
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
  await expect(s.locator('[data-section="approve-lines"] input')).toHaveCount(3);
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
  await expect(s.locator('[data-section="approvals"] input')).not.toHaveCount(0);
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

// ---- verification round: W3 to W9 and the U12 leftover

const D2 = folder('folder-4', 'second', { hasDefinition: true, engines: ['claude-code', 'codex', 'opencode'] });
const INPUT3: ProjectInput = { engines: ['claude-code', 'codex', 'opencode'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };

async function installReview(p: Page, folders: FolderInfo[]): Promise<ReturnType<typeof sheet>> {
  await auto(p, 'folders', folders);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = sheet(p, 'Install a folder\'s harness');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-engine="codex"] input')).toBeChecked();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  return s;
}

test('W3, W9: a new folder in the install sheet starts with Accept AGENTS.md, no CLAUDE.md offer ticked, and no ticks of the last folder', async () => {
  const p = await open();
  const s = await installReview(p, [D, D2]);
  await answer(p, (await waiting(p, 'planProjection')).id, ok({ kind: 'approve', lines: fx.approveLines, approvedSoFar: [] }));
  await s.locator('[data-section="approve-lines"] input').first().check();
  await s.locator('[data-section="approve-lines"] input').nth(1).check();
  await s.locator('[data-section="approve-lines"] input').nth(2).check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  const withOffer = { ...fx.project(INPUT3), offers: [{ action: 'write-claude-md' as const, reason: 'Claude Code does not read AGENTS.md here.' }] };
  await answer(p, (await waiting(p, 'planProjection')).id, ok({ kind: 'plan', plan: withOffer }));
  await s.locator('[data-section="drift"]').getByRole('radio', { name: /Keep both/ }).click();
  await answer(p, (await waiting(p, 'planProjection')).id, ok({ kind: 'plan', plan: { ...withOffer, reconcile: 'keep-both' } }));
  await s.locator('[data-tick="write-claude"] input').click();
  const third = await waiting(p, 'planProjection');
  expect((third.args[1] as ProjectInput).writeClaudeMd).toBe(true);
  await answer(p, third.id, ok({ kind: 'plan', plan: withOffer }));
  // Back to the folders, and a new folder.
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.locator('[data-folder="folder-4"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-engine="codex"] input')).toBeChecked();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const fresh = await waiting(p, 'planProjection');
  expect(fresh.args[0]).toBe('folder-4');
  expect(fresh.args[1]).toEqual(INPUT3);
  await answer(p, fresh.id, ok({ kind: 'approve', lines: fx.approveLines, approvedSoFar: [] }));
  await expect(s.locator('[data-section="approve-lines"] input')).toHaveCount(3);
  for (const b of await s.locator('[data-section="approve-lines"] input').all()) await expect(b).not.toBeChecked();
});

test('W9: a new folder in the adopt sheet starts with no ticks and no acknowledgements', async () => {
  const p = await open();
  const v = ready(fx.adopt);
  await adoptReview(p, v);
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="approvals"] input')).not.toHaveCount(0);
  for (const b of await s.locator('[data-section="approvals"] input').all()) await b.check();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.locator('[data-folder="folder-2"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const forB = await waiting(p, 'planAdoption');
  expect(forB.args[1]).toEqual({ picks: {}, acknowledged: [], everyEngine: [] });
  await answer(p, forB.id, ok(v));
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="approvals"] input')).toHaveCount(3);
  for (const b of await s.locator('[data-section="approvals"] input').all()) await expect(b).not.toBeChecked();
});

test('W5: an acknowledged entry that leaves the plan leaves the choices too, so the sheet is not stuck', async () => {
  const p = await open();
  const v = fx.adopt;
  await adoptReview(p, v);
  const s = sheet(p);
  await s.locator('[data-conflict]').getByRole('radio').first().click();
  const picked = { ...v, conflicts: v.conflicts.map(c => ({ ...c, picked: c.variants[0]!.key })) };
  await answer(p, (await waiting(p, 'planAdoption')).id, ok(picked));
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.locator('[data-section="acknowledgements"] input').first().click();
  const ackCall = await waiting(p, 'planAdoption');
  const acked = (ackCall.args[1] as { acknowledged: { id: string }[] }).acknowledged.map(a => a.id);
  expect(acked).toEqual([v.unmapped[0]!.id]);
  // The answer no longer lists that entry; the other is acknowledged by the plan itself.
  const gone: AdoptView = { ...picked, unmapped: picked.unmapped.filter(u => u.id !== v.unmapped[0]!.id).map(u => ({ ...u, acknowledged: u.gate === 'acknowledge' })), ready: true };
  await answer(p, ackCall.id, ok(gone));
  await expect(s.locator('[data-section="approvals"] input')).not.toHaveCount(0);
  for (const b of await s.locator('[data-section="approvals"] input').all()) await b.check();
  await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
  const run = await waiting(p, 'runAdoption');
  const sent = (run.args[2] as { acknowledged: { id: string }[] }).acknowledged.map(a => a.id);
  expect(sent).toEqual(gone.unmapped.filter(u => u.acknowledged).map(u => u.id));
});

test('W4, W7: an approval with no text is a block with its reason and no tick; an install line shows its entry\'s text', async () => {
  const p = await open();
  const v = ready(fx.adopt);
  const blocked: AdoptView = { ...v, approvals: v.approvals.map(a => (a.key === 'mcp/mail' ? { ...a, text: [], blocked: 'Bowerloom cannot show the text this approval covers, so it cannot be approved here. Plan again, or change the file.' } : a)) };
  await adoptReview(p, blocked);
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const mail = s.locator('[data-blocked="mcp/mail"]');
  await expect(mail).toContainText('cannot be approved here');
  await expect(mail.locator('input')).toHaveCount(0);
  await expect(s.locator('[data-waiting]')).toContainText('1 approval with no text');
  await p.close();
  const q = await open();
  const t = await installReview(q, [D]);
  await answer(q, (await waiting(q, 'planProjection')).id, ok({ kind: 'approve', lines: fx.approveLines, approvedSoFar: [] }));
  await expect(t.locator('[data-section="approve-lines"] [data-tick]').first().locator('pre')).toContainText('"pattern": "git push --force *"');
});

test('W6, W8: each step\'s body and each block of code is a named region; a recovery says whether the record of the stopped run is whole', async () => {
  const p = await open();
  await auto(p, 'folders', [folder('folder-5', 'half', { unfinished: { projection: false, adoption: true } })]);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = sheet(p);
  await expect(s.getByRole('region', { name: 'Pick a folder' })).toBeVisible();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planAdoptionRecovery')).id, ok({ kind: 'adoption', journal: 'damaged', check: ['.bowerloom/harness.json'], remove: [], restore: [], kept: [], dirs: [], revision: 'a'.repeat(64) }));
  const r = sheet(p, 'Finish a stopped harness');
  await expect(r.getByRole('region', { name: 'Review the plan' })).toBeVisible();
  await expect(r.locator('[data-journal]')).toHaveText("The stopped run's record is damaged. Check these files by hand.");
  await p.close();
  const q = await open();
  const t = await installReview(q, [D]);
  await answer(q, (await waiting(q, 'planProjection')).id, ok({ kind: 'plan', plan: fx.project(INPUT3) }));
  await expect(t.getByRole('region', { name: /\.opencode\/plugins\/bowerloom-hooks\.js/ })).toBeVisible();
});

test('U12: a plan that is not ready with nothing waiting names why', async () => {
  const p = await open();
  await adoptReview(p, { ...ready(fx.adopt), ready: false });
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="approvals"] input')).not.toHaveCount(0);
  for (const b of await s.locator('[data-section="approvals"] input').all()) await b.check();
  await expect(s.locator('[data-waiting]')).toHaveText('Not ready: Bowerloom\'s plan is not ready though nothing waits on you. Plan again to check.');
  await expect(s.getByRole('button', { name: /^Write/ })).toBeDisabled();
});

// ---- step 5: mode drift lines (D5A) and the recovery of a stopped Merge (D4A)

test('D5A: a mode line offers Restore mode and Keep new mode; Keep new mode for an open mode is refused plainly; Restore mode plans, asks, and runs', async () => {
  const p = await open();
  await p.setViewportSize({ width: 900, height: 600 });
  const s = await installReview(p, [D]);
  const drift = { ok: false, refusal: { code: 'PORTABLE_DRIFT', message: 'A file Bowerloom projected changed since. Nothing more was changed.', paths: [], drift: [{ path: 'AGENTS.md', reason: 'mode' }, { path: '.claude/settings.json', reason: 'changed' }] } };
  await answer(p, (await waiting(p, 'planProjection')).id, drift);
  const note = s.getByRole('alert');
  await expect(note.locator('[data-drift-line="AGENTS.md"]')).toContainText('Mode changed since');
  await expect(note.locator('[data-drift-line=".claude/settings.json"]')).toContainText('Changed since');
  await expect(note.locator('[data-drift-line=".claude/settings.json"] button')).toHaveCount(0);
  const restore = note.getByRole('button', { name: 'Restore mode: AGENTS.md', exact: true });
  const keepNew = note.getByRole('button', { name: 'Keep new mode: AGENTS.md', exact: true });
  await expect(restore).toBeVisible(); await expect(keepNew).toBeVisible();
  // Each one fits the 900 by 600 sheet and is 32 px high. Their focus ring and hover are held in the real window (harness-engine-real.spec.ts).
  const sheetBox = (await s.boundingBox())!;
  for (const b of [restore, keepNew]) {
    const box = (await b.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width);
    expect(box.height).toBeGreaterThanOrEqual(32);
  }
  await shot(p, 'C1-mode-line');
  await keepNew.click();
  const record = await waiting(p, 'planRecovery');
  expect(record.args[1]).toEqual({ keep: [], restoreMode: [], recordMode: ['AGENTS.md'] });
  await answer(p, record.id, { ok: false, refusal: { code: 'PORTABLE_MODE_UNSAFE', message: 'The new mode of a projected file lets the group or others write it, so the receipt does not take it. Restore the recorded mode, or narrow the mode first. Nothing was changed.', paths: ['AGENTS.md'] } });
  const r = sheet(p, 'Finish a stopped install');
  await expect(r.getByRole('alert')).toContainText('lets the group or others write it');
  await expect(r.getByRole('alert')).toContainText('PORTABLE_MODE_UNSAFE');
  await r.getByRole('button', { name: 'Back', exact: true }).click();
  const d = sheet(p, 'Install a folder\'s harness');
  await d.getByRole('button', { name: 'Next', exact: true }).click();
  await d.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planProjection')).id, drift);
  await s.getByRole('alert').getByRole('button', { name: 'Restore mode: AGENTS.md', exact: true }).click();
  const back = await waiting(p, 'planRecovery');
  expect(back.args[1]).toEqual({ keep: [], restoreMode: ['AGENTS.md'], recordMode: [] });
  const plan = { kind: null, action: 'mode', steps: [], keep: [], modes: [{ path: 'AGENTS.md', choice: 'restoreMode', now: '0700', recorded: '0644' }], notice: null, revision: 'b'.repeat(64) };
  await answer(p, back.id, ok(plan));
  const modes = r.locator('[data-section="modes"]');
  await expect(modes.locator('[data-mode="AGENTS.md"]')).toContainText('Restore mode');
  await expect(modes.locator('[data-mode="AGENTS.md"]')).toContainText('Now 0700. Bowerloom wrote 0644.');
  const finish = r.getByRole('button', { name: 'Finish', exact: true });
  await expect(finish).toBeDisabled();
  await r.locator('[data-approve-plan] input').check();
  await finish.click();
  const run = await waiting(p, 'runRecovery');
  expect(run.args).toEqual(['folder-3', 'b'.repeat(64), { keep: [], restoreMode: ['AGENTS.md'], recordMode: [] }]);
  await answer(p, run.id, ok({ leftBehind: [] }));
  await expect(r.locator('[data-section="result-Mode put back"] .hxi-file')).toHaveText(['AGENTS.md']);
});

test('D4A: a stopped Merge is put back through the recovery of a stopped harness, which lists each file it puts back', async () => {
  const p = await open();
  await auto(p, 'folders', [folder('folder-6', 'merged', { hasDefinition: true, engines: ['claude-code'], unfinished: { projection: false, adoption: true } })]);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = sheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planAdoptionRecovery')).id, ok({ kind: 'merge', journal: 'ok', check: [], remove: [], restore: ['.bowerloom/instructions/AGENTS.md'], kept: [], dirs: [], revision: 'c'.repeat(64) }));
  const r = sheet(p, 'Finish a stopped harness');
  await expect(r.locator('[data-file=".bowerloom/instructions/AGENTS.md"]')).toContainText('Puts yours back');
  await r.locator('[data-approve-plan] input').check();
  await r.getByRole('button', { name: 'Finish', exact: true }).click();
  await answer(p, (await waiting(p, 'runAdoptionRecovery')).id, ok({ removed: [], restored: ['.bowerloom/instructions/AGENTS.md'], kept: [], leftFolders: [] }));
  await expect(sheet(p).locator('[data-section="result-Put back"] .hxi-file')).toHaveText(['.bowerloom/instructions/AGENTS.md']);
});
