// Authoring in the store (store writes spec, 3.4, 4.4): planCreate and applyCreate with scope "store".
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import '../../../dist/tests/support/isolate-home.js';
import { withStoreForWriteWith } from '../../../dist/packages/project-context/src/store.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { parseManifest, STORE_MANIFEST_LIMITS, serializeManifest, MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { addLocalEntry } from '../../../dist/packages/skill-manifest/src/add.js';
import { scaffoldTeam } from '../../../dist/packages/startup/src/scaffold.js';
import { storeBrief } from '../../../dist/packages/project-config/src/brief.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => { assert.equal(error?.code, expected, error?.stack); return true; };
const signal = () => new AbortController().signal;

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-create-store-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  return { base, home, store: join(home, '.bowerloom'), hooks: { accountHome: join(base, 'nobody') } };
}
const input = (w, kind, name, extra = {}) => ({ kind, project: w.store, name, scope: 'store', ...(kind === 'team' ? {} : { teams: [] }), ...extra });
/** Plans, then applies inside withStoreForWrite, as the CLI does. */
async function create(w, i, revision) {
  const plan = await planCreate(i);
  return withStoreForWriteWith(w.home, signal(), (context, held, created) => applyCreate(i, revision ?? plan.revision, held, { context, created }), w.hooks);
}
/** Every path and its bytes under a folder. */
function tree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const s = fs.lstatSync(join(dir, rel));
    out[rel] = s.isSymbolicLink() ? 'link' : s.isFile() ? sha(fs.readFileSync(join(dir, rel))) : 'dir';
  }
  return out;
}

test('1. plans against an absent store carry storeCreate true, a null identity, and the folders to make', async t => {
  const w = world(t);
  for (const kind of ['skill', 'prompt', 'team']) {
    const plan = await planCreate(input(w, kind, 'thing'));
    assert.equal(plan.format, 'bowerloom/authoring-plan/v1beta2'); assert.equal(plan.scope, 'store');
    assert.equal(plan.storeCreate, true); assert.equal(plan.bowerloom, null); assert.equal(plan.project, w.store);
    const parent = kind === 'team' ? 'teams' : kind === 'skill' ? 'skills' : 'prompts';
    assert.deepEqual(plan.folders, ['authoring', parent], kind);
    assert.equal(plan.reads.brief, null);
  }
  assert.equal(fs.existsSync(w.store), false, 'a plan writes nothing');
});

test('2. the team plan reads no brief.json and uses the fixed store brief, identically on every run', async t => {
  const w = world(t), a = await planCreate(input(w, 'team', 'desk', { profile: 'founder' })), b = await planCreate(input(w, 'team', 'desk', { profile: 'founder' }));
  assert.deepEqual(a, b); assert.equal(a.compiledCandidate, b.compiledCandidate);
  const expected = scaffoldTeam(storeBrief('founder'), 'desk', 'desk');
  assert.equal(a.compiledCandidate, expected.compiled.candidateRevision);
  assert.deepEqual(a.files.map(f => [f.path, f.text]), expected.files.map(f => [f.path, f.text]));
  assert.equal((await planCreate(input(w, 'team', 'desk'))).compiledCandidate, scaffoldTeam(storeBrief(undefined), 'desk', 'desk').compiled.candidateRevision);
  assert.equal(a.input.profile, 'founder');
  assert.equal((await planCreate(input(w, 'team', 'desk'))).input.profile, 'engineer', 'C2: the plan never holds a null profile for the store');
});

