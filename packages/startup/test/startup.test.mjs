import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { planStartup, applyStartup, inspectStartup, renderStartupReview } from '../../../dist/packages/startup/src/index.js';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';
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


for (const profile of ['engineer', 'founder', 'research']) test(`${profile} profile compiles distinct roles with file-only approval`, async t => {
  const { input } = fixture(t);
  input.brief.profile = profile;
  const plan = await planStartup(input);
  assert.equal(plan.templateVersion, 'bowerloom/startup-template/v1beta4');
  assert.equal(plan.input.brief.profile, profile);
  const labels = { engineer: ['Engineering lead', 'Implementation maker', 'Code reviewer'], founder: ['Startup lead', 'Operations maker', 'Claims reviewer'], research: ['Experiment lead', 'Protocol maker', 'Methods reviewer'] };
  assert.deepEqual(plan.compiled.definition.owners.map(owner => owner.role), labels[profile]);
  const review = plan.files.find(file => file.path === 'startup-review.md').text;
  assert.ok(review.includes('These proposed task permissions are not granted by installation'));
  assert.ok(review.includes('<details>')); assert.ok(review.includes('Complete generated technical contents'));
  assert.ok(review.includes('25 percent')); assert.ok(review.includes('two active workers'));
  for (const label of labels[profile]) assert.ok(review.includes(label));
  assert.ok(renderStartupReview(plan).includes(plan.revision));
  await applyStartup(input, plan.revision);
  assert.deepEqual(await compileCrew(join(input.targetDir, '.bowerloom/teams/first-team/team.yaml')), plan.compiled);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
  assert.equal(validateBundle(input.targetDir).manifest.schemaVersion, 'bowerloom/v1alpha1');
});

test('default engineer profile and exact profile approval cannot diverge', async t => {
  const { input } = fixture(t);
  const plan = await planStartup(input);
  assert.equal(plan.input.brief.profile, 'engineer');
  assert.equal((await planStartup({ ...input, brief: { ...input.brief, profile: 'engineer' } })).revision, plan.revision);
  await assert.rejects(applyStartup({ ...input, brief: { ...input.brief, profile: 'founder' } }, plan.revision), code('STALE_APPROVAL'));
  for (const profile of ['unknown', '__proto__', '', null, {}]) await assert.rejects(planStartup({ ...input, brief: { ...input.brief, profile } }), code('STARTUP_PROFILE'));
  assert.equal(fs.existsSync(input.targetDir), false);
});

