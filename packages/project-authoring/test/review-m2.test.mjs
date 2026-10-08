// Review M2 findings 1 to 4 (scratchpad REVIEW-M2-01.md).
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier, manifestVerifier } from '../../../dist/packages/project-authoring/src/index.js';
import { serializeManifest, validateManifest } from '../../../dist/packages/skill-manifest/src/schema.js';

const signal = () => new AbortController().signal;
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-review-m2-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir, bowerloom: join(dir, '.bowerloom'), auth: join(dir, '.bowerloom', 'authoring') };
}
const create = (dir, input) => withProjectLock(dir, signal(), async held => applyCreate(input, (await planCreate(input)).revision, held));
const owners = dir => [authoringVerifier(dir), manifestVerifier(dir)];
/** Runs apply with one fs call failing, as a kill at that point would leave the folder. */
async function crashAt(p, input, method, matches) {
  const plan = await planCreate(input);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const real = fs[method];
    fs[method] = function (...args) { if (matches(...args.map(String))) throw Object.assign(new Error('crash'), { code: 'EIO' }); return real.apply(this, args); };
    try { return await applyCreate(input, plan.revision, held); } finally { fs[method] = real; }
  }), /crash/);
  return plan;
}
const skill = (p, name) => ({ kind: 'skill', project: p.dir, name, teams: [] });

test('finding 1: a record left with its temporary as a second link is read, and plan removes the temporary', async t => {
  for (const record of ['pending', 'receipt']) {
    const p = await project(t);
    await crashAt(p, skill(p, 'voice'), 'unlinkSync', target => new RegExp(`authoring/\\.tmp-[a-f0-9]{64}-${record}$`).test(target));
    assert.equal(fs.lstatSync(join(p.auth, `${record}.json`)).nlink, 2, record);
    const next = await planCreate(skill(p, 'tone'));
    assert.equal(next.scratch.length, 1, record); assert.match(next.scratch[0], new RegExp(`^\\.tmp-[a-f0-9]{64}-${record}$`));
    await withProjectLock(p.dir, signal(), held => applyCreate(skill(p, 'tone'), next.revision, held));
    assert.deepEqual(fs.readdirSync(p.auth), ['receipt.json'], record);
    assert.equal(fs.lstatSync(join(p.auth, 'receipt.json')).nlink, 1);
    const status = await inspectStartup(p.dir, { owners: owners(p.dir) }); assert.equal(status.status, 'ready-for-review', JSON.stringify(status.drift));
  }
});

test('finding 1: a second link that is not the matching temporary still refuses', async t => {
  const p = await project(t); await create(p.dir, skill(p, 'voice'));
  fs.linkSync(join(p.auth, 'receipt.json'), join(p.auth, `.tmp-${'a'.repeat(64)}-pending`));
  await assert.rejects(planCreate(skill(p, 'tone')), e => e.code === 'AUTHORING_UNSAFE_PATH');
});

test('finding 2: an item registered with its pending record still there is settled by the next plan', async t => {
  const p = await project(t), first = await crashAt(p, { kind: 'team', project: p.dir, name: 'desk' }, 'unlinkSync', target => target.endsWith('authoring/pending.json'));
  assert.ok(fs.existsSync(join(p.auth, 'pending.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(p.auth, 'receipt.json'), 'utf8')).items.map(i => [i.id, i.planRevision]), [['desk', first.revision]]);
  const next = await planCreate(skill(p, 'voice'));
  assert.equal(next.settled.id, 'desk'); assert.equal(next.discard, null); assert.equal(next.finish, null);
  await withProjectLock(p.dir, signal(), held => applyCreate(skill(p, 'voice'), next.revision, held));
  assert.deepEqual(fs.readdirSync(p.auth), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});

test('finding 3: a registered team or skill that was deleted is reported', async t => {
  for (const [kind, rel] of [['team', 'teams/desk'], ['skill', 'skills/desk']]) {
    const p = await project(t); await create(p.dir, kind === 'team' ? { kind, project: p.dir, name: 'desk' } : skill(p, 'desk'));
    fs.rmSync(join(p.bowerloom, rel), { recursive: true });
    assert.deepEqual(await authoringVerifier(p.dir).verify('authoring', 'directory', signal()), { result: 'refused', code: 'AUTHORING_ITEM_MISSING' }, kind);
    const status = await inspectStartup(p.dir, { owners: owners(p.dir) });
    assert.notEqual(status.status, 'ready-for-review'); assert.ok(status.drift.some(d => d.code === 'AUTHORING_ITEM_MISSING'), JSON.stringify(status.drift));
  }
});

test('finding 4: a plan that goes stale after the first write says so, and the next plan finishes the item', async t => {
  const p = await project(t), input = skill(p, 'voice'), plan = await planCreate(input), manifest = join(p.bowerloom, 'skills.json');
  const error = await withProjectLock(p.dir, signal(), async held => {
    const rename = fs.renameSync;
    fs.renameSync = function (from, to) {
      const out = rename.call(this, from, to);
      // Another writer changes skills.json just after the skill folder landed.
      if (String(to).endsWith('.bowerloom/skills/voice')) fs.writeFileSync(manifest, serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'other', source: { kind: 'local', path: 'skills/other' } }] })), { mode: 0o644 });
      return out;
    };
    try { await applyCreate(input, plan.revision, held); return null; } catch (e) { return e; } finally { fs.renameSync = rename; }
  });
  assert.equal(error?.code, 'AUTHORING_WRITE_INTERRUPTED'); assert.doesNotMatch(error.message, /Nothing was applied/);
  const next = await planCreate(input); assert.equal(next.finish.id, 'voice');
  await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held));
  assert.deepEqual(fs.readdirSync(p.auth), ['receipt.json']);
});
