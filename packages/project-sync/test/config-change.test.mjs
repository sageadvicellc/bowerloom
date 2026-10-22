// Spec 06, 3.5 to 3.9, 3.13 and 3.14: use and unuse change bowerloom.json and bowerloom.lock.json only.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, localSkill, writeManifest } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, pushStore, storeTransport, code } from './config-fixture.mjs';
import { planConfigChange, applyConfigChange } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { readLock } from '../../../dist/packages/project-config/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every network read goes to a fake'));
const readJson = (w, rel) => JSON.parse(fs.readFileSync(path.join(w.projectDir, rel), 'utf8'));
const has = (w, rel) => fs.existsSync(path.join(w.projectDir, rel));
const ctx = w => discoverProject(w.projectDir, w.home);
const plan = (w, op, kind, id, extra = {}) => planConfigChange({ project: ctx(w), home: w.home, op, kind, id, ...extra });
async function change(w, op, kind, id, extra = {}, hooks = {}) {
  const p = await plan(w, op, kind, id, extra);
  return withProjectLock(w.projectDir, new AbortController().signal, async held => ({ plan: p, ...applyConfigChange(p, p.revision, held, ctx(w), w.home, hooks) }));
}
/** A store whose repository has an origin and a pushed branch, as git leaves it. */
function gitStore(w, repo, { head } = {}) {
  const git = path.join(w.store, '.git'); fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true, mode: 0o755 }); fs.mkdirSync(path.join(git, 'refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:SageAdviceLLC/store.git\n');
  fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${repo.commit}\n`); fs.writeFileSync(path.join(git, 'refs/heads/main'), `${head ?? repo.commit}\n`);
}
const originProject = w => { fs.mkdirSync(path.join(w.projectDir, '.git'), { mode: 0o755 }); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n'); };

test('1 and 2. the first use creates bowerloom.json with the project items and the picked store item; use never creates .bowerloom', async t => {
  const w = configWorld(t, { folder: true });
  localSkill({ projectDir: w.projectDir }, 'local-tool'); writeManifest({ projectDir: w.projectDir }, [{ id: 'local-tool', source: { kind: 'local', path: 'skills/local-tool' } }], ['codex']);
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/first-team'), { recursive: true });
  await storeItem(w, 'skill', 'house-style');
  const { plan: p, result } = await change(w, 'use', 'skill', 'house-style');
  assert.equal(p.created, true); assert.equal(p.listed, 2); assert.deepEqual(p.adds, [{ kind: 'skill', id: 'house-style', source: 'store', via: [] }]);
  assert.equal(p.lock, null); assert.deepEqual(p.network.hosts, []);
  assert.deepEqual(readJson(w, 'bowerloom.json'), { format: 'bowerloom/project/v1beta1', harnesses: ['codex'], skills: [{ id: 'house-style', source: 'store' }, { id: 'local-tool', source: 'project' }], prompts: [], teams: [{ id: 'first-team', source: 'project' }] });
  assert.equal(result.created, true); assert.equal(has(w, 'bowerloom.lock.json'), false);
  // A project with no skills.json gets both harnesses; use and unuse write only bowerloom.json.
  const bare = configWorld(t, { folder: true }); await storeItem(bare, 'prompt', 'weekly-update');
  await change(bare, 'use', 'prompt', 'weekly-update');
  assert.deepEqual(readJson(bare, 'bowerloom.json').harnesses, ['claude', 'codex']);
  const configOnly = configWorld(t); writeConfig(configOnly, {}); await storeItem(configOnly, 'skill', 'house-style');
  await change(configOnly, 'use', 'skill', 'house-style'); await change(configOnly, 'unuse', 'skill', 'house-style');
  assert.deepEqual(fs.readdirSync(configOnly.projectDir).sort(), ['bowerloom.json']);
});

test('3 and 4. team expansion adds tagged items with via, merges via, promotes a direct pick, refuses a project duplicate; unuse team removes what came only through it', async t => {
  const w = configWorld(t, { folder: true });
  for (const team of ['ops', 'research']) await storeItem(w, 'team', team);
  await storeItem(w, 'skill', 'a-skill', { teams: ['research'] }); await storeItem(w, 'skill', 'b-skill', { teams: ['ops', 'research'] }); await storeItem(w, 'skill', 'c-skill');
  await storeItem(w, 'prompt', 'brief', { teams: ['research'] });
  writeConfig(w, {});
  await change(w, 'use', 'team', 'ops');
  await change(w, 'use', 'skill', 'a-skill');
  const { plan: p } = await change(w, 'use', 'team', 'research');
  assert.deepEqual(p.adds.map(a => [a.kind, a.id, a.via]), [['team', 'research', []], ['prompt', 'brief', ['research']]]);
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'a-skill', source: 'store' }, { id: 'b-skill', source: 'store', via: ['ops', 'research'] }]);
  // use of an item picked through a team makes it direct.
  const promoted = await change(w, 'use', 'prompt', 'brief');
  assert.deepEqual(promoted.plan.direct, [{ kind: 'prompt', id: 'brief', via: ['research'] }]);
  assert.deepEqual(readJson(w, 'bowerloom.json').prompts, [{ id: 'brief', source: 'store' }]);
  await change(w, 'unuse', 'team', 'ops');
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'a-skill', source: 'store' }, { id: 'b-skill', source: 'store', via: ['research'] }]);
  await change(w, 'unuse', 'team', 'research');
  assert.deepEqual(readJson(w, 'bowerloom.json'), { format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'a-skill', source: 'store' }], prompts: [{ id: 'brief', source: 'store' }], teams: [] });
  // A tagged id listed from the project refuses the whole plan.
  localSkill({ projectDir: w.projectDir }, 'b-skill'); writeManifest({ projectDir: w.projectDir }, [{ id: 'b-skill', source: { kind: 'local', path: 'skills/b-skill' } }]);
  await change(w, 'use', 'skill', 'b-skill', { source: 'project' });
  const before = fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'));
  await assert.rejects(plan(w, 'use', 'team', 'research'), code('CONFIG_DUPLICATE_ID'));
  assert.deepEqual(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json')), before);
});

test('the refusals of use and unuse: selected, duplicate, not found, missing, not selected, no store', async t => {
  const w = configWorld(t, { folder: true });
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), code('STORE_NOT_FOUND'));
  await storeItem(w, 'skill', 'house-style');
  await assert.rejects(plan(w, 'use', 'skill', 'nope'), code('STORE_ITEM_NOT_FOUND'));
  await assert.rejects(plan(w, 'use', 'skill', 'nope', { source: 'project' }), code('CONFIG_ITEM_MISSING'));
  await assert.rejects(plan(w, 'unuse', 'skill', 'house-style'), code('CONFIG_ITEM_NOT_SELECTED'));
  await change(w, 'use', 'skill', 'house-style');
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), code('CONFIG_ITEM_SELECTED'));
  await assert.rejects(plan(w, 'unuse', 'prompt', 'house-style'), code('CONFIG_ITEM_NOT_SELECTED'));
  localSkill({ projectDir: w.projectDir }, 'house-style'); writeManifest({ projectDir: w.projectDir }, [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  await assert.rejects(plan(w, 'use', 'skill', 'house-style', { source: 'project' }), e => e.code === 'CONFIG_DUPLICATE_ID' && /once from store and once from project/.test(e.message));
  await assert.rejects(plan(w, 'use', 'skill', 'house-style', { commit: 'abc' }), code('USAGE'));
});

test('5. limits give CONFIG_LIMIT', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: Array.from({ length: 128 }, (_, i) => ({ id: `s-${String(i).padStart(3, '0')}`, source: 'project' })) });
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), code('CONFIG_LIMIT'));
});

test('6, 7 and 9. a shared project gets a lock: a pinned item with no network, an authored item after a proof; a missing lock item self-heals', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'house-style'); storePin(w, npm.entry); originProject(w);
  // A pinned store skill: no network.
  const pinned = await change(w, 'use', 'skill', 'tanstack-db');
  assert.deepEqual(pinned.plan.lock.adds, ['skill tanstack-db']); assert.deepEqual(pinned.plan.network.hosts, []);
  assert.equal(readLock(ctx(w)).lock.skills[0].pin.source.kind, 'npm');
  // An authored skill: proved against the pushed copy, and the plan names api.github.com.
  const repo = pushStore(w); gitStore(w, repo);
  const transport = storeTransport(repo);
  const authored = await change(w, 'use', 'skill', 'house-style', { storeTransport: transport });
  assert.deepEqual(authored.plan.network.hosts, ['api.github.com']);
  assert.ok(authored.plan.notes.some(n => /^Network: reads api\.github\.com, to check the pushed copy of 1 item, about \d+ requests to api\.github\.com\.$/.test(n)));
  const item = readLock(ctx(w)).lock.skills.find(i => i.id === 'house-style');
  assert.equal(item.authored.remote, 'https://github.com/sageadvicellc/store'); assert.equal(item.authored.commit, repo.commit);
  // 9: drop a lock item by hand; the next use heals it.
  writeLock(w, { skills: [item] });
  await storeItem(w, 'prompt', 'weekly-update'); const repo2 = pushStore(w); gitStore(w, repo2);
  const healed = await change(w, 'use', 'prompt', 'weekly-update', { storeTransport: storeTransport(repo2) });
  assert.deepEqual(healed.plan.lock.adds, ['prompt weekly-update', 'skill tanstack-db']);
  // A project that is not shared and has no lock gets none.
  const plain = configWorld(t, { folder: true }); await storeItem(plain, 'skill', 'house-style');
  assert.equal((await plan(plain, 'use', 'skill', 'house-style')).lock, null);
});

test('the proof refuses a store with no git, no origin, an unpushed edit, a private remote, and an unreachable --commit', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); originProject(w);
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.message.endsWith('The store is not a git repository.'));
  const repo = pushStore(w); gitStore(w, repo);
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Not pushed.\n---\nx\n');
  await assert.rejects(plan(w, 'use', 'skill', 'house-style', { storeTransport: storeTransport(repo) }), code('LOCK_STORE_NOT_PUSHED'));
  const repo2 = pushStore(w); gitStore(w, repo2, { head: 'f'.repeat(40) });
  const empty = storeTransport({ responses: new Map() });
  await assert.rejects(plan(w, 'use', 'skill', 'house-style', { storeTransport: empty }), code('STORE_REMOTE_PRIVATE'));
  await assert.rejects(plan(w, 'use', 'skill', 'house-style', { storeTransport: empty, commit: 'e'.repeat(40) }), code('LOCK_COMMIT_UNREACHABLE'));
  const warned = await plan(w, 'use', 'skill', 'house-style', { storeTransport: storeTransport(repo2) });
  assert.ok(warned.notes.includes(`Your store has commits that are not pushed (HEAD differs from origin/main). The lock records the pushed commit ${repo2.commit.slice(0, 8)}.`));
  fs.writeFileSync(path.join(w.store, '.git', 'config'), '[core]\n');
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.message.endsWith('The store repository has no remote named origin.'));
  // A file a lock cannot record refuses before any network read.
  fs.writeFileSync(path.join(w.store, 'skills/house-style/empty.md'), '', { mode: 0o600 });
  await assert.rejects(plan(w, 'use', 'skill', 'house-style'), e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.message.endsWith('The item holds a file that a lock cannot record.'));
});

test('10, 11 and 13. the config is written before the lock; a crash between them heals; scratch is removed; a read back that differs is unconfirmed', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db'), other = npmPackage('other-db');
  await storeItem(w, 'skill', 'seed'); storePin(w, npm.entry); storePin(w, other.entry); writeConfig(w, {}); writeLock(w, {});
  fs.writeFileSync(path.join(w.projectDir, '.bowerloom.json.0123456789abcdef.tmp'), 'x');
  await assert.rejects(change(w, 'use', 'skill', 'tanstack-db', {}, { afterConfig: () => { throw new Error('crash'); } }), /crash/);
  assert.equal(readJson(w, 'bowerloom.json').skills[0].id, 'tanstack-db'); assert.deepEqual(readLock(ctx(w)).lock.skills, []);
  assert.equal(has(w, '.bowerloom.json.0123456789abcdef.tmp'), false);
  const healed = await change(w, 'use', 'skill', 'other-db');
  assert.deepEqual(healed.plan.lock.adds, ['skill other-db', 'skill tanstack-db']);
  // A read back that differs.
  const p = await plan(w, 'unuse', 'skill', 'other-db');
  const { writeGuardedFile } = await import('../../../dist/packages/project-config/src/write.js');
  await withProjectLock(w.projectDir, new AbortController().signal, async held => {
    assert.throws(() => writeGuardedFile(w.projectDir, 'bowerloom.json', p.config.text, p.config.before.sha256, held, '.bowerloom.json', { afterRename: () => fs.appendFileSync(path.join(w.projectDir, 'bowerloom.json'), ' ') }), code('CONFIG_WRITE_UNCONFIRMED'));
  });
});

test('12 and 17. a change between plan and apply gives STALE_APPROVAL: the config, the lock, the store records, or an added authored item', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'house-style'); storePin(w, npm.entry); writeConfig(w, {}); writeLock(w, {});
  const run = async (mutate, extra = {}) => { const p = await plan(w, 'use', 'skill', 'tanstack-db', extra); mutate(); await assert.rejects(withProjectLock(w.projectDir, new AbortController().signal, async held => applyConfigChange(p, p.revision, held, ctx(w), w.home)), code('STALE_APPROVAL')); };
  await run(() => writeConfig(w, { harnesses: ['codex'] })); writeConfig(w, {});
  await run(() => fs.appendFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), ' ')); writeLock(w, {});
  await run(() => storePin(w, npmPackage('zzz').entry));
});

test('16. for a new file the writer requires ENOENT and renames; a file that appeared refuses STALE_APPROVAL', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  const p = await plan(w, 'use', 'skill', 'house-style');
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.json'), '{}\n', { mode: 0o644 });
  await assert.rejects(withProjectLock(w.projectDir, new AbortController().signal, async held => applyConfigChange(p, p.revision, held, discoverProject(w.projectDir, w.home), w.home)), code('STALE_APPROVAL'));
});

test('19. unuse never adds a lock item and never reads the network, and drops an extra one', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'seed'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'seed', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  writeLock(w, { skills: [{ id: 'tanstack-db', from: 'store', pin: npm.entry }, { id: 'zz-left', from: 'store', pin: { ...npm.entry, id: 'zz-left' } }] });
  const { plan: p } = await change(w, 'unuse', 'skill', 'tanstack-db');
  assert.deepEqual(p.lock.adds, []); assert.deepEqual(p.lock.removes, ['skill tanstack-db', 'skill zz-left']); assert.deepEqual(p.network.hosts, []);
  assert.deepEqual(readLock(ctx(w)).lock.skills, []);
});
