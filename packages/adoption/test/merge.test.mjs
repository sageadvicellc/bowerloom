// Merge (step 5, decision D4A): the CLAUDE.md text moves into the definition's instructions under a heading, through a
// guarded, journaled write. Install with Accept AGENTS.md then turns CLAUDE.md into @AGENTS.md. Synthetic projects only.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { ADOPTION_REFUSAL_CODES } from '../../../dist/packages/adoption/src/index.js';
import {
  MERGE_HEADING, MERGE_JOURNAL, applyInstructionMerge, applyInstructionMergeRecovery, applyInstructionMergeWith, planInstructionMerge, planInstructionMergeRecovery,
} from '../../../dist/packages/adoption/src/merge.js';
import { applyPortableRemoval, planPortable, planPortableRemoval } from '../../../dist/packages/project-sync/src/index.js';
import { INSTRUCTIONS, project, projectNow, sha, snapshot as outside } from '../../project-sync/test/portable-fixture.mjs';
import { code, snapshot } from './fixture.mjs';

const signal = () => new AbortController().signal;
const CLAUDE = '# Claude notes\n\nRun the tests before a commit.\n';
const LIMIT = 32 * 1024;
const crash = () => Object.assign(new Error('simulated crash'), { crash: true });

/** A defined project with a CLAUDE.md, and an adoption state folder beside the portable one. */
function merging(t, opts = {}, claude = CLAUDE) {
  const p = project(t, opts);
  if (claude !== null) { fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), claude); fs.chmodSync(path.join(p.dir, 'CLAUDE.md'), 0o640); }
  const adoptState = path.join(p.base, 'state', 'adoption');
  return { ...p, adoptState, merge: () => ({ projectDir: p.dir, stateDir: adoptState }) };
}
const instructionsOf = p => fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8');
const journalAt = p => path.join(p.adoptState, MERGE_JOURNAL);

test('the merge plan has a revision and writes nothing', t => {
  const p = merging(t);
  const before = snapshot(p.base);
  const plan = planInstructionMerge(p.merge());
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(plan.writesAuthorized, false);
  assert.equal(plan.heading, MERGE_HEADING); assert.equal(MERGE_HEADING, 'From CLAUDE.md');
  assert.deepEqual(plan.claude, { sha256: sha(CLAUDE), mode: 0o640, bytes: Buffer.byteLength(CLAUDE) });
  assert.equal(plan.addsPart, false);
  assert.deepEqual(plan.files.map(f => [f.path, f.action]), [['.bowerloom/instructions/AGENTS.md', 'update']]);
  assert.equal(plan.files[0].before.sha256, sha(INSTRUCTIONS));
  assert.notEqual(plan.definition.before, plan.definition.after);
  assert.deepEqual(snapshot(p.base), before, 'nothing is written, not even the state folder');
  assert.equal(planInstructionMerge(p.merge()).revision, plan.revision, 'the plan is stable');
});

test('apply appends the CLAUDE.md text under the heading and never touches an engine file', async t => {
  const p = merging(t);
  const engineFiles = outside(p.dir);
  const harness = fs.readFileSync(path.join(p.def, 'harness.json'));
  const plan = planInstructionMerge(p.merge());
  const r = await applyInstructionMerge(p.merge(), plan.revision);
  assert.equal(instructionsOf(p), `${INSTRUCTIONS}\n## ${MERGE_HEADING}\n\n${CLAUDE}`);
  assert.equal(r.planRevision, plan.revision);
  assert.deepEqual(r.written, ['.bowerloom/instructions/AGENTS.md']);
  assert.ok(fs.readFileSync(path.join(p.def, 'harness.json')).equals(harness), 'harness.json already lists the part');
  const loaded = loadDefinition(p.def);
  assert.ok(loaded.ok); assert.equal(loaded.definition.revision, plan.definition.after); assert.equal(r.revision, plan.definition.after);
  assert.deepEqual(outside(p.dir), engineFiles, 'CLAUDE.md and every engine file stay as they were');
  assert.equal(fs.existsSync(journalAt(p)), false);
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_MERGE_NOTHING'), 'the text is in already');
});

test('apply adds the system-prompt part when the definition has none', async t => {
  const p = merging(t, { noDefaults: true });
  const plan = planInstructionMerge(p.merge());
  assert.equal(plan.addsPart, true);
  assert.deepEqual(plan.files.map(f => [f.path, f.action]), [['.bowerloom/instructions/AGENTS.md', 'create'], ['.bowerloom/harness.json', 'update']]);
  const r = await applyInstructionMerge(p.merge(), plan.revision);
  assert.deepEqual(r.written, ['.bowerloom/instructions/AGENTS.md', '.bowerloom/harness.json']);
  assert.equal(instructionsOf(p), `## ${MERGE_HEADING}\n\n${CLAUDE}`);
  const harness = JSON.parse(fs.readFileSync(path.join(p.def, 'harness.json'), 'utf8'));
  assert.equal(harness.parts['system-prompt'], 'instructions/AGENTS.md');
  assert.equal(fs.statSync(path.join(p.def, 'instructions/AGENTS.md')).mode & 0o777, 0o644);
  const loaded = loadDefinition(p.def);
  assert.ok(loaded.ok); assert.equal(loaded.definition.instructions, `## ${MERGE_HEADING}\n\n${CLAUDE}`);
});

