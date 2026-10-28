// The verification round of the portable projection: items V1 to V15 on 64cf69c. Each test names its item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCKED_IN_REASON, applyPortableRecovery, planPortable, planPortableRecovery, planPortableRemoval, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyPortableRecoveryWith, applyPortableRemovalWith, applyPortableWith } from '../../../dist/packages/project-sync/src/portable-run.js';
import { assert, code, crashAt, isCaseSensitive, project, projectNow, sha, snapshot } from './portable-fixture.mjs';

const signal = () => new AbortController().signal;
const pending = p => path.join(p.stateDir, 'pending.json');
const blobs = p => { try { return fs.readdirSync(path.join(p.stateDir, 'blobs')).sort(); } catch { return []; } };
const PERSON = 'The person\'s rules.\n';
const temps = dir => { const out = []; const walk = d => { for (const n of fs.readdirSync(d)) { const a = path.join(d, n), st = fs.lstatSync(a); if (st.isDirectory() && !st.isSymbolicLink()) walk(a); else if (n.endsWith('.bowerloom-tmp')) out.push(path.relative(dir, a)); } }; walk(dir); return out; };
async function removal(p, hooks = {}) { const plan = planPortableRemoval(p.input()); return applyPortableRemovalWith(p.input(), plan.revision, signal(), hooks); }
async function recover(p, extra = {}, hooks = {}) { const plan = planPortableRecovery(p.input(extra)); return applyPortableRecoveryWith(p.input(extra), plan.revision, signal(), hooks); }
/** A project whose AGENTS.md was the person's before a first apply. */
async function applied(t, opts) { const p = project(t, opts); fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), PERSON); await projectNow(p.input()); return p; }

// ---- V1: keep keeps the original ---------------------------------------------------------------------------------------------

test('V1: keep keeps the saved original, says where, and says the path is targeted again on the next apply', async t => {
  const p = await applied(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Edited later.\n');
  const plan = planPortableRecovery(p.input({ keep: ['AGENTS.md'] }));
  const at = path.join(p.stateDir, 'kept', sha(PERSON));
  assert.deepEqual(plan.keptOriginals, [{ path: 'AGENTS.md', original: at }]);
  assert.match(plan.notice, /targeted again on the next apply/);
  const result = await applyPortableRecovery(p.input({ keep: ['AGENTS.md'] }), plan.revision);
  assert.deepEqual(result.keptOriginals, plan.keptOriginals);
  assert.equal(fs.readFileSync(at, 'utf8'), PERSON);
  assert.equal(planPortable(p.input()).changes.find(c => c.path === 'AGENTS.md').action, 'replace');
});

// ---- V2: a missing saved copy does not wedge recovery ------------------------------------------------------------------------

test('V2: recovery checks the saved copies it needs, and offers keep for a path whose original is gone', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), PERSON);
  const plan = planPortable(p.input());
  const { crash, hook } = crashAt(5); // AGENTS.md, the last step, is written
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterStep: hook }), e => e === crash);
  fs.rmSync(path.join(p.stateDir, 'blobs', sha(PERSON)));
  assert.throws(() => planPortableRecovery(p.input()), e => e.code === 'PORTABLE_STATE_INVALID' && e.paths.some(x => x.includes('AGENTS.md')) && /keep/.test(e.message));
  const r = await recover(p, { keep: ['AGENTS.md'] });
  assert.equal(r.action, 'rollback');
  assert.equal(fs.existsSync(pending(p)), false);
  assert.equal(fs.existsSync(path.join(p.dir, '.claude')), false, 'the other steps were undone');
});

// ---- V3: the state folder is compared by identity ---------------------------------------------------------------------------

test('V3: a state folder inside the project under another letter case is refused (case-insensitive file systems)', t => {
  const p = project(t);
  if (isCaseSensitive(p.base)) { t.skip('this file system keeps case apart'); return; }
  assert.throws(() => planPortable(p.input({ stateDir: path.join(p.base, 'PROJECT', 'st') })), code('PORTABLE_STATE_UNSAFE'));
});

