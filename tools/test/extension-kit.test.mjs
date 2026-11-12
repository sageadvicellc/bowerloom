import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KitError, KIT_CODES, KIT_WARNINGS, readExtension, readMountTable, checkManifestValue, checkNewId, checkTree, installTemplate, listTree, mountLines, mountedIds, removeExtension, scaffold, TEMPLATE_ID } from '../lib/extension-kit.mjs';

const script = fileURLToPath(new URL('../extension-kit.mjs', import.meta.url));
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extension-kit-test-'))); made.push(dir); return dir; };

const manifestText = (id, extra = {}) => JSON.stringify({ id, title: id, kind: 'ui', routes: [id], protected: false, ...extra });
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const putExt = (root, name, text) => put(root, `apps/desktop/extensions/${name}/manifest.json`, text);

const SCREEN = "export function ExtensionTemplate(): string { return 'extension-template'; }\nexport const view = (<Screen slot=\"extension-template\" title={\"Extension template\"} />);\n";
const MOUNTS = "const BUNDLED_MOUNTS = Object.freeze({\n  'local-models': () => 1,\n  'extension-template': () => 2,\n});\n";

/** A tree with the template, its screen and a mount table, and the one extension folder that ships today. */
function tree() {
  const root = tmp();
  put(root, 'apps/desktop/extension-template/manifest.json', manifestText(TEMPLATE_ID, { title: 'Extension template' }));
  put(root, 'apps/desktop/renderer/harness/extensions/ExtensionTemplate.tsx', SCREEN);
  put(root, 'apps/desktop/renderer/harness/extension-mounts.tsx', MOUNTS);
  putExt(root, 'local-models', manifestText('local-models'));
  return root;
}
const refusal = fn => { try { fn(); } catch (error) { assert.ok(error instanceof KitError, String(error)); return error.code; } assert.fail('expected a refusal'); };
const codes = result => result.problems.map(p => `${p.name}:${p.code}`);

test('checkManifestValue takes a good manifest and refuses each bad one with BAD_MANIFEST', () => {
  assert.equal(checkManifestValue(JSON.parse(manifestText('alpha'))).ok, true);
  const bad = [null, 7, 'x', [], {}, JSON.parse(manifestText('Alpha')), JSON.parse(manifestText('a_b')), JSON.parse(manifestText('')), JSON.parse(manifestText('-a')),
    JSON.parse(manifestText('a', { title: '' })), JSON.parse(manifestText('a', { title: 'x'.repeat(121) })), JSON.parse(manifestText('a', { kind: 'script' })), JSON.parse(manifestText('a', { routes: [] })),
    JSON.parse(manifestText('a', { routes: 'a' })), JSON.parse(manifestText('a', { routes: ['A'] })), JSON.parse(manifestText('a', { routes: ['a', 'a'] })), JSON.parse(manifestText('a', { protected: 'no' })),
    JSON.parse(manifestText('a', { routes: Array.from({ length: 65 }, (_, i) => `r${i}`) }))];
  for (const value of bad) { const answer = checkManifestValue(value); assert.equal(answer.ok, false, JSON.stringify(value)); assert.equal(answer.code, 'BAD_MANIFEST'); }
});

test('checkManifestValue drops a field that is not one of the five, so no field can name a code file', () => {
  const answer = checkManifestValue(JSON.parse(manifestText('alpha', { main: 'evil.js', entry: './x.js' })));
  assert.equal(answer.ok, true);
  assert.deepEqual(Object.keys(answer.value).sort(), ['id', 'kind', 'protected', 'routes', 'title']);
});

test('checkNewId refuses a bad name with BAD_ID and a default name with RESERVED', () => {
  for (const id of ['', 'A', 'a b', '-a', 'a/b', '1abc', '9-lives', undefined, 7]) assert.equal(refusal(() => checkNewId(id)), 'BAD_ID', String(id));
  for (const id of ['overview', 'help', 'first-run', 'interfaces-history-help']) assert.equal(refusal(() => checkNewId(id)), 'RESERVED', id);
  checkNewId('my-extension');
});

