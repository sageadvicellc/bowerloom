// Decision 1 on sageadvicellc/bowerloom#80 (comment 6351449744), variant A: team adopt also takes a store team that
// bowerloom.json does not list yet. One approved plan copies the team and lists it as a project item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configWorld, writeConfig, writeLock, storeItem, pushStore, lockOfRepo, code } from '../../project-sync/test/config-fixture.mjs';
import { planAdopt, applyAdopt, resolveProject, planConfigChange } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { renderAdopt } from '../../../dist/apps/cli/src/adopt.js';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';

const readJson = (w, rel) => JSON.parse(fs.readFileSync(path.join(w.projectDir, rel), 'utf8'));
const input = (w, id = 'research') => ({ project: discoverProject(w.projectDir, w.home), home: w.home, stateRoot: w.stateRoot, id });
const applyPlan = (w, plan) => withProjectLock(w.projectDir, new AbortController().signal, held => applyAdopt(input(w), plan, plan.revision, held));
async function world(t, { folder = false, config = true } = {}) {
  const w = configWorld(t, { folder });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'notes', { teams: ['research'] }); await storeItem(w, 'prompt', 'brief', { teams: ['research'] });
  await storeItem(w, 'skill', 'shared-notes');
  if (config) writeConfig(w);
  return w;
}

test('fix 1. an unlisted store team: one plan copies it and lists it from the project; tagged store items stay in the store', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  assert.equal(plan.from, 'store'); assert.equal(plan.finishing, false); assert.notEqual(plan.create, null);
  assert.deepEqual(plan.config.adds, [{ kind: 'team', id: 'research', source: 'project', via: [] }]);
  assert.equal(plan.config.created, false); assert.equal(plan.config.lock, null); assert.deepEqual(plan.config.network.hosts, []);
  // Store skills and prompts tagged to the team are named, not picked. An untagged store skill is not named.
  assert.deepEqual(plan.storeOnly, ['prompt brief', 'skill notes']);
  assert.equal(plan.revision, createHash('sha256').update(canonicalJson({ create: plan.create.revision, config: plan.config.revision, storeOnly: plan.storeOnly })).digest('hex'));
  const result = await applyPlan(w, plan);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.deepEqual([readJson(w, 'bowerloom.json').skills, readJson(w, 'bowerloom.json').prompts], [[], []]);
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.lock.json')), false);
  assert.deepEqual(result.receipt.items.map(i => [i.kind, i.id, i.teams]), [['team', 'research', []]]);
  assert.deepEqual(result.storeOnly, ['prompt brief', 'skill notes']);
  // Adopted once, the team is a project item: a second adopt keeps the code, with words of its own (review C2).
  await assert.rejects(planAdopt(input(w)), e => e?.code === 'CONFIG_ITEM_NOT_SELECTED' && e.message === 'bowerloom.json already lists team research from the project.');
});

test('fix 1. a legacy project with no bowerloom.json: the plan creates it, lists what the project defines, and adds the team', async t => {
  const w = await world(t, { folder: true, config: false });
  // The project defines a skill named like a tagged store skill: it is a project item, so the plan does not name it.
  const make = { kind: 'skill', project: w.projectDir, name: 'notes', teams: [] }, made = await planCreate(make);
  await withProjectLock(w.projectDir, new AbortController().signal, held => applyCreate(make, made.revision, held));
  const plan = await planAdopt(input(w));
  assert.equal(plan.config.created, true); assert.equal(plan.config.bowerloomFolder, 'present'); assert.equal(plan.config.listed, 1);
  assert.deepEqual(plan.storeOnly, ['prompt brief']);
  const lines = renderAdopt(plan).split('\n');
  assert.equal(lines[0], 'Create bowerloom.json and list 1 items this project defines now, with the source project.');
  assert.ok(lines.includes('bowerloom.json adds: team research (project)'));
  await applyPlan(w, plan);
  const config = readJson(w, 'bowerloom.json');
  assert.deepEqual([config.teams, config.skills], [[{ id: 'research', source: 'project' }], [{ id: 'notes', source: 'project' }]]);
});

test('fix 1. a project with a lock: the lock stays as it is, and the plan reads no network', async t => {
  const w = await world(t), repo = pushStore(w);
  writeConfig(w, { skills: [{ id: 'shared-notes', source: 'store' }] });
  const lock = writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'shared-notes')] });
  const plan = await planAdopt(input(w));
  assert.deepEqual(plan.config.lock.adds, []); assert.deepEqual(plan.config.lock.removes, []); assert.deepEqual(plan.config.network.hosts, []);
  await applyPlan(w, plan);
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8'), lock);
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'shared-notes', source: 'store' }]);
});

test('fix 1. an id the store does not define refuses STORE_ITEM_NOT_FOUND; with no store, STORE_NOT_FOUND', async t => {
  const w = await world(t);
  // Review C1: the message names no command, because team adopt raises it too.
  await assert.rejects(planAdopt(input(w, 'ops')), e => e?.code === 'STORE_ITEM_NOT_FOUND' && e.message === 'The command named an item that the store does not define.');
  fs.renameSync(w.store, path.join(w.base, 'store-moved'));
  await assert.rejects(planAdopt(input(w)), code('STORE_NOT_FOUND'));
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom')), false);
});

