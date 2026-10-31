/**
 * Component tests of the Builder (review round 1), in a real Electron window: the harness-first app on a test page whose engine answers only when the test
 * says (tests/component/sheets-page.tsx), so each test can make a call fail or refuse. They cover a folder list that cannot be read (H1), a harness that
 * cannot be read and the sheet's own next steps (M1), no bridge at all, a second visit that reads the base and the notes again (CM1, CM2), a refusal that
 * reaches the person from a tick (M3), a save that fails and keeps the draft, and a set-aside that works while the save points cannot be read again (L7).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop } from './harness-page.js';
import type { DefinitionView, FolderInfo } from '../shared/engine/types.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

let app: ElectronApplication, page: Page, html: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = tempDir('bowerloom-builder-component-');
  const script = `import { build } from 'esbuild'; await build({ entryPoints: ['tests/component/sheets-page.tsx'], outfile: ${JSON.stringify(join(out, 'sheets.js'))}, bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });`;
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  const bundle = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(bundle.stderr);
  html = join(out, 'sheets.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(out, 'sheets.css')).href}"></head><body><script src="${pathToFileURL(join(out, 'sheets.js')).href}"></script></body></html>`);
  const userData = tempDir('bowerloom-prototype-e2e-builder-component-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-v3', `--user-data-dir=${userData}`] });
  await app.firstWindow();
});
test.afterAll(async () => { await app?.close(); removeTempDirs(); });

const BUILDER = '#prototype-v3/builder/folder-3';
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const refused = (code: string, message: string): { ok: false; refusal: { code: string; message: string; paths: string[] } } => ({ ok: false, refusal: { code, message, paths: [] } });
const WEEKLY: FolderInfo = {
  id: 'folder-3', label: '~/Projects/weekly', name: 'weekly', hasDefinition: true, engines: ['claude-code'], previewEngines: false, installedEngines: [], problem: null,
  projected: false, unfinished: { projection: false, adoption: false },
};
const DEF: DefinitionView = {
  id: 'weekly', description: 'Drafts the weekly report.', engines: ['claude-code'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [
    { id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] },
    { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: ['notes'] },
  ],
  sources: [{ name: 'notes', kind: 'wiki-folder', label: '~/Documents/notes', notesId: 'notes-1' }], kits: [],
};
const REVISION = 'a'.repeat(64);
const view = (changes: { path: string; action: 'create' | 'update' | 'delete' }[] = []) => ({
  folder: '~/Projects/weekly', changes, definition: DEF, noop: changes.length === 0, revision: REVISION, removedSources: [], copiedExecutables: [], acknowledge: null,
});
const NOTES = { id: 'notes-1', label: '~/Documents/notes', name: 'notes', suggestedName: 'notes', pages: 12, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true };
/** Answers a Builder's reads at once, so the screen is drawn from the start. */
const READS = { folders: [WEEKLY], planSave: ok(view()), listVersions: ok([]), notesSummary: ok(NOTES) };

async function open(hash: string, auto: Record<string, unknown> | null, bridge = true): Promise<Page> {
  const before = app.windows().length;
  const query = `?hash=${encodeURIComponent(hash)}${auto === null ? '' : `&auto=${encodeURIComponent(JSON.stringify(auto))}`}${bridge ? '' : '&bridge=none'}`;
  await app.evaluate(({ BrowserWindow }, url) => { const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: 'builder-component-test' } }); void w.loadURL(url); }, `${pathToFileURL(html).href}${query}`);
  await expect.poll(() => app.windows().length).toBe(before + 1);
  page = app.windows()[before]!;
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.waitForSelector('[data-home]');
  return page;
}
test.afterEach(async () => { await page?.close().catch(() => undefined); });