test('mountedIds reads the keys of the mount table and nothing else', () => {
  const root = tree();
  assert.deepEqual([...mountedIds(root)].sort(), ['extension-template', 'local-models']);
  assert.equal(mountedIds(tmp()), null);
});

test('scaffold writes the manifest and the screen from the template, and says which two lines to add', () => {
  const root = tree();
  const result = scaffold(root, { id: 'weekly-notes', title: 'Weekly notes' });
  assert.deepEqual(result.created, ['apps/desktop/extensions/weekly-notes/manifest.json', 'apps/desktop/renderer/harness/extensions/WeeklyNotes.tsx']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, result.created[0]), 'utf8'));
  assert.deepEqual(manifest, { id: 'weekly-notes', title: 'Weekly notes', kind: 'ui', routes: ['weekly-notes'], protected: false });
  const screen = fs.readFileSync(path.join(root, result.created[1]), 'utf8');
  assert.match(screen, /WeeklyNotes/); assert.match(screen, /'weekly-notes'/); assert.match(screen, /title=\{"Weekly notes"\}/);
  assert.doesNotMatch(screen, /ExtensionTemplate|extension-template|Extension template/);
  assert.deepEqual(result.next, mountLines('weekly-notes', 'WeeklyNotes'));
  assert.match(result.next.tableLine, /'weekly-notes': \(\{ route \}\) => \(route\.name === 'extension' && route\.route === 'weekly-notes' \? <WeeklyNotes \/> : stray\(route\)\),/);
  assert.equal(fs.readFileSync(path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx'), 'utf8'), MOUNTS, 'no source file is edited');
});