test('fix 1. an unlisted adopt that stopped after the receipt finishes with only the config write', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw new Error('crash'); return original(from, to); };
  // Round 2 of PR 100, H2: the failure after the copy says the team was copied and how to finish.
  try { await assert.rejects(applyPlan(w, plan), /The team was copied\. Run bowerloom team adopt research again to finish\./); } finally { fs.renameSync = original; }
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, []);
  const again = await planAdopt(input(w));
  assert.equal(again.finishing, true); assert.equal(again.create, null);
  await applyPlan(w, again);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
});

test('fix 1. an unlisted adopt that stopped after the move and before the receipt finishes through the pending record', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  const link = fs.linkSync, rename = fs.renameSync, crash = to => String(to).endsWith(path.join('authoring', 'receipt.json'));
  fs.linkSync = (from, to) => { if (crash(to)) throw new Error('crash'); return link(from, to); };
  fs.renameSync = (from, to) => { if (crash(to)) throw new Error('crash'); return rename(from, to); };
  try { await assert.rejects(applyPlan(w, plan), /crash/); } finally { fs.linkSync = link; fs.renameSync = rename; }
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/authoring/pending.json')));
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  const again = await planAdopt(input(w));
  await applyPlan(w, again);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom/authoring/pending.json')), false);
});

// --- Round 2 of the reviews of PR 100. ---
const signal = () => new AbortController().signal;

test('H2. an unlisted adopt that failed after the copy says so, and finishes after the store team changed', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw Object.assign(new Error('disk'), { code: 'EIO' }); return original(from, to); };
  let error;
  try { error = await applyPlan(w, plan).then(() => null, e => e); } finally { fs.renameSync = original; }
  assert.ok(error, 'the run fails');
  assert.match(error.message, /The team was copied\. Run bowerloom team adopt research again to finish\.$/);
  assert.equal(error.next, 'bowerloom team adopt research');
  // The store team changes before the person runs it again.
  fs.writeFileSync(path.join(w.store, 'teams/research/notes.md'), '# A later store change\n', { mode: 0o600 });
  const again = await planAdopt(input(w));
  assert.equal(again.finishing, true); assert.equal(again.create, null);
  await applyPlan(w, again);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/notes.md')), false, 'the project keeps its copy');
});

test('H2. a read error of the recovery check propagates, and TEAM_EXISTS on the unlisted path names a next step', async t => {
  const w = await world(t);
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/research'), { recursive: true });
  await assert.rejects(planAdopt(input(w)), e => e?.code === 'TEAM_EXISTS' && typeof e.next === 'string' && e.next.includes('.bowerloom/teams/research') && e.next.includes('bowerloom use team research --project'));
  // A copy the receipt registers, whose folder cannot be read: the error is not taken for "no copy".
  const v = await world(t), first = await planAdopt(input(v));
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw Object.assign(new Error('disk'), { code: 'EIO' }); return original(from, to); };
  try { await applyPlan(v, first).catch(() => {}); } finally { fs.renameSync = original; }
  const folder = path.join(v.projectDir, '.bowerloom/teams/research'); fs.chmodSync(folder, 0o000);
  try { await assert.rejects(planAdopt(input(v)), e => e?.code !== 'TEAM_EXISTS'); } finally { fs.chmodSync(folder, 0o755); }
});

test('S1. a store whose teams folder is a link refuses STORE_UNSAFE for listed and unlisted adopt, and for the other readers', async t => {
  for (const target of ['outside', 'parent']) {
    for (const listed of [false, true]) {
      const w = await world(t);
      const teams = path.join(w.store, 'teams'), moved = path.join(w.base, `teams-${target}-${listed}`);
      fs.renameSync(teams, moved);
      fs.writeFileSync(path.join(moved, 'research', 'SECRET.md'), 'secret\n', { mode: 0o600 });
      if (target === 'outside') fs.symlinkSync(moved, teams);
      else { fs.mkdirSync(path.join(w.home, 'research')); fs.cpSync(path.join(moved, 'research'), path.join(w.home, 'research'), { recursive: true }); fs.symlinkSync('..', teams); }
      if (listed) writeConfig(w, { teams: [{ id: 'research', source: 'store' }] });
      await assert.rejects(planAdopt(input(w)), e => e?.code === 'STORE_UNSAFE' && /teams/.test(e.message), `${target} listed ${listed}`);
      assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research')), false);
      if (listed) assert.throws(() => resolveProject({ project: discoverProject(w.projectDir, w.home), home: w.home, frozen: false }), code('STORE_UNSAFE'));
      else await assert.rejects(planConfigChange({ project: discoverProject(w.projectDir, w.home), home: w.home, op: 'use', kind: 'team', id: 'research', signal: signal() }), code('STORE_UNSAFE'));
    }
  }
});

test('L2. tagged store items the store cannot use are named with a reason, and the result carries the names', async t => {
  const w = await world(t);
  fs.rmSync(path.join(w.store, 'skills/notes'), { recursive: true });
  const prompt = path.join(w.store, 'prompts/brief.md'), elsewhere = path.join(w.base, 'brief.md');
  fs.renameSync(prompt, elsewhere); fs.symlinkSync(elsewhere, prompt);
  const plan = await planAdopt(input(w));
  assert.deepEqual(plan.storeOnly, []);
  assert.deepEqual(plan.storeUnusable, ['prompt brief (its file is missing or is not a plain file)', 'skill notes (its folder is missing or is a link)']);
  assert.ok(renderAdopt(plan).split('\n').includes('Tagged to team research and not usable in the store: prompt brief (its file is missing or is not a plain file) and skill notes (its folder is missing or is a link).'));
  const result = await applyPlan(w, plan);
  assert.deepEqual(result.storeUnusable, plan.storeUnusable);
});
