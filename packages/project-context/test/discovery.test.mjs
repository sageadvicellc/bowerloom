import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { discoverProject, checkProjectPath, projectId, privateStateRoot, verifyProjectPins, adoptCreatedMarker, checkConfigFile } from '../../../dist/packages/project-context/src/index.js';
// Test hooks live in the internal module only. The package index exports no hook.
import { discoverProjectWith, checkProjectPathWith } from '../../../dist/packages/project-context/src/discovery.js';

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
  assert.deepEqual(Object.keys(found), ['dir', 'identity', 'ancestry', 'bowerloomIdentity', 'configPresent', 'projectId']);
  assert.equal(found.configPresent, false);
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
  assert.throws(() => discoverProjectWith(foreign, home, { uid: process.getuid() + 1 }), code('PROJECT_UNSAFE'));
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
  mk(path.join(home, '.bowerloom')); fs.writeFileSync(path.join(home, '.bowerloom', 'x'), 'x');
  assert.throws(() => discoverProject(mk(path.join(home, 'sub')), home), code('PROJECT_ROOT_REFUSED'));
});

test('the search stops at a device change', t => {
  const { home } = world(t);
  const project = mk(path.join(home, 'app')); mk(path.join(project, '.bowerloom')); const sub = mk(path.join(project, 'mount', 'inner'));
  assert.equal(discoverProject(sub, home).dir, project);
  const deviceOf = dir => dir.startsWith(path.join(project, 'mount')) ? 'other-device' : 'main-device';
  assert.throws(() => discoverProjectWith(sub, home, { deviceOf }), code('PROJECT_NOT_FOUND'));
  assert.equal(discoverProjectWith(project, home, { deviceOf }).dir, project);
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

test('checkProjectPath refuses Documents and Desktop when the iCloud marker is a real folder or a link to that folder', t => {
  const { home } = world(t);
  const docs = path.join(home, 'Documents', 'a'), desk = path.join(home, 'Desktop', 'b');
  assert.doesNotThrow(() => checkProjectPath(docs, home)); assert.doesNotThrow(() => checkProjectPath(desk, home));
  const cloudDocs = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  mk(path.join(cloudDocs, 'Documents'));
  assert.throws(() => checkProjectPath(docs, home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(home, 'Documents'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(home, 'documents', 'a'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.doesNotThrow(() => checkProjectPath(desk, home), 'Desktop sync is separate');
  mk(path.join(home, 'elsewhere')); mk(path.join(home, 'Desktop'));
  fs.symlinkSync(path.join(home, 'elsewhere'), path.join(cloudDocs, 'Desktop'));
  assert.doesNotThrow(() => checkProjectPath(desk, home), 'a link to some other folder is not Desktop sync');
  fs.unlinkSync(path.join(cloudDocs, 'Desktop')); fs.symlinkSync(path.join(home, 'Desktop'), path.join(cloudDocs, 'Desktop'));
  assert.throws(() => checkProjectPath(desk, home), code('PROJECT_IN_CLOUD_FOLDER'), 'macOS 15 shows Desktop sync as a link to HOME/Desktop');
  fs.unlinkSync(path.join(cloudDocs, 'Desktop')); fs.symlinkSync(path.join('..', '..', '..', 'Desktop'), path.join(cloudDocs, 'Desktop'));
  assert.throws(() => checkProjectPath(desk, home), code('PROJECT_IN_CLOUD_FOLDER'), 'a relative link that resolves to HOME/Desktop');
  fs.unlinkSync(path.join(cloudDocs, 'Desktop')); fs.symlinkSync(path.join(home, 'Desktop', 'missing'), path.join(cloudDocs, 'Desktop'));
  assert.doesNotThrow(() => checkProjectPath(desk, home), 'a dangling link is not sync');
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

test('checkProjectPath treats a marker link that resolves to HOME/Documents through another link as sync on', t => {
  const { base, home } = world(t);
  const cloudDocs = mk(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')); mk(path.join(home, 'Documents'));
  fs.symlinkSync(home, path.join(base, 'home-link'));
  fs.symlinkSync(path.join(base, 'home-link', 'Documents'), path.join(cloudDocs, 'Documents'));
  assert.throws(() => checkProjectPath(path.join(home, 'Documents', 'a'), home), code('PROJECT_IN_CLOUD_FOLDER'));
});

test('checkProjectPath refuses when macOS or permissions block the marker: lstat or realpath EACCES', t => {
  const { home } = world(t);
  const mobile = mk(path.join(home, 'Library', 'Mobile Documents')), cloudDocs = mk(path.join(mobile, 'com~apple~CloudDocs')); mk(path.join(home, 'Documents'));
  fs.symlinkSync(path.join(home, 'Documents'), path.join(cloudDocs, 'Documents'));
  const docs = path.join(home, 'Documents', 'a');
  fs.chmodSync(cloudDocs, 0o000);
  try {
    assert.throws(() => checkProjectPath(docs, home), code('PROJECT_IN_CLOUD_FOLDER'), 'lstat EACCES refuses');
    assert.doesNotThrow(() => checkProjectPath(path.join(home, 'code', 'a'), home), 'only a Documents or Desktop path reads the marker');
  } finally { fs.chmodSync(cloudDocs, 0o700); }
  const locked = mk(path.join(home, 'locked')); mk(path.join(locked, 'Documents'));
  fs.unlinkSync(path.join(cloudDocs, 'Documents')); fs.symlinkSync(path.join(locked, 'Documents'), path.join(cloudDocs, 'Documents'));
  fs.chmodSync(locked, 0o000);
  try { assert.throws(() => checkProjectPath(docs, home), code('PROJECT_IN_CLOUD_FOLDER'), 'realpath EACCES refuses'); }
  finally { fs.chmodSync(locked, 0o700); }
  assert.doesNotThrow(() => checkProjectPath(docs, home), 'the same link, readable, points elsewhere');
});

test('the account home from the user database is refused too, not only HOME', t => {
  const { base, home } = world(t);
  const account = mk(path.join(base, 'account')), hooks = { accountHome: account };
  assert.throws(() => checkProjectPathWith(account, home, hooks), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPathWith(path.join(account, 'Library', 'CloudStorage', 'x'), home, hooks), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPathWith(path.join(account, 'Library', 'Mobile Documents', 'x'), home, hooks), code('PROJECT_IN_CLOUD_FOLDER'));
  mk(path.join(account, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'));
  assert.throws(() => checkProjectPathWith(path.join(account, 'Documents', 'x'), home, hooks), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.doesNotThrow(() => checkProjectPathWith(path.join(account, 'code', 'x'), home, hooks));
  assert.doesNotThrow(() => checkProjectPathWith(path.join(home, 'Documents', 'x'), home, hooks), 'HOME has no marker of its own');
  // The search stops at the account home as it does at HOME.
  mk(path.join(base, '.bowerloom'));
  assert.throws(() => discoverProjectWith(mk(path.join(account, 'sub')), home, hooks), code('PROJECT_NOT_FOUND'));
  mk(path.join(account, '.bowerloom')); fs.writeFileSync(path.join(account, '.bowerloom', 'x'), 'x');
  assert.throws(() => discoverProjectWith(path.join(account, 'sub'), home, hooks), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => discoverProjectWith(account, home, hooks), code('PROJECT_ROOT_REFUSED'));
});

test('the real account home is refused when HOME points somewhere else (read only)', t => {
  const { home } = world(t);
  const account = os.userInfo().homedir;
  assert.throws(() => checkProjectPath(account, home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPath(path.join(account, 'Library', 'CloudStorage', 'x'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(account, 'Library', 'Mobile Documents', 'x'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => discoverProject(account, home), code('PROJECT_ROOT_REFUSED'));
});

const DATA = '/System/Volumes/Data';
const sameFolder = (a, b) => { try { const x = fs.statSync(a, { bigint: true }), y = fs.statSync(b, { bigint: true }); return x.dev === y.dev && x.ino === y.ino; } catch { return false; } };

test('a /System/Volumes/Data alias of HOME is HOME: the HOME, Library and Documents rules hold', t => {
  const { home } = world(t);
  const alias = DATA + home;
  if (!sameFolder(alias, home)) { t.skip('no /System/Volumes/Data alias on this machine'); return; }
  assert.throws(() => checkProjectPath(alias, home), code('PROJECT_ROOT_REFUSED'));
  assert.throws(() => checkProjectPath(path.join(alias, 'Library', 'CloudStorage', 'x'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(alias, 'Library', 'Mobile Documents', 'x'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  mk(path.join(home, 'Documents', 'a')); mk(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'));
  assert.throws(() => checkProjectPath(path.join(alias, 'Documents', 'a'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  assert.throws(() => checkProjectPath(path.join(home, 'Documents', 'a'), alias), code('PROJECT_IN_CLOUD_FOLDER'), 'HOME given as the alias');
  assert.throws(() => checkProjectPath(home, alias), code('PROJECT_ROOT_REFUSED'));
});

test('a symlink to HOME, to a cloud folder or to a synced Documents folder is refused like the folder itself', t => {
  const { base, home } = world(t);
  fs.symlinkSync(home, path.join(base, 'to-home'));
  assert.throws(() => checkProjectPath(path.join(base, 'to-home'), home), code('PROJECT_ROOT_REFUSED'));
  const storage = mk(path.join(home, 'Library', 'CloudStorage', 'Dropbox')); fs.symlinkSync(storage, path.join(base, 'to-dropbox'));
  assert.throws(() => checkProjectPath(path.join(base, 'to-dropbox', 'app'), home), code('PROJECT_IN_CLOUD_FOLDER'));
  const documents = mk(path.join(home, 'Documents')); fs.symlinkSync(documents, path.join(base, 'to-documents'));
  assert.doesNotThrow(() => checkProjectPath(path.join(base, 'to-documents', 'app'), home), 'sync is off');
  mk(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'));
  assert.throws(() => checkProjectPath(path.join(base, 'to-documents', 'app'), home), code('PROJECT_IN_CLOUD_FOLDER'));
});

test('a case or long-s alias of HOME is HOME on a case-insensitive disk, for the refusal and for the stop', t => {
  const { base, home } = world(t);
  const upper = home.toUpperCase(), longS = home.replace(/s/, '\u017f');
  mk(path.join(base, '.bowerloom')); const sub = mk(path.join(home, 'sub'));
  let checked = 0;
  for (const alias of [upper, longS]) {
    if (alias === home || !sameFolder(alias, home)) continue;
    checked++;
    assert.throws(() => checkProjectPath(alias, home), code('PROJECT_ROOT_REFUSED'), alias);
    assert.throws(() => checkProjectPath(home, alias), code('PROJECT_ROOT_REFUSED'), alias);
    assert.throws(() => checkProjectPath(path.join(alias, 'Library', 'CloudStorage', 'x'), home), code('PROJECT_IN_CLOUD_FOLDER'), alias);
    assert.throws(() => discoverProject(sub, alias), code('PROJECT_NOT_FOUND'), `the search stops at ${alias}`);
  }
  if (checked === 0) t.skip('this disk is case-sensitive');
});

test('an unreadable folder on the way up refuses PROJECT_UNREADABLE instead of being skipped', t => {
  const { home } = world(t);
  const outer = mk(path.join(home, 'outer')); mk(path.join(outer, '.bowerloom'));
  const mid = mk(path.join(outer, 'mid')), inner = mk(path.join(mid, 'inner'));
  assert.equal(discoverProject(inner, home).dir, outer);
  fs.chmodSync(mid, 0o311);
  try { assert.throws(() => discoverProject(inner, home), code('PROJECT_UNREADABLE')); }
  finally { fs.chmodSync(mid, 0o700); }
});

test('the .bowerloom check and its pinned identity come from one lstat', t => {
  const { home } = world(t);
  const dir = mk(path.join(home, 'app')); mk(path.join(dir, '.bowerloom'));
  let reads = 0;
  for (const name of ['lstatSync', 'statSync']) {
    const original = fs[name];
    t.mock.method(fs, name, (...args) => { if (String(args[0]) === path.join(dir, '.bowerloom')) reads++; return original(...args); });
  }
  syncBuiltinESMExports();
  try { discoverProject(dir, home); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(reads, 1);
});

test('verifyProjectPins refuses PROJECT_UNSAFE once the project or its .bowerloom folder is swapped', t => {
  const { home } = world(t);
  const dir = mk(path.join(home, 'app')); mk(path.join(dir, '.bowerloom'));
  const found = discoverProject(dir, home);
  assert.doesNotThrow(() => verifyProjectPins(found));
  fs.renameSync(path.join(dir, '.bowerloom'), path.join(dir, '.old')); mk(path.join(dir, '.bowerloom'));
  assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'));
  const again = discoverProject(dir, home);
  fs.renameSync(dir, dir + '-old'); mk(path.join(dir, '.bowerloom'));
  assert.throws(() => verifyProjectPins(again), code('PROJECT_UNSAFE'));
  fs.rmSync(dir, { recursive: true });
  assert.throws(() => verifyProjectPins(again), code('PROJECT_UNSAFE'));
});

test('the exported discoverProject takes no test hooks', t => {
  const { home } = world(t);
  const dir = mk(path.join(home, 'app')); mk(path.join(dir, '.bowerloom'));
  assert.equal(discoverProject(dir, home, { uid: process.getuid() + 1, deviceOf: () => 'other', accountHome: dir }).dir, dir);
  assert.doesNotThrow(() => checkProjectPath(path.join(home, 'x'), home, { accountHome: path.join(home, 'x') }));
});

// ---- Store foundation (spec 03): the config marker and the store at home ----
const STORE_BODY = '{"format":"bowerloom/store/v1beta1"}\n';
const mkStore = (dir) => { mk(path.join(dir, '.bowerloom')); fs.writeFileSync(path.join(dir, '.bowerloom', 'store.json'), STORE_BODY, { mode: 0o600 }); };
const putConfig = (dir, text = '{}\n', mode = 0o600) => { const f = path.join(dir, 'bowerloom.json'); fs.writeFileSync(f, text, { mode }); fs.chmodSync(f, mode); return f; };
const expectOf = (p, folder) => { const st = fs.lstatSync(p, { bigint: true }); return { device: st.dev.toString(), inode: st.ino.toString(), ...(folder ? { birthtimeNs: st.birthtimeNs.toString() } : {}) }; };
const solo = base => ({ accountHome: path.join(base, 'nobody') });

test('a home with a valid store gives PROJECT_NOT_FOUND for a folder under home', t => {
  const { base, home } = world(t); mkStore(home);
  const sub = mk(path.join(home, 'sub', 'deep'));
  assert.throws(() => discoverProjectWith(sub, home, solo(base)), code('PROJECT_NOT_FOUND'));
  assert.throws(() => discoverProject(sub, home), code('PROJECT_NOT_FOUND'));
});

test('a home with an empty .bowerloom (a leftover store) gives PROJECT_NOT_FOUND', t => {
  const { base, home } = world(t); mk(path.join(home, '.bowerloom'));
  assert.throws(() => discoverProjectWith(mk(path.join(home, 'sub')), home, solo(base)), code('PROJECT_NOT_FOUND'));
  fs.writeFileSync(path.join(home, '.bowerloom', '.store.json.0123456789abcdef.tmp'), 'x');
  assert.throws(() => discoverProjectWith(path.join(home, 'sub'), home, solo(base)), code('PROJECT_NOT_FOUND'));
});

test('a home with a non-empty .bowerloom that has no store.json gives PROJECT_ROOT_REFUSED', t => {
  const { base, home } = world(t); mk(path.join(home, '.bowerloom')); fs.writeFileSync(path.join(home, '.bowerloom', 'x'), 'x');
  assert.throws(() => discoverProjectWith(mk(path.join(home, 'sub')), home, solo(base)), code('PROJECT_ROOT_REFUSED'));
});

test('a home with a store whose store.json is invalid, or a store that is a link or unsafe, names the STORE_* code (silent-failure F10)', t => {
  const { base, home } = world(t); mkStore(home); fs.writeFileSync(path.join(home, '.bowerloom', 'store.json'), '{"format":"x"}\n');
  assert.throws(() => discoverProjectWith(mk(path.join(home, 'sub')), home, solo(base)), code('STORE_INVALID'));
  const w = world(t); mk(path.join(w.base, 'elsewhere')); fs.symlinkSync(path.join(w.base, 'elsewhere'), path.join(w.home, '.bowerloom'));
  assert.throws(() => discoverProjectWith(mk(path.join(w.home, 'sub')), w.home, solo(w.base)), code('STORE_UNSAFE'));
  const u = world(t); mkStore(u.home); fs.chmodSync(path.join(u.home, '.bowerloom'), 0o770);
  assert.throws(() => discoverProjectWith(mk(path.join(u.home, 'sub')), u.home, solo(u.base)), code('STORE_UNSAFE'), 'an unsafe store at home');
  assert.throws(() => discoverProject(path.join(u.home, 'sub'), u.home), code('STORE_UNSAFE'));
});

test('a bowerloom.json at home, or an alias of .bowerloom at home, gives PROJECT_ROOT_REFUSED; at the disk root too', t => {
  const { base, home } = world(t); putConfig(home);
  assert.throws(() => discoverProjectWith(mk(path.join(home, 'sub')), home, solo(base)), code('PROJECT_ROOT_REFUSED'));
  const w = world(t); mk(path.join(w.home, '.BOWERLOOM'));
  assert.throws(() => discoverProjectWith(mk(path.join(w.home, 'sub')), w.home, solo(w.base)), code('PROJECT_ROOT_REFUSED'));
});

test('a folder with only bowerloom.json is a project with a null bowerloomIdentity and configPresent true', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); putConfig(dir);
  const found = discoverProject(mk(path.join(dir, 'src')), home);
  assert.equal(found.dir, dir); assert.equal(found.bowerloomIdentity, null); assert.equal(found.configPresent, true);
  assert.deepEqual(Object.keys(found), ['dir', 'identity', 'ancestry', 'bowerloomIdentity', 'configPresent', 'projectId']);
  assert.equal(found.projectId, projectId(dir, found.identity));
  assert.ok(Object.isFrozen(found));
  assert.doesNotThrow(() => verifyProjectPins(found));
});

test('a folder with both markers has both', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); mk(path.join(dir, '.bowerloom')); putConfig(dir);
  const found = discoverProject(dir, home);
  assert.equal(found.configPresent, true); assert.equal(found.bowerloomIdentity.uid, process.getuid());
});

test('the nearest marker wins, in both orders of inner and outer', t => {
  const { home } = world(t);
  const outer = mk(path.join(home, 'outer')), inner = mk(path.join(outer, 'inner')); mk(path.join(outer, '.bowerloom')); putConfig(inner);
  assert.equal(discoverProject(inner, home).dir, inner);
  assert.equal(discoverProject(inner, home).bowerloomIdentity, null);
  const o2 = mk(path.join(home, 'o2')), i2 = mk(path.join(o2, 'i2')); putConfig(o2); mk(path.join(i2, '.bowerloom'));
  const found = discoverProject(i2, home);
  assert.equal(found.dir, i2); assert.equal(found.configPresent, false);
});

test('Bowerloom.json, or two names that fold to bowerloom.json, give PROJECT_UNSAFE', t => {
  const { home } = world(t);
  const alias = mk(path.join(home, 'alias')); fs.writeFileSync(path.join(alias, 'Bowerloom.json'), '{}');
  assert.throws(() => discoverProject(alias, home), code('PROJECT_UNSAFE'));
  const two = mk(path.join(home, 'two')); putConfig(two);
  try { fs.writeFileSync(path.join(two, 'BOWERLOOM.JSON'), '{}', { flag: 'wx' }); assert.throws(() => discoverProject(two, home), code('PROJECT_UNSAFE')); } catch (e) { if (e.code !== 'EEXIST') throw e; }
});

test('an unsafe bowerloom.json gives CONFIG_UNSAFE', t => {
  const { base, home } = world(t);
  const at = name => mk(path.join(home, name));
  let dir = at('link'); fs.writeFileSync(path.join(base, 'real.json'), '{}'); fs.symlinkSync(path.join(base, 'real.json'), path.join(dir, 'bowerloom.json'));
  assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'link');
  dir = at('folder'); mk(path.join(dir, 'bowerloom.json'));
  assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'folder');
  dir = at('twolinks'); const f = putConfig(dir); fs.linkSync(f, path.join(base, 'twin.json'));
  assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'two hard links');
  dir = at('group'); putConfig(dir, '{}', 0o660); assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'group write');
  dir = at('world'); putConfig(dir, '{}', 0o602); assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'world write');
  dir = at('owner'); putConfig(dir); assert.throws(() => discoverProjectWith(dir, home, { uid: process.getuid() + 1 }), code('CONFIG_UNSAFE'), 'another owner');
  dir = at('big'); putConfig(dir, ' '.repeat(1048577)); assert.throws(() => discoverProject(dir, home), code('CONFIG_UNSAFE'), 'over 1 MiB');
  dir = at('exact'); putConfig(dir, ' '.repeat(1048576)); assert.equal(discoverProject(dir, home).configPresent, true, 'exactly 1 MiB passes');
  assert.throws(() => checkConfigFile(path.join(home, 'link')), code('CONFIG_UNSAFE'));
  assert.equal(checkConfigFile(path.join(home, 'nothing-here')), null);
});

test('an unsafe config stops the search instead of falling through to a safer parent', t => {
  const { home } = world(t); const outer = mk(path.join(home, 'outer')), inner = mk(path.join(outer, 'inner')); mk(path.join(outer, '.bowerloom')); putConfig(inner, '{}', 0o660);
  assert.throws(() => discoverProject(inner, home), code('CONFIG_UNSAFE'));
});

test('verifyProjectPins passes after the config is replaced by rename, and refuses after it is deleted or linked', t => {
  const { base, home } = world(t); const dir = mk(path.join(home, 'app')); const f = putConfig(dir, '{"a":1}');
  const found = discoverProject(dir, home);
  fs.writeFileSync(f + '.new', '{"b":2}', { mode: 0o600 }); fs.renameSync(f + '.new', f);
  assert.doesNotThrow(() => verifyProjectPins(found));
  fs.rmSync(f); assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'));
  fs.writeFileSync(path.join(base, 'real.json'), '{}'); fs.symlinkSync(path.join(base, 'real.json'), f);
  assert.throws(() => verifyProjectPins(found), code('CONFIG_UNSAFE'));
});

test('verifyProjectPins refuses PROJECT_UNSAFE when .bowerloom appears after a config-only discovery, or a config appears after a folder-only one', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); putConfig(dir);
  const found = discoverProject(dir, home);
  mk(path.join(dir, '.bowerloom'));
  assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'));
  const d2 = mk(path.join(home, 'app2')); mk(path.join(d2, '.bowerloom')); const f2 = discoverProject(d2, home);
  putConfig(d2);
  assert.throws(() => verifyProjectPins(f2), code('PROJECT_UNSAFE'));
});

test('adoptCreatedMarker adopts a folder into a config-only project and a config into a folder-only one', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); putConfig(dir);
  const found = discoverProject(dir, home);
  mk(path.join(dir, '.bowerloom'));
  const adopted = adoptCreatedMarker(found, 'folder', expectOf(path.join(dir, '.bowerloom'), true));
  assert.deepEqual(Object.keys(adopted), ['dir', 'identity', 'ancestry', 'bowerloomIdentity', 'configPresent', 'projectId']);
  assert.notEqual(adopted.bowerloomIdentity, null); assert.equal(adopted.configPresent, true); assert.equal(adopted.projectId, found.projectId);
  assert.ok(Object.isFrozen(adopted));
  assert.doesNotThrow(() => verifyProjectPins(adopted));
  assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'));
  assert.deepEqual(adopted.bowerloomIdentity, discoverProject(dir, home).bowerloomIdentity);
  assert.throws(() => adoptCreatedMarker(adopted, 'folder', expectOf(path.join(dir, '.bowerloom'), true)), code('USAGE'));
  const d2 = mk(path.join(home, 'app2')); mk(path.join(d2, '.bowerloom')); const f2 = discoverProject(d2, home);
  putConfig(d2);
  const a2 = adoptCreatedMarker(f2, 'config', expectOf(path.join(d2, 'bowerloom.json'), false));
  assert.equal(a2.configPresent, true); assert.doesNotThrow(() => verifyProjectPins(a2));
  assert.throws(() => adoptCreatedMarker(a2, 'config', expectOf(path.join(d2, 'bowerloom.json'), false)), code('USAGE'));
  assert.throws(() => adoptCreatedMarker(f2, 'nope', { device: '1', inode: '1' }), code('USAGE'));
  assert.throws(() => adoptCreatedMarker(f2, 'config'), code('USAGE'), 'no expected identity');
});

test('adoptCreatedMarker refuses a new marker that is unsafe or missing', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); putConfig(dir);
  const found = discoverProject(dir, home);
  assert.throws(() => adoptCreatedMarker(found, 'folder', { device: '1', inode: '1', birthtimeNs: '1' }), code('PROJECT_UNSAFE'), 'no folder was made');
  const b = mk(path.join(dir, '.bowerloom')); fs.chmodSync(b, 0o770);
  assert.throws(() => adoptCreatedMarker(found, 'folder', expectOf(b, true)), code('PROJECT_UNSAFE'), 'a group-writable folder');
  const d2 = mk(path.join(home, 'app2')); mk(path.join(d2, '.bowerloom')); const f2 = discoverProject(d2, home);
  assert.throws(() => adoptCreatedMarker(f2, 'config', { device: '1', inode: '1' }), code('PROJECT_UNSAFE'), 'no config was made');
  putConfig(d2, '{}', 0o660);
  assert.throws(() => adoptCreatedMarker(f2, 'config', expectOf(path.join(d2, 'bowerloom.json'), false)), code('CONFIG_UNSAFE'), 'a group-writable config');
});

test('the walk stops at the account home with a valid store there', t => {
  const { base, home } = world(t); const account = mk(path.join(base, 'account')); mkStore(account); mk(path.join(base, '.bowerloom'));
  const hooks = { accountHome: account };
  assert.throws(() => discoverProjectWith(mk(path.join(account, 'sub')), home, hooks), code('PROJECT_NOT_FOUND'));
  assert.throws(() => discoverProjectWith(account, home, hooks), code('PROJECT_ROOT_REFUSED'));
});

test('a project folder inside the store gives STORE_NOT_A_PROJECT, for both homes', t => {
  const { base, home } = world(t); mkStore(home);
  for (const marker of ['.bowerloom', 'bowerloom.json']) {
    const work = mk(path.join(home, '.bowerloom', `work-${marker}`));
    if (marker === '.bowerloom') mk(path.join(work, '.bowerloom')); else putConfig(work);
    assert.throws(() => discoverProjectWith(work, home, solo(base)), code('STORE_NOT_A_PROJECT'), marker);
  }
  const account = mk(path.join(base, 'account')); mkStore(account);
  const work = mk(path.join(account, '.bowerloom', 'work')); mk(path.join(work, '.bowerloom'));
  assert.throws(() => discoverProjectWith(work, home, { accountHome: account }), code('STORE_NOT_A_PROJECT'), 'account home');
});

test('a working folder inside the store gives PROJECT_NOT_FOUND', t => {
  const { base, home } = world(t); mkStore(home); const inside = mk(path.join(home, '.bowerloom', 'skills', 'x'));
  assert.throws(() => discoverProjectWith(inside, home, solo(base)), code('PROJECT_NOT_FOUND'));
});

test('a project under a home that has a store is found as usual', t => {
  const { base, home } = world(t); mkStore(home); const app = mk(path.join(home, 'app')); mk(path.join(app, '.bowerloom'));
  assert.equal(discoverProjectWith(mk(path.join(app, 'src')), home, solo(base)).dir, app);
});

// ---- Review fixes: S1, S5, S6, S8, F9, F13, C1 ----
test('S1: a project folder that others can write refuses PROJECT_UNSAFE, at discovery and at verify', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'open')); putConfig(dir); fs.chmodSync(dir, 0o777);
  assert.throws(() => discoverProject(dir, home), code('PROJECT_UNSAFE'), '0777');
  fs.chmodSync(dir, 0o770); assert.throws(() => discoverProject(dir, home), code('PROJECT_UNSAFE'), '0770');
  fs.chmodSync(dir, 0o755); const found = discoverProject(dir, home);
  fs.chmodSync(dir, 0o775); assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'), 'turned group-writable after discovery');
  const other = mk(path.join(home, 'other')); mk(path.join(other, '.bowerloom'));
  assert.throws(() => discoverProjectWith(other, home, { uid: process.getuid() + 1 }), code('PROJECT_UNSAFE'), 'owner');
});

test('S5: adoptCreatedMarker refuses a marker that is not the writer\'s own, and takes the uid hook (F13)', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); putConfig(dir);
  const found = discoverProject(dir, home); const folder = path.join(dir, '.bowerloom'); mk(folder);
  const mine = expectOf(folder, true);
  assert.throws(() => adoptCreatedMarker(found, 'folder', { ...mine, inode: mine.inode + '9' }), code('PROJECT_UNSAFE'), 'inode');
  assert.throws(() => adoptCreatedMarker(found, 'folder', { ...mine, birthtimeNs: '1' }), code('PROJECT_UNSAFE'), 'birth time');
  assert.throws(() => adoptCreatedMarker(found, 'folder', { ...mine, device: mine.device + '9' }), code('PROJECT_UNSAFE'), 'device');
  assert.throws(() => adoptCreatedMarker(found, 'folder', mine, { uid: process.getuid() + 1 }), code('PROJECT_UNSAFE'), 'uid hook');
  assert.doesNotThrow(() => adoptCreatedMarker(found, 'folder', mine));
  const d2 = mk(path.join(home, 'app2')); mk(path.join(d2, '.bowerloom')); const f2 = discoverProject(d2, home); const cfg = putConfig(d2);
  const c = expectOf(cfg, false);
  assert.throws(() => adoptCreatedMarker(f2, 'config', { ...c, inode: c.inode + '9' }), code('PROJECT_UNSAFE'), 'config inode');
  assert.throws(() => adoptCreatedMarker(f2, 'config', c, { uid: process.getuid() + 1 }), code('CONFIG_UNSAFE'), 'config uid hook');
  assert.doesNotThrow(() => adoptCreatedMarker(f2, 'config', c));
});

test('S6: a case alias of bowerloom.json or .bowerloom that appears after discovery refuses PROJECT_UNSAFE', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); const f = putConfig(dir);
  const found = discoverProject(dir, home);
  fs.writeFileSync(path.join(dir, 'Bowerloom.json'), '{}', { mode: 0o600 });
  if (fs.readdirSync(dir).length === 2) assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'), 'alias beside the config');
  else t.diagnostic('this disk is case-insensitive: the alias is the same file, so only the rename case runs');
  fs.rmSync(path.join(dir, 'Bowerloom.json'), { force: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, '{}', { mode: 0o600 });
  fs.renameSync(f, path.join(dir, 'Bowerloom.json'));
  assert.throws(() => verifyProjectPins(found), code('PROJECT_UNSAFE'), 'config renamed to an alias');
  const d2 = mk(path.join(home, 'app2')); putConfig(d2); const f2 = discoverProject(d2, home); mk(path.join(d2, '.Bowerloom'));
  assert.throws(() => verifyProjectPins(f2), code('PROJECT_UNSAFE'), '.bowerloom alias');
});

/** Makes lstat fail with `errno` for the paths `match` accepts, for the length of `body`. */
function failLstat(t, match, errno, body) {
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (...args) => { if (match(String(args[0]))) { const e = new Error('SYNTHETIC'); e.code = errno; throw e; } return original(...args); });
  syncBuiltinESMExports();
  try { return body(); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}

test('S8: a store folder at home that cannot be read gives PROJECT_UNREADABLE for a project below it', t => {
  const { base, home } = world(t); const app = mk(path.join(home, 'app')); mk(path.join(app, '.bowerloom'));
  failLstat(t, p => p === path.join(home, '.bowerloom'), 'EACCES', () => assert.throws(() => discoverProjectWith(app, home, solo(base)), code('PROJECT_UNREADABLE')));
});

test('C1: a bowerloom.json that is listed but gone by the time it is checked refuses PROJECT_UNSAFE', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); const f = putConfig(dir);
  failLstat(t, p => p === f, 'ENOENT', () => assert.throws(() => discoverProject(dir, home), code('PROJECT_UNSAFE')));
});

test('F9: a bowerloom.json that cannot be read gives CONFIG_UNREADABLE, not CONFIG_UNSAFE', t => {
  const { home } = world(t); const dir = mk(path.join(home, 'app')); const f = putConfig(dir);
  for (const errno of ['EACCES', 'EMFILE', 'EIO']) failLstat(t, p => p === f, errno, () => assert.throws(() => checkConfigFile(dir), code('CONFIG_UNREADABLE'), errno));
  assert.throws(() => checkConfigFile(dir, process.getuid() + 1), code('CONFIG_UNSAFE'), 'a real unsafe file stays CONFIG_UNSAFE');
});
