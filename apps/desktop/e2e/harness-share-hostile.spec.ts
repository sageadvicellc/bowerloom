/**
 * Hostile files for Export and Import, in the real app (journey 4, hidden). Each case is a file a careless or hostile person could hand over: it is not JSON, it names a path outside
 * the harness, it is a link, it is too big, a tool command is too long to read, a tool has too many arguments, a tool environment starts code, a value is written in the files, two
 * file names are one name once case and spelling are folded, or the export is asked to save inside the harness.
 * Each is refused in words on the sheet, writes nothing, and leaves the folder's harness loading. The folder and the sheet are driven as a person drives them. Only the native
 * dialogs are stubbed. The bundles are made at run time with fake values.
 */
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { mkdirSync, openSync, closeSync, ftruncateSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { computeRevision, loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { exportSheet, importSheet, newMadeUpHome, openInBuilder, readTree, saveAt, startApp, stubSaveDialog, treeShape } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness | null = null;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); h = null; });

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
interface Rec { path: string; size: number; sha256: string; encoding: 'utf8'; data: string }
const record = (path: string, text: string): Rec => ({ path, size: Buffer.byteLength(text), sha256: sha(Buffer.from(text)), encoding: 'utf8', data: text });
/** An envelope whose size, checksums and revision are right for its records, so the one thing wrong is the thing the case is about. */
function envelope(records: Rec[]): string {
  const sorted = [...records].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  let revision = `sha256:${'0'.repeat(64)}`;
  try { revision = computeRevision(sorted.map(r => ({ path: r.path, bytes: Buffer.from(r.data) }))); } catch { /* a path the revision refuses keeps the zero revision */ }
  return json({ format: 'bowerloom/harness-bundle/v1beta1', harness: 'rope-ledger', generator: 'bowerloom', revision, files: sorted, knowledge: [] });
}
const harnessJson = (parts: Record<string, string>): Rec => record('harness.json', json({ format: 'bowerloom/harness/v1beta1', id: 'rope-ledger', description: 'Checks the rope orders.', engines: [{ id: 'claude-code' }], parts }));
const prompt = record('instructions/AGENTS.md', '# Rope ledger\n\nCount the coils before you report.\n');
/** A bundle with one tool file: the harness, its prompt and an mcp.json. */
const withTools = (servers: unknown[]): string => envelope([harnessJson({ 'system-prompt': 'instructions/AGENTS.md', mcp: 'mcp.json' }), prompt, record('mcp.json', json({ servers }))]);
const stdio = (extra: Record<string, unknown>): unknown => ({ name: 'tally-feed', transport: 'stdio', command: 'node', ...extra });
/** A value that looks like a token, built at run time so no file of this repository holds one. */
const FAKE_TOKEN = ['ghp', 'q7'.repeat(18)].join('_');

