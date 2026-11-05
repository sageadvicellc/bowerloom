// Export and import in main, part two: the checks on every argument, the plan the write must name, the notes choices, the bundles held, a stopped save, a write that
// fails, a worker that stops, and the folder chooser that registers nothing the window did not accept. Real packages and the real worker thread; made-up values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { harnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { ENGINE_CHANNELS } from '../shared/engine/types.js';
import { filesOf } from './helpers-engine/folders.js';
import { NO_CHOICES, codeOf, emptyHarnessFolder, plainFolder, put, quietFolder, refused, richFolder, shareSetup, value } from './helpers-engine/share.js';
import type { Share } from './helpers-engine/share.js';
import { tempDir } from './support.js';

async function exportTo(a: Share, dir: string, file: string): Promise<string> {
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  a.save = join(a.base, file);
  value(await a.service.runExport(f.id, plan.revision, plan.acknowledge));
  return a.save;
}
/** Two apps; a bundle of `source` is open in `b`, and a plain folder is chosen there. */
async function pair(t: test.TestContext, name: string, source: (home: string) => string = quietFolder): Promise<{ a: Share; b: Share; file: string; folderId: string; dir: string; bundleId: string }> {
  const a = shareSetup(t, `${name}-a`), b = shareSetup(t, `${name}-b`);
  const file = await exportTo(a, source(a.home), 'one.bowerloom.json');
  b.open = file;
  const dir = plainFolder(b.home, 'target');
  const f = await b.choose(dir);
  const bundle = value(await b.service.chooseBundle());
  return { a, b, file, folderId: f.id, dir, bundleId: bundle.bundleId };
}

// ---- arguments ------------------------------------------------------------------------------------------------------------------

test('every share call checks its arguments before it looks anything up: a wrong type, a malformed id, a revision that is not 64 lowercase hex, an acknowledgement that is neither null nor hex', async t => {
  const { b, folderId, bundleId } = await pair(t, 'args');
  const s = b.service;
  const hex = 'a'.repeat(64);
  assert.equal(await codeOf(() => s.planExport(7)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => s.planExport('folder-999')), 'UNKNOWN_FOLDER');
  assert.equal(await codeOf(() => s.runExport(folderId, 'A'.repeat(64), null)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => s.runExport(folderId, hex, 'abc')), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => s.runExport(folderId, hex, undefined)), 'BAD_ARGUMENT');
  for (const id of [7, null, undefined, 'bundle-', 'bundle-1234567', 'folder-1', ' bundle-1', 'bundle-1 ', 'bundle-1\n', '../bundle-1']) {
    assert.equal(await codeOf(() => s.planImport(folderId, id, NO_CHOICES)), 'BAD_ARGUMENT', String(id));
    assert.equal(await codeOf(() => s.discardBundle(id)), 'BAD_ARGUMENT', String(id));
  }
  assert.equal(await codeOf(() => s.planImport(folderId, 'bundle-9', NO_CHOICES)), 'UNKNOWN_BUNDLE');
  assert.equal(await codeOf(() => s.planImport(folderId, 'bundle-0' + bundleId.slice(7), NO_CHOICES)), 'UNKNOWN_BUNDLE', 'bundle-01 is well formed and names nothing: it is not bundle-1');
  assert.equal(await codeOf(() => s.runImport(folderId, 'xyz', bundleId, NO_CHOICES, null)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => s.runImport(folderId, hex, bundleId, NO_CHOICES, undefined)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => s.runImport(folderId, hex, bundleId, NO_CHOICES, 'F'.repeat(64))), 'BAD_ARGUMENT');
  for (const choices of [null, undefined, 3, 'x', [], { link: {} }, { leave: [] }, { link: {}, leave: [], extra: 1 }, { link: [], leave: [] }, { link: {}, leave: 'x' }, { link: null, leave: [] }, { link: {}, leave: [1] }]) {
    assert.equal(await codeOf(() => s.planImport(folderId, bundleId, choices)), 'BAD_ARGUMENT', JSON.stringify(choices));
  }
  assert.equal(await codeOf(() => s.runImport(folderId, hex, bundleId, { link: {}, leave: ['nothing'] }, null)), 'BAD_ARGUMENT', 'a name the bundle does not hold');
});

// ---- the plan a write must name -------------------------------------------------------------------------------------------------

