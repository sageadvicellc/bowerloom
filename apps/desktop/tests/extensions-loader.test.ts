// The loader reads manifests that sit inside the bundle root, and nothing from outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundledManifest, loadBundledManifests } from '../main/extension-loader.js';
import { tempDir } from './support.js';

const manifest = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ id, title: id, kind: 'ui', routes: [`${id}-route`], protected: false, ...extra });
function put(root: string, name: string, text: string): void { mkdirSync(join(root, 'extensions', name), { recursive: true }); writeFileSync(join(root, 'extensions', name, 'manifest.json'), text); }

test('loads a valid bundled manifest and lists nothing skipped', t => {
  const root = tempDir(t);
  put(root, 'alpha', manifest('alpha')); put(root, 'beta', manifest('beta', { protected: true }));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['alpha', 'beta']);
  assert.equal(result.manifests[1]?.protected, true);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(loadBundledManifest(root, 'alpha'), { ok: true, value: result.manifests[0] });
});

test('loads nothing when the bundle root has no extensions folder, or none at all', t => {
  const root = tempDir(t);
  assert.deepEqual(loadBundledManifests(root), { manifests: [], skipped: [] });
  mkdirSync(join(root, 'extensions'));
  assert.deepEqual(loadBundledManifests(root), { manifests: [], skipped: [] });
  assert.deepEqual(loadBundledManifests(join(root, 'missing')), { manifests: [], skipped: [] });
  assert.deepEqual(loadBundledManifests(''), { manifests: [], skipped: [] });
});

test('a folder with no manifest.json is skipped and reported', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions', 'empty'), { recursive: true });
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['empty', 'UNREADABLE']]);
});

test('refuses a name with .. , a path separator or an absolute path, and reads nothing', t => {
  const root = tempDir(t), outside = tempDir(t);
  put(outside, 'evil', manifest('evil'));
  mkdirSync(join(root, 'extensions'));
  put(root, 'good', manifest('good'));
  const names = ['..', '../good', 'good/..', '../../' + outside, 'a/b', 'a\\b', join(outside, 'extensions', 'evil'), '/etc', '', '.', 'good/', 'a\0b'];
  for (const name of names) {
    const answer = loadBundledManifest(root, name);
    assert.equal(answer.ok, false, JSON.stringify(name));
    if (!answer.ok) assert.equal(answer.refusal.code, 'BAD_NAME', JSON.stringify(name));
  }
  for (const bad of [undefined, null, 4, {}]) assert.equal(loadBundledManifest(root, bad as unknown as string).ok, false);
});

test('refuses a symlinked folder that points outside the bundle root, and a symlinked manifest.json that points outside', t => {
  const root = tempDir(t), outside = tempDir(t);
  put(outside, 'real', manifest('real'));
  mkdirSync(join(root, 'extensions'));
  symlinkSync(join(outside, 'extensions', 'real'), join(root, 'extensions', 'linked-folder'));
  mkdirSync(join(root, 'extensions', 'linked-file'));
  symlinkSync(join(outside, 'extensions', 'real', 'manifest.json'), join(root, 'extensions', 'linked-file', 'manifest.json'));
  put(root, 'fine', manifest('fine'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['fine'], 'only the real one loads');
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]).sort(), [['linked-file', 'OUTSIDE_ROOT'], ['linked-folder', 'OUTSIDE_ROOT']]);
  for (const name of ['linked-folder', 'linked-file']) {
    const answer = loadBundledManifest(root, name);
    assert.equal(answer.ok, false, name);
    if (!answer.ok) assert.equal(answer.refusal.code, 'OUTSIDE_ROOT', name);
  }
});

test('refuses an extensions folder that is itself a link to the outside', t => {
  const root = tempDir(t), outside = tempDir(t);
  put(outside, 'real', manifest('real'));
  symlinkSync(join(outside, 'extensions'), join(root, 'extensions'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.code, 'OUTSIDE_ROOT');
});

test('a link that stays inside the bundle root is allowed', t => {
  const root = tempDir(t);
  put(root, 'real', manifest('real'));
  symlinkSync(join(root, 'extensions', 'real'), join(root, 'extensions', 'alias'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id).sort(), ['real', 'real']);
  assert.deepEqual(result.skipped, []);
});

test('skips a manifest that is not valid JSON or fails the manifest check, reports it, and still loads the others', t => {
  const root = tempDir(t);
  put(root, 'a-good', manifest('a-good'));
  put(root, 'b-broken', '{ not json');
  put(root, 'c-empty', '');
  put(root, 'd-no-routes', manifest('d-no-routes', { routes: [] }));
  put(root, 'e-wrong-kind', manifest('e-wrong-kind', { kind: 'mod' }));
  put(root, 'f-array', '[]');
  put(root, 'g-null', 'null');
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['a-good']);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['b-broken', 'NOT_JSON'], ['c-empty', 'NOT_JSON'], ['d-no-routes', 'BAD_MANIFEST'], ['e-wrong-kind', 'BAD_MANIFEST'], ['f-array', 'BAD_MANIFEST'], ['g-null', 'BAD_MANIFEST']]);
  for (const s of result.skipped) assert.ok(s.message.length > 0, s.name);
});

test('a manifest file that is far too large is skipped without being parsed', t => {
  const root = tempDir(t);
  put(root, 'huge', manifest('huge', { title: 'x'.repeat(200_000) }));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.equal(result.skipped[0]?.code, 'TOO_LARGE');
});

test('a loose file in the extensions folder is skipped and reported, not loaded', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions'));
  writeFileSync(join(root, 'extensions', 'stray.json'), manifest('stray'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.equal(result.skipped[0]?.name, 'stray.json');
});