interface Call { id: number; name: string; args: unknown[]; settled: boolean }
type Driver = { calls: Call[]; auto: Record<string, unknown>; answer(i: number, v: unknown): void; fail(i: number, m: string): void };
const calls = (p: Page): Promise<Call[]> => p.evaluate(() => (window as unknown as { __driver: Driver }).__driver.calls.map(c => ({ id: c.id, name: c.name, args: c.args, settled: c.settled })));
const named = async (p: Page, name: string): Promise<number> => (await calls(p)).filter(c => c.name === name).length;
const auto = (p: Page, name: string, value: unknown): Promise<void> => p.evaluate(([n, v]) => { (window as unknown as { __driver: Driver }).__driver.auto[n as string] = v; }, [name, value] as const);
const unauto = (p: Page, name: string): Promise<void> => p.evaluate(n => { delete (window as unknown as { __driver: Driver }).__driver.auto[n]; }, name);
const answer = (p: Page, id: number, value: unknown): Promise<void> => p.evaluate(([i, v]) => { (window as unknown as { __driver: Driver }).__driver.answer(i as number, v); }, [id, value] as const);
const fail = (p: Page, id: number, message: string): Promise<void> => p.evaluate(([i, m]) => { (window as unknown as { __driver: Driver }).__driver.fail(i as number, m as string); }, [id, message] as const);
/** The newest call of a name that is not answered yet. */
async function waiting(p: Page, name: string): Promise<Call> {
  await expect.poll(async () => (await calls(p)).some(c => c.name === name && !c.settled), { message: `a ${name} call` }).toBe(true);
  return (await calls(p)).filter(c => c.name === name && !c.settled).at(-1)!;
}
const count = (p: Page) => p.locator('[data-draft]');
const tick = (p: Page, agent: string, skill: string) => p.locator(`[data-agent="${agent}"]`).getByRole('checkbox', { name: `${skill}: ${agent}` });
const CALL_FAILED = 'Bowerloom could not finish this. Nothing more was changed.';

