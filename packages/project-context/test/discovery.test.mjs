import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discoverProject, checkProjectPath, projectId, privateStateRoot } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
/** A fresh real folder with a HOME inside it. Nothing here touches the real HOME. */
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-project-context-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  return { base, home };
}
const mk = (dir, mode = 0o700) => { fs.mkdirSync(dir, { recursive: true, mode }); return dir; };

test('discovery finds the nearest parent folder with a real .bowerloom and pins its identities', t => {
  const { home } = world(t);
  const outer = mk(path.join(home, 'work')), inner = mk(path.join(outer, 'app')), deep = mk(path.join(inner, 'src', 'lib'));
  mk(path.join(outer, '.bowerloom')); mk(path.join(inner, '.bowerloom'));
  const found = discoverProject(deep, home);
  assert.equal(found.dir, inner);
  assert.match(found.projectId, /^[a-f0-9]{32}$/);
  assert.equal(found.projectId, projectId(found.dir, found.identity));
  assert.equal(found.identity.uid, process.getuid());
  assert.equal(found.bowerloomIdentity.uid, process.getuid());
  assert.notEqual(found.bowerloomIdentity.inode, found.identity.inode);
  assert.equal(found.ancestry[0].path, '/');
  assert.equal(found.ancestry.at(-1).path, outer);
  const parts = path.dirname(inner).split(path.sep).filter(Boolean), prefixes = ['/', ...parts.map((_, i) => path.sep + parts.slice(0, i + 1).join(path.sep))];
  assert.deepEqual(found.ancestry.map(a => a.path), prefixes);
  assert.deepEqual(Object.keys(found), ['dir', 'identity', 'ancestry', 'bowerloomIdentity', 'projectId']);
  assert.equal(discoverProject(inner, home).dir, inner);
});

test('discovery resolves a symlinked working folder to the real project path', t => {
  const { base, home } = world(t);
  const project = mk(path.join(home, 'app')); mk(path.join(project, '.bowerloom')); fs.symlinkSync(project, path.join(base, 'link'));
  assert.equal(discoverProject(path.join(base, 'link'), home).dir, project);
});

test('discovery refuses a relative working folder as usage and a missing project as PROJECT_NOT_FOUND', t => {
  const { home } = world(t); const empty = mk(path.join(home, 'empty'));
  assert.throws(() => discoverProject('relative/path', home), code('USAGE'));
  assert.throws(() => discoverProject(empty, home), code('PROJECT_NOT_FOUND'));
  assert.throws(() => discoverProject(path.join(home, 'absent'), home), code('PROJECT_NOT_FOUND'));
});

test('discovery refuses a symlinked, group-writable, world-writable, foreign-owned, plain-file or case-alias .bowerloom', t => {
  const { home } = world(t);
  const symlinked = mk(path.join(home, 'symlinked')); mk(path.join(home, 'elsewhere')); fs.symlinkSync(path.join(home, 'elsewhere'), path.join(symlinked, '.bowerloom'));
  assert.throws(() => discoverProject(symlinked, home), code('PROJECT_UNSAFE'));
  for (const [name, mode] of [['group', 0o770], ['group-write-only', 0o720], ['world', 0o707], ['world-write-only', 0o702]]) {
    const dir = mk(path.join(home, name)); const b = mk(path.join(dir, '.bowerloom')); fs.chmodSync(b, mode);
    assert.throws(() => discoverProject(dir, home), code('PROJECT_UNSAFE'), name);
  }
  const foreign = mk(path.join(home, 'foreign')); mk(path.join(foreign, '.bowerloom'));
  assert.throws(() => discoverProject(foreign, home, { uid: process.getuid() + 1 }), code('PROJECT_UNSAFE'));
  const plain = mk(path.join(home, 'plain')); fs.writeFileSync(path.join(plain, '.bowerloom'), 'x');
  assert.throws(() => discoverProject(plain, home), code('PROJECT_UNSAFE'));
  const alias = mk(path.join(home, 'alias')); mk(path.join(alias, '.Bowerloom'));
  assert.throws(() => discoverProject(alias, home), code('PROJECT_UNSAFE'));
  const both = mk(path.join(home, 'both')); mk(path.join(both, '.bowerloom'));
  try { fs.mkdirSync(path.join(both, '.BOWERLOOM'), { mode: 0o700 }); assert.throws(() => discoverProject(both, home), code('PROJECT_UNSAFE')); } catch (e) { if (e.code !== 'EEXIST') throw e; }
});

test('an unsafe nearest .bowerloom stops the search instead of falling through to a safer parent', t => {
  const { home } = world(t);
  const outer = mk(path.join(home, 'outer')), inner = mk(path.join(outer, 'inner')); mk(path.join(outer, '.bowerloom'));
  const b = mk(path.join(inner, '.bowerloom')); fs.chmodSync(b, 0o770);
  assert.throws(() => discoverProject(inner, home), code('PROJECT_UNSAFE'));
});

test('the search stops at HOME and never reaches a project above it', t => {
  const { base, home } = world(t);
  mk(path.join(base, '.bowerloom'));
  const sub = mk(path.join(home, 'sub'));
  assert.throws(() => discoverProject(sub, home), code('PROJECT_NOT_FOUND'));
});

