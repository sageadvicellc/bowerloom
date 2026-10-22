// Spec 06, 3.17, through the real binary: team adopt plan lines, result, the recovery plan, and STORE_ITEM_MISSING.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, errorCode, errorMessage, project, shared, EMPTY_CONFIG } from './support/config-cli.js';
import { renderRefusal } from '../apps/cli/src/human.js';

test('team adopt shows its plan lines, adopts the store team, and the result switches bowerloom.json', t => {
  const w = world(t), dir = project(w, 'app', { ...EMPTY_CONFIG, teams: [{ id: 'research', source: 'store' }] });
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  const plan = run(dir, ['team', 'adopt', 'research'], w.env);
  assert.equal(plan.status, 3, plan.stderr);
  assert.match(plan.stdout, /^Create \.bowerloom \(records of the copies\)\. Its contents are git-ignored\.\nAdopt team research from the store\n {2}Copies teams\/research \(\d+ files\) to \.bowerloom\/teams\/research\n {2}Registers it in \.bowerloom\/authoring\/receipt\.json\nbowerloom\.json: team research changes from store to project\nThe project now owns this copy\. Later store changes do not reach it\.$/m);
  const { applied } = mustApprove(dir, ['team', 'adopt', 'research'], w.env);
  assert.match(applied.stdout, /^Applied plan [a-f0-9]{64}\.$/m);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).teams, [{ id: 'research', source: 'project' }]);
  assert.ok(existsSync(join(dir, '.bowerloom/teams/research/team.yaml')));
  assert.equal(errorCode(run(dir, ['team', 'adopt', 'research', '--json'], w.env).stderr), 'CONFIG_ITEM_NOT_SELECTED');
  assert.ok(run(dir, ['team', 'adopt', '--help'], w.env).stdout.includes('bowerloom team adopt <id> [--approve <revision>] [--json]'));
});

test('a recovery plan finishes an adopt whose config write was lost; with neither store nor cache, STORE_ITEM_MISSING', t => {
  const w = world(t), config = { ...EMPTY_CONFIG, teams: [{ id: 'research', source: 'store' }] }, dir = project(w, 'app', config);
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  mustApprove(dir, ['team', 'adopt', 'research'], w.env);
  // As if the run stopped after the receipt and before bowerloom.json.
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(config, null, 2)}\n`);
  const recovery = run(dir, ['team', 'adopt', 'research'], w.env);
  assert.equal(recovery.status, 3, recovery.stderr); assert.match(recovery.stdout, /^Finish adopting team research\.$/m); assert.doesNotMatch(recovery.stdout, /Copies teams/);
  mustApprove(dir, ['team', 'adopt', 'research'], w.env);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).teams, [{ id: 'research', source: 'project' }]);
  const other = project(w, 'other', config); renameSync(w.store, join(w.base, 'store-moved'));
  const missing = run(other, ['team', 'adopt', 'research', '--json'], w.env);
  assert.equal(errorCode(missing.stderr), 'STORE_ITEM_MISSING'); assert.doesNotMatch(errorMessage(missing.stderr), /Next:/);
  assert.equal((JSON.parse(missing.stderr) as { error: { next?: string } }).error.next, 'Run bowerloom apply --frozen, then bowerloom team adopt research again.');
});

// Decision 1 on sageadvicellc/bowerloom#80 (comment 6351449744), variant A: team adopt takes a store team that is not listed yet.
function storeTeam(w: ReturnType<typeof world>): void {
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  mustApprove(w.home, ['skill', 'create', 'notes', '--team', 'research', '--global'], w.env);
  mustApprove(w.home, ['prompt', 'create', 'brief', '--team', 'research', '--global'], w.env);
}
const ADOPT_UNLISTED = /^Adopt team research from the store\n {2}Copies teams\/research \(\d+ files\) to \.bowerloom\/teams\/research\n {2}Registers it in \.bowerloom\/authoring\/receipt\.json\nbowerloom\.json adds: team research \(project\)\nTagged to team research and not copied: prompt brief and skill notes\. They stay store items, and a shared project needs a pushed store to pick them\.\nThe project now owns this copy\. Later store changes do not reach it\.$/m;

test('fix 1: in a shared project, use team refuses STORE_ITEM_NOT_SHAREABLE, its next step team adopt works as written, then apply', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir); storeTeam(w);
  const refused = run(dir, ['use', 'team', 'research', '--json'], w.env);
  assert.equal(refused.status, 1); assert.equal(errorCode(refused.stderr), 'STORE_ITEM_NOT_SHAREABLE');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')), EMPTY_CONFIG);
  // The terminal words name the command; run it with the team the person tried to use.
  const next = /\nNext: (.*)\n$/.exec(renderRefusal('STORE_ITEM_NOT_SHAREABLE', errorMessage(refused.stderr)))![1]!;
  const step = /bowerloom (team adopt)\b/.exec(next); assert.ok(step, next);
  const plan = run(dir, [...step[1]!.split(' '), 'research'], w.env);
  assert.equal(plan.status, 3, plan.stderr);
  assert.match(plan.stdout, /^Create \.bowerloom \(records of the copies\)\. Its contents are git-ignored\.$/m);
  assert.match(plan.stdout, ADOPT_UNLISTED);
  assert.doesNotMatch(plan.stdout, /changes from store to project|Network:/);
  const { applied } = mustApprove(dir, ['team', 'adopt', 'research'], w.env);
  assert.match(applied.stdout, /^Applied plan [a-f0-9]{64}\.$/m);
  const config = JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8'));
  assert.deepEqual([config.teams, config.skills, config.prompts], [[{ id: 'research', source: 'project' }], [], []]);
  assert.ok(existsSync(join(dir, '.bowerloom/teams/research/team.yaml'))); assert.equal(existsSync(join(dir, 'bowerloom.lock.json')), false);
  const apply = run(dir, ['apply'], w.env);
  assert.equal(apply.status, 0, apply.stderr + apply.stdout);
});

test('fix 1: in a solo project an unlisted store team is adopted; an id the store lacks refuses; a listed team keeps the switch', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); storeTeam(w);
  const plan = run(dir, ['team', 'adopt', 'research'], w.env);
  assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, ADOPT_UNLISTED);
  mustApprove(dir, ['team', 'adopt', 'research'], w.env);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).teams, [{ id: 'research', source: 'project' }]);
  assert.equal(errorCode(run(dir, ['team', 'adopt', 'ops', '--json'], w.env).stderr), 'STORE_ITEM_NOT_FOUND');
  // A team listed from the store: the plan still switches it, as before.
  const listed = project(w, 'listed', { ...EMPTY_CONFIG, teams: [{ id: 'research', source: 'store' }] });
  const switched = run(listed, ['team', 'adopt', 'research'], w.env);
  assert.equal(switched.status, 3, switched.stderr); assert.match(switched.stdout, /^bowerloom\.json: team research changes from store to project$/m);
  assert.doesNotMatch(switched.stdout, /Tagged to team|adds: team/);
});
