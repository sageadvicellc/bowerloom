import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
function folder(t: test.TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-ls-status-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: cwd, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** An existing project folder prepared through the real init plan and apply. HOME is the outer folder, so the search stops there. */
function project(t: test.TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json']); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision]); assert.equal(applied.status, 0, applied.stderr);
  return { home, dir, sub: (() => { const s = join(dir, 'src', 'lib'); mkdirSync(s, { recursive: true }); return s; })() };
}

test('after init, ls shows first-team and personal-assistant, from the project folder or a folder below it', t => {
  const p = project(t);
  for (const cwd of [p.dir, p.sub]) {
    const r = run(cwd, ['ls'], { HOME: p.home }); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
    assert.equal(r.stdout, 'Teams\n  first-team\n\nSkills\n  personal-assistant\n\nPrompts\n  none yet\n');
  }
});

test('ls teams, ls skills and ls prompts show one section; --json is one canonical object', t => {
  const p = project(t), env = { HOME: p.home };
  assert.equal(run(p.dir, ['ls', 'teams'], env).stdout, 'Teams\n  first-team\n');
  assert.equal(run(p.dir, ['ls', 'skills'], env).stdout, 'Skills\n  personal-assistant\n');
  assert.equal(run(p.dir, ['ls', 'prompts'], env).stdout, 'Prompts\n  none yet\n');
  const j = run(p.dir, ['ls', '--json'], env); assert.equal(j.status, 0);
  assert.deepEqual(JSON.parse(j.stdout), { format: 'bowerloom/ls/v1beta1', teams: ['first-team'], skills: ['personal-assistant'], prompts: [], unlisted: 0 });
  assert.deepEqual(JSON.parse(run(p.dir, ['ls', 'teams', '--json'], env).stdout), { format: 'bowerloom/ls/v1beta1', teams: ['first-team'], unlisted: 0 });
});

test('ls and status write nothing', t => {
  const p = project(t), env = { HOME: p.home }, snapshot = () => JSON.stringify(readdirSync(p.dir, { recursive: true }).sort());
  const before = snapshot(); run(p.dir, ['ls'], env); run(p.dir, ['status'], env); run(p.dir, ['status', '--json'], env);
  assert.equal(snapshot(), before);
});

test('status reports ready for a fresh project, in words and as JSON', t => {
  const p = project(t), env = { HOME: p.home };
  const r = run(p.dir, ['status'], env); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Project: /); assert.match(r.stdout, /Setup: ready/); assert.match(r.stdout, /Workers: none started/);
  const j = JSON.parse(run(p.sub, ['status', '--json'], env).stdout);
  assert.equal(j.format, 'bowerloom/project-status/v1beta1'); assert.equal(j.project, p.dir); assert.equal(j.status, 'ready'); assert.equal(j.specReady, true);
  assert.equal(j.runtimeReady, false); assert.equal(j.executionAuthorized, false); assert.deepEqual(j.drift, []); assert.match(j.projectId, /^[a-f0-9]{32}$/); assert.match(j.revision, /^[a-f0-9]{64}$/);
});

test('status reports drift and names the changed file', t => {
  const p = project(t), env = { HOME: p.home };
  appendFileSync(join(p.dir, '.bowerloom', 'brief.json'), ' ');
  const j = JSON.parse(run(p.dir, ['status', '--json'], env).stdout);
  assert.equal(j.status, 'drifted'); assert.deepEqual(j.drift, [{ path: '.bowerloom/brief.json', kind: 'changed' }]);
  const r = run(p.dir, ['status'], env); assert.equal(r.status, 0); assert.match(r.stdout, /Setup: drifted/); assert.match(r.stdout, /changed: \.bowerloom\/brief\.json/);
});

test('outside a project, ls and status refuse with PROJECT_NOT_FOUND, exit 1, JSON on a pipe', t => {
  const home = folder(t), empty = join(home, 'empty'); mkdirSync(empty);
  for (const args of [['ls'], ['status']]) {
    const r = run(empty, args, { HOME: home }); assert.equal(r.status, 1, args.join(' ')); assert.equal(r.stdout, '');
    const e = JSON.parse(r.stderr).error; assert.equal(e.code, 'PROJECT_NOT_FOUND'); assert.equal(Object.keys(JSON.parse(r.stderr)).length, 1);
  }
});

test('ls and status refuse HOME itself and a project in a Library cloud folder', t => {
  const home = folder(t);
  assert.equal(JSON.parse(run(home, ['ls'], { HOME: home }).stderr).error.code, 'PROJECT_ROOT_REFUSED');
  const cloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'app'); mkdirSync(join(cloud, '.bowerloom'), { recursive: true, mode: 0o700 });
  const r = run(cloud, ['status'], { HOME: home }); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stderr).error.code, 'PROJECT_IN_CLOUD_FOLDER');
});

test('ls and status usage errors exit 2', t => {
  const p = project(t), env = { HOME: p.home };
  for (const args of [['ls', 'bogus'], ['ls', 'teams', 'skills'], ['ls', '--bogus'], ['status', '--bogus'], ['status', 'extra']]) {
    const r = run(p.dir, args, env); assert.equal(r.status, 2, args.join(' ')); assert.equal(JSON.parse(r.stderr).error.code, 'USAGE');
  }
});

test('status --installation still parses as today', t => {
  const home = folder(t);
  const missing = run(home, ['status', '--installation', join(home, 'absent.json')]); assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stderr).error.code, 'ENOENT');
  const bare = run(home, ['status', '--installation']); assert.equal(bare.status, 2); assert.equal(JSON.parse(bare.stderr).error.code, 'USAGE');
  const twice = run(home, ['status', '--installation', 'x', '--installation', 'y']); assert.equal(twice.status, 2);
  const registry = run(home, ['status', '--registry', 'x']); assert.equal(registry.status, 2);
});

test('an unlisted entry is counted, not listed', t => {
  const p = project(t), env = { HOME: p.home };
  mkdirSync(join(p.dir, '.bowerloom', 'teams', 'Bad Name'));
  const j = JSON.parse(run(p.dir, ['ls', '--json'], env).stdout); assert.deepEqual(j.teams, ['first-team']); assert.equal(j.unlisted, 1);
  writeFileSync(join(p.dir, '.bowerloom', 'prompts-note.txt'), 'x'); assert.equal(readFileSync(join(p.dir, '.bowerloom', 'prompts-note.txt'), 'utf8'), 'x');
});