test('scaffold takes a title from the id when none is given', () => {
  const root = tree();
  scaffold(root, { id: 'weekly-notes' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/extensions/weekly-notes/manifest.json'), 'utf8')).title, 'Weekly notes');
});

test('scaffold refuses a bad id, a default name, a folder that is there, a taken route, and a bad title, and writes nothing', () => {
  const root = tree();
  const before = fs.readdirSync(path.join(root, 'apps/desktop/extensions')).length;
  assert.equal(refusal(() => scaffold(root, { id: 'Bad Id' })), 'BAD_ID');
  assert.equal(refusal(() => scaffold(root, { id: 'help' })), 'RESERVED');
  assert.equal(refusal(() => scaffold(root, { id: 'local-models' })), 'EXTENSION_EXISTS');
  putExt(root, 'other', manifestText('other', { routes: ['other', 'shared-route'] }));
  assert.equal(refusal(() => scaffold(root, { id: 'shared-route' })), 'ROUTE_TAKEN');
  assert.equal(refusal(() => scaffold(root, { id: 'fine-id', title: '' })), 'BAD_MANIFEST');
  assert.equal(fs.readdirSync(path.join(root, 'apps/desktop/extensions')).length, before + 1, 'only the folder this test added');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/renderer/harness/extensions/FineId.tsx')), false);
});

test('scaffold refuses to write over a screen file, and leaves no manifest folder behind', () => {
  const root = tree();
  put(root, 'apps/desktop/renderer/harness/extensions/WeeklyNotes.tsx', 'mine');
  assert.equal(refusal(() => scaffold(root, { id: 'weekly-notes' })), 'EXTENSION_EXISTS');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/weekly-notes')), false);
  assert.equal(fs.readFileSync(path.join(root, 'apps/desktop/renderer/harness/extensions/WeeklyNotes.tsx'), 'utf8'), 'mine');
});

test('every command refuses a folder that is not the repository with NOT_A_TREE', () => {
  const root = tmp();
  for (const fn of [() => checkTree(root), () => scaffold(root, { id: 'a' }), () => installTemplate(root), () => removeExtension(root, 'a'), () => listTree(root), () => checkTree('relative/path')]) assert.equal(refusal(fn), 'NOT_A_TREE');
});

test('checkTree passes the shipped extension, and reports NO_SCREEN for a valid manifest with no screen in the mount table', () => {
  const root = tree();
  assert.deepEqual(checkTree(root), { extensions: [{ name: 'local-models', id: 'local-models', title: 'local-models', routes: ['local-models'] }], problems: [], warnings: [] });
  scaffold(root, { id: 'weekly-notes' });
  assert.deepEqual(codes(checkTree(root)), ['weekly-notes:NO_SCREEN']);
  fs.writeFileSync(path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx'), MOUNTS.replace("  'extension-template'", "  'weekly-notes': () => 3,\n  'extension-template'"));
  assert.deepEqual(codes(checkTree(root)), []);
});

test('checkTree refuses a bad file with the code the app gives it', () => {
  const root = tree();
  putExt(root, 'a-not-json', '{ nope');
  putExt(root, 'b-array', '[]');
  putExt(root, 'c-kind', manifestText('c-kind', { kind: 'script' }));
  putExt(root, 'd-upper', manifestText('D'));
  putExt(root, 'e-reserved-id', manifestText('overview'));
  putExt(root, 'f-reserved-route', manifestText('f-reserved-route', { routes: ['help'] }));
  putExt(root, 'g-protected', manifestText('g-protected', { protected: true }));
  putExt(root, 'h-big', manifestText('h-big', { title: 'x'.repeat(70 * 1024) }));
  putExt(root, 'z-twin', manifestText('local-models', { routes: ['twin-route'] }));
  putExt(root, 'z-route-taken', manifestText('z-route-taken', { routes: ['local-models'] }));
  fs.mkdirSync(path.join(root, 'apps/desktop/extensions/k-empty'));
  fs.mkdirSync(path.join(root, 'apps/desktop/extensions/l-dir-manifest/manifest.json'), { recursive: true });
  assert.deepEqual(codes(checkTree(root)), ['a-not-json:NOT_JSON', 'b-array:BAD_MANIFEST', 'c-kind:BAD_MANIFEST', 'd-upper:BAD_MANIFEST', 'e-reserved-id:RESERVED', 'f-reserved-route:RESERVED', 'g-protected:RESERVED',
    'h-big:TOO_LARGE', 'k-empty:UNREADABLE', 'l-dir-manifest:NOT_A_FILE', 'z-route-taken:ROUTE_TAKEN', 'z-twin:EXTENSION_EXISTS']);
  const only = checkTree(root, 'a-not-json');
  assert.deepEqual(codes(only), ['a-not-json:NOT_JSON']);
  assert.equal(refusal(() => checkTree(root, 'nothing-here')), 'NOT_INSTALLED');
});

test('a message about invalid JSON shows the position and never the text of the file', () => {
  const root = tree();
  putExt(root, 'secret-text', '{ "id": "my private words" nope }');
  const [problem] = checkTree(root).problems;
  assert.equal(problem.code, 'NOT_JSON');
  assert.doesNotMatch(problem.message, /private|words/);
});

test('a link in the extensions folder is refused, and never followed', () => {
  const root = tree();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'manifest.json'), manifestText('outside'));
  fs.symlinkSync(outside, path.join(root, 'apps/desktop/extensions/linked'));
  fs.mkdirSync(path.join(root, 'apps/desktop/extensions/file-link'));
  fs.symlinkSync(path.join(outside, 'manifest.json'), path.join(root, 'apps/desktop/extensions/file-link/manifest.json'));
  assert.deepEqual(codes(checkTree(root)), ['file-link:OUTSIDE_ROOT', 'linked:OUTSIDE_ROOT']);
  assert.equal(refusal(() => removeExtension(root, 'linked')), 'UNSAFE_PATH');
  assert.equal(fs.existsSync(path.join(outside, 'manifest.json')), true, 'the file outside is untouched');
});

test('the template installs and removes, and a removed extension is not in the tree any more', () => {
  const root = tree();
  const installed = installTemplate(root);
  assert.deepEqual(installed, { id: TEMPLATE_ID, created: ['apps/desktop/extensions/extension-template/manifest.json'] });
  assert.deepEqual(checkTree(root).extensions.map(e => e.id), ['extension-template', 'local-models']);
  assert.equal(refusal(() => installTemplate(root)), 'EXTENSION_EXISTS');
  const gone = removeExtension(root, TEMPLATE_ID);
  assert.deepEqual([gone.name, gone.removed], [TEMPLATE_ID, ['apps/desktop/extensions/extension-template']]);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/extension-template')), false);
  assert.deepEqual(checkTree(root).extensions.map(e => e.id), ['local-models']);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extension-template/manifest.json')), true, 'the template itself stays');
  assert.equal(refusal(() => removeExtension(root, TEMPLATE_ID)), 'NOT_INSTALLED');
});

test('installTemplate refuses a template whose manifest is damaged', () => {
  const root = tree();
  put(root, 'apps/desktop/extension-template/manifest.json', manifestText(TEMPLATE_ID, { kind: 'script' }));
  assert.equal(refusal(() => installTemplate(root)), 'BAD_MANIFEST');
  put(root, 'apps/desktop/extension-template/manifest.json', manifestText('another-id'));
  assert.equal(refusal(() => installTemplate(root)), 'BAD_MANIFEST');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/extension-template')), false);
});

test('removeExtension refuses a bad name, a folder with a sub-folder in it, and deletes nothing in that case', () => {
  const root = tree();
  for (const name of ['', '..', '.', 'a/b', '/abs', 'a\\b']) assert.equal(refusal(() => removeExtension(root, name)), 'BAD_ID', name);
  fs.mkdirSync(path.join(root, 'apps/desktop/extensions/local-models/sub'));
  assert.equal(refusal(() => removeExtension(root, 'local-models')), 'UNSAFE_PATH');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/local-models/manifest.json')), true);
});

test('the kit codes are short upper-case names, and each is used by the tool', () => {
  for (const code of KIT_CODES) assert.match(code, /^[A-Z_]+$/);
  assert.equal(new Set(KIT_CODES).size, KIT_CODES.length);
});


test('scaffold refuses a title that could break out of the screen text, and writes nothing', () => {
  const root = tree();
  const hostile = ['x" ref={() => 1} y="', 'a{b', 'a}b', 'a<b', 'a>b', 'a`b', 'a\\b', 'a\nb', 'a\u0007b', 'a\u2028b'];
  for (const title of hostile) assert.equal(refusal(() => scaffold(root, { id: 'safe-one', title })), 'BAD_TITLE', JSON.stringify(title));
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/safe-one')), false);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/renderer/harness/extensions/SafeOne.tsx')), false);
});

