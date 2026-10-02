import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { validateBundle } from '../../../dist/packages/portable/src/index.js';
const digest = text => createHash('sha256').update(text).digest('hex');
const code = expected => error => error?.code === expected;
function fixture(t, mode = 'new') {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-startup-'))); fs.chmodSync(parent, 0o700);
  const targetDir = join(parent, 'My Project'); if (mode === 'existing') fs.mkdirSync(targetDir, { mode: 0o755 });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, input: { mode, targetDir, brief: { projectName: 'Sage & Sunshine Shop', goal: 'Draft a clear weekly shop update from evidence I will supply.', assistantName: 'My everyday assistant', teamName: 'Shop editorial team', reviewMode: 'milestones' } } };
}

test('planning is read-only, deterministic, goal-bound, and includes full texts and asset pins', async t => {
  const { parent, input } = fixture(t);
  const before = fs.readdirSync(parent);
  const first = await planStartup(input), second = await planStartup(input);
  assert.deepEqual(first, second); assert.deepEqual(fs.readdirSync(parent), before);
  assert.equal(fs.existsSync(input.targetDir), false); assert.equal(first.specReady, true); assert.equal(first.runtimeReady, false);
  assert.equal(first.executionAuthorized, false); assert.match(first.revision, /^[a-f0-9]{64}$/);
  for (const file of first.files) { assert.equal(file.sha256, digest(file.text)); assert.equal(file.bytes, Buffer.byteLength(file.text)); assert.ok(!file.text.includes(input.targetDir)); }
  assert.notEqual(first.revision, (await planStartup({ ...input, brief: { ...input.brief, goal: 'Draft a different deliverable.' } })).revision);
  assert.notEqual(first.revision, (await planStartup({ ...input, targetDir: join(parent, 'Another Project') })).revision);
  const team = first.compiled.definition;
  assert.deepEqual(team.owners.map(owner => owner.id), ['lead', 'maker', 'reviewer']);
  assert.deepEqual(team.budget, { maxActiveWorkers: 2, reservePercent: 25, paidFallback: false });
  assert.ok(team.tasks.every(task => task.approval === 'required'));
  assert.ok(team.tasks.every(task => task.effects.every(effect => effect.operation === 'workspace.write')));
  assert.deepEqual(team.tasks.find(task => task.id === 'review').inputs.scope.source, { task: 'scope', output: 'document' });
});

test('new workspace passes the real compiler, portable validator, and repeatable inspection', async t => {
  const { input } = fixture(t);
  const plan = await planStartup(input), receipt = await applyStartup(input, plan.revision);
  assert.equal(receipt.plan.revision, plan.revision); assert.equal(receipt.runtimeReady, false);
  const compiled = await compileCrew(join(input.targetDir, '.bowerloom/teams/first-team/team.yaml'));
  assert.deepEqual(compiled, plan.compiled);
  assert.deepEqual(validateBundle(input.targetDir).manifest.parts.map(part => part.id), ['first-team', 'personal-assistant']);
  assert.deepEqual(fs.readdirSync(input.targetDir), ['.bowerloom']);
  const inspection = await inspectStartup(input.targetDir), again = await inspectStartup(input.targetDir);
  assert.deepEqual(again, inspection); assert.equal(inspection.status, 'ready-for-review'); assert.equal(inspection.specReady, true);
  assert.equal(inspection.runtimeReady, false); assert.equal(inspection.contextImported, false); assert.equal(inspection.hostedAgentCreated, false);
  await assert.rejects(applyStartup(input, plan.revision), code('TARGET_EXISTS'));
});

test('existing project adoption preserves all old bytes and does not read settings', async t => {
  const { input } = fixture(t, 'existing');
  const preserved = { 'AGENTS.md': 'Existing agent rules.\n', '.codex/config.toml': 'private = "do-not-import"\n', '.claude/settings.json': '{"private":"keep"}\n', '.agents/skills/keep/SKILL.md': 'Keep this skill.\n', '.env': 'SECRET=keep-local\n', 'app.js': 'console.log("unchanged");\n' };
  for (const [path, text] of Object.entries(preserved)) { const full = join(input.targetDir, path); fs.mkdirSync(join(full, '..'), { recursive: true }); fs.writeFileSync(full, text); }
  const namesBefore = fs.readdirSync(input.targetDir);
  const originalRead = fs.readFileSync, originalOpen = fs.openSync;
  const forbidden = new Set(Object.keys(preserved).map(path => join(input.targetDir, path)));
  fs.readFileSync = function(path, ...rest) { assert.ok(!forbidden.has(String(path)), `Read old file: ${path}`); return originalRead.call(this, path, ...rest); };
  fs.openSync = function(path, ...rest) { assert.ok(!forbidden.has(String(path)), `Opened old file: ${path}`); return originalOpen.call(this, path, ...rest); };
  syncBuiltinESMExports();
  try { const plan = await planStartup(input); await applyStartup(input, plan.revision); assert.equal((await inspectStartup(input.targetDir)).specReady, true); }
  finally { fs.readFileSync = originalRead; fs.openSync = originalOpen; syncBuiltinESMExports(); }
  for (const [path, text] of Object.entries(preserved)) assert.equal(fs.readFileSync(join(input.targetDir, path), 'utf8'), text);
  assert.deepEqual(fs.readdirSync(input.targetDir).filter(name => name !== '.bowerloom'), namesBefore);
  const wholePlan = fs.readFileSync(join(input.targetDir, '.bowerloom/installation-receipt.json'), 'utf8');
  assert.ok(!wholePlan.includes('do-not-import')); assert.ok(!wholePlan.includes('SECRET=keep-local'));
});

