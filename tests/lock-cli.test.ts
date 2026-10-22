// Spec 06, 3.9, 3.10, 3.15 and 3.21, through the real binary: a shared project locks an authored store skill against
// a fake github.com copy of the store; lock verify and lock update; status lock states; store status Git: lines.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { renderRefusal } from '../apps/cli/src/human.js';
import { join } from 'node:path';
import { world, run, approve, mustApprove, errorCode, errorMessage, project, pushStore, network, NETWORK, shared, EMPTY_CONFIG, STORE_COMMIT } from './support/config-cli.js';

const lockText = (dir: string) => readFileSync(join(dir, 'bowerloom.lock.json'), 'utf8');

test('1, 4 and 5. use in a shared project locks an authored skill with exact bytes; a project that is not shared writes none; lock verify', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const solo = project(w, 'solo', EMPTY_CONFIG); mustApprove(solo, ['use', 'skill', 'house-style'], w.env);
  assert.throws(() => lockText(solo), 'a project that is not shared writes no lock');
  shared(dir);
  const repo = pushStore(w), net = network(w, repo.routes);
  const { applied } = mustApprove(dir, ['use', 'skill', 'house-style'], net.env, NETWORK);
  assert.match(applied.stdout, /^Updated bowerloom\.lock\.json\.$/m);
  const lock = JSON.parse(lockText(dir));
  assert.equal(lock.skills[0].authored.remote, 'https://github.com/sageadvicellc/store'); assert.equal(lock.skills[0].authored.commit, STORE_COMMIT);
  assert.equal(lock.skills[0].authored.tree, repo.treeAt('skills/house-style'));
  assert.equal(lockText(dir), `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(readFileSync(net.log, 'utf8').split('\n').filter(Boolean).every(l => JSON.parse(l).authorization !== true));
  // 5: lock verify passes, then fails after hand edits.
  const ok = run(dir, ['lock', 'verify'], w.env); assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^bowerloom\.lock\.json is valid: 1 item\.\n {2}skill house-style {2}sageadvicellc\/store commit 01234567, hash [a-f0-9]{8}\n$/);
  const good = lockText(dir);
  writeFileSync(join(dir, 'bowerloom.lock.json'), good.replace(/"hash": "[a-f0-9]{64}"/, `"hash": "${'f'.repeat(64)}"`));
  assert.equal(errorCode(run(dir, ['lock', 'verify', '--json'], w.env).stderr), 'LOCK_INVALID');
  writeFileSync(join(dir, 'bowerloom.lock.json'), `<<<<<<< HEAD\n${good}`);
  assert.equal(errorCode(run(dir, ['lock', 'verify', '--json'], w.env).stderr), 'LOCK_INVALID');
  writeFileSync(join(dir, 'bowerloom.lock.json'), good);
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify({ ...EMPTY_CONFIG, skills: [{ id: 'house-style', source: 'store' }, { id: 'other', source: 'store' }] }, null, 2)}\n`);
  const mismatch = run(dir, ['lock', 'verify', '--json'], w.env);
  assert.equal(errorCode(mismatch.stderr), 'LOCK_CONFIG_MISMATCH'); assert.match(errorMessage(mismatch.stderr), /skill other/);
});

test('2. with no store .git: STORE_ITEM_NOT_SHAREABLE with its sentence and the exact Next: text', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const r = run(dir, ['use', 'skill', 'house-style', '--json'], w.env);
  assert.equal(errorCode(r.stderr), 'STORE_ITEM_NOT_SHAREABLE'); assert.equal(errorMessage(r.stderr), 'This project is shared, and a teammate cannot fetch this store item. The store is not a git repository.');
  // The terminal words carry the Next: text of REFUSALS.
  assert.match(renderRefusal('STORE_ITEM_NOT_SHAREABLE', errorMessage(r.stderr)), /Give the store a remote and push it\. bowerloom store status shows the commands\. Or adopt a team into this project with bowerloom team adopt\./);
});

