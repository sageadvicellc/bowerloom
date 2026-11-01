/**
 * Component tests of the Export and Import sheets (journey 4, Task 1 lane D), in a real Electron window: the harness-first app on a test page whose engine answers
 * only when the test says (tests/component/sheets-page.tsx). They cover the Export sheet from the Builder (plan, the tick for a path of this computer and the foot line
 * that names it, the write named by the plan, a closed dialog as a calm note, a held write), and the Import sheet from the harness list (the open dialog closed, the file
 * and its status, the folder cards, the review with both ticks and the foot line that names what blocks, a notes choice that keeps the old plan dimmed and the focus on
 * its button, the refusals in the code's words, the Done step, a file chosen after the sheet closed, and a command with 20 long arguments shown whole).
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop, shot, shotsDir } from './harness-page.js';
import { SAMPLE_FOLDERS, SAMPLE_NOTES, createSampleEngine } from '../shared/engine/sample.js';
import type { BundleView, ExportView, FolderInfo, ImportNoteChoices, ImportView, NotesView, SaveView } from '../shared/engine/types.js';
import { extraWindowOptions, launchElectron } from './hidden.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

let app: ElectronApplication, page: Page, html: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = tempDir('bowerloom-share-');
  const script = `import { build } from 'esbuild'; await build({ entryPoints: ['tests/component/sheets-page.tsx'], outfile: ${JSON.stringify(join(out, 'sheets.js'))}, bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });`;
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  const bundle = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(bundle.stderr);
  html = join(out, 'sheets.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(out, 'sheets.css')).href}"></head><body><script src="${pathToFileURL(join(out, 'sheets.js')).href}"></script></body></html>`);
  app = await launchElectron(desktop, ['--sample', `--user-data-dir=${tempDir('bowerloom-e2e-share-')}`]);
  await app.firstWindow();
});
test.afterAll(async () => { await app?.close(); removeTempDirs(); });

async function open(query: string, size: { width: number; height: number } = { width: 1280, height: 800 }): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, { url, options, size }) => { const w = new BrowserWindow({ width: size.width, height: size.height, ...options, webPreferences: { contextIsolation: true, sandbox: true, partition: 'share-test' } }); void w.loadURL(url); }, { url: `${pathToFileURL(html).href}${query}`, options: extraWindowOptions(), size });
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
const answer = (p: Page, id: number, value: unknown): Promise<void> => p.evaluate(([i, v]) => { (window as unknown as { __driver: { answer(i: number, v: unknown): void } }).__driver.answer(i as number, v); }, [id, value] as const);
async function waiting(p: Page, name: string): Promise<Call> {
  await expect.poll(async () => (await calls(p)).some(c => c.name === name && !c.settled), { message: `a ${name} call` }).toBe(true);
  return (await calls(p)).filter(c => c.name === name && !c.settled).at(-1)!;
}
/** The calls of a name made so far, in order. */
const made = async (p: Page, name: string): Promise<Call[]> => (await calls(p)).filter(c => c.name === name);

const folder = (id: string, name: string, extra: Partial<FolderInfo> = {}): FolderInfo => ({ id, label: `~/Projects/${name}`, name, hasDefinition: false, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false }, ...extra });
const NEW = folder('folder-1', 'alpha'), HAS = folder('folder-3', 'defined', { hasDefinition: true, engines: ['claude-code', 'codex'], holdsParts: true }), MAYBE = folder('folder-4', 'maybe', { hasDefinition: true });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const refused = (code: string, message: string): { ok: false; refusal: { code: string; message: string; paths: string[] } } => ({ ok: false, refusal: { code, message, paths: [] } });
const seed = (auto: Record<string, unknown>): string => `?auto=${encodeURIComponent(JSON.stringify(auto))}`;
const sheet = (p: Page, name: string) => p.getByRole('dialog', { name });

