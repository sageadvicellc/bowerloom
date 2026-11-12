// The extension kit (tools/extension-kit.mjs) is plain JavaScript and cannot import the TypeScript of the app. So it holds its own copy of the manifest rules and the loader rules.
// This test holds the copy equal to the real thing, so a rule cannot change on one side alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE_ROUTES, DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { checkManifest } from '../shared/extensions/manifest.js';
import { SKIP_CODES, loadBundledManifests } from '../main/extension-loader.js';
import { startExtensions } from '../main/extension-host.js';
import { DESKTOP, tempDir } from './support.js';

interface Kit {
  readonly DEFAULT_IDS: readonly string[]; readonly BASE_ROUTES: readonly string[]; readonly RESERVED_NAMES: ReadonlySet<string>; readonly LOADER_CODES: readonly string[]; readonly KINDS: readonly string[];
  readonly MANIFEST_MAX_BYTES: number;
  checkManifestValue(value: unknown): { ok: true; value: unknown } | { ok: false; code: string; message: string };
  readExtension(dir: string, name: string): { name: string; manifest?: unknown; code?: string; message?: string };
  checkTree(root: string): { extensions: { id: string }[]; problems: { name: string; code: string }[] };
}
const loadKit = async (): Promise<Kit> => (await import(pathToFileURL(join(DESKTOP, '..', '..', 'tools', 'lib', 'extension-kit.mjs')).href)) as Kit;

const GOOD = { id: 'alpha', title: 'Alpha', kind: 'ui', routes: ['alpha'], protected: false };
const VALUES: readonly unknown[] = [
  GOOD, { ...GOOD, protected: true }, { ...GOOD, extra: 1, main: 'x.js' }, { ...GOOD, routes: ['a', 'b', 'c'] }, { ...GOOD, id: '0' }, { ...GOOD, id: 'a'.repeat(64) },
  null, undefined, 0, 'x', [], {}, { ...GOOD, id: 'A' }, { ...GOOD, id: 'a_b' }, { ...GOOD, id: '-a' }, { ...GOOD, id: 'a'.repeat(65) }, { ...GOOD, id: 7 }, { ...GOOD, title: '' }, { ...GOOD, title: '   ' },
  { ...GOOD, title: 'x'.repeat(120) }, { ...GOOD, title: 'x'.repeat(121) }, { ...GOOD, title: 4 }, { ...GOOD, kind: 'script' }, { ...GOOD, kind: 4 }, { ...GOOD, routes: [] }, { ...GOOD, routes: 'a' },
  { ...GOOD, routes: [1] }, { ...GOOD, routes: ['A'] }, { ...GOOD, routes: ['a', 'a'] }, { ...GOOD, routes: Array.from({ length: 64 }, (_, i) => `r${i}`) }, { ...GOOD, routes: Array.from({ length: 65 }, (_, i) => `r${i}`) },
  { ...GOOD, protected: 'yes' }, { ...GOOD, protected: undefined }, { id: 'a', title: 'a', kind: 'ui', routes: ['a'] }, JSON.parse('{"__proto__": {"x": 1}, "id": "a", "title": "a", "kind": "ui", "routes": ["a"], "protected": false}'),
];

test('the kit holds the same default ids, base routes and reserved names as the app', async () => {
  const kit = await loadKit();
  assert.deepEqual([...kit.DEFAULT_IDS], [...DEFAULT_IDS]);
  assert.deepEqual([...kit.BASE_ROUTES], [...BASE_ROUTES]);
  assert.deepEqual([...kit.RESERVED_NAMES].sort(), [...new Set<string>([...DEFAULT_IDS, ...BASE_ROUTES])].sort());
  assert.deepEqual([...kit.KINDS], ['ui']);
});

test('the kit gives the same loader codes as the loader, and the same size limit', async () => {
  const kit = await loadKit();
  assert.deepEqual([...kit.LOADER_CODES], [...SKIP_CODES]);
  const loader = await import('../main/extension-loader.js');
  assert.equal(kit.MANIFEST_MAX_BYTES, loader.MANIFEST_MAX_BYTES);
});

test('the kit and the app judge each manifest value the same way: same answer, same sentence, same copy', async () => {
  const kit = await loadKit();
  assert.ok(VALUES.length >= 30);
  for (const value of VALUES) {
    const mine = kit.checkManifestValue(value), real = checkManifest(value);
    assert.equal(mine.ok, real.ok, JSON.stringify(value)?.slice(0, 80));
    if (!mine.ok && !real.ok) { assert.equal(mine.code, real.refusal.code); assert.equal(mine.message, real.refusal.message); }
    if (mine.ok && real.ok) assert.deepEqual(JSON.parse(JSON.stringify(mine.value)), JSON.parse(JSON.stringify(real.value)));
  }
});

