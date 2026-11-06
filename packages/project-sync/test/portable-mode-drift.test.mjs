// Mode drift of the portable projection (step 5, decision D5A): a mode-only change reads `mode`, and recovery restores
// the recorded mode or records the new one. Synthetic projects only.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyPortableRecoveryWith } from '../../../dist/packages/project-sync/src/portable-run.js';
import { PORTABLE_REFUSAL_CODES } from '../../../dist/packages/project-sync/src/portable-files.js';
import { assert, code, crashAt, project, projectNow, sha, snapshot } from './portable-fixture.mjs';

const signal = () => new AbortController().signal;
const PERSON = 'The person\'s rules.\n';
const SKILL = '.agents/skills/review/SKILL.md';
const modeOf = (p, rel) => fs.statSync(path.join(p.dir, rel)).mode & 0o777;
const pendingFile = p => path.join(p.stateDir, 'pending.json');
const blobs = p => { try { return fs.readdirSync(path.join(p.stateDir, 'blobs')).sort(); } catch { return []; } };
async function recover(p, extra = {}, hooks = {}) { const plan = planPortableRecovery(p.input(extra)); return applyPortableRecoveryWith(p.input(extra), plan.revision, signal(), hooks); }
async function remove(p) { const plan = planPortableRemoval(p.input()); return applyPortableRemoval(p.input(), plan.revision); }
/** A projected project whose AGENTS.md was the person's, mode 0600, before the first apply. */
async function applied(t) {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), PERSON); fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  await projectNow(p.input());
  return p;
}

test('a mode-only change reads mode, and removal still refuses it', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  const drift = portableDrift(p.input());
  assert.equal(drift.length, 1);
  assert.equal(drift[0].path, 'AGENTS.md'); assert.equal(drift[0].reason, 'mode');
  assert.equal(drift[0].now.sha256, drift[0].recorded.sha256);
  assert.equal(drift[0].now.mode, 0o640); assert.equal(drift[0].recorded.mode, 0o644);
  assert.throws(() => planPortableRemoval(p.input()), e => e.code === 'PORTABLE_DRIFT' && /AGENTS\.md \(mode\)/.test(e.message));
});

test('a content change with a mode change reads changed', async t => {
  const p = await applied(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Edited.\n'); fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  const drift = portableDrift(p.input());
  assert.deepEqual(drift.map(d => [d.path, d.reason]), [['AGENTS.md', 'changed']]);
  assert.throws(() => planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] })), e => e.code === 'PORTABLE_USAGE' && e.paths.includes('AGENTS.md'));
  assert.throws(() => planPortableRecovery(p.input({ recordMode: ['AGENTS.md'] })), e => e.code === 'PORTABLE_USAGE' && e.paths.includes('AGENTS.md'));
});

test('restoreMode plans without writing, then chmods back through the journal', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  const before = snapshot(p.dir), receipt = readPortableReceipt(p.input());
  const plan = planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] }));
  assert.equal(plan.action, 'mode'); assert.equal(plan.kind, null);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.modes, [{ path: 'AGENTS.md', choice: 'restoreMode', now: { sha256: sha(fs.readFileSync(path.join(p.dir, 'AGENTS.md'))), mode: 0o600 }, recorded: { sha256: receipt.files.find(f => f.path === 'AGENTS.md').sha256, mode: 0o644 } }]);
  assert.deepEqual(snapshot(p.dir), before, 'the plan writes nothing');
  assert.equal(fs.existsSync(pendingFile(p)), false);

  let journal = null;
  await applyPortableRecoveryWith(p.input({ restoreMode: ['AGENTS.md'] }), plan.revision, signal(), {
    at: point => { if (point === 'before-steps') journal = JSON.parse(fs.readFileSync(pendingFile(p), 'utf8')); },
  });
  assert.ok(journal, 'the chmod is journaled before it runs');
  assert.equal(journal.kind, 'apply'); assert.equal(journal.planRevision, plan.revision);
  assert.deepEqual(journal.steps.map(s => [s.path, s.from.mode, s.to.mode, s.from.sha256 === s.to.sha256]), [['AGENTS.md', 0o600, 0o644, true]]);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o644);
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), readFileText(p.def, 'instructions/AGENTS.md'));
  assert.deepEqual(portableDrift(p.input()), []);
  assert.equal(fs.existsSync(pendingFile(p)), false);
  assert.deepEqual(readPortableReceipt(p.input()), receipt, 'restoring a mode leaves the receipt as it was');
  assert.deepEqual(blobs(p), [sha(PERSON)], 'only the saved original stays');
  assert.equal(planPortable(p.input()).noop, true);
});
const readFileText = (def, rel) => fs.readFileSync(path.join(def, rel), 'utf8');

test('recordMode updates the receipt, and removal then restores the original file and mode', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  const before = snapshot(p.dir);
  const plan = planPortableRecovery(p.input({ recordMode: ['AGENTS.md'] }));
  assert.equal(plan.action, 'mode'); assert.equal(plan.modes[0].choice, 'recordMode');
  await applyPortableRecovery(p.input({ recordMode: ['AGENTS.md'] }), plan.revision);
  assert.deepEqual(snapshot(p.dir), before, 'recording a mode writes nothing in the project');
  assert.equal(readPortableReceipt(p.input()).files.find(f => f.path === 'AGENTS.md').mode, 0o640);
  assert.deepEqual(portableDrift(p.input()), [], 'a recorded mode is not drift');
  const r = await remove(p);
  assert.ok(r.restored.includes('AGENTS.md'));
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), PERSON);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o600);
  assert.equal(readPortableReceipt(p.input()), null);
});

