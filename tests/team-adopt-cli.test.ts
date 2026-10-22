// Spec 06, 3.17, through the real binary: team adopt plan lines, result, the recovery plan, and STORE_ITEM_MISSING.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, errorCode, errorMessage, project, EMPTY_CONFIG } from './support/config-cli.js';

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