test('a write names the plan shown last: another revision, folder, bundle or choices is NOT_THE_PLAN_SHOWN, and nothing is written', async t => {
  const { a, b, folderId, dir, bundleId } = await pair(t, 'plan-bound');
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  const other = await b.choose(plainFolder(b.home, 'second'));
  const before = filesOf(b.base);
  const code = async (run: Promise<unknown>): Promise<string> => refused((await run) as never).code;
  assert.equal(await code(b.service.runImport(folderId, 'b'.repeat(64), bundleId, NO_CHOICES, null)), 'NOT_THE_PLAN_SHOWN');
  // Another folder holds no plan of its own.
  assert.equal(await code(b.service.runImport(other.id, plan.revision, bundleId, NO_CHOICES, null)), 'NOT_THE_PLAN_SHOWN');
  // Another bundle (a different file) with the same revision and choices.
  const f2 = await exportTo(a, richFolder(a.home, 'other-yard'), 'two.bowerloom.json');
  b.open = f2;
  const second = value(await b.service.chooseBundle());
  assert.equal(await code(b.service.runImport(folderId, plan.revision, second.bundleId, NO_CHOICES, null)), 'NOT_THE_PLAN_SHOWN');
  // The same bundle with other choices (a name that is in neither list is the same as leave, but the plan shown names its own lists).
  assert.equal(b.asks.length, 0, 'no question for a plan that is not the one shown');
  assert.deepEqual(filesOf(b.base), before);
  assert.equal(existsSync(join(dir, '.bowerloom')), false);
  // The plan is still the one shown: its own write goes.
  value(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, null));
  assert.equal(b.asks.length, 1);
});

test('a plan for a folder with no harness is no longer the plan once a harness appears there: NOT_THE_PLAN_SHOWN, and the harness stays as it is', async t => {
  const { b, folderId, dir, bundleId } = await pair(t, 'plan-appears');
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  assert.equal(plan.makesHarness, true);
  emptyHarnessFolder(b.home, 'target');
  const harness = readFileSync(join(dir, '.bowerloom', 'harness.json'), 'utf8');
  assert.equal(refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge)).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(readFileSync(join(dir, '.bowerloom', 'harness.json'), 'utf8'), harness);
  assert.deepEqual(readdirSync(join(dir, '.bowerloom')), ['harness.json']);
  // Planning again is a plan for an empty harness: harness.json is an update.
  const again = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  assert.equal(again.makesHarness, false);
  assert.notEqual(again.revision, plan.revision, 'the folder\'s harness state is part of the revision');
});

test('a cancelled question writes nothing and keeps the plan; a harness with parts made since the plan is refused at the write', async t => {
  const { b, folderId, dir, bundleId } = await pair(t, 'cancel');
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  b.yes = false;
  assert.equal(refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge)).code, 'CANCELLED');
  assert.equal(existsSync(join(dir, '.bowerloom')), false);
  b.yes = true;
  // A folder changed between the plan and the write: the empty harness is made by someone else with a part.
  quietFolder(b.home, 'target');
  const r = refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(r.code, 'IMPORT_FOLDER_HAS_HARNESS');
  assert.equal(refused(await b.service.planImport(folderId, bundleId, NO_CHOICES)).code, 'IMPORT_FOLDER_HAS_HARNESS');
});

