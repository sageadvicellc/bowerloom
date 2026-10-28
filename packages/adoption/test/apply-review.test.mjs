// Review rulings A11, A13 (apply mutants), A16, and A20: harness.json is written last, a journal in the state folder
// lists the planned files, a stopped run is recovered after a person approves the recovery plan, and every failure
// says what caused it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../dist/packages/adoption/src/index.js';
import { applyAdoptionWith } from '../../../dist/packages/adoption/src/apply.js';
import { INSTRUCTIONS, code, json, project, skill } from './fixture.mjs';

const TWO = [{ id: 'claude-code' }, { id: 'codex' }];
const files = { 'AGENTS.md': INSTRUCTIONS, '.claude/skills/review/SKILL.md': skill('review'), '.claude/skills/review/references/notes.md': 'Notes.\n' };
const run = (p, plan, hooks, signal = new AbortController().signal) => applyAdoptionWith(p.input({ engines: TWO }), plan.revision, plan.approvalsRequired, signal, hooks);
const crash = () => Object.assign(new Error('simulated crash'), { crash: true });

test('A11: harness.json is written last, so a stopped run leaves no definition; a journal lists what was written', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  const order = [];
  await run(p, plan, { beforeWrite: rel => order.push(rel) });
  assert.equal(order.at(-1), '.bowerloom/harness.json');
  assert.deepEqual(fs.readdirSync(p.stateDir), [], 'a finished run leaves no journal');
});

test('A11: after a crash, the plan asks for recovery; recovery removes exactly the journaled files after approval', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  await assert.rejects(run(p, plan, { beforeWrite: rel => { if (rel === '.bowerloom/skills/review/references/notes.md') throw crash(); } }), /simulated crash/);
  assert.equal(fs.existsSync(path.join(p.def, 'harness.json')), false);
  assert.equal(fs.existsSync(path.join(p.def, 'instructions/AGENTS.md')), true);
  assert.throws(() => planAdoption(p.input({ engines: TWO })), code('ADOPTION_RECOVERY_REQUIRED'));
  // A person adds a file of their own beside the written ones; recovery leaves it.
  fs.writeFileSync(path.join(p.def, 'skills/review/mine.md'), 'mine\n');
  const recovery = planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir });
  assert.deepEqual(recovery.remove, ['.bowerloom/instructions/AGENTS.md', '.bowerloom/skills/review/SKILL.md']);
  assert.match(recovery.revision, /^[a-f0-9]{64}$/);
  await assert.rejects(applyAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }, 'f'.repeat(64)), code('ADOPTION_STALE_APPROVAL'));
  const done = await applyAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }, recovery.revision);
  assert.deepEqual(done.removed, recovery.remove);
  assert.equal(fs.existsSync(path.join(p.def, 'instructions')), false);
  assert.equal(fs.readFileSync(path.join(p.def, 'skills/review/mine.md'), 'utf8'), 'mine\n');
  assert.deepEqual(fs.readdirSync(p.stateDir), []);
  assert.throws(() => planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }), code('ADOPTION_RECOVER_NOTHING'));
});

test('A11, C8: a journal that names another project or holds a path outside .bowerloom is damaged: recovery clears it only', async t => {
  const p = project(t, files);
  fs.mkdirSync(p.stateDir, { recursive: true, mode: 0o700 });
  const journal = path.join(p.stateDir, 'adoption-pending.json');
  fs.writeFileSync(journal, json({ format: 'bowerloom/adoption-pending/v1beta1', projectDir: p.dir, planRevision: 'a'.repeat(64), files: [{ path: '../AGENTS.md', sha256: 'b'.repeat(64) }], dirs: [] }), { mode: 0o600 });
  assert.deepEqual(planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }).journal, 'damaged');
  fs.writeFileSync(journal, json({ format: 'bowerloom/adoption-pending/v1beta1', projectDir: '/elsewhere', planRevision: 'a'.repeat(64), files: [], dirs: [] }), { mode: 0o600 });
  const damaged = planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir });
  assert.deepEqual([damaged.journal, damaged.remove], ['damaged', []]);
});

test('A16: when apply cannot remove what it wrote, ADOPTION_PARTIAL carries the code of the error that stopped it', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  await assert.rejects(run(p, plan, {
    beforeWrite: rel => {
      if (rel !== '.bowerloom/skills/review/references/notes.md') return;
      fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'changed by a person\n');
      fs.writeFileSync(path.join(p.dir, rel), 'appeared\n');
    },
  }), e => e?.code === 'ADOPTION_PARTIAL' && e.original === 'ADOPTION_STALE_APPROVAL' && /ADOPTION_STALE_APPROVAL/.test(e.message));
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), 'changed by a person\n');
  assert.ok(fs.existsSync(path.join(p.stateDir, 'adoption-pending.json')), 'the journal stays for recovery');
});

test('A20: a folder is tracked from the moment it is made, so a failure right after mkdir still removes it', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  await assert.rejects(run(p, plan, { afterMkdir: rel => { if (rel === '.bowerloom/skills') throw Object.assign(new Error('mkdir hook'), { code: 'EIO' }); } }), e => typeof e?.code === 'string');
  assert.equal(fs.existsSync(path.join(p.def, 'skills')), false);
  assert.equal(fs.existsSync(path.join(p.def, 'instructions')), false);
});

test('A13: a signal that aborts part way stops apply and removes what it wrote', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  const ac = new AbortController();
  await assert.rejects(run(p, plan, { beforeWrite: rel => { if (rel === '.bowerloom/skills/review/SKILL.md') ac.abort(); } }, ac.signal), code('ADOPTION_ABORTED'));
  assert.deepEqual(fs.existsSync(path.join(p.def, 'instructions/AGENTS.md')), false);
});

test('A13: a definition whose revision differs from the plan after the writes is removed, and a file a person added stays', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  await assert.rejects(run(p, plan, {
    beforeWrite: rel => {
      if (rel !== '.bowerloom/harness.json') return;
      fs.mkdirSync(path.join(p.def, 'skills/extra'));
      fs.writeFileSync(path.join(p.def, 'skills/extra/SKILL.md'), skill('extra'));
    },
  }), code('ADOPTION_STALE_APPROVAL'));
  assert.equal(fs.existsSync(path.join(p.def, 'harness.json')), false);
  assert.equal(fs.existsSync(path.join(p.def, 'skills/review')), false);
  assert.equal(fs.existsSync(path.join(p.def, 'skills/extra/SKILL.md')), true);
});

test('A13: a plan whose definition the loader refuses is not ready, and apply refuses it', async t => {
  const p = project(t, { '.mcp.json': json({ mcpServers: { docs: { command: 'npx', alwaysLoad: '${FLAG:-yes}' } } }) });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.ready, false);
  assert.ok(plan.problems.some(x => x.code === 'ENV_REFERENCE'));
  await assert.rejects(applyAdoptionWith(p.input({ engines: [{ id: 'claude-code' }] }), plan.revision, plan.approvalsRequired, new AbortController().signal, {}), code('ADOPTION_DEFINITION_INVALID'));
});
