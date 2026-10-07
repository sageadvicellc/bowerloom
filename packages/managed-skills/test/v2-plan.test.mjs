import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planManagedItem, inspectManagedProject, MANAGED_ITEM_CODES } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { managedVerifier } from '../../../dist/packages/managed-skills/src/v2-verifier.js';
import { project, cacheSkill, localSkill, prompt, request, local, cached, promptSource, inventory, code, IGNORE_TEXT } from './v2-fixture.mjs';

async function install(req) { const plan = await planManagedItem(req); return { plan, receipt: await applyManagedItem(null, req, plan.revision) }; }
const surfaces = plan => plan.core.before.map(s => [s.id, s.kind, path.relative(plan.core.request.projectDir, s.path)]);
function strings(value, out = []) { if (typeof value === 'string') out.push(value); else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push('key:' + k); strings(v, out); } return out; }

test('two skills on both harnesses plan the expected surface paths, and planning writes nothing', async t => {
  const f = project(t), { selector } = await cacheSkill(f); localSkill(f, 'house-style');
  const before = inventory(f.projectDir), first = request(f, { id: 'collections', source: cached(selector) });
  const a = await planManagedItem(first);
  assert.equal(a.format, 'bowerloom/managed-item-plan/v1beta2'); assert.equal(a.writesAuthorized, false); assert.equal(a.executionAuthorized, false);
  assert.deepEqual(surfaces(a), [
    ['ignore', 'file', '.bowerloom/managed/.gitignore'],
    ['canonical', 'directory', '.bowerloom/managed/skills/collections'],
    ['projection-claude', 'directory', '.claude/skills/synthetic-collections'],
    ['projection-codex', 'directory', '.agents/skills/synthetic-collections'],
    ['catalog', 'file', '.bowerloom/managed/catalog/collections.json'],
  ]);
  assert.ok(a.core.before.every(s => s.pins === null));
  assert.deepEqual(inventory(f.projectDir), before); assert.deepEqual(fs.readdirSync(first.stateDir), []);
  assert.equal((await planManagedItem(first)).revision, a.revision);
  await applyManagedItem(null, first, a.revision);
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.bowerloom/managed/.gitignore'), 'utf8'), IGNORE_TEXT);
  const b = await planManagedItem(request(f, { id: 'house-style', source: local('house-style') }));
  // The shared ignore file now exists, so only the item's own surfaces are planned.
  assert.deepEqual(surfaces(b), [
    ['canonical', 'directory', '.bowerloom/managed/skills/house-style'],
    ['projection-claude', 'directory', '.claude/skills/house-style'],
    ['projection-codex', 'directory', '.agents/skills/house-style'],
    ['catalog', 'file', '.bowerloom/managed/catalog/house-style.json'],
  ]);
  const one = await planManagedItem(request(f, { id: 'house-style', source: local('house-style'), harnesses: ['codex'] }));
  assert.deepEqual(surfaces(one).map(s => s[0]), ['canonical', 'projection-codex', 'catalog']);
});

test('a prompt plans a Claude command and a Codex skill wrapper', async t => {
  const f = project(t); prompt(f, 'review', 'Summarize the open review comments.\n');
  const req = request(f, { kind: 'prompt', id: 'review', source: promptSource('review') }), plan = await planManagedItem(req);
  assert.deepEqual(surfaces(plan), [
    ['ignore', 'file', '.bowerloom/managed/.gitignore'],
    ['projection-codex', 'directory', '.agents/skills/prompt-review'],
    ['command-claude', 'file', '.claude/commands/review.md'],
    ['catalog', 'file', '.bowerloom/managed/catalog/prompt-review.json'],
  ]);
  const receipt = await applyManagedItem(null, req, plan.revision); assert.equal(receipt.state, 'committed');
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.claude/commands/review.md'), 'utf8'), 'Summarize the open review comments.\n');
  const wrapper = fs.readFileSync(path.join(f.projectDir, '.agents/skills/prompt-review/SKILL.md'), 'utf8');
  assert.match(wrapper, /^---\nname: prompt-review\n/); assert.ok(wrapper.endsWith('Summarize the open review comments.\n'));
});

