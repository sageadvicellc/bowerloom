/**
 * Journey 4 (spec section 12): "Export and import". A person opens a harness in the Builder and presses Export. The sheet lists what the file holds. She saves it. On a second
 * computer (its own HOME, state folder and data folder) she presses "Import from a file", reads the review, ticks, approves, and the files are written. Go back returns the empty harness.
 *
 * Both computers are made-up (tools/made-up-home.ts), and the harness is invented. The app is driven as a person drives it: buttons and ticks. Only the native dialogs are stubbed
 * (the file opener, the save dialog, the folder chooser, main's own question). Every expected value is read from the files by this test. Nothing here installs anything.
 */
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { exportSheet, importSheet, newMadeUpHome, openInBuilder, readTree, saveAt, saveSheet, startApp, startSecondApp, stubSaveDialog, treeShape, without } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

const apps: RealHarness[] = [];
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { for (const a of apps.splice(0)) await a.app.close().catch(() => undefined); });

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
function put(dir: string, rel: string, text: string, mode?: number): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  if (mode !== undefined) chmodSync(join(dir, rel), mode);
}
/** The path another person's computer would hold. It sits in a skill, so the export asks for the tick and the import lists it. */
const ELSEWHERE = '/Users/rope-keeper/yard/orders.txt';
/** A made-up harness: a skill that names a path of the first computer, an agent, a script, a remote tool with a value in a header, and a program tool with a value in its environment. */
function ledgerFolder(projects: string): string {
  const dir = join(projects, 'rope-ledger');
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: 'rope-ledger', description: 'Checks the rope orders.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/', mcp: 'mcp.json', scripts: 'scripts/' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Rope ledger\n\nCount the coils before you report.\n');
  put(dir, '.bowerloom/skills/check-orders/SKILL.md', `---\nname: check-orders\ndescription: Checks each order against the stock.\n---\n\nRead the list at ${ELSEWHERE} first.\n`);
  put(dir, '.bowerloom/agents/clerk.md', '---\nname: clerk\ndescription: Handles the orders.\nskills:\n  - check-orders\n---\n\nHandle the orders.\n');
  put(dir, '.bowerloom/mcp.json', json({ servers: [
    { name: 'orders-api', transport: 'http', url: 'https://orders.example.test/v1/orders/mcp?shelf=nine', headers: { 'X-Key': '${ORDERS_KEY}' } },
    { name: 'tally-feed', transport: 'stdio', command: 'node', args: ['tally-server.js', '--once'], env: { TALLY_TOKEN: '${TALLY_TOKEN}' } },
  ] }));
  put(dir, '.bowerloom/scripts/tally.sh', '#!/bin/sh\necho 12\n', 0o755);
  return dir;
}
/** The text of a locator, spaces joined. */
const textOf = async (l: Locator): Promise<string> => ((await l.innerText()) ?? '').replace(/\s+/g, ' ').trim();

/** Closes the sheet's last Close button. */
const closeSheet = (sheet: Locator): Promise<void> => sheet.getByRole('button', { name: 'Close', exact: true }).last().click();

interface Exported { file: string; files: Record<string, string>; homeA: string; sourceDir: string }

