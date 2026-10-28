// Spec 08, 3.4: receipt clean. It removes the receipt entries of created items whose files are gone, the local
// skills.json entry of a gone skill, and the project entry of bowerloom.json. It deletes no file, and it never touches the lock.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, writeManifest } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, sha, code } from './config-fixture.mjs';
import { planReceiptClean, applyReceiptClean, RECEIPT_CLEAN_PLAN_FORMAT, RECEIPT_CLEAN_RESULT_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { discoverProject, inspectStore, withProjectLock, withStoreForWrite } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { readAuthoringState, receiptOf, recordText, pendingOf } from '../../../dist/packages/project-authoring/src/state.js';
import { parseManifest, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'receipt clean reads no network'));
const signal = () => new AbortController().signal;
const ctx = w => discoverProject(w.projectDir, w.home);
const bl = (w, rel = '') => path.join(w.projectDir, '.bowerloom', rel);

/** Creates one project item through the product's create path, under the project lock. */
async function projectItem(w, kind, id, extra = {}) {
  const input = kind === 'team' ? { kind, project: w.projectDir, name: id } : kind === 'slice' ? { kind, project: w.projectDir, name: id, root: null, includes: null } : { kind, project: w.projectDir, name: id, teams: [], ...extra };
  const plan = await planCreate(input);
  return withProjectLock(w.projectDir, signal(), async held => applyCreate(input, plan.revision, held, undefined, ctx(w)));
}
const projectScope = w => ({ scope: 'project', project: ctx(w) });
const storeScope = w => { const found = inspectStore(w.home); assert.equal(found.state, 'store'); return { scope: 'store', store: found.context }; };
async function cleanProject(w, hooks) {
  const plan = planReceiptClean(projectScope(w));
  const result = await withProjectLock(w.projectDir, signal(), async held => applyReceiptClean(projectScope(w), plan.revision, held, undefined, hooks));
  return { plan, result };
}
async function cleanStore(w, hooks) {
  const plan = planReceiptClean(storeScope(w));
  const result = await withStoreForWrite(w.home, signal(), async (context, held, created) => applyReceiptClean({ scope: 'store', store: context }, plan.revision, held, { context, created }, hooks));
  return { plan, result };
}
/** A project with bowerloom.json and a created skill, prompt, team and slice, and one more skill that stays. */
async function fullProject(t) {
  const w = configWorld(t, { folder: true }); writeConfig(w, {});
  await projectItem(w, 'team', 'research');
  await projectItem(w, 'skill', 'notes'); await projectItem(w, 'skill', 'keeper');
  await projectItem(w, 'prompt', 'brief'); await projectItem(w, 'slice', 'wiki');
  return w;
}
const goneAll = w => { fs.rmSync(bl(w, 'skills/notes'), { recursive: true }); fs.rmSync(bl(w, 'prompts/brief.md')); fs.rmSync(bl(w, 'teams/research'), { recursive: true }); fs.rmSync(bl(w, 'slices/wiki.yaml')); };
/** Every path under a folder, with the bytes of each file. */
function snapshot(dir) {
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) { const s = fs.lstatSync(path.join(dir, rel)); out[rel] = s.isFile() ? sha(fs.readFileSync(path.join(dir, rel))) : 'dir'; }
  return out;
}
const receiptIds = dir => (readAuthoringState(dir).receipt?.value.items ?? []).map(i => `${i.kind} ${i.id}`);
const configOf = w => JSON.parse(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8'));
const manifestIds = w => parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills.map(s => s.id);

test('1. project scope: a gone skill, prompt, team and slice are selected; present items are not; the plan matches 4.3', async t => {
  const w = await fullProject(t); goneAll(w);
  const plan = planReceiptClean(projectScope(w));
  assert.equal(plan.format, RECEIPT_CLEAN_PLAN_FORMAT); assert.equal(plan.scope, 'project');
  assert.deepEqual(plan.project, { dir: w.projectDir, identity: ctx(w).identity });
  assert.deepEqual(plan.items, [
    { kind: 'skill', id: 'notes', path: 'skills/notes' }, { kind: 'prompt', id: 'brief', path: 'prompts/brief.md' },
    { kind: 'team', id: 'research', path: 'teams/research' }, { kind: 'slice', id: 'wiki', path: 'slices/wiki.yaml' },
  ]);
  assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.scratch, []); assert.deepEqual(plan.projectScratch, []);
  assert.equal(planReceiptClean(projectScope(w)).revision, plan.revision, 'the same state gives the same revision');
});