test('files that can run need the acknowledgement of the plan, checked by main before any question; a wrong one never goes', async t => {
  const { a, b } = await pair(t, 'ack', richFolder);
  void a;
  const f = (await b.service.folders())[0]!;
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  assert.equal(plan.copiedExecutables.length, 2);
  for (const wrong of [null, 'c'.repeat(64)]) {
    assert.equal(refused(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, wrong)).code, 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
  }
  assert.equal(b.asks.length, 0);
  value(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(b.asks.length, 1);
  assert.match(b.asks[0]!.detail, /These files can run as programs: .*scripts\/format-check\.sh/);
});

// ---- notes ----------------------------------------------------------------------------------------------------------------------

test('notes names: left out by default, linked by a notes id main gave out, or left out by name; a name is an untrusted key', async t => {
  const a = shareSetup(t, 'notes-a'), b = shareSetup(t, 'notes-b');
  const source = richFolder(a.home, 'rope-yard', {
    '.bowerloom/knowledge.json': JSON.stringify({ sources: [{ kind: 'wiki-folder', name: 'yard-wiki', path: '~/Documents/yard-wiki' }, { kind: 'wiki-folder', name: 'constructor', path: '~/Documents/other' }] }),
    '.bowerloom/agents/counter.md': '---\nname: counter\ndescription: Counts the stock.\nskills:\n  - tally-stock\nnotes:\n  - constructor\n---\n\nCount the stock.\n',
  });
  b.open = await exportTo(a, source, 'n.bowerloom.json');
  const f = await b.choose(plainFolder(b.home, 'notes-target'));
  const bundle = value(await b.service.chooseBundle());
  assert.deepEqual(bundle.summary.notes.rows.map(n => n.name).sort(), ['constructor', 'yard-wiki']);

  const notesDir = join(b.home, 'Documents', 'yard-wiki');
  put(notesDir, 'index.md', '# Yard\n');
  b.notes = notesDir;
  const notes = value(await b.service.chooseNotesFolder('use'));
  // Default: both names are left out.
  const plain = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  assert.deepEqual(plain.notes.map(n => n.choice), ['leave', 'leave']);
  assert.equal(plain.definition.sources.length, 0);
  // A link to the chosen folder; the other name is named in `leave`.
  const choices = { link: { 'yard-wiki': notes.id }, leave: ['constructor'] };
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, choices));
  const row = plan.notes.find(n => n.name === 'yard-wiki')!;
  assert.deepEqual([row.choice, row.label], ['link', '~/Documents/yard-wiki']);
  assert.deepEqual(plan.definition.sources.map(s => s.name), ['yard-wiki']);
  assert.equal(JSON.stringify(plan).includes(b.home), false);
  // The write must name the very choices shown.
  assert.equal(refused(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge)).code, 'NOT_THE_PLAN_SHOWN');
  value(await b.service.runImport(f.id, plan.revision, bundle.bundleId, choices, plan.acknowledge));
  const dir = join(b.home, 'Projects', 'notes-target', '.bowerloom');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'knowledge.json'), 'utf8')), { sources: [{ kind: 'wiki-folder', name: 'yard-wiki', path: '~/Documents/yard-wiki' }] });
  assert.match(readFileSync(join(dir, 'agents', 'clerk.md'), 'utf8'), /yard-wiki/);
  assert.equal(readFileSync(join(dir, 'agents', 'counter.md'), 'utf8').includes('constructor'), false, 'a name left out leaves every agent');
  assert.equal(loadDefinition(dir).ok, true);

  // Bad choices are BAD_ARGUMENT before anything is looked up.
  const bad = [
    { link: { 'not-there': notes.id }, leave: [] }, { link: { 'yard-wiki': 'notes-999' }, leave: [] }, { link: { 'yard-wiki': notes.id }, leave: ['yard-wiki'] },
    { link: {}, leave: ['yard-wiki', 'yard-wiki'] }, { link: JSON.parse('{"__proto__":"notes-1"}') as Record<string, string>, leave: [] }, { link: { 'yard-wiki': 7 }, leave: [] },
    { link: { 'yard-wiki': folderLikeId() }, leave: [] }, { link: {}, leave: ['x'.repeat(201)] },
  ];
  for (const c of bad) assert.equal(await codeOf(() => b.service.planImport(f.id, bundle.bundleId, c as never)), 'BAD_ARGUMENT', JSON.stringify(c));
});
const folderLikeId = (): string => 'folder-1';

// ---- bundles held, hostile files ------------------------------------------------------------------------------------------------

test('main holds two bundles: a third drops the oldest; discard drops one; the window never learns a path', async t => {
  const { a, b } = await pair(t, 'held');
  const f = (await b.service.folders())[0]!;
  const first = value(await b.service.chooseBundle());
  const second = value(await b.service.chooseBundle());
  b.open = await exportTo(a, richFolder(a.home, 'third-yard'), 'three.bowerloom.json');
  const third = value(await b.service.chooseBundle());
  assert.equal(await codeOf(() => b.service.planImport(f.id, first.bundleId, NO_CHOICES)), 'UNKNOWN_BUNDLE');
  value(await b.service.planImport(f.id, second.bundleId, NO_CHOICES));
  value(await b.service.planImport(f.id, third.bundleId, NO_CHOICES));
  assert.equal(await b.service.discardBundle(second.bundleId), true);
  assert.equal(await b.service.discardBundle(second.bundleId), false);
  assert.equal(await codeOf(() => b.service.planImport(f.id, second.bundleId, NO_CHOICES)), 'UNKNOWN_BUNDLE');
  assert.equal(JSON.stringify([first, second, third]).includes(b.base), false);
  // A closed dialog is no answer.
  b.open = null;
  assert.equal(await b.service.chooseBundle(), null);
});

