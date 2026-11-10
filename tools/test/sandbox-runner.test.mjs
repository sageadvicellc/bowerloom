import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = path.join(root, 'tools/sandbox/run-gates.sh');
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-runner-test-'))); made.push(dir); return dir; };

const printed = () => {
  const result = spawnSync('bash', [runner, '--print-commands'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(line => line.startsWith('docker '));
};

test('the runner prints a build and a run command, and nothing else starts', () => {
  const lines = printed();
  assert.equal(lines.filter(l => l.startsWith('docker build ')).length, 1);
  assert.equal(lines.filter(l => l.startsWith('docker run ')).length, 1);
});

test('the run command mounts nothing from the host, publishes no port, and never reaches the host docker socket', () => {
  const run = printed().find(l => l.startsWith('docker run '));
  assert.doesNotMatch(run, /(^| )(-v|--volume|--mount)( |=)/, 'no bind mount and no volume');
  assert.doesNotMatch(run, /(^| )(-p|-P|--publish|--publish-all)( |=|$)/, 'no published port');
  assert.doesNotMatch(run, /docker\.sock/);
  assert.doesNotMatch(run, /--privileged|--cap-add|--pid=host|--network[= ]host|--net[= ]host|--userns=host/);
  assert.doesNotMatch(run, /(^| )(-e|--env)( |=)(HOME|DOCKER_HOST)/);
  assert.doesNotMatch(run, /--env-file/);
});

test('the run command runs as root with no network', () => {
  const run = printed().find(l => l.startsWith('docker run '));
  assert.match(run, /--user 0:0/);
  assert.match(run, /--network none/);
});

test('the build command uses the sandbox Dockerfile and the repository as its only context', () => {
  const build = printed().find(l => l.startsWith('docker build '));
  assert.match(build, /-f tools\/sandbox\/Dockerfile/);
  assert.match(build, / \.$/);
});

test('the Dockerfile has a pinned Node tag in the engine range, copies the source in, and declares no volume', () => {
  const text = fs.readFileSync(path.join(root, 'tools/sandbox/Dockerfile'), 'utf8');
  const from = text.match(/^FROM node:(\d+)\.(\d+)\.(\d+)-\S+$/m);
  assert.ok(from, 'FROM names an exact node version');
  const [major, minor] = [Number(from[1]), Number(from[2])];
  assert.equal(major, 24);
  assert.ok(minor >= 11, 'node 24.11 or later');
  assert.match(text, /^COPY \. \/work$/m);
  assert.doesNotMatch(text, /^VOLUME /m);
  assert.doesNotMatch(text, /^USER /m, 'the image runs as root on purpose');
  assert.match(text, /xvfb/);
});

test('the runner refuses, and says how to start Docker Desktop, when Docker cannot be used', () => {
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = spawnSync('bash', [runner], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin` } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /open -a Docker/);
  assert.match(result.stderr, /docker info/);
});

test('the runner refuses when there is no docker command at all', () => {
  const bin = tmp();
  for (const tool of ['bash', 'dirname', 'cd']) { const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim(); if (found.startsWith('/')) fs.symlinkSync(found, path.join(bin, tool)); }
  const result = spawnSync('/bin/bash', [runner], { encoding: 'utf8', env: { PATH: bin } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker/);
});

test('the runner never runs a test command on the host', () => {
  const text = fs.readFileSync(runner, 'utf8').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(text,/npm (run |test)|playwright|node tools\/gates/, 'the host only runs docker');
});

const MD = path.join(root, 'tools/sandbox/machine-dependent.mjs');
const frozen = JSON.parse(fs.readFileSync(path.join(root, 'docs/v0.9/test-inventory.json'), 'utf8'));
const names = frozen.suites.root.skips.filter(s => s.kind === 'machine-dependent').map(s => s.name);

test('the machine-dependent check reads four frozen names, and passes only when all four passed', () => {
  assert.equal(names.length, 4);
  const dir = tmp();
  const write = status => { const file = path.join(dir, 'run.jsonl'); fs.writeFileSync(file, names.map((name, i) => JSON.stringify({ file: `f${i}.mjs`, name, status: status(i) })).join('\n') + '\n'); return file; };
  const ok = spawnSync('node', [MD, write(() => 'pass')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  for (const name of names) assert.ok(ok.stdout.split('\n').some(line => /^pass +/.test(line) && line.endsWith(name)), name);
  const skipped = spawnSync('node', [MD, write(i => (i === 2 ? 'skip' : 'pass'))], { encoding: 'utf8' });
  assert.equal(skipped.status, 1);
  assert.match(skipped.stdout, /skip +L5/);
});

test('the machine-dependent check fails on a missing test and on an empty run', () => {
  const dir = tmp();
  const file = path.join(dir, 'run.jsonl');
  fs.writeFileSync(file, JSON.stringify({ file: 'a.mjs', name: names[0], status: 'pass' }) + '\n');
  const missing = spawnSync('node', [MD, file], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /missing/);
  fs.writeFileSync(file, '');
  assert.equal(spawnSync('node', [MD, file], { encoding: 'utf8' }).status, 1);
});

const SUMMARY = path.join(root, 'tools/sandbox/summarize-gates.mjs');

test('the gates summary prints the counts of each step and exits 1 on a failed step', () => {
  const dir = tmp();
  const file = path.join(dir, 'gates.json');
  const step = (name, passed, counts) => ({ name, passed, exitCode: passed ? 0 : 1, counts, firstFailure: passed ? null : 'boom' });
  fs.writeFileSync(file, JSON.stringify({ ok: false, failedStep: 'root-test', steps: [step('root-typecheck', true, null), step('root-test', false, { pass: 3, fail: 1, skipped: 2 })], notRun: ['desktop-test'] }));
  const result = spawnSync('node', [SUMMARY, file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /root-typecheck +passed/);
  assert.match(result.stdout, /root-test +FAILED.*pass 3, fail 1, skipped 2/);
  assert.match(result.stdout, /not run: desktop-test/);
  assert.match(result.stdout, /boom/);
});

test('the gates summary fails on a missing or unreadable file', () => {
  const result = spawnSync('node', [SUMMARY, path.join(tmp(), 'none.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});

const E2E = path.join(root, 'tools/sandbox/summarize-e2e.mjs');
const spec = (title, status) => ({ title, file: 'a.spec.ts', tests: [{ status, annotations: [] }] });

test('the e2e summary prints the Playwright counts and names each failed test', () => {
  const dir = tmp();
  const file = path.join(dir, 'e2e.json');
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 3 }, suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('works', 'expected'), spec('breaks', 'unexpected')] }] }));
  const result = spawnSync('node', [E2E, file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILED +pass 2, fail 1, flaky 0, skipped 3/);
  assert.match(result.stdout, /failed: apps\/desktop\/e2e\/a\.spec\.ts: breaks/);
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 1 }, suites: [] }));
  assert.equal(spawnSync('node', [E2E, file], { encoding: 'utf8' }).status, 0);
});

test('the e2e summary fails when no test passed, and when the file is missing', () => {
  const dir = tmp();
  const file = path.join(dir, 'e2e.json');
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 5 }, suites: [] }));
  assert.equal(spawnSync('node', [E2E, file], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync('node', [E2E, path.join(dir, 'none.json')], { encoding: 'utf8' }).status, 1);
});
