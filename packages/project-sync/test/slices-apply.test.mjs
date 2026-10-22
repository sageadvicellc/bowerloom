// Spec 05, section 10.14: applying context slices.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { planItemRecovery, applyItemRecovery } from '../../../dist/packages/project-sync/src/index.js';
import { wikiProject, put, sliceAgent, plan, applied, read, exists, signal, exactTree } from './slices-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const files = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name));

test('1. apply writes .claude/skills/slice-<id>/SKILL.md with the rendered bytes', async t => {
  const f = await wikiProject(t), { plan: p, result } = await applied(f, ['claude']);
  assert.deepEqual(result.applied, [{ kind: 'slice', id: 'wiki', action: 'install', receiptRevision: result.applied[0].receiptRevision }]);
  const text = read(f, '.claude/skills/slice-wiki/SKILL.md'), { renderSliceIndex } = await import('../../../dist/packages/context-slices/src/render.js');
  assert.equal(text, renderSliceIndex('wiki', { description: 'Describe what this slice holds and which agents use it.', guard: 'root', summary: { kind: 'heading' } }, { members: [{ path: 'a.md', summary: 'Alpha' }, { path: 'sub/b.md', summary: 'Beta' }] }, { source: 'wiki', prefix: 'wiki' }));
  assert.deepEqual(fs.readdirSync(path.join(f.projectDir, '.claude/skills/slice-wiki')), ['SKILL.md']); assert.equal(p.slices[0].expected.files[0].sha256.length, 64);
});
test('2. apply writes no member text under .claude or .bowerloom/managed', async t => {
  const f = await wikiProject(t); put(f, 'wiki/a.md', '# Alpha\nUNIQUE-BODY-SENTENCE-7731\n'); await applied(f, ['claude']);
  for (const dir of [path.join(f.projectDir, '.claude'), path.join(f.projectDir, '.bowerloom/managed'), f.stateRoot]) for (const file of files(dir)) assert.equal(fs.readFileSync(file, 'utf8').includes('UNIQUE-BODY-SENTENCE-7731'), false, file);
});
test('3. the catalog names kind slice, harnesses [claude], the source, and the references', async t => {
  const f = await wikiProject(t); await applied(f, ['claude']); const c = JSON.parse(read(f, '.bowerloom/managed/catalog/slice_wiki.json'));
  assert.deepEqual(c.item, { kind: 'slice', id: 'wiki' }); assert.deepEqual(c.harnesses, ['claude']); assert.deepEqual(c.references, ['a.md', 'sub/b.md', './', 'sub/']);
  assert.deepEqual(c.source, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'project', path: 'wiki' }, guard: 'root' });
});
test('4. slices apply before agents in phase C', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); const { result } = await applied(f, ['claude']);
  assert.deepEqual(result.applied.map(a => a.kind), ['slice', 'agent']);
});
test('5. an interrupt between a slice and an agent leaves the slice complete and the agent untouched', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); const p = await plan(f, ['claude']), controller = new AbortController();
  // The signal is read between children: abort once the slice is done.
  const deps = await import('../../../dist/packages/project-sync/src/deps.js'); const real = deps.managedPort;
  const wrapped = { ...real, apply: async (...args) => { const r = await real.apply(...args); if (args[1]?.item?.kind === 'slice') controller.abort(); return r; } };
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, controller.signal, { managed: wrapped }), e => e.code === 'SKILLS_SYNC_INTERRUPTED');
  assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), true); assert.equal(exists(f, '.claude/agents/lead.md'), false);
  const again = await applied(f, ['claude']); assert.deepEqual(again.result.applied.map(a => a.kind), ['agent']);
});
test('6. a crash inside a slice transaction leaves the marker, and skills recover plan --item slice_<id> resumes it', async t => {
  const f = await wikiProject(t), p = await plan(f, ['claude']);
  const rename = fs.renameSync; let hit = false;
  fs.renameSync = function (from, to) { const r = rename.call(this, from, to); if (!hit && /new-catalog$/.test(String(from))) { hit = true; throw Object.assign(new Error('crash'), { code: 'EIO' }); } return r; };
  try { await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal())); } finally { fs.renameSync = rename; }
  assert.equal(exists(f, '.bowerloom/managed-pending.json'), true);
  await assert.rejects(plan(f, ['claude']), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED');
  const input = { project: f.project(), stateRoot: f.stateRoot, item: 'slice_wiki', action: null }, rp = await planItemRecovery(input);
  await applyItemRecovery(input, rp.revision); assert.equal(exists(f, '.bowerloom/managed-pending.json'), false);
  const after = await plan(f, ['claude']); assert.equal(after.slices[0].installed || after.slices[0].action === 'install', true);
});
test('7. a drifted index holds MANAGED_SKILL_LOCAL_DRIFT, and nothing is overwritten', async t => {
  const f = await wikiProject(t); await applied(f, ['claude']); fs.appendFileSync(path.join(f.projectDir, '.claude/skills/slice-wiki/SKILL.md'), 'mine\n');
  put(f, 'wiki/c.md', '# Gamma\n'); const before = exactTree(path.join(f.projectDir, '.claude')), { result } = await applied(f, ['claude']);
  assert.equal(result.held[0].code, 'MANAGED_SKILL_LOCAL_DRIFT'); assert.equal(exactTree(path.join(f.projectDir, '.claude')), before);
});
test('8. apply never removes an index when the slice is unregistered', async t => {
  const f = await wikiProject(t); await applied(f, ['claude']);
  const { receiptOf, recordText } = await import('../../../dist/packages/project-authoring/src/state.js'), file = path.join(f.bowerloom, 'authoring/receipt.json'), receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, recordText(receiptOf(receipt.items.filter(i => i.kind !== 'slice')))); const { result } = await applied(f, ['claude']);
  assert.deepEqual(result.orphaned, [{ kind: 'slice', id: 'wiki' }]); assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), true); assert.equal(exists(f, '.bowerloom/managed/catalog/slice_wiki.json'), true);
});
test('9. apply writes nothing under .agents for a slice', async t => {
  const f = await wikiProject(t); await applied(f, ['claude', 'codex']); assert.equal(exists(f, '.agents/skills/slice-wiki'), false); assert.equal(exists(f, '.codex'), false);
});
test('an update replaces the index and keeps one committed receipt', async t => {
  const f = await wikiProject(t); await applied(f, ['claude']); put(f, 'wiki/c.md', '# Gamma\n');
  const { result } = await applied(f, ['claude']); assert.deepEqual(result.applied.map(a => [a.kind, a.action]), [['slice', 'update']]);
  assert.match(read(f, '.claude/skills/slice-wiki/SKILL.md'), /- `wiki\/c\.md`: Gamma/); assert.equal((await plan(f, ['claude'])).slices[0].action, 'none');
});