test('3. apply writes each kind, the skills.json entry, and the receipt directly in the store folder', async t => {
  const w = world(t);
  const skill = await create(w, input(w, 'skill', 'house-style'));
  assert.deepEqual(skill.items.map(i => [i.kind, i.id]), [['skill', 'house-style']]);
  assert.match(fs.readFileSync(join(w.store, 'skills', 'house-style', 'SKILL.md'), 'utf8'), /^---\nname: house-style\n/);
  const manifest = parseManifest(fs.readFileSync(join(w.store, 'skills.json')), MANIFEST_LIMITS);
  assert.deepEqual(manifest.harnesses, ['claude', 'codex']); assert.deepEqual(manifest.skills, [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  await create(w, input(w, 'prompt', 'weekly-update'));
  await create(w, input(w, 'team', 'research-desk', { profile: 'research' }));
  const receipt = JSON.parse(fs.readFileSync(join(w.store, 'authoring', 'receipt.json'), 'utf8'));
  assert.deepEqual(receipt.items.map(i => [i.kind, i.id]), [['prompt', 'weekly-update'], ['skill', 'house-style'], ['team', 'research-desk']]);
  assert.ok(fs.existsSync(join(w.store, 'prompts', 'weekly-update.md')));
  assert.ok(fs.existsSync(join(w.store, 'teams', 'research-desk', 'team.yaml')));
  assert.equal(fs.existsSync(join(w.store, '.bowerloom')), false, 'no .bowerloom folder inside the store');
  assert.deepEqual(fs.readdirSync(join(w.store, 'authoring')), ['receipt.json']);
  assert.equal(fs.statSync(join(w.store, 'skills', 'house-style')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(join(w.store, 'skills', 'house-style', 'SKILL.md')).mode & 0o777, 0o600);
});

test('4. an absent store at plan time does not make apply stale', async t => {
  const w = world(t), i = input(w, 'skill', 'x'), plan = await planCreate(i);
  assert.equal(plan.storeCreate, true);
  await withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    assert.equal(created, true);
    return applyCreate(i, plan.revision, held, { context, created });
  }, w.hooks);
  assert.ok(fs.existsSync(join(w.store, 'skills', 'x', 'SKILL.md')));
});

test('5. a store that another process made between plan and apply gives STALE_APPROVAL', async t => {
  const w = world(t), i = input(w, 'skill', 'x'), plan = await planCreate(i);
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  const before = tree(w.store);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), (context, held, created) => applyCreate(i, plan.revision, held, { context, created }), w.hooks), code('STALE_APPROVAL'));
  assert.deepEqual(tree(w.store), before);
});

test('6. --team names a store team; first-team and unknown teams give TEAM_NOT_FOUND', async t => {
  const w = world(t);
  await assert.rejects(planCreate(input(w, 'skill', 'x', { teams: ['research'] })), code('TEAM_NOT_FOUND'));
  await create(w, input(w, 'team', 'research'));
  const receipt = await create(w, input(w, 'skill', 'x', { teams: ['research'] }));
  assert.deepEqual(receipt.items.find(i => i.id === 'x').teams, ['research']);
  assert.deepEqual(parseManifest(fs.readFileSync(join(w.store, 'skills.json')), MANIFEST_LIMITS).skills[0].teams, ['research']);
  await assert.rejects(planCreate(input(w, 'skill', 'y', { teams: ['first-team'] })), code('TEAM_NOT_FOUND'));
  await assert.rejects(planCreate(input(w, 'prompt', 'p', { teams: ['first-team'] })), code('TEAM_NOT_FOUND'));
  // A folder with no receipt entry is not a store team.
  fs.mkdirSync(join(w.store, 'teams', 'loose'), { mode: 0o700 });
  await assert.rejects(planCreate(input(w, 'skill', 'z', { teams: ['loose'] })), code('TEAM_NOT_FOUND'));
});

