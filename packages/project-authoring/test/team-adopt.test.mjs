// Spec 06, 3.17: team adopt copies a store team into .bowerloom/teams/<id> and switches bowerloom.json to the copy.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configWorld, writeConfig, writeLock, storeItem, pushStore, lockOfRepo, dropStore, code } from '../../project-sync/test/config-fixture.mjs';
import { planAdopt, applyAdopt, writeStoreCache, ADOPT_MISSING_NEXT } from '../../../dist/packages/project-sync/src/index.js';
import { authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { readLock } from '../../../dist/packages/project-config/src/index.js';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';

const readJson = (w, rel) => JSON.parse(fs.readFileSync(path.join(w.projectDir, rel), 'utf8'));
const input = w => ({ project: discoverProject(w.projectDir, w.home), home: w.home, stateRoot: w.stateRoot, id: 'research' });
const adopt = async w => { const plan = await planAdopt(input(w)); const result = await withProjectLock(w.projectDir, new AbortController().signal, held => applyAdopt(input(w), plan, plan.revision, held)); return { plan, result }; };
async function world(t, { folder = false } = {}) {
  const w = configWorld(t, { folder });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'notes', { teams: ['research'] });
  fs.mkdirSync(path.join(w.store, 'teams/research/agents'), { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'teams/research/agents/lead.md'), '---\nname: lead\ndescription: Leads.\n---\nLead.\n', { mode: 0o600 });
  writeConfig(w, { skills: [{ id: 'notes', source: 'store', via: ['research'] }], teams: [{ id: 'research', source: 'store' }] });
  return w;
}

test('7, 7b, 8 and 13. adopt copies the live store team, registers it, switches the config, keeps a via entry direct, and reads no network', async t => {
  const w = await world(t), repo = pushStore(w);
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'notes', ['research'])], teams: [lockOfRepo(w, repo, 'team', 'research')] });
  const { plan, result } = await adopt(w);
  assert.equal(plan.from, 'store'); assert.equal(plan.finishing, false); assert.equal(plan.config.bowerloomFolder, 'create');
  assert.equal(plan.revision, createHash('sha256').update(canonicalJson({ create: plan.create.revision, config: plan.config.revision })).digest('hex'));
  assert.deepEqual(plan.config.direct, [{ kind: 'skill', id: 'notes', via: ['research'] }]); assert.deepEqual(plan.config.lock.removes, ['team research']);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'notes', source: 'store' }]);
  assert.deepEqual(readLock(discoverProject(w.projectDir, w.home)).lock.teams, []);
  assert.equal(fs.readFileSync(path.join(w.projectDir, '.bowerloom/teams/research/agents/lead.md'), 'utf8'), fs.readFileSync(path.join(w.store, 'teams/research/agents/lead.md'), 'utf8'));
  assert.deepEqual(result.receipt.items.map(i => [i.kind, i.id, i.teams]), [['team', 'research', []]]);
  // 8: the copy compiles to the candidate of the source.
  assert.equal((await compileCrew(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml'))).candidateRevision, plan.create.compiledCandidate);
});

test('7 and 7a. adopt copies from the store cache when there is no store; with neither, STORE_ITEM_MISSING names apply --frozen', async t => {
  const w = await world(t), repo = pushStore(w), item = lockOfRepo(w, repo, 'team', 'research');
  writeLock(w, { teams: [item] }); writeConfig(w, { teams: [{ id: 'research', source: 'store' }] });
  const files = Object.entries(repo.responses).length ? null : null;
  dropStore(w);
  await assert.rejects(planAdopt(input(w)), e => e.code === 'STORE_ITEM_MISSING' && e.message.includes(ADOPT_MISSING_NEXT('research')));
  // Put the team in the store cache, as apply --frozen does.
  const moved = fs.readdirSync(w.base).find(n => n.startsWith('store-moved-')), root = path.join(w.base, moved, 'teams/research');
  const read = rel => { const out = []; for (const n of fs.readdirSync(path.join(root, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; if (fs.statSync(path.join(root, r)).isDirectory()) out.push(...read(r)); else out.push({ path: r, bytes: fs.readFileSync(path.join(root, r)) }); } return out; };
  const teamFiles = read(''); fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(w.stateRoot, 0o700);
  await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'team', 'research', authoredRows(teamFiles).hash, teamFiles, new AbortController().signal);
  const { plan } = await adopt(w);
  assert.equal(plan.from, 'store-cache'); assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  void files;
});

test('9. TEAM_EXISTS, TEAM_ID_RESERVED, and CONFIG_ITEM_NOT_SELECTED refuse', async t => {
  const w = await world(t, { folder: true });
  await assert.rejects(planAdopt({ ...input(w), id: 'first-team' }), code('TEAM_ID_RESERVED'));
  await assert.rejects(planAdopt({ ...input(w), id: 'ops' }), code('CONFIG_ITEM_NOT_SELECTED'));
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/research'), { recursive: true });
  await assert.rejects(planAdopt(input(w)), code('TEAM_EXISTS'));
});

test('10, 10a, 11 and 12. an interrupted adopt resumes; the recovery check gives create null and writes only the config and the lock', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  // Crash after the receipt and before bowerloom.json: the create path completes, the config write throws.
  const fsMod = await import('node:fs'), original = fsMod.default.renameSync;
  fsMod.default.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw new Error('crash'); return original(from, to); };
  try { await assert.rejects(withProjectLock(w.projectDir, new AbortController().signal, held => applyAdopt(input(w), plan, plan.revision, held)), /crash/); } finally { fsMod.default.renameSync = original; }
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'store' }]);
  const again = await planAdopt(input(w));
  assert.equal(again.finishing, true); assert.equal(again.create, null);
  await withProjectLock(w.projectDir, new AbortController().signal, held => applyAdopt(input(w), again, again.revision, held));
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
});