test('the catalog holds no absolute path, no operation key and no machine data', async t => {
  const f = project(t), g = project(t), catalogs = [];
  for (const x of [f, g]) {
    const { selector } = await cacheSkill(x), { plan } = await install(request(x, { id: 'collections', source: cached(selector) }));
    const bytes = fs.readFileSync(path.join(x.projectDir, '.bowerloom/managed/catalog/collections.json')); catalogs.push(bytes);
    const catalog = JSON.parse(bytes), all = strings(catalog);
    assert.deepEqual(Object.keys(catalog), ['format', 'policy', 'item', 'source', 'skill', 'license', 'references', 'inventory', 'harnesses', 'surfaces', 'executionAuthorized']);
    assert.equal(catalog.format, 'bowerloom/managed-catalog/v1beta2'); assert.equal(catalog.policy, 'bowerloom/managed-items/v1beta2');
    assert.ok(!all.some(s => s.startsWith('/')), 'no absolute path'); assert.ok(!all.some(s => s.includes(x.base)), 'no fixture path');
    assert.ok(!all.includes('key:operationKey') && !all.includes(plan.operationKey), 'no operation key');
    assert.ok(!all.some(s => s.includes(x.cacheDir) || s.includes(selector.operationId)), 'no cache binding');
    assert.deepEqual(catalog.surfaces.map(s => s.id), ['canonical', 'projection-claude', 'projection-codex', 'catalog']);
  }
  // Two machines with the same pins write the same catalog bytes.
  assert.deepEqual(catalogs[0], catalogs[1]);
});