interface Hostile { name: string; code: string; next: string; make(dir: string): string }
function write(dir: string, name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}
const CASES: Hostile[] = [
  { name: 'a note that is not JSON', code: 'BUNDLE_FORMAT', next: 'Choose a file that Bowerloom exported.', make: dir => write(dir, 'note.json', 'this is a note, not a bundle\n') },
  { name: 'a path that climbs out of the harness', code: 'BUNDLE_PATH_UNSAFE', next: 'Do not use this file. Ask for a new one.', make: dir => write(dir, 'climb.json', envelope([harnessJson({}), record('../outside.md', 'x\n')])) },
  { name: 'a link to a good file', code: 'BUNDLE_FILE_UNSAFE', next: 'Choose a plain file of your own.', make: dir => { const real = write(dir, 'real.json', withTools([])); const link = join(dir, 'link.json'); symlinkSync(real, link); return link; } },
  { name: 'a file of 49 MiB', code: 'BUNDLE_TOO_LARGE', next: 'Choose a smaller file.', make: dir => { const file = join(dir, 'huge.json'); const fd = openSync(file, 'w'); ftruncateSync(fd, 49 * 1024 * 1024); closeSync(fd); return file; } },
  { name: 'one file of 1 MiB and a byte', code: 'BUNDLE_TOO_LARGE', next: 'Choose a smaller file.', make: dir => write(dir, 'big-entry.json', envelope([harnessJson({ scripts: 'scripts/' }), record('scripts/big.txt', 'a'.repeat(1024 * 1024 + 1))])) },
  { name: 'a tool command of 4,001 characters', code: 'BUNDLE_INVALID', next: 'Ask for a file that loads, or fix the files named.', make: dir => write(dir, 'long-command.json', withTools([stdio({ command: 'x'.repeat(4001) })])) },
  { name: 'a tool with 65 arguments', code: 'BUNDLE_INVALID', next: 'Ask for a file that loads, or fix the files named.', make: dir => write(dir, 'many-args.json', withTools([stdio({ args: Array.from({ length: 65 }, (_, i) => `a${i}`) })])) },
  { name: 'an environment value of 4,001 characters', code: 'BUNDLE_INVALID', next: 'Ask for a file that loads, or fix the files named.', make: dir => write(dir, 'long-env.json', withTools([stdio({ env: { NODE_OPTIONS: `--require ${'x'.repeat(4001)}` } })])) },
  { name: 'a value written into a tool', code: 'BUNDLE_SECRET_FOUND', next: 'Do not use this file. Ask for one with no secret value.', make: dir => write(dir, 'secret.json', withTools([stdio({ env: { GITHUB_TOKEN: FAKE_TOKEN } })])) },
  { name: 'two names that are one once case and spelling are folded', code: 'BUNDLE_PATH_UNSAFE', next: 'Do not use this file. Ask for a new one.', make: dir => write(dir, 'clash.json', envelope([harnessJson({ scripts: 'scripts/' }), record('scripts/strasse.md', 'one\n'), record('scripts/straße.md', 'two\n')])) },
];

/** A made-up computer with a folder that holds an empty harness, and the folder's files. */
function target(): { home: ReturnType<typeof newMadeUpHome>; dir: string; before: Record<string, string>; shape: string[]; scratch: string } {
  const home = newMadeUpHome();
  const dir = join(home.projects, 'empty-place');
  mkdirSync(join(dir, '.bowerloom'), { recursive: true });
  writeFileSync(join(dir, '.bowerloom', 'harness.json'), json({ format: 'bowerloom/harness/v1beta1', id: 'empty-place', description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {} }));
  const scratch = join(home.home, 'Downloads');
  mkdirSync(scratch, { recursive: true });
  return { home, dir, before: readTree(dir), shape: treeShape(dir), scratch };
}
/** Opens the Import sheet and chooses a file. */
async function chooseFile(app: RealHarness, file: string): Promise<Locator> {
  const s = importSheet(app.page);
  await app.page.getByRole('button', { name: 'Import from a file', exact: true }).click();
  await expect(s).toBeVisible();
  await app.pick(file);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  return s;
}