test('an @path import in CLAUDE.md is refused and nothing is written', async t => {
  const p = merging(t, {}, 'Read the rules.\n\nSee @docs/rules.md for more.\n');
  const before = snapshot(p.base);
  assert.throws(() => planInstructionMerge(p.merge()), e => e.code === 'ADOPTION_AT_IMPORT' && e.paths.includes('CLAUDE.md line 3'));
  assert.deepEqual(snapshot(p.base), before);
});

test('merged text over 32 KiB is refused; text of exactly 32 KiB is not', async t => {
  const p = merging(t, {}, null);
  const prefix = `${INSTRUCTIONS}\n## ${MERGE_HEADING}\n\n`;
  // Short lines, so the secret scan reads every line.
  const fill = n => 'Keep the build green.\n'.repeat(Math.ceil(n / 22)).slice(0, n - 1) + '\n';
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), fill(LIMIT - Buffer.byteLength(prefix) + 1));
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_INSTRUCTIONS_TOO_LARGE'));
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), fill(LIMIT - Buffer.byteLength(prefix)));
  const plan = planInstructionMerge(p.merge());
  assert.equal(plan.files[0].after.bytes, LIMIT);
  for (const c of ['ADOPTION_INSTRUCTIONS_TOO_LARGE', 'ADOPTION_MERGE_NOTHING']) assert.ok(ADOPTION_REFUSAL_CODES.includes(c), c);
});

test('a stale or malformed revision is refused and nothing is written', async t => {
  const p = merging(t);
  const plan = planInstructionMerge(p.merge());
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Changed after the review.\n');
  const before = snapshot(p.base);
  await assert.rejects(applyInstructionMerge(p.merge(), plan.revision), code('ADOPTION_STALE_APPROVAL'));
  await assert.rejects(applyInstructionMerge(p.merge(), 'not-a-revision'), code('ADOPTION_STALE_APPROVAL'));
  assert.deepEqual(snapshot(p.base), before);
});

test('nothing to merge: no CLAUDE.md, or one that follows AGENTS.md', async t => {
  const p = merging(t, {}, null);
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_MERGE_NOTHING'));
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_MERGE_NOTHING'));
  assert.throws(() => planInstructionMerge({ projectDir: p.dir }), code('ADOPTION_USAGE'));
  assert.throws(() => planInstructionMerge({ ...p.merge(), extra: true }), code('ADOPTION_USAGE'));
});

test('a definition that does not load, or a merged text that holds a secret, is refused', async t => {
  // A synthetic token shape, built at run time so no file holds one.
  const p = merging(t, {}, `token: ${['gh', 'p_'].join('')}${'a1'.repeat(18)}\n`);
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_DEFINITION_INVALID'));
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), CLAUDE);
  fs.writeFileSync(path.join(p.def, 'harness.json'), '{ not json');
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_DEFINITION_INVALID'));
});

