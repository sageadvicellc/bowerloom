// A folder with no engine files becomes a harness through the same plan, apply, and journal as any other folder: the
// Builder's "New harness" opens "From a folder", so this is the one path to a definition for an empty folder.
// The definition is `harness.json` alone, with no parts. A folder with an AGENTS.md also gets its instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAdoption, planAdoption, JOURNAL } from '../../../dist/packages/adoption/src/index.js';
import { applyAdoptionWith } from '../../../dist/packages/adoption/src/apply.js';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { INSTRUCTIONS, code, project, read, snapshot } from './fixture.mjs';

const WARNED = /No engine file names an engine/;

test('an empty folder plans a definition of harness.json alone, ready, with no parts and the 0.7 default engines', t => {
  const p = project(t);
  const plan = planAdoption(p.input());
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.files.map(f => f.path), ['harness.json']);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.unmapped, []);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.approvalsRequired, []);
  assert.deepEqual(plan.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.match(plan.warnings.join('\n'), WARNED);
  assert.deepEqual(fs.readdirSync(p.dir), [], 'planning writes nothing in the folder');
});

test('apply writes the empty definition, it loads with no entries, and the journal is gone after it', async t => {
  const p = project(t);
  const plan = planAdoption(p.input());
  const done = await applyAdoption(p.input(), plan.revision, []);
  assert.deepEqual(done.written, ['harness.json']);
  const harness = JSON.parse(read(p.def, 'harness.json'));
  assert.deepEqual(harness.parts, {});
  assert.deepEqual(harness.engines, [{ id: 'claude-code' }, { id: 'codex' }]);
  assert.equal(harness.id, 'project', 'the id is the folder name');
  const loaded = loadDefinition(p.def);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.problems ?? []));
  const e = loaded.definition.entries;
  assert.deepEqual([e.skills.length, e.subagents.length, e.hooks.length, e.mcp.length], [0, 0, 0, 0]);
  assert.equal(loaded.definition.revision, done.revision);
  assert.equal(fs.existsSync(path.join(p.stateDir, JOURNAL)), false, 'the journal of the run is removed once the definition is written');
  assert.deepEqual(Object.keys(snapshot(p.dir)).sort(), ['.bowerloom/', '.bowerloom/harness.json']);
  // A second plan refuses: the folder holds a definition now.
  assert.throws(() => planAdoption(p.input()), code('ADOPTION_DEFINED'));
});

test('a folder with files but no engine files plans the same empty definition, and leaves every file as it was', async t => {
  const p = project(t, { 'README.md': '# Notes\n', 'src/index.js': 'export {};\n' });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input());
  assert.deepEqual(plan.files.map(f => f.path), ['harness.json']);
  assert.match(plan.warnings.join('\n'), WARNED);
  await applyAdoption(p.input(), plan.revision, []);
  const after = snapshot(p.dir);
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, k);
  assert.equal(loadDefinition(p.def).ok, true);
});

test('a folder that holds only AGENTS.md plans harness.json and its instructions, with no other part', async t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS });
  const plan = planAdoption(p.input());
  assert.deepEqual(plan.files.map(f => f.path), ['harness.json', 'instructions/AGENTS.md']);
  await applyAdoption(p.input(), plan.revision, []);
  assert.deepEqual(JSON.parse(read(p.def, 'harness.json')).parts, { 'system-prompt': 'instructions/AGENTS.md' });
  assert.equal(read(p.def, 'instructions/AGENTS.md'), INSTRUCTIONS);
  const loaded = loadDefinition(p.def);
  assert.equal(loaded.ok, true);
  assert.deepEqual([loaded.definition.entries.skills.length, loaded.definition.entries.subagents.length], [0, 0]);
});

test('a run on an empty folder that stops before harness.json leaves no definition, and keeps the journal for the recovery', async t => {
  const p = project(t);
  const plan = planAdoption(p.input());
  await assert.rejects(applyAdoptionWith(p.input(), plan.revision, [], new AbortController().signal, {
    beforeWrite: rel => { if (rel === '.bowerloom/harness.json') throw Object.assign(new Error('the process stopped'), { crash: true }); },
  }));
  assert.equal(fs.existsSync(path.join(p.def, 'harness.json')), false, 'harness.json is written last, so a stopped run leaves no definition');
  assert.equal(fs.existsSync(path.join(p.stateDir, JOURNAL)), true);
  assert.throws(() => planAdoption(p.input()), code('ADOPTION_RECOVERY_REQUIRED'));
});
