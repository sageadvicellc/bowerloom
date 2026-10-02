import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return { ...result, value: JSON.parse(result.status === 0 ? result.stdout : result.stderr) };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-startup-cli-')));
  return { root, target: join(root, 'project') };
}
const brief = { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', reviewMode: 'milestones' };

for (const mode of ['new', 'existing']) test(`startup CLI ${mode} creates a compiled specification without executing it`, () => {
  const f = fixture();
  try {
    if (mode === 'existing') {
      mkdirSync(f.target);
      mkdirSync(join(f.target, '.codex')); mkdirSync(join(f.target, '.claude'));
      writeFileSync(join(f.target, '.codex/config.toml'), 'model = "existing-user-choice"\n');
      writeFileSync(join(f.target, '.claude/settings.json'), '{"user":"original"}\n');
      writeFileSync(join(f.target, 'AGENTS.md'), 'Existing project instructions.\n');
    }
    const args = ['--mode', mode, '--target', f.target, '--name', brief.projectName, '--goal', brief.goal];
    const before = readdirSync(f.root);
    const plan = cli('init', 'plan', ...args);
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(plan.value.executionAuthorized, false);
    assert.deepEqual(readdirSync(f.root), before);
    assert.equal(cli('init', 'apply', ...args).status, 2);
    assert.notEqual(cli('init', 'apply', ...args, '--approve', 'sha256:' + '0'.repeat(64)).status, 0);
    const applied = cli('init', 'apply', ...args, '--approve', plan.value.revision);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.value.executionAuthorized, false);
    const status = cli('init', 'status', '--target', f.target);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.value.executionAuthorized, false);
    const team = join(f.target, '.bowerloom/teams/first-team/team.yaml');
    const compiled = cli('validate', team);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(compiled.value.runtimeReady, false);
    assert.equal(compiled.value.tasks, 3);
    const portable = cli('portable', 'validate', f.target);
    assert.equal(portable.status, 0, portable.stderr);
    assert.match(readFileSync(join(f.target, '.bowerloom/START-HERE.md'), 'utf8'), /existing personal agent/);
    if (mode === 'existing') {
      assert.equal(readFileSync(join(f.target, '.codex/config.toml'), 'utf8'), 'model = "existing-user-choice"\n');
      assert.equal(readFileSync(join(f.target, '.claude/settings.json'), 'utf8'), '{"user":"original"}\n');
      assert.equal(readFileSync(join(f.target, 'AGENTS.md'), 'utf8'), 'Existing project instructions.\n');
    }
    assert.notEqual(cli('init', 'apply', ...args, '--approve', plan.value.revision).status, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('startup CLI rejects ambiguous flags and hostile brief files before destination writes', () => {
  const f = fixture();
  try {
    const file = join(f.root, 'brief.json');
    writeFileSync(file, JSON.stringify(brief));
    const args = ['init', 'plan', '--mode', 'new', '--target', f.target, '--brief', file];
    assert.equal(cli(...args).status, 0);
    for (const tail of [['--name', 'Duplicate source'], ['--target', f.target], ['--unknown', 'x'], ['--approve', 'x'], ['--review', 'handoff'], ['--goal']]) {
      assert.equal(cli(...args, ...tail).status, 2);
    }
    writeFileSync(file, '{"projectName":"A","projectName":"B","goal":"An ambiguous goal for the first team"}');
    assert.equal(cli(...args).value.error.code, 'INVALID_BRIEF');
    writeFileSync(file, Buffer.from([0xff, 0xfe]));
    assert.equal(cli(...args).value.error.code, 'INVALID_BRIEF');
    writeFileSync(file, 'x'.repeat(16385));
    assert.equal(cli(...args).value.error.code, 'INVALID_BRIEF');
    rmSync(file); symlinkSync(join(f.root, 'missing'), file);
    assert.notEqual(cli(...args).status, 0);
    assert.deepEqual(readdirSync(f.root), ['brief.json']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('startup CLI binds approval to brief content, including changes in a JSON file', () => {
  const f = fixture();
  try {
    const file = join(f.root, 'brief.json');
    writeFileSync(file, JSON.stringify(brief));
    const args = ['--mode', 'new', '--target', f.target, '--brief', file];
    const plan = cli('init', 'plan', ...args);
    assert.equal(plan.status, 0, plan.stderr);
    writeFileSync(file, JSON.stringify({ ...brief, goal: 'A changed project goal that needs another explicit review.' }));
    const stale = cli('init', 'apply', ...args, '--approve', plan.value.revision);
    assert.notEqual(stale.status, 0);
    assert.deepEqual(readdirSync(f.root), ['brief.json']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