test('3 and 8. an edit after the push gives LOCK_STORE_NOT_PUSHED; a private repository gives STORE_REMOTE_PRIVATE', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const repo = pushStore(w);
  appendFileSync(join(w.store, 'skills/house-style/SKILL.md'), 'Not pushed.\n');
  assert.equal(errorCode(run(dir, ['use', 'skill', 'house-style', '--json'], network(w, repo.routes).env, NETWORK).stderr), 'LOCK_STORE_NOT_PUSHED');
  assert.equal(errorCode(run(dir, ['use', 'skill', 'house-style', '--json'], network(w, {}).env, NETWORK).stderr), 'STORE_REMOTE_PRIVATE');
});

test('6. lock update adds, changes, and removes items as the store changes', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(dir, ['use', 'skill', 'house-style'], network(w, pushStore(w).routes).env, NETWORK);
  assert.equal(run(dir, ['lock', 'update'], w.env).stdout.trim().split('\n').at(-1), 'Nothing to change.');
  appendFileSync(join(w.store, 'skills/house-style/SKILL.md'), 'More.\n');
  const later = pushStore(w), net = network(w, later.routes);
  const plan = run(dir, ['lock', 'update'], net.env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr); assert.match(plan.stdout, /^ {2}skill house-style {2}commit changed: 01234567 to 01234567$/m);
  mustApprove(dir, ['lock', 'update'], network(w, later.routes).env, NETWORK);
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(EMPTY_CONFIG, null, 2)}\n`);
  const removed = run(dir, ['lock', 'update'], w.env); assert.match(removed.stdout, /^ {2}skill house-style {2}removed$/m);
});

test('7. status --json shows the lock states not-used, absent, valid, stale, invalid, mismatch and orphan', t => {
  const w = world(t), dir = project(w, 'app', { ...EMPTY_CONFIG, skills: [{ id: 'house-style', source: 'store' }] });
  const state = () => JSON.parse(run(dir, ['status', '--json'], w.env).stdout).config.lock.state;
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  assert.equal(state(), 'not-used');
  shared(dir); assert.equal(state(), 'absent');
  mustApprove(dir, ['lock', 'update'], network(w, pushStore(w).routes).env, NETWORK);
  assert.equal(state(), 'valid');
  appendFileSync(join(w.store, 'skills/house-style/SKILL.md'), 'Changed.\n'); assert.equal(state(), 'stale');
  const good = lockText(dir);
  writeFileSync(join(dir, 'bowerloom.lock.json'), `<<<<<<<\n${good}`); assert.equal(state(), 'invalid');
  writeFileSync(join(dir, 'bowerloom.lock.json'), good);
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(EMPTY_CONFIG, null, 2)}\n`); assert.equal(state(), 'mismatch');
  // A lock and no config, in a project with .bowerloom: drift lock-orphan.
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 }); rmSync(join(dir, 'bowerloom.json'));
  const orphan = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.ok(orphan.drift.some((d: { kind: string }) => d.kind === 'lock-orphan'), JSON.stringify(orphan.drift));
});

test('9. store status shows the Git: line and the commands for a store with no remote, and the git.ahead values', t => {
  const w = world(t);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const none = run(w.home, ['store', 'status'], w.env);
  assert.match(none.stdout, /^ {2}Git: none\n {2}To fix this, run these commands yourself:\n {4}cd ~\/\.bowerloom\n {4}git init\n/m);
  assert.equal(JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).git.ahead, 'unknown');
  pushStore(w);
  const pushed = run(w.home, ['store', 'status'], w.env);
  assert.match(pushed.stdout, /^ {2}Git: origin github\.com\/sageadvicellc\/store, branch main, HEAD 01234567, pushed 01234567$/m);
  assert.match(pushed.stdout, /^ {2}Skill folders: 1$/m, 'the .git folder is not counted');
  assert.equal(JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).git.ahead, 'no');
  pushStore(w, { head: 'f'.repeat(40) });
  assert.equal(JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).git.ahead, 'yes');
});

test('GITHUB_RATE_LIMITED: a 403 with no requests left keeps its code', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const repo = pushStore(w), url = `https://api.github.com/repos/sageadvicellc/store/git/commits/${STORE_COMMIT}`;
  const r = run(dir, ['use', 'skill', 'house-style', '--json'], network(w, { ...repo.routes, [url]: { status: 403, headers: { 'X-RateLimit-Remaining': '0' }, file: null } }).env, NETWORK);
  assert.equal(errorCode(r.stderr), 'GITHUB_RATE_LIMITED');
  void approve;
});
