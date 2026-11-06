// Step 5, lane A of Bowerloom 0.8: the shared state layout of the harness commands, and the one move of the old app
// record (decisions I2 A and I3 A). Synthetic folders only.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  HARNESS_MOVED_FORMAT, HARNESS_STATE_REFUSAL_CODES, harnessStateDirs, settleLegacyState,
} from '../../../dist/packages/project-sync/src/index.js';
import { settleLegacyStateWith } from '../../../dist/packages/project-sync/src/harness-state.js';
import { projectId } from '../../../dist/packages/project-context/src/index.js';
import { pin } from '../../../dist/packages/project-context/src/discovery.js';
import { chmodTree, code } from './portable-fixture.mjs';

const mode = p => fs.lstatSync(p).mode & 0o777;
const legacyKey = dir => createHash('sha256').update(dir).digest('hex').slice(0, 32);

/** A real project folder and a state root beside it, both inside one private temporary folder. */
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-harness-state-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'); fs.mkdirSync(dir, { mode: 0o755 });
  const stateRoot = path.join(base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  return { base, dir, stateRoot, dirs: harnessStateDirs(stateRoot, dir) };
}
/** The old app record: `desktop/<key>/` with an adoption and a portable folder, as the app made it. */
function seedLegacy(w) {
  const legacy = w.dirs.legacy;
  fs.mkdirSync(path.join(legacy, 'portable', 'blobs'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(legacy, 'adoption'), { mode: 0o700 });
  fs.writeFileSync(path.join(legacy, 'portable', 'receipt.json'), '{"demo":true}\n', { mode: 0o600 });
  fs.writeFileSync(path.join(legacy, 'adoption', 'journal.json'), '{"demo":1}\n', { mode: 0o600 });
  return legacy;
}
const files = root => {
  const out = [];
  const walk = rel => { for (const n of fs.readdirSync(path.join(root, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; if (fs.lstatSync(path.join(root, r)).isDirectory()) walk(r); else out.push(`${r} ${fs.readFileSync(path.join(root, r), 'utf8').trim()}`); } };
  walk(''); return out;
};

// ---- layout --------------------------------------------------------------------------------------------------------------

test('layout: the record sits under the 0.7 project id, and the old app folder under desktop/<path hash>', t => {
  const w = world(t);
  const id = projectId(w.dir, pin(w.dir));
  const base = path.join(w.stateRoot, id, 'harness');
  assert.deepEqual(w.dirs, {
    base, adoption: path.join(base, 'adoption'), portable: path.join(base, 'portable'), approvals: path.join(base, 'approvals.json'),
    legacy: path.join(w.stateRoot, 'desktop', legacyKey(w.dir)),
  });
  assert.ok(Object.isFrozen(w.dirs));
  // Computing the layout touches nothing.
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
});

test('layout: a relative, unnormalized, or linked path is refused', t => {
  const w = world(t);
  assert.throws(() => harnessStateDirs('state/bowerloom', w.dir), code('PORTABLE_USAGE'));
  assert.throws(() => harnessStateDirs(w.stateRoot, 'project'), code('PORTABLE_USAGE'));
  assert.throws(() => harnessStateDirs(`${w.stateRoot}/`, w.dir), code('PORTABLE_USAGE'));
  assert.throws(() => harnessStateDirs(`${w.stateRoot}/../bowerloom`, w.dir), code('PORTABLE_USAGE'));
  assert.throws(() => harnessStateDirs(w.stateRoot, `${w.dir}\0x`), code('PORTABLE_USAGE'));
  const link = path.join(w.base, 'link'); fs.symlinkSync(w.dir, link);
  assert.throws(() => harnessStateDirs(w.stateRoot, link), code('PORTABLE_USAGE'));
  assert.throws(() => harnessStateDirs(w.stateRoot, path.join(w.base, 'absent')), code('PORTABLE_USAGE'));
});

test('layout: the new code has its own refusal list', () => {
  assert.deepEqual([...HARNESS_STATE_REFUSAL_CODES].sort(), ['HARNESS_APPROVAL_STALE', 'HARNESS_STATE_TWO_RECORDS']);
});

// ---- settle: nothing to move -----------------------------------------------------------------------------------------------

test('settle: with no old record, nothing is written, and a second call is the same', async t => {
  const w = world(t);
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
});

test('settle: a new record with no old one is left as it is', async t => {
  const w = world(t);
  fs.mkdirSync(w.dirs.portable, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(w.dirs.portable, 'receipt.json'), 'x\n', { mode: 0o600 });
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  assert.deepEqual(files(w.dirs.base), ['portable/receipt.json x']);
});

// ---- settle: the move ----------------------------------------------------------------------------------------------------

test('settle: the old record moves once by rename, then moved.json records it; a second call changes nothing', async t => {
  const w = world(t);
  const legacy = seedLegacy(w);
  const ino = fs.statSync(legacy).ino;
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'moved');
  assert.equal(fs.existsSync(legacy), false);
  // One rename: the same folder, by inode, with the same files.
  assert.equal(fs.statSync(w.dirs.base).ino, ino);
  assert.deepEqual(files(w.dirs.base).filter(l => !l.startsWith('moved.json')), ['adoption/journal.json {"demo":1}', 'portable/receipt.json {"demo":true}']);
  assert.equal(mode(w.dirs.base), 0o700);
  assert.equal(mode(path.dirname(w.dirs.base)), 0o700);
  const movedFile = path.join(w.dirs.base, 'moved.json');
  assert.equal(mode(movedFile), 0o600);
  const moved = JSON.parse(fs.readFileSync(movedFile, 'utf8'));
  assert.deepEqual(Object.keys(moved).sort(), ['format', 'from', 'projectDir', 'when']);
  assert.equal(moved.format, HARNESS_MOVED_FORMAT);
  assert.equal(moved.projectDir, w.dir);
  assert.equal(moved.from, `desktop/${legacyKey(w.dir)}`);
  assert.match(moved.when, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  // No marker of the move is left behind.
  assert.deepEqual(fs.readdirSync(w.dirs.base).sort(), ['adoption', 'moved.json', 'portable']);
  const before = fs.readFileSync(movedFile, 'utf8');
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  assert.equal(fs.readFileSync(movedFile, 'utf8'), before);
});

test('settle: an existing 0.7 project folder is kept, and the record moves into it', async t => {
  const w = world(t);
  const projectFolder = path.dirname(w.dirs.base);
  fs.mkdirSync(path.join(projectFolder, 'items'), { recursive: true, mode: 0o700 });
  seedLegacy(w);
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'moved');
  assert.deepEqual(fs.readdirSync(projectFolder).sort(), ['harness', 'items']);
});

test('settle: both records present is refused with HARNESS_STATE_TWO_RECORDS, and nothing changes', async t => {
  const w = world(t);
  seedLegacy(w);
  fs.mkdirSync(w.dirs.portable, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(w.dirs.portable, 'receipt.json'), 'new\n', { mode: 0o600 });
  const legacyBefore = files(w.dirs.legacy), baseBefore = files(w.dirs.base);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), e => e.code === 'HARNESS_STATE_TWO_RECORDS' && !e.message.includes(w.base));
  assert.deepEqual(files(w.dirs.legacy), legacyBefore);
  assert.deepEqual(files(w.dirs.base), baseBefore);
  // An empty new folder is a record too: the refusal never guesses which one is real.
  fs.rmSync(w.dirs.base, { recursive: true }); fs.mkdirSync(w.dirs.base, { mode: 0o700 });
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('HARNESS_STATE_TWO_RECORDS'));
});