test('historical v1alpha1 receipt inspects without rewrite, default injection or lost drift checks', async t => {
  const { input } = fixture(t);
  const historic = JSON.parse(fs.readFileSync(new URL('./fixtures/scaffold-v1alpha1.json', import.meta.url), 'utf8'));
  const currentPlan = await planStartup(input);
  const body = { format: 'bowerloom/startup-plan/v1alpha1', templateVersion: historic.templateVersion, input: { mode: input.mode, targetDir: input.targetDir, brief: historic.brief }, binding: currentPlan.binding, files: historic.files, compiled: historic.compiled, specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  const plan = { ...body, revision: digest(canonicalJson(body)) };
  const root = join(input.targetDir, '.bowerloom'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const file of historic.files) { const path = join(root, file.path); fs.mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path, file.text, { mode: 0o600 }); }
  const identity = path => { const stat = fs.lstatSync(path, { bigint: true }); return { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 }; };
  const receipt = { format: 'bowerloom/startup-receipt/v1alpha1', plan, installedTargetIdentity: identity(input.targetDir), installedBowerloomIdentity: identity(root), specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  const path = join(root, 'installation-receipt.json');fs.writeFileSync(path, JSON.stringify(receipt), { mode: 0o600 });
  const before = fs.readFileSync(path);
  const result = await inspectStartup(input.targetDir);
  assert.equal(result.specReady, true);assert.equal(result.revision, plan.revision);
  assert.deepEqual(fs.readFileSync(path), before);assert.equal(Object.hasOwn(JSON.parse(before).plan.input.brief, 'profile'), false);
  assert.equal(fs.existsSync(join(root, 'startup-review.md')), false);
  fs.appendFileSync(join(root, 'brief.json'), ' ');
  assert.ok((await inspectStartup(input.targetDir)).drift.some(item => item.path === '.bowerloom/brief.json' && item.kind === 'changed'));
  receipt.plan.templateVersion = 'bowerloom/startup-template/unsupported';fs.writeFileSync(path, JSON.stringify(receipt));
  assert.equal((await inspectStartup(input.targetDir)).drift[0].kind, 'invalid-receipt');
});

test('expanded technical review remains escaped and inspectable for a maximum-size brief', async t => {
  const { input } = fixture(t);
  input.brief.goal = '<script>\n'.repeat(666);
  const plan = await planStartup(input);
  const review = plan.files.find(file => file.path === 'startup-review.md');
  assert.ok(review.text.includes('&lt;script&gt;'));assert.ok(!review.text.includes('<script>'));
  await applyStartup(input, plan.revision);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
});

for (const historical of ['v1alpha2', 'v1beta2']) {
const historicalFixture = JSON.parse(fs.readFileSync(new URL(`./fixtures/scaffold-${historical}.json`, import.meta.url), 'utf8'));
for (const historic of historicalFixture.cases) test(`historical ${historical} ${historic.brief.profile} receipt preserves all bytes and rejects reused approval`, async t => {
  const { input } = fixture(t);
  input.brief = historic.brief;
  const currentPlan = await planStartup(input);
  const body = { format: 'bowerloom/startup-plan/v1alpha1', templateVersion: historicalFixture.templateVersion, input: currentPlan.input, binding: currentPlan.binding, files: historic.files, compiled: historic.compiled, specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  const plan = { ...body, revision: digest(canonicalJson(body)) };
  assert.notEqual(plan.revision, currentPlan.revision);
  await assert.rejects(applyStartup(input, plan.revision), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(input.targetDir), false);
  const root = join(input.targetDir, '.bowerloom'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const file of historic.files) { const path = join(root, file.path); fs.mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path, file.text, { mode: 0o600 }); }
  const identity = path => { const stat = fs.lstatSync(path, { bigint: true }); return { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 }; };
  const receipt = { format: 'bowerloom/startup-receipt/v1alpha1', plan, installedTargetIdentity: identity(input.targetDir), installedBowerloomIdentity: identity(root), specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  fs.writeFileSync(join(root, 'installation-receipt.json'), JSON.stringify(receipt), { mode: 0o600 });
  const paths = [...historic.files.map(file => file.path), 'installation-receipt.json'];
  const before = paths.map(path => fs.readFileSync(join(root, path)));
  for (let pass = 0; pass < 2; pass++) {
    const result = await inspectStartup(input.targetDir);
    assert.equal(result.specReady, true); assert.equal(result.revision, plan.revision);
    assert.equal(result.compiledCandidate, historic.compiled.candidateRevision);
    assert.deepEqual(paths.map(path => fs.readFileSync(join(root, path))), before);
  }
  assert.equal(fs.existsSync(join(root, 'optional-controls.md')), historical === 'v1beta2');
  await assert.rejects(planStartup({ ...input, mode: 'existing' }), code('BOWERLOOM_EXISTS'));
  fs.appendFileSync(join(root, 'startup-review.md'), 'changed');
  assert.ok((await inspectStartup(input.targetDir)).drift.some(item => item.path === '.bowerloom/startup-review.md' && item.kind === 'changed'));
});

}

test('installed handoff exposes the actual project, goal and decision without expanding technical contents', async t => {
  const { input } = fixture(t);
  input.brief.projectName = 'My website project'; input.brief.goal = 'Plan the pages for my ceramics website';
  const plan = await planStartup(input);
  await applyStartup(input, plan.revision);
  const root = join(input.targetDir, '.bowerloom');
  const start = fs.readFileSync(join(root, 'START-HERE.md'), 'utf8');
  const review = fs.readFileSync(join(root, 'startup-review.md'), 'utf8');
  const visible = review.replace(/<details>[\s\S]*?<\/details>/g, '');
  for (const document of [start.replace(/<details>[\s\S]*?<\/details>/g, ''), visible]) {
    assert.ok(document.includes(input.brief.projectName)); assert.ok(document.includes(input.brief.goal));
    assert.match(document, /do not need to read YAML or JSON/i);
    assert.match(document, /Discussion alone does not approve a change/);
    assert.doesNotMatch(document, /Revise apply requires both the exact old installation revision/);
    assert.match(document, /revision-pending/);
    assert.match(document, /optional-controls\.md/);
    assert.doesNotMatch(document, /Then read brief\.json|Read the goal in brief\.json/);
  }
  assert.ok(visible.includes('Your first decision')); assert.ok(visible.includes('Accepting the direction does not start work'));
  for (const owner of plan.compiled.definition.owners) assert.ok(visible.includes(owner.role));
  const technical = JSON.parse(review.match(/<pre>([\s\S]*)<\/pre>/)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepEqual(technical.files, plan.files.filter(file => file.path !== 'startup-review.md'));
  assert.deepEqual(technical.compiled, plan.compiled);
  const before = plan.files.map(file => fs.readFileSync(join(root, file.path)));
  await assert.rejects(planStartup({ ...input, mode: 'existing', brief: { ...input.brief, goal: 'Discussed but not approved change' } }), code('BOWERLOOM_EXISTS'));
  assert.deepEqual(plan.files.map(file => fs.readFileSync(join(root, file.path))), before);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
});

test('optional control instructions preserve separate approval, local scope and uncertain-stop limits', async t => {
  const { input } = fixture(t);
  const plan = await planStartup(input);
  const guide = plan.files.find(file => file.path === 'optional-controls.md').text;
  for (const command of ['init status --target', 'link plan --from', 'link apply --from', 'link read --connection', 'link revoke --connection', 'destruct first-team --root', 'destruct all']) assert.ok(guide.includes(command));
  assert.ok(guide.includes('--approve REVISION')); assert.ok(guide.includes('--registry /absolute/private-registry'));
  assert.ok(guide.includes('This setup enrolls no work')); assert.ok(guide.includes('unrelated personal-agent session'));
  assert.ok(guide.includes('does not erase copies already read')); assert.ok(guide.includes('STOP_UNCONFIRMED'));
  assert.ok(guide.includes('Do not treat a timeout as success')); assert.ok(guide.includes('No handoff is required'));
  assert.equal(plan.runtimeReady, false); assert.equal(plan.executionAuthorized, false);
});

test('visible project and goal treat markup as data while the raw brief remains exact', async t => {
  const { input } = fixture(t);
  input.brief.projectName = '[Pretend link](https://example.invalid) <script>';
  input.brief.goal = '</details>\n# Fake approval\n<script>alert(1)</script>';
  const plan = await planStartup(input);
  for (const path of ['START-HERE.md', 'startup-review.md']) {
    const visible = plan.files.find(file => file.path === path).text.split('<details>')[0];
    assert.ok(!visible.includes('<script>')); assert.ok(!visible.includes('</details>'));
    assert.ok(!visible.includes('\n# Fake approval')); assert.ok(visible.includes('&lt;script&gt;'));
    assert.ok(!visible.includes('[Pretend link](https://example.invalid)'));
  }
  assert.equal(JSON.parse(plan.files.find(file => file.path === 'brief.json').text).goal, input.brief.goal);
  await applyStartup(input, plan.revision);
  assert.equal((await inspectStartup(input.targetDir)).specReady, true);
});

test('frozen beta3 source matches its previously shipped templates except version-local import paths', () => {
  const source=fs.readFileSync(new URL('../src/scaffold-v1beta3.ts',import.meta.url),'utf8').replace("from './handoff-v1beta3.js'", "from './handoff.js'");
  const handoff=fs.readFileSync(new URL('../src/handoff-v1beta3.ts',import.meta.url),'utf8').replace("from './scaffold-v1beta3.js'", "from './scaffold.js'");
  assert.equal(digest(source),'9dcf64d0ac4e0dd211b19e82fac223967fd0007542729bd1fda1337a118fa719');
  assert.equal(digest(handoff),'6aea606ea3c379eb10924603fb84c39bf86b2fe0e1be48c30d1bb455d4517ba2');
});

for(const profile of ['engineer','founder','research'])test(`beta4 ${profile} first-read copy accounts for receipt and retains all revision rules in details`,async t=>{
  const {input}=fixture(t);input.brief.profile=profile;const plan=await planStartup(input);
  const find=path=>plan.files.find(file=>file.path===path).text;
  const frozen=await import('../../../dist/packages/startup/src/handoff-v1beta3.js');
  assert.equal(plan.files.length,20);assert.match(renderStartupReview(plan),/Creates 20 setup files and a private installation receipt/);
  assert.match(renderStartupReview(plan),/Keep the receipt out of shared definitions/);
  assert.match(find('startup-review.md'),/creates 20 setup files and a private installation receipt/);
  assert.match(find('startup-review.md'),/installation-receipt\.json.*private machine-specific evidence/);
  for(const path of ['START-HERE.md','startup-review.md']) {
    const text=find(path),visible=text.replace(/<details>[\s\S]*?<\/details>/g,'');
    assert.match(visible,/Discussion alone does not approve a change/);
    assert.match(visible,/revision-pending.*keep work stopped/);
    assert.doesNotMatch(visible,/Revise apply requires both|private backup|explicit resume or rollback/);
    assert.ok(text.includes(frozen.refinementGuidance),'Every original revision/recovery rule remains verbatim in optional details');
    assert.match(text,/<summary>Revision approval, backup, and recovery rules<\/summary>/);
  }
  const guide=find('optional-controls.md');assert.match(guide,/installed `bowerloom` command/);assert.doesNotMatch(guide,/node dist\/|built Bowerloom checkout/);
  for(const command of ['init status','link plan','link apply','link read','link revoke','destruct first-team','destruct all'])assert.ok(guide.includes('bowerloom '+command));
  const agreement=find('working-agreement.md');assert.equal(agreement,find('teams/first-team/assets/working-agreement.md'));
  assert.doesNotMatch(agreement,/a engineering|a experiment|deterministic/);
  if(profile==='engineer')assert.match(agreement,/an engineering lead/);
  if(profile==='research')assert.match(agreement,/an experiment lead/);
  assert.match(agreement,/when you review proposed work/);assert.match(agreement,/runtime, the software that runs the team/);
  assert.doesNotMatch(find('skills/personal-assistant/SKILL.md'),/deterministic scaffold/);
  const receipt=await applyStartup(input,plan.revision);
  assert.equal(receipt.executionAuthorized,false);assert.equal((await inspectStartup(input.targetDir)).specReady,true);
  const root=join(input.targetDir,'.bowerloom');
  const inventory=[];const walk=base=>{for(const entry of fs.readdirSync(join(root,base),{withFileTypes:true})){const path=base?base+'/'+entry.name:entry.name;if(entry.isDirectory())walk(path);else inventory.push(path);}};walk('');
  assert.deepEqual(inventory.sort(),[...plan.files.map(file=>file.path),'installation-receipt.json'].sort());
});