test('a file that fails a check is a refusal in the package\'s words, nothing is held, and nothing is written in either home', async t => {
  const { a, b, file } = await pair(t, 'hostile');
  const f = (await b.service.folders())[0]!;
  const good = JSON.parse(readFileSync(file, 'utf8')) as { files: { path: string }[]; format: string };
  const forge = (name: string, change: (envelope: typeof good) => unknown): string => {
    const copy = structuredClone(good);
    const out = change(copy);
    put(b.base, name, typeof out === 'string' ? out : JSON.stringify(copy, null, 2));
    return join(b.base, name);
  };
  const before = filesOf(b.base);
  const cases: [string, string, string][] = [
    ['traversal', forge('t1.json', e => { e.files[0]!.path = '../outside.md'; return e; }), 'BUNDLE_PATH_UNSAFE'],
    ['hidden folder', forge('t2.json', e => { e.files[0]!.path = '.git/config'; return e; }), 'BUNDLE_PATH_UNSAFE'],
    ['wrong format', forge('t3.json', e => { e.format = 'bowerloom/harness-bundle/v1beta2'; return e; }), 'BUNDLE_FORMAT'],
    ['not json', forge('t4.json', () => 'this is a note, not a bundle\n'), 'BUNDLE_FORMAT'],
    ['empty', forge('t5.json', () => ''), 'BUNDLE_FORMAT'],
    ['extra key', forge('t6.json', e => { (e.files[0] as Record<string, unknown>).type = 'symlink'; return e; }), 'BUNDLE_FORMAT'],
  ];
  for (const [name, path, code] of cases) {
    b.open = path;
    const r = refused(await b.service.chooseBundle());
    assert.equal(r.code, code, name);
    assert.equal(JSON.stringify(r).includes(b.base), false, `${name}: no path in the refusal`);
  }
  // A link to a valid bundle is not read.
  symlinkSync(file, join(b.base, 'link.json'));
  b.open = join(b.base, 'link.json');
  assert.equal(refused(await b.service.chooseBundle()).code, 'BUNDLE_FILE_UNSAFE');
  // A folder, a missing file, and a file over the size cap (a sparse file: refused before it is read).
  b.open = b.base;
  assert.equal(refused(await b.service.chooseBundle()).code, 'BUNDLE_FILE_UNSAFE');
  b.open = join(b.base, 'missing.json');
  assert.equal(refused(await b.service.chooseBundle()).code === undefined, false);
  writeFileSync(join(b.base, 'big.json'), '');
  truncateSync(join(b.base, 'big.json'), 49 * 1024 * 1024);
  b.open = join(b.base, 'big.json');
  assert.equal(refused(await b.service.chooseBundle()).code, 'BUNDLE_TOO_LARGE');
  // Nothing new was held, so no import can name a bundle beyond the one of this test's set-up.
  for (let n = 2; n <= 14; n += 1) assert.equal(await codeOf(() => b.service.planImport(f.id, `bundle-${n}`, NO_CHOICES)), 'UNKNOWN_BUNDLE', `bundle-${n}`);
  const names = Object.keys(before);
  assert.deepEqual(Object.keys(filesOf(b.base)).filter(k => !names.includes(k) && !/^(t\d|link|big)\.json$/.test(k)), [], 'only the forged files of this test are new');
  assert.equal(existsSync(join(b.home, 'Projects', 'target', '.bowerloom')), false);
  assert.equal(a.records.length > 0, true);
});

// ---- a stopped save, a write that fails ---------------------------------------------------------------------------------------------

test('a stopped save blocks the plan and the write of an import (SAVE_RECOVERY_REQUIRED)', async t => {
  const { b, folderId, dir, bundleId } = await pair(t, 'stopped');
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  const dirs = harnessStateDirs(join(b.home, '.local', 'state', 'bowerloom'), dir);
  mkdirSync(dirs.adoption, { recursive: true, mode: 0o700 });
  writeFileSync(join(dirs.adoption, 'save-pending.json'), '{}', { mode: 0o600 });
  assert.equal(refused(await b.service.planImport(folderId, bundleId, NO_CHOICES)).code, 'SAVE_RECOVERY_REQUIRED');
  assert.equal(refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge)).code, 'SAVE_RECOVERY_REQUIRED');
  assert.equal(b.asks.length, 0);
  assert.equal(existsSync(join(dir, '.bowerloom')), false);
});