// ---- settle: a crash -----------------------------------------------------------------------------------------------------

test('settle: a crash between the rename and moved.json is finished by the next call', async t => {
  const w = world(t);
  seedLegacy(w);
  const crash = new Error('simulated crash');
  await assert.rejects(settleLegacyStateWith(w.dirs, w.dir, undefined, { afterRename: () => { throw crash; } }), e => e === crash);
  assert.equal(fs.existsSync(w.dirs.legacy), false);
  assert.equal(fs.existsSync(path.join(w.dirs.base, 'moved.json')), false);
  // The next call is not a refusal and not a fresh record: it finishes the move.
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'completed');
  assert.deepEqual(fs.readdirSync(w.dirs.base).sort(), ['adoption', 'moved.json', 'portable']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.dirs.base, 'moved.json'), 'utf8')).from, `desktop/${legacyKey(w.dir)}`);
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
});

test('settle: a crash before the rename leaves the old record, and the next call moves it', async t => {
  const w = world(t);
  seedLegacy(w);
  const crash = new Error('simulated crash');
  await assert.rejects(settleLegacyStateWith(w.dirs, w.dir, undefined, { beforeRename: () => { throw crash; } }), e => e === crash);
  assert.equal(fs.existsSync(w.dirs.base), false);
  assert.ok(fs.existsSync(path.join(w.dirs.legacy, 'portable', 'receipt.json')));
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'moved');
  assert.deepEqual(fs.readdirSync(w.dirs.base).sort(), ['adoption', 'moved.json', 'portable']);
});

test('settle: a crash after moved.json, before the marker goes, is tidied by the next call', async t => {
  const w = world(t);
  seedLegacy(w);
  const crash = new Error('simulated crash');
  await assert.rejects(settleLegacyStateWith(w.dirs, w.dir, undefined, { afterRecord: () => { throw crash; } }), e => e === crash);
  assert.ok(fs.existsSync(path.join(w.dirs.base, 'moved.json')));
  const before = fs.readFileSync(path.join(w.dirs.base, 'moved.json'), 'utf8');
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'completed');
  assert.deepEqual(fs.readdirSync(w.dirs.base).sort(), ['adoption', 'moved.json', 'portable']);
  assert.equal(fs.readFileSync(path.join(w.dirs.base, 'moved.json'), 'utf8'), before);
});