test('H1: a folder list that cannot be read shows its words and Try again, and the next try draws the Builder', async () => {
  const p = await open(BUILDER, { planSave: ok(view()), listVersions: ok([]), notesSummary: ok(NOTES) });
  const first = await waiting(p, 'folders');
  await fail(p, first.id, 'disk gone');
  const note = p.getByRole('alert').filter({ hasText: CALL_FAILED });
  await expect(note).toBeVisible();
  await expect(note).not.toContainText('disk gone');
  await expect(p.locator('[data-builder-save]')).toHaveCount(0);
  await p.getByRole('button', { name: 'Try again', exact: true }).click();
  const second = await waiting(p, 'folders');
  expect(second.id).toBeGreaterThan(first.id);
  await answer(p, second.id, [WEEKLY]);
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await expect(count(p)).toContainText('No change yet.');
  await expect(p.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
});

test('no bridge: the Builder says this window cannot reach Bowerloom, and draws nothing else', async () => {
  const p = await open(BUILDER, null, false);
  await expect(p.locator('[data-no-bridge]')).toHaveText('This window cannot reach Bowerloom. Start it with the real launch command.');
  await expect(p.locator('[data-builder-save]')).toHaveCount(0);
  await expect(p.locator('.hx-node')).toHaveCount(0);
});

test('M1: a harness that cannot be read shows the sheet\'s own next steps: the words, Plan again, and the recovery of a stopped change', async () => {
  const p = await open(BUILDER, { folders: [WEEKLY], listVersions: ok([]), notesSummary: ok(NOTES) });
  const first = await waiting(p, 'planSave');
  expect(first.args).toEqual(['folder-3', []]);
  await answer(p, first.id, refused('SAVE_RECOVERY_REQUIRED', 'A stopped save left files behind.'));
  const note = p.getByRole('alert').filter({ hasText: 'A stopped save left files behind.' });
  await expect(note).toBeVisible();
  await expect(p.locator('[data-next-step]')).toHaveText('Finish the stopped change first, then save.');
  await expect(p.locator('[data-builder-save]')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Plan a recovery', exact: true })).toBeVisible();
  // Plan again reads the harness again, and a good answer draws the Builder.
  await p.getByRole('button', { name: 'Plan again', exact: true }).click();
  const second = await waiting(p, 'planSave');
  expect(second.id).toBeGreaterThan(first.id);
  await answer(p, second.id, ok(view()));
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await expect(p.getByRole('alert').filter({ hasText: 'A stopped save left files behind.' })).toHaveCount(0);
  await expect(p.locator('[data-next-step]')).toHaveCount(0);
});

test('M1: a damaged save point record offers Set aside on the screen itself, and the harness is read again after it', async () => {
  const p = await open(BUILDER, { folders: [WEEKLY], listVersions: ok([]), notesSummary: ok(NOTES) });
  await answer(p, (await waiting(p, 'planSave')).id, refused('VERSION_CORRUPT', 'The save point record is damaged.'));
  await expect(p.getByRole('alert').filter({ hasText: 'The save point record is damaged.' })).toBeVisible();
  await p.locator('[data-set-aside]').click();
  const plan = await waiting(p, 'planSetAside');
  expect(plan.args).toEqual(['folder-3']);
  await answer(p, plan.id, ok({ folder: '~/Projects/weekly', damaged: true, revision: REVISION }));
  await expect(p.locator('[data-set-aside-plan="aaaaaaaa"]')).toBeVisible();
  await p.locator('[data-run-set-aside]').click();
  const run = await waiting(p, 'runSetAside');
  expect(run.args).toEqual(['folder-3', REVISION]);
  const before = await named(p, 'planSave');
  await answer(p, run.id, ok({ name: 'v-old-2026-10-31' }));
  await expect(p.locator('[data-set-aside-done]')).toHaveAttribute('data-set-aside-done', 'v-old-2026-10-31');
  // The harness is read again, and now it answers.
  const again = await waiting(p, 'planSave');
  expect(await named(p, 'planSave')).toBeGreaterThan(before);
  await answer(p, again.id, ok(view()));
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
});

test('CM1, CM2: a second visit reads the harness and the notes again, and the Notes panel is not left empty', async () => {
  const p = await open(BUILDER, READS);
  await expect(p.locator('[data-pages="12"]')).toBeVisible();
  const planned = await named(p, 'planSave'), summaries = await named(p, 'notesSummary');
  expect(planned).toBeGreaterThanOrEqual(1);
  expect(summaries).toBeGreaterThanOrEqual(1);
  await p.evaluate(() => { location.hash = '#prototype-v3/harnesses'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await p.evaluate(h => { location.hash = h; }, BUILDER);
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await expect.poll(() => named(p, 'planSave'), { message: 'the harness is read again' }).toBeGreaterThan(planned);
  await expect.poll(() => named(p, 'notesSummary'), { message: 'the notes are read again' }).toBeGreaterThan(summaries);
  await expect(p.locator('[data-pages="12"]')).toBeVisible();
});

test('CM2, L5: a read after a sheet closes keeps the old base on screen; the draft stays on the same harness and goes, with a word, on another', async () => {
  const p = await open(BUILDER, READS);
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await tick(p, 'editor', 'check-facts').check();
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await unauto(p, 'planSave');
  const reads = async (): Promise<number> => (await calls(p)).filter(c => c.name === 'planSave' && (c.args[1] as unknown[]).length === 0).length;
  // A sheet opens and closes: the harness is read again, and the base stays on screen until the answer comes.
  const closeSheet = async (): Promise<void> => {
    await p.locator('[data-builder-save]').click();
    const sheet = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
    await expect(sheet).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  };
  let before = await reads();
  await closeSheet();
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await expect(count(p)).toContainText('1 change, not saved yet.');
  const same = (await calls(p)).filter(c => c.name === 'planSave' && !c.settled && (c.args[1] as unknown[]).length === 0).at(-1)!;
  await answer(p, same.id, ok(view()));
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(tick(p, 'editor', 'check-facts')).toBeChecked();
  // The harness changed on disk: the draft cannot stay on it, and the person is told.
  before = await reads();
  await closeSheet();
  await expect.poll(reads).toBeGreaterThan(before);
  const other = (await calls(p)).filter(c => c.name === 'planSave' && !c.settled && (c.args[1] as unknown[]).length === 0).at(-1)!;
  await answer(p, other.id, ok({ ...view(), definition: { ...DEF, agents: DEF.agents.map(a => (a.id === 'editor' ? { ...a, skills: ['draft-outline'] } : a)) } }));
  await expect(count(p)).toContainText('No change yet.');
  await expect(p.getByText('This harness changed on disk. Your unsaved changes were dropped.')).toBeVisible();
});

test('M3: a tick the draft refuses says why in words and changes nothing', async () => {
  const p = await open(BUILDER, READS);
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  // The harness holds one interface. Clearing it is refused, and the draft stays as it was.
  const only = p.locator('[data-engine="claude-code"] input');
  await expect(only).toBeChecked();
  await only.click();
  await expect(p.getByText('Keep at least one interface.')).toBeVisible();
  await expect(only).toBeChecked();
  await expect(count(p)).toContainText('No change yet.');
});

test('a save that fails keeps the draft: the sheet shows the refusal, and the Builder still holds the change', async () => {
  const p = await open(BUILDER, { folders: [WEEKLY], listVersions: ok([]), notesSummary: ok(NOTES) });
  await answer(p, (await waiting(p, 'planSave')).id, ok(view()));
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await tick(p, 'editor', 'check-facts').check();
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await p.locator('[data-builder-save]').click();
  const sheet = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
  const plan = await waiting(p, 'planSave');
  expect(plan.args).toEqual(['folder-3', [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }]]);
  await answer(p, plan.id, ok({ ...view([{ path: '.bowerloom/agents/editor.md', action: 'update' }]), definition: { ...DEF, agents: DEF.agents.map(a => (a.id === 'editor' ? { ...a, skills: ['check-facts'] } : a)) } }));
  await sheet.locator('[data-approve-plan] input').check();
  await sheet.getByRole('button', { name: 'Save 1 file', exact: true }).click();
  const write = await waiting(p, 'runSave');
  await fail(p, write.id, 'disk gone');
  await expect(sheet.getByRole('alert').filter({ hasText: CALL_FAILED })).toBeVisible();
  // The review is still there to try again, and nothing was said to be saved.
  await expect(sheet.locator('[data-version-kept]')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Save 1 file', exact: true })).toBeVisible();
  // Closing the sheet: the Builder still holds the change, and reads the harness again as the sheet closes.
  await auto(p, 'planSave', ok(view()));
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(count(p)).toContainText('1 change, not saved yet.');
  await expect(tick(p, 'editor', 'check-facts')).toBeChecked();
});

test('N1: while the sheet reads the Notes keeper, Review the save waits, so the review never plans past it', async () => {
  const p = await open(BUILDER, { folders: [WEEKLY], listVersions: ok([]), notesSummary: ok(NOTES) });
  await answer(p, (await waiting(p, 'planSave')).id, ok(view()));
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await tick(p, 'editor', 'check-facts').check();
  await p.locator('[data-builder-save]').click();
  const sheet = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
  await answer(p, (await waiting(p, 'planSave')).id, ok(view([{ path: '.bowerloom/agents/editor.md', action: 'update' }])));
  await sheet.getByRole('button', { name: 'Back', exact: true }).click();
  // The guided tour starts on its own at first use; it is not what this test is about.
  const skip = p.getByRole('button', { name: 'Skip tour', exact: true });
  await skip.click();
  const review = sheet.getByRole('button', { name: 'Review the save', exact: true });
  await expect(review).toBeEnabled();
  await sheet.getByRole('button', { name: 'Add the Notes keeper', exact: true }).click();
  const kit = await waiting(p, 'planSave');
  expect(kit.args).toEqual(['folder-3', [{ kind: 'add-from-kit', kit: expect.any(String) }]]);
  await expect(review).toBeDisabled();
  await expect(sheet.getByText('Planning', { exact: true })).toBeVisible();
  await answer(p, kit.id, refused('NOT_ALLOWED', 'The kit is not here.'));
  await expect(review).toBeEnabled();
});

test('L7: a set-aside that worked says so when the save points cannot be read again; the failure is the save points\' own', async () => {
  const p = await open(BUILDER, { folders: [WEEKLY], planSave: ok(view()), notesSummary: ok(NOTES), listVersions: refused('VERSION_CORRUPT', 'The save point record is damaged.') });
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await p.locator('[data-builder-points]').click();
  const drawer = p.getByRole('dialog', { name: 'Save points' });
  await drawer.locator('[data-set-aside]').click();
  await answer(p, (await waiting(p, 'planSetAside')).id, ok({ folder: '~/Projects/weekly', damaged: true, revision: REVISION }));
  await unauto(p, 'listVersions');
  await drawer.locator('[data-run-set-aside]').click();
  await answer(p, (await waiting(p, 'runSetAside')).id, ok({ name: 'v-old-2026-10-31' }));
  const read = await waiting(p, 'listVersions');
  await fail(p, read.id, 'disk gone');
  await expect(drawer.locator('[data-set-aside-done]')).toHaveAttribute('data-set-aside-done', 'v-old-2026-10-31');
  await expect(drawer.getByRole('alert').filter({ hasText: CALL_FAILED })).toBeVisible();
});

test('a save sheet opened for a folder that cannot be saved picks nothing and says why, and never saves another folder', async () => {
  const stopped: FolderInfo = { ...WEEKLY, problem: 'The harness folder is not safe to read.' };
  const other: FolderInfo = { ...WEEKLY, id: 'folder-4', label: '~/Projects/other', name: 'other' };
  const p = await open(BUILDER, { folders: [stopped, other], planSave: ok(view()), listVersions: ok([]), notesSummary: ok(NOTES) });
  await expect(p.locator('.hx-node[data-node="agent:editor"]')).toBeVisible();
  await tick(p, 'editor', 'check-facts').check();
  const before = await named(p, 'planSave');
  await p.locator('[data-builder-save]').click();
  const sheet = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
  await expect(sheet.locator('[data-folder-note]')).toHaveText('weekly: The harness folder is not safe to read.');
  await expect(sheet.locator('[data-open-edit]')).toBeDisabled();
  await expect(sheet.locator('[data-save-review]')).toHaveCount(0);
  expect(await named(p, 'planSave')).toBe(before);
});
