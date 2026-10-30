// A tree that 0.7's own startup scaffold set up must adopt. The scaffold names its personal assistant skill
// `bowerloom-personal-assistant` in a folder `personal-assistant`, and the definition needs the folder name. Adoption
// translates the name, says so in the plan, asks for a confirmation, and changes nothing but the `name:` line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { scaffold as beta2 } from '../../../dist/packages/startup/src/scaffold-v1beta2.js';
import { scaffold as alpha1 } from '../../../dist/packages/startup/src/scaffold-v1alpha1.js';
import { applyAdoption, applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../dist/packages/adoption/src/index.js';
import { applyAdoptionWith } from '../../../dist/packages/adoption/src/apply.js';
import { code, item, project, sha, skill, snapshot } from './fixture.mjs';

const BRIEF = { projectName: 'Demo project', goal: 'Review the demo notes.', assistantName: 'Personal assistant', teamName: 'First team', reviewMode: 'milestones', profile: 'engineer' };
const FOLDER = '.bowerloom/skills/personal-assistant';
const FILE = `${FOLDER}/SKILL.md`;
const OLD = 'bowerloom-personal-assistant', NEW = 'personal-assistant';
const ENGINES = { engines: [{ id: 'claude-code' }] };

const SCAFFOLDS = [['v1beta2', beta2, BRIEF], ['v1alpha1', alpha1, { ...BRIEF, profile: undefined }]];
const tree = (scaffold, brief) => ({ 'AGENTS.md': '# Demo\n', ...Object.fromEntries(scaffold(brief).files.map(f => [`.bowerloom/${f.path}`, f.text])) });
const run = async (p, input = p.input(ENGINES), hooks = {}) => {
  const plan = planAdoption(input);
  return applyAdoptionWith(input, plan.revision, plan.approvalsRequired, new AbortController().signal, hooks);
};

for (const [label, scaffold, brief] of SCAFFOLDS) {
  test(`${label}: the scaffold's skill is planned as translated, with the old and new name, and the plan writes nothing`, t => {
    const p = project(t, tree(scaffold, brief));
    const original = fs.readFileSync(path.join(p.dir, FILE));
    assert.match(original.toString(), new RegExp(`^---\\nname: ${OLD}\\n`), 'the fixture is the real scaffold output');
    const before = snapshot(p.dir);
    const plan = planAdoption(p.input(ENGINES));
    assert.equal(plan.ready, true, JSON.stringify(plan.problems));
    assert.deepEqual(snapshot(p.dir), before);
    const it = item(plan, 'skills', NEW);
    assert.deepEqual(it.translated, { from: OLD, to: NEW });
    assert.ok(it.notes.some(n => n.includes(OLD) && n.includes(NEW)), `a line names both: ${JSON.stringify(it.notes)}`);
    assert.equal(it.needsApproval.length, 1, 'rewriting a 0.7 file needs a confirmation');
    assert.deepEqual(plan.approvalsRequired, ['skills/personal-assistant']);
    assert.deepEqual(plan.files.filter(f => f.replaces !== undefined).map(f => [f.path, f.replaces]), [[`skills/${NEW}/SKILL.md`, sha(original)]]);
  });

  test(`${label}: apply rewrites only the name line, the definition loads, and every other 0.7 file is untouched`, async t => {
    const p = project(t, tree(scaffold, brief));
    const original = fs.readFileSync(path.join(p.dir, FILE), 'utf8');
    const before = snapshot(p.dir);
    const input = p.input(ENGINES), plan = planAdoption(input);
    await assert.rejects(applyAdoption(input, plan.revision, []), code('ADOPTION_APPROVAL_REQUIRED'));
    assert.deepEqual(snapshot(p.dir), before, 'a refused apply changes nothing');
    const done = await applyAdoption(input, plan.revision, plan.approvalsRequired);
    assert.ok(done.written.includes(`skills/${NEW}/SKILL.md`));
    const after = snapshot(p.dir);
    for (const k of Object.keys(before)) if (k !== FILE) assert.equal(after[k], before[k], `${k} changed`);
    assert.equal(fs.readFileSync(path.join(p.dir, FILE), 'utf8'), original.replace(`name: ${OLD}\n`, `name: ${NEW}\n`));
    assert.equal(fs.statSync(path.join(p.dir, FILE)).mode & 0o777, 0o644);
    const r = loadDefinition(p.def);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.definition.entries.skills.map(s => s.id), [NEW]);
    assert.equal(fs.existsSync(path.join(p.stateDir, 'adoption-pending.json')), false);
    // The tree is a definition now, and a second plan says so.
    assert.throws(() => planAdoption(input), code('ADOPTION_DEFINED'));
  });
}

