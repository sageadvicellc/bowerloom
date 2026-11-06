// The read-only exports that the desktop viewer uses: folder grants and the agents of a project. Through the real binary for setup.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, project, EMPTY_CONFIG } from './support/config-cli.js';
import { discoverProject, listFolderGrants } from '../packages/project-context/src/index.js';
import { readProjectPlan } from '../apps/cli/src/viewer-read.js';
import { report } from '../apps/cli/src/store.js';

test('listFolderGrants lists the projects that hold a grant, reads only, and refuses a bad name', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG), other = project(w, 'other', EMPTY_CONFIG), notes = join(w.home, 'Notes'); mkdirSync(notes);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(dir, ['folder', 'add', 'notes', notes], w.env);
  assert.deepEqual(listFolderGrants(w.home, 'notes').projectIds, [], 'no grant yet');
  mustApprove(dir, ['folder', 'allow', 'notes'], w.env);
  assert.deepEqual(listFolderGrants(w.home, 'notes').projectIds, [discoverProject(dir, w.home).projectId]);
  assert.ok(!listFolderGrants(w.home, 'notes').projectIds.includes(discoverProject(other, w.home).projectId));
  assert.deepEqual(listFolderGrants(w.home, 'missing').projectIds, []);
  assert.throws(() => listFolderGrants(w.home, '../x'), (e: unknown) => (e as { code?: string }).code === 'FOLDER_NAME_INVALID');
  assert.equal(run(dir, ['folder', 'list'], w.env).status, 0);
});

test('listFolderGrants gives an empty list when there is no store', t => {
  const w = world(t); assert.deepEqual(listFolderGrants(w.home, 'notes').projectIds, []);
});

test('readProjectPlan returns the agents of the project teams, with their notices, and never writes', async t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  mustApprove(dir, ['team', 'create', 'crew'], w.env);
  const agents = join(dir, '.bowerloom', 'teams', 'crew', 'agents'); mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'helper.md'), '---\nname: helper\ndescription: Helps.\n---\n\nHelp.\n');
  writeFileSync(join(agents, 'boss.md'), '---\nname: boss\ndescription: Decides.\npermissionMode: bypassPermissions\n---\n\nDecide.\n');
  const plan = await readProjectPlan(discoverProject(dir, w.home), w.env as NodeJS.ProcessEnv, w.home);
  assert.deepEqual(plan.agents.map(a => a.id).sort(), ['boss', 'helper']);
  assert.ok(plan.agents.find(a => a.id === 'boss')!.notices.includes('permissionMode:bypassPermissions'));
  assert.equal(plan.agents.find(a => a.id === 'boss')!.hold!.code, 'AGENT_GRANT_REVIEW_REQUIRED');
  assert.equal(plan.agents.find(a => a.id === 'helper')!.hold, null);
  assert.deepEqual(plan.held.map(h => h.id), ['boss']);
});

test('readProjectPlan on a folder with no .bowerloom is empty', async t => {
  const w = world(t), dir = project(w, 'plain', EMPTY_CONFIG), plan = await readProjectPlan(discoverProject(dir, w.home), w.env as NodeJS.ProcessEnv, w.home);
  assert.deepEqual(plan, { agents: [], prompts: [], skills: [], slices: [], held: [], unavailable: null });
});

test('the store report that store status prints is exported and gives the same state', t => {
  const w = world(t);
  assert.equal(report(w.home).state, 'absent');
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const r = report(w.home); assert.equal(r.state, 'store'); assert.equal(r.counts!.skillFolders.n, 1);
});