test('7. a pending record is finished or cleared as in a project, and other bytes give AUTHORING_PENDING', async t => {
  const w = world(t);
  // A crash after the item landed and before the receipt: the next create of the same name finishes it.
  const i = input(w, 'skill', 'desk');
  const plan = await planCreate(i);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    const link = fs.linkSync, rename = fs.renameSync;
    const crash = target => String(target).endsWith('authoring/receipt.json');
    fs.linkSync = function (from, to) { if (crash(to)) throw Object.assign(new Error('crash'), { code: 'EIO' }); return link.call(this, from, to); };
    fs.renameSync = function (from, to) { if (crash(to)) throw Object.assign(new Error('crash'), { code: 'EIO' }); return rename.call(this, from, to); };
    try { return await applyCreate(i, plan.revision, held, { context, created }); } finally { fs.linkSync = link; fs.renameSync = rename; }
  }, w.hooks), /crash/);
  assert.ok(fs.existsSync(join(w.store, 'authoring', 'pending.json')));
  // A different name first finishes the pending skill, then makes its own.
  const other = await planCreate(input(w, 'prompt', 'other'));
  assert.equal(other.finish.id, 'desk');
  const finished = await create(w, input(w, 'prompt', 'other'));
  assert.deepEqual(finished.items.map(x => x.id).sort(), ['desk', 'other']);
  assert.deepEqual(fs.readdirSync(join(w.store, 'authoring')), ['receipt.json']);
  assert.deepEqual(parseManifest(fs.readFileSync(join(w.store, 'skills.json')), MANIFEST_LIMITS).skills.map(s => s.id), ['desk']);
  // A crash before the item landed: the record is cleared.
  const j = input(w, 'team', 'crew'), plan2 = await planCreate(j);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    const rename = fs.renameSync;
    fs.renameSync = function (from, to) { if (String(to).endsWith('teams/crew')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return rename.call(this, from, to); };
    try { return await applyCreate(j, plan2.revision, held, { context, created }); } finally { fs.renameSync = rename; }
  }, w.hooks), /crash/);
  const next = await planCreate(j);
  assert.equal(next.discard.id, 'crew'); assert.equal(next.item.id, 'crew');
  await create(w, j);
  assert.ok(fs.existsSync(join(w.store, 'teams', 'crew', 'team.yaml')));
  // A record whose item landed with other bytes.
  const k = input(w, 'prompt', 'later'), plan3 = await planCreate(k);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    const link = fs.linkSync;
    fs.linkSync = function (from, to) { if (String(to).endsWith('prompts/later.md')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return link.call(this, from, to); };
    try { return await applyCreate(k, plan3.revision, held, { context, created }); } finally { fs.linkSync = link; }
  }, w.hooks), /crash/);
  fs.writeFileSync(join(w.store, 'prompts', 'later.md'), 'someone else\n', { mode: 0o600 });
  await assert.rejects(planCreate(k), code('AUTHORING_PENDING'));
  await assert.rejects(planCreate(input(w, 'team', 'unrelated')), code('AUTHORING_PENDING'));
});

test('8. an existing id refuses TEAM_EXISTS, SKILL_EXISTS, or PROMPT_EXISTS', async t => {
  const w = world(t);
  await create(w, input(w, 'team', 'desk')); await create(w, input(w, 'skill', 'voice')); await create(w, input(w, 'prompt', 'hello'));
  await assert.rejects(planCreate(input(w, 'team', 'desk')), code('TEAM_EXISTS'));
  await assert.rejects(planCreate(input(w, 'skill', 'voice')), code('SKILL_EXISTS'));
  await assert.rejects(planCreate(input(w, 'prompt', 'hello')), code('PROMPT_EXISTS'));
});

test('9. the 257th skill refuses MANIFEST_LIMIT and 200 skills are accepted', async t => {
  const w = world(t);
  await create(w, input(w, 'skill', 'seed'));
  let manifest = parseManifest(fs.readFileSync(join(w.store, 'skills.json')), STORE_MANIFEST_LIMITS);
  for (let n = 0; n < 199; n++) manifest = addLocalEntry(manifest, `s-${String(n).padStart(3, '0')}`, [], STORE_MANIFEST_LIMITS);
  fs.writeFileSync(join(w.store, 'skills.json'), serializeManifest(manifest, STORE_MANIFEST_LIMITS), { mode: 0o644 });
  assert.equal(manifest.skills.length, 200);
  const plan = await planCreate(input(w, 'skill', 'one-more'));
  assert.equal(plan.manifest.steps.length, 1);
  while (manifest.skills.length < 256) manifest = addLocalEntry(manifest, `t-${String(manifest.skills.length).padStart(3, '0')}`, [], STORE_MANIFEST_LIMITS);
  fs.writeFileSync(join(w.store, 'skills.json'), serializeManifest(manifest, STORE_MANIFEST_LIMITS), { mode: 0o644 });
  await assert.rejects(planCreate(input(w, 'skill', 'the-257th')), code('MANIFEST_LIMIT'));
});