test('a file that changed after the plan is never rewritten', async t => {
  const p = project(t, tree(beta2, BRIEF));
  const input = p.input(ENGINES), plan = planAdoption(input);
  fs.appendFileSync(path.join(p.dir, FILE), 'An edit after the plan.\n');
  const edited = fs.readFileSync(path.join(p.dir, FILE));
  await assert.rejects(applyAdoption(input, plan.revision, plan.approvalsRequired), code('ADOPTION_STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(path.join(p.dir, FILE)), edited);
  assert.equal(fs.existsSync(p.def + '/harness.json'), false);
});

test('a failure after the rewrite puts the original bytes and mode back and removes what was written', async t => {
  const p = project(t, tree(beta2, BRIEF));
  fs.chmodSync(path.join(p.dir, FILE), 0o600);
  const original = fs.readFileSync(path.join(p.dir, FILE));
  const before = snapshot(p.dir);
  await assert.rejects(run(p, p.input(ENGINES), { beforeWrite: rel => { if (rel === '.bowerloom/harness.json') throw new Error('stop'); } }), /stop/);
  assert.deepEqual(fs.readFileSync(path.join(p.dir, FILE)), original);
  assert.equal(fs.statSync(path.join(p.dir, FILE)).mode & 0o777, 0o600);
  const after = snapshot(p.dir);
  assert.deepEqual(Object.keys(after), Object.keys(before), 'nothing added, nothing removed');
  for (const k of Object.keys(before)) if (k !== FILE) assert.equal(after[k], before[k], `${k} changed`);
  assert.equal(fs.existsSync(path.join(p.stateDir, 'adoption-pending.json')), false);
});

test('a crash after the rewrite leaves the journal; recovery removes what adoption created and never the 0.7 skill', async t => {
  const p = project(t, tree(beta2, BRIEF));
  await assert.rejects(run(p, p.input(ENGINES), { beforeWrite: rel => { if (rel === '.bowerloom/harness.json') throw Object.assign(new Error('killed'), { crash: true }); } }), /killed/);
  assert.equal(fs.existsSync(path.join(p.stateDir, 'adoption-pending.json')), true);
  assert.throws(() => planAdoption(p.input(ENGINES)), code('ADOPTION_RECOVERY_REQUIRED'));
  const recovery = planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir });
  assert.equal(recovery.remove.includes(FILE), false, 'the 0.7 skill is never in the removal list');
  await applyAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }, recovery.revision);
  assert.equal(fs.existsSync(path.join(p.dir, FILE)), true);
  assert.equal(fs.existsSync(p.def + '/harness.json'), false);
  // The name line is already the folder name, so the next plan has nothing to translate and adopts cleanly.
  const again = planAdoption(p.input(ENGINES));
  assert.equal(again.ready, true, JSON.stringify(again.problems));
  assert.equal(item(again, 'skills', NEW).translated, undefined);
  assert.deepEqual(again.approvalsRequired, []);
});

test('other faults of a 0.7 skill still refuse, name mismatch or not', t => {
  const cases = {
    'a name that differs and another field': skill('other-name', 'allowed-tools: Read\n'),
    'a name that differs and a key the definition cannot hold': skill('other-name', 'model: sonnet\n'),
    'a name that is not an id': skill('Not An Id'),
    'no description': '---\nname: other-name\n---\n\nBody.\n',
  };
  for (const [label, text] of Object.entries(cases)) {
    const p = project(t, { '.bowerloom/skills/house-style/SKILL.md': text });
    assert.throws(() => planAdoption(p.input(ENGINES)), code('ADOPTION_LEGACY_SKILL'), label);
  }
  const folder = project(t, { '.bowerloom/skills/Bad_Folder/SKILL.md': skill('bad-folder') });
  assert.throws(() => planAdoption(folder.input(ENGINES)), e => e.code === 'ADOPTION_LEGACY_SKILL');
});

test('a name that differs only in the name line adopts under the folder name for any 0.7 skill, with its files kept', async t => {
  const p = project(t, {
    '.bowerloom/skills/house-style/SKILL.md': skill('acme-house-style', '# a comment\n', 'Use the house style.\n'),
    '.bowerloom/skills/house-style/references/notes.md': 'Notes.\n',
  });
  const notes = fs.readFileSync(path.join(p.dir, '.bowerloom/skills/house-style/references/notes.md'));
  const input = p.input(ENGINES), plan = planAdoption(input);
  assert.deepEqual(item(plan, 'skills', 'house-style').translated, { from: 'acme-house-style', to: 'house-style' });
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  assert.equal(fs.readFileSync(path.join(p.dir, '.bowerloom/skills/house-style/SKILL.md'), 'utf8'), skill('house-style', '# a comment\n', 'Use the house style.\n'));
  assert.deepEqual(fs.readFileSync(path.join(p.dir, '.bowerloom/skills/house-style/references/notes.md')), notes);
  assert.equal(loadDefinition(p.def).ok, true);
});
