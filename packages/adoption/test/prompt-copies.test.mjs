// A tree that Bowerloom 0.7 set up holds managed prompts: a catalog `prompt-<id>.json`, a Claude Code command, and a Codex
// skill folder `.agents/skills/prompt-<id>/`. Adoption records the prompt as a non-skill 0.7 item and reads its engine
// copies, so the Codex folder is adopted as a skill. Install then plans that same folder. The 0.7 files here come from the
// real 0.7 writer (`applyManagedItem`), so the shape is the one a 0.7 sync writes.
import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyManagedItem, } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { applyPortable, applyPortableRemoval, planPortable, planPortableRemoval } from '../../../dist/packages/project-sync/src/index.js';
import { project, prompt, request, promptSource } from '../../managed-skills/test/v2-fixture.mjs';
import { snapshot } from './fixture.mjs';

const TEXT = 'Summarize the open review comments.\n';
const ENGINES = [{ id: 'claude-code' }, { id: 'codex' }, { id: 'opencode' }];
const FOLDER = '.agents/skills/prompt-review';

/** A tree set up by the 0.7 writer, then adopted for three engines. */
async function adopted(t) {
  const f = project(t, '.bowerloom-prompt-copies-');
  prompt(f, 'review', TEXT);
  const req = request(f, { kind: 'prompt', id: 'review', source: promptSource('review') });
  const plan = await planManagedItem(req);
  assert.equal((await applyManagedItem(null, req, plan.revision)).state, 'committed');
  const adoption = { projectDir: f.projectDir, stateDir: path.join(f.base, 'state', 'adoption'), engines: ENGINES };
  const planned = planAdoption(adoption);
  assert.equal(planned.ready, true, JSON.stringify(planned.problems ?? planned.conflicts));
  await applyAdoption(adoption, planned.revision, planned.approvalsRequired);
  const portable = engines => ({ projectDir: f.projectDir, definitionFolder: path.join(f.projectDir, '.bowerloom'), stateDir: path.join(f.base, 'state', 'portable'), engines });
  return { f, planned, portable };
}
const under = (snap, prefix) => Object.fromEntries(Object.entries(snap).filter(([k]) => k === prefix || k.startsWith(prefix + '/')));

test('the 0.7 writer leaves a prompt catalog and a Codex skill folder, and adoption records the prompt as a non-skill item', async t => {
  const { f, planned } = await adopted(t);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.projectDir, '.bowerloom/managed/catalog/prompt-review.json'), 'utf8')).item.kind, 'prompt');
  assert.equal(fs.existsSync(path.join(f.projectDir, FOLDER, 'SKILL.md')), true);
  assert.deepEqual(planned.managed.map(m => [m.kind, m.id, m.skill]), [['prompt', 'review', null]]);
});

test('adopt then install to Codex and OpenCode takes over the prompt skill folder and writes nothing there', async t => {
  const { f, portable } = await adopted(t);
  const before = snapshot(f.projectDir);
  const plan = planPortable(portable([{ id: 'codex' }, { id: 'opencode' }]));
  assert.deepEqual(plan.changes.filter(c => c.path.startsWith(FOLDER + '/')).map(c => [c.path, c.action, c.engines]), [[`${FOLDER}/SKILL.md`, 'take-over', ['codex', 'opencode']]]);
  assert.deepEqual(plan.takenOver.filter(x => x.path.startsWith(FOLDER + '/')), [{ path: `${FOLDER}/SKILL.md` }]);
  await applyPortable(portable([{ id: 'codex' }, { id: 'opencode' }]), plan.revision);
  assert.deepEqual(under(snapshot(f.projectDir), FOLDER), under(before, FOLDER), 'the folder is byte, mode, and mtime exact');
  assert.equal(planPortable(portable([{ id: 'codex' }, { id: 'opencode' }])).noop, true);
});

test('install to OpenCode alone takes over the same folder and writes nothing there', async t => {
  const { f, portable } = await adopted(t);
  const before = snapshot(f.projectDir);
  const plan = planPortable(portable([{ id: 'opencode' }]));
  assert.deepEqual(plan.changes.filter(c => c.path.startsWith(FOLDER + '/')).map(c => [c.path, c.action, c.engines]), [[`${FOLDER}/SKILL.md`, 'take-over', ['opencode']]]);
  await applyPortable(portable([{ id: 'opencode' }]), plan.revision);
  assert.deepEqual(under(snapshot(f.projectDir), FOLDER), under(before, FOLDER));
  for (const rel of ['.bowerloom/managed/catalog/prompt-review.json', '.claude/commands/review.md']) assert.equal(snapshot(f.projectDir)[rel], before[rel], rel);
});

