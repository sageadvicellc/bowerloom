// Mode drift meets install (step 5, decision D5A, round 2): the install's drift refusal names a mode-only difference
// `mode`, and a mode a person recorded survives a later install while the content still matches the plan.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { assert, project, projectNow } from './portable-fixture.mjs';

const PERSON = 'The person\'s rules.\n';
const NOTES = '.agents/skills/review/references/notes.md';
const modeOf = (p, rel) => fs.statSync(path.join(p.dir, rel)).mode & 0o777;
const modesFile = p => path.join(p.stateDir, 'modes.json');
async function applied(t) {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), PERSON); fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  await projectNow(p.input());
  return p;
}
async function record(p, paths) {
  const plan = planPortableRecovery(p.input({ recordMode: paths }));
  await applyPortableRecovery(p.input({ recordMode: paths }), plan.revision);
}
const changeOf = (plan, rel) => plan.changes.find(c => c.path === rel);

test('the install drift refusal says mode for a mode-only difference and changed for a content change', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DRIFT' && /AGENTS\.md \(mode\)/.test(e.message) && !/\(changed\)/.test(e.message));
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Edited.\n');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DRIFT' && /AGENTS\.md \(changed\)/.test(e.message));
});

test('recordMode, then install keeps the recorded mode and stays a no-op; removal restores the original file and mode', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await record(p, ['AGENTS.md']);
  const plan = planPortable(p.input());
  assert.equal(plan.noop, true);
  assert.equal(changeOf(plan, 'AGENTS.md').action, 'unchanged');
  assert.equal(changeOf(plan, 'AGENTS.md').after.mode, 0o640);
  const stamp = fs.statSync(path.join(p.dir, 'AGENTS.md')).ino;
  const { result } = await projectNow(p.input());
  assert.equal(result.noop, true);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o640, 'no chmod back');
  assert.equal(fs.statSync(path.join(p.dir, 'AGENTS.md')).ino, stamp, 'the file is not rewritten');
  assert.equal(planPortable(p.input()).noop, true, 'a second run stays a no-op');
  assert.deepEqual(portableDrift(p.input()), []);
  const removal = planPortableRemoval(p.input());
  await applyPortableRemoval(p.input(), removal.revision);
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), PERSON);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o600);
  assert.equal(fs.existsSync(modesFile(p)), false, 'removal clears the recorded modes');
});

test('the recorded mode survives an install that changes other files', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await record(p, ['AGENTS.md']);
  fs.writeFileSync(path.join(p.def, 'skills/review/references/notes.md'), 'New review notes.\n');
  const { plan } = await projectNow(p.input());
  assert.equal(changeOf(plan, NOTES).action, 'update');
  assert.equal(changeOf(plan, 'AGENTS.md').action, 'unchanged');
  assert.equal(modeOf(p, 'AGENTS.md'), 0o640);
  assert.equal(readPortableReceipt(p.input()).files.find(f => f.path === 'AGENTS.md').mode, 0o640);
  assert.equal(planPortable(p.input()).noop, true);
});

test('after recordMode, a content change in the definition follows the normal rules and writes the planned mode', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await record(p, ['AGENTS.md']);
  fs.appendFileSync(path.join(p.def, 'instructions/AGENTS.md'), '\nOne more fact.\n');
  const { plan } = await projectNow(p.input());
  assert.equal(changeOf(plan, 'AGENTS.md').action, 'update');
  assert.equal(changeOf(plan, 'AGENTS.md').after.mode, 0o644);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o644);
  assert.match(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), /One more fact/);
  const removal = planPortableRemoval(p.input());
  await applyPortableRemoval(p.input(), removal.revision);
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), PERSON);
  assert.equal(modeOf(p, 'AGENTS.md'), 0o600);
});

test('after recordMode, a mode change in the definition is an update to the new planned mode', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, NOTES), 0o600);
  await record(p, [NOTES]);
  assert.equal(planPortable(p.input()).noop, true);
  fs.chmodSync(path.join(p.def, 'skills/review/references/notes.md'), 0o755);
  const { plan } = await projectNow(p.input());
  assert.equal(changeOf(plan, NOTES).action, 'update');
  assert.equal(modeOf(p, NOTES), 0o755);
});

test('a second recordMode on the same path keeps the planned mode it was recorded against', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await record(p, ['AGENTS.md']);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  await record(p, ['AGENTS.md']);
  const plan = planPortable(p.input());
  assert.equal(plan.noop, true);
  assert.equal(changeOf(plan, 'AGENTS.md').after.mode, 0o600);
});

test('a damaged recorded-modes file is refused as an invalid state record', async t => {
  const p = await applied(t);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o640);
  await record(p, ['AGENTS.md']);
  const raw = JSON.parse(fs.readFileSync(modesFile(p), 'utf8'));
  raw.files[0].recorded = 0o666;
  fs.writeFileSync(modesFile(p), JSON.stringify(raw)); fs.chmodSync(modesFile(p), 0o600);
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_STATE_INVALID');
});