test('an occupied projection or command path refuses with PATH_OCCUPIED and writes nothing', async t => {
  const f = project(t); localSkill(f, 'house-style'); prompt(f, 'review');
  fs.mkdirSync(path.join(f.projectDir, '.agents/skills/house-style'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(f.projectDir, '.agents/skills/house-style/SKILL.md'), 'Someone else.\n', { mode: 0o644 });
  fs.mkdirSync(path.join(f.projectDir, '.claude/commands'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(f.projectDir, '.claude/commands/review.md'), 'Hand written.\n', { mode: 0o644 });
  const before = inventory(f.projectDir);
  await assert.rejects(planManagedItem(request(f, { id: 'house-style', source: local('house-style') })), code('MANAGED_SKILL_PATH_OCCUPIED'));
  await assert.rejects(planManagedItem(request(f, { kind: 'prompt', id: 'review', source: promptSource('review') })), code('MANAGED_SKILL_PATH_OCCUPIED'));
  // A case alias of the projection name is occupied too.
  fs.mkdirSync(path.join(f.projectDir, '.claude/skills/House-Style'), { recursive: true, mode: 0o700 });
  await assert.rejects(planManagedItem(request(f, { id: 'house-style', source: local('house-style'), harnesses: ['claude'] })));
  assert.deepEqual(inventory(f.projectDir).filter(r => !r.path.startsWith('.claude/skills')), before.filter(r => !r.path.startsWith('.claude/skills')));
  for (const n of fs.readdirSync(f.itemsRoot)) assert.deepEqual(fs.readdirSync(path.join(f.itemsRoot, n)), []);
});

test('requests are closed: reserved ids, unsorted harnesses, foreign state folders and bad sources refuse', async t => {
  const f = project(t); localSkill(f, 'house-style'); localSkill(f, 'prompt-x');
  const good = request(f, { id: 'house-style', source: local('house-style') });
  for (const bad of [
    { ...good, harnesses: ['codex', 'claude'] }, { ...good, harnesses: [] }, { ...good, harnesses: ['codex', 'codex'] }, { ...good, harnesses: ['cursor'] },
    { ...good, source: local('other') }, { ...good, source: { kind: 'local', path: '/etc/passwd' } }, { ...good, source: promptSource('house-style') },
    { ...good, stateDir: f.itemsRoot }, { ...good, item: { kind: 'skill', id: 'House' } }, { ...good, extra: true },
    { ...good, operation: 'migrate' }, { ...good, minFreeBytes: 1 }, { ...good, expectedPreviousRevision: 'x' },
    request(f, { id: 'prompt-x', source: local('prompt-x') }),
  ]) await assert.rejects(planManagedItem(bad));
  assert.ok(Object.isFrozen(MANAGED_ITEM_CODES));
  for (const c of ['MANAGED_SKILL_PATH_OCCUPIED', 'MANAGED_SKILL_LEGACY_PRESENT', 'MANAGED_SKILL_HISTORY_FULL', 'MANAGED_SKILL_LOCK_NOT_HELD', 'MANAGED_SKILL_REFUSED', 'MANAGED_SKILL_LOCAL_DRIFT']) assert.ok(MANAGED_ITEM_CODES.includes(c));
});

test('a pending marker, a pending revision or legacy content refuses planning', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') });
  for (const [file, expected] of [['.bowerloom/managed-pending.json', 'MANAGED_SKILL_RECOVERY_REQUIRED'], ['.bowerloom-revision.json', 'MANAGED_SKILL_RECOVERY_REQUIRED'], ['.bowerloom-skills-pending.json', 'MANAGED_SKILL_LEGACY_PRESENT']]) {
    const p = path.join(f.projectDir, file); fs.writeFileSync(p, '{}', { mode: 0o600 });
    await assert.rejects(planManagedItem(req), code(expected)); fs.unlinkSync(p);
  }
  fs.mkdirSync(path.join(f.projectDir, '.bowerloom-skills'), { mode: 0o700 }); await assert.rejects(planManagedItem(req), code('MANAGED_SKILL_LEGACY_PRESENT'));
});

test('the managed owner verifier verifies installed items and refuses anything it has not verified', async t => {
  const f = project(t), { selector } = await cacheSkill(f); localSkill(f, 'house-style');
  await install(request(f, { id: 'collections', source: cached(selector) })); await install(request(f, { id: 'house-style', source: local('house-style') }));
  const verifier = managedVerifier(f.projectDir, f.itemsRoot), signal = new AbortController().signal;
  assert.equal(verifier.owner, 'managed');
  assert.equal(verifier.claims('managed', 'directory'), true); assert.equal(verifier.claims('managed-pending.json', 'file'), true);
  assert.equal(verifier.claims('skills.json', 'file'), false); assert.equal(verifier.claims('teams/x', 'directory'), false); assert.equal(verifier.claims('managedx', 'directory'), false);
  assert.deepEqual(await verifier.verify('managed', 'directory', signal), { result: 'verified' });
  assert.equal((await verifier.verify('managed', 'file', signal)).result, 'refused');
  const inspection = inspectManagedProject(f.projectDir, f.itemsRoot);
  assert.deepEqual(inspection.items.map(i => [i.item.id, i.status]), [['collections', 'committed'], ['house-style', 'committed']]); assert.equal(inspection.pending, null); assert.equal(inspection.legacy, false);
  for (const planted of ['managed/stray.txt', 'managed/skills/stray.txt', 'managed/catalog/ghost.json']) {
    const p = path.join(f.projectDir, '.bowerloom', planted); fs.writeFileSync(p, '{}\n', { mode: 0o644 });
    const verdict = await verifier.verify('managed', 'directory', signal); assert.equal(verdict.result, 'refused', planted); assert.match(verdict.code, /^MANAGED_SKILL_/);
    fs.unlinkSync(p);
  }
  assert.deepEqual(await verifier.verify('managed', 'directory', signal), { result: 'verified' });
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed/.gitignore'), '!keep\n'); assert.equal((await verifier.verify('managed', 'directory', signal)).result, 'refused');
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed/.gitignore'), IGNORE_TEXT); assert.equal((await verifier.verify('managed', 'directory', signal)).result, 'verified');
  // A file planted inside a canonical copy changes that copy's pinned folder time, so it stays drift after removal, as in v1.
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed/skills/collections/extra.md'), 'x\n', { mode: 0o644 });
  assert.equal((await verifier.verify('managed', 'directory', signal)).result, 'refused');
  assert.deepEqual(inspectManagedProject(f.projectDir, f.itemsRoot).items.map(i => i.status), ['drift', 'committed']);
  fs.appendFileSync(path.join(f.projectDir, '.claude/skills/house-style/SKILL.md'), 'Local edit.\n');
  assert.deepEqual(inspectManagedProject(f.projectDir, f.itemsRoot).items.map(i => i.status), ['drift', 'drift']);
  assert.equal((await verifier.verify('managed', 'directory', signal)).result, 'refused');
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed-pending.json'), '{}', { mode: 0o600 });
  assert.deepEqual(await verifier.verify('managed-pending.json', 'file', signal), { result: 'refused', code: 'MANAGED_SKILL_RECOVERY_REQUIRED' });
  const aborted = new AbortController(); aborted.abort(); fs.unlinkSync(path.join(f.projectDir, '.bowerloom/managed-pending.json'));
  assert.equal((await verifier.verify('managed', 'directory', aborted.signal)).result, 'refused');
});
