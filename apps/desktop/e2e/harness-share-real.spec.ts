/**
 * Export and import in the real app (journey 4, main process): Electron started with no flag, once per made-up computer (its own HOME, state folder and data folder). The first
 * app exports a made-up harness through main's save dialog and main's own question; the second app opens the file through main's open dialog and imports it into a folder with
 * no harness and into a folder with an empty one. The calls are made from the page through the preload bridge (`bowerloomEngine`), the way the sheets make them, and every expected
 * value is read from the files by this test. The sheets themselves are the work of the journey 4 spec. The system dialogs cannot be driven from a test, so main's dialogs are stubbed
 * (e2e/harness-real-page.ts): the open dialog answers the path set by `pick`, and the save dialog the path set below.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

let h: RealHarness | null = null;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); h = null; });

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
function put(dir: string, rel: string, text: string, mode?: number): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  if (mode !== undefined) chmodSync(join(dir, rel), mode);
}
function computer(prefix: string): string {
  const home = realpathSync(tempDir(prefix));
  chmodSync(home, 0o700);
  return home;
}
/** A made-up harness with a skill, a script that can run, an agent, and a remote tool that sends a value read from the computer in a header. */
function harnessFolder(home: string, name: string): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: name, description: 'Checks the rope orders.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/', mcp: 'mcp.json', scripts: 'scripts/' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Rope yard\n\nCount the coils before you report.\n');
  put(dir, '.bowerloom/skills/check-orders/SKILL.md', '---\nname: check-orders\ndescription: Checks each order against the stock.\n---\n\nCheck every order.\n');
  put(dir, '.bowerloom/agents/clerk.md', '---\nname: clerk\ndescription: Handles the orders.\nskills:\n  - check-orders\n---\n\nHandle the orders.\n');
  put(dir, '.bowerloom/mcp.json', json({ servers: [{ name: 'orders-api', transport: 'http', url: 'https://orders.example.test/mcp', headers: { 'X-Key': '${ORDERS_KEY}' } }] }));
  put(dir, '.bowerloom/scripts/tally.sh', '#!/bin/sh\necho 12\n', 0o755);
  return dir;
}
function readTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(r); else out[r] = readFileSync(join(root, r), 'utf8');
    }
  };
  if (existsSync(root)) walk('');
  return out;
}

async function start(home: string): Promise<RealHarness> {
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  // Main's save dialog: the test sets the path it answers (null closes it).
  await h.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __save: string | null };
    g.__save = null;
    dialog.showSaveDialog = (async () => (g.__save === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: g.__save })) as unknown as typeof dialog.showSaveDialog;
  });
  return h;
}
const savePath = (app: RealHarness, path: string | null): Promise<void> => app.app.evaluate((_e, p) => { (globalThis as unknown as { __save: string | null }).__save = p; }, path);

/** One call of the engine bridge, made from the page. A call refused before it ran comes back as { threw: code }. */
async function call<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(async ([n, a]) => {
    const bridge = (window as unknown as { bowerloomEngine: Record<string, (...x: unknown[]) => Promise<unknown>> }).bowerloomEngine;
    try { return await bridge[n as string]!(...(a as unknown[])); } catch (error) { return { threw: String((error as Error).message) }; }
  }, [name, args] as const) as Promise<T>;
}
type Ok<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; message: string; paths: string[] } };
async function ok<T = Record<string, any>>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  const r = await call<Ok<T>>(page, name, ...args);
  if (!('ok' in r) || !r.ok) throw new Error(`${name} did not succeed: ${JSON.stringify(r)}`);
  return r.value;
}
const NO_CHOICES = { link: {}, leave: [] };

