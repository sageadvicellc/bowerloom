import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { validateBundle, planInstallation, installBundle } from '../../../dist/packages/portable/src/index.js';

function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-portable-')));
  fs.chmodSync(parent, 0o700);
  const bundleDir = join(parent, 'bundle');
  fs.cpSync(resolve('examples/portable/report-seed'), bundleDir, { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const input = { bundleDir, selected: ['editorial'], harness: 'codex', targetDir: join(parent, 'workspace') };
  const manifestPath = join(bundleDir, '.bowerloom/manifest.json');
  const change = (fn) => { const manifest = JSON.parse(fs.readFileSync(manifestPath)); fn(manifest); fs.writeFileSync(manifestPath, JSON.stringify(manifest)); };
  return { parent, input, manifestPath, change };
}
const code = (expected) => error => error?.code === expected;

test('visible dependency closure and exact content hashes bind the approval', t => {
  const { input } = fixture(t);
  const plan = planInstallation(input);
  assert.deepEqual(plan.selected, ['editorial']);
  assert.deepEqual(plan.dependencies, ['report']);
  assert.deepEqual(plan.parts, ['editorial', 'report']);
  assert.equal(plan.executionAuthorized, false);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  for (const file of plan.files) {
    const bytes = fs.readFileSync(join(input.bundleDir, '.bowerloom', file.path));
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(file.bytes, bytes.length);
  }
  assert.notEqual(plan.revision, planInstallation({ ...input, selected: ['report'] }).revision);
  assert.notEqual(plan.revision, planInstallation({ ...input, targetDir: input.targetDir + '-other' }).revision);
});

test('installation projects skills and inert teams only to a new local workspace', t => {
  const { input } = fixture(t);
  const before = validateBundle(input.bundleDir);
  const receipt = installBundle(input, planInstallation(input).revision);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(fs.readFileSync(join(input.targetDir, '.agents/skills/bowerloom-report/SKILL.md'), 'utf8'), fs.readFileSync(join(input.bundleDir, '.bowerloom/skills/report/SKILL.md'), 'utf8'));
  assert.match(fs.readFileSync(join(input.targetDir, '.bowerloom/teams/editorial/team.json'), 'utf8'), /data-only-not-executable/);
  assert.match(fs.readFileSync(join(input.targetDir, 'START-HERE.md'), 'utf8'), /does not execute teams/);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json'))), receipt);
  assert.deepEqual(validateBundle(input.bundleDir), before);
  assert.equal(fs.existsSync(join(input.targetDir, 'packing-report.md')), false);
});

test('moving a bundle preserves semantic output and source revision', t => {
  const { input, parent } = fixture(t);
  const copied = join(parent, 'copy');
  fs.cpSync(input.bundleDir, copied, { recursive: true });
  assert.deepEqual(planInstallation(input), planInstallation({ ...input, bundleDir: copied }));
});

test('unknown selection, dependency cycles, and missing dependencies fail closed', t => {
  const { input, change } = fixture(t);
  assert.throws(() => planInstallation({ ...input, selected: ['missing'] }), code('UNKNOWN_PART'));
  assert.throws(() => planInstallation({ ...input, selected: [] }), code('SELECTION_REQUIRED'));
  change(m => { m.parts[0].dependsOn = ['editorial']; });
  assert.throws(() => validateBundle(input.bundleDir), code('DEPENDENCY_CYCLE'));
  change(m => { m.parts[0].dependsOn = ['missing']; });
  assert.throws(() => validateBundle(input.bundleDir), code('MISSING_DEPENDENCY'));
});

test('unsupported harnesses and mandatory controls are not silently dropped', t => {
  const { input, change } = fixture(t);
  assert.throws(() => planInstallation({ ...input, harness: 'unknown' }), code('UNSUPPORTED_HARNESS'));
  change(m => { m.parts[0].requiredControls = ['network-sandbox']; });
  assert.throws(() => validateBundle(input.bundleDir), code('UNSUPPORTED_CONTROL'));
  change(m => { m.parts[0].requiredControls = []; m.hooks = { install: 'run.sh' }; });
  assert.throws(() => validateBundle(input.bundleDir), code('UNSUPPORTED_FIELD_OR_CONTROL'));
});

test('stale approvals and modified source content leave no target', t => {
  const { input } = fixture(t);
  const approved = planInstallation(input).revision;
  assert.throws(() => installBundle(input, 'approved'), code('EXACT_APPROVAL_REQUIRED'));
  fs.appendFileSync(join(input.bundleDir, '.bowerloom/skills/report/SKILL.md'), '\nChanged text.\n');
  assert.throws(() => installBundle(input, approved), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(input.targetDir), false);
});

test('all existing targets, including empty directories, are rejected', t => {
  const { input } = fixture(t);
  const approved = planInstallation(input).revision;
  fs.mkdirSync(input.targetDir);
  assert.throws(() => installBundle(input, approved), code('TARGET_EXISTS'));
  assert.deepEqual(fs.readdirSync(input.targetDir), []);
});

test('source symlinks, target symlinks and symlink ancestors fail closed', t => {
  const { input, parent } = fixture(t);
  const source = join(input.bundleDir, '.bowerloom/skills/report/sample.csv');
  const original = fs.readFileSync(source); fs.unlinkSync(source);
  const other = join(parent, 'other.csv'); fs.writeFileSync(other, original); fs.symlinkSync(other, source);
  assert.throws(() => validateBundle(input.bundleDir), code('SYMLINK_FORBIDDEN'));
  fs.unlinkSync(source); fs.writeFileSync(source, original);
  fs.symlinkSync(parent, join(parent, 'linked'));
  assert.throws(() => planInstallation({ ...input, targetDir: join(parent, 'linked', 'target') }), code('SYMLINK_FORBIDDEN'));
  fs.symlinkSync(join(parent, 'absent'), input.targetDir);
  assert.throws(() => planInstallation(input), code('SYMLINK_FORBIDDEN'));
});

for (const unsafe of ['../escape.md', '/tmp/escape.md', 'skills/report/.env', 'skills/report/secrets.json', 'skills/report/scripts/run.md', 'skills/report/run.sh', 'skills/report/a\\b.md']) {
  test(`reject unsafe file path ${unsafe}`, t => {
    const { input, change } = fixture(t);
    change(m => { m.parts[0].files.push(unsafe); });
    assert.throws(() => validateBundle(input.bundleDir), code('UNSAFE_SOURCE_PATH'));
  });
}

test('executable files, invalid UTF8, oversized and private-key content are rejected', t => {
  const { input } = fixture(t);
  const file = join(input.bundleDir, '.bowerloom/skills/report/sample.csv');
  fs.chmodSync(file, 0o755);
  assert.throws(() => validateBundle(input.bundleDir), code('UNSAFE_SOURCE_FILE'));
  fs.chmodSync(file, 0o600); fs.writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => validateBundle(input.bundleDir), code('SOURCE_NOT_UTF8'));
  fs.writeFileSync(file, '-----BEGIN PRIVATE KEY-----');
  assert.throws(() => validateBundle(input.bundleDir), code('SECRET_OR_BINARY_CONTENT'));
  fs.writeFileSync(file, 'a'.repeat(65537));
  assert.throws(() => validateBundle(input.bundleDir), code('UNSAFE_SOURCE_FILE'));
});

