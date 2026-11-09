// The loader reads manifests that sit inside the bundle root, and nothing from outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_MAX_BYTES, loadBundledManifest, loadBundledManifests } from '../main/extension-loader.js';
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

test('a root that exists but has no extensions folder is a deliberate empty result, with nothing skipped', t => {
  const root = tempDir(t);
  assert.deepEqual(loadBundledManifests(root), { manifests: [], skipped: [] });
});

test('an empty extensions folder loads nothing and skips nothing', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions'));
  assert.deepEqual(loadBundledManifests(root), { manifests: [], skipped: [] });
});

test('a bundle root the loader could not look at is reported as UNREADABLE, never as a silent empty result', t => {
  const root = tempDir(t);
  for (const bad of [join(root, 'missing'), '', 'relative/path', '.', undefined, null, 7] as unknown[]) {
    const result = loadBundledManifests(bad as string);
    assert.deepEqual(result.manifests, [], String(bad));
    assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['extensions', 'UNREADABLE']], String(bad));
    assert.ok(result.skipped[0]!.message.length > 0);
  }
  assert.match(loadBundledManifests(join(root, 'missing')).skipped[0]!.message, /ENOENT/, 'the error code stays in the message');
});

test('both loaders require an absolute bundle root', t => {
  const root = tempDir(t);
  put(root, 'alpha', manifest('alpha'));
  for (const bad of ['', 'relative', '.', '../x']) {
    const answer = loadBundledManifest(bad, 'alpha');
    assert.equal(answer.ok, false, bad);
    if (!answer.ok) assert.equal(answer.refusal.code, 'UNREADABLE', bad);
  }
  assert.equal(loadBundledManifest(root, 'alpha').ok, true);
});

test('an extensions entry that is a file is reported as UNREADABLE', t => {
  const root = tempDir(t);
  writeFileSync(join(root, 'extensions'), 'not a folder');
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['extensions', 'UNREADABLE']]);
});

test('an extensions entry that is a dangling link is reported as UNREADABLE', t => {
  const root = tempDir(t);
  symlinkSync(join(root, 'nowhere'), join(root, 'extensions'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['extensions', 'UNREADABLE']]);
});

test('an extensions folder that cannot be read is reported as UNREADABLE with the error code in the message', t => {
  if (process.getuid?.() === 0) return t.skip('root can read any folder');
  const root = tempDir(t);
  put(root, 'alpha', manifest('alpha'));
  chmodSync(join(root, 'extensions'), 0o000);
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['extensions', 'UNREADABLE']]);
  assert.match(result.skipped[0]!.message, /EACCES/);
});

test('a folder with no manifest.json is skipped and reported', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions', 'empty'), { recursive: true });
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['empty', 'UNREADABLE']]);
  assert.match(result.skipped[0]!.message, /ENOENT/, 'the error code stays in the message');
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

test('a link that stays inside the bundle root is allowed, but the same folder is loaded once: the second alias is a DUPLICATE', t => {
  const root = tempDir(t);
  put(root, 'real', manifest('real'));
  symlinkSync(join(root, 'extensions', 'real'), join(root, 'extensions', 'alias'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['real']);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['real', 'DUPLICATE']]);
  assert.equal(loadBundledManifest(root, 'alias').ok, true, 'one alias on its own still loads');
});

test('a link that stays inside the bundle root and points to a folder with a different name is loaded', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'store'));
  mkdirSync(join(root, 'store', 'inner'));
  writeFileSync(join(root, 'store', 'inner', 'manifest.json'), manifest('inner'));
  mkdirSync(join(root, 'extensions'));
  symlinkSync(join(root, 'store', 'inner'), join(root, 'extensions', 'linked'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['inner']);
  assert.deepEqual(result.skipped, []);
});

test('a manifest.json that is a link to another file name inside the root is refused', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions', 'sneaky'), { recursive: true });
  writeFileSync(join(root, 'extensions', 'sneaky', 'other.json'), manifest('sneaky'));
  symlinkSync(join(root, 'extensions', 'sneaky', 'other.json'), join(root, 'extensions', 'sneaky', 'manifest.json'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['sneaky', 'BAD_NAME']]);
});

test('a manifest.json that is a folder is NOT_A_FILE', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions', 'dir', 'manifest.json'), { recursive: true });
  const result = loadBundledManifests(root);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['dir', 'NOT_A_FILE']]);
});

