import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock, lockSlot, lockServer } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier, manifestVerifier, AUTHORING_REFUSAL_CODES } from '../../../dist/packages/project-authoring/src/index.js';
import { parseManifest } from '../../../dist/packages/skill-manifest/src/schema.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => { assert.equal(error?.code, expected, error?.stack); return true; };
const signal = () => new AbortController().signal;

async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-authoring-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir, bowerloom: join(dir, '.bowerloom') };
}
/** Every path and its bytes under the project, links included, so any write shows. */
function tree(dir) {
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const s = fs.lstatSync(join(dir, rel));
    out[rel] = s.isSymbolicLink() ? `link:${fs.readlinkSync(join(dir, rel))}` : s.isFile() ? sha(fs.readFileSync(join(dir, rel))) : 'dir';
  }
  return out;
}
const create = (dir, input) => withProjectLock(dir, signal(), async held => applyCreate(input, (await planCreate(input)).revision, held));
const owners = dir => [authoringVerifier(dir), manifestVerifier(dir)];
const readReceipt = p => JSON.parse(fs.readFileSync(join(p.bowerloom, 'authoring', 'receipt.json'), 'utf8'));

test('plan is read-only and deterministic, and apply writes exactly the planned team', async t => {
  const p = await project(t), before = tree(p.dir);
  const input = { kind: 'team', project: p.dir, name: 'research-desk', profile: 'research' };
  const plan = await planCreate(input), again = await planCreate(input);
  assert.deepEqual(plan, again); assert.deepEqual(tree(p.dir), before);
  assert.equal(plan.format, 'bowerloom/authoring-plan/v1beta1'); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.item.kind, 'team'); assert.equal(plan.item.id, 'research-desk'); assert.deepEqual(plan.item.teams, []);
  assert.equal(plan.finish, null); assert.equal(plan.discard, null);
  assert.equal(plan.reads.receipt, null); assert.equal(plan.reads.pending, null);
  assert.equal(plan.reads.brief.sha256, sha(fs.readFileSync(join(p.bowerloom, 'brief.json'))));
  assert.ok(plan.files.length === 10 && plan.files.every(f => f.path.startsWith('teams/research-desk/') && f.sha256 === sha(f.text)));
  assert.notEqual((await planCreate({ ...input, profile: 'engineer' })).revision, plan.revision);

  const receipt = await withProjectLock(p.dir, signal(), held => applyCreate(input, plan.revision, held));
  assert.equal(receipt.format, 'bowerloom/authoring-receipt/v1beta1'); assert.match(receipt.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.items, [{ kind: 'team', id: 'research-desk', teams: [], files: plan.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })), planRevision: plan.revision }]);
  assert.deepEqual(readReceipt(p), receipt);
  for (const f of plan.files) assert.equal(fs.readFileSync(join(p.bowerloom, f.path), 'utf8'), f.text);
  assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json']);
  const added = Object.keys(tree(p.dir)).filter(k => !Object.hasOwn(before, k)).sort();
  const expected = new Set(['.bowerloom/authoring', '.bowerloom/authoring/receipt.json']);
  for (const f of plan.files) { const parts = f.path.split('/'); for (let i = 2; i <= parts.length; i++) expected.add(`.bowerloom/${parts.slice(0, i).join('/')}`); }
  assert.deepEqual(added, [...expected].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(tree(p.dir)).filter(([k]) => Object.hasOwn(before, k))), before);
  const inspected = await inspectStartup(p.dir, { owners: owners(p.dir) });
  assert.equal(inspected.status, 'ready-for-review', JSON.stringify(inspected.drift));
  // The approval cannot be replayed.
  await assert.rejects(withProjectLock(p.dir, signal(), held => applyCreate(input, plan.revision, held)), code('TEAM_EXISTS'));
});