test('scaffold writes a plain title as one JSON string literal, so an apostrophe or an ampersand stays text', () => {
  const root = tree();
  const made = scaffold(root, { id: 'safe-two', title: "Bob's notes & more" });
  const screen = fs.readFileSync(path.join(root, made.created[1]), 'utf8');
  assert.match(screen, /title=\{"Bob's notes & more"\}/);
});

test('scaffold refuses an id whose component name would not start with a letter', () => {
  const root = tree();
  assert.equal(refusal(() => scaffold(root, { id: '1st-notes' })), 'BAD_ID');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/1st-notes')), false);
});

test('check fails with NO_MOUNT_TABLE when the mount table cannot be read, and never skips NO_SCREEN', () => {
  const root = tree();
  scaffold(root, { id: 'weekly-notes' });
  const file = path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx');
  fs.rmSync(file);
  assert.equal(refusal(() => checkTree(root)), 'NO_MOUNT_TABLE');
  assert.equal(refusal(() => listTree(root)), 'NO_MOUNT_TABLE');
  fs.writeFileSync(file, MOUNTS.replace('BUNDLED_MOUNTS', 'RENAMED_TABLE'));
  assert.equal(refusal(() => checkTree(root)), 'NO_MOUNT_TABLE');
});

test('a name with two dots in it is refused as the loader refuses it', () => {
  const root = tree();
  putExt(root, 'a..b', manifestText('a-b'));
  assert.equal(readExtension(path.join(root, 'apps/desktop/extensions'), 'a..b').code, 'BAD_NAME');
  assert.equal(refusal(() => removeExtension(root, 'a..b')), 'BAD_ID');
  assert.deepEqual(codes(checkTree(root)), ['a..b:BAD_NAME']);
});