test('a folder name with control or bidi characters is cleaned and cut to 64 characters in the skip report', t => {
  const root = tempDir(t);
  const names = ['evil\u202Ename\u0007\n', 'x'.repeat(200)];
  for (const name of names) mkdirSync(join(root, 'extensions', name), { recursive: true });
  const result = loadBundledManifests(root);
  assert.equal(result.skipped.length, 2);
  for (const s of result.skipped) {
    assert.doesNotMatch(s.name, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/, 'name');
    assert.doesNotMatch(s.message, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/, 'message');
    assert.ok([...s.name].length <= 65, `${s.name.length}`);
  }
  assert.ok(result.skipped.some(s => s.name.startsWith('x'.repeat(64)) && !s.name.includes('x'.repeat(65))));
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

test('a manifest that is exactly at the size limit is read, and one byte over is TOO_LARGE', t => {
  const root = tempDir(t);
  const base = manifest('edge', { title: '' }).length;
  const pad = (n: number): string => manifest('edge', { title: 'x'.repeat(n) }) + ' '.repeat(Math.max(0, MANIFEST_MAX_BYTES - (base + n)));
  const fit = pad(10);
  assert.equal(fit.length, MANIFEST_MAX_BYTES);
  put(root, 'fit', fit);
  put(root, 'over', fit + ' ');
  const result = loadBundledManifests(root);
  assert.deepEqual(result.manifests.map(m => m.id), ['edge']);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['over', 'TOO_LARGE']]);
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
  assert.equal(result.skipped[0]?.code, 'UNREADABLE');
});

test('a manifest.json that is a FIFO is refused as NOT_A_FILE without being opened, so the loader does not block', { timeout: 10_000 }, t => {
  if (process.platform === 'win32') return t.skip('no mkfifo on Windows');
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions', 'pipe'), { recursive: true });
  execFileSync('mkfifo', [join(root, 'extensions', 'pipe', 'manifest.json')]);
  const started = Date.now();
  const result = loadBundledManifests(root);
  assert.ok(Date.now() - started < 5_000, 'it returned at once');
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['pipe', 'NOT_A_FILE']]);
  const answer = loadBundledManifest(root, 'pipe');
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.refusal.code, 'NOT_A_FILE');
});

test('the NOT_JSON message carries a clean, short part of the parse error', t => {
  const root = tempDir(t);
  put(root, 'a-short', '{ not json');
  put(root, 'b-long', '{' + 'q'.repeat(2000));
  put(root, 'c-odd', '{ "id": "x\u202E\u0007" ' + 'z'.repeat(50) + '}x\u202E');
  const result = loadBundledManifests(root);
  assert.deepEqual(result.skipped.map(s => s.code), ['NOT_JSON', 'NOT_JSON', 'NOT_JSON']);
  assert.match(result.skipped[0]!.message, /is not valid JSON \(.*(token|JSON).*\)/i, 'the parse error is in the message');
  for (const s of result.skipped) {
    assert.ok(s.message.length < 300, `${s.name}: ${s.message.length}`);
    assert.doesNotMatch(s.message, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/, s.name);
  }
});

test('folder names with invisible characters (soft hyphen, fillers, variation selectors, tags and more) are cleaned in the skip report', t => {
  const root = tempDir(t);
  mkdirSync(join(root, 'extensions'));
  const marks = ['\u00ad', '\u034f', '\u115f', '\u1160', '\u180e', '\u2800', '\u3164', '\uffa0', '\ufe00', '\ufe0f', '\ufff9', '\ufffb', '\u{E0000}', '\u{E0041}', '\u{E007F}'];
  // The name is cleaned in the message of a refusal. No folder is made, because a file system may refuse some of these names.
  for (const [i, mark] of marks.entries()) {
    const answer = loadBundledManifest(root, `n${i}${mark}x`);
    assert.equal(answer.ok, false);
    if (answer.ok) continue;
    assert.match(answer.refusal.message, new RegExp(`"n${i}\\?x"`), JSON.stringify(answer.refusal.message));
    assert.doesNotMatch(answer.refusal.message, /[\u00ad\u034f\u115f\u1160\u180e\u2800\u3164\uffa0\ufe00-\ufe0f\ufff9-\ufffb\u{E0000}-\u{E007F}]/u, JSON.stringify(answer.refusal.message));
  }
  mkdirSync(join(root, 'extensions', 'soft\u00adhyphen'), { recursive: true });
  assert.deepEqual(loadBundledManifests(root).skipped.map(s => s.name), ['soft?hyphen'], 'and in the report of a listed folder');
});

test('the DUPLICATE message does not say the first folder loaded when that folder was skipped', t => {
  const root = tempDir(t);
  put(root, 'real', '{ not json');
  symlinkSync(join(root, 'extensions', 'real'), join(root, 'extensions', 'alias'));
  const result = loadBundledManifests(root);
  assert.deepEqual(result.skipped.map(s => [s.name, s.code]), [['alias', 'NOT_JSON'], ['real', 'DUPLICATE']]);
  assert.match(result.skipped[1]!.message, /same real folder as "alias"/);
  assert.doesNotMatch(result.skipped[1]!.message, /loaded/);
});