test('skill create writes skills/<id>/SKILL.md and the local entry in skills.json, binding the manifest sha256 it read', async t => {
  const p = await project(t);
  const first = { kind: 'skill', project: p.dir, name: 'house-style', teams: [] };
  const plan = await planCreate(first);
  assert.equal(plan.reads.manifest, null); assert.equal(plan.manifest.before, null);
  assert.deepEqual(plan.files.map(f => f.path), ['skills/house-style/SKILL.md']); assert.match(plan.files[0].text, /^---\nname: house-style\n/);
  await withProjectLock(p.dir, signal(), held => applyCreate(first, plan.revision, held));
  const after1 = fs.readFileSync(join(p.bowerloom, 'skills.json'));
  assert.deepEqual(parseManifest(after1).skills, [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);

  const second = { kind: 'skill', project: p.dir, name: 'brand-voice', teams: ['first-team'] };
  const plan2 = await planCreate(second);
  assert.deepEqual(plan2.reads.manifest, { sha256: sha(after1), bytes: after1.length }); assert.equal(plan2.manifest.before.sha256, sha(after1));
  // skills.json changed after the plan: the bound sha256 no longer matches.
  fs.writeFileSync(join(p.bowerloom, 'skills.json'), after1.toString().replace('"skills": [', '"skills": [ '));
  const changed = tree(p.dir);
  await assert.rejects(withProjectLock(p.dir, signal(), held => applyCreate(second, plan2.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(tree(p.dir), changed);
  fs.writeFileSync(join(p.bowerloom, 'skills.json'), after1);
  await withProjectLock(p.dir, signal(), held => applyCreate(second, plan2.revision, held));
  assert.deepEqual(parseManifest(fs.readFileSync(join(p.bowerloom, 'skills.json'))).skills.map(s => [s.id, s.teams]), [['brand-voice', ['first-team']], ['house-style', undefined]]);
  assert.deepEqual(readReceipt(p).items.map(i => [i.kind, i.id, i.teams]), [['skill', 'brand-voice', ['first-team']], ['skill', 'house-style', []]]);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});

test('prompt create writes prompts/<id>.md, for a team made by team create', async t => {
  const p = await project(t);
  await create(p.dir, { kind: 'team', project: p.dir, name: 'research-desk' });
  const input = { kind: 'prompt', project: p.dir, name: 'weekly-update', teams: ['research-desk', 'first-team'] };
  const plan = await planCreate(input);
  assert.deepEqual(plan.files.map(f => f.path), ['prompts/weekly-update.md']); assert.deepEqual(plan.item.teams, ['first-team', 'research-desk']);
  await withProjectLock(p.dir, signal(), held => applyCreate(input, plan.revision, held));
  assert.equal(fs.readFileSync(join(p.bowerloom, 'prompts', 'weekly-update.md'), 'utf8'), plan.files[0].text);
  assert.equal(fs.lstatSync(join(p.bowerloom, 'prompts', 'weekly-update.md')).nlink, 1);
  const r = await inspectStartup(p.dir, { owners: owners(p.dir) });
  assert.equal(r.status, 'ready-for-review', JSON.stringify(r.drift));
  assert.deepEqual(r.owned.map(o => [o.path, o.owner, o.state]), [['.bowerloom/authoring', 'authoring', 'verified'], ['.bowerloom/prompts', 'authoring', 'verified'], ['.bowerloom/teams/research-desk', 'authoring', 'verified']]);
});

test('each refusal code fires, and a refused plan writes nothing', async t => {
  const p = await project(t);
  await create(p.dir, { kind: 'team', project: p.dir, name: 'desk' });
  await create(p.dir, { kind: 'skill', project: p.dir, name: 'house-style', teams: [] });
  await create(p.dir, { kind: 'prompt', project: p.dir, name: 'hello', teams: [] });
  const before = tree(p.dir);
  const cases = [
    [{ kind: 'team', project: p.dir, name: 'desk' }, 'TEAM_EXISTS'],
    [{ kind: 'team', project: p.dir, name: 'first-team' }, 'TEAM_ID_RESERVED'],
    [{ kind: 'team', project: p.dir, name: 'Desk Two' }, 'TEAM_NAME_INVALID'],
    [{ kind: 'team', project: p.dir, name: 'x'.repeat(65) }, 'TEAM_NAME_INVALID'],
        [{ kind: 'skill', project: p.dir, name: 'other', teams: ['nobody'] }, 'TEAM_NOT_FOUND'],
    [{ kind: 'prompt', project: p.dir, name: 'other', teams: ['Not An Id'] }, 'TEAM_NOT_FOUND'],
    [{ kind: 'skill', project: p.dir, name: 'house-style', teams: [] }, 'SKILL_EXISTS'],
    [{ kind: 'skill', project: p.dir, name: 'personal-assistant', teams: [] }, 'SKILL_NAME_RESERVED'],
    [{ kind: 'skill', project: p.dir, name: 'prompt-hello', teams: [] }, 'SKILL_NAME_RESERVED'],
    [{ kind: 'skill', project: p.dir, name: '../up', teams: [] }, 'SKILL_NAME_INVALID'],
    [{ kind: 'prompt', project: p.dir, name: 'hello', teams: [] }, 'PROMPT_EXISTS'],
    [{ kind: 'prompt', project: p.dir, name: 'Hello', teams: [] }, 'PROMPT_NAME_INVALID'],
    [{ kind: 'prompt', project: p.dir, name: 'x'.repeat(58), teams: [] }, 'PROMPT_NAME_INVALID'],
  ];
  for (const [input, expected] of cases) await assert.rejects(planCreate(input), code(expected), JSON.stringify(input));
  // A malformed input is a usage error, not a refusal of the name.
  for (const input of [{ kind: 'team', project: p.dir, name: 'desk2', profile: 'pirate' }, { kind: 'team', project: p.dir, name: 'desk2', teams: [] }, { kind: 'skill', project: p.dir, name: 'x' }, { kind: 'pipeline', project: p.dir, name: 'x', teams: [] }, { kind: 'prompt', project: 'relative', name: 'x', teams: [] }, { kind: 'prompt', project: p.dir, name: 'x', teams: ['first-team', 'first-team'] }]) {
    await assert.rejects(planCreate(input), code('USAGE'), JSON.stringify(input));
  }
  // A folder that is on disk but not registered also counts as taken.
  fs.mkdirSync(join(p.bowerloom, 'teams', 'squatter')); fs.mkdirSync(join(p.bowerloom, 'skills', 'squatter'));
  await assert.rejects(planCreate({ kind: 'team', project: p.dir, name: 'squatter' }), code('TEAM_EXISTS'));
  await assert.rejects(planCreate({ kind: 'skill', project: p.dir, name: 'squatter', teams: [] }), code('SKILL_EXISTS'));
  fs.rmdirSync(join(p.bowerloom, 'teams', 'squatter')); fs.rmdirSync(join(p.bowerloom, 'skills', 'squatter'));
  assert.deepEqual(tree(p.dir), before);

  // REVISION_PENDING: a revise transaction is open.
  fs.writeFileSync(join(p.dir, '.bowerloom-revision.json'), '{}');
  await assert.rejects(planCreate({ kind: 'prompt', project: p.dir, name: 'later', teams: [] }), code('REVISION_PENDING'));
  fs.unlinkSync(join(p.dir, '.bowerloom-revision.json'));

  // PROJECT_BRIEF_INVALID: team create reads brief.json directly.
  const brief = fs.readFileSync(join(p.bowerloom, 'brief.json'));
  fs.writeFileSync(join(p.bowerloom, 'brief.json'), '{"format":"bowerloom/brief/v1alpha1"}');
  await assert.rejects(planCreate({ kind: 'team', project: p.dir, name: 'later' }), code('PROJECT_BRIEF_INVALID'));
  fs.chmodSync(join(p.bowerloom, 'brief.json'), 0o666); fs.writeFileSync(join(p.bowerloom, 'brief.json'), brief);
  await assert.rejects(planCreate({ kind: 'team', project: p.dir, name: 'later' }), code('PROJECT_BRIEF_INVALID'));
  fs.chmodSync(join(p.bowerloom, 'brief.json'), 0o600);

  // AUTHORING_RECEIPT_INVALID: a hand-edited receipt.
  const receipt = fs.readFileSync(join(p.bowerloom, 'authoring', 'receipt.json'));
  fs.writeFileSync(join(p.bowerloom, 'authoring', 'receipt.json'), receipt.toString().replace('"house-style"', '"house-stile"'));
  await assert.rejects(planCreate({ kind: 'prompt', project: p.dir, name: 'later', teams: [] }), code('AUTHORING_RECEIPT_INVALID'));
  assert.equal((await authoringVerifier(p.dir).verify('authoring', 'directory', signal())).code, 'AUTHORING_RECEIPT_INVALID');
  fs.writeFileSync(join(p.bowerloom, 'authoring', 'receipt.json'), receipt);

  // AUTHORING_PENDING: a pending record whose item landed with other bytes.
  const pending = { kind: 'prompt', project: p.dir, name: 'later', teams: [] };
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    fs.linkSync = ((original) => function (from, to) { if (String(to).endsWith('prompts/later.md')) { fs.linkSync = original; throw Object.assign(new Error('crash'), { code: 'EIO' }); } return original.call(this, from, to); })(fs.linkSync);
    return applyCreate(pending, (await planCreate(pending)).revision, held);
  }), /crash/);
  fs.writeFileSync(join(p.bowerloom, 'prompts', 'later.md'), 'someone else\n', { mode: 0o600 });
  await assert.rejects(planCreate(pending), code('AUTHORING_PENDING'));
  await assert.rejects(planCreate({ kind: 'team', project: p.dir, name: 'unrelated' }), code('AUTHORING_PENDING'));
  assert.deepEqual(await authoringVerifier(p.dir).verify('authoring', 'directory', signal()), { result: 'refused', code: 'AUTHORING_PENDING' });

  for (const expected of ['STALE_APPROVAL', 'PROJECT_LOCKED', 'AUTHORING_UNSAFE_PATH']) assert.ok(AUTHORING_REFUSAL_CODES.includes(expected), expected);
});

test('a planted symlink is refused with AUTHORING_UNSAFE_PATH', async t => {
  for (const plant of ['prompts', 'teams', 'authoring', 'skill-target', 'receipt']) {
    const p = await project(t), outside = fs.mkdtempSync(join(tmpdir(), 'bowerloom-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    let input = { kind: 'prompt', project: p.dir, name: 'hello', teams: [] };
    if (plant === 'prompts') fs.symlinkSync(outside, join(p.bowerloom, 'prompts'));
    if (plant === 'teams') { fs.renameSync(join(p.bowerloom, 'teams'), join(outside, 'teams')); fs.symlinkSync(join(outside, 'teams'), join(p.bowerloom, 'teams')); input = { kind: 'team', project: p.dir, name: 'desk' }; }
    if (plant === 'authoring') fs.symlinkSync(outside, join(p.bowerloom, 'authoring'));
    if (plant === 'skill-target') { fs.symlinkSync(outside, join(p.bowerloom, 'skills', 'linked')); input = { kind: 'skill', project: p.dir, name: 'linked', teams: [] }; }
    if (plant === 'receipt') { fs.mkdirSync(join(p.bowerloom, 'authoring'), { mode: 0o700 }); fs.writeFileSync(join(outside, 'r.json'), '{}'); fs.symlinkSync(join(outside, 'r.json'), join(p.bowerloom, 'authoring', 'receipt.json')); }
    const before = tree(p.dir), outsideBefore = tree(outside);
    await assert.rejects(planCreate(input), code(plant === 'skill-target' ? 'SKILL_EXISTS' : 'AUTHORING_UNSAFE_PATH'), plant);
    assert.deepEqual(tree(p.dir), before, plant); assert.deepEqual(tree(outside), outsideBefore, plant);
  }
});

test('a held revise lock blocks create, and a token from another project or after release is refused', async t => {
  const p = await project(t), input = { kind: 'prompt', project: p.dir, name: 'hello', teams: [] }, plan = await planCreate(input), before = tree(p.dir);
  // The listener revise's withLock binds: the shared slot of this project folder, with its banner.
  const slot = lockSlot(p.dir), server = lockServer(slot);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, resolve); });
  try {
    await assert.rejects(withProjectLock(p.dir, signal(), held => applyCreate(input, plan.revision, held)), code('PROJECT_LOCKED'));
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(tree(p.dir), before);
  let stale; await withProjectLock(p.dir, signal(), async held => { stale = held; });
  await assert.rejects(applyCreate(input, plan.revision, stale), code('PROJECT_LOCKED'));
  await assert.rejects(applyCreate(input, plan.revision, { dir: p.dir, assertHeld() {} }), code('PROJECT_LOCKED'));
  const other = await project(t);
  await assert.rejects(withProjectLock(other.dir, signal(), held => applyCreate(input, plan.revision, held)), code('PROJECT_LOCKED'));
  await assert.rejects(withProjectLock(p.dir, signal(), held => applyCreate(input, 'f'.repeat(64), held)), code('STALE_APPROVAL'));
  assert.deepEqual(tree(p.dir), before);
});

test('a crash between the item and the receipt is finished on the next run, only when the bytes match', async t => {
  for (const kind of ['team', 'skill', 'prompt']) {
    const p = await project(t), input = kind === 'team' ? { kind, project: p.dir, name: 'desk' } : { kind, project: p.dir, name: 'desk', teams: [] };
    const plan = await planCreate(input);
    // The receipt write fails after the item landed (and, for a skill, after skills.json changed).
    await assert.rejects(withProjectLock(p.dir, signal(), async held => {
      const link = fs.linkSync, rename = fs.renameSync;
      const crash = target => String(target).endsWith('authoring/receipt.json');
      fs.linkSync = function (from, to) { if (crash(to)) throw Object.assign(new Error('crash'), { code: 'EIO' }); return link.call(this, from, to); };
      fs.renameSync = function (from, to) { if (crash(to)) throw Object.assign(new Error('crash'), { code: 'EIO' }); return rename.call(this, from, to); };
      try { return await applyCreate(input, plan.revision, held); } finally { fs.linkSync = link; fs.renameSync = rename; }
    }), /crash/, kind);
    assert.ok(fs.existsSync(join(p.bowerloom, 'authoring', 'pending.json')), kind);
    assert.equal(fs.existsSync(join(p.bowerloom, 'authoring', 'receipt.json')), false, kind);
    for (const f of plan.files) assert.equal(fs.readFileSync(join(p.bowerloom, f.path), 'utf8'), f.text, kind);
    const during = await inspectStartup(p.dir, { owners: owners(p.dir) });
    assert.equal(during.status, 'drifted'); assert.ok(during.drift.some(d => d.code === 'AUTHORING_PENDING'), JSON.stringify(during.drift));

    const next = await planCreate(input);
    assert.equal(next.item, null, kind); assert.equal(next.finish.id, 'desk'); assert.equal(next.finish.planRevision, plan.revision);
    const receipt = await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held));
    assert.deepEqual(receipt.items.map(i => [i.kind, i.id, i.planRevision]), [[kind, 'desk', plan.revision]]);
    assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json'], kind);
    if (kind === 'skill') assert.deepEqual(parseManifest(fs.readFileSync(join(p.bowerloom, 'skills.json'))).skills.map(s => s.id), ['desk']);
    const after = await inspectStartup(p.dir, { owners: owners(p.dir) });
    assert.equal(after.status, 'ready-for-review', `${kind} ${JSON.stringify(after.drift)}`);
  }
});