test('every hostile file is refused in words on the Import sheet, writes nothing, and leaves the harness loading', async () => {
  test.setTimeout(300_000);
  const { home, dir, before, shape, scratch } = target();
  h = await startApp(home, 'harnesses');
  const projectsBefore = readTree(home.projects), projectsShape = treeShape(home.projects);
  for (const c of CASES) {
    await test.step(`${c.name}: ${c.code}`, async () => {
      const file = c.make(scratch);
      const s = await chooseFile(h!, file);
      const refusal = s.locator('[data-refusal]');
      await expect(refusal).toHaveAttribute('data-refusal', c.code);
      const words = (await refusal.innerText()).replace(/\s+/g, ' ');
      expect(words, 'the refusal is in words').toMatch(/Nothing (was )?(read or )?written/);
      expect(words).not.toContain(home.home);
      expect(words).not.toContain(scratch);
      expect(words).not.toContain(FAKE_TOKEN);
      expect(words, 'the refusal does not repeat the long text').not.toContain('xxxxxxxxxx');
      await expect(s.locator('[data-next-step]')).toHaveText(c.next);
      await expect(s.locator('[data-file-status]')).toHaveText('Choose a file to go on.');
      await expect(s.locator('[data-bundle]'), 'no file is held').toHaveCount(0);
      // Next stays closed: no file, no folder step.
      await s.locator('[data-import-next]').click({ force: true });
      await expect(s.locator('[data-folder-status]')).toHaveCount(0);
      expect(readTree(dir), 'the folder is as it was').toEqual(before);
      expect(readTree(home.projects), 'nothing was written in the projects').toEqual(projectsBefore);
      expect(treeShape(dir), 'no folder or mode changed in the folder').toEqual(shape);
      expect(treeShape(home.projects), 'no folder or mode changed in the projects').toEqual(projectsShape);
      expect(loadDefinition(join(dir, '.bowerloom')).ok, 'the harness still loads').toBe(true);
      await s.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(s).toBeHidden();
    });
  }
  await test.step('after all of them the app still reads a good file and opens the folder in the Builder', async () => {
    const good = write(scratch, 'good.json', withTools([stdio({ args: ['tally-server.js'] })]));
    const s = await chooseFile(h!, good);
    await expect(s.locator('[data-file-status]')).toHaveText('Read good.json. 3 files, 1 tool.');
    await s.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openInBuilder(h!, dir, 'empty-place');
    expect(readTree(dir)).toEqual(before);
  });
});

test('a tool environment that starts code is not refused as a file: nothing is written until both boxes are ticked, the call without the tick is refused in words, and with both ticks the files land', async () => {
  test.setTimeout(240_000);
  const { home, dir, before, shape, scratch } = target();
  h = await startApp(home, 'harnesses');
  const p = h.page;
  const bundleText = withTools([stdio({ args: ['tally-server.js'], env: { NODE_OPTIONS: '--require ./preload.js' } })]);
  const file = write(scratch, 'node-options.json', bundleText);
  const s = await chooseFile(h, file);
  await expect(s.locator('[data-file-status]')).toHaveText('Read node-options.json. 3 files, 1 tool.');
  await expect(s.locator('[data-tool="tally-feed"]')).toContainText('Starts a program');
  // The name and the value of the variable must show whole. The sheet does not draw them yet; this goes red when it does, so it can become a plain check.
  const missing: string[] = [];
  for (const text of ['NODE_OPTIONS', '--require ./preload.js']) {
    try { await expect(s.locator('[data-tool="tally-feed"]')).toContainText(text, { timeout: 1500 }); } catch { missing.push(text); }
  }
  expect(missing, 'the texts the sheet does not show yet').toEqual(['NODE_OPTIONS', '--require ./preload.js']);
  const bundleId = (await s.locator('[data-bundle]').getAttribute('data-bundle'))!;
  await s.locator('[data-import-next]').click();
  await h.pick(dir);
  await s.locator('[data-choose-folder]').click();
  const card = s.locator('[data-folder]').filter({ hasText: 'empty-place' });
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const folderId = (await card.getAttribute('data-folder'))!;
  await s.locator('[data-import-plan]').click();
  const review = s.locator('[data-import-review]');
  await expect(review).toBeVisible();
  const go = s.locator('[data-import-write]');
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await go.click({ force: true });
  await expect(review.locator('[data-acknowledge-import] input')).toBeFocused();
  await expect(review.locator('[data-acknowledge-import] input')).not.toBeChecked();
  expect(readTree(dir), 'a press without the ticks writes nothing').toEqual(before);
  expect(treeShape(dir)).toEqual(shape);
  expect(await h.asked(), 'main asks nothing').toHaveLength(0);
  // The call itself, made without the tick, is refused in words.
  const refused = await p.evaluate(async ([folder, bundle]) => {
    const bridge = (window as unknown as { bowerloomEngine: Record<string, (...x: unknown[]) => Promise<any>> }).bowerloomEngine;
    const choices = { link: {}, leave: [] };
    const plan = await bridge.planImport!(folder, bundle, choices);
    const r = await bridge.runImport!(folder, plan.value.revision, bundle, choices, null);
    return r.ok ? null : r.refusal as { code: string; message: string };
  }, [folderId, bundleId] as const);
  expect(refused!.code).toBe('IMPORT_NEEDS_ACKNOWLEDGEMENT');
  expect(refused!.message).toContain('Tick that you read them, then import. Nothing was written.');
  expect(readTree(dir)).toEqual(before);
  expect(treeShape(dir)).toEqual(shape);
  expect(await h.asked()).toHaveLength(0);
  expect(loadDefinition(join(dir, '.bowerloom')).ok).toBe(true);
  // With both boxes ticked the import goes through: the file is data, and the person has read it.
  await review.locator('[data-acknowledge-import] input').check();
  await review.locator('[data-approve-plan] input').check();
  await expect(go).not.toHaveAttribute('aria-disabled', 'true');
  await go.click();
  await expect(s.locator('[data-done]')).toBeVisible();
  const landed = readTree(join(dir, '.bowerloom'));
  expect(Object.keys(landed).sort()).toEqual(['harness.json', 'instructions/AGENTS.md', 'mcp.json']);
  expect(landed['mcp.json']).toContain('--require ./preload.js');
  expect(loadDefinition(join(dir, '.bowerloom')).ok, 'the harness loads').toBe(true);
  expect(await h.asked()).toHaveLength(1);
});