/** Computer A: open the harness in the Builder, press Export, read the summary, tick, save. Returns the file and the files it must hold. */
async function exportOnA(): Promise<Exported> {
  const homeA = newMadeUpHome();
  const sourceDir = ledgerFolder(homeA.projects);
  const files = readTree(join(sourceDir, '.bowerloom'));
  const outDir = join(homeA.home, 'Desktop');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'rope-ledger.bowerloom.json');
  const a = await startApp(homeA, 'harnesses');
  apps.push(a);
  await stubSaveDialog(a);
  const p = a.page;
  await openInBuilder(a, sourceDir, 'rope-ledger');

  await test.step('4.1 press Export (the only one in the header): the sheet lists what the file holds, and nothing is written', async () => {
    await expect(p.getByRole('button', { name: /^Export/ })).toHaveCount(1);
    await p.getByRole('button', { name: 'Export', exact: true }).click();
    const s = exportSheet(p);
    await expect(s).toBeVisible();
    await expect(s.locator('[data-export-file]')).toHaveAttribute('data-export-file', 'rope-ledger.bowerloom.json');
    const line = await textOf(s.locator('[data-summary-line]'));
    expect(line).toContain('rope-ledger');
    for (const part of ['1 skill', '1 agent', '2 tools', '1 script', `${Object.keys(files).length} files`]) expect(line, `the summary line says ${part}`).toContain(part);
    // The check block counts what to read.
    const check = await textOf(s.locator('[data-check]'));
    expect(check).toContain('2 tools');
    expect(check).toContain('2 values go to tools');
    expect(check).toContain('1 file can run');
    expect(check).toContain('1 path from this computer');
    // The tools, with their program, arguments and host.
    const tally = s.locator('[data-tool="tally-feed"]');
    await expect(tally.locator('[data-command]')).toContainText('node');
    await expect(tally.locator('[data-arg]')).toHaveText(['tally-server.js', '--once']);
    await expect(tally).toContainText('Starts a program');
    const orders = s.locator('[data-tool="orders-api"]');
    await expect(orders.locator('[data-host]')).toContainText('orders.example.test');
    // The values the file reads from this computer, each with the tool and the field it goes to.
    await expect(s.locator('[data-secret]')).toHaveCount(2);
    await expect(s.locator('[data-secret="ORDERS_KEY"]')).toContainText('orders-api, in a header, to orders.example.test');
    await expect(s.locator('[data-secret="TALLY_TOKEN"]')).toContainText('tally-feed, in an environment value');
    await expect(s.locator('[data-secret="TALLY_TOKEN"]')).toContainText('It can send it anywhere.');
    await expect(s.locator('[data-section="share-secrets"]')).toContainText('The file names these values. It never holds them.');
    await expect(s.locator('[data-section="share-secrets"]')).toContainText('Bowerloom did not check that these exist.');
    // The files that can run, and the path of this computer.
    await expect(s.locator('[data-code-file="scripts/tally.sh"]')).toBeVisible();
    await expect(s.locator('[data-foreign-path]')).toHaveCount(1);
    await expect(s.locator('[data-foreign-path]')).toContainText(ELSEWHERE);
    expect(existsSync(file), 'the plan writes nothing').toBe(false);
    expect(await a.asked(), 'the plan asks nothing').toHaveLength(0);
  });

  await test.step('4.1 the file holds a path of this computer, so the button waits for the tick; a closed save dialog writes nothing', async () => {
    const s = exportSheet(p), save = s.locator('[data-export-write]');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(s.locator('[data-sheet-note], .hx-sheet-note').first()).toContainText('Tick the box to export.');
    await save.click({ force: true });
    await expect(s.locator('[data-acknowledge-paths] input')).toBeFocused();
    await s.locator('[data-acknowledge-paths] input').check();
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await saveAt(a, null);
    await save.click();
    await expect(s.locator('[data-cancelled]')).toContainText('You did not save. Nothing was written.');
    expect(existsSync(file)).toBe(false);
    expect(await a.asked(), 'a closed dialog asks nothing').toHaveLength(0);
  });

  await test.step('4.1 save: main asks its own question, the file is written, the sheet names it', async () => {
    const s = exportSheet(p);
    await saveAt(a, file);
    await s.locator('[data-export-write]').click();
    await expect(s.locator('[data-exported-file]')).toHaveAttribute('data-exported-file', 'rope-ledger.bowerloom.json');
    const bytes = readFileSync(file);
    await expect(s.locator('[data-done]')).toContainText(`rope-ledger.bowerloom.json, ${(bytes.length / 1024).toFixed(1)} KB`);
    await expect(s.locator('[data-done]')).toContainText('The file is written. Nothing else changed.');
    const asked = await a.asked();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.message).toContain('rope-ledger.bowerloom.json');
    // What the file holds, read by the test.
    const envelope = JSON.parse(bytes.toString('utf8')) as { format: string; files: { path: string }[]; knowledge: unknown[] };
    expect(envelope.format).toBe('bowerloom/harness-bundle/v1beta1');
    expect(envelope.files.map(f => f.path)).toEqual(Object.keys(files).sort());
    expect(bytes.toString('utf8')).not.toContain('knowledge.json');
    expect(bytes.toString('utf8')).not.toContain(homeA.home);
    expect(statSync(file).mode & 0o777, 'a new file for the owner only').toBe(0o600);
    expect(readTree(join(sourceDir, '.bowerloom')), 'the harness is as it was').toEqual(files);
    await closeSheet(s);
    await expect(s).toBeHidden();
  });
  await a.app.close().catch(() => undefined);
  apps.length = 0;
  return { file, files, homeA: homeA.home, sourceDir };
}