test('export a made-up harness in one app and import it in another: into a folder with no harness, and into a folder with an empty one', async () => {
  test.setTimeout(240_000);
  // ---- computer A: export
  const homeA = computer('bowerloom-share-a-');
  const source = harnessFolder(homeA, 'rope-yard');
  const sourceFiles = readTree(join(source, '.bowerloom'));
  const outDir = join(homeA, 'Desktop');
  mkdirSync(outDir);
  const fileA = join(outDir, 'rope-yard.bowerloom.json');
  const a = await start(homeA);
  await a.pick(source);
  const folder = (await ok<{ id: string }>(a.page, 'chooseFolder'));
  const plan = await ok<{ file: string; revision: string; acknowledge: string | null; summary: any }>(a.page, 'planExport', folder.id);
  expect(plan.file).toBe('rope-yard.bowerloom.json');
  expect(plan.summary.counts.skills).toBe(1);
  expect(plan.summary.secrets.rows.map((s: { name: string }) => s.name)).toEqual(['ORDERS_KEY']);
  expect(JSON.stringify(plan)).not.toContain(homeA);
  expect(existsSync(fileA)).toBe(false);
  // A closed save dialog writes nothing and asks nothing.
  expect(((await call(a.page, 'runExport', folder.id, plan.revision, plan.acknowledge)) as { refusal: { code: string } }).refusal.code).toBe('CANCELLED');
  expect(await a.asked()).toHaveLength(0);
  await savePath(a, fileA);
  const written = await ok<{ name: string; bytes: number }>(a.page, 'runExport', folder.id, plan.revision, plan.acknowledge);
  expect(written.name).toBe('rope-yard.bowerloom.json');
  expect(JSON.stringify(written)).not.toContain(homeA);
  const asked = await a.asked();
  expect(asked).toHaveLength(1);
  expect(asked[0]!.message).toContain('rope-yard.bowerloom.json');
  const bytes = readFileSync(fileA);
  expect(written.bytes).toBe(bytes.length);
  const envelope = JSON.parse(bytes.toString('utf8')) as { format: string; files: { path: string }[] };
  expect(envelope.format).toBe('bowerloom/harness-bundle/v1beta1');
  expect(envelope.files.map(f => f.path)).toEqual(Object.keys(sourceFiles).sort());
  expect(bytes.toString('utf8')).not.toContain(homeA);
  expect(bytes.toString('utf8')).not.toContain('ORDERS_KEY_VALUE');
  expect(readTree(join(source, '.bowerloom'))).toEqual(sourceFiles);
  await a.app.close().catch(() => undefined);
  h = null;

  // ---- computer B: import
  const homeB = computer('bowerloom-share-b-');
  const none = join(homeB, 'Projects', 'new-place');
  mkdirSync(none, { recursive: true });
  put(none, 'README.md', '# New place\n');
  const emptyDir = join(homeB, 'Projects', 'empty-place');
  put(emptyDir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: 'empty-place', description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {} }));
  const b = await start(homeB);
  const p = b.page;
  await b.pick(fileA);
  const bundle = await ok<{ bundleId: string; name: string; summary: any }>(p, 'chooseBundle');
  expect(bundle.name).toBe('rope-yard.bowerloom.json');
  expect(JSON.stringify(bundle)).not.toContain(homeB);
  expect(bundle.summary.counts.files).toBe(Object.keys(sourceFiles).length);

  // 1. A folder with no harness: one plan makes the empty harness and writes every file.
  await b.pick(none);
  const f1 = await ok<{ id: string; label: string; hasDefinition: boolean }>(p, 'chooseFolder');
  expect(f1.hasDefinition).toBe(false);
  const before = readTree(none);
  const plan1 = await ok<{ revision: string; acknowledge: string | null; makesHarness?: boolean; changes: { path: string; action: string }[] }>(p, 'planImport', f1.id, bundle.bundleId, NO_CHOICES);
  expect(plan1.makesHarness).toBe(true);
  expect(readTree(none)).toEqual(before);
  expect(plan1.changes.map(c => c.path).sort()).toEqual(Object.keys(sourceFiles).map(k => `.bowerloom/${k}`).sort());
  expect(plan1.changes.every(c => c.action === 'create')).toBe(true);
  expect(plan1.acknowledge).toMatch(/^[a-f0-9]{64}$/);
  const missing = await call<{ refusal: { code: string } }>(p, 'runImport', f1.id, plan1.revision, bundle.bundleId, NO_CHOICES, null);
  expect(missing.refusal.code).toBe('IMPORT_NEEDS_ACKNOWLEDGEMENT');
  const askedBefore = (await b.asked()).length;
  const done1 = await ok<{ written: string[]; version: string }>(p, 'runImport', f1.id, plan1.revision, bundle.bundleId, NO_CHOICES, plan1.acknowledge);
  expect(done1.written).toHaveLength(Object.keys(sourceFiles).length);
  expect((await b.asked()).length).toBe(askedBefore + 1);
  expect(readTree(join(none, '.bowerloom'))).toEqual(sourceFiles);
  expect(loadDefinition(join(none, '.bowerloom')).ok).toBe(true);
  expect(readdirSync(none).sort()).toEqual(['.bowerloom', 'README.md']);
  // The script keeps its execute bit, and nothing was installed.
  expect(Number((await import('node:fs')).statSync(join(none, '.bowerloom', 'scripts', 'tally.sh')).mode & 0o111)).toBe(0o111);
  // Go back returns the empty harness.
  const versions = await ok<{ id: string; label: string; files: number }[]>(p, 'listVersions', f1.id);
  expect(versions.map(v => v.label)).toEqual([`Imported ${Object.keys(sourceFiles).length} files`, 'As it was before the first save']);
  const first = versions[1]!;
  const back = await ok<{ revision: string }>(p, 'planRestore', f1.id, first.id);
  await ok(p, 'runRestore', f1.id, back.revision, first.id);
  expect(readdirSync(join(none, '.bowerloom'))).toEqual(['harness.json']);
  expect(loadDefinition(join(none, '.bowerloom')).ok).toBe(true);

  // 2. A folder with an empty harness: harness.json is an update.
  await b.pick(emptyDir);
  const f2 = await ok<{ id: string; holdsParts: boolean }>(p, 'chooseFolder');
  expect(f2.holdsParts).toBe(false);
  await b.pick(fileA);
  const again = await ok<{ bundleId: string }>(p, 'chooseBundle');
  const plan2 = await ok<{ revision: string; acknowledge: string | null; makesHarness?: boolean; changes: { path: string; action: string }[] }>(p, 'planImport', f2.id, again.bundleId, NO_CHOICES);
  expect(plan2.makesHarness).toBe(false);
  expect(plan2.changes.find(c => c.path === '.bowerloom/harness.json')!.action).toBe('update');
  await ok(p, 'runImport', f2.id, plan2.revision, again.bundleId, NO_CHOICES, plan2.acknowledge);
  expect(readTree(join(emptyDir, '.bowerloom'))).toEqual(sourceFiles);
  // The folder holds parts now: a second import is refused, and folders() says so.
  const refusedAgain = await call<{ refusal: { code: string } }>(p, 'planImport', f2.id, again.bundleId, NO_CHOICES);
  expect(refusedAgain.refusal.code).toBe('IMPORT_FOLDER_HAS_HARNESS');
  const listed = await call<{ id: string; holdsParts?: boolean }[]>(p, 'folders');
  expect(listed.find(f => f.id === f2.id)!.holdsParts).toBe(true);
});