test('a crash before the item landed is cleared on the next run; a skill whose skills.json write failed is finished', async t => {
  const p = await project(t), input = { kind: 'team', project: p.dir, name: 'desk' }, plan = await planCreate(input);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const rename = fs.renameSync;
    fs.renameSync = function (from, to) { if (String(to).endsWith('teams/desk')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return rename.call(this, from, to); };
    try { return await applyCreate(input, plan.revision, held); } finally { fs.renameSync = rename; }
  }), /crash/);
  assert.equal(fs.existsSync(join(p.bowerloom, 'teams', 'desk')), false);
  const next = await planCreate(input);
  assert.equal(next.discard.id, 'desk'); assert.equal(next.finish, null); assert.equal(next.item.id, 'desk'); assert.notEqual(next.revision, plan.revision);
  await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held));
  assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');

  const skill = { kind: 'skill', project: p.dir, name: 'voice', teams: ['desk'] }, sp = await planCreate(skill);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const link = fs.linkSync;
    fs.linkSync = function (from, to) { if (String(to).endsWith('.bowerloom/skills.json')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return link.call(this, from, to); };
    try { return await applyCreate(skill, sp.revision, held); } finally { fs.linkSync = link; }
  }), /crash/);
  assert.equal(fs.existsSync(join(p.bowerloom, 'skills.json')), false);
  const finish = await planCreate(skill);
  assert.equal(finish.finish.id, 'voice'); assert.equal(finish.manifest.before, null);
  await withProjectLock(p.dir, signal(), held => applyCreate(skill, finish.revision, held));
  assert.deepEqual(parseManifest(fs.readFileSync(join(p.bowerloom, 'skills.json'))).skills, [{ id: 'voice', teams: ['desk'], source: { kind: 'local', path: 'skills/voice' } }]);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});