test('a folder whose .bowerloom holds something that is not a harness part is refused at the plan, and nothing is made', async t => {
  const { b, folderId, dir, bundleId } = await pair(t, 'occupied');
  put(dir, '.bowerloom/notes-of-mine.txt', 'my own file\n');
  const r = refused(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  assert.equal(r.code, 'SAVE_PATH_UNSAFE');
  assert.deepEqual(readdirSync(join(dir, '.bowerloom')), ['notes-of-mine.txt']);
});

/**
 * The work of an import run here, without a worker thread, so a test can make the save fail at the exact step after the empty harness exists. The state folder of the
 * folder is the one the service uses.
 */
async function inProcess(t: test.TestContext, name: string, key: string): Promise<{ b: Share; dir: string; dirs: ReturnType<typeof harnessStateDirs>; io: { projectDir: string; adoptState: string }; choices: { link: Map<string, string>; leave: Set<string> }; work: typeof import('../main/engine-bundle-work.js'); plan: { revision: string; acknowledge: string | null; makes: boolean } }> {
  const { b, file, dir } = await pair(t, name);
  const work = await import('../main/engine-bundle-work.js');
  const dirs = harnessStateDirs(join(b.home, '.local', 'state', 'bowerloom'), dir);
  const io = { projectDir: dir, adoptState: dirs.adoption };
  const choices = { link: new Map<string, string>(), leave: new Set<string>() };
  await work.run({ op: 'decode', key, bytes: readFileSync(file) });
  const plan = await work.run({ op: 'plan', key, choices, ...io }) as { revision: string; acknowledge: string | null; makes: boolean };
  assert.equal(plan.makes, true);
  return { b, dir, dirs, io, choices, work, plan };
}
const write = (x: Awaited<ReturnType<typeof inProcess>>, key: string, dirs = x.dirs): Promise<unknown> =>
  x.work.run({ op: 'write', key, choices: x.choices, revision: x.plan.revision, acknowledged: x.plan.acknowledge, dirs, now: '2026-10-31T12:00:00Z', ...x.io });
const failure = async (run: Promise<unknown>): Promise<{ code: string; message: string; paths: string[] }> => {
  try { await run; } catch (error) { return error as { code: string; message: string; paths: string[] }; }
  throw new Error('the write did not fail');
};

test('a write that fails after the empty harness was made leaves a valid empty harness and none of the files; the words say so; the folder can be imported into again', async t => {
  const x = await inProcess(t, 'fails', 'bundle-71');
  const f = (await x.b.service.folders())[0]!;
  // The save point store cannot be kept: its folder is a plain file. No permission trick, so it fails the same for any user.
  const notAFolder = join(x.b.base, 'store-is-a-file');
  writeFileSync(notAFolder, 'x');
  const error = await failure(write(x, 'bundle-71', { ...x.dirs, base: notAFolder }));
  assert.match(error.code, /^[A-Z][A-Z0-9_]{2,63}$/, 'a refusal with a code');
  assert.match(error.message, /No file of the bundle was written\. An empty harness was made in this folder first, and it stays\.$/);
  assert.doesNotMatch(error.message, /Nothing (more )?was (written|changed)/, 'the words are true of the folder');
  const loaded = loadDefinition(join(x.dir, '.bowerloom'));
  assert.equal(loaded.ok, true, 'the harness loads');
  if (loaded.ok) assert.deepEqual(loaded.definition.files.map(file => file.path), ['harness.json']);
  assert.deepEqual(readdirSync(join(x.dir, '.bowerloom')), ['harness.json']);
  assert.equal((await x.b.service.folders()).find(y => y.id === f.id)!.unfinished.adoption, false, 'no stopped run is left behind');
  const again = (await x.work.run({ op: 'plan', key: 'bundle-71', choices: x.choices, ...x.io })) as { makes: boolean; changes: { path: string; action: string }[] };
  assert.equal(again.makes, false);
  assert.equal(again.changes.find(c => c.path === 'harness.json')!.action, 'update');
});

test('the undo of the empty harness: when the file it made is not the file it wrote, SAVE_PARTIAL keeps the journal and the folder is recovered by "Finish a stopped harness"', async t => {
  const x = await inProcess(t, 'partial', 'bundle-72');
  const { emptyHarnessHooks } = x.work;
  // Someone changes the file just after it is placed, so the load fails and the undo finds bytes that are not its own.
  emptyHarnessHooks.afterPlace = () => { writeFileSync(join(x.dir, '.bowerloom', 'harness.json'), '{ not json', { mode: 0o644 }); };
  t.after(() => { delete emptyHarnessHooks.afterPlace; });
  const error = await failure(write(x, 'bundle-72'));
  delete emptyHarnessHooks.afterPlace;
  assert.equal(error.code, 'SAVE_PARTIAL');
  assert.deepEqual(error.paths, ['.bowerloom/harness.json']);
  const f = (await x.b.service.folders())[0]!;
  assert.equal(f.unfinished.adoption, true, 'the journal stays: the folder is a stopped run');
  assert.equal(refused(await x.b.service.planImport(f.id, 'bundle-1', NO_CHOICES)).code, 'ADOPTION_RECOVERY_REQUIRED');
  // The recovery plan lists the file and puts the folder back.
  const plan = value(await x.b.service.planAdoptionRecovery(f.id));
  const done = value(await x.b.service.runAdoptionRecovery(f.id, plan.revision));
  assert.ok(done);
  assert.equal((await x.b.service.folders())[0]!.unfinished.adoption, false);
});

test('a stopped run that appears after main looked is found inside the lock: the empty harness is not made, and the other run\'s journal is not overwritten or removed', async t => {
  const x = await inProcess(t, 'foreign', 'bundle-73');
  mkdirSync(x.dirs.adoption, { recursive: true, mode: 0o700 });
  const journal = join(x.dirs.adoption, 'adoption-pending.json');
  const mine = '{"foreign":"journal of another run"}';
  writeFileSync(journal, mine, { mode: 0o600 });
  const error = await failure(write(x, 'bundle-73'));
  assert.equal(error.code, 'ADOPTION_RECOVERY_REQUIRED');
  assert.equal(readFileSync(journal, 'utf8'), mine, 'the journal of the other run is as it was');
  assert.equal(existsSync(join(x.dir, '.bowerloom')), false, 'nothing was made');
});

// ---- the usage log --------------------------------------------------------------------------------------------------------------

test('the usage log gets the step and the code only: no harness id, file name, tool name or path', async t => {
  const { a, b, folderId, bundleId } = await pair(t, 'log', richFolder);
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  assert.equal(refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, null)).code, 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
  value(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge));
  const text = JSON.stringify([...a.records, ...b.records]);
  for (const word of ['rope-yard', 'out.bowerloom', 'one.bowerloom', 'stock-db', 'orders-api', 'format-check', 'ORDERS_KEY', a.base, b.base]) assert.equal(text.includes(word), false, word);
  assert.ok(b.records.some(r => r.step === 'import' && r.outcome === 'done'));
  assert.ok(a.records.some(r => r.step === 'export' && r.outcome === 'done'));
});

