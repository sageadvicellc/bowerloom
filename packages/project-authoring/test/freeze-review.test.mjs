// Freeze review of F (b68f557), finding 1: a registered prompt whose file was deleted. Status reports it as a missing
// item, as it does a team or a skill, and `prompt create <id>` restores it through the normal plan and approval.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier, manifestVerifier } from '../../../dist/packages/project-authoring/src/index.js';
import { receiptOf, recordText } from '../../../dist/packages/project-authoring/src/state.js';

const signal = () => new AbortController().signal;
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-freeze-authoring-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir, bowerloom: join(dir, '.bowerloom'), auth: join(dir, '.bowerloom', 'authoring') };
}
const create = (dir, input) => withProjectLock(dir, signal(), async held => applyCreate(input, (await planCreate(input)).revision, held));
const owners = dir => [authoringVerifier(dir), manifestVerifier(dir)];
const prompt = (p, name, teams = []) => ({ kind: 'prompt', project: p.dir, name, teams });
const code = expected => e => e?.code === expected;

test('a registered prompt whose file is gone is AUTHORING_ITEM_MISSING, as a team or a skill is', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check')); await create(p.dir, prompt(p, 'review'));
  fs.rmSync(join(p.bowerloom, 'prompts', 'runbook-check.md'));
  assert.deepEqual(await authoringVerifier(p.dir).verify('authoring', 'directory', signal()), { result: 'refused', code: 'AUTHORING_ITEM_MISSING' });
  // The prompt that is still there is unchanged, so the prompts folder is not reported as edited for a missing file.
  assert.deepEqual(await authoringVerifier(p.dir).verify('prompts', 'directory', signal()), { result: 'verified' });
  const status = await inspectStartup(p.dir, { owners: owners(p.dir) });
  assert.equal(status.status, 'drifted'); assert.ok(status.drift.some(d => d.code === 'AUTHORING_ITEM_MISSING'), JSON.stringify(status.drift));
  // With the whole prompts folder gone the record still names the prompt.
  fs.rmSync(join(p.bowerloom, 'prompts'), { recursive: true });
  assert.deepEqual(await authoringVerifier(p.dir).verify('authoring', 'directory', signal()), { result: 'refused', code: 'AUTHORING_ITEM_MISSING' });
});

test('prompt create restores a registered prompt whose file is gone, with its recorded text and teams; the receipt stays', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check', ['first-team']));
  const file = join(p.bowerloom, 'prompts', 'runbook-check.md'), text = fs.readFileSync(file, 'utf8'), receipt = fs.readFileSync(join(p.auth, 'receipt.json'));
  fs.writeFileSync(file, 'My own words.\n'); fs.rmSync(file);
  for (const teams of [[], ['first-team']]) {
    const plan = await planCreate(prompt(p, 'runbook-check', teams));
    assert.equal(plan.item, null); assert.equal(plan.restore.id, 'runbook-check'); assert.deepEqual(plan.restore.teams, ['first-team']);
    assert.deepEqual(plan.files.map(f => [f.path, f.text]), [['prompts/runbook-check.md', text]]);
    assert.equal(plan.writesAuthorized, false); assert.equal(fs.existsSync(file), false, 'a plan writes nothing');
  }
  await create(p.dir, prompt(p, 'runbook-check'));
  assert.equal(fs.readFileSync(file, 'utf8'), text); assert.equal(fs.lstatSync(file).nlink, 1);
  assert.deepEqual(fs.readFileSync(join(p.auth, 'receipt.json')), receipt, 'a restore registers nothing new');
  assert.deepEqual(fs.readdirSync(p.auth), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
  // Once it is back, the id is taken again.
  await assert.rejects(planCreate(prompt(p, 'runbook-check')), code('PROMPT_EXISTS'));
});

test('a restore with other teams refuses and names the restore step; nothing is written', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check'));
  await create(p.dir, { kind: 'team', project: p.dir, name: 'docs-crew' });
  fs.rmSync(join(p.bowerloom, 'prompts', 'runbook-check.md'));
  const before = fs.readdirSync(p.bowerloom, { recursive: true }).sort();
  await assert.rejects(planCreate(prompt(p, 'runbook-check', ['docs-crew'])), e => e.code === 'PROMPT_RESTORE_TEAMS' && /without --team/.test(e.message));
  assert.deepEqual(fs.readdirSync(p.bowerloom, { recursive: true }).sort(), before);
});

test('a restore refuses when the recorded text is not the text create writes, and names the restore step', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check'));
  // A receipt from a build that wrote other text: same item, other pin.
  const path = join(p.auth, 'receipt.json'), value = JSON.parse(fs.readFileSync(path, 'utf8'));
  value.items[0].files[0] = { ...value.items[0].files[0], sha256: 'a'.repeat(64), bytes: 10 };
  fs.writeFileSync(path, recordText(receiptOf(value.items)));
  fs.rmSync(join(p.bowerloom, 'prompts', 'runbook-check.md'));
  await assert.rejects(planCreate(prompt(p, 'runbook-check')), e => e.code === 'PROMPT_RESTORE_UNAVAILABLE' && /version control/.test(e.message) && /git restore/.test(e.message));
  assert.equal(fs.existsSync(join(p.bowerloom, 'prompts', 'runbook-check.md')), false);
});

test('a restore that stops after its pending record is finished by the next plan', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check'));
  const file = join(p.bowerloom, 'prompts', 'runbook-check.md'), text = fs.readFileSync(file, 'utf8'); fs.rmSync(file);
  const plan = await planCreate(prompt(p, 'runbook-check'));
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const real = fs.linkSync;
    fs.linkSync = function (...args) { if (String(args[1]).endsWith('prompts/runbook-check.md')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return real.apply(this, args); };
    try { return await applyCreate(prompt(p, 'runbook-check'), plan.revision, held); } finally { fs.linkSync = real; }
  }), /crash/);
  assert.ok(fs.existsSync(join(p.auth, 'pending.json'))); assert.equal(fs.existsSync(file), false);
  const next = await planCreate(prompt(p, 'runbook-check'));
  assert.equal(next.settled.id, 'runbook-check'); assert.equal(next.scratch.length, 1); assert.equal(next.restore.id, 'runbook-check');
  await withProjectLock(p.dir, signal(), held => applyCreate(prompt(p, 'runbook-check'), next.revision, held));
  assert.equal(fs.readFileSync(file, 'utf8'), text); assert.deepEqual(fs.readdirSync(p.auth), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});

test('a restore through a linked prompts folder refuses before any write', async t => {
  const p = await project(t); await create(p.dir, prompt(p, 'runbook-check'));
  const folder = join(p.bowerloom, 'prompts'), moved = join(p.dir, 'elsewhere');
  fs.renameSync(folder, moved); fs.rmSync(join(moved, 'runbook-check.md')); fs.symlinkSync(moved, folder);
  await assert.rejects(planCreate(prompt(p, 'runbook-check')), code('AUTHORING_UNSAFE_PATH'));
  assert.deepEqual(fs.readdirSync(moved), []);
});