test('changed brief, missing approval, and target replacement invalidate installation', async t => {
  const { input, parent } = fixture(t, 'existing');
  const plan = await planStartup(input);
  await assert.rejects(applyStartup(input, 'yes'), code('EXACT_APPROVAL_REQUIRED'));
  await assert.rejects(applyStartup({ ...input, brief: { ...input.brief, goal: 'Changed requested result.' } }, plan.revision), code('STALE_APPROVAL'));
  fs.renameSync(input.targetDir, join(parent, 'original')); fs.mkdirSync(input.targetDir);
  await assert.rejects(applyStartup(input, plan.revision), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(join(input.targetDir, '.bowerloom')), false);
});

test('new-parent replacement also invalidates approval', async t => {
  const { parent, input } = fixture(t);
  const container = join(parent, 'container'); fs.mkdirSync(container); input.targetDir = join(container, 'new-workspace');
  const plan = await planStartup(input);
  fs.renameSync(container, join(parent, 'old-container')); fs.mkdirSync(container);
  await assert.rejects(applyStartup(input, plan.revision), code('STALE_APPROVAL'));
});

test('existing Bowerloom folders and case aliases are never overwritten', async t => {
  const { input, parent } = fixture(t, 'existing');
  fs.mkdirSync(join(input.targetDir, '.Bowerloom'));
  await assert.rejects(planStartup(input), code('BOWERLOOM_EXISTS'));
  await assert.rejects(planStartup({ ...input, mode: 'new' }), code('TARGET_EXISTS'));
  await assert.rejects(planStartup({ ...input, mode: 'new', targetDir: join(parent, 'my project') }), code('TARGET_EXISTS'));
});

test('protected paths, symlink ancestors, and unsafe parent permissions fail closed', async t => {
  const { parent, input } = fixture(t);
  for (const path of [homedir(), '/usr/local/sample', join(parent, 'nmaahc-sm', 'test'), join(parent, 'NMAAHC-SM-old', 'test'), join(parent, '.CoDeX', 'test'), join(parent, '.CLAUDE', 'test'), join(parent, 'Library', 'test')]) await assert.rejects(planStartup({ ...input, targetDir: path }), code('PROTECTED_TARGET'));
  const actual = join(parent, 'actual'); fs.mkdirSync(actual); fs.symlinkSync(actual, join(parent, 'linked'));
  await assert.rejects(planStartup({ ...input, targetDir: join(parent, 'linked', 'project') }), code('UNSAFE_DIRECTORY'));
  fs.chmodSync(parent, 0o777); await assert.rejects(planStartup(input), code('PRIVATE_OWNER_REQUIRED')); fs.chmodSync(parent, 0o700);
  await assert.rejects(planStartup({ ...input, targetDir: input.targetDir + '/' }), code('STARTUP_TARGET'));
});

test('unknown fields, prototype keys, getters, oversized text, and control characters are refused', async t => {
  const { input } = fixture(t);
  for (const bad of [{ ...input, importSettings: true }, { ...input, brief: { ...input.brief, shell: 'run' } }, { ...input, brief: { ...input.brief, goal: 'a\0second line' } }, { ...input, brief: { ...input.brief, goal: 'x'.repeat(6001) } }, { ...input, brief: { ...input.brief, reviewMode: 'automatic' } }, JSON.parse(JSON.stringify(input).replace('"brief":{', '"brief":{"__proto__":{},'))]) await assert.rejects(planStartup(bad));
  const withGetter = { ...input }; Object.defineProperty(withGetter, 'brief', { get() { throw new Error('Getter must not run'); }, enumerable: true });
  await assert.rejects(planStartup(withGetter), code('STARTUP_INPUT'));
  await assert.rejects(planStartup(Object.assign(Object.create({ imported: true }), input)), code('STARTUP_INPUT'));
});

