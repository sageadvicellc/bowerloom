import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(...args: string[]) {
  const r = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.error, undefined);
  return r;
}
function json(...args: string[]) {
  const r = run(...args); return { ...r, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}

for (const profile of ['engineer', 'founder', 'research']) test(`optional ${profile} demo handoff binds exact setup without changing it`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-demo-cli-'))); chmodSync(root, 0o700);
  try {
    const target = join(root, 'project');
    const args = ['--mode', 'new', '--target', target, '--name', 'Synthetic project', '--goal', 'Review an optional team exercise', '--profile', profile];
    const setup = json('init', 'plan', ...args, '--json'); assert.equal(setup.status, 0, setup.stderr);
    const installed = json('init', 'apply', ...args, '--approve', setup.value.revision); assert.equal(installed.status, 0, installed.stderr);
    const receipt = join(target, '.bowerloom', 'installation-receipt.json'), before = readFileSync(receipt);
    const demoArgs = ['--target', target, '--from', setup.value.revision];
    const planned = json('init', 'demo-plan', ...demoArgs, '--json'); assert.equal(planned.status, 0, planned.stderr);
    assert.equal(planned.value.executionAuthorized, false); assert.equal(planned.value.runtimeReady, false);
    assert.match(planned.value.revision, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(json('init', 'demo-plan', ...demoArgs, '--json').value, planned.value);
    const plain = run('init', 'demo-plan', ...demoArgs); assert.equal(plain.status, 0, plain.stderr);
    assert.ok(plain.stdout.includes('Synthetic project')); assert.ok(plain.stdout.includes(setup.value.revision));
    assert.match(plain.stdout, /synthetic/i);
    assert.deepEqual(readFileSync(receipt), before); assert.deepEqual(readdirSync(target), ['.bowerloom']);
    assert.notEqual(json('init', 'demo-plan', '--target', target, '--from', '0'.repeat(64), '--json').status, 0);
    assert.equal(json('init', 'demo-plan', ...demoArgs, '--approve', planned.value.revision).value.error.code, 'USAGE');
    writeFileSync(join(target, '.bowerloom', 'unreviewed.txt'), 'unreviewed extra file');
    assert.notEqual(json('init', 'demo-plan', ...demoArgs, '--json').status, 0);
    assert.deepEqual(readFileSync(receipt), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('optional demo CLI rejects missing binding and launch aliases', () => {
  for (const args of [
    ['init', 'demo-plan', '--target', '/unused'],
    ['init', 'demo-run', '--target', '/unused', '--from', '0'.repeat(64)],
    ['init', 'demo-plan', '--target', '/unused', '--from', '0'.repeat(64), '--json', '--json'],
  ]) assert.equal(json(...args).value.error.code, 'USAGE');
});