// The sample bridge makes the plans of these tests, so their shapes are the bridge's.
const sample = createSampleEngine();
const got = async <T>(a: Promise<{ ok: true; value: T } | { ok: false } | null>): Promise<T> => { const r = await a; if (r === null || !r.ok) throw new Error('not ok'); return r.value; };
let exportPlain: ExportView, exportTick: ExportView, saveView: SaveView, bundle: BundleView, importPlan: ImportView, importLinked: ImportView;
const NO_NOTES: ImportNoteChoices = { link: {}, leave: ['yard-wiki'] };
test.beforeAll(async () => {
  exportPlain = await got(sample.planExport(SAMPLE_FOLDERS.defined));
  exportTick = await got(sample.planExport(SAMPLE_FOLDERS.stopped));
  saveView = await got(sample.planSave(SAMPLE_FOLDERS.defined, []));
  bundle = await got(sample.chooseBundle());
  importPlan = await got(sample.planImport(SAMPLE_FOLDERS.adopt, bundle.bundleId, NO_NOTES));
  importLinked = await got(sample.planImport(SAMPLE_FOLDERS.adopt, bundle.bundleId, { link: { 'yard-wiki': SAMPLE_NOTES.use }, leave: [] }));
});

const builderQuery = (): string => `${seed({ folders: [HAS], planSave: ok(saveView), listVersions: ok([]) })}&hash=${encodeURIComponent('#sample/builder/folder-3')}`;
const listQuery = (folders: FolderInfo[] = [NEW, HAS]): string => `${seed({ folders })}&hash=${encodeURIComponent('#sample/harnesses')}`;

test('Export: the Builder offers it, the sheet plans first and lists what the file holds, and nothing is written before the button', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await expect(s.getByRole('heading', { name: 'Export a harness' })).toBeFocused();
  const plan = await waiting(p, 'planExport');
  expect(plan.args).toEqual(['folder-3']);
  await expect(s.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await answer(p, plan.id, ok(exportPlain));
  await expect(s.locator('[data-export-file]')).toContainText('weekly-report.bowerloom.json');
  await expect(s.locator('[data-summary-line]')).toContainText('2 skills, 2 agents');
  await expect(s.locator('[data-check]')).toContainText('Nothing here runs. No value leaves this computer.');
  await expect(s.locator('[data-section="share-tools"]')).toHaveCount(0);
  await expect(s.locator('[data-acknowledge-paths]')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  expect(await made(p, 'runExport'), 'no write before the button').toHaveLength(0);
  await shot(p, 'share-export-plain');
});

test('Export: a path of this computer needs a tick, the write names the plan and the tick, and the result shows the file name and size', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportTick));
  await expect(s.locator('[data-foreign-path]')).toHaveCount(1);
  await shot(p, 'share-export-tick');
  const button = s.getByRole('button', { name: 'Export', exact: true });
  await expect(button).toBeDisabled();
  await s.locator('[data-acknowledge-paths] input').check();
  await expect(button).toBeEnabled();
  await button.click();
  const write = await waiting(p, 'runExport');
  expect(write.args).toEqual(['folder-3', exportTick.revision, exportTick.acknowledge]);
  // The write is held: the tick and Cancel cannot change while main has the dialog.
  await expect(s.locator('[data-acknowledge-paths] input')).toBeDisabled();
  await expect(s.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await answer(p, write.id, ok({ name: 'reading.bowerloom.json', bytes: exportTick.bytes }));
  await expect(s.locator('[data-exported-file]')).toContainText('reading.bowerloom.json');
  await expect(s.getByRole('region', { name: 'Export done' })).toBeFocused();
  await expect(s.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(s).toHaveCount(0);
});

test('Export: a dialog closed without a yes is a calm note, not an error: no red box, no code, the focus goes back to Export, and it can export again', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportPlain));
  const button = s.getByRole('button', { name: 'Export', exact: true });
  await button.click();
  await answer(p, (await waiting(p, 'runExport')).id, refused('CANCELLED', 'Nothing was written. The confirmation was closed without a yes.'));
  await expect(s.getByRole('alert')).toHaveCount(0);
  await expect(s.locator('[data-cancelled]')).toHaveText('You did not save. Nothing was written.');
  await expect(s.getByText('CANCELLED')).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toBeEnabled();
  await button.click();
  expect((await waiting(p, 'runExport')).args[0]).toBe('folder-3');
});

test('Export: a refusal of main takes the focus and offers Plan again', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportPlain));
  await s.getByRole('button', { name: 'Export', exact: true }).click();
  await answer(p, (await waiting(p, 'runExport')).id, refused('NOT_THE_PLAN_SHOWN', 'This is not the plan Bowerloom showed last for this folder, with these choices. Nothing was written. Plan again.'));
  const alert = s.getByRole('alert');
  await expect(alert).toBeFocused();
  await alert.getByRole('button', { name: 'Plan again', exact: true }).click();
  expect((await waiting(p, 'planExport')).args).toEqual(['folder-3']);
});