test('rename failure rolls back staging and cooperative lock without touching sources', t => {
  const { input, parent } = fixture(t);
  const approved = planInstallation(input).revision;
  const original = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); }; syncBuiltinESMExports();
  try { assert.throws(() => installBundle(input, approved), /simulated rename failure/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(fs.readdirSync(parent), ['bundle']);
  assert.equal(planInstallation(input).revision, approved);
});

test('nonempty targets and existing installer locks preserve their state', t => {
  const { input, parent } = fixture(t);
  const revision = planInstallation(input).revision;
  const lock = join(parent, '.bowerloom-install-workspace.lock');
  fs.writeFileSync(lock, 'other owner');
  assert.throws(() => installBundle(input, revision), code('INSTALL_LOCKED'));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'other owner');
  fs.mkdirSync(input.targetDir); fs.writeFileSync(join(input.targetDir, 'keep.txt'), 'keep');
  assert.throws(() => installBundle(input, revision), code('TARGET_EXISTS'));
  assert.equal(fs.readFileSync(join(input.targetDir, 'keep.txt'), 'utf8'), 'keep');
});

test('UTF8 BOM and CRLF bytes keep exact hashes and projections', t => {
  const { input } = fixture(t);
  const file = join(input.bundleDir, '.bowerloom/skills/report/sample.csv');
  const bytes = Buffer.from('\uFEFFname,value\r\nsample,7\r\n'); fs.writeFileSync(file, bytes);
  const plan = planInstallation(input);
  const projected = plan.files.find(file => file.path.endsWith('sample.csv'));
  assert.equal(projected.sha256, createHash('sha256').update(bytes).digest('hex'));
  installBundle(input, plan.revision);
  assert.deepEqual(fs.readFileSync(join(input.targetDir, projected.targetPath)), bytes);
});

