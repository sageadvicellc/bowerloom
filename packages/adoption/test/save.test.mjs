// Save (0.8.0-beta.1, option C): a folder's whole target file set replaces its `.bowerloom` definition through a
// guarded, journaled write. Synthetic projects only: no private paths, no real rules, no real secrets.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { editDefinition, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import * as adoption from '../../../dist/packages/adoption/src/index.js';
import * as save from '../../../dist/packages/adoption/src/save.js';
import { JOURNAL, saveStopped as journalSaveStopped } from '../../../dist/packages/adoption/src/journal.js';
import { MERGE_JOURNAL, planInstructionMerge, refuseWhileStopped } from '../../../dist/packages/adoption/src/merge.js';
import { INSTRUCTIONS, json, project, skill } from '../../project-sync/test/portable-fixture.mjs';
import { code, snapshot } from './fixture.mjs';

const { SAVE_JOURNAL, SAVE_REFUSAL_CODES, planSaveRecovery, refuseWhileSaveStopped, runSaveRecovery, saveStopped } = save;
const signal = () => new AbortController().signal;
const crash = () => Object.assign(new Error('simulated crash'), { crash: true });
const HARNESS = { format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'A demo harness.' };

/** A defined project and the adoption state folder beside it. */
function saving(t, opts = {}) {
  const p = project(t, opts);
  const adoptState = path.join(p.base, 'state', 'adoption');
  return { ...p, adoptState, save: () => ({ projectDir: p.dir, stateDir: adoptState }) };
}
const journalAt = p => path.join(p.adoptState, SAVE_JOURNAL);
/**
 * The definition's own files, as a Map the tests edit: path relative to `.bowerloom`, to `{ bytes, executable }`. A test
 * sets plain bytes for a file that is not executable.
 */
function current(p) {
  const r = loadDefinition(p.def);
  assert.ok(r.ok, 'the fixture loads');
  return new Map(r.definition.files.map(f => [f.path, { bytes: Buffer.from(f.bytes), executable: f.executable === true }]));
}
const bytesOf = v => v instanceof Uint8Array ? v : v.bytes;
/** The target the save takes, a `DefinitionFile[]`, from a test Map. Anything else passes as it is, for the usage tests. */
const files = t => !(t instanceof Map) ? t : [...t].map(([p, v]) => v instanceof Uint8Array ? { path: p, bytes: v, executable: false }
  : v !== null && typeof v === 'object' && 'bytes' in v ? { path: p, ...v } : { path: p, bytes: v });
const planSave = (input, t) => save.planSave(input, files(t));
const applySave = (input, revision, t, s) => save.applySave(input, revision, files(t), s);
const applySaveWith = (input, revision, t, s, hooks) => save.applySaveWith(input, revision, files(t), s, hooks);
const modeOf = (p, rel) => fs.statSync(path.join(p.def, rel)).mode & 0o777;
/** The current harness.json, changed by `change`. */
function harnessWith(p, change) {
  const h = JSON.parse(fs.readFileSync(path.join(p.def, 'harness.json'), 'utf8'));
  change(h);
  return Buffer.from(json(h));
}
/** A target that updates the instructions, adds a skill, removes the review notes, and rewrites harness.json. */
function mixed(p) {
  const target = current(p);
  target.set('instructions/AGENTS.md', Buffer.from(`${INSTRUCTIONS}\nSaved from the editor.\n`));
  target.set('skills/lint/SKILL.md', Buffer.from(skill('lint')));
  target.delete('skills/review/references/notes.md');
  target.set('harness.json', harnessWith(p, h => { h.description = 'An edited harness.'; }));
  return target;
}
/** Hash and mode of every entry, without the time: what "put back byte for byte" compares. */
const content = dir => Object.fromEntries(Object.entries(snapshot(dir)).map(([k, v]) => [k, v.split(' ').slice(0, 2).join(' ')]));
const lockIsFree = dir => withProjectLock(dir, signal(), async () => 'free');

// ---- plan ----------------------------------------------------------------------------------------------------------------

test('the save plan lists every change, harness.json last, and writes nothing', t => {
  const p = saving(t);
  const before = snapshot(p.base);
  const plan = planSave(p.save(), mixed(p));
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(plan.writesAuthorized, false);
  assert.equal(plan.currentRevision, loadDefinition(p.def).definition.revision);
  assert.notEqual(plan.targetRevision, plan.currentRevision);
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]), [
    ['instructions/AGENTS.md', 'update'], ['skills/lint/SKILL.md', 'create'], ['skills/review/references/notes.md', 'delete'], ['harness.json', 'update'],
  ]);
  const del = plan.changes.find(c => c.action === 'delete');
  assert.equal(del.after, null); assert.equal(del.before.mode, 0o644);
  const created = plan.changes.find(c => c.action === 'create');
  assert.equal(created.before, null); assert.deepEqual(created.after.bytes, Buffer.byteLength(skill('lint')));
  assert.deepEqual(plan.emptied, ['skills/review/references']);
  assert.deepEqual(snapshot(p.base), before, 'nothing is written, not even the state folder');
  assert.equal(planSave(p.save(), mixed(p)).revision, plan.revision, 'the plan is stable');
});