const FOLDERS: Readonly<Record<string, string>> = {
  'a-ok': JSON.stringify({ ...GOOD, id: 'a-ok', routes: ['a-ok'] }),
  'b-not-json': '{ nope',
  'c-array': '[]',
  'd-bom': `\ufeff${JSON.stringify({ ...GOOD, id: 'd-bom', routes: ['d-bom'] })}`,
  'e-big': JSON.stringify({ ...GOOD, id: 'e-big', title: 'x'.repeat(70 * 1024) }),
  'f-reserved-id': JSON.stringify({ ...GOOD, id: 'overview' }),
  'g-reserved-route': JSON.stringify({ ...GOOD, id: 'g-reserved-route', routes: ['library'] }),
  'h-protected': JSON.stringify({ ...GOOD, id: 'h-protected', routes: ['h-protected'], protected: true }),
  'i-twin': JSON.stringify({ ...GOOD, id: 'a-ok', routes: ['i-twin'] }),
  'j-route-taken': JSON.stringify({ ...GOOD, id: 'j-route-taken', routes: ['a-ok'] }),
  'k-bad-kind': JSON.stringify({ ...GOOD, id: 'k-bad-kind', kind: 'script' }),
};

function makeFolders(t: Parameters<typeof tempDir>[0]): { root: string; dir: string } {
  const root = tempDir(t), dir = join(root, 'apps', 'desktop', 'extensions');
  for (const [name, text] of Object.entries(FOLDERS)) { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'manifest.json'), text); }
  mkdirSync(join(dir, 'l-no-manifest'), { recursive: true });
  mkdirSync(join(dir, 'm-dir-manifest', 'manifest.json'), { recursive: true });
  return { root, dir };
}

test('the kit reads each folder as the loader does: the same manifest, or the same code', async t => {
  const kit = await loadKit();
  const { root, dir } = makeFolders(t);
  const loaded = loadBundledManifests(join(root, 'apps', 'desktop'));
  const skipped = new Map(loaded.skipped.map(s => [s.name, s.code]));
  const names = [...Object.keys(FOLDERS), 'l-no-manifest', 'm-dir-manifest'].sort();
  const mineOk: unknown[] = [], mineFailed = new Map<string, string>();
  for (const name of names) {
    const mine = kit.readExtension(dir, name);
    if (mine.manifest === undefined) mineFailed.set(name, mine.code ?? '?'); else mineOk.push(JSON.parse(JSON.stringify(mine.manifest)));
  }
  assert.deepEqual([...mineFailed].sort(), [...skipped].sort(), 'the same folders fail with the same code');
  assert.deepEqual(mineOk, JSON.parse(JSON.stringify(loaded.manifests)), 'the same manifests load, in the same order');
});

test('the kit judges a whole folder of extensions as the app does: the same extensions load, and each problem has the code the app gives', async t => {
  const kit = await loadKit();
  const { root } = makeFolders(t);
  const host = startExtensions(join(root, 'apps', 'desktop'));
  const mine = kit.checkTree(root);
  assert.deepEqual(mine.extensions.map(e => e.id), host.registry.list().map(m => m.id).filter(id => !(DEFAULT_IDS as readonly string[]).includes(id)));
  const real = [...host.skipped.map(s => `${s.name}:${s.code}`), ...host.refused.map(r => `${r.id}:${r.code}`)].sort();
  const projected = mine.problems.map(p => p.code).sort();
  const expected = real.map(line => line.slice(line.indexOf(':') + 1)).sort();
  assert.deepEqual(projected, expected);
});

test('a name with two dots in it is refused by the loader and by the kit alike, in a folder name and in a named load', async t => {
  const kit = await loadKit();
  const { root, dir } = makeFolders(t);
  const { loadBundledManifest } = await import('../main/extension-loader.js');
  for (const name of ['..', 'a..b', '...', 'x..']) {
    const real = loadBundledManifest(join(root, 'apps', 'desktop'), name);
    assert.equal(real.ok, false, name);
    if (!real.ok) assert.equal(kit.readExtension(dir, name).code, real.refusal.code, name);
  }
});

test('the kit is stricter than the loader about a link inside the bundle: the loader keeps a link that stays inside, the kit refuses every link', async t => {
  const kit = await loadKit();
  const { root, dir } = makeFolders(t);
  symlinkSync(join(dir, 'a-ok'), join(dir, 'n-link'));
  const loaded = loadBundledManifests(join(root, 'apps', 'desktop'));
  // The loader sees the second name for the same real folder and skips it as DUPLICATE. It does not call it outside the bundle.
  assert.equal(loaded.skipped.find(x => x.name === 'n-link')?.code, 'DUPLICATE');
  assert.equal(kit.readExtension(dir, 'n-link').code, 'OUTSIDE_ROOT');
});
