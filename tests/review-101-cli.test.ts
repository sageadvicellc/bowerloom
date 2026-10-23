// Track 11 of beta.3, items 2 to 4, through the real binary: plan lines that were not true, found while reviewing PR 101.
// 2. The line about a new .bowerloom says what git ignores there, for the commands that write items and for the ones
//    that write copies. 3. A teammate with no store reads where each store item comes from. 4. The plan of use and unuse
//    names only the files it changes.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { world, run, mustApprove, project, pushStore, network, NETWORK, shared, gitRaw, git, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { LOCK_FORMAT, serializeLock } from '../packages/project-config/src/lock.js';

const ITEMS_LINE = /^Create \.bowerloom, the folder of this project's items\. Commit the files this writes there\.$/m;
const COPIES_LINE = /^Create \.bowerloom for the records of the copies, in \.bowerloom\/managed\. Its own \.gitignore keeps them out of git\.$/m;
const OLD_LINE = /records of the copies\)\. Its contents are git-ignored/;
/** The files git lists in `dir`: `??` for a file to commit, `!!` for an ignored one. */
const gitFiles = (dir: string, w: World): string[] => gitRaw(dir, ['status', '--porcelain', '--ignored', '-uall'], w).stdout.split('\n').filter(Boolean).sort();

test('item 2: skill create in a project with only bowerloom.json says the new .bowerloom holds files to commit, and git ignores none', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); git(dir, ['init', '-q'], w);
  const plan = run(dir, ['skill', 'create', 'beta'], w.env);
  assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, ITEMS_LINE); assert.doesNotMatch(plan.stdout, OLD_LINE);
  mustApprove(dir, ['skill', 'create', 'beta'], w.env);
  const files = gitFiles(dir, w);
  assert.deepEqual(files.filter(f => f.includes('.bowerloom/')), ['?? .bowerloom/authoring/receipt.json', '?? .bowerloom/skills.json', '?? .bowerloom/skills/beta/SKILL.md']);
  assert.equal(existsSync(join(dir, '.bowerloom/managed')), false, 'create writes no record of a copy');
});

test('item 2: prompt create, team create, and team adopt print the items line too', t => {
  const w = world(t);
  for (const args of [['prompt', 'create', 'brief'], ['team', 'create', 'research']]) {
    const plan = run(project(w, args[0]!, EMPTY_CONFIG), args, w.env);
    assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, ITEMS_LINE, args.join(' ')); assert.doesNotMatch(plan.stdout, OLD_LINE);
  }
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  const adopt = run(project(w, 'adopt', { ...EMPTY_CONFIG, teams: [{ id: 'research', source: 'store' }] }), ['team', 'adopt', 'research'], w.env);
  assert.equal(adopt.status, 3, adopt.stderr); assert.match(adopt.stdout, ITEMS_LINE); assert.doesNotMatch(adopt.stdout, OLD_LINE);
});

test('item 2: skills sync and apply in a project with only bowerloom.json say the records go in .bowerloom/managed, which git ignores', t => {
  const w = world(t);
  mustApprove(w.home, ['skill', 'create', 'alpha', '--global'], w.env);
  for (const command of [['skills', 'sync'], ['apply']]) {
    const dir = project(w, command.join('-'), { ...EMPTY_CONFIG, skills: [{ id: 'alpha', source: 'store' }] }); git(dir, ['init', '-q'], w);
    const plan = run(dir, command, w.env);
    assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, COPIES_LINE, command.join(' ')); assert.doesNotMatch(plan.stdout, OLD_LINE);
    mustApprove(dir, command, w.env);
    const inside = gitFiles(dir, w).filter(f => f.includes('.bowerloom/'));
    assert.ok(inside.length > 0); assert.deepEqual(inside.filter(f => !f.startsWith('!! .bowerloom/managed/')), [], inside.join('\n'));
  }
});

/** The owner locks a store skill and team in a shared project; a teammate's clone has the two files and no store. */
function clone(t: TestContext): { owner: World; mate: World; ownerDir: string; dir: string; routes: Record<string, string> } {
  const owner = world(t), ownerDir = project(owner, 'app', EMPTY_CONFIG); shared(ownerDir);
  mustApprove(owner.home, ['team', 'create', 'research', '--global'], owner.env);
  mustApprove(owner.home, ['skill', 'create', 'house-style', '--global'], owner.env);
  const repo = pushStore(owner);
  mustApprove(ownerDir, ['use', 'skill', 'house-style'], network(owner, repo.routes).env, NETWORK);
  mustApprove(ownerDir, ['use', 'team', 'research'], network(owner, repo.routes).env, NETWORK);
  const mate = world(t), dir = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(ownerDir, f), join(dir, f));
  return { owner, mate, ownerDir, dir, routes: repo.routes };
}
const FROM_STORE = (kind: string, id: string) => `  ${kind} ${id} comes from your store; this project asks for it`;
const FROM_LOCK = (kind: string, id: string) => `  ${kind} ${id} comes from the lock and the store repository; this project asks for it`;

test('item 3: on a machine with no store, the plans say each store item comes from the lock and the store repository', t => {
  const { mate, dir, routes } = clone(t);
  assert.equal(existsSync(mate.store), false);
  for (const command of [['skills', 'sync'], ['apply'], ['apply', '--frozen']]) {
    // Plain apply holds the uncached item and has nothing to change (exit 0); the others plan a fetch (exit 3).
    const plan = run(dir, command, network(mate, routes).env, NETWORK);
    assert.equal(plan.status, command.length === 1 ? 0 : 3, plan.stderr + plan.stdout);
    const lines = plan.stdout.split('\n');
    assert.ok(lines.includes(FROM_LOCK('skill', 'house-style')), `${command.join(' ')}:\n${plan.stdout}`);
    assert.ok(lines.includes(FROM_LOCK('team', 'research')), command.join(' '));
    assert.doesNotMatch(plan.stdout, /comes from your store/, command.join(' '));
  }
});