test('2, 3 and 4. the local skills.json entry goes, a pinned one stays; project config entries go and via stays; the receipt is the exact record', async t => {
  const w = await fullProject(t);
  // A store team keeps a via list, which receipt clean never changes.
  await storeItem(w, 'team', 'ops'); await storeItem(w, 'skill', 'shared', { teams: ['ops'] });
  const config = configOf(w); config.teams.push({ id: 'ops', source: 'store' }); config.teams.sort((a, b) => a.id < b.id ? -1 : 1);
  config.skills.push({ id: 'shared', source: 'store', via: ['ops'] }); config.skills.sort((a, b) => a.id < b.id ? -1 : 1);
  writeConfig(w, config);
  // Skill keeper's skills.json entry becomes pinned: its config entry and its pinned entry stay when its folder goes.
  const pinned = npmPackage('keeper').entry;
  writeManifest({ projectDir: w.projectDir }, parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills.map(s => s.id === 'keeper' ? pinned : s));
  goneAll(w); fs.rmSync(bl(w, 'skills/keeper'), { recursive: true });
  const { plan, result } = await cleanProject(w);
  assert.deepEqual(plan.manifest.steps.map(s => s.id), ['notes'], 'only the local entry is removed');
  assert.deepEqual(plan.config.removes, [{ kind: 'skill', id: 'notes' }, { kind: 'prompt', id: 'brief' }, { kind: 'team', id: 'research' }]);
  assert.deepEqual(manifestIds(w), ['keeper']);
  assert.deepEqual(configOf(w), { format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'], skills: [{ id: 'keeper', source: 'project' }, { id: 'shared', source: 'store', via: ['ops'] }], prompts: [], teams: [{ id: 'ops', source: 'store' }] });
  const left = readAuthoringState(bl(w)).receipt.value;
  assert.deepEqual(left.items.map(i => `${i.kind} ${i.id}`), []);
  assert.equal(fs.readFileSync(bl(w, 'authoring/receipt.json'), 'utf8'), recordText(receiptOf([])));
  assert.equal(plan.receipt.text, recordText(receiptOf([])));
  assert.deepEqual(result, { format: RECEIPT_CLEAN_RESULT_FORMAT, planRevision: plan.revision, scope: 'project', removed: plan.items.map(i => ({ kind: i.kind, id: i.id })), executionAuthorized: false });
});

test('5 and 9 (lock). nothing is deleted from disk, and bowerloom.lock.json is never touched', async t => {
  const w = await fullProject(t); goneAll(w);
  const lock = writeLock(w, {});
  const before = snapshot(w.projectDir);
  await cleanProject(w);
  const after = snapshot(w.projectDir);
  for (const [rel] of Object.entries(before)) assert.ok(Object.hasOwn(after, rel), `${rel} is still there`);
  for (const rel of Object.keys(after)) if (!['bowerloom.json', '.bowerloom/skills.json', '.bowerloom/authoring/receipt.json'].includes(rel)) assert.equal(after[rel], before[rel], `${rel} is unchanged`);
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8'), lock);
});

test('6. a pending record refuses AUTHORING_PENDING; scratch does not refuse and apply removes it first; a revision file refuses REVISION_PENDING', async t => {
  const w = await fullProject(t); goneAll(w);
  const item = readAuthoringState(bl(w)).receipt.value.items[0];
  fs.writeFileSync(bl(w, 'authoring/pending.json'), recordText(pendingOf(item)));
  assert.throws(() => planReceiptClean(projectScope(w)), code('AUTHORING_PENDING'));
  fs.rmSync(bl(w, 'authoring/pending.json'));
  const stage = `.stage-${'d'.repeat(64)}`; fs.mkdirSync(bl(w, `authoring/${stage}/skills/x`), { recursive: true, mode: 0o700 });
  const tmp = `.bowerloom.json.${'e'.repeat(16)}.tmp`; fs.writeFileSync(path.join(w.projectDir, tmp), 'x');
  const plan = planReceiptClean(projectScope(w));
  assert.deepEqual(plan.scratch, [stage]); assert.deepEqual(plan.projectScratch, [tmp]);
  await withProjectLock(w.projectDir, signal(), async held => applyReceiptClean(projectScope(w), plan.revision, held));
  assert.equal(fs.existsSync(bl(w, `authoring/${stage}`)), false); assert.equal(fs.existsSync(path.join(w.projectDir, tmp)), false);
  fs.writeFileSync(path.join(w.projectDir, '.bowerloom-revision.json'), '{}');
  assert.throws(() => planReceiptClean(projectScope(w)), code('REVISION_PENDING'));
});

test('7. store scope: the store receipt and store skills.json change, no project file changes; a store made after the plan refuses STALE_APPROVAL', async t => {
  const w = configWorld(t, { folder: true }); writeConfig(w, {});
  await storeItem(w, 'team', 'ops'); await storeItem(w, 'skill', 'gone-skill'); await storeItem(w, 'skill', 'kept'); await storeItem(w, 'prompt', 'gone-prompt');
  storePin(w, npmPackage('pinned').entry);
  fs.rmSync(path.join(w.store, 'skills/gone-skill'), { recursive: true }); fs.rmSync(path.join(w.store, 'prompts/gone-prompt.md'));
  const project = snapshot(w.projectDir);
  const { plan, result } = await cleanStore(w);
  assert.equal(plan.scope, 'store'); assert.equal(plan.project.dir, w.store); assert.equal(plan.config, null);
  assert.deepEqual(plan.items, [{ kind: 'skill', id: 'gone-skill', path: 'skills/gone-skill' }, { kind: 'prompt', id: 'gone-prompt', path: 'prompts/gone-prompt.md' }]);
  assert.deepEqual(receiptIds(w.store), ['skill kept', 'team ops']);
  assert.deepEqual(parseManifest(fs.readFileSync(path.join(w.store, 'skills.json')), STORE_MANIFEST_LIMITS).skills.map(s => s.id), ['kept', 'pinned']);
  assert.deepEqual(snapshot(w.projectDir), project, 'no project file changes');
  assert.equal(result.scope, 'store');
  // The plan saw a store. The store is moved away, and withStoreForWrite makes a new one: created is true.
  await storeItem(w, 'skill', 'again'); fs.rmSync(path.join(w.store, 'skills/again'), { recursive: true });
  const stale = planReceiptClean(storeScope(w));
  fs.renameSync(w.store, path.join(w.base, 'moved-store'));
  await assert.rejects(withStoreForWrite(w.home, signal(), async (context, held, created) => { assert.equal(created, true); return applyReceiptClean({ scope: 'store', store: context }, stale.revision, held, { context, created }); }), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readdirSync(w.store).sort(), ['.gitignore', 'store.json'], 'nothing but the new store.json and its .gitignore was written');
});

test('8 and 11. when nothing is gone, both scopes select nothing; running twice leaves the second run with nothing to clean', async t => {
  const w = await fullProject(t); await storeItem(w, 'skill', 'kept');
  assert.deepEqual(planReceiptClean(projectScope(w)).items, []);
  assert.deepEqual(planReceiptClean(storeScope(w)).items, []);
  goneAll(w);
  await cleanProject(w);
  assert.deepEqual(planReceiptClean(projectScope(w)).items, []);
  // A project with no .bowerloom has nothing to clean.
  const bare = configWorld(t); writeConfig(bare, {});
  assert.deepEqual(planReceiptClean(projectScope(bare)).items, []);
});

test('9. crash points: a throw after the config write and after the skills.json write; each rerun finishes, and a third run has nothing to clean', async t => {
  for (const point of ['afterConfig', 'afterManifest']) {
    const w = await fullProject(t); goneAll(w);
    const boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
    await assert.rejects(cleanProject(w, { [point]: () => { throw boom; } }), (e => e?.code === 'TEST_CRASH' || e?.cause === 'TEST_CRASH'));
    assert.equal(receiptIds(bl(w)).length, 5, `${point}: the receipt is still unchanged`);
    const again = planReceiptClean(projectScope(w));
    assert.equal(again.items.length, 4, `${point}: the same gone items`);
    assert.equal(again.config, null, `${point}: the config step is done and drops out`);
    if (point === 'afterManifest') assert.equal(again.manifest, null, 'the skills.json step is done and drops out');
    await cleanProject(w);
    assert.deepEqual(receiptIds(bl(w)), ['skill keeper']);
    assert.deepEqual(planReceiptClean(projectScope(w)).items, []);
  }
});

test('10. a stale plan refuses STALE_APPROVAL: the receipt, skills.json, or bowerloom.json changed after the plan', async t => {
  for (const change of ['receipt', 'manifest', 'config', 'restored']) {
    const w = await fullProject(t); goneAll(w);
    const plan = planReceiptClean(projectScope(w));
    if (change === 'receipt') await projectItem(w, 'prompt', 'late');
    if (change === 'manifest') writeManifest({ projectDir: w.projectDir }, parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills.filter(s => s.id !== 'notes'));
    if (change === 'config') { const c = configOf(w); c.prompts = []; writeConfig(w, c); }
    if (change === 'restored') fs.writeFileSync(bl(w, 'prompts/brief.md'), '# brief\n');
    const before = snapshot(w.projectDir);
    await assert.rejects(withProjectLock(w.projectDir, signal(), async held => applyReceiptClean(projectScope(w), plan.revision, held)), code('STALE_APPROVAL'), change);
    assert.deepEqual(snapshot(w.projectDir), before, `${change}: nothing was written`);
  }
});

test('S3. a link at an item folder area refuses AUTHORING_UNSAFE_PATH: a dangling link never makes items gone, and a live one is not followed', async t => {
  const w = await fullProject(t);
  const outside = path.join(w.base, 'outside-skills'); fs.renameSync(bl(w, 'skills'), outside); fs.symlinkSync(outside, bl(w, 'skills'));
  assert.throws(() => planReceiptClean(projectScope(w)), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes('.bowerloom/skills'));
  fs.unlinkSync(bl(w, 'skills')); fs.symlinkSync(path.join(w.base, 'nowhere'), bl(w, 'skills'));
  assert.throws(() => planReceiptClean(projectScope(w)), code('AUTHORING_UNSAFE_PATH'), 'a dangling link');
  // The store scope too.
  await storeItem(w, 'prompt', 'weekly');
  const away = path.join(w.base, 'outside-prompts'); fs.renameSync(path.join(w.store, 'prompts'), away); fs.symlinkSync(path.join(w.base, 'gone'), path.join(w.store, 'prompts'));
  assert.throws(() => planReceiptClean(storeScope(w)), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes('~/.bowerloom/prompts'));
});

test('L4. scratch with nothing gone: the plan lists the scratch, and apply removes it', async t => {
  const w = await fullProject(t);
  const stage = `.stage-${'d'.repeat(64)}`; fs.mkdirSync(bl(w, `authoring/${stage}`), { mode: 0o700 });
  const plan = planReceiptClean(projectScope(w));
  assert.deepEqual(plan.items, []); assert.deepEqual(plan.scratch, [stage]);
  const result = await withProjectLock(w.projectDir, signal(), async held => applyReceiptClean(projectScope(w), plan.revision, held));
  assert.deepEqual(result.removed, []); assert.equal(fs.existsSync(bl(w, `authoring/${stage}`)), false);
});

test('H1 and P8. skills.json changed after the config write: the refusal names what was written, and a rerun finishes', async t => {
  const w = await fullProject(t); goneAll(w);
  const edit = () => writeManifest({ projectDir: w.projectDir }, [...parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills, { id: 'late', source: { kind: 'local', path: 'skills/late' } }]);
  await assert.rejects(cleanProject(w, { afterConfig: edit }), e => e.code === 'STALE_APPROVAL' && !/Nothing was applied/.test(e.message) && /bowerloom\.json/.test(e.message) && /receipt clean/.test(e.message));
  const again = planReceiptClean(projectScope(w));
  assert.equal(again.config, null, 'the config step is done'); assert.equal(again.items.length, 4);
  await cleanProject(w);
  assert.deepEqual(receiptIds(bl(w)), ['skill keeper']);
});

// Round 14 of the reviews of PR 101: a receipt clean that stops after a write is a partial refusal, and its fix is the
// command that finishes it, in both scopes.
test('a receipt clean that stops after a write: next says to run the command, and fix is that command, in both scopes', async t => {
  const boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
  const w = await fullProject(t); goneAll(w);
  await assert.rejects(cleanProject(w, { afterConfig: () => { throw boom; } }),
    e => e.hint === 'partial' && e.fix === 'bowerloom receipt clean' && /^Run bowerloom receipt clean\.$|Then run bowerloom receipt clean\.$/.test(e.next));
  const s = configWorld(t, { folder: true }); writeConfig(s, {});
  await storeItem(s, 'skill', 'gone-skill'); await storeItem(s, 'skill', 'kept');
  fs.rmSync(path.join(s.store, 'skills/gone-skill'), { recursive: true });
  await assert.rejects(cleanStore(s, { afterManifest: () => { throw boom; } }),
    e => e.hint === 'partial' && e.fix === 'bowerloom receipt clean --global' && /bowerloom receipt clean --global\.$/.test(e.next));
});