test('a hostile file is refused in words, writes nothing, and a folder the window did not accept is never registered', async () => {
  test.setTimeout(180_000);
  const home = computer('bowerloom-share-hostile-');
  const target = join(home, 'Projects', 'target');
  mkdirSync(target, { recursive: true });
  const real = join(home, 'real.json');
  writeFileSync(real, 'this is a note, not a bundle\n');
  symlinkSync(real, join(home, 'link.json'));
  const traversal = join(home, 'traversal.json');
  writeFileSync(traversal, json({ format: 'bowerloom/harness-bundle/v1beta1', harness: 'x', generator: 'x', revision: `sha256:${'0'.repeat(64)}`, files: [{ path: '../outside.md', size: 1, sha256: '0'.repeat(64), encoding: 'utf8', data: 'x' }], knowledge: [] }));
  const app = await start(home);
  const p = app.page;
  for (const [file, code] of [[real, 'BUNDLE_FORMAT'], [join(home, 'link.json'), 'BUNDLE_FILE_UNSAFE'], [traversal, 'BUNDLE_PATH_UNSAFE']] as const) {
    await app.pick(file);
    const r = await call<{ refusal: { code: string; message: string } }>(p, 'chooseBundle');
    expect(r.refusal.code).toBe(code);
    expect(r.refusal.message).not.toContain(home);
  }
  // Nothing was held and nothing was written.
  await app.pick(target);
  const f = await ok<{ id: string }>(p, 'chooseFolder');
  expect(((await call(p, 'planImport', f.id, 'bundle-1', NO_CHOICES)) as { threw: string }).threw).toContain('UNKNOWN_BUNDLE');
  expect(readdirSync(target)).toEqual([]);
  // A folder with another label than the one the window wants is refused before main registers it.
  const other = join(home, 'Projects', 'other');
  mkdirSync(other);
  await app.pick(other);
  const wrong = await call<{ refusal: { code: string } }>(p, 'chooseFolder', '~/Projects/target');
  expect(wrong.refusal.code).toBe('NOT_THE_FOLDER_SHOWN');
  const folders = await call<{ label: string }[]>(p, 'folders');
  expect(folders.map(x => x.label)).toEqual(['~/Projects/target']);
  const right = await ok<{ label: string }>(p, 'chooseFolder', '~/Projects/other');
  expect(right.label).toBe('~/Projects/other');
});
