import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { validateBundle, planInstallation, installBundle, SCHEMA_VERSION, ADAPTER_VERSION } from '../../../dist/packages/portable/src/index.js';

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

const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);

test('legacy Codex plan, receipt serialization and START-HERE retain exact contract bytes', t => {
  const {input} = fixture(t);
  const validation = validateBundle(input.bundleDir);
  const body = {schemaVersion: 'bowerloom/v1alpha1', adapterVersion: 'codex/local-skills/v1alpha1', harness: 'codex', targetDir: input.targetDir,
    selected: ['editorial'], dependencies: ['report'], parts: ['editorial', 'report'], bundleRevision: validation.bundleRevision, manifestSha256: validation.manifestSha256,
    files: ['editorial', 'report'].flatMap(id => validation.manifest.parts.find(p => p.id === id).files.map(path => ({...validation.files.find(f => f.path === path), partId: id,
      targetPath: id === 'report' ? `.agents/skills/bowerloom-report/${path.slice('skills/report/'.length)}` : `.bowerloom/teams/editorial/${path.slice('teams/editorial/'.length)}`}))),
    generatedFiles: ['START-HERE.md', '.bowerloom/installation-receipt.json'], controlScope: 'installer-only', executionAuthorized: false};
  const plan = {...body, revision: digest(canonical(body))};
  assert.deepEqual(planInstallation(input), plan);
  const start = `# Bowerloom local installation\n\nThis workspace contains selected portable parts for Codex.\n\nPlan revision: ${plan.revision}\nBundle revision: ${plan.bundleRevision}\nSchema: ${SCHEMA_VERSION}\nAdapter: ${ADAPTER_VERSION}\n\nSelected: ${plan.selected.join(', ')}\nDependencies: ${plan.dependencies.join(', ') || 'none'}\n\nSkill projections are under .agents/skills/. Codex can discover these instructions when you open this workspace. Review SKILL.md before invoking a skill.\n\nTeam definitions under .bowerloom/teams/ are data. This installer does not execute teams, start workers, grant permissions, or approve actions. Installation approval authorizes only these new files. Declared installer controls do not enforce future Codex skill behavior. Review instructions before use and retain the personal agent permission controls.\n\nOrigin hashes and projections are in .bowerloom/installation-receipt.json. No global or home configuration changed.\n`;
  const expected = {schemaVersion: SCHEMA_VERSION, adapterVersion: ADAPTER_VERSION, plan,
    installedFiles: [...plan.files.map(f => ({path: f.targetPath, sha256: f.sha256, bytes: f.bytes})), {path: 'START-HERE.md', sha256: digest(start), bytes: Buffer.byteLength(start)}], executionAuthorized: false};
  assert.deepEqual(installBundle(input, plan.revision), expected);
  assert.equal(fs.readFileSync(join(input.targetDir, 'START-HERE.md'), 'utf8'), start);
  assert.equal(fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json'), 'utf8'), JSON.stringify(expected, null, 2) + '\n');
});

for (const harness of ['codex', 'claude']) {
  test(`${harness}: exact projection closure and no cross-harness approval replay`, t => {
    const {input} = fixture(t); input.harness = harness;
    const before = validateBundle(input.bundleDir), plan = planInstallation(input);
    const other = planInstallation({...input, harness: harness === 'codex' ? 'claude' : 'codex'});
    assert.notEqual(plan.revision, other.revision);
    assert.throws(() => installBundle(input, other.revision), code('STALE_APPROVAL'));
    for (const drift of [{targetDir: input.targetDir + '-other'}, {selected: ['report']}])
      assert.throws(() => installBundle({...input, ...drift}, plan.revision), code('STALE_APPROVAL'));
    assert.equal(fs.existsSync(input.targetDir), false);
    const receipt = installBundle(input, plan.revision);
    assert.equal(receipt.adapterVersion, harness === 'codex' ? 'codex/local-skills/v1alpha1' : 'claude/project-skills/v1alpha1');
    assert.equal(receipt.adapterVersion, receipt.plan.adapterVersion);
    for (const f of receipt.plan.files) {
      assert.deepEqual(fs.readFileSync(join(input.targetDir, f.targetPath)), fs.readFileSync(join(input.bundleDir, '.bowerloom', f.path)));
      if (f.partId === 'report') assert.ok(f.targetPath.startsWith(harness === 'codex' ? '.agents/skills/bowerloom-report/' : '.claude/skills/bowerloom-report/'));
    }
    assert.equal(receipt.executionAuthorized, false);
    assert.deepEqual(validateBundle(input.bundleDir), before);
    const installed = fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json'));
    assert.throws(() => installBundle(input, plan.revision), code('TARGET_EXISTS'));
    assert.deepEqual(fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json')), installed);
    if (harness === 'claude') assert.match(fs.readFileSync(join(input.targetDir, 'START-HERE.md'), 'utf8'), /Actual native discovery has not been observed/);
  });
  for (const directory of ['.claude', '.CLAUDE', '.ClAuDe', '.agents', '.codex', '.config', '.git', 'node_modules']) {
    test(`${harness}: refuse managed ancestor ${directory}`, t => {
      const {input, parent} = fixture(t); input.harness = harness;
      const managed = join(parent, directory); fs.mkdirSync(managed, {mode: 0o700});
      const targetDir = join(managed, 'project');
      assert.throws(() => planInstallation({...input, targetDir}), code('UNSAFE_TARGET'));
      assert.equal(fs.existsSync(targetDir), false);
    });
  }
  test(`${harness}: source aliases, missing closure and checked publication race refuse`, t => {
    const {input, parent, change} = fixture(t); input.harness = harness;
    fs.symlinkSync(input.bundleDir, join(parent, 'alias'));
    assert.throws(() => planInstallation({...input, bundleDir: join(parent, 'alias')}), code('SYMLINK_FORBIDDEN'));
    assert.throws(() => planInstallation({...input, targetDir: join(parent, 'BUNDLE', 'child')}), code('UNSAFE_TARGET'));
    const approved = planInstallation(input).revision;
    // Named injection: first staged write creates destination before final makePlan revalidation.
    const original = fs.writeFileSync; let injected = false;
    fs.writeFileSync = function(path, ...args) {
      if (!injected && String(path).includes('.bowerloom-stage-')) { injected = true; fs.mkdirSync(input.targetDir); original(join(input.targetDir, 'keep.txt'), 'other writer'); }
      return original.call(this, path, ...args);
    }; syncBuiltinESMExports();
    try { assert.throws(() => installBundle(input, approved), code('TARGET_EXISTS')); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.equal(fs.readFileSync(join(input.targetDir, 'keep.txt'), 'utf8'), 'other writer');
    assert.equal(fs.readdirSync(parent).some(p => p.startsWith('.bowerloom-stage-') || p.endsWith('.lock')), false);
    change(m => { m.parts.find(p => p.id === 'editorial').dependsOn = ['missing']; });
    assert.throws(() => planInstallation({...input, targetDir: join(parent, 'unused')}), code('MISSING_DEPENDENCY'));
  });
  test(`${harness}: changed source and existing lock cannot publish`, t => {
    const {input, parent} = fixture(t); input.harness = harness;
    const revision = planInstallation(input).revision;
    const lock = join(parent, '.bowerloom-install-workspace.lock'); fs.writeFileSync(lock, 'held');
    assert.throws(() => installBundle(input, revision), code('INSTALL_LOCKED'));
    assert.equal(fs.readFileSync(lock, 'utf8'), 'held'); fs.unlinkSync(lock);
    fs.appendFileSync(join(input.bundleDir, '.bowerloom/skills/report/SKILL.md'), '\nchanged');
    assert.throws(() => installBundle(input, revision), code('STALE_APPROVAL'));
    assert.equal(fs.existsSync(input.targetDir), false);
  });
}

for (const harness of ['codex', 'claude']) {
  test(`${harness}: forged adapter digest refuses without publishing`, t => {
    const {input} = fixture(t); input.harness = harness;
    const {revision, ...body} = planInstallation(input);
    const forged = digest(canonical({...body, adapterVersion: 'unreviewed/adapter/v9'}));
    assert.notEqual(revision, forged);
    assert.throws(() => installBundle(input, forged), code('STALE_APPROVAL'));
    assert.equal(fs.existsSync(input.targetDir), false);
  });
  test(`${harness}: preexisting interrupted stage and lock stay held`, t => {
    const {input, parent} = fixture(t); input.harness = harness;
    const plan = planInstallation(input);
    const abandoned = join(parent, '.bowerloom-stage-interrupted'); fs.mkdirSync(abandoned);
    fs.writeFileSync(join(abandoned, 'partial.txt'), 'retained');
    const lock = join(parent, '.bowerloom-install-workspace.lock'); fs.writeFileSync(lock, 'unresolved');
    assert.throws(() => installBundle(input, plan.revision), code('INSTALL_LOCKED'));
    assert.equal(fs.readFileSync(join(abandoned, 'partial.txt'), 'utf8'), 'retained');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'unresolved');
    assert.equal(fs.existsSync(input.targetDir), false);
  });
  test(`${harness}: completed rename with lost acknowledgement retains published receipt`, t => {
    const {input} = fixture(t); input.harness = harness;
    const plan = planInstallation(input), original = fs.renameSync;
    fs.renameSync = function(from, to) { original.call(this, from, to); throw new Error('synthetic acknowledgement lost'); };
    syncBuiltinESMExports();
    try { assert.throws(() => installBundle(input, plan.revision), /synthetic acknowledgement lost/); }
    finally { fs.renameSync = original; syncBuiltinESMExports(); }
    const bytes = fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json'));
    assert.equal(JSON.parse(bytes).plan.revision, plan.revision);
    assert.throws(() => installBundle(input, plan.revision), code('TARGET_EXISTS'));
    assert.deepEqual(fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json')), bytes);
  });
}