test('a target equal to the definition plans no change, and its apply writes nothing', async t => {
  const p = saving(t);
  const plan = planSave(p.save(), current(p));
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.targetRevision, plan.currentRevision);
  const before = snapshot(p.base);
  const r = await applySave(p.save(), plan.revision, current(p));
  assert.deepEqual(r.written, []);
  assert.deepEqual(snapshot(p.base), before);
});

test('the target is the DefinitionFile list: a Map, a plain object, a duplicate path, or an odd entry is refused', t => {
  const p = saving(t);
  const target = mixed(p);
  assert.throws(() => save.planSave(p.save(), new Map([...target].map(([k, v]) => [k, bytesOf(v)]))), code('SAVE_USAGE'));
  assert.throws(() => save.planSave(p.save(), Object.fromEntries([...target].map(([k, v]) => [k, bytesOf(v)]))), code('SAVE_USAGE'));
  const list = files(target);
  assert.throws(() => save.planSave(p.save(), [...list, list[0]]), code('SAVE_USAGE'), 'a path named twice');
  assert.throws(() => save.planSave(p.save(), [...list.slice(1), { ...list[0], executable: 'yes' }]), code('SAVE_USAGE'));
  assert.throws(() => save.planSave(p.save(), [...list.slice(1), { ...list[0], sha256: 'x' }]), code('SAVE_USAGE'), 'a closed shape');
  const noFlag = list.map(({ executable: _e, ...f }) => f);
  assert.equal(save.planSave(p.save(), noFlag).revision, save.planSave(p.save(), list).revision, 'an absent executable means false');
});

test('the result of editDefinition saves as it is, and loads as the edit planned', async t => {
  const p = saving(t);
  const def = loadDefinition(p.def).definition;
  const edit = editDefinition(def, [{ kind: 'set-instructions', text: `${INSTRUCTIONS}\nAdded by an edit.\n` }, { kind: 'add-skill', id: 'lint', text: skill('lint') }]);
  assert.ok(edit.ok, JSON.stringify(edit));
  const plan = save.planSave(p.save(), edit.files);
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]).sort(), edit.changes.map(c => [c.path, c.kind]).sort());
  await save.applySave(p.save(), plan.revision, edit.files);
  assert.equal(loadDefinition(p.def).definition.revision, plan.targetRevision);
  for (const f of edit.files) assert.ok(fs.readFileSync(path.join(p.def, f.path)).equals(Buffer.from(f.bytes)), f.path);
});

// ---- apply ---------------------------------------------------------------------------------------------------------------

test('apply writes creates, updates, and deletes, harness.json last, then clears the journal and the lock', async t => {
  const p = saving(t);
  const untouched = snapshot(p.def)['skills/review/SKILL.md'];
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const order = [];
  const r = await applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: rel => order.push(rel) });
  assert.deepEqual(order, plan.changes.map(c => c.path));
  assert.equal(order.at(-1), 'harness.json', 'harness.json is written last');
  assert.deepEqual(r.written, order);
  assert.equal(r.planRevision, plan.revision);
  const loaded = loadDefinition(p.def);
  assert.ok(loaded.ok);
  assert.equal(loaded.definition.revision, plan.targetRevision); assert.equal(r.revision, plan.targetRevision);
  for (const [rel, v] of target) assert.ok(fs.readFileSync(path.join(p.def, rel)).equals(bytesOf(v)), rel);
  assert.equal(fs.existsSync(path.join(p.def, 'skills/review/references')), false, 'the emptied folder is removed');
  assert.equal(snapshot(p.def)['skills/review/SKILL.md'], untouched, 'an untouched file is never rewritten');
  assert.equal(fs.statSync(path.join(p.def, 'skills/lint/SKILL.md')).mode & 0o777, 0o644);
  assert.equal(fs.existsSync(journalAt(p)), false, 'the journal is removed');
  assert.equal(await lockIsFree(p.dir), 'free', 'the project lock is released');
});

test('deletes: a whole skill goes, with its folders; the skills folder stays while it holds another skill', async t => {
  const p = saving(t, { files: { 'skills/lint/SKILL.md': skill('lint') } });
  const target = current(p);
  target.delete('skills/review/SKILL.md'); target.delete('skills/review/references/notes.md');
  const plan = planSave(p.save(), target);
  assert.deepEqual(plan.changes.map(c => c.action), ['delete', 'delete']);
  assert.deepEqual(plan.emptied, ['skills/review', 'skills/review/references']);
  await applySave(p.save(), plan.revision, target);
  assert.equal(fs.existsSync(path.join(p.def, 'skills/review')), false);
  assert.ok(fs.statSync(path.join(p.def, 'skills/lint')).isDirectory());
  assert.equal(loadDefinition(p.def).definition.revision, plan.targetRevision);
});