test('recordMode is refused for a mode with group write or world write; restoreMode is not', async t => {
  const p = await applied(t);
  for (const mode of [0o664, 0o646, 0o620, 0o602]) {
    fs.chmodSync(path.join(p.dir, 'AGENTS.md'), mode);
    assert.equal(portableDrift(p.input())[0].reason, 'mode');
    assert.throws(() => planPortableRecovery(p.input({ recordMode: ['AGENTS.md'] })), e => e.code === 'PORTABLE_MODE_UNSAFE' && e.paths.includes('AGENTS.md'), mode.toString(8));
  }
  assert.ok(PORTABLE_REFUSAL_CODES.includes('PORTABLE_MODE_UNSAFE'));
  assert.equal(readPortableReceipt(p.input()).files.find(f => f.path === 'AGENTS.md').mode, 0o644);
  const plan = planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] }));
  await applyPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] }), plan.revision);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o644);
});

test('restoreMode and recordMode and keep run together in one plan', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  fs.chmodSync(path.join(p.dir, SKILL), 0o755);
  fs.writeFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), 'Mine now.\n');
  const input = p.input({ restoreMode: ['AGENTS.md'], recordMode: [SKILL], keep: ['.claude/skills/review/SKILL.md'] });
  const plan = planPortableRecovery(input);
  assert.equal(plan.action, 'mode');
  assert.deepEqual(plan.modes.map(m => [m.path, m.choice]), [[SKILL, 'recordMode'], ['AGENTS.md', 'restoreMode']].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))));
  assert.deepEqual(plan.keep, ['.claude/skills/review/SKILL.md']);
  await applyPortableRecovery(input, plan.revision);
  assert.deepEqual(portableDrift(p.input()), []);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o644); assert.equal(modeOf(p, SKILL), 0o755);
  const files = readPortableReceipt(p.input()).files;
  assert.equal(files.find(f => f.path === SKILL).mode, 0o755);
  assert.equal(files.some(f => f.path === '.claude/skills/review/SKILL.md'), false);
});

test('mode choices are checked: unknown paths, a path in two lists, a stale revision, and an unfinished run refuse', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  assert.throws(() => planPortableRecovery(p.input({ restoreMode: [SKILL] })), e => e.code === 'PORTABLE_USAGE' && e.paths.includes(SKILL));
  assert.throws(() => planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'], recordMode: ['AGENTS.md'] })), code('PORTABLE_USAGE'));
  assert.throws(() => planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'], keep: ['AGENTS.md'] })), code('PORTABLE_USAGE'));
  assert.throws(() => planPortableRecovery(p.input({ restoreMode: 'AGENTS.md' })), code('PORTABLE_USAGE'));
  assert.throws(() => planPortableRecovery(p.input({ recordMode: [7] })), code('PORTABLE_USAGE'));
  const plan = planPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] }));
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await assert.rejects(applyPortableRecovery(p.input({ restoreMode: ['AGENTS.md'] }), plan.revision), code('STALE_APPROVAL'));
  assert.equal(modeOf(p, 'AGENTS.md'), 0o640);
  // keep still takes a mode line, as before.
  const keep = planPortableRecovery(p.input({ keep: ['AGENTS.md'] }));
  assert.equal(keep.action, 'keep');
});

test('a crash in the middle of restoreMode is rolled back by recovery, and the mode lines read again', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  fs.chmodSync(path.join(p.dir, SKILL), 0o600);
  const input = p.input({ restoreMode: ['AGENTS.md', SKILL] });
  const plan = planPortableRecovery(input);
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableRecoveryWith(input, plan.revision, signal(), { afterStep: hook }), e => e === crash);
  assert.ok(fs.existsSync(pendingFile(p)), 'the journal stays after a crash');
  assert.throws(() => planPortable(p.input()), code('PORTABLE_RECOVERY_REQUIRED'));
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_RECOVERY_REQUIRED'));
  assert.throws(() => planPortableRecovery(input), code('PORTABLE_USAGE'), 'mode choices wait for the unfinished run');
  const rollback = planPortableRecovery(p.input());
  assert.equal(rollback.action, 'rollback'); assert.equal(rollback.kind, 'apply');
  await applyPortableRecovery(p.input(), rollback.revision);
  assert.equal(fs.existsSync(pendingFile(p)), false);
  assert.deepEqual(portableDrift(p.input()).map(d => [d.path, d.reason]).sort(), [[SKILL, 'mode'], ['AGENTS.md', 'mode']].sort());
  await recover(p, { restoreMode: ['AGENTS.md', SKILL] });
  assert.deepEqual(portableDrift(p.input()), []);
  assert.deepEqual(blobs(p), [sha(PERSON)]);
});

test('a crash after the steps of a combined run leaves a state that recovery settles', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  fs.chmodSync(path.join(p.dir, SKILL), 0o640);
  const input = p.input({ restoreMode: ['AGENTS.md'], recordMode: [SKILL] });
  const plan = planPortableRecovery(input);
  const crash = Object.assign(new Error('simulated crash'), { crash: true });
  await assert.rejects(applyPortableRecoveryWith(input, plan.revision, signal(), { at: point => { if (point === 'after-receipt') throw crash; } }), e => e === crash);
  assert.ok(fs.existsSync(pendingFile(p)));
  const rollback = planPortableRecovery(p.input());
  await applyPortableRecovery(p.input(), rollback.revision);
  assert.equal(fs.existsSync(pendingFile(p)), false);
  // The recorded mode was written with the receipt; the restored mode was rolled back, so it reads as drift again.
  assert.deepEqual(portableDrift(p.input()).map(d => [d.path, d.reason]), [['AGENTS.md', 'mode']]);
  assert.equal(readPortableReceipt(p.input()).files.find(f => f.path === SKILL).mode, 0o640);
});