test('check reports ROUTE_MISMATCH when the routes do not include the id, because the mount draws only route equal to id', () => {
  const root = tree();
  putExt(root, 'odd', manifestText('odd', { routes: ['other-route'] }));
  fs.writeFileSync(path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx'), MOUNTS.replace("  'extension-template'", "  'odd': () => 3,\n  'extension-template'"));
  assert.deepEqual(codes(checkTree(root)), ['odd:ROUTE_MISMATCH']);
});

test('check lists a manifest field that the app drops as a warning, and the warning is not a problem', () => {
  const root = tree();
  putExt(root, 'local-models', manifestText('local-models', { main: 'evil.js', entry: 'x' }));
  const result = checkTree(root);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings.map(w => [w.name, w.code, w.fields]), [['local-models', 'FIELD_DROPPED', ['entry', 'main']]]);
  assert.ok(KIT_WARNINGS.includes('FIELD_DROPPED'));
  assert.deepEqual(checkTree(tree()).warnings, []);
});

test('remove needs a manifest.json in the folder, and a folder without one is not touched', () => {
  const root = tree();
  fs.mkdirSync(path.join(root, 'apps/desktop/extensions/not-one'));
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/not-one/notes.txt'), 'mine');
  assert.equal(refusal(() => removeExtension(root, 'not-one')), 'NOT_INSTALLED');
  assert.equal(fs.readFileSync(path.join(root, 'apps/desktop/extensions/not-one/notes.txt'), 'utf8'), 'mine');
});

test('remove renames the folder first, deletes the manifest last, leaves no temporary folder, and says the screen and the mount line stay', () => {
  const root = tree();
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/local-models/notes.txt'), 'x');
  const order = [];
  const result = removeExtension(root, 'local-models', { unlink: file => { order.push(path.basename(file)); fs.unlinkSync(file); } });
  assert.deepEqual(order, ['notes.txt', 'manifest.json']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'apps/desktop/extensions')), []);
  assert.match(result.note, /screen file/); assert.match(result.note, /mount table/);
});

test('remove that fails part way gives REMOVE_INCOMPLETE and lists what remains', () => {
  const root = tree();
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/local-models/a-notes.txt'), 'x');
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/local-models/b-notes.txt'), 'x');
  let error;
  try { removeExtension(root, 'local-models', { unlink: file => { if (path.basename(file) === 'b-notes.txt') throw Object.assign(new Error('no'), { code: 'EACCES' }); fs.unlinkSync(file); } }); } catch (e) { error = e; }
  assert.ok(error instanceof KitError); assert.equal(error.code, 'REMOVE_INCOMPLETE');
  assert.match(error.message, /b-notes\.txt/); assert.match(error.message, /manifest\.json/); assert.doesNotMatch(error.message, /a-notes\.txt/);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/local-models')), false, 'the original name is free');
  const left = fs.readdirSync(path.join(root, 'apps/desktop/extensions'));
  assert.equal(left.length, 1); assert.match(left[0], /^\.removing-/);
});