test('plan does not mutate caller selections and rejects ambiguous runtime controls', t => {
  const { input, change } = fixture(t);
  input.selected = ['report', 'editorial']; planInstallation(input);
  assert.deepEqual(input.selected, ['report', 'editorial']);
  change(m => { m.parts[0].requiredControls = ['local-files-only']; });
  assert.throws(() => validateBundle(input.bundleDir), code('UNSUPPORTED_CONTROL'));
});

test('hardlinked sources and public target parents are rejected', t => {
  const { input, parent } = fixture(t);
  const file = join(input.bundleDir, '.bowerloom/skills/report/sample.csv');
  fs.linkSync(file, join(parent, 'hardlink.csv'));
  assert.throws(() => validateBundle(input.bundleDir), code('UNSAFE_SOURCE_FILE'));
  fs.unlinkSync(join(parent, 'hardlink.csv'));
  fs.chmodSync(parent, 0o777);
  assert.throws(() => planInstallation(input), code('TARGET_PARENT_NOT_PRIVATE'));
  fs.chmodSync(parent, 0o700);
});

for (const kind of [['skill'], ['team'], [], {}, null, 1, true, 'unknown']) {
  test(`reject non-schema part kind ${JSON.stringify(kind)} before planning or installation`, t => {
    const { input, change } = fixture(t);
    const directory = join(input.bundleDir, '.bowerloom/teams/report');
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(join(directory, 'data.json'), '{}');
    change(m => { m.parts[0].kind = kind; m.parts[0].files = ['teams/report/data.json']; });
    assert.throws(() => validateBundle(input.bundleDir), code('INVALID_PART'));
    assert.throws(() => planInstallation(input), code('INVALID_PART'));
    assert.throws(() => installBundle(input, '0'.repeat(64)), code('INVALID_PART'));
    assert.equal(fs.existsSync(input.targetDir), false);
  });
}

for (const directory of ['.CoDeX', '.AGENTS', '.ConFig', '.GIT', 'Node_Modules']) {
  test(`reject case-variant harness and internal directory ${directory}`, t => {
    const { input, parent } = fixture(t);
    const forbiddenParent = join(parent, directory);
    fs.mkdirSync(forbiddenParent, {mode:0o700});
    const targetDir = join(forbiddenParent, 'workspace');
    assert.throws(() => planInstallation({...input, targetDir}), code('UNSAFE_TARGET'));
    assert.equal(fs.existsSync(targetDir), false);
  });
}
test('reject case-variant source overlap before target creation', t => {
  const { input, parent } = fixture(t);
  assert.throws(() => planInstallation({...input, targetDir:join(parent, 'BUNDLE', 'workspace')}), code('UNSAFE_TARGET'));
});