test('Export: the foot says what blocks the button, the button keeps the focus, and unsaved changes are named', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportTick));
  const button = s.getByRole('button', { name: 'Export', exact: true });
  await expect(s.locator('.hx-sheet-note')).toHaveText('Tick the box to export.');
  await button.focus();
  await button.click({ force: true });
  // A press on a blocked button moves the focus to the line that says why.
  await expect(s.locator('.hxsh-sr').first()).toBeFocused();
  expect(await made(p, 'runExport'), 'a held button does nothing').toHaveLength(0);
  await expect(button).toHaveAccessibleDescription('Tick the box to export.');
  await s.locator('[data-acknowledge-paths] input').scrollIntoViewIfNeeded();
  await shot(p, 'share-export-ticks-unticked');
  await s.locator('[data-acknowledge-paths] input').check();
  await expect(s.locator('.hx-sheet-note')).not.toHaveText('Tick the box to export.');
  await shot(p, 'share-export-ticks-ticked');
  await expect(s.locator('[data-unsaved]')).toHaveCount(0);
});

test('Export: Escape closes the sheet and gives the focus back to the button that opened it', async () => {
  const p = await open(builderQuery());
  const opener = p.getByRole('button', { name: 'Export', exact: true });
  await opener.focus();
  await p.keyboard.press('Enter');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportPlain));
  await p.keyboard.press('Escape');
  await expect(sheet(p, 'Export a harness')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Builder: only the header has an Export button, and the details panel has none', async () => {
  const p = await open(builderQuery());
  await expect(p.getByRole('button', { name: /^Export/ })).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await expect(p.locator('[data-details-export]')).toHaveCount(0);
});

/** Opens the Import sheet, chooses the file and goes to the folder step. */
async function toFolderStep(p: Page) {
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await expect(s.getByRole('heading', { name: 'Import a harness' })).toBeFocused();
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(bundle));
  await expect(s.locator(`[data-bundle="${bundle.bundleId}"]`)).toBeVisible();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  return s;
}
/** Goes on to the review of the new folder with the plan the test gives. */
async function toReview(p: Page, plan: ImportView = importPlan) {
  const s = await toFolderStep(p);
  await s.locator('[data-folder="folder-1"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planImport')).id, ok(plan));
  await expect(s.locator('[data-import-review]')).toBeVisible();
  return s;
}

test('Import: the file comes first; a closed dialog changes nothing; a status says the file was read; the file lists its tools and the host each reaches, its files that run, its values and its paths', async () => {
  const p = await open(listQuery());
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  const next = s.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeDisabled();
  await expect(s.locator('[data-file-status]')).toHaveText('Choose a file to go on.');
  await expect(next).toHaveAccessibleDescription('Choose a file to go on.');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, null);
  await expect(next).toBeDisabled();
  await expect(s.getByRole('alert')).toHaveCount(0);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(bundle));
  await expect(s.locator('[data-file-status]')).toHaveText('Read rope-yard.bowerloom.json. 10 files, 3 tools.');
  await expect(next).toHaveAccessibleDescription('Read rope-yard.bowerloom.json. 10 files, 3 tools.');
  await expect(s.locator('[data-bundle-name]')).toContainText('rope-yard.bowerloom.json');
  await expect(s.locator('[data-other-person]')).toContainText('This file came from another person. Check what runs before you import.');
  await expect(s.locator('[data-check]')).toContainText('3 tools');
  await expect(s.locator('[data-tool="stock-db"]')).toContainText('npx');
  await expect(s.locator('[data-tool="stock-db"] [data-arg]')).toHaveCount(4);
  await expect(s.locator('[data-tool="orders-api"]')).toContainText('orders.example.test');
  await expect(s.locator('[data-code-file]')).toHaveCount(3);
  await expect(s.locator('[data-secret="ORDERS_KEY"]')).toContainText('orders-api, in a header, to orders.example.test');
  await expect(s.locator('[data-section="share-secrets"]')).toContainText('The file passes these values from this computer to these tools.');
  await expect(s.locator('[data-foreign-path]')).toHaveCount(1);
  await expect(s.getByRole('button', { name: 'Choose another file', exact: true })).toBeVisible();
  await expect(next).toBeEnabled();
  await shot(p, 'share-import-file');
  expect((await made(p, 'planImport')).length, 'no plan before a folder is picked').toBe(0);
  expect((await made(p, 'runImport')).length).toBe(0);
});