test('deletes: removing every skill while harness.json still points to skills/ is refused, as the editor\'s loader refuses it', t => {
  const p = saving(t);
  const target = current(p);
  target.delete('skills/review/SKILL.md'); target.delete('skills/review/references/notes.md');
  assert.throws(() => planSave(p.save(), target), code('SAVE_DEFINITION_INVALID'));
});

test('deletes: removing the skills part and every skill removes the skills folder', async t => {
  const p = saving(t);
  const target = current(p);
  target.delete('skills/review/SKILL.md'); target.delete('skills/review/references/notes.md');
  target.set('harness.json', harnessWith(p, h => { delete h.parts.skills; }));
  const plan = planSave(p.save(), target);
  assert.deepEqual(plan.emptied, ['skills', 'skills/review', 'skills/review/references']);
  await applySave(p.save(), plan.revision, target);
  assert.equal(fs.existsSync(path.join(p.def, 'skills')), false);
  assert.ok(loadDefinition(p.def).ok);
});

/** A project with a scripts part: `check.sh`, mode 0755, and `notes.txt`, mode 0644. */
function scripted(t) {
  const p = saving(t, { parts: { scripts: 'scripts/' }, files: { 'scripts/check.sh': '#!/bin/sh\necho one\n', 'scripts/notes.txt': 'Notes.\n' } });
  fs.chmodSync(path.join(p.def, 'scripts/check.sh'), 0o755);
  return p;
}

test('the mode follows executable: 0755 when true, 0644 when false, for a create and an update', async t => {
  const p = scripted(t);
  assert.equal(current(p).get('scripts/check.sh').executable, true, 'the fixture reads as executable');
  const target = current(p);
  target.set('scripts/check.sh', { bytes: Buffer.from('#!/bin/sh\necho two\n'), executable: true });
  target.set('scripts/new.sh', { bytes: Buffer.from('#!/bin/sh\necho new\n'), executable: true });
  target.set('scripts/plain.txt', Buffer.from('Plain.\n'));
  target.set('scripts/notes.txt', Buffer.from('Notes, edited.\n'));
  const plan = planSave(p.save(), target);
  assert.deepEqual(plan.changes.map(c => [c.path, c.action, c.after.mode]), [
    ['scripts/check.sh', 'update', 0o755], ['scripts/new.sh', 'create', 0o755], ['scripts/notes.txt', 'update', 0o644], ['scripts/plain.txt', 'create', 0o644],
  ]);
  await applySave(p.save(), plan.revision, target);
  assert.deepEqual(['check.sh', 'new.sh', 'notes.txt', 'plain.txt'].map(n => modeOf(p, `scripts/${n}`)), [0o755, 0o755, 0o644, 0o644]);
  assert.ok(loadDefinition(p.def).definition.files.find(f => f.path === 'scripts/new.sh').executable);
});

test('a change of the execute bit alone is an update; the same bytes and the same bit are no change', async t => {
  const p = scripted(t);
  assert.deepEqual(planSave(p.save(), current(p)).changes, [], 'executable true on a 0755 file is no change');
  const target = current(p);
  target.set('scripts/check.sh', { ...target.get('scripts/check.sh'), executable: false });
  target.set('scripts/notes.txt', { ...target.get('scripts/notes.txt'), executable: true });
  const plan = planSave(p.save(), target);
  assert.deepEqual(plan.changes.map(c => [c.path, c.action, c.before.mode, c.after.mode, c.before.sha256 === c.after.sha256]), [
    ['scripts/check.sh', 'update', 0o755, 0o644, true], ['scripts/notes.txt', 'update', 0o644, 0o755, true],
  ]);
  await applySave(p.save(), plan.revision, target);
  assert.equal(modeOf(p, 'scripts/check.sh'), 0o644); assert.equal(modeOf(p, 'scripts/notes.txt'), 0o755);
});

test('the journal holds each mode: undo and finish both restore the execute bit', async t => {
  for (const mode of ['undo', 'finish']) {
    const p = scripted(t);
    const before = content(p.def);
    const target = current(p);
    target.set('scripts/check.sh', { ...target.get('scripts/check.sh'), executable: false });
    target.set('scripts/notes.txt', { ...target.get('scripts/notes.txt'), executable: true });
    const plan = planSave(p.save(), target), err = crash();
    await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: rel => { if (rel === 'scripts/check.sh') throw err; } }), e => e === err);
    const journal = JSON.parse(fs.readFileSync(journalAt(p), 'utf8'));
    assert.deepEqual(journal.files.map(f => [f.path, f.from.mode, f.to.mode]), [['.bowerloom/scripts/check.sh', 0o755, 0o644], ['.bowerloom/scripts/notes.txt', 0o644, 0o755]]);
    assert.equal(modeOf(p, 'scripts/check.sh'), 0o644, 'the first step landed');
    const rec = planSaveRecovery(p.save());
    await runSaveRecovery(p.save(), rec.revision, mode);
    if (mode === 'undo') assert.deepEqual(content(p.def), before, 'both modes are back');
    else { assert.equal(modeOf(p, 'scripts/check.sh'), 0o644); assert.equal(modeOf(p, 'scripts/notes.txt'), 0o755); }
    assert.equal(fs.existsSync(journalAt(p)), false);
  }
});