test('a failure part way restores what the merge replaced and removes the journal', async t => {
  const p = merging(t, { noDefaults: true });
  const before = snapshot(p.def);
  const plan = planInstructionMerge(p.merge());
  const boom = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  await assert.rejects(applyInstructionMergeWith(p.merge(), plan.revision, signal(), { beforeWrite: rel => { if (rel === '.bowerloom/harness.json') throw boom; } }), e => e === boom);
  const after = snapshot(p.def);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'the instructions folder it made is gone');
  for (const k of Object.keys(before)) assert.equal(after[k].split(' ')[0], before[k].split(' ')[0]);
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('a crash part way leaves the journal; recovery restores the definition byte for byte', async t => {
  for (const noDefaults of [false, true]) {
    const p = merging(t, { noDefaults });
    const original = loadDefinition(p.def).definition.revision;
    const harness = fs.readFileSync(path.join(p.def, 'harness.json'));
    const plan = planInstructionMerge(p.merge());
    const last = plan.files.at(-1).path, err = crash();
    // Crash after every write has landed but before the journal is cleared.
    await assert.rejects(applyInstructionMergeWith(p.merge(), plan.revision, signal(), { afterWrite: rel => { if (rel === last) throw err; } }), e => e === err);
    assert.ok(fs.existsSync(journalAt(p)));
    assert.equal(fs.statSync(journalAt(p)).mode & 0o777, 0o600);
    assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_RECOVERY_REQUIRED'));
    const rec = planInstructionMergeRecovery(p.merge());
    assert.match(rec.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(rec.restore.map(r => r.path), plan.files.map(f => f.path));
    await assert.rejects(applyInstructionMergeRecovery(p.merge(), '0'.repeat(64)), code('ADOPTION_STALE_APPROVAL'));
    await applyInstructionMergeRecovery(p.merge(), rec.revision);
    assert.equal(fs.existsSync(journalAt(p)), false);
    assert.ok(fs.readFileSync(path.join(p.def, 'harness.json')).equals(harness));
    if (noDefaults) assert.equal(fs.existsSync(path.join(p.def, 'instructions')), false);
    else assert.equal(instructionsOf(p), INSTRUCTIONS);
    assert.equal(loadDefinition(p.def).definition.revision, original);
    assert.throws(() => planInstructionMergeRecovery(p.merge()), code('ADOPTION_RECOVER_NOTHING'));
    assert.equal(planInstructionMerge(p.merge()).revision, plan.revision, 'the merge can run again');
  }
});

test('recovery keeps a file that changed after the crash', async t => {
  const p = merging(t);
  const plan = planInstructionMerge(p.merge()), err = crash();
  await assert.rejects(applyInstructionMergeWith(p.merge(), plan.revision, signal(), { afterWrite: () => { throw err; } }), e => e === err);
  fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'A person fixed it by hand.\n');
  const rec = planInstructionMergeRecovery(p.merge());
  assert.deepEqual(rec.restore, []);
  assert.deepEqual(rec.kept, [{ path: '.bowerloom/instructions/AGENTS.md', reason: 'changed' }]);
  await applyInstructionMergeRecovery(p.merge(), rec.revision);
  assert.equal(instructionsOf(p), 'A person fixed it by hand.\n');
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('merge, then install with accept-agents, gives CLAUDE.md as @AGENTS.md; removal restores the original CLAUDE.md', async t => {
  const p = merging(t);
  const claudeBefore = fs.readFileSync(path.join(p.dir, 'CLAUDE.md'));
  assert.throws(() => planPortable(p.input({ reconcile: 'merge' })), code('PORTABLE_MERGE_NOT_BUILT'), 'install itself still never merges');
  const plan = planInstructionMerge(p.merge());
  await applyInstructionMerge(p.merge(), plan.revision);
  const { plan: install } = await projectNow(p.input({ reconcile: 'accept-agents' }));
  assert.equal(install.reconcile, 'accept-agents');
  assert.equal(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.ok(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8').includes(`## ${MERGE_HEADING}\n\n${CLAUDE}`));
  const removal = planPortableRemoval(p.input());
  await applyPortableRemoval(p.input(), removal.revision);
  assert.ok(fs.readFileSync(path.join(p.dir, 'CLAUDE.md')).equals(claudeBefore), 'byte for byte');
  assert.equal(fs.statSync(path.join(p.dir, 'CLAUDE.md')).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(path.join(p.dir, 'AGENTS.md')), false);
});

test('a CLAUDE.md that links outside the project is refused as unsafe', t => {
  const p = merging(t, {}, null);
  fs.writeFileSync(path.join(p.base, 'elsewhere.md'), CLAUDE);
  fs.symlinkSync(path.join(p.base, 'elsewhere.md'), path.join(p.dir, 'CLAUDE.md'));
  assert.throws(() => planInstructionMerge(p.merge()), e => e.code === 'ADOPTION_PATH_UNSAFE' && e.paths.includes('CLAUDE.md'));
});

test('a file that a person writes at a target after the plan is never overwritten; the merge puts back what it wrote', async t => {
  const p = merging(t, { noDefaults: true });
  const harness = fs.readFileSync(path.join(p.def, 'harness.json'));
  const plan = planInstructionMerge(p.merge());
  await assert.rejects(applyInstructionMergeWith(p.merge(), plan.revision, signal(), {
    beforeWrite: rel => { if (rel === '.bowerloom/harness.json') fs.writeFileSync(path.join(p.def, 'harness.json'), harness.toString().replace('A demo', 'An edited')); },
  }), code('ADOPTION_STALE_APPROVAL'));
  assert.match(fs.readFileSync(path.join(p.def, 'harness.json'), 'utf8'), /An edited harness/);
  assert.equal(fs.existsSync(path.join(p.def, 'instructions')), false);
  assert.equal(fs.existsSync(journalAt(p)), false);
});

test('a damaged merge journal is only cleared, and the plan lists the files to check by hand', async t => {
  const p = merging(t);
  fs.mkdirSync(p.adoptState, { recursive: true, mode: 0o700 });
  fs.writeFileSync(journalAt(p), '{ not json', { mode: 0o600 });
  assert.throws(() => planInstructionMerge(p.merge()), code('ADOPTION_RECOVERY_REQUIRED'));
  const rec = planInstructionMergeRecovery(p.merge());
  assert.equal(rec.journal, 'damaged');
  assert.deepEqual(rec.check, ['.bowerloom/instructions/AGENTS.md', '.bowerloom/harness.json']);
  await applyInstructionMergeRecovery(p.merge(), rec.revision);
  assert.equal(fs.existsSync(journalAt(p)), false);
  assert.equal(instructionsOf(p), INSTRUCTIONS);
});