test('Import: a check block at the top jumps to each list and puts the focus on its heading', async () => {
  const p = await open(listQuery());
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(bundle));
  await expect(s.getByRole('button', { name: '3 tools. Go to the list.', exact: true })).toBeVisible();
  await s.locator('[data-jump="paths"]').click();
  await expect(s.locator('[data-section="share-paths"] h3')).toBeFocused();
  await s.locator('[data-jump="secrets"]').click();
  await expect(s.locator('[data-section="share-secrets"] h3')).toBeFocused();
});

test('Import: the whole way: folder, plan, two ticks, the write names the bundle, the choices and the plan, and Done says nothing is installed and nothing has run', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  const nextPlan = s.getByRole('button', { name: 'Next', exact: true });
  await expect(nextPlan).toBeDisabled();
  await expect(s.locator('[data-folder-status]')).toHaveText('Pick a folder to go on.');
  await expect(s.locator('[data-folder="folder-1"]')).toContainText('No harness yet. Import makes one.');
  await s.locator('[data-folder="folder-1"]').click();
  await nextPlan.click();
  const plan = await waiting(p, 'planImport');
  expect(plan.args).toEqual(['folder-1', bundle.bundleId, NO_NOTES]);
  await answer(p, plan.id, ok(importPlan));
  const write = s.getByRole('button', { name: /^Import \d+ files$/ });
  await expect(write).toBeDisabled();
  await expect(s.locator('.hx-sheet-note')).toHaveText('Tick both boxes to import.');
  await expect(write).toHaveAccessibleDescription('Tick both boxes to import.');
  await expect(s.locator('[data-target]')).toContainText('~/Projects/inbox-tools');
  await expect(s.locator('[data-makes-harness]')).toContainText('Makes the harness. Writes 10 files in all.');
  await expect(s.locator('[data-file]')).toHaveCount(10);
  await expect(s.locator('[data-file][data-executable]')).toHaveCount(2);
  await shot(p, 'share-import-review');
  await write.focus();
  await write.click({ force: true });
  await expect(s.locator('.hxsh-sr').first()).toBeFocused();
  expect(await made(p, 'runImport'), 'a held button does nothing').toHaveLength(0);
  await s.locator('[data-approve-plan] input').scrollIntoViewIfNeeded();
  await shot(p, 'share-import-ticks-unticked');
  await s.locator('[data-approve-plan] input').check();
  await expect(s.locator('.hx-sheet-note')).toHaveText('Tick the first box to import.');
  await expect(write).toBeDisabled();
  await s.locator('[data-acknowledge-import] input').check();
  await expect(s.locator('.hx-sheet-note')).toHaveText('Ready. Press the button to go on.');
  await shot(p, 'share-import-ticks-ticked');
  await expect(write).toBeEnabled();
  await write.click();
  const run = await waiting(p, 'runImport');
  expect(run.args).toEqual(['folder-1', importPlan.revision, bundle.bundleId, NO_NOTES, importPlan.acknowledge]);
  await expect(s.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(s.locator('[data-approve-plan] input')).toBeDisabled();
  await answer(p, run.id, ok({ written: importPlan.changes.map(c => c.path), version: 'v2' }));
  await expect(s.getByRole('region', { name: 'Import done' })).toBeFocused();
  await expect(s.locator('[data-done-status]')).toHaveText('Nothing is installed. Nothing has run.');
  await expect(s.locator('[data-imported]')).toContainText('Imported 10 files into ~/Projects/inbox-tools.');
  await expect(s.locator('[data-version-kept="v2"]')).toBeVisible();
  await expect(s.locator('[data-section="share-secrets"] [data-secret]')).toHaveCount(2);
  await expect(s.getByRole('button', { name: 'Install it', exact: true })).toBeVisible();
  await s.locator('.hx-sheet-body').evaluate(el => { el.scrollTop = 0; });
  await shot(p, 'share-import-done-top');
  expect(await made(p, 'planProjection'), 'Install is offered and never started').toHaveLength(0);
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  expect((await waiting(p, 'discardBundle')).args).toEqual([bundle.bundleId]);
});

