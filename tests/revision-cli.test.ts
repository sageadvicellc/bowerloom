import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from './support/lock-slot-retry.js';

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return { ...result, value: JSON.parse(result.status === 0 ? result.stdout : result.stderr) };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-revision-cli-')));
  const target = join(root, 'project');
  const args = ['--mode', 'new', '--target', target, '--name', 'Miki workshop', '--goal', 'Prepare a synthetic workshop inventory.'];
  const plan = cli('init', 'plan', ...args, '--json');
  assert.equal(plan.status, 0, plan.stderr);
  const apply = cli('init', 'apply', ...args, '--approve', plan.value.revision);
  assert.equal(apply.status, 0, apply.stderr);
  writeFileSync(join(target, 'owner-notes.txt'), 'Preserve these unrelated notes.\n');
  return { root, target, installedRevision: plan.value.revision };
}

test('revision CLI plans without writing and applies only the exact old and proposed revisions', () => {
  const f = fixture();
  try {
    const receiptPath = join(f.target, '.bowerloom/installation-receipt.json');
    const before = readFileSync(receiptPath);
    const parentNames = readdirSync(f.root);
    const args = ['--target', f.target, '--name', 'Miki workshop', '--goal', 'Prepare a synthetic workshop inventory and a reviewable restocking draft.'];
    const plan = cli('revise', 'plan', ...args, '--json');
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(plan.value.fromRevision, f.installedRevision);
    assert.equal(plan.value.executionAuthorized, false);
    assert.deepEqual(readFileSync(receiptPath), before);
    assert.deepEqual(readdirSync(f.root), parentNames);
    assert.notEqual(cli('revise', 'apply', ...args, '--approve', plan.value.revision).status, 0);
    assert.notEqual(cli('revise', 'apply', ...args, '--from', '0'.repeat(64), '--approve', plan.value.revision).status, 0);
    assert.deepEqual(readFileSync(receiptPath), before);
    const applied = cli('revise', 'apply', ...args, '--from', f.installedRevision, '--approve', plan.value.revision);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.value.executionAuthorized, false);
    const inspection = cli('init', 'status', '--target', f.target);
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.equal(inspection.value.status, 'ready-for-review');
    assert.notEqual(inspection.value.revision, f.installedRevision);
    assert.equal(inspection.value.executionAuthorized, false);
    assert.equal(readFileSync(join(f.target, 'owner-notes.txt'), 'utf8'), 'Preserve these unrelated notes.\n');
    assert.notEqual(cli('revise', 'apply', ...args, '--from', f.installedRevision, '--approve', plan.value.revision).status, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('revision CLI preserves the installation when the brief changes after review', () => {
  const f = fixture();
  try {
    const file = join(f.root, 'brief.json');
    const brief = { projectName: 'Miki workshop', goal: 'Write a synthetic inventory summary.' };
    writeFileSync(file, JSON.stringify(brief));
    const args = ['--target', f.target, '--brief', file];
    const plan = cli('revise', 'plan', ...args, '--json');
    assert.equal(plan.status, 0, plan.stderr);
    const receipt = readFileSync(join(f.target, '.bowerloom/installation-receipt.json'));
    writeFileSync(file, JSON.stringify({ ...brief, goal: 'A different goal needs another review.' }));
    assert.notEqual(cli('revise', 'apply', ...args, '--from', f.installedRevision, '--approve', plan.value.revision).status, 0);
    assert.deepEqual(readFileSync(join(f.target, '.bowerloom/installation-receipt.json')), receipt);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('revision CLI rejects ambiguous and recovery flags before changing the installation', () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.target, '.bowerloom/installation-receipt.json'));
    const args = ['revise', 'plan', '--target', f.target, '--name', 'Miki workshop', '--goal', 'A reviewed synthetic goal.'];
    for (const tail of [['--target', f.target], ['--approve', '0'.repeat(64)], ['--from', f.installedRevision], ['--json', '--json'], ['--unknown', 'value']]) {
      assert.equal(cli(...args, ...tail).value.error.code, 'USAGE');
    }
    for (const tail of [[], ['--action', 'delete'], ['--action', 'resume'], ['--action', 'rollback', '--approve', '0'.repeat(64), '--json']]) {
      assert.equal(cli('revise', 'recover', '--target', f.target, ...tail).value.error.code, 'USAGE');
    }
    assert.notEqual(cli('revise', 'recover', '--target', f.target, '--action', 'rollback', '--approve', '0'.repeat(64)).status, 0);
    assert.deepEqual(readFileSync(join(f.target, '.bowerloom/installation-receipt.json')), before);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('revision CLI plain review presents the exact approval and keeps execution disabled', () => {
  const f = fixture();
  try {
    const args = ['revise', 'plan', '--target', f.target, '--name', 'Miki workshop', '--goal', 'Prepare a synthetic schedule for review.'];
    const plan = cli(...args, '--json');
    assert.equal(plan.status, 0, plan.stderr);
    const text = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 20000 });
    assert.equal(text.status, 0, text.stderr);
    assert.ok(text.stdout.includes(f.installedRevision));
    assert.ok(text.stdout.includes(plan.value.revision));
    assert.ok(text.stdout.includes('Prepare a synthetic schedule for review.'));
    assert.throws(() => JSON.parse(text.stdout));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
