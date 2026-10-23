// Spec 06, 3.4 and decisions 12 and 16, through the real binary: a folder that holds only bowerloom.json works with every
// command, and the first write makes a .bowerloom whose engine files git ignores.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, errorCode, project, EMPTY_CONFIG } from './support/config-cli.js';

test('part 1: ls, status, skills check, skills sync and apply each exit 0 in a folder that holds only bowerloom.json', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  for (const args of [['ls'], ['status'], ['skills', 'check'], ['skills', 'sync'], ['apply']]) {
    const r = run(dir, args, w.env); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.match(run(dir, ['skills', 'check'], w.env).stdout, /^skills\.json is valid: 0 skills$/m);
  assert.match(run(dir, ['skills', 'sync'], w.env).stdout, /^ {2}Nothing is selected to sync yet\.$/m);
  assert.match(run(dir, ['apply'], w.env).stdout, /^ {2}Nothing is selected to apply yet\.$/m);
});

test('part 2: skill create, skills sync and apply leave only the person\'s files and the copies for git; .bowerloom/managed/.gitignore holds *', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(dir, ['skill', 'create', 'house-style'], w.env);
  mustApprove(dir, ['skills', 'sync'], w.env);
  const apply = run(dir, ['apply', '--json'], w.env);
  if (apply.status === 3) mustApprove(dir, ['apply'], w.env);
  const git = (args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...w.env, GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(git(['init', '-q']).status, 0);
  const listed = git(['status', '--porcelain', '--untracked-files=all']).stdout.split('\n').filter(Boolean).map(l => l.slice(3)).sort();
  // Section 12, item 12: the list from a run, checked by hand against the install places.
  assert.deepEqual(listed, ['.agents/skills/house-style/SKILL.md', '.bowerloom/authoring/receipt.json', '.bowerloom/skills.json', '.bowerloom/skills/house-style/SKILL.md', '.claude/skills/house-style/SKILL.md', 'bowerloom.json']);
  assert.equal(readFileSync(join(dir, '.bowerloom/managed/.gitignore'), 'utf8'), '*\n');
});

test('part 3: skill create, prompt create, team create, use, unuse, team adopt, lock verify and up --team each give their own result', t => {
  const w = world(t);
  const expect: [string[], number, string | null][] = [
    [['skill', 'create', 'house-style', '--json'], 3, null],
    [['prompt', 'create', 'weekly-update', '--json'], 3, null],
    [['team', 'create', 'research', '--json'], 3, null],
    [['use', 'skill', 'house-style', '--json'], 1, 'STORE_NOT_FOUND'],
    [['unuse', 'skill', 'house-style', '--json'], 1, 'CONFIG_ITEM_NOT_SELECTED'],
    [['team', 'adopt', 'research', '--json'], 1, 'STORE_NOT_FOUND'],
    [['lock', 'verify', '--json'], 1, 'LOCK_MISSING'],
    [['up', '--team', 'research', '--json'], 3, null],
  ];
  for (const [args, status, code] of expect) {
    const dir = project(w, `p-${args.slice(0, 2).join('-')}`, EMPTY_CONFIG), r = run(dir, args, w.env);
    assert.equal(r.status, status, `${args.join(' ')}: ${r.stderr}`);
    if (code !== null) assert.equal(errorCode(r.stderr), code, args.join(' '));
  }
});