// ---- the worker -----------------------------------------------------------------------------------------------------------------

test('a worker that stops, cannot start, answers nothing in time or fails is a refusal in words, never a crash; the service goes on', async t => {
  const dir = tempDir(t, 'bowerloom-worker-');
  const quit = join(dir, 'quit.mjs'), hang = join(dir, 'hang.mjs'), boom = join(dir, 'boom.mjs');
  writeFileSync(quit, 'process.exit(3);\n');
  writeFileSync(hang, "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', () => {});\n");
  writeFileSync(boom, "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', ({ id }) => { parentPort.postMessage({ id, ok: false, refusal: { kind: 'bug' } }); });\n");
  for (const [name, file, words] of [['quit', quit, /part of Bowerloom that reads harness files stopped/], ['missing', join(dir, 'missing.mjs'), /could not start the part that reads harness files/], ['boom', boom, /could not finish this/]] as const) {
    const a = shareSetup(t, `worker-${name}`, { bundleWorker: () => file });
    const f = await a.choose(richFolder(a.home));
    const began = Date.now();
    const r = refused(await a.service.planExport(f.id));
    assert.equal(r.code, 'FAILED', name);
    assert.match(r.message, words, name);
    assert.ok(Date.now() - began < 10_000, name);
    assert.equal((await a.service.folders()).length, 1, `${name}: the service goes on`);
  }
  const slow = shareSetup(t, 'worker-hang', { bundleWorker: () => hang, bundleTimeoutMs: 300 });
  const f = await slow.choose(richFolder(slow.home));
  const r = refused(await slow.service.planExport(f.id));
  assert.equal(r.code, 'FAILED');
  assert.match(r.message, /longer than Bowerloom allows/);
});

test('a worker that restarts has lost the bundles it held: UNKNOWN_BUNDLE, and a new choice works again', async t => {
  const { b, folderId, bundleId } = await pair(t, 'restart');
  value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  b.service.close();
  assert.equal(await codeOf(() => b.service.planImport(folderId, bundleId, NO_CHOICES)), 'UNKNOWN_BUNDLE');
  const again = value(await b.service.chooseBundle());
  assert.notEqual(again.bundleId, bundleId);
  value(await b.service.planImport(folderId, again.bundleId, NO_CHOICES));
});

// ---- the folder chooser ---------------------------------------------------------------------------------------------------------