test('a failure puts the old mode back with the old bytes', async t => {
  const p = scripted(t);
  const before = content(p.def);
  const target = current(p);
  target.set('scripts/check.sh', { bytes: Buffer.from('#!/bin/sh\necho two\n'), executable: false });
  target.set('harness.json', harnessWith(p, h => { h.description = 'Edited.'; }));
  const plan = planSave(p.save(), target);
  const boom = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { beforeWrite: rel => { if (rel === 'harness.json') throw boom; } }), e => e === boom);
  assert.deepEqual(content(p.def), before);
  assert.equal(modeOf(p, 'scripts/check.sh'), 0o755);
});

test('0.7 files in the folder are never touched by a save', async t => {
  const p = saving(t, { files: { 'skills.json': '{"legacy": true}\n' } });
  const legacy = snapshot(p.def)['skills.json'];
  const target = mixed(p);
  await applySave(p.save(), planSave(p.save(), target).revision, target);
  assert.equal(snapshot(p.def)['skills.json'], legacy);
});

// ---- stale and drift -----------------------------------------------------------------------------------------------------

test('a stale or malformed revision is refused and nothing is written', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  fs.writeFileSync(path.join(p.def, 'skills/review/SKILL.md'), skill('review', '', 'Edited by hand.\n'));
  const before = snapshot(p.base);
  await assert.rejects(applySave(p.save(), plan.revision, target), code('SAVE_STALE'));
  await assert.rejects(applySave(p.save(), 'not-a-revision', target), code('SAVE_STALE'));
  await assert.rejects(applySave(p.save(), plan.revision, current(p)), code('SAVE_STALE'), 'another target is another plan');
  assert.deepEqual(snapshot(p.base), before);
  assert.equal(await lockIsFree(p.dir), 'free');
});

test('a person\'s edit to a file the save already wrote is caught by the reload and kept; the journal stays', async t => {
  const p = saving(t);
  const before = content(p.def);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const edited = `${INSTRUCTIONS}\nA person added this line during the save.\n`;
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), {
    beforeWrite: rel => { if (rel === 'harness.json') fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), edited); },
  }), e => e.code === 'SAVE_PARTIAL' && e.paths.includes('instructions/AGENTS.md') && e.original === 'SAVE_STALE');
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), edited, 'never overwritten');
  const after = content(p.def);
  for (const k of Object.keys(before)) if (k !== 'instructions/AGENTS.md') assert.equal(after[k], before[k], k);
  assert.ok(fs.existsSync(journalAt(p)), 'the journal stays, so a person decides');
  const rec = planSaveRecovery(p.save());
  assert.deepEqual(rec.kept, [{ path: 'instructions/AGENTS.md', reason: 'changed' }]);
  assert.deepEqual(rec.undo, []);
  await runSaveRecovery(p.save(), rec.revision, 'undo');
  assert.equal(fs.existsSync(journalAt(p)), false);
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), edited);
});

test('a file that changes just before its own write is never overwritten', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const harness = fs.readFileSync(path.join(p.def, 'harness.json'), 'utf8').replace('A demo', 'A hand-edited');
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), {
    beforeWrite: rel => { if (rel === 'harness.json') fs.writeFileSync(path.join(p.def, 'harness.json'), harness); },
  }), code('SAVE_STALE'));
  assert.equal(fs.readFileSync(path.join(p.def, 'harness.json'), 'utf8'), harness);
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), INSTRUCTIONS, 'what the save wrote is put back');
  assert.ok(fs.existsSync(path.join(p.def, 'skills/review/references/notes.md')), 'the deleted file is back');
  assert.equal(fs.existsSync(path.join(p.def, 'skills/lint')), false, 'the created file and folder are gone');
});

test('a file changed by hand just before its planned delete is refused as drift and kept', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), {
    beforeWrite: rel => { if (rel === 'skills/review/references/notes.md') fs.writeFileSync(path.join(p.def, rel), 'Changed.\n'); },
  }), code('SAVE_STALE'));
  assert.equal(fs.readFileSync(path.join(p.def, 'skills/review/references/notes.md'), 'utf8'), 'Changed.\n');
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), INSTRUCTIONS);
});

// ---- failure and crash ---------------------------------------------------------------------------------------------------

test('a failure mid-write puts every original back, deleted files and folders too, and removes the journal', async t => {
  const p = saving(t);
  const before = content(p.def);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const boom = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { beforeWrite: rel => { if (rel === 'harness.json') throw boom; } }), e => e === boom);
  assert.deepEqual(content(p.def), before, 'byte for byte, mode for mode');
  assert.equal(loadDefinition(p.def).definition.revision, plan.currentRevision);
  assert.equal(fs.existsSync(journalAt(p)), false);
  assert.equal(await lockIsFree(p.dir), 'free');
  assert.equal(planSave(p.save(), target).revision, plan.revision, 'the save can run again');
});

