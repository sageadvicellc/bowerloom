import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.error, undefined);
  return { ...r, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}
const neutralValue = { format: 'bowerloom/harness-preferences/v1beta1', preferences: { reasoningEffort: 'high' }, nativeModels: {}, executionAuthorized: false };

for (const harness of ['codex', 'claude']) test(`managed ${harness} CLI requires exact approvals and restores the original bytes`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-managed-cli-'))); chmodSync(root, 0o700);
  try {
    const file = join(root, harness === 'codex' ? 'fixture.toml' : 'fixture.json');
    const original = harness === 'codex' ? '# Synthetic preference fixture\nfeature_enabled = true\n' : '{ "featureEnabled": true }\n';
    writeFileSync(file, original, { mode: 0o600 });
    const neutral = join(root, 'neutral.json'); writeFileSync(neutral, JSON.stringify(neutralValue), { mode: 0o600 });
    const stateDir = join(root, 'projection-state');
    const args = ['--harness', harness, '--file', file, '--neutral', neutral, '--state', stateDir, '--synthetic'];
    const planned = cli('harness', 'managed-plan', ...args);
    assert.equal(planned.status, 0, planned.stderr); assert.equal(planned.value.executionAuthorized, false);
    assert.equal(existsSync(stateDir), false); assert.equal(readFileSync(file, 'utf8'), original);
    assert.notEqual(cli('harness', 'apply', ...args).status, 0);
    assert.notEqual(cli('harness', 'apply', ...args, '--approve', '0'.repeat(64)).status, 0);
    assert.equal(existsSync(stateDir), false); assert.equal(readFileSync(file, 'utf8'), original);
    const applied = cli('harness', 'apply', ...args, '--approve', planned.value.revision);
    assert.equal(applied.status, 0, applied.stderr); assert.equal(applied.value.executionAuthorized, false);
    const managed = readFileSync(file, 'utf8'); assert.notEqual(managed, original); assert.ok(managed.includes('high'));
    const replay = cli('harness', 'apply', ...args, '--approve', planned.value.revision);
    assert.notEqual(replay.status, 0); assert.equal(readFileSync(file, 'utf8'), managed);
    const removeArgs = ['--state', stateDir, '--synthetic'];
    const removal = cli('harness', 'removal-plan', ...removeArgs); assert.equal(removal.status, 0, removal.stderr);
    assert.notEqual(removal.value.revision, planned.value.revision);
    assert.notEqual(cli('harness', 'remove', ...removeArgs, '--approve', planned.value.revision).status, 0);
    assert.equal(readFileSync(file, 'utf8'), managed);
    const removed = cli('harness', 'remove', ...removeArgs, '--approve', removal.value.revision);
    assert.equal(removed.status, 0, removed.stderr); assert.equal(removed.value.executionAuthorized, false);
    assert.equal(readFileSync(file, 'utf8'), original); assert.equal(existsSync(stateDir), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('managed CLI preserves changes made after a reviewed plan', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-managed-drift-'))); chmodSync(root, 0o700);
  try {
    const file = join(root, 'fixture.json'), neutral = join(root, 'neutral.json'), stateDir = join(root, 'state');
    writeFileSync(file, '{}\n', { mode: 0o600 }); writeFileSync(neutral, JSON.stringify(neutralValue), { mode: 0o600 });
    const args = ['--harness', 'claude', '--file', file, '--neutral', neutral, '--state', stateDir, '--synthetic'];
    const plan = cli('harness', 'managed-plan', ...args); assert.equal(plan.status, 0, plan.stderr);
    writeFileSync(file, '{"newUnrelatedField":true}\n');
    assert.notEqual(cli('harness', 'apply', ...args, '--approve', plan.value.revision).status, 0);
    assert.equal(readFileSync(file, 'utf8'), '{"newUnrelatedField":true}\n'); assert.equal(existsSync(stateDir), false);
    for (const command of ['removal-plan', 'remove', 'recover']) {
      assert.equal(cli('harness', command, '--state', stateDir).value.error.code, 'USAGE');
    }
    assert.equal(cli('harness', 'recover', '--state', stateDir, '--synthetic').value.error.code, 'USAGE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