/** The journey on the second computer, from "Import from a file" to the Done step. `dir` is the folder. Returns the paths the review listed. */
async function importOnB(b: RealHarness, exported: Exported, dir: string, name: string): Promise<{ listed: Record<string, string> }> {
  const p = b.page, s = importSheet(p);
  await test.step(`4.2 press "Import from a file", choose the file: it is read once, the sheet shows what it holds, nothing is written (${name})`, async () => {
    await expect(p.getByRole('button', { name: 'Import from a file', exact: true })).toHaveCount(1);
    await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
    await expect(s).toBeVisible();
    await expect(s.locator('[data-file-status]')).toContainText('Choose a file to go on.');
    await b.pick(exported.file);
    await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
    const nFiles = Object.keys(exported.files).length;
    await expect(s.locator('[data-file-status]')).toHaveText(`Read rope-ledger.bowerloom.json. ${nFiles} files, 2 tools.`);
    await expect(s.locator('[data-bundle-name]')).toContainText('rope-ledger.bowerloom.json');
    await expect(s.locator('[data-other-person]').first()).toContainText('This file came from another person. Check what runs before you import.');
    await expect(s.locator('[data-tool]')).toHaveCount(2);
  });
  await test.step('4.2 choose the folder', async () => {
    await s.locator('[data-import-next]').click();
    await b.pick(dir);
    await s.locator('[data-choose-folder]').click();
    const card = s.locator('[data-folder]').filter({ hasText: name });
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await s.locator('[data-import-plan]').click();
    await expect(s.locator('[data-import-review]')).toBeVisible();
  });
  let listed: Record<string, string> = {};
  await test.step('4.3 read the review: every file written, the tools, the values from this computer and where they go, the files that can run, the paths from another computer', async () => {
    const r = s.locator('[data-import-review]');
    await expect(r.locator('[data-target]')).toContainText('~/Projects/');
    listed = await r.locator('[data-file]').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-file') ?? '', e.getAttribute('data-action') ?? ''])));
    expect(Object.keys(listed).sort(), 'the review lists every file of the bundle').toEqual(Object.keys(exported.files).map(k => `.bowerloom/${k}`).sort());
    await expect(r.locator('[data-tool]')).toHaveCount(2);
    await expect(r.locator('[data-tool="tally-feed"] [data-command]')).toContainText('node');
    await expect(r.locator('[data-tool="tally-feed"] [data-arg]')).toHaveText(['tally-server.js', '--once']);
    await expect(r.locator('[data-tool="orders-api"] [data-host]')).toContainText('orders.example.test');
    await expect(r.locator('[data-secret="ORDERS_KEY"]')).toContainText('orders-api, in a header, to orders.example.test');
    await expect(r.locator('[data-secret="TALLY_TOKEN"]')).toContainText('tally-feed, in an environment value');
    await expect(r.locator('[data-section="share-secrets"]')).toContainText('The file passes these values from this computer to these tools.');
    await expect(r.locator('[data-code-file="scripts/tally.sh"]')).toBeVisible();
    await expect(r.locator('[data-foreign-path]')).toContainText(ELSEWHERE);
    await expect(r.locator('[data-section="share-paths"] h3')).toContainText('Paths from another computer');
    expect(listed['.bowerloom/scripts/tally.sh']).toBe('create');
    // Nothing is written while the person reads.
    expect(existsSync(join(dir, '.bowerloom', 'skills'))).toBe(false);
  });
  await test.step('4.3 the button waits for both ticks; each tick names its folder', async () => {
    const r = s.locator('[data-import-review]'), go = s.locator('[data-import-write]');
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await expect(go).toHaveText(`Import ${Object.keys(exported.files).length} files`);
    await expect(s.locator('[data-sheet-note], .hx-sheet-note').first()).toContainText('Tick both boxes to import.');
    await go.click({ force: true });
    await expect(r.locator('[data-acknowledge-import] input')).toBeFocused();
    await r.locator('[data-acknowledge-import] input').check();
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await r.locator('[data-approve-plan] input').check();
    await expect(go).not.toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('4.3 import: main asks its own question, then every file is written', async () => {
    const before = (await b.asked()).length;
    await s.locator('[data-import-write]').click();
    await expect(s.locator('[data-done]')).toBeVisible();
    expect((await b.asked()).length).toBe(before + 1);
    const question = (await b.asked()).at(-1)!.message;
    expect(question, 'main names the folder and the count').toContain(`${Object.keys(exported.files).length} files into ~/Projects/${name}/.bowerloom`);
    expect(readTree(join(dir, '.bowerloom'))).toEqual(exported.files);
    expect(loadDefinition(join(dir, '.bowerloom')).ok, 'the harness loads').toBe(true);
    expect(statSync(join(dir, '.bowerloom', 'scripts', 'tally.sh')).mode & 0o111, 'the script keeps its run permission').toBe(0o111);
    expect(readdirSync(dir).filter(e => e !== '.bowerloom' && e !== 'README.md'), 'nothing was written outside .bowerloom').toEqual([]);
  });
  await test.step('4.4 Done says nothing is installed, names the files, and lists the values again with the tool each goes to', async () => {
    const d = s.locator('[data-done]');
    await expect(d.locator('[data-done-status]')).toHaveText('Nothing is installed. Nothing has run.');
    await expect(d.locator('[data-imported]')).toContainText(`Imported ${Object.keys(exported.files).length} files into`);
    await expect(d.locator('[data-version-kept]')).toBeVisible();
    await expect(d.locator('[data-secret]')).toHaveCount(2);
    await expect(d.locator('[data-secret="ORDERS_KEY"]')).toContainText('orders-api');
    await expect(d.locator('[data-secret="TALLY_TOKEN"]')).toContainText('tally-feed');
    // The page holds a name, never a value.
    const page = await p.evaluate(() => document.body.innerText);
    expect(page).not.toContain(exported.homeA);
    expect(page).not.toContain('/private/var');
    expect(await b.opened(), 'nothing was opened or started').toEqual([]);
    await closeSheet(s);
    await expect(s).toBeHidden();
  });
  return { listed };
}

/** Opens the folder in the Builder and goes back to the first save point. The folder must hold only the empty harness afterwards. */
async function goBack(b: RealHarness, dir: string, name: string, before: Record<string, string>): Promise<void> {
  const p = b.page;
  await test.step('4.5 Go back to "As it was before the first save": the empty harness returns', async () => {
    await p.evaluate(() => { location.hash = '#app/harnesses'; });
    await p.locator('[data-section="folders"]').getByRole('button', { name: `Open ${name} in the builder`, exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name })).toBeVisible();
    await p.getByRole('button', { name: 'Save points', exact: true }).click();
    const drawer = p.getByRole('dialog', { name: 'Save points' });
    const points = drawer.locator('[data-version]');
    await expect(points).toHaveCount(2);
    await expect(points.nth(0)).toContainText(/Imported \d+ files/);
    await expect(points.nth(1)).toContainText(/as it was before the first save/i);
    const first = (await points.nth(1).getAttribute('data-version'))!;
    await drawer.locator(`[data-version="${first}"]`).getByRole('button', { name: `Go back to ${first}`, exact: true }).click();
    const t = saveSheet(p), back = t.locator('[data-save-review="restore"]');
    await expect(back).toBeVisible();
    await back.locator('[data-approve-plan] input').check();
    await t.getByRole('button', { name: `Go back to ${first}`, exact: true }).click();
    await expect(t.locator('[data-version-kept]')).toBeVisible();
    const after = readTree(join(dir, '.bowerloom'));
    expect(Object.keys(after), 'only the empty harness is left').toEqual(['harness.json']);
    expect(loadDefinition(join(dir, '.bowerloom')).ok).toBe(true);
    expect(without(readTree(dir), '.bowerloom/'), 'the rest of the folder is as it was').toEqual(without(before, '.bowerloom/'));
  });
}

test('Journey 4: export a harness on one computer; import it on a second into a folder with no harness; read the review; approve; nothing is installed; Go back returns the empty harness', async () => {
  test.setTimeout(300_000);
  const exported = await exportOnA();
  const { home: homeB, h: b } = await startSecondApp();
  apps.push(b);
  expect(homeB.home).not.toBe(exported.homeA);
  const dir = join(homeB.projects, 'new-place');
  put(dir, 'README.md', '# New place\n');
  const before = readTree(dir);
  await importOnB(b, exported, dir, 'new-place');
  await goBack(b, dir, 'new-place', before);
});

test('Journey 4: the same file imports into a folder that holds an empty harness; harness.json is the one update', async () => {
  test.setTimeout(300_000);
  const exported = await exportOnA();
  const { home: homeB, h: b } = await startSecondApp();
  apps.push(b);
  const dir = join(homeB.projects, 'empty-place');
  const empty = json({ format: 'bowerloom/harness/v1beta1', id: 'empty-place', description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {} });
  put(dir, '.bowerloom/harness.json', empty);
  const { listed } = await importOnB(b, exported, dir, 'empty-place');
  expect(listed['.bowerloom/harness.json']).toBe('update');
  expect(Object.entries(listed).filter(([, action]) => action === 'create')).toHaveLength(Object.keys(exported.files).length - 1);
});

test('Journey 4: a folder whose harness has parts is refused, and the refusal names them; nothing is written', async () => {
  test.setTimeout(300_000);
  const exported = await exportOnA();
  const { home: homeB, h: b } = await startSecondApp();
  apps.push(b);
  const p = b.page, dir = ledgerFolder(homeB.projects);
  const before = readTree(dir), shape = treeShape(dir);
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  const s = importSheet(p);
  await b.pick(exported.file);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await expect(s.locator('[data-file-status]')).toContainText('Read rope-ledger.bowerloom.json.');
  await s.locator('[data-import-next]').click();
  await b.pick(dir);
  await s.locator('[data-choose-folder]').click();
  const card = s.locator('[data-folder]').filter({ hasText: 'rope-ledger' });
  await expect(card, 'the folder is shown, marked as refused').toHaveAttribute('data-off', '');
  await expect(card).toContainText('Has a harness. Choose an empty folder.');
  await expect(card).not.toHaveAttribute('aria-pressed', 'true');
  await card.click({ force: true });
  await expect(card, 'a press does not pick it').not.toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-folder-status]')).toHaveText('Pick a folder to go on.');
  await s.locator('[data-import-plan]').click({ force: true });
  await expect(s.locator('[data-import-review]'), 'Next does not plan').toHaveCount(0);
  // The refusal itself, with the parts it names, from the call the sheet makes. The sheet does not draw these parts yet (a card says only "Has a harness"), so the bridge is the one
  // place that checks them; add a check of the sheet once it names them.
  await b.pick(exported.file);
  const refusal = await p.evaluate(async () => {
    const bridge = (window as unknown as { bowerloomEngine: Record<string, (...x: unknown[]) => Promise<any>> }).bowerloomEngine;
    const folders = (await bridge.folders!()) as { id: string; name: string }[];
    const bundle = (await bridge.chooseBundle!()) as { ok: boolean; value: { bundleId: string } };
    const folder = folders.find(f => f.name === 'rope-ledger')!;
    const r = await bridge.planImport!(folder.id, bundle.value.bundleId, { link: {}, leave: [] });
    return r.ok ? null : r.refusal as { code: string; message: string; paths: string[] };
  });
  expect(refusal!.code).toBe('IMPORT_FOLDER_HAS_HARNESS');
  expect(refusal!.message).toContain('has a harness with parts or settings');
  expect(refusal!.paths, 'the refusal names the parts, in words').toEqual(['skills', 'agents', 'tools', 'instructions', 'scripts', 'a description you wrote']);
  expect(readTree(dir), 'nothing was written').toEqual(before);
  expect(treeShape(dir), 'no folder or mode changed').toEqual(shape);
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(s).toBeHidden();
});