test('V3: a state folder reached through a link that points deep inside the project is refused', t => {
  const p = project(t);
  fs.mkdirSync(path.join(p.dir, 'deep', 'er'), { recursive: true });
  fs.symlinkSync(path.join(p.dir, 'deep', 'er'), path.join(p.base, 'inner'));
  assert.throws(() => planPortable(p.input({ stateDir: path.join(p.base, 'inner', 'st') })), code('PORTABLE_STATE_UNSAFE'));
});

// ---- V4: the bytes are compared again just before the rename -----------------------------------------------------------------

test('V4: a file changed between the compare and the rename is not overwritten', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), PERSON);
  const plan = planPortable(p.input());
  const edit = rel => { if (rel === 'AGENTS.md') fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Changed at the last moment.\n'); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { beforePlace: edit }), code('PORTABLE_DRIFT'));
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), 'Changed at the last moment.\n');
});

// ---- V5: unlink and chmod do not follow a swapped folder -------------------------------------------------------------------

test('V5: a parent folder swapped just before an unlink is refused, and the file outside stays', async t => {
  const p = project(t);
  await projectNow(p.input());
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'SKILL.md'), 'Outside.\n');
  const swap = rel => {
    if (rel !== '.agents/skills/review/SKILL.md') return;
    fs.renameSync(path.join(p.dir, '.agents/skills/review'), path.join(p.base, 'moved'));
    fs.symlinkSync(outside, path.join(p.dir, '.agents/skills/review'));
  };
  await assert.rejects(removal(p, { beforeUnlink: swap }), e => ['PORTABLE_PATH_UNSAFE', 'PORTABLE_PARTIAL'].includes(e.code));
  assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), 'Outside.\n');
});

test('V5: a folder swapped for a link right after mkdir is refused, and the chmod does not reach through it', async t => {
  const p = project(t);
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside, { mode: 0o700 }); fs.chmodSync(outside, 0o700);
  const plan = planPortable(p.input());
  const swap = rel => { if (rel === '.claude') { fs.rmdirSync(path.join(p.dir, '.claude')); fs.symlinkSync(outside, path.join(p.dir, '.claude')); } };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterMkdir: swap }), code('PORTABLE_PATH_UNSAFE'));
  assert.equal(fs.statSync(outside).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('V5: the README names the window that remains', () => {
  assert.match(fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /remaining window/i);
});

// ---- V6: a link twin left by a kill, and a file system without link() -------------------------------------------------------

test('V6: a writer temporary linked to a projected file is swept before the recovery plan reads state', async t => {
  const p = project(t);
  const { crash, hook } = crashAt(2);
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
  const target = path.join(p.dir, '.agents/skills/review/SKILL.md');
  fs.linkSync(target, path.join(p.dir, '.agents/skills/review/.SKILL.md.0123456789abcdef.bowerloom-tmp'));
  const r = planPortableRecovery(p.input());
  assert.equal(r.action, 'rollback');
  assert.equal(fs.statSync(target).nlink, 1);
});

test('V6: when link() is not supported, a new file is created exclusively instead', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  let calls = 0;
  const link = () => { calls++; throw Object.assign(new Error('not supported'), { code: 'EPERM' }); };
  const result = await applyPortableWith(p.input(), plan.revision, signal(), { link });
  assert.ok(calls > 0, 'every new file tried link() first'); assert.equal(result.noop, false);
  assert.equal(fs.readFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), 'utf8'), fs.readFileSync(path.join(p.def, 'skills/review/SKILL.md'), 'utf8'));
});

// ---- V7: the lock is checked before each later write ------------------------------------------------------------------------

test('V7: a lock lost after the steps writes no receipt, removes no folder, and keeps the marker', async t => {
  const p = project(t);
  const controller = new AbortController();
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, controller.signal, { at: x => { if (x === 'after-steps') controller.abort(); } }), code('PORTABLE_LOCK_LOST'));
  assert.equal(readPortableReceipt(p.input()), null); assert.ok(fs.existsSync(pending(p)));
  const q = project(t);
  await projectNow(q.input());
  const c2 = new AbortController(), plan = planPortableRemoval(q.input());
  await assert.rejects(applyPortableRemovalWith(q.input(), plan.revision, c2.signal, { at: x => { if (x === 'after-steps') c2.abort(); } }), code('PORTABLE_LOCK_LOST'));
  assert.ok(readPortableReceipt(q.input())); assert.ok(fs.existsSync(path.join(q.dir, '.claude')));
});