test('a stop signal ends the save and puts every original back', async t => {
  const p = saving(t);
  const before = content(p.def);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const stop = new AbortController();
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, stop.signal, { afterWrite: () => stop.abort() }), e => e.code === 'SAVE_ABORTED' || e.code === 'PROJECT_LOCKED');
  assert.deepEqual(content(p.def), before);
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('a crash leaves a private journal; every later save refuses until recovery undoes it byte for byte', async t => {
  for (const at of [0, 1, 3]) {
    const p = saving(t);
    const before = content(p.def);
    const target = mixed(p);
    const plan = planSave(p.save(), target);
    const err = crash(), last = plan.changes[at].path;
    await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: rel => { if (rel === last) throw err; } }), e => e === err);
    assert.ok(fs.existsSync(journalAt(p)));
    assert.equal(fs.statSync(journalAt(p)).mode & 0o777, 0o600);
    assert.equal(saveStopped(p.adoptState), true);
    assert.throws(() => refuseWhileSaveStopped(p.adoptState), code('SAVE_RECOVERY_REQUIRED'));
    assert.throws(() => planSave(p.save(), target), code('SAVE_RECOVERY_REQUIRED'));
    await assert.rejects(applySave(p.save(), plan.revision, target), code('SAVE_RECOVERY_REQUIRED'));
    const rec = planSaveRecovery(p.save());
    assert.equal(rec.journal, 'ok');
    assert.equal(rec.planRevision, plan.revision);
    assert.deepEqual(rec.undo.map(u => u.path), plan.changes.slice(0, at + 1).map(c => c.path).reverse());
    assert.deepEqual(rec.finish.map(u => u.path), plan.changes.slice(at + 1).map(c => c.path));
    assert.equal(rec.finishable, true);
    await assert.rejects(runSaveRecovery(p.save(), '0'.repeat(64), 'undo'), code('SAVE_STALE'));
    const r = await runSaveRecovery(p.save(), rec.revision, 'undo');
    assert.deepEqual(r.undone, rec.undo.map(u => u.path));
    assert.deepEqual(content(p.def), before, `undo after write ${at}`);
    assert.equal(fs.existsSync(journalAt(p)), false);
    assert.equal(saveStopped(p.adoptState), false);
    assert.throws(() => planSaveRecovery(p.save()), code('SAVE_RECOVER_NOTHING'));
    assert.equal(planSave(p.save(), target).revision, plan.revision, 'the save can run again');
  }
});

test('after a crash, recovery can finish the save instead', async t => {
  for (const at of [0, 2, 3]) {
    const p = saving(t);
    const target = mixed(p);
    const plan = planSave(p.save(), target);
    const err = crash(), last = plan.changes[at].path;
    await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: rel => { if (rel === last) throw err; } }), e => e === err);
    const rec = planSaveRecovery(p.save());
    const r = await runSaveRecovery(p.save(), rec.revision, 'finish');
    assert.deepEqual(r.finished, rec.finish.map(f => f.path));
    assert.equal(r.revision, plan.targetRevision);
    const loaded = loadDefinition(p.def);
    assert.ok(loaded.ok); assert.equal(loaded.definition.revision, plan.targetRevision);
    for (const [rel, v] of target) assert.ok(fs.readFileSync(path.join(p.def, rel)).equals(bytesOf(v)), rel);
    assert.equal(fs.existsSync(path.join(p.def, 'skills/review/references')), false);
    assert.equal(fs.existsSync(journalAt(p)), false);
    assert.equal(await lockIsFree(p.dir), 'free');
  }
});

test('recovery keeps a file that changed after the crash, and then refuses to finish', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target), err = crash();
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: rel => { if (rel === 'skills/lint/SKILL.md') throw err; } }), e => e === err);
  fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'A person fixed it by hand.\n');
  const rec = planSaveRecovery(p.save());
  assert.deepEqual(rec.kept, [{ path: 'instructions/AGENTS.md', reason: 'changed' }]);
  assert.equal(rec.finishable, false);
  await assert.rejects(runSaveRecovery(p.save(), rec.revision, 'finish'), code('SAVE_FINISH_BLOCKED'));
  assert.ok(fs.existsSync(journalAt(p)), 'a refused finish keeps the journal');
  await runSaveRecovery(p.save(), rec.revision, 'undo');
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), 'A person fixed it by hand.\n');
  assert.equal(fs.existsSync(path.join(p.def, 'skills/lint')), false);
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('a damaged save journal is only cleared, and the plan lists the files to check by hand', async t => {
  const p = saving(t);
  fs.mkdirSync(p.adoptState, { recursive: true, mode: 0o700 });
  fs.writeFileSync(journalAt(p), '{ not json', { mode: 0o600 });
  assert.throws(() => planSave(p.save(), current(p)), code('SAVE_RECOVERY_REQUIRED'));
  const rec = planSaveRecovery(p.save());
  assert.equal(rec.journal, 'damaged');
  assert.equal(rec.finishable, false);
  assert.deepEqual(rec.check, ['harness.json', 'instructions/AGENTS.md', 'skills/review/SKILL.md', 'skills/review/references/notes.md']);
  await assert.rejects(runSaveRecovery(p.save(), rec.revision, 'finish'), code('SAVE_FINISH_BLOCKED'));
  await runSaveRecovery(p.save(), rec.revision, 'undo');
  assert.equal(fs.existsSync(journalAt(p)), false);
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), INSTRUCTIONS);
});

