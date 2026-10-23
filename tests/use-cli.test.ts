// Spec 06, 3.5 to 3.7, through the real binary: skill create --global, use, ls, skills sync, apply, unuse.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, approve, mustApprove, errorCode, project, EMPTY_CONFIG } from './support/config-cli.js';

test('1 to 4. skill create --global, then use shows the plan and exits 3, applies, lists, installs, and unuse keeps the copy', t => {
  const w = world(t), dir = project(w);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  const text = run(dir, ['use', 'skill', 'house-style'], w.env).stdout;
  const { body, planned } = approve(dir, ['use', 'skill', 'house-style'], w.env);
  assert.equal((body.plan as { created: boolean }).created, true);
  assert.match(text, /^Create bowerloom\.json and list 0 items this project defines now, with the source project\.$/m);
  assert.match(text, /^Use skill house-style from the store\n {2}Source: store skill \(written in ~\/\.bowerloom\/skills\/house-style\)\n {2}Teams: every team$/m);
  assert.match(text, /^bowerloom\.json adds: skill house-style \(store\)$/m);
  // Track 11 of beta.3, item 4: this project is not shared, so the plan writes no lock and names bowerloom.json only.
  assert.match(text, /^This changes bowerloom\.json only\. Then run bowerloom skills sync and bowerloom apply\.$/m);
  void planned;
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).skills, [{ id: 'house-style', source: 'store' }]);
  // 2: ls shows the store item.
  assert.match(run(dir, ['ls', 'skills'], w.env).stdout, /^ {2}house-style {2}store$/m);
  assert.equal(JSON.parse(run(dir, ['ls', 'skills', '--json'], w.env).stdout).skills[0].source, 'store');
  // 3: sync and apply install it.
  const sync = approve(dir, ['skills', 'sync'], w.env);
  assert.equal(sync.applied.status, 0, sync.applied.stderr);
  assert.ok(existsSync(join(dir, '.claude/skills/house-style/SKILL.md')));
  // 4: unuse removes it from bowerloom.json; the copy stays, and the plan says where.
  const unuse = run(dir, ['unuse', 'skill', 'house-style'], w.env);
  assert.equal(unuse.status, 3); assert.match(unuse.stdout, /^Copies stay in .*\.claude\/skills\/house-style.*\. Bowerloom removes no copy\. Delete them yourself if you want them gone\.$/m);
  mustApprove(dir, ['unuse', 'skill', 'house-style'], w.env);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).skills, []);
  assert.ok(existsSync(join(dir, '.claude/skills/house-style/SKILL.md')));
});

test('5 and 6. use team expands on a store with tagged skills; --project and the duplicate refusals', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  mustApprove(w.home, ['skill', 'create', 'notes', '--team', 'research', '--global'], w.env);
  mustApprove(w.home, ['skill', 'create', 'general', '--global'], w.env);
  mustApprove(dir, ['use', 'team', 'research'], w.env);
  const config = JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8'));
  assert.deepEqual(config.skills, [{ id: 'notes', source: 'store', via: ['research'] }]); assert.deepEqual(config.teams, [{ id: 'research', source: 'store' }]);
  const again = run(dir, ['use', 'team', 'research', '--json'], w.env); assert.equal(errorCode(again.stderr), 'CONFIG_ITEM_SELECTED');
  const missing = run(dir, ['use', 'skill', 'nope', '--project', '--json'], w.env); assert.equal(errorCode(missing.stderr), 'CONFIG_ITEM_MISSING');
  mustApprove(dir, ['skill', 'create', 'general'], w.env);
  const dup = run(dir, ['use', 'skill', 'general', '--json'], w.env); assert.equal(errorCode(dup.stderr), 'CONFIG_DUPLICATE_ID');
});

test('7 and 8. use with no store refuses STORE_NOT_FOUND; --commit with a bad value exits 2', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  const r = run(dir, ['use', 'skill', 'house-style', '--json'], w.env); assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'STORE_NOT_FOUND');
  const bad = run(dir, ['use', 'skill', 'house-style', '--commit', 'abc123', '--json'], w.env); assert.equal(bad.status, 2); assert.equal(errorCode(bad.stderr), 'USAGE');
  const unuse = run(dir, ['unuse', 'skill', 'house-style', '--json'], w.env); assert.equal(errorCode(unuse.stderr), 'CONFIG_ITEM_NOT_SELECTED');
});

test('use slice refuses USAGE: a context slice is a project item only, and bowerloom.json never lists it', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  const before = readFileSync(join(dir, 'bowerloom.json'), 'utf8');
  const r = run(dir, ['use', 'slice', 'notes', '--json'], w.env);
  assert.equal(errorCode(r.stderr), 'USAGE', r.stderr);
  assert.equal(readFileSync(join(dir, 'bowerloom.json'), 'utf8'), before); assert.equal(existsSync(join(dir, 'bowerloom.lock.json')), false);
});