test('the rollback of new unlinks only the files it wrote, and no recursive delete runs', () => {
  const root = tree();
  const folder = path.join(root, 'apps/desktop/extensions/weekly-notes');
  const writes = [];
  const ops = { write: (file, text) => { writes.push(file); if (writes.length === 2) { fs.writeFileSync(path.join(folder, 'mine.txt'), 'keep'); throw new Error('disk full'); } fs.writeFileSync(file, text, { flag: 'wx' }); } };
  assert.throws(() => scaffold(root, { id: 'weekly-notes' }, ops), /disk full/);
  assert.equal(fs.existsSync(path.join(folder, 'manifest.json')), false, 'the file it wrote is gone');
  assert.equal(fs.readFileSync(path.join(folder, 'mine.txt'), 'utf8'), 'keep', 'a file it did not write stays');
  const source = fs.readFileSync(fileURLToPath(new URL('../lib/extension-kit.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /recursive:\s*true,\s*force/);
});

test('a link as the extensions folder or the screens folder is refused with UNSAFE_PATH', () => {
  const root = tree();
  const outside = tmp();
  fs.rmSync(path.join(root, 'apps/desktop/renderer/harness/extensions'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'apps/desktop/renderer/harness/extensions'));
  assert.equal(refusal(() => scaffold(root, { id: 'weekly-notes' })), 'UNSAFE_PATH');
  assert.deepEqual(fs.readdirSync(outside), []);
  const root2 = tree();
  const outside2 = tmp();
  fs.rmSync(path.join(root2, 'apps/desktop/extensions'), { recursive: true });
  fs.symlinkSync(outside2, path.join(root2, 'apps/desktop/extensions'));
  for (const fn of [() => checkTree(root2), () => listTree(root2), () => installTemplate(root2), () => removeExtension(root2, 'x')]) assert.equal(refusal(fn), 'UNSAFE_PATH');
});

test('install-template refuses when the template has no screen in the mount table, or the table cannot be read', () => {
  const root = tree();
  const file = path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx');
  fs.writeFileSync(file, MOUNTS.replace("  'extension-template': () => 2,\n", ''));
  assert.equal(refusal(() => installTemplate(root)), 'NO_SCREEN');
  fs.rmSync(file);
  assert.equal(refusal(() => installTemplate(root)), 'NO_MOUNT_TABLE');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/extension-template')), false);
});


const REMOVING = '.removing-aabbccddeeff';

test('check and list report a leftover .removing folder as REMOVE_INCOMPLETE, never as an extension, and name the remedy', () => {
  const root = tree();
  putExt(root, REMOVING, manifestText('left-over'));
  putExt(root, '.hidden', manifestText('hidden-one'));
  for (const result of [checkTree(root), listTree(root)]) {
    assert.deepEqual(result.extensions.map(e => e.id), ['local-models']);
    assert.deepEqual(codes(result), ['.hidden:BAD_NAME', `${REMOVING}:REMOVE_INCOMPLETE`]);
    const message = result.problems.find(p => p.name === REMOVING).message;
    assert.match(message, /remove \.removing-aabbccddeeff/); assert.match(message, /by hand/); assert.match(message, /skips/);
  }
  assert.equal(readExtension(path.join(root, 'apps/desktop/extensions'), '.hidden').code, 'BAD_NAME');
});

test('remove accepts a .removing folder, so a second run finishes a removal that stopped', () => {
  const root = tree();
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/local-models/b-notes.txt'), 'x');
  const failing = { unlink: file => { if (path.basename(file) === 'b-notes.txt') throw Object.assign(new Error('no'), { code: 'EACCES' }); fs.unlinkSync(file); } };
  let error;
  try { removeExtension(root, 'local-models', failing); } catch (e) { error = e; }
  assert.equal(error.code, 'REMOVE_INCOMPLETE');
  assert.match(error.message, /skips a folder/); assert.match(error.message, /remove \.removing-[0-9a-f]{12}/); assert.match(error.message, /by hand/);
  const [left] = fs.readdirSync(path.join(root, 'apps/desktop/extensions'));
  assert.deepEqual(codes(checkTree(root)), [`${left}:REMOVE_INCOMPLETE`]);
  const done = removeExtension(root, left);
  assert.deepEqual(done.removed, [`apps/desktop/extensions/${left}`]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'apps/desktop/extensions')), []);
  assert.equal(refusal(() => removeExtension(root, '.removing-zzzz')), 'BAD_ID', 'only the exact shape of a leftover is accepted');
  assert.equal(refusal(() => removeExtension(root, '.hidden')), 'BAD_ID');
});

test('a title with a format or invisible character is refused, as the loader treats such text', () => {
  const root = tree();
  for (const title of ['a‮b', 'a​b', 'a b', 'a⠀b', 'a﻿b', 'a឴b']) assert.equal(refusal(() => scaffold(root, { id: 'safe-three', title })), 'BAD_TITLE', JSON.stringify(title));
});

test('scaffold refuses a template that does not hold exactly one title literal', () => {
  const root = tree();
  const file = path.join(root, 'apps/desktop/renderer/harness/extensions/ExtensionTemplate.tsx');
  fs.writeFileSync(file, SCREEN + 'const again = (<Screen title={"Extension template"} />);\n');
  assert.equal(refusal(() => scaffold(root, { id: 'safe-four' })), 'BAD_TEMPLATE');
  fs.writeFileSync(file, "export function ExtensionTemplate(): string { return 'extension-template'; }\n");
  assert.equal(refusal(() => scaffold(root, { id: 'safe-four' })), 'BAD_TEMPLATE');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/extensions/safe-four')), false);
});

test('NO_MOUNT_TABLE says whether the file was not found, could not be read, or held no BUNDLED_MOUNTS', () => {
  const root = tree();
  const file = path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx');
  fs.writeFileSync(file, 'const OTHER = 1;\n');
  assert.match(readMountTable(root).cause, /holds no BUNDLED_MOUNTS/);
  assert.throws(() => checkTree(root), /holds no BUNDLED_MOUNTS/);
  fs.rmSync(file);
  assert.match(readMountTable(root).cause, /was not found/);
  fs.mkdirSync(file);
  assert.match(readMountTable(root).cause, /could not be read \(EISDIR\)/);
  assert.throws(() => installTemplate(root), /could not be read \(EISDIR\)/);
});

test('remove checks the real path of the temporary folder again before each unlink, and stops when it was swapped', () => {
  const root = tree();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'manifest.json'), 'outside');
  fs.writeFileSync(path.join(root, 'apps/desktop/extensions/local-models/a-notes.txt'), 'x');
  let swapped = false;
  const ops = { unlink: file => {
    fs.unlinkSync(file);
    if (!swapped) { swapped = true; const dir = path.dirname(file); const moved = `${dir}-moved`; fs.renameSync(dir, moved); fs.symlinkSync(outside, dir); }
  } };
  assert.equal(refusal(() => removeExtension(root, 'local-models', ops)), 'UNSAFE_PATH');
  assert.equal(fs.readFileSync(path.join(outside, 'manifest.json'), 'utf8'), 'outside', 'nothing outside was deleted');
});