test('chooseFolder with the label the window wants: another folder is refused before main registers it, so folders() never lists it', async t => {
  const a = shareSetup(t, 'choose');
  const wanted = plainFolder(a.home, 'wanted'), other = plainFolder(a.home, 'other');
  a.folder = other;
  const r = refused(await a.service.chooseFolder('~/Projects/wanted'));
  assert.equal(r.code, 'NOT_THE_FOLDER_SHOWN');
  assert.deepEqual(await a.service.folders(), [], 'a refused pick stays out of folders()');
  a.folder = wanted;
  const ok = value(await a.service.chooseFolder('~/Projects/wanted'));
  assert.equal(ok.label, '~/Projects/wanted');
  assert.equal((await a.service.folders()).length, 1);
  // No label: any folder is taken, as before. A closed chooser is null. A label that is not text is BAD_ARGUMENT before the chooser opens.
  a.folder = other;
  assert.equal(value(await a.service.chooseFolder()).label, '~/Projects/other');
  a.folder = null;
  assert.equal(await a.service.chooseFolder('~/Projects/wanted'), null);
  for (const label of [3, '', null, {}, 'x'.repeat(5000), 'a\u0000b']) assert.equal(await codeOf(() => a.service.chooseFolder(label)), 'BAD_ARGUMENT', String(label));
});

test('the channel of chooseFolder takes the one optional argument and no more; every other call keeps its count', async () => {
  const handlers = new Map<string, (event: RealEvent, ...args: unknown[]) => unknown>();
  registerEngineIpc({ ipc: { handle: (c, l) => { handlers.set(c, l); } }, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom', chooseFolder: async () => null, confirm: async () => false, who: 't' });
  const page: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };
  const reason = async (channel: string, ...args: unknown[]): Promise<string> => { try { await handlers.get(channel)!(page, ...args); return 'ok'; } catch (e) { return (e as Error).message; } };
  assert.equal(await reason(ENGINE_CHANNELS.chooseFolder), 'ok');
  assert.equal(await reason(ENGINE_CHANNELS.chooseFolder, '~/Projects/x'), 'ok');
  assert.equal(await reason(ENGINE_CHANNELS.chooseFolder, 'a', 'b'), 'BAD_ARGUMENT');
  assert.equal(await reason(ENGINE_CHANNELS.chooseBundle, 'x'), 'BAD_ARGUMENT');
  assert.equal(await reason(ENGINE_CHANNELS.planImport, 'folder-1', 'bundle-1'), 'BAD_ARGUMENT');
  assert.equal(await reason(ENGINE_CHANNELS.planImport, 'folder-1', 'bundle-1', { link: {}, leave: [] }), 'UNKNOWN_FOLDER');
});

// ---- order of checks, parity with the sample, timeouts and quit --------------------------------------------------------------

test('every argument is checked in shape before any lookup: a bad later argument is BAD_ARGUMENT even when the folder or the bundle is unknown', async t => {
  const { b, folderId, bundleId } = await pair(t, 'order');
  const hex = 'a'.repeat(64);
  assert.equal(await codeOf(() => b.service.runImport('folder-999', 'xyz', bundleId, NO_CHOICES, null)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => b.service.runImport(folderId, hex, 'bundle-99', { link: {}, leave: 'x' }, null)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => b.service.runImport(folderId, hex, 'bundle-99', NO_CHOICES, 'nope')), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => b.service.planImport('folder-999', 'bundle-99', null)), 'BAD_ARGUMENT');
  assert.equal(await codeOf(() => b.service.runExport('folder-999', hex, 'nope')), 'BAD_ARGUMENT');
  // With every shape right, the lookups come: the folder, then the bundle.
  assert.equal(await codeOf(() => b.service.runImport('folder-999', hex, 'bundle-99', NO_CHOICES, null)), 'UNKNOWN_FOLDER');
  assert.equal(await codeOf(() => b.service.runImport(folderId, hex, 'bundle-99', NO_CHOICES, null)), 'UNKNOWN_BUNDLE');
});

test('an acknowledgement for a plan that asked for none is refused like the sample refuses it (IMPORT_NEEDS_ACKNOWLEDGEMENT), before any question', async t => {
  const { b, folderId, bundleId } = await pair(t, 'ack-extra');
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  assert.equal(plan.acknowledge, null);
  assert.equal(refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, 'd'.repeat(64))).code, 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(b.asks.length, 0);
  value(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, null));
});

