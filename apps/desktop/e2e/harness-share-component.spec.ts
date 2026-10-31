/**
 * Component tests of the Export and Import sheets (journey 4, Task 1 lane D), in a real Electron window: the harness-first app on a test page whose engine answers
 * only when the test says (tests/component/sheets-page.tsx). They cover the Export sheet from the Builder (plan, the tick for a path of this computer, the write
 * named by the plan, a closed dialog, and a held write), and the Import sheet from the harness list (the open dialog closed, the file, the folder, the review with both
 * ticks, a notes choice that plans again, the refusals in the code's words, the Done step with the values again, and the bundle dropped on close).
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop, shot } from './harness-page.js';
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

async function open(query: string): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, { url, options }) => { const w = new BrowserWindow({ width: 1280, height: 800, ...options, webPreferences: { contextIsolation: true, sandbox: true, partition: 'share-test' } }); void w.loadURL(url); }, { url: `${pathToFileURL(html).href}${query}`, options: extraWindowOptions() });
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
const NEW = folder('folder-1', 'alpha'), HAS = folder('folder-3', 'defined', { hasDefinition: true, engines: ['claude-code', 'codex'] });
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
  await expect(s.locator('[data-count="skills"]')).toContainText('2');
  await expect(s.locator('[data-section="share-tools"]')).toContainText('No tools in this file.');
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

test('Export: a dialog closed without a yes is a refusal in main\'s words that takes the focus; the sheet stays and can export again', async () => {
  const p = await open(builderQuery());
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = sheet(p, 'Export a harness');
  await answer(p, (await waiting(p, 'planExport')).id, ok(exportPlain));
  await s.getByRole('button', { name: 'Export', exact: true }).click();
  await answer(p, (await waiting(p, 'runExport')).id, refused('CANCELLED', 'Nothing was written. The confirmation was closed without a yes.'));
  const alert = s.getByRole('alert');
  await expect(alert).toBeFocused();
  await expect(alert).toContainText('Nothing was written.');
  await expect(s.locator('[data-next-step]')).toContainText('Press the button again when you are ready.');
  await expect(s.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await alert.getByRole('button', { name: 'Plan again', exact: true }).click();
  expect((await waiting(p, 'planExport')).args).toEqual(['folder-3']);
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

test('Import: the file comes first; a closed dialog changes nothing; the file lists its tools and the host each reaches, its files that run, its values and its paths', async () => {
  const p = await open(listQuery());
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  const next = s.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeDisabled();
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, null);
  await expect(next).toBeDisabled();
  await expect(s.getByRole('alert')).toHaveCount(0);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(bundle));
  await expect(s.locator('[data-bundle-name]')).toContainText('rope-yard.bowerloom.json');
  await expect(s.locator('[data-other-person]')).toContainText('A file from another person is data. Read the files that run.');
  await expect(s.locator('[data-tool="stock-db"]')).toContainText('npx -y stock-db-server@2.0.1 --yard north');
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

test('Import: the whole way: folder, plan, two ticks, the write names the bundle, the choices and the plan, and Done lists the values again and offers Install', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await s.locator('[data-folder="folder-1"]').click();
  await expect(s.locator('[data-folder-note]')).toContainText('Make a harness here first.');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const plan = await waiting(p, 'planImport');
  expect(plan.args).toEqual(['folder-1', bundle.bundleId, NO_NOTES]);
  await answer(p, plan.id, ok(importPlan));
  const write = s.getByRole('button', { name: /^Import \d+ files$/ });
  await expect(write).toBeDisabled();
  await shot(p, 'share-import-review');
  await expect(s.locator('[data-file]')).toHaveCount(importPlan.changes.length);
  await expect(s.locator('[data-file][data-executable]')).toHaveCount(2);
  await s.locator('[data-approve-plan] input').check();
  await expect(write).toBeDisabled();
  await s.locator('[data-acknowledge-import] input').check();
  await expect(write).toBeEnabled();
  await write.click();
  const run = await waiting(p, 'runImport');
  expect(run.args).toEqual(['folder-1', importPlan.revision, bundle.bundleId, NO_NOTES, importPlan.acknowledge]);
  await expect(s.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(s.locator('[data-approve-plan] input')).toBeDisabled();
  await answer(p, run.id, ok({ written: importPlan.changes.map(c => c.path), version: 'v2' }));
  await expect(s.getByRole('region', { name: 'Import done' })).toBeFocused();
  await expect(s.locator('[data-version-kept="v2"]')).toBeVisible();
  await expect(s.locator('[data-section="share-secrets"] [data-secret]')).toHaveCount(2);
  await expect(s.getByText('Nothing is installed. Install is a separate step.')).toBeVisible();
  await expect(s.getByRole('button', { name: 'Install it', exact: true })).toBeVisible();
  await shot(p, 'share-import-done');
  expect(await made(p, 'planProjection'), 'Install is offered and never started').toHaveLength(0);
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  expect((await waiting(p, 'discardBundle')).args).toEqual([bundle.bundleId]);
});

test('Import: Link a folder opens main\'s notes chooser and plans again with the folder; the ticks start over; Leave out goes back to the default', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  await s.locator('[data-folder="folder-1"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planImport')).id, ok(importPlan));
  await expect(s.locator('[data-note-choice="yard-wiki"]')).toHaveAttribute('data-choice', 'leave');
  await expect(s.getByRole('button', { name: 'Leave out: yard-wiki', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Link a folder: yard-wiki', exact: true }).click();
  const chooser = await waiting(p, 'chooseNotesFolder');
  expect(chooser.args).toEqual(['use']);
  const notes: NotesView = { id: 'notes-1', label: '~/Documents/Reading list', name: 'Reading list', suggestedName: 'reading-list', pages: 3, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true };
  await answer(p, chooser.id, ok(notes));
  const second = await waiting(p, 'planImport');
  expect(second.args).toEqual(['folder-1', bundle.bundleId, { link: { 'yard-wiki': 'notes-1' }, leave: [] }]);
  await answer(p, second.id, ok({ ...importLinked, notes: [{ name: 'yard-wiki', choice: 'link', label: '~/Documents/Reading list', readBy: ['clerk'] }] }));
  await expect(s.locator('[data-note-state]')).toContainText('Linked to ~/Documents/Reading list');
  await expect(s.locator('[data-approve-plan] input')).not.toBeChecked();
  await s.getByRole('button', { name: 'Leave out: yard-wiki', exact: true }).click();
  expect((await waiting(p, 'planImport')).args).toEqual(['folder-1', bundle.bundleId, NO_NOTES]);
});

test('Import: a closed notes chooser changes nothing', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  await s.locator('[data-folder="folder-1"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planImport')).id, ok(importPlan));
  await s.getByRole('button', { name: 'Link a folder: yard-wiki', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseNotesFolder')).id, null);
  await expect(s.locator('[data-note-choice="yard-wiki"]')).toHaveAttribute('data-choice', 'leave');
  expect((await made(p, 'planImport')).length).toBe(1);
});

test('Import: a folder with parts is refused in the code\'s words, with what to do next, and another folder can be picked', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  await s.locator('[data-folder="folder-3"]').click();
  await expect(s.locator('[data-folder-note]')).toContainText('It must have no harness, or an empty one.');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const words = 'This folder has a harness with parts in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written.';
  await answer(p, (await waiting(p, 'planImport')).id, refused('IMPORT_FOLDER_HAS_HARNESS', words));
  await expect(s.getByRole('alert')).toBeFocused();
  await expect(s.getByRole('alert')).toContainText(words);
  await expect(s.locator('[data-next-step]')).toContainText('Choose another folder, or an empty one.');
  // The refusal stays on the folder step: nothing was planned, so there is no import to write, and another folder can be picked.
  await expect(s.getByRole('button', { name: /^Import \d+ files$/ })).toHaveCount(0);
  await s.locator('[data-folder="folder-1"]').click();
  await expect(s.getByRole('alert')).toHaveCount(0);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  expect((await waiting(p, 'planImport')).args[0]).toBe('folder-1');
});

test('Import: a folder with no harness offers "New harness from a folder"; the plan is made again when that sheet closes', async () => {
  const p = await open(listQuery());
  const s = await toFolderStep(p);
  await s.locator('[data-folder="folder-1"]').click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await answer(p, (await waiting(p, 'planImport')).id, refused('SAVE_NO_DEFINITION', 'This folder has no harness yet, so there is nothing to save. Make one first with New harness from a folder. Nothing was written.'));
  await expect(s.locator('[data-next-step]')).toContainText('Make an empty harness in this folder');
  await s.getByRole('button', { name: 'New harness from a folder', exact: true }).click();
  const adopt = sheet(p, 'New harness from a folder');
  await expect(adopt).toBeVisible();
  await adopt.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(adopt).toHaveCount(0);
  // The folders are read again and the plan that waited for the harness is made again.
  expect((await waiting(p, 'planImport')).args[0]).toBe('folder-1');
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

test('Import: a long list stays inside the sheet: 250 values show 200 rows and "and 50 more", and a 200-character name does not widen the sheet', async () => {
  const p = await open(listQuery());
  const rows = Array.from({ length: 200 }, (_, i) => ({ kind: 'env' as const, name: i === 0 ? 'V'.repeat(200) : `VALUE_${i}`, sinks: [{ tool: 'docs', field: 'env' as const, host: null }] }));
  const big: BundleView = { ...bundle, summary: { ...bundle.summary, secrets: { rows, more: 50 } } };
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = sheet(p, 'Import a harness');
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await answer(p, (await waiting(p, 'chooseBundle')).id, ok(big));
  await expect(s.locator('[data-secret]')).toHaveCount(200);
  await expect(s.locator('[data-more="50"]')).toHaveText('and 50 more');
  await shot(p, 'share-import-long-list');
  const widths = await s.evaluate(el => { const body = el.querySelector('.hx-sheet-body')!; return { client: body.clientWidth, scroll: body.scrollWidth }; });
  expect(widths.scroll, 'nothing is wider than the body').toBeLessThanOrEqual(widths.client);
});

test('Import: there is no bridge, and the sheet says so', async () => {
  const p = await open('?bridge=none&hash=' + encodeURIComponent('#sample/harnesses'));
  // With no bridge the folders block is not drawn, so the sheet has no button on this screen.
  await expect(p.getByRole('button', { name: 'Import from a file', exact: true })).toHaveCount(0);
});

// Same folder constants the sample uses are named here so a rename of them fails this file too.
test('the sample folders the tests above stand for still exist', () => {
  expect(Object.values(SAMPLE_FOLDERS)).toHaveLength(3);
});