test('Journey 4 (gap, lane D): the review does not yet show a tool environment value, a header value and the URL path; this test goes red when it does, so it can be turned into the real check', async () => {
  test.setTimeout(300_000);
  const exported = await exportOnA();
  const { h: b } = await startSecondApp();
  apps.push(b);
  const p = b.page, s = importSheet(p);
  // The setup is plain: a fault here fails the test.
  await p.getByRole('button', { name: 'Import from a file', exact: true }).click();
  await b.pick(exported.file);
  await s.getByRole('button', { name: 'Choose a file', exact: true }).click();
  await expect(s.locator('[data-file-status]')).toContainText('Read rope-ledger.bowerloom.json.');
  await expect(s.locator('[data-tool]')).toHaveCount(2);
  // Only these five reads are the gap.
  const wanted: [string, string][] = [['tally-feed', 'TALLY_TOKEN'], ['tally-feed', '${TALLY_TOKEN}'], ['orders-api', 'X-Key'], ['orders-api', '${ORDERS_KEY}'], ['orders-api', '/v1/orders/mcp?shelf=nine']];
  const missing: string[] = [];
  for (const [tool, text] of wanted) {
    try { await expect(s.locator(`[data-tool="${tool}"]`)).toContainText(text, { timeout: 1500 }); } catch { missing.push(text); }
  }
  // Today none of the five is drawn. When the sheet draws them this fails: change the expectation to an empty list.
  expect(missing, 'the texts the review does not show yet').toEqual([]);
});