test('removal keeps the taken-over prompt folder byte for byte', async t => {
  const { f, portable } = await adopted(t);
  const before = snapshot(f.projectDir);
  const plan = planPortable(portable([{ id: 'codex' }, { id: 'opencode' }]));
  await applyPortable(portable([{ id: 'codex' }, { id: 'opencode' }]), plan.revision);
  const removal = planPortableRemoval(portable([{ id: 'codex' }, { id: 'opencode' }]));
  // The original is the current state, so the plan's restore is a keep: the result lists the path as kept and writes nothing.
  assert.deepEqual(removal.changes.filter(c => c.path.startsWith(FOLDER + '/')).map(c => [c.path, c.action]), [[`${FOLDER}/SKILL.md`, 'restore']]);
  const result = await applyPortableRemoval(portable([{ id: 'codex' }, { id: 'opencode' }]), removal.revision);
  assert.deepEqual([result.restored.filter(p => p.startsWith(FOLDER)), result.kept.filter(p => p.startsWith(FOLDER)), result.deleted.filter(p => p.startsWith(FOLDER))], [[], [`${FOLDER}/SKILL.md`], []]);
  assert.deepEqual(under(snapshot(f.projectDir), FOLDER), under(before, FOLDER));
  for (const rel of ['.bowerloom/managed/catalog/prompt-review.json', '.claude/commands/review.md']) assert.equal(snapshot(f.projectDir)[rel], before[rel], rel);
});

test('a prompt folder whose content would change still refuses PORTABLE_MANAGED_COPY, in words that are true for a prompt', async t => {
  const { f, portable } = await adopted(t);
  fs.writeFileSync(path.join(f.projectDir, FOLDER, 'SKILL.md'), fs.readFileSync(path.join(f.projectDir, FOLDER, 'SKILL.md'), 'utf8') + 'Edited by hand.\n');
  const before = snapshot(f.projectDir);
  for (const engines of [[{ id: 'codex' }], [{ id: 'opencode' }]]) {
    assert.throws(() => planPortable(portable(engines)), e => e.code === 'PORTABLE_MANAGED_COPY' && e.message.includes(`${FOLDER} (0.7 item prompt-review)`)
      && !/Adoption \(step 3\)/.test(e.message) && /0\.7 sync owns/.test(e.message) && /unchanged/.test(e.message));
  }
  assert.deepEqual(snapshot(f.projectDir), before, 'a refusal writes nothing');
});

test('a prompt folder with an extra file, or one file missing, is not the same folder and still refuses', async t => {
  const { f, portable } = await adopted(t);
  fs.writeFileSync(path.join(f.projectDir, FOLDER, 'extra.md'), 'Extra.\n');
  assert.throws(() => planPortable(portable([{ id: 'codex' }])), e => e.code === 'PORTABLE_MANAGED_COPY');
  fs.rmSync(path.join(f.projectDir, FOLDER, 'extra.md'));
  fs.rmSync(path.join(f.projectDir, FOLDER, 'SKILL.md'));
  assert.throws(() => planPortable(portable([{ id: 'codex' }])), e => e.code === 'PORTABLE_MANAGED_COPY');
});

test('a forged marker and catalog over identical bytes are taken over without a write', t => {
  const f = project(t, '.bowerloom-prompt-forged-');
  const skill = '---\nname: prompt-x\ndescription: A synthetic skill.\n---\nBody.\n';
  fs.mkdirSync(path.join(f.projectDir, '.agents/skills/prompt-x'), { recursive: true });
  fs.writeFileSync(path.join(f.projectDir, '.agents/skills/prompt-x/SKILL.md'), skill);
  fs.mkdirSync(path.join(f.projectDir, '.bowerloom/managed/catalog'), { recursive: true });
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed/catalog/prompt-x.json'), '{}\n');
  const adoption = { projectDir: f.projectDir, stateDir: path.join(f.base, 'state', 'adoption'), engines: [{ id: 'codex' }] };
  const planned = planAdoption(adoption);
  return applyAdoption(adoption, planned.revision, planned.approvalsRequired).then(async () => {
    const input = { projectDir: f.projectDir, definitionFolder: path.join(f.projectDir, '.bowerloom'), stateDir: path.join(f.base, 'state', 'portable'), engines: [{ id: 'codex' }] };
    const before = snapshot(f.projectDir);
    const plan = planPortable(input);
    assert.deepEqual(plan.changes.filter(c => c.path.startsWith('.agents/skills/prompt-x/')).map(c => c.action), ['take-over']);
    await applyPortable(input, plan.revision);
    assert.deepEqual(under(snapshot(f.projectDir), '.agents/skills/prompt-x'), under(before, '.agents/skills/prompt-x'));
  });
});
