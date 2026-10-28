// Spec 06 with spec 05 (spec 10, page section 2): in a project with bowerloom.json, a context slice is a project item only.
// bowerloom.json, the store and the lock never hold it, and the selection does not change an agent's guard or its slices.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { denyNetwork } from './sync-fixture.mjs';
import { writeConfig } from './config-fixture.mjs';
import { wikiProject, createSlice, sliceAgent, put, read, signal } from './slices-fixture.mjs';
import { planProjectApply, applyProjectApply, planConfigChange, resolveProject } from '../../../dist/packages/project-sync/src/index.js';
import { readLock } from '../../../dist/packages/project-config/src/index.js';
import { runLsCommand } from '../../../dist/apps/cli/src/ls.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const front = text => parse(text.split('\n---\n')[0].replace(/^---\n/, ''));
const input = f => f.input(['claude-code', 'codex'], { home: f.home });
const lead = p => p.agents.find(a => a.id === 'lead');

test('a project with bowerloom.json, a slice and a guarded agent plans and applies both, as a project without it does', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
  const before = await planProjectApply(input(f));
  assert.equal(before.config, null);
  writeConfig(f, { teams: [{ id: 'first-team', source: 'project' }] });
  const plan = await planProjectApply(input(f));
  assert.notEqual(plan.config, null);
  assert.deepEqual(plan.slices.map(s => [s.id, s.action, s.agents]), [['wiki', 'install', ['lead']]]);
  assert.deepEqual([lead(plan).action, lead(plan).context.slices, lead(plan).context.guard], ['install', ['wiki'], ['wiki']]);
  // The selection changes neither the slice nor the agent's context.
  assert.deepEqual(plan.slices, before.slices); assert.deepEqual(lead(plan).context, lead(before).context);
  const result = await applyProjectApply(input(f), plan.revision, signal());
  assert.deepEqual(result.applied.filter(a => a.kind === 'slice' || a.kind === 'agent').map(a => [a.kind, a.id, a.origin, a.resolvedFrom]).sort(), [['agent', 'lead', 'project', 'project'], ['slice', 'wiki', 'project', 'project']]);
  assert.match(read(f, '.claude/skills/slice-wiki/SKILL.md'), /wiki\/a\.md/);
  const hook = front(read(f, '.claude/agents/lead.md')).hooks.PreToolUse.at(-1);
  assert.equal(hook.hooks[0].command, 'bowerloom-guard'); assert.ok(hook.hooks[0].args.includes(f.projectDir), JSON.stringify(hook.hooks[0].args));
  assert.equal((await planProjectApply(input(f))).actionable, false);
});

test('a slice is never in bowerloom.json, the store, or the lock', async t => {
  const f = await wikiProject(t, { slice: false }); put(f, 'notes/a.md');
  const text = writeConfig(f, { teams: [{ id: 'first-team', source: 'project' }] });
  await createSlice(f, 'notes', { root: 'notes' });
  assert.equal(fs.readFileSync(path.join(f.projectDir, 'bowerloom.json'), 'utf8'), text, 'slice create adds no entry to bowerloom.json');
  const r = resolveProject({ project: f.project(), home: f.home, frozen: false });
  assert.equal([...r.skills, ...r.prompts, ...r.teams].some(i => i.id.includes('notes')), false);
  assert.equal(Object.hasOwn(r.unselected, 'slices'), false);
  await assert.rejects(planConfigChange({ project: f.project(), home: f.home, op: 'use', kind: 'slice', id: 'notes' }), e => e?.code === 'USAGE');
  for (const op of ['unuse', 'adopt']) await assert.rejects(planConfigChange({ project: f.project(), home: f.home, op, kind: 'slice', id: 'notes' }), e => e?.code === 'USAGE');
  assert.equal(readLock(f.project()).state, 'absent');
  assert.equal(fs.existsSync(path.join(f.home, '.bowerloom', 'slices')), false);
  // ls in config mode lists the slice as a project item.
  assert.match(runLsCommand(['ls'], f.projectDir, f.home), /^Slices\n {2}notes {2}project$/m);
  assert.deepEqual(JSON.parse(runLsCommand(['ls', 'slices', '--json'], f.projectDir, f.home)).slices, [{ id: 'notes', source: 'project', via: [], locked: null, resolvedFrom: 'project', state: 'ok' }]);
});