test('settle: a damaged move marker is refused, not trusted', async t => {
  const w = world(t);
  seedLegacy(w);
  await assert.rejects(settleLegacyStateWith(w.dirs, w.dir, undefined, { afterRename: () => { throw new Error('crash'); } }));
  const marker = fs.readdirSync(w.dirs.base).find(n => n !== 'adoption' && n !== 'portable');
  assert.ok(marker);
  fs.writeFileSync(path.join(w.dirs.base, marker), '{"format":"x"}\n', { mode: 0o600 });
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_INVALID'));
  const record = { format: 'bowerloom/harness-state-moving/v1', projectDir: '/elsewhere', from: `desktop/${legacyKey(w.dir)}` };
  fs.writeFileSync(path.join(w.dirs.base, marker), JSON.stringify(record), { mode: 0o600 });
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_FOREIGN'));
});

// ---- settle: links, owners, modes ----------------------------------------------------------------------------------------

test('settle: a link at the old record, the new record, the project folder, or desktop/ is refused, and nothing moves', async t => {
  const w = world(t);
  const elsewhere = path.join(w.base, 'elsewhere'); fs.mkdirSync(elsewhere, { mode: 0o700 });
  // The old record is a link.
  fs.mkdirSync(path.dirname(w.dirs.legacy), { recursive: true, mode: 0o700 });
  fs.symlinkSync(elsewhere, w.dirs.legacy);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.equal(fs.existsSync(w.dirs.base), false);
  fs.unlinkSync(w.dirs.legacy);
  // desktop/ is a link.
  fs.rmSync(path.dirname(w.dirs.legacy), { recursive: true });
  const fakeDesktop = path.join(w.base, 'fake-desktop'); fs.mkdirSync(path.join(fakeDesktop, legacyKey(w.dir)), { recursive: true, mode: 0o700 });
  fs.symlinkSync(fakeDesktop, path.dirname(w.dirs.legacy));
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.ok(fs.existsSync(path.join(fakeDesktop, legacyKey(w.dir))));
  fs.unlinkSync(path.dirname(w.dirs.legacy));
  // The new record is a link.
  fs.mkdirSync(path.dirname(w.dirs.base), { recursive: true, mode: 0o700 });
  fs.symlinkSync(elsewhere, w.dirs.base);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  fs.unlinkSync(w.dirs.base); fs.rmdirSync(path.dirname(w.dirs.base));
  // The project folder above it is a link.
  fs.symlinkSync(elsewhere, path.dirname(w.dirs.base));
  seedLegacy(w);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.ok(fs.existsSync(w.dirs.legacy));
});

test('settle: an old record that is open to others, or not a folder, is refused', async t => {
  const w = world(t);
  seedLegacy(w);
  fs.chmodSync(w.dirs.legacy, 0o755);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.ok(fs.existsSync(w.dirs.legacy));
  fs.rmSync(w.dirs.legacy, { recursive: true });
  fs.writeFileSync(w.dirs.legacy, 'not a folder\n', { mode: 0o600 });
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
});

test('settle: a state root that others can write is refused', async t => {
  const w = world(t);
  seedLegacy(w);
  fs.chmodSync(w.stateRoot, 0o777);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.ok(fs.existsSync(w.dirs.legacy));
});

test('settle: an old record of another owner is refused', async t => {
  const w = world(t);
  seedLegacy(w);
  const real = process.getuid();
  // Every folder now reads as another user's.
  t.mock.method(process, 'getuid', () => real + 1);
  await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  t.mock.restoreAll();
  assert.ok(fs.existsSync(w.dirs.legacy));
});

test('settle: a state root inside the project is refused', async t => {
  const w = world(t);
  const inside = path.join(w.dir, 'state'); fs.mkdirSync(inside, { mode: 0o700 });
  const dirs = harnessStateDirs(inside, w.dir);
  await assert.rejects(settleLegacyState(dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
});

test('settle: layout folders of another project are refused', async t => {
  const w = world(t);
  const other = path.join(w.base, 'other'); fs.mkdirSync(other, { mode: 0o755 });
  await assert.rejects(settleLegacyState(harnessStateDirs(w.stateRoot, other), w.dir), code('PORTABLE_USAGE'));
  await assert.rejects(settleLegacyState({ ...w.dirs, legacy: path.join(w.base, 'x') }, w.dir), code('PORTABLE_USAGE'));
});

test('settle: the move runs under the project lock', async t => {
  const w = world(t);
  seedLegacy(w);
  const { withProjectLock } = await import('../../../dist/packages/project-context/src/index.js');
  await withProjectLock(w.dir, new AbortController().signal, async () => {
    await assert.rejects(settleLegacyState(w.dirs, w.dir), code('PROJECT_LOCKED'));
  });
  assert.ok(fs.existsSync(w.dirs.legacy));
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'moved');
});

test('settle: an aborted signal moves nothing', async t => {
  const w = world(t);
  seedLegacy(w);
  const c = new AbortController(); c.abort();
  await assert.rejects(settleLegacyState(w.dirs, w.dir, c.signal), code('PROJECT_LOCKED'));
  assert.ok(fs.existsSync(w.dirs.legacy));
});