test('discovery refuses HOME and / as the working folder, and a .bowerloom held by HOME', t => {
  const { home } = world(t);
  assert.throws(() => discoverProject(home, home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => discoverProject('/', home), code('PROJECT_ROOT_REFUSED'));
  mk(path.join(home, '.bowerloom'));
  assert.throws(() => discoverProject(mk(path.join(home, 'sub')), home), code('PROJECT_ROOT_REFUSED'));
});

test('the search stops at a device change', t => {
  const { home } = world(t);
  const project = mk(path.join(home, 'app')); mk(path.join(project, '.bowerloom')); const sub = mk(path.join(project, 'mount', 'inner'));
  assert.equal(discoverProject(sub, home).dir, project);
  const deviceOf = dir => dir.startsWith(path.join(project, 'mount')) ? 'other-device' : 'main-device';
  assert.throws(() => discoverProject(sub, home, { deviceOf }), code('PROJECT_NOT_FOUND'));
  assert.equal(discoverProject(project, home, { deviceOf }).dir, project);
});

test('discovery refuses a project in a cloud folder', t => {
  const { home } = world(t);
  const cloud = mk(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'app')); mk(path.join(cloud, '.bowerloom'));
  assert.throws(() => discoverProject(cloud, home), code('PROJECT_IN_CLOUD_FOLDER'));
  const documents = mk(path.join(home, 'Documents', 'app')); mk(path.join(documents, '.bowerloom'));
  assert.equal(discoverProject(documents, home).dir, documents);
  mk(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'));
  assert.throws(() => discoverProject(documents, home), code('PROJECT_IN_CLOUD_FOLDER'));
});

test('checkProjectPath refuses Library cloud paths always', t => {
  const { home } = world(t);
  for (const p of ['Library/Mobile Documents', 'Library/Mobile Documents/com~apple~CloudDocs/x', 'Library/CloudStorage', 'Library/CloudStorage/Dropbox/x', 'library/cloudstorage/y']) {
    assert.throws(() => checkProjectPath(path.join(home, p), home), code('PROJECT_IN_CLOUD_FOLDER'), p);
  }
  assert.doesNotThrow(() => checkProjectPath(path.join(home, 'Library', 'Application Support', 'x'), home));
  assert.doesNotThrow(() => checkProjectPath(path.join(home, 'code', 'x'), home));
});

test('checkProjectPath refuses Documents and Desktop only when the iCloud marker folder is a real folder', t => {
  const { home } = world(t);
  const docs = path.join(home, 'Documents', 'a'), desk = path.join(home, 'Desktop', 'b');
  assert.doesNotThrow(() => checkProjectPath(docs, home)); assert.doesNotThrow(() => checkProjectPath(desk, home));
  const cloudDocs = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  mk(path.join(cloudDocs, 'Documents'));
  assert.throws(() => checkProjectPath(docs, home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(home, 'Documents'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(home, 'documents', 'a'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.doesNotThrow(() => checkProjectPath(desk, home), 'Desktop sync is separate');
  fs.symlinkSync(path.join(home, 'elsewhere'), path.join(cloudDocs, 'Desktop'));
  assert.doesNotThrow(() => checkProjectPath(desk, home), 'a symlink is not a real folder');
  fs.unlinkSync(path.join(cloudDocs, 'Desktop')); mk(path.join(cloudDocs, 'Desktop'));
  assert.throws(() => checkProjectPath(desk, home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.doesNotThrow(() => checkProjectPath(path.join(home, 'Documentsx', 'a'), home));
});

test('checkProjectPath refuses / and HOME, and relative paths', t => {
  const { home } = world(t);
  assert.throws(() => checkProjectPath('/', home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPath(home, home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPath(home + '/', home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPath('relative', home), code('USAGE'));
  assert.throws(() => checkProjectPath(path.join(home, 'x'), 'relative-home'), code('USAGE'));
});

test('a refusal carries a fixed code and a message with no path', t => {
  const { home } = world(t);
  try { checkProjectPath(path.join(home, 'Library', 'CloudStorage', 'x'), home); assert.fail('expected a refusal'); }
  catch (e) { assert.equal(e.code, 'PROJECT_IN_CLOUD_FOLDER'); assert.equal(e.message.includes(home), false); }
});

test('projectId is the first 32 hex of sha256 over the real path, device and inode', t => {
  const { home } = world(t);
  const dir = mk(path.join(home, 'app')); const stat = fs.lstatSync(dir, { bigint: true });
  const identity = { device: stat.dev.toString(), inode: stat.ino.toString(), birthtimeNs: '1', uid: 1, mode: 0o700 };
  const id = projectId(dir, identity);
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(id, projectId(dir, { ...identity, birthtimeNs: '2', uid: 2 }), 'only path, device and inode count');
  assert.notEqual(id, projectId(dir, { ...identity, inode: identity.inode + '1' }));
  assert.notEqual(id, projectId(dir, { ...identity, device: identity.device + '1' }));
  assert.notEqual(id, projectId(dir + '2', identity));
  assert.equal(id, createHash('sha256').update(JSON.stringify([dir, identity.device, identity.inode])).digest('hex').slice(0, 32));
});

test('privateStateRoot uses an absolute XDG_STATE_HOME, else ~/.local/state', () => {
  assert.equal(privateStateRoot({ XDG_STATE_HOME: '/var/state' }, '/Users/a'), '/var/state/bowerloom');
  assert.equal(privateStateRoot({ XDG_STATE_HOME: 'relative/state' }, '/Users/a'), '/Users/a/.local/state/bowerloom');
  assert.equal(privateStateRoot({ XDG_STATE_HOME: '' }, '/Users/a'), '/Users/a/.local/state/bowerloom');
  assert.equal(privateStateRoot({}, '/Users/a'), '/Users/a/.local/state/bowerloom');
  assert.throws(() => privateStateRoot({}, 'relative'), code('USAGE'));
});