test('V7: recovery checks the lock before it writes', async t => {
  const p = project(t);
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
  const controller = new AbortController(), plan = planPortableRecovery(p.input());
  await assert.rejects(applyPortableRecoveryWith(p.input(), plan.revision, controller.signal, { at: x => { if (x === 'recovery') controller.abort(); } }), code('PORTABLE_LOCK_LOST'));
  assert.ok(fs.existsSync(pending(p)));
  assert.ok(fs.existsSync(path.join(p.dir, '.agents/skills/review/SKILL.md')), 'nothing was rolled back');
});

// ---- V8: the CLAUDE.md link is resolved for real ------------------------------------------------------------------------------

test('V8: a CLAUDE.md link that only looks like AGENTS.md after a linked folder is refused', t => {
  const p = project(t);
  fs.mkdirSync(path.join(p.base, 'other', 'deep'), { recursive: true });
  fs.symlinkSync(path.join(p.base, 'other', 'deep'), path.join(p.dir, 'sub'));
  fs.symlinkSync('sub/../AGENTS.md', path.join(p.dir, 'CLAUDE.md'));
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_PATH_UNSAFE' && e.paths.includes('CLAUDE.md'));
});

// ---- V9: state temporaries, the README, and a linked blobs folder ----------------------------------------------------------

test('V9: writer temporaries in the state folder are swept', async t => {
  const p = project(t);
  await projectNow(p.input());
  const stray = path.join(p.stateDir, '.receipt.json.0123456789abcdef.bowerloom-tmp');
  fs.writeFileSync(stray, 'half'); fs.chmodSync(stray, 0o600);
  fs.writeFileSync(path.join(p.def, 'skills/review/references/notes.md'), 'New notes.\n');
  await projectNow(p.input());
  assert.equal(fs.existsSync(stray), false);
});

test('V9: a blobs folder that is a link is refused before anything is read or written through it', async t => {
  const p = await applied(t);
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside, { mode: 0o700 }); fs.chmodSync(outside, 0o700);
  fs.writeFileSync(path.join(outside, sha(PERSON)), PERSON);
  fs.rmSync(path.join(p.stateDir, 'blobs'), { recursive: true }); fs.symlinkSync(outside, path.join(p.stateDir, 'blobs'));
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_STATE_UNSAFE'));
  assert.deepEqual(fs.readdirSync(outside), [sha(PERSON)]);
});

test('V9: the README says a drift failure keeps the saved copy', () => {
  assert.match(fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /drift[\s\S]{0,80}kept/i);
});

// ---- V10, V11: folders a person made ------------------------------------------------------------------------------------------

test('V10: rollback does not delete an empty folder a person made after the plan', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: x => { if (x === 'before-steps') fs.mkdirSync(path.join(p.dir, '.claude')); } }), code('PORTABLE_PATH_UNSAFE'));
  assert.ok(fs.existsSync(path.join(p.dir, '.claude')), 'the person\'s folder stays');
  assert.equal(fs.existsSync(path.join(p.dir, '.agents')), false, 'the folders the run made are gone');
});

