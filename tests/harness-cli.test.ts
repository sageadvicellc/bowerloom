import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return { ...result, value: JSON.parse(result.status === 0 ? result.stdout : result.stderr) };
}

for (const harness of ['codex', 'claude']) test(`harness CLI reads a ${harness} fixture without installing or changing it`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-harness-cli-')));
  try {
    const file = join(root, harness === 'codex' ? 'config.toml' : 'settings.json');
    const source = harness === 'codex' ? '# synthetic fixture\nmodel = "o3"\nmodel_reasoning_effort = "high"\n' : '{"model":"sonnet","effortLevel":"high"}\n';
    writeFileSync(file, source, { mode: 0o600 });
    const args = ['--harness', harness, '--file', file, '--synthetic'];
    const imported = cli('harness', 'import', ...args);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.value.executionAuthorized, false);
    assert.equal(imported.value.neutral.preferences.reasoningEffort, 'high');
    const neutral = join(root, 'neutral.json');
    writeFileSync(neutral, JSON.stringify(imported.value.neutral), { mode: 0o600 });
    const plan = cli('harness', 'plan', ...args, '--neutral', neutral);
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(plan.value.status, 'unchanged');
    assert.equal(plan.value.executionAuthorized, false);
    assert.equal(plan.value.writesAuthorized, false);
    assert.equal(readFileSync(file, 'utf8'), source);
    chmodSync(neutral, 0o644);
    assert.notEqual(cli('harness', 'plan', ...args, '--neutral', neutral).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('harness CLI blocks secret-bearing projections and does not print the fixture credential', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-harness-secret-')));
  try {
    const file = join(root, 'settings.json');
    const marker = 'synthetic-credential-do-not-echo';
    const original = JSON.stringify({ model: 'sonnet', env: { ANTHROPIC_API_KEY: marker } });
    writeFileSync(file, original, { mode: 0o600 });
    const args = ['--harness', 'claude', '--file', file, '--synthetic'];
    const imported = cli('harness', 'import', ...args);
    assert.equal(imported.status, 0, imported.stderr);
    assert.ok(!imported.stdout.includes(marker));
    assert.ok(imported.value.report.secretReferences.length > 0);
    const neutral = join(root, 'neutral.json');
    writeFileSync(neutral, JSON.stringify(imported.value.neutral), { mode: 0o600 });
    const planned = cli('harness', 'plan', ...args, '--neutral', neutral);
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal(planned.value.status, 'blocked');
    assert.equal(planned.value.proposedText, null);
    assert.ok(!planned.stdout.includes(marker));
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('harness CLI refuses writes, ambiguous flags and missing synthetic acknowledgment', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-harness-flags-')));
  try {
    const file = join(root, 'settings.json');
    writeFileSync(file, '{}\n', { mode: 0o600 });
    const args = ['--harness', 'claude', '--file', file];
    for (const command of ['apply', 'install', 'remove']) {
      assert.equal(cli('harness', command, ...args, '--synthetic').value.error.code, 'USAGE');
    }
    assert.equal(cli('harness', 'import', ...args).value.error.code, 'USAGE');
    for (const tail of [['--synthetic'], ['--harness', 'codex'], ['--neutral', file], ['--approve', 'anything']]) {
      assert.equal(cli('harness', 'import', ...args, '--synthetic', ...tail).value.error.code, 'USAGE');
    }
    assert.equal(readFileSync(file, 'utf8'), '{}\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