test('a concurrent lock blocks writes and remains untouched', async t => {
  const { input, parent } = fixture(t), plan = await planStartup(input);
  const lock = join(parent, `.bowerloom-startup-${digest(input.targetDir.normalize('NFC').toLowerCase()).slice(0, 24)}.lock`);
  fs.writeFileSync(lock, 'another owner', { mode: 0o600 });
  await assert.rejects(applyStartup(input, plan.revision), code('STARTUP_LOCKED'));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another owner'); assert.equal(fs.existsSync(input.targetDir), false);
});

test('concurrent attempts install once without overwriting', async t => {
  const { input } = fixture(t), plan = await planStartup(input);
  const outcomes = await Promise.allSettled([applyStartup(input, plan.revision), applyStartup(input, plan.revision)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
});

test('failure before rename removes only the owned stage and lock', async t => {
  const { input, parent } = fixture(t, 'existing'); fs.writeFileSync(join(input.targetDir, 'keep.txt'), 'keep');
  const plan = await planStartup(input), original = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); }; syncBuiltinESMExports();
  try { await assert.rejects(applyStartup(input, plan.revision), /simulated rename failure/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(fs.readdirSync(parent), ['My Project']); assert.deepEqual(fs.readdirSync(input.targetDir), ['keep.txt']);
  assert.equal(fs.readFileSync(join(input.targetDir, 'keep.txt'), 'utf8'), 'keep');
});

test('inspection reports changed, missing, extra, symlinked and corrupted content without repair', async t => {
  const { input } = fixture(t); await applyStartup(input, (await planStartup(input)).revision);
  const root = join(input.targetDir, '.bowerloom');
  fs.appendFileSync(join(root, 'brief.json'), ' ');
  fs.unlinkSync(join(root, 'working-agreement.md'));
  fs.writeFileSync(join(root, 'extra.txt'), 'extra');
  fs.unlinkSync(join(root, 'milestones.md')); fs.symlinkSync(join(root, 'brief.json'), join(root, 'milestones.md'));
  const status = await inspectStartup(input.targetDir);
  assert.equal(status.specReady, false); assert.equal(status.runtimeReady, false);
  assert.ok(status.drift.some(entry => entry.path === '.bowerloom/brief.json' && entry.kind === 'changed'));
  assert.ok(status.drift.some(entry => entry.path === '.bowerloom/working-agreement.md' && entry.kind === 'missing'));
  assert.ok(status.drift.some(entry => entry.path === '.bowerloom/milestones.md' && entry.kind === 'unsafe'));
  assert.ok(status.drift.some(entry => entry.path === '.bowerloom/extra.txt' && entry.kind === 'unexpected'));
  fs.writeFileSync(join(root, 'installation-receipt.json'), '{broken');
  const broken = await inspectStartup(input.targetDir); assert.equal(broken.revision, null); assert.equal(broken.drift[0].kind, 'invalid-receipt');
});

test('portable definitions compile after relocation while installation inspection reports the move', async t => {
  const { input, parent } = fixture(t); const plan = await planStartup(input); await applyStartup(input, plan.revision);
  const moved = join(parent, 'Moved Project'); fs.renameSync(input.targetDir, moved);
  assert.deepEqual(await compileCrew(join(moved, '.bowerloom/teams/first-team/team.yaml')), plan.compiled);
  assert.ok((await inspectStartup(moved)).drift.some(entry => entry.kind === 'installation-binding-changed'));
});

test('normal multiline goals remain data and compile without YAML anchors', async t => {
  const { input } = fixture(t);
  input.brief.goal = 'Prepare a short project report.\r\n\tInclude the evidence I supply.\nLeave unknowns visible.';
  const plan = await planStartup(input);
  assert.equal(JSON.parse(plan.files.find(file => file.path === 'brief.json').text).goal, input.brief.goal);
  const team = plan.files.find(file => file.path === 'teams/first-team/team.yaml').text;
  assert.ok(!team.includes('&a1')); assert.ok(!team.includes('*a1'));
  await applyStartup(input, plan.revision);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
  await assert.rejects(planStartup({ ...input, targetDir: input.targetDir + '-other', brief: { ...input.brief, assistantName: 'Two\nLines' } }), code('STARTUP_TEXT'));
});

test('invalid UTF16 input cannot change meaning during UTF8 serialization', async t => {
  const { input } = fixture(t);
  for (const field of ['projectName', 'goal', 'assistantName', 'teamName']) await assert.rejects(planStartup({ ...input, brief: { ...input.brief, [field]: 'unpaired \ud800 surrogate' } }), code('STARTUP_TEXT'));
  await assert.rejects(planStartup({ ...input, targetDir: input.targetDir + '\udfff' }), code('STARTUP_TARGET'));
});