test('V11: a folder the run removed is not in the receipt, so removal leaves a folder a person makes there later', async t => {
  const p = project(t);
  await projectNow(p.input({ engines: [{ id: 'codex' }] }));
  const { result } = await projectNow(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(result.receipt.createdDirs.some(d => d.startsWith('.agents')), false);
  fs.mkdirSync(path.join(p.dir, '.agents'));
  await removal(p);
  assert.ok(fs.existsSync(path.join(p.dir, '.agents')));
});

// ---- V12, V13, V14 -------------------------------------------------------------------------------------------------------------

test('V12: an engine-private file gets an absent loss line for its engine', t => {
  const p = project(t, { engines: [{ id: 'claude-code' }, { id: 'codex' }], files: { 'engines/codex/config-extra.toml': '[features]\nx = true\n' } });
  const plan = planPortable(p.input());
  const lines = plan.loss.filter(l => l.entry === 'engines/codex/config-extra.toml');
  assert.deepEqual(lines.map(l => [l.part, l.field, l.engine, l.result, l.reason]), [['engine-private', undefined, 'codex', 'absent', LOCKED_IN_REASON]]);
  assert.equal(plan.loss.some(l => l.part === 'scripts' && l.entry.startsWith('engines/')), false, 'no line of an engine file uses the part scripts');
  assert.equal(plan.partial, true);
});

test('V13: a failure after the steps names the code of its cause', async t => {
  const p = project(t);
  const fail = x => { if (x === 'after-receipt') throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); };
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { at: fail }), e => e.code === 'PORTABLE_PARTIAL' && /ENOSPC/.test(e.message));
});

test('V14: rollback and recovery report the folders they left behind', async t => {
  const p = project(t);
  let n = 0;
  const hook = () => { if (++n === 4) { fs.writeFileSync(path.join(p.dir, '.claude/skills/review/mine.md'), 'Mine.\n'); throw new Error('a later step failed'); } };
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => Array.isArray(e.leftBehind) && e.leftBehind.some(l => l.path === '.claude/skills/review' && l.reason === 'not-empty'));
  const q = project(t);
  const { crash, hook: h } = crashAt(3);
  await assert.rejects(applyPortableWith(q.input(), planPortable(q.input()).revision, signal(), { afterStep: h }), e => e === crash);
  fs.writeFileSync(path.join(q.dir, '.claude/skills/review/mine.md'), 'Mine.\n');
  const r = await recover(q);
  assert.ok(r.leftBehind.some(l => l.path === '.claude/skills/review' && l.reason === 'not-empty'));
});

// ---- V15: guards that survived mutation ----------------------------------------------------------------------------------------

test('V15: a path left over late in the order does not stop the earlier steps from being undone', async t => {
  const p = project(t);
  let n = 0;
  const hook = () => { if (++n === 4) { fs.writeFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), 'Edited.\n'); throw new Error('a later step failed'); } };
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e.code === 'PORTABLE_PARTIAL' && e.paths.join() === '.claude/skills/review/SKILL.md');
  assert.equal(fs.existsSync(path.join(p.dir, '.agents')), false, 'the .agents steps, earlier in the order, were undone');
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/skills/review/references/notes.md')), false);
});

test('V15: a step that fails after a temporary exists leaves no temporary', async t => {
  const p = project(t);
  const fail = rel => {
    if (rel !== '.claude/skills/review/SKILL.md') return;
    fs.writeFileSync(path.join(p.dir, '.agents/skills/review/.SKILL.md.fedcba9876543210.bowerloom-tmp'), 'stray');
    throw new Error('the disk went away');
  };
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { beforePlace: fail }), /disk went away/);
  assert.deepEqual(temps(p.dir), []);
});

test('V15: a failed run that rolls back keeps only the saved originals of the receipt', async t => {
  const p = await applied(t);
  assert.deepEqual(blobs(p), [sha(PERSON)]);
  fs.writeFileSync(path.join(p.def, 'skills/review/references/notes.md'), 'New notes.\n');
  let n = 0;
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: () => { if (++n === 2) throw new Error('fail'); } }), /fail/);
  assert.deepEqual(blobs(p), [sha(PERSON)]);
});

test('V15: recovery sweeps a temporary beside a journaled path that it does not undo', async t => {
  const p = project(t);
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
  fs.mkdirSync(path.join(p.dir, '.claude/skills/review'), { recursive: true });
  const stray = path.join(p.dir, '.claude/skills/review/.SKILL.md.0123456789abcdef.bowerloom-tmp');
  fs.writeFileSync(stray, 'stray');
  await recover(p);
  assert.equal(fs.existsSync(stray), false);
  assert.ok(snapshot(p.dir));
});