test('an export asked to save inside the harness folder is refused in words, writes nothing, and the harness still loads', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome();
  const folder = join(home.projects, 'rope-ledger');
  mkdirSync(join(folder, '.bowerloom', 'instructions'), { recursive: true });
  writeFileSync(join(folder, '.bowerloom', 'harness.json'), json({ format: 'bowerloom/harness/v1beta1', id: 'rope-ledger', description: 'Checks the rope orders.', engines: [{ id: 'claude-code' }], parts: { 'system-prompt': 'instructions/AGENTS.md' } }));
  writeFileSync(join(folder, '.bowerloom', 'instructions', 'AGENTS.md'), '# Rope ledger\n\nCount the coils before you report.\n');
  const before = readTree(folder), shape = treeShape(folder);
  h = await startApp(home, 'harnesses');
  await stubSaveDialog(h);
  const p = h.page;
  await openInBuilder(h, folder, 'rope-ledger');
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const s = exportSheet(p);
  await expect(s.locator('[data-export-file]')).toHaveAttribute('data-export-file', 'rope-ledger.bowerloom.json');
  for (const inside of [join(folder, '.bowerloom', 'rope-ledger.bowerloom.json'), join(folder, '.bowerloom', 'instructions', 'rope-ledger.bowerloom.json')]) {
    await saveAt(h, inside);
    await s.locator('[data-export-write]').click();
    const refusal = s.locator('[data-refusal]');
    await expect(refusal).toHaveAttribute('data-refusal', 'EXPORT_TARGET_IN_HARNESS');
    const words = (await refusal.innerText()).replace(/\s+/g, ' ');
    expect(words).not.toContain(home.home);
    await expect(s.locator('[data-next-step]')).toHaveText('Choose the place to save again, outside the harness folder.');
    expect(existsSync(inside), 'no file was written').toBe(false);
    expect(readTree(folder), 'the folder is as it was').toEqual(before);
    expect(treeShape(folder), 'no folder or mode changed').toEqual(shape);
    expect(await h.asked(), 'main asked nothing').toHaveLength(0);
  }
  expect(loadDefinition(join(folder, '.bowerloom')).ok, 'the harness still loads').toBe(true);
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'rope-ledger' })).toBeVisible();
  // A place outside the harness still works afterwards.
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  const outside = join(home.home, 'Desktop');
  mkdirSync(outside, { recursive: true });
  await saveAt(h, join(outside, 'rope-ledger.bowerloom.json'));
  await s.locator('[data-export-write]').click();
  await expect(s.locator('[data-exported-file]')).toHaveAttribute('data-exported-file', 'rope-ledger.bowerloom.json');
  expect(readTree(folder)).toEqual(before);
});