test('10. a store plan does not look for .bowerloom-revision.json and skips TEAM_NAME_TAKEN', async t => {
  const w = world(t);
  fs.writeFileSync(join(w.base, '.bowerloom-revision.json'), '{}'); fs.writeFileSync(join(w.home, '.bowerloom-revision.json'), '{}');
  // "First team" is the display name of a project's first-team; a store team named so would clash only in a project.
  const plan = await planCreate(input(w, 'team', 'store-team'));
  assert.equal(plan.storeCreate, true);
});

test('11. normalizeInput accepts scope and refuses an unknown scope', async t => {
  const w = world(t);
  await planCreate(input(w, 'skill', 'ok'));
  await assert.rejects(planCreate({ ...input(w, 'skill', 'ok'), scope: 'machine' }), code('USAGE'));
  await assert.rejects(planCreate({ ...input(w, 'skill', 'ok'), scope: 1 }), code('USAGE'));
  await assert.rejects(planCreate({ ...input(w, 'team', 'ok'), scope: 'machine' }), code('USAGE'));
  await assert.rejects(planCreate({ ...input(w, 'team', 'ok'), extra: true }), code('USAGE'));
});

test('12. a store apply needs a store context, and a project apply takes none', async t => {
  const w = world(t), i = input(w, 'skill', 'x'), plan = await planCreate(i);
  await withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    await assert.rejects(applyCreate(i, plan.revision, held), code('USAGE'));
  }, w.hooks);
});

test('13. live() for the store verifies the pins: a replaced store.json gives STORE_UNSAFE and nothing is written', async t => {
  const w = world(t);
  await create(w, input(w, 'skill', 'first'));
  const i = input(w, 'prompt', 'hello'), plan = await planCreate(i), before = tree(w.store);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    const file = join(w.store, 'store.json'), copy = fs.readFileSync(file);
    fs.rmSync(file); fs.writeFileSync(file, copy, { mode: 0o644 });
    return applyCreate(i, plan.revision, held, { context, created });
  }, w.hooks), code('STORE_UNSAFE'));
  const after = tree(w.store); delete after['store.json']; delete before['store.json'];
  assert.deepEqual(after, before);
});

test('S4: a store context for another folder is USAGE', async t => {
  const w = world(t), i = input(w, 'skill', 'x'), plan = await planCreate(i);
  await withStoreForWriteWith(w.home, signal(), async (context, held, created) => {
    await assert.rejects(applyCreate(i, plan.revision, held, { context: { ...context, dir: join(w.base, 'elsewhere') }, created }), code('USAGE'));
  }, w.hooks);
});

test('S5: a lock lost after the first write is AUTHORING_WRITE_INTERRUPTED, in the store', async t => {
  const w = world(t), i = input(w, 'prompt', 'hello'), plan = await planCreate(i), abort = new AbortController();
  const link = fs.linkSync;
  await assert.rejects(withStoreForWriteWith(w.home, abort.signal, async (context, held, created) => {
    // The pending record is the first write; the lock is gone right after it.
    fs.linkSync = function (from, to) { const r = link.call(this, from, to); if (String(to).endsWith('authoring/pending.json')) abort.abort(); return r; };
    try { return await applyCreate(i, plan.revision, held, { context, created }); } finally { fs.linkSync = link; }
  }, w.hooks), code('AUTHORING_WRITE_INTERRUPTED'));
});