test('item 3: on the machine of the store, a plain plan says your store, and a frozen plan says the lock', t => {
  const { owner, ownerDir, routes } = clone(t);
  const plain = run(ownerDir, ['skills', 'sync'], network(owner, routes).env, NETWORK);
  assert.equal(plain.status, 3, plain.stderr);
  assert.ok(plain.stdout.split('\n').includes(FROM_STORE('skill', 'house-style')), plain.stdout);
  assert.ok(plain.stdout.split('\n').includes(FROM_STORE('team', 'research')));
  const frozen = run(ownerDir, ['apply', '--frozen'], network(owner, routes).env, NETWORK);
  assert.equal(frozen.status, 3, frozen.stderr);
  assert.ok(frozen.stdout.split('\n').includes(FROM_LOCK('skill', 'house-style')), frozen.stdout);
  assert.doesNotMatch(frozen.stdout, /comes from your store/);
});

const ONLY_CONFIG_USE = /^This changes bowerloom\.json only\. Then run bowerloom skills sync and bowerloom apply\.$/m;
const BOTH_USE = /^This changes bowerloom\.json and bowerloom\.lock\.json only\. Then run bowerloom skills sync and bowerloom apply\.$/m;
const ONLY_CONFIG_UNUSE = /^This changes bowerloom\.json only\.$/m;
const BOTH_UNUSE = /^This changes bowerloom\.json and bowerloom\.lock\.json only\.$/m;

test('item 4: in a project that is not shared, use and unuse name bowerloom.json only, and write no lock', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(w.home, ['skill', 'create', 'alpha', '--global'], w.env);
  const use = run(dir, ['use', 'skill', 'alpha'], w.env);
  assert.equal(use.status, 3, use.stderr); assert.match(use.stdout, ONLY_CONFIG_USE); assert.doesNotMatch(use.stdout, /lock/);
  const { applied } = mustApprove(dir, ['use', 'skill', 'alpha'], w.env);
  assert.doesNotMatch(applied.stdout, /lock/); assert.equal(existsSync(join(dir, 'bowerloom.lock.json')), false);
  const unuse = run(dir, ['unuse', 'skill', 'alpha'], w.env);
  assert.equal(unuse.status, 3, unuse.stderr); assert.match(unuse.stdout, ONLY_CONFIG_UNUSE); assert.doesNotMatch(unuse.stdout, /lock/);
});

test('item 4: a shared project with no store entry writes no lock, so use names bowerloom.json only', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(dir, ['skill', 'create', 'beta'], w.env);
  mustApprove(dir, ['unuse', 'skill', 'beta'], w.env);
  const use = run(dir, ['use', 'skill', 'beta', '--project'], w.env);
  assert.equal(use.status, 3, use.stderr); assert.match(use.stdout, ONLY_CONFIG_USE);
  mustApprove(dir, ['use', 'skill', 'beta', '--project'], w.env); assert.equal(existsSync(join(dir, 'bowerloom.lock.json')), false);
});

test('item 4: in a project with a lock, use and unuse name both files, and the lock is written', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  writeFileSync(join(dir, 'bowerloom.lock.json'), serializeLock({ format: LOCK_FORMAT, skills: [], prompts: [], teams: [] }), { mode: 0o644 });
  mustApprove(dir, ['skill', 'create', 'beta'], w.env);
  const unuse = run(dir, ['unuse', 'skill', 'beta'], w.env);
  assert.equal(unuse.status, 3, unuse.stderr); assert.match(unuse.stdout, BOTH_UNUSE);
  mustApprove(dir, ['unuse', 'skill', 'beta'], w.env);
  const use = run(dir, ['use', 'skill', 'beta', '--project'], w.env);
  assert.equal(use.status, 3, use.stderr); assert.match(use.stdout, BOTH_USE);
  assert.match(mustApprove(dir, ['use', 'skill', 'beta', '--project'], w.env).applied.stdout, /^Updated bowerloom\.lock\.json\.$/m);
});

test('follow-up item 4: the help of unuse and use say the lock changes only when there is one, and cli.md agrees', t => {
  const w = world(t);
  const unuse = run(w.work, ['help', 'unuse'], w.env), use = run(w.work, ['help', 'use'], w.env);
  assert.equal(unuse.status, 0); assert.match(unuse.stdout, /^Removes an item from bowerloom\.json, and from bowerloom\.lock\.json when a lock exists\./m);
  assert.match(use.stdout, /^It changes bowerloom\.json, and bowerloom\.lock\.json when the project has a lock, or is shared and uses a store item\. The plan names each file it changes\. Run bowerloom skills sync/m);
  const doc = readFileSync(new URL('../../apps/docs/src/content/docs/cli.md', import.meta.url), 'utf8');
  assert.ok(doc.includes('`unuse` removes an item from `bowerloom.json`, and from `bowerloom.lock.json` when a lock exists.'));
  assert.ok(doc.includes('`use` changes `bowerloom.json`, and `bowerloom.lock.json` when the project has a lock, or is shared and uses a store item. The plan names each file it changes.'));
  // PR 102 round 1, item 2: the old words said a shared project always changes the lock, which a project with no store entry does not.
  assert.doesNotMatch(use.stdout + doc, /too in a shared project/);
});