test('a journal that names a path outside the definition, or bytes that do not match, counts as damaged', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target), err = crash();
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), { afterWrite: () => { throw err; } }), e => e === err);
  const good = fs.readFileSync(journalAt(p), 'utf8');
  for (const forge of [
    j => { j.files[0].path = 'CLAUDE.md'; },
    j => { j.files[0].path = '.bowerloom/../CLAUDE.md'; },
    j => { j.files[0].original = Buffer.from('other bytes').toString('base64'); },
    j => { j.projectDir = '/elsewhere'; },
    j => { j.extra = true; },
  ]) {
    const j = JSON.parse(good); forge(j);
    fs.writeFileSync(journalAt(p), JSON.stringify(j));
    assert.equal(planSaveRecovery(p.save()).journal, 'damaged');
  }
  fs.writeFileSync(journalAt(p), good);
  fs.chmodSync(journalAt(p), 0o644);
  assert.throws(() => planSaveRecovery(p.save()), code('SAVE_STATE_UNSAFE'), 'a journal others can read is refused');
});

// ---- unsafe paths ----------------------------------------------------------------------------------------------------------

test('a path outside .bowerloom, or a hidden path trick, is refused and nothing is written', t => {
  const p = saving(t);
  const before = snapshot(p.base);
  const bad = [
    '../CLAUDE.md', '/etc/hosts', 'skills/../../CLAUDE.md', 'skills/./review/SKILL.md', 'skills//review/SKILL.md', '',
    '.hidden/file.md', 'skills/.review/SKILL.md', '.bowerloom/harness.json', 'skills\\review\\SKILL.md', 'skills/re\0view/SKILL.md',
    'skills/re\u0001view/SKILL.md', 'skills.json', 'teams/x.md', 'skills/review/references/cafe\u0301.md', `skills/${'a'.repeat(256)}/SKILL.md`,
    `${'a/'.repeat(17)}x.md`, 'skills/re\u200bview/SKILL.md', 'skills/review/references/notes\u202e.md', 'skills/review/references/a\u2028b.md',
  ];
  for (const rel of bad) {
    const target = current(p); target.set(rel, Buffer.from('text\n'));
    assert.throws(() => planSave(p.save(), target), code('SAVE_PATH_UNSAFE'), JSON.stringify(rel));
  }
  assert.deepEqual(snapshot(p.base), before);
});

test('two paths that differ only in case or Unicode form are refused; a file where a folder must be is the loader\'s refusal', t => {
  const p = saving(t);
  const a = current(p); a.set('skills/Review/SKILL.md', Buffer.from(skill('Review')));
  assert.throws(() => planSave(p.save(), a), code('SAVE_PATH_UNSAFE'));
  const b = current(p); b.set('skills/review', Buffer.from('a file over a folder\n'));
  assert.throws(() => planSave(p.save(), b), code('SAVE_DEFINITION_INVALID'));
  const c = current(p); c.set('skills/café/SKILL.md', Buffer.from(skill('cafe'))); c.set('skills/CAFÉ/SKILL.md', Buffer.from(skill('cafe')));
  assert.throws(() => planSave(p.save(), c), code('SAVE_PATH_UNSAFE'));
});

test('a symbolic link at a target path, in a folder above one, or as .bowerloom itself is refused', async t => {
  const p = saving(t);
  const outside = path.join(p.base, 'outside');
  fs.mkdirSync(outside);
  // The targets are built while the definition still loads.
  const a = current(p); a.set('skills/lint/SKILL.md', Buffer.from(skill('lint')));
  const b = current(p); b.set('skills/review/references/notes.md', Buffer.from('New notes.\n'));
  // A link where the save would create a skill: the write would land outside the project.
  fs.symlinkSync(outside, path.join(p.def, 'skills/lint'));
  assert.throws(() => planSave(p.save(), a), code('SAVE_PATH_UNSAFE'));
  fs.unlinkSync(path.join(p.def, 'skills/lint'));
  // A link at a file the save would replace.
  fs.writeFileSync(path.join(outside, 'notes.md'), 'Elsewhere.\n');
  fs.rmSync(path.join(p.def, 'skills/review/references/notes.md'));
  fs.symlinkSync(path.join(outside, 'notes.md'), path.join(p.def, 'skills/review/references/notes.md'));
  assert.throws(() => planSave(p.save(), b), code('SAVE_PATH_UNSAFE'));
  assert.equal(fs.readFileSync(path.join(outside, 'notes.md'), 'utf8'), 'Elsewhere.\n');
  assert.deepEqual(fs.readdirSync(outside).sort(), ['notes.md'], 'nothing is written outside');
});