test('a stale plan and an unticked plan leave no line in the usage log; a done import and a refused one do', async t => {
  const { b, folderId, bundleId } = await pair(t, 'log-stale', richFolder);
  const plan = value(await b.service.planImport(folderId, bundleId, NO_CHOICES));
  refused(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, null));
  refused(await b.service.runImport(folderId, 'e'.repeat(64), bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(b.records.filter(r => r.step === 'import').length, 0);
  value(await b.service.runImport(folderId, plan.revision, bundleId, NO_CHOICES, plan.acknowledge));
  assert.deepEqual(b.records.filter(r => r.step === 'import').map(r => r.outcome), ['done']);
});

test('a bundle file whose read does not end in time is a refusal that frees the queue (here the limit is 1 ms and the file is 30 MiB)', async t => {
  const b = shareSetup(t, 'read-timeout', { bundleReadTimeoutMs: 1 });
  const big = join(b.base, 'big.json');
  writeFileSync(big, '');
  truncateSync(big, 30 * 1024 * 1024);
  b.open = big;
  const r = refused(await b.service.chooseBundle());
  assert.equal(r.code, 'FAILED');
  assert.equal(r.step, 'READ_TIMED_OUT');
  assert.match(r.message, /took longer than Bowerloom allows/);
  assert.deepEqual(await b.service.folders(), [], 'the queue answers the next call');
});

test('a write that outlives its limit is stopped in words that point to "Finish a stopped harness"; the bundle it held is gone; the next call has a new worker', async t => {
  const a = shareSetup(t, 'wtimeout-a'), b = shareSetup(t, 'wtimeout-b', { bundleWriteTimeoutMs: 1 });
  const file = await exportTo(a, richFolder(a.home), 'w.bowerloom.json');
  b.open = file;
  const f = await b.choose(plainFolder(b.home, 'target'));
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  const r = refused(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(r.code, 'FAILED');
  assert.equal(r.step, 'WORKER_TIMED_OUT');
  assert.match(r.message, /Finish a stopped harness/);
  assert.doesNotMatch(r.message, /Nothing was written/);
  // The worker that held the bundle is gone: the bundle is not held, and a new choice goes to a new worker.
  assert.equal(await codeOf(() => b.service.planImport(f.id, bundle.bundleId, NO_CHOICES)), 'UNKNOWN_BUNDLE');
  assert.equal(value(await b.service.chooseBundle()).summary.counts.files, bundle.summary.counts.files);
  assert.ok(b.records.some(x => x.step === 'bundle-worker-write' && x.code === 'WORKER_TIMED_OUT'), 'the usage log names the cause');
});

test('quit during a write: close() settles the call with a refusal and does not hang; a folder left half-made is recovered', async t => {
  const a = shareSetup(t, 'quit-a'), b = shareSetup(t, 'quit-b');
  b.open = await exportTo(a, richFolder(a.home), 'q.bowerloom.json');
  const f = await b.choose(plainFolder(b.home, 'target'));
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  // The yes arrives, the write starts, and the app quits a few milliseconds later.
  b.beforeYes = () => { setTimeout(() => { void b.service.close(); }, 30); };
  const began = Date.now();
  const r = await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge);
  assert.ok(Date.now() - began < 20_000, 'it settled');
  if (!r.ok) assert.match(r.refusal.message, /Finish a stopped harness|Nothing was written/);
  // Whatever state the folder is in, the service answers, and a stopped run is the recoverable kind.
  const info = (await b.service.folders())[0]!;
  if (info.unfinished.adoption) {
    const recovery = value(await b.service.planAdoptionRecovery(info.id));
    value(await b.service.runAdoptionRecovery(info.id, recovery.revision));
  }
});

test('the native question of an import names deletes as well as writes, and the harness made empty has the description the package counts as empty', async () => {
  const { ASK } = await import('../main/engine-consent.js');
  const { emptyHarnessFile } = await import('../main/engine-bundle-work.js');
  const { EMPTY_HARNESS_DESCRIPTION } = await import('../../../packages/harness-bundle/src/index.js');
  const rev = 'f'.repeat(64);
  assert.match(ASK.importBundle('~/x', 5, rev, { deletes: 2 }).message, /^Write 3 files and delete 2 files into ~\/x\/\.bowerloom\?$/);
  assert.match(ASK.importBundle('~/x', 1, rev, { deletes: 1 }).message, /^Delete 1 file in ~\/x\/\.bowerloom\?$/);
  assert.match(ASK.importBundle('~/x', 4, rev, {}, true).message, /^Make an empty harness and write 4 files into ~\/x\/\.bowerloom\?$/);
  assert.equal((JSON.parse(Buffer.from(emptyHarnessFile('/p/some-folder', ['claude-code']).bytes).toString('utf8')) as { description: string }).description, EMPTY_HARNESS_DESCRIPTION);
});