test('a prompt that crashed between its link and the stage cleanup is finished', async t => {
  const p = await project(t), input = { kind: 'prompt', project: p.dir, name: 'hello', teams: [] }, plan = await planCreate(input);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const unlink = fs.unlinkSync;
    fs.unlinkSync = function (target) { if (/authoring\/\.stage-[a-f0-9]{64}\/prompts\/hello\.md$/.test(String(target))) throw Object.assign(new Error('crash'), { code: 'EIO' }); return unlink.call(this, target); };
    try { return await applyCreate(input, plan.revision, held); } finally { fs.unlinkSync = unlink; }
  }), /crash/);
  assert.equal(fs.lstatSync(join(p.bowerloom, 'prompts', 'hello.md')).nlink, 2);
  const next = await planCreate(input); assert.equal(next.finish.id, 'hello');
  await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held));
  assert.equal(fs.lstatSync(join(p.bowerloom, 'prompts', 'hello.md')).nlink, 1);
  assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});

test('an edit after creation shows as edited, not drift; an unsafe edit is refused', async t => {
  const p = await project(t);
  await create(p.dir, { kind: 'team', project: p.dir, name: 'desk' });
  await create(p.dir, { kind: 'skill', project: p.dir, name: 'voice', teams: [] });
  await create(p.dir, { kind: 'prompt', project: p.dir, name: 'hello', teams: [] });
  const verifier = authoringVerifier(p.dir);
  for (const [path, kind] of [['teams/desk', 'directory'], ['skills/voice', 'directory'], ['prompts', 'directory'], ['authoring', 'directory']]) assert.deepEqual(await verifier.verify(path, kind, signal()), { result: 'verified' }, path);
  fs.appendFileSync(join(p.bowerloom, 'teams', 'desk', 'prompts', 'lead.md'), '\nAlso check the budget.\n');
  fs.writeFileSync(join(p.bowerloom, 'skills', 'voice', 'notes.md'), 'More notes.\n', { mode: 0o644 });
  fs.writeFileSync(join(p.bowerloom, 'prompts', 'hello.md'), '# Hello\n\nSay hello.\n');
  for (const path of ['teams/desk', 'skills/voice', 'prompts']) assert.deepEqual(await verifier.verify(path, 'directory', signal()), { result: 'edited' }, path);
  const r = await inspectStartup(p.dir, { owners: owners(p.dir) });
  assert.equal(r.status, 'ready-for-review', JSON.stringify(r.drift)); assert.deepEqual(r.drift, []);
  assert.deepEqual(r.owned.filter(o => o.state === 'edited').map(o => o.path), ['.bowerloom/prompts', '.bowerloom/skills/voice', '.bowerloom/teams/desk']);
  // The full guards stay on every read of authored files.
  fs.chmodSync(join(p.bowerloom, 'skills', 'voice', 'notes.md'), 0o666);
  assert.deepEqual(await verifier.verify('skills/voice', 'directory', signal()), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  fs.chmodSync(join(p.bowerloom, 'skills', 'voice', 'notes.md'), 0o644);
  fs.linkSync(join(p.bowerloom, 'skills', 'voice', 'notes.md'), join(p.dir, 'second-link.md'));
  assert.deepEqual(await verifier.verify('skills/voice', 'directory', signal()), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  fs.unlinkSync(join(p.dir, 'second-link.md'));
  fs.symlinkSync(join(p.bowerloom, 'brief.json'), join(p.bowerloom, 'teams', 'desk', 'linked.json'));
  assert.deepEqual(await verifier.verify('teams/desk', 'directory', signal()), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  fs.unlinkSync(join(p.bowerloom, 'teams', 'desk', 'linked.json'));
  fs.writeFileSync(join(p.bowerloom, 'skills', 'voice', 'big.md'), Buffer.alloc(300 * 1024, 97));
  assert.deepEqual(await verifier.verify('skills/voice', 'directory', signal()), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  fs.unlinkSync(join(p.bowerloom, 'skills', 'voice', 'big.md'));
  fs.writeFileSync(join(p.bowerloom, 'prompts', 'stranger.md'), '# Stranger\n');
  assert.deepEqual(await verifier.verify('prompts', 'directory', signal()), { result: 'refused', code: 'AUTHORING_UNREGISTERED' });
  // Claims are a pure path test.
  assert.equal(verifier.claims('teams/desk', 'directory'), true); assert.equal(verifier.claims('teams/first-team', 'directory'), false);
  assert.equal(verifier.claims('skills/personal-assistant', 'directory'), false); assert.equal(verifier.claims('teams/desk', 'file'), false);
  assert.equal(verifier.claims('teams/desk/team.yaml', 'file'), false); assert.equal(verifier.claims('skills.json', 'file'), false);
  assert.equal(manifestVerifier(p.dir).claims('skills.json', 'file'), true); assert.equal(manifestVerifier(p.dir).claims('skills.json', 'directory'), false);
});