test('.bowerloom as a link is refused', t => {
  const p = saving(t);
  const target = current(p);
  const moved = path.join(p.base, 'real-def');
  fs.renameSync(p.def, moved);
  fs.symlinkSync(moved, p.def);
  assert.throws(() => planSave(p.save(), target), code('SAVE_PATH_UNSAFE'));
});

test('a folder swapped for a link after the plan is never followed; the save puts back what it wrote', async t => {
  const p = saving(t);
  const before = content(p.def);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside);
  await assert.rejects(applySaveWith(p.save(), plan.revision, target, signal(), {
    beforeWrite: rel => {
      if (rel !== 'skills/review/references/notes.md') return;
      const ref = path.join(p.def, 'skills/review/references');
      fs.renameSync(ref, path.join(outside, 'moved')); fs.symlinkSync(path.join(outside, 'moved'), ref);
    },
  }), e => e.code === 'SAVE_PATH_UNSAFE' || e.code === 'SAVE_PARTIAL');
  assert.ok(fs.existsSync(path.join(outside, 'moved/notes.md')), 'the file behind the link is untouched');
  const after = content(p.def);
  assert.equal(after['instructions/AGENTS.md'], before['instructions/AGENTS.md']);
  assert.equal(after['harness.json'], before['harness.json']);
});

// ---- content checks ------------------------------------------------------------------------------------------------------

test('a secret in a written file is refused, the refusal names the place and never the value', t => {
  const p = saving(t);
  const before = snapshot(p.base);
  // A synthetic token shape, built at run time so no file holds one.
  const token = `${['gh', 'p_'].join('')}${'a1'.repeat(18)}`;
  const target = current(p);
  target.set('skills/review/references/notes.md', Buffer.from(`Notes.\n\ntoken: ${token}\n`));
  assert.throws(() => planSave(p.save(), target), e => {
    assert.equal(e.code, 'SAVE_SECRET_FOUND');
    assert.ok(e.paths.includes('skills/review/references/notes.md line 3'), e.paths.join(', '));
    assert.ok(!e.message.includes(token));
    return true;
  });
  assert.deepEqual(snapshot(p.base), before);
});

test('a target the loader rejects is refused before any write', async t => {
  const p = saving(t);
  const before = snapshot(p.base);
  const a = current(p); a.set('harness.json', Buffer.from('{ not json'));
  assert.throws(() => planSave(p.save(), a), code('SAVE_DEFINITION_INVALID'));
  const b = current(p); b.delete('harness.json');
  assert.throws(() => planSave(p.save(), b), code('SAVE_DEFINITION_INVALID'));
  const c = current(p); c.set('skills/empty/SKILL.md', Buffer.from('no frontmatter\n'));
  assert.throws(() => planSave(p.save(), c), e => e.code === 'SAVE_DEFINITION_INVALID' && e.problems.length > 0);
  const d = current(p); d.set('notes.txt', Buffer.from('A name section 8 does not have.\n'));
  assert.throws(() => planSave(p.save(), d), code('SAVE_DEFINITION_INVALID'));
  assert.deepEqual(snapshot(p.base), before);
});

test('a folder whose definition does not load cannot be saved over', t => {
  const p = saving(t);
  fs.writeFileSync(path.join(p.def, 'harness.json'), '{ broken');
  assert.throws(() => planSave(p.save(), new Map([['harness.json', Buffer.from(json({ ...HARNESS, engines: [], parts: {}, skills: {} }))]])), code('SAVE_DEFINITION_INVALID'));
});

test('a target over the loader limits is refused before the loader runs', t => {
  const p = saving(t);
  const big = current(p); big.set('skills/review/references/notes.md', Buffer.alloc(1024 * 1024 + 1, 0x61));
  assert.throws(() => planSave(p.save(), big), code('SAVE_TOO_LARGE'));
  const many = current(p);
  for (let i = 0; i < 4097; i++) many.set(`skills/review/references/n${i}.md`, Buffer.from('x\n'));
  assert.throws(() => planSave(p.save(), many), code('SAVE_TOO_LARGE'));
});

// ---- other runs that stopped ---------------------------------------------------------------------------------------------

test('a save is refused while an adoption or a merge is stopped', async t => {
  for (const name of [JOURNAL, MERGE_JOURNAL]) {
    const p = saving(t);
    const target = mixed(p);
    const plan = planSave(p.save(), target);
    fs.mkdirSync(p.adoptState, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(p.adoptState, name), '{ any content, even damaged', { mode: 0o600 });
    const before = snapshot(p.def);
    assert.throws(() => planSave(p.save(), target), code('SAVE_RECOVERY_REQUIRED'), name);
    await assert.rejects(applySave(p.save(), plan.revision, target), code('SAVE_RECOVERY_REQUIRED'), name);
    assert.deepEqual(snapshot(p.def), before);
  }
});