test('Import: Link a folder keeps the old plan on screen, dimmed, until the new one comes; the ticks start over, a status says so, and the focus stays on the button', async () => {
  const p = await open(listQuery());
  const s = await toReview(p);
  await expect(s.getByRole('button', { name: 'Leave out: yard-wiki', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await s.locator('[data-approve-plan] input').check();
  const link = s.getByRole('button', { name: 'Link a folder: yard-wiki', exact: true });
  await link.focus();
  await link.click();
  const chooser = await waiting(p, 'chooseNotesFolder');
  expect(chooser.args).toEqual(['use']);
  const notes: NotesView = { id: 'notes-1', label: '~/Documents/Reading list', name: 'Reading list', suggestedName: 'reading-list', pages: 3, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true };
  await answer(p, chooser.id, ok(notes));
  const second = await waiting(p, 'planImport');
  expect(second.args).toEqual(['folder-1', bundle.bundleId, { link: { 'yard-wiki': 'notes-1' }, leave: [] }]);
  // The old plan is still on screen, dimmed and busy; its ticks are cleared and held.
  await expect(s.locator('[data-import-review]')).toHaveAttribute('aria-busy', 'true');
  await expect(s.locator('[data-import-review]')).toHaveClass(/hxsh-stale/);
  await expect(s.locator('[data-file]')).toHaveCount(10);
  await expect(s.locator('[data-approve-plan] input')).not.toBeChecked();
  await expect(s.locator('[data-approve-plan] input')).toBeDisabled();
  await expect(s.locator('.hx-sheet-note')).toHaveText('Planning. Then tick again.');
  await s.locator('[data-note-choice="yard-wiki"]').scrollIntoViewIfNeeded();
  await shot(p, 'share-import-stale');
  await answer(p, second.id, ok({ ...importLinked, notes: [{ name: 'yard-wiki', choice: 'link', label: '~/Documents/Reading list', readBy: ['clerk'] }] }));
  await expect(s.locator('[data-import-review]')).toHaveAttribute('aria-busy', 'false');
  await expect(s.locator('[data-announce]')).toHaveText('Approval cleared. Tick again before you import.');
  await expect(s.locator('[data-note-state]')).toContainText('Linked to ~/Documents/Reading list');
  await expect(s.locator('[data-approve-plan] input')).not.toBeChecked();
  await expect(s.locator('[data-approve-plan] input')).toBeEnabled();
  const changed = s.getByRole('button', { name: 'Change folder: yard-wiki', exact: true });
  await expect(changed).toBeFocused();
  await s.getByRole('button', { name: 'Leave out: yard-wiki', exact: true }).click();
  expect((await waiting(p, 'planImport')).args).toEqual(['folder-1', bundle.bundleId, NO_NOTES]);
});

test('Import: a closed notes chooser changes nothing', async () => {
  const p = await open(listQuery());
  const s = await toReview(p);
  await s.getByRole('button', { name: 'Link a folder: yard-wiki', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseNotesFolder')).id, null);
  await expect(s.locator('[data-note-choice="yard-wiki"]')).toHaveAttribute('data-choice', 'leave');
  await expect(s.locator('[data-import-review]')).toHaveAttribute('aria-busy', 'false');
  expect((await made(p, 'planImport')).length).toBe(1);
});

test('Import: a closed approval dialog is a calm note, not an error, and the focus goes back to Import', async () => {
  const p = await open(listQuery());
  const s = await toReview(p);
  await s.locator('[data-approve-plan] input').check();
  await s.locator('[data-acknowledge-import] input').check();
  const write = s.getByRole('button', { name: /^Import \d+ files$/ });
  await write.click();
  await answer(p, (await waiting(p, 'runImport')).id, refused('CANCELLED', 'Nothing was written. The confirmation was closed without a yes.'));
  await expect(s.getByRole('alert')).toHaveCount(0);
  await expect(s.locator('[data-cancelled]')).toHaveText('You did not approve. Nothing was written.');
  await expect(write).toBeFocused();
  await shot(p, 'share-import-cancelled');
  // The note goes away with the next thing the person does.
  await s.locator('[data-approve-plan] input').uncheck();
  await expect(s.locator('[data-cancelled]')).toHaveCount(0);
});

test('Import: a folder whose harness has parts is marked refused and cannot be picked; one that main refuses at plan time shows the code\'s words and what to do next', async () => {
  const p = await open(listQuery([NEW, HAS, MAYBE]));
  const s = await toFolderStep(p);
  await expect(s.locator('[data-folder="folder-3"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(s.locator('[data-folder="folder-3"]')).toContainText('Has a harness. Choose an empty folder.');
  await s.locator('[data-folder="folder-3"]').click({ force: true });
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(s.locator('[data-folder="folder-4"]')).toContainText('Has a harness. It must be empty.');
  await s.locator('[data-folder="folder-4"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const words = 'This folder has a harness with parts in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written.';
  await answer(p, (await waiting(p, 'planImport')).id, refused('IMPORT_FOLDER_HAS_HARNESS', words));
  await expect(s.getByRole('alert')).toBeFocused();
  await expect(s.getByRole('alert')).toContainText(words);
  await expect(s.locator('[data-next-step]')).toContainText('Choose another folder, or an empty one.');
  await expect(s.getByRole('button', { name: /^Import \d+ files$/ })).toHaveCount(0);
  await s.getByRole('alert').getByRole('button', { name: 'Plan again', exact: true }).click();
  const again = await waiting(p, 'planImport');
  expect(again.args[0]).toBe('folder-4');
  await answer(p, again.id, refused('IMPORT_FOLDER_HAS_HARNESS', words));
  await s.locator('[data-folder="folder-1"]').click();
  await expect(s.getByRole('alert')).toHaveCount(0);
});

test('Import: a file the package refuses is shown in its own words and holds nothing; Escape closes the sheet and drops the bundle', async () => {
  const p = await open(listQuery());
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  const words = 'This is not a Bowerloom harness file, or it is a form Bowerloom does not read. Nothing was written.';
  await answer(p, (await waiting(p, 'chooseBundle')).id, refused('BUNDLE_FORMAT', words));
  await expect(s.getByRole('alert')).toContainText(words);
  await expect(s.locator('[data-next-step]')).toContainText('Choose a file that Bowerloom exported.');
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(await made(p, 'discardBundle')).toHaveLength(0);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(bundle));
  await expect(s.locator(`[data-bundle="${bundle.bundleId}"]`)).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(s).toHaveCount(0);
  expect((await waiting(p, 'discardBundle')).args).toEqual([bundle.bundleId]);
});

test('Import: a file chosen while the sheet closes is dropped the moment it arrives', async () => {
  const p = await open(listQuery());
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  const pending = await waiting(p, 'chooseBundle');
  await p.keyboard.press('Escape');
  await expect(s).toHaveCount(0);
  expect(await made(p, 'discardBundle'), 'nothing held yet').toHaveLength(0);
  await answer(p, pending.id, ok(bundle));
  expect((await waiting(p, 'discardBundle')).args).toEqual([bundle.bundleId]);
});

test('Import: a long list stays inside the sheet: 250 values show 200 rows and "and 50 more", the check block counts the 50, and a 200-character name is cut with Show all', async () => {
  const p = await open(listQuery());
  const rows = Array.from({ length: 200 }, (_, i) => ({ kind: 'env' as const, name: `VALUE_${i}`, sinks: [{ tool: 'docs', field: 'env' as const, host: null }] }));
  const big: BundleView = { ...bundle, summary: { ...bundle.summary, secrets: { rows, more: 50 }, notes: { rows: [{ name: 'W'.repeat(200), readBy: ['clerk'] }], more: 0 } } };
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(big));
  await expect(s.locator('[data-secret]')).toHaveCount(200);
  await expect(s.locator('[data-more="50"]')).toHaveText('and 50 more');
  await expect(s.locator('[data-hidden="50"]')).toBeVisible();
  // A name under a tick (a value's name) is never cut; a notes name is a name, and is cut with a button.
  await expect(s.locator('[data-secret]').first().getByRole('button')).toHaveCount(0);
  const note = s.locator('[data-note]').first();
  await note.scrollIntoViewIfNeeded();
  const show = note.getByRole('button', { name: 'Show all', exact: true });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await shot(p, 'share-import-long-name');
  await show.click();
  await expect(note.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await shot(p, 'share-import-long-name-open');
  const widths = await s.evaluate(el => { const body = el.querySelector('.hx-sheet-body')!; return { client: body.clientWidth, scroll: body.scrollWidth }; });
  expect(widths.scroll, 'nothing is wider than the body').toBeLessThanOrEqual(widths.client);
});

const LONG_ARGS = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(198)}`);
const LONG_HOST = `${'h'.repeat(180)}.example.test`;
const longBundle = (): BundleView => ({ ...bundle, summary: { ...bundle.summary, tools: { rows: [{ name: 'long', kind: 'mcp' as const, transport: 'stdio', runsCode: true, command: 'node', args: LONG_ARGS, host: LONG_HOST, event: null, flags: [] }, ...bundle.summary.tools.rows], more: 0 } } });

test('Import: a command with 20 arguments of 200 characters and a 200-character host is shown whole, one argument to a line, with no inner scroll, and nothing widens the sheet', async () => {
  const p = await open(listQuery(), { width: 1280, height: 2600 });
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(longBundle()));
  const row = s.locator('[data-tool="long"]');
  await expect(row.locator('[data-arg]')).toHaveCount(20);
  const text = await row.locator('[data-arg]').allInnerTexts();
  expect(text).toEqual(LONG_ARGS);
  await expect(row.locator('[data-host]')).toContainText(LONG_HOST);
  const widths = await s.evaluate(el => { const body = el.querySelector('.hx-sheet-body')!; return { client: body.clientWidth, scroll: body.scrollWidth }; });
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  // The list of arguments is not a scroll box: it is as tall as its lines, so the last argument is never hidden below an inner scroll position.
  const box = await row.locator('.hxsh-args').evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
  expect(box.scroll).toBeLessThanOrEqual(box.client);
  expect(box.overflow).toBe('visible');
  // The sheet is as tall as the window here, so the whole command can be seen in one picture.
  await p.addStyleTag({ content: '[data-home] .hx-sheet[data-slot="import"][data-tall] { height: auto !important; max-height: none !important; } [data-home] .hx-sheet-body { overflow: visible !important; max-height: none !important; }' });
  await row.scrollIntoViewIfNeeded();
  // The row is taller than the screen, so the picture is of the row itself.
  if (shotsDir !== null) await row.screenshot({ path: join(shotsDir, 'share-import-long-command-whole.png') });
});

test('Import: the review at 1440 by 900 and at 390 by 844 keeps every control inside the sheet', async () => {
  for (const [name, size] of [['1440x900', { width: 1440, height: 900 }], ['390x844', { width: 390, height: 844 }]] as const) {
    const p = await open(listQuery(), size);
    const s = await toReview(p);
    await shot(p, `share-import-review-${name}`);
    const out = await s.evaluate(el => { const body = el.querySelector('.hx-sheet-body')!; const panel = el.getBoundingClientRect(); const bad = [...el.querySelectorAll('button, input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > panel.right + 1 || r.left < panel.left - 1); }); return { client: body.clientWidth, scroll: body.scrollWidth, bad: bad.length, panelRight: Math.round(panel.right), win: window.innerWidth }; });
    expect(out.scroll, name).toBeLessThanOrEqual(out.client);
    expect(out.bad, name).toBe(0);
    expect(out.panelRight, name).toBeLessThanOrEqual(out.win);
    await page.close();
  }
});

test('Import: the entry is in the Folders block; with no bridge it stays, held, and says why', async () => {
  const p = await open(listQuery());
  await expect(p.locator('[data-section="folders"]').getByRole('button', { name: 'Import from a file', exact: true })).toBeEnabled();
  await expect(p.getByRole('button', { name: 'Import from a file', exact: true }), 'one entry, not two').toHaveCount(1);
  await p.close();
  const q = await open('?bridge=none&hash=' + encodeURIComponent('#sample/harnesses'));
  const entry = q.getByRole('button', { name: 'Import from a file', exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toBeDisabled();
  await expect(q.locator('[data-import-why]')).toContainText('This window cannot reach Bowerloom.');
  await expect(entry).toHaveAccessibleDescription(/cannot reach Bowerloom/);
  await entry.click({ force: true });
  await expect(sheet(q, 'Import a harness')).toHaveCount(0);
});

// Same folder constants the sample uses are named here so a rename of them fails this file too.
test('the sample folders the tests above stand for still exist', () => {
  expect(Object.values(SAMPLE_FOLDERS)).toHaveLength(3);
});