test('a link as apps/desktop or apps/desktop/renderer is refused with UNSAFE_PATH', () => {
  const outside = tmp();
  const root = tmp();
  fs.mkdirSync(path.join(root, 'apps'));
  fs.symlinkSync(outside, path.join(root, 'apps/desktop'));
  assert.equal(refusal(() => checkTree(root)), 'UNSAFE_PATH');
  const root2 = tree();
  fs.renameSync(path.join(root2, 'apps/desktop/renderer'), path.join(outside, 'renderer'));
  fs.symlinkSync(path.join(outside, 'renderer'), path.join(root2, 'apps/desktop/renderer'));
  for (const fn of [() => checkTree(root2), () => scaffold(root2, { id: 'safe-five' }), () => installTemplate(root2), () => removeExtension(root2, 'local-models')]) assert.equal(refusal(fn), 'UNSAFE_PATH');
});

// ---- the command line

const run = (args, { env = {}, input } = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, input, timeout: 60000 });
const SEAM = { BOWERLOOM_TOOLS_TEST_MODE: '1' };

test('--help exits 0 and lists every command and flag', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  for (const word of ['new', 'check', 'install-template', 'remove', 'list', '--title', '--json']) assert.ok(result.stdout.includes(word), word);
});

test('wrong use exits 2, and with --json prints one JSON object', () => {
  for (const args of [[], ['nope'], ['new'], ['remove'], ['check', 'a', 'b'], ['new', 'a', '--nope'], ['list', '--json=x'], ['new', 'a', '--title']]) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
  }
  const json = run(['nope', '--json']);
  assert.equal(json.status, 2);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false); assert.equal(parsed.exit, 2); assert.equal(typeof parsed.error, 'string');
});