test('a stopped save holds every other change: the install guard, the merge plan, and the adoption plan refuse until it is recovered', t => {
  const p = saving(t);
  const merge = () => planInstructionMerge(p.save());
  const adopt = () => adoption.planAdoption({ projectDir: p.dir, stateDir: p.adoptState, engines: [{ id: 'claude-code' }] });
  // With nothing stopped, each refuses for its own reason, or passes.
  assert.doesNotThrow(() => refuseWhileStopped(p.adoptState));
  assert.throws(merge, code('ADOPTION_MERGE_NOTHING'));
  assert.throws(adopt, code('ADOPTION_DEFINED'));
  assert.equal(journalSaveStopped(p.adoptState), false);
  fs.mkdirSync(p.adoptState, { recursive: true, mode: 0o700 });
  fs.writeFileSync(journalAt(p), '{ any content, even damaged', { mode: 0o600 });
  assert.equal(journalSaveStopped(p.adoptState), true);
  assert.equal(saveStopped, journalSaveStopped, 'one check, in journal.ts');
  assert.throws(() => refuseWhileStopped(p.adoptState), e => e.code === 'SAVE_RECOVERY_REQUIRED' && /save/i.test(e.message) && /Finish a stopped harness/.test(e.message));
  assert.throws(merge, code('ADOPTION_RECOVERY_REQUIRED'));
  assert.throws(adopt, code('ADOPTION_RECOVERY_REQUIRED'));
});

// ---- input, concurrency, and exports -------------------------------------------------------------------------------------

test('a bad input is refused as usage, and an unsafe state folder as unsafe', t => {
  const p = saving(t);
  const target = current(p);
  assert.throws(() => planSave({ projectDir: p.dir }, target), code('SAVE_USAGE'));
  assert.throws(() => planSave({ ...p.save(), extra: 1 }, target), code('SAVE_USAGE'));
  assert.throws(() => planSave(p.save(), null), code('SAVE_USAGE'));
  assert.throws(() => planSave(p.save(), [['harness.json', Buffer.from('{}')]]), code('SAVE_USAGE'));
  assert.throws(() => planSave(p.save(), [null]), code('SAVE_USAGE'));
  assert.throws(() => planSave(p.save(), new Map([['harness.json', 'text, not bytes']])), code('SAVE_USAGE'));
  assert.throws(() => planSave({ projectDir: 'relative', stateDir: p.adoptState }, target), code('SAVE_USAGE'));
  assert.throws(() => planSave({ projectDir: p.dir, stateDir: path.join(p.dir, 'state') }, target), code('SAVE_STATE_UNSAFE'));
  assert.throws(() => planSave({ projectDir: path.join(p.base, 'missing'), stateDir: p.adoptState }, target), code('SAVE_PATH_UNSAFE'));
});

test('two saves at once: one writes, the other is refused, and the definition is the one target', async t => {
  const p = saving(t);
  const target = mixed(p);
  const plan = planSave(p.save(), target);
  const results = await Promise.allSettled([applySave(p.save(), plan.revision, target), applySave(p.save(), plan.revision, target)]);
  const ok = results.filter(r => r.status === 'fulfilled');
  assert.equal(ok.length, 1);
  const refused = results.find(r => r.status === 'rejected').reason;
  assert.ok(['PROJECT_LOCKED', 'SAVE_STALE'].includes(refused.code), refused.code);
  assert.equal(loadDefinition(p.def).definition.revision, plan.targetRevision);
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('the package index exports the save API and every refusal code', () => {
  for (const name of ['planSave', 'applySave', 'planSaveRecovery', 'runSaveRecovery', 'saveStopped', 'refuseWhileSaveStopped']) assert.equal(typeof adoption[name], 'function', name);
  assert.equal(adoption.planSave, save.planSave);
  assert.equal(adoption.applySaveWith, undefined, 'the test hooks stay out of the index');
  assert.equal(adoption.SAVE_JOURNAL, 'save-pending.json');
  assert.deepEqual([...SAVE_REFUSAL_CODES].sort(), [
    'SAVE_ABORTED', 'SAVE_DEFINITION_INVALID', 'SAVE_FINISH_BLOCKED', 'SAVE_PARTIAL', 'SAVE_PATH_UNSAFE', 'SAVE_RECOVERY_REQUIRED', 'SAVE_RECOVER_NOTHING',
    'SAVE_SECRET_FOUND', 'SAVE_STALE', 'SAVE_STATE_UNSAFE', 'SAVE_TOO_LARGE', 'SAVE_USAGE',
  ]);
  assert.deepEqual(adoption.SAVE_REFUSAL_CODES, SAVE_REFUSAL_CODES);
});
