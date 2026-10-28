// Review of e1bbce9 (L1, H1, CR3, L2, M4): every command that reads a project refuses by name when a file lists an engine
// with no writer. Nothing is dropped silently. A damaged stored engine list is a coded refusal, never a TypeError.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, planProjectApply, applyPointer } from '../../../dist/packages/project-sync/src/index.js';
import { fromWire, toWire } from '../../../dist/packages/project-sync/src/wire.js';
import { readProjectPlan } from '../../../dist/apps/cli/src/viewer-read.js';
import { denyNetwork, syncProject, writeManifest, localSkill, localEntry, exactTree } from './sync-fixture.mjs';
import { configWorld, writeConfig } from './config-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const refused = engine => error => error?.code === 'ENGINE_NO_WRITER' && error.message === `no writer for engine ${engine} yet`;
function manifestFile(f, engines) { const file = path.join(f.projectDir, '.bowerloom/skills.json'); fs.writeFileSync(file, JSON.stringify({ format: 'bowerloom/skills/v1beta1', engines, skills: [localEntry('house-style')] }, null, 2) + '\n', { mode: 0o644 }); fs.chmodSync(file, 0o644); }
const applyInput = (f, extra = {}) => ({ project: f.project(), stateRoot: f.stateRoot, engines: ['claude-code'], team: null, ...extra });

test('H1. apply refuses a skills.json that lists an engine with no writer, whatever engines the command asks for', async t => {
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const f = syncProject(t); localSkill(f, 'house-style'); manifestFile(f, ['claude-code', engine].sort());
    const before = exactTree(f.base);
    await assert.rejects(planProjectApply(applyInput(f)), refused(engine), engine);
    await assert.rejects(planProjectApply(applyInput(f, { agentsOnly: true })), refused(engine), `${engine}, agents only`);
    assert.deepEqual(exactTree(f.base), before);
  }
});

test('H1. apply and sync refuse a config-mode bowerloom.json that lists an engine with no writer', async t => {
  const w = configWorld(t); writeConfig(w, { engines: ['claude-code', 'pi'] });
  const input = { project: w.project(), stateRoot: w.stateRoot, home: w.home, engines: ['claude-code', 'codex'], team: null };
  await assert.rejects(planProjectApply(input), refused('pi'));
  await assert.rejects(planSync({ project: w.project(), stateRoot: w.stateRoot, home: w.home, team: null, offline: false }), refused('pi'));
});

test('L1. the viewer names the refusal and shows nothing as planned', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); manifestFile(f, ['claude-code', 'opencode']);
  const view = await readProjectPlan(f.project(), { HOME: f.home }, f.home);
  assert.equal(view.unavailable, 'ENGINE_NO_WRITER'); assert.deepEqual(view.skills, []);
});

test('CR3. an engine with no writer is refused before the order of the list is checked; a bad order of writers is still a usage error', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  await assert.rejects(planProjectApply(applyInput(f, { engines: ['pi', 'claude-code'] })), refused('pi'));
  await assert.rejects(planProjectApply(applyInput(f, { engines: ['codex', 'claude-code'] })), error => error?.code === 'USAGE');
});

test('L2 and M4. a damaged stored engine list is a coded refusal that names the record and the id', () => {
  assert.deepEqual(fromWire(['claude', 'codex'], 'a receipt'), ['claude-code', 'codex']);
  assert.deepEqual(toWire(['claude-code', 'codex']), ['claude', 'codex']);
  for (const [bad, shown] of [['hermes', '"hermes"'], ['x\u0000\u001b[31m', 'not plain text']]) {
    assert.throws(() => fromWire([bad], 'the catalog of house-style'), error => error?.code === 'MANAGED_SKILL_REFUSED' && !(error instanceof TypeError) && error.message.includes('the catalog of house-style') && error.message.includes(shown) && !/[\u0000\u001b]/.test(error.message), String(bad));
  }
});