test('--root is a test seam: without the test variable it exits 2', () => {
  const result = run(['list', '--root', tmp()]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /test seam/);
});

test('new, check, install-template, list and remove work through the command line, with JSON output', () => {
  const root = tree();
  const call = (...args) => { const r = run([...args, '--root', root, '--json'], { env: SEAM }); return { status: r.status, json: JSON.parse(r.stdout) }; };
  let r = call('new', 'weekly-notes', '--title', 'Weekly notes');
  assert.equal(r.status, 0); assert.equal(r.json.ok, true); assert.equal(r.json.command, 'new'); assert.equal(r.json.id, 'weekly-notes'); assert.equal(r.json.created.length, 2);
  assert.match(r.json.next.tableLine, /weekly-notes/);
  r = call('check');
  assert.equal(r.status, 1); assert.equal(r.json.ok, false); assert.deepEqual(r.json.problems.map(p => p.code), ['NO_SCREEN']);
  r = call('check', 'local-models');
  assert.equal(r.status, 0); assert.equal(r.json.ok, true); assert.deepEqual(r.json.extensions.map(e => e.id), ['local-models']);
  r = call('install-template');
  assert.equal(r.status, 0); assert.equal(r.json.id, TEMPLATE_ID);
  r = call('install-template');
  assert.equal(r.status, 1); assert.equal(r.json.ok, false); assert.equal(r.json.code, 'EXTENSION_EXISTS');
  r = call('list');
  assert.equal(r.status, 1); assert.equal(r.json.ok, false); assert.deepEqual(r.json.extensions.map(e => e.id), ['extension-template', 'local-models']); assert.deepEqual(r.json.problems.map(p => p.code), ['NO_SCREEN']);
  r = call('remove', TEMPLATE_ID);
  assert.equal(r.status, 0); assert.deepEqual(r.json.removed, ['apps/desktop/extensions/extension-template']); assert.match(r.json.note, /mount table/);
  r = call('remove', TEMPLATE_ID);
  assert.equal(r.status, 1); assert.equal(r.json.code, 'NOT_INSTALLED');
});

test('the text output names each refusal by its code', () => {
  const root = tree();
  const result = run(['new', 'help', '--root', root], { env: SEAM });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /RESERVED/);
});

test('the command line check exits non-zero with the code when the mount table is gone, and prints warnings in text and in JSON', () => {
  const root = tree();
  putExt(root, 'local-models', manifestText('local-models', { main: 'evil.js' }));
  let r = run(['check', '--root', root, '--json'], { env: SEAM });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).warnings.map(w => w.code), ['FIELD_DROPPED']);
  r = run(['check', '--root', root], { env: SEAM });
  assert.match(r.stdout, /WARNING local-models: FIELD_DROPPED/);
  fs.rmSync(path.join(root, 'apps/desktop/renderer/harness/extension-mounts.tsx'));
  r = run(['check', '--root', root, '--json'], { env: SEAM });
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, false); assert.equal(json.code, 'NO_MOUNT_TABLE');
});
