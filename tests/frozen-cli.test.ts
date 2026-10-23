// Spec 06, 3.16 and 3.19, through the real binary: a teammate's clone with bowerloom.json and bowerloom.lock.json and
// no store runs apply --frozen, skills sync --frozen, plain apply, and up --team.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, approve, mustApprove, errorCode, project, pushStore, network, NETWORK, loggedHosts, shared, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import type { TestContext } from 'node:test';

/** The owner's machine locks a store skill and team; the clone gets bowerloom.json and the lock, and no store. */
function clone(t: TestContext): { owner: World; mate: World; dir: string; routes: Record<string, string> } {
  const owner = world(t), dir = project(owner, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(owner.home, ['team', 'create', 'research', '--global'], owner.env);
  mustApprove(owner.home, ['skill', 'create', 'house-style', '--global'], owner.env);
  const repo = pushStore(owner);
  mustApprove(dir, ['use', 'skill', 'house-style'], network(owner, repo.routes).env, NETWORK);
  mustApprove(dir, ['use', 'team', 'research'], network(owner, repo.routes).env, NETWORK);
  const mate = world(t), copy = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(dir, f), join(copy, f));
  return { owner, mate, dir: copy, routes: repo.routes };
}

test('1, 2 and 6. apply --frozen on a clone: plan names api.github.com and exits 3; --approve fetches and installs; a second run fetches nothing', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, routes);
  const plan = run(dir, ['apply', '--frozen'], net.env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, /^Network: reads api\.github\.com for 2 items, public and without credentials\./m);
  assert.match(plan.stdout, /^Frozen: installing only what bowerloom\.lock\.json records\.$/m);
  assert.match(plan.stdout, /^Create \.bowerloom for the records of the copies, in \.bowerloom\/managed\. Its own \.gitignore keeps them out of git\.$/m);
  const { applied } = approve(dir, ['apply', '--frozen'], net.env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(dir, '.claude/skills/house-style/SKILL.md')));
  const again = run(dir, ['apply', '--frozen'], net.env, NETWORK);
  assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /^Network: none now\. Every item is on this machine\.$/m); assert.match(again.stdout, /^Nothing to change\.$/m);
  assert.deepEqual(loggedHosts(net.log).filter(h => h !== 'api.github.com' && h !== 'registry.npmjs.org'), []);
});

test('3 and 4. skills sync --frozen --offline with an uncached item refuses SKILLS_OFFLINE; plain apply holds it', t => {
  const { mate, dir } = clone(t);
  assert.equal(errorCode(run(dir, ['skills', 'sync', '--frozen', '--offline', '--json'], mate.env).stderr), 'SKILLS_OFFLINE');
  const plain = run(dir, ['apply'], mate.env);
  assert.match(plain.stdout, /house-style +held \(SKILLS_OFFLINE\)/); assert.match(plain.stdout, /Run bowerloom apply --frozen, or bowerloom skills sync\./);
});

test('5. up --team in the clone fetches and installs through its sync and apply steps', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, routes);
  // The team is a store team: up installs for it once the config lists it, which it does.
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  const first = run(dir, ['up', '--team', 'research', '--json'], net.env, NETWORK);
  assert.equal(first.status, 3, first.stderr + first.stdout);
  const step = JSON.parse(first.stdout.split('\n').filter(Boolean)[0]!) as { plan: { step: string }; revision: string };
  assert.equal(step.plan.step, 'sync');
  const done = run(dir, ['up', '--team', 'research', '--approve', step.revision], net.env, NETWORK);
  // The sync step fetched the locked skill into the store cache and put its copies in place; nothing is left to apply.
  assert.equal(done.status, 4, done.stderr + done.stdout); assert.match(done.stdout, /^prepared, workers held$/m);
  assert.equal(readdirSync(join(mate.state, 'bowerloom', 'store-cache')).filter(n => n.startsWith('skill-house-style-')).length, 1);
  assert.ok(existsSync(join(dir, '.claude/skills/house-style/SKILL.md')));
  void readFileSync; void renameSync;
});
