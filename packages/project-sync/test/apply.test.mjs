// `bowerloom apply` core (build plan 01, M6): skills and prompts projected from what is cached and installed.
// Every test runs with the network denied and no acquirer at all: apply never fetches.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planProjectApply, applyProjectApply, APPLY_PLAN_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { withProjectLock, isHeldProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, prefill, exactTree, contentTree, read, exists, code } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

const BOTH = ['claude', 'codex'];
const input = (f, harnesses = BOTH, extra = {}) => ({ project: f.project(), stateRoot: f.stateRoot, harnesses, team: null, ...extra });
const signal = () => new AbortController().signal;
/** Creates a registered prompt through the product's own `prompt create`, under the project lock. */
async function createPrompt(f, name, text) {
  const req = { kind: 'prompt', project: f.projectDir, name, teams: [] }, plan = await planCreate(req);
  await withProjectLock(f.projectDir, signal(), held => applyCreate(req, plan.revision, held));
  const file = path.join(f.projectDir, '.bowerloom/prompts', name + '.md');
  if (text !== undefined) { fs.writeFileSync(file, text); }
  return file;
}
async function applied(f, harnesses = BOTH, extra = {}) {
  const plan = await planProjectApply(input(f, harnesses, extra));
  return { plan, result: await applyProjectApply(input(f, harnesses, extra), plan.revision, signal()) };
}
const byId = list => Object.fromEntries(list.map(i => [i.id, i]));

test('a prompt lands at .claude/commands/<name>.md and in the Codex wrapper; cached and local skills apply too', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); await createPrompt(f, 'weekly-update', 'Summarize the week.\n'); localSkill(f, 'house-style');
  writeManifest(f, [a.entry, localEntry('house-style')]); await prefill(f, a);
  const plan = await planProjectApply(input(f));
  assert.equal(plan.format, APPLY_PLAN_FORMAT); assert.deepEqual(plan.harnesses, BOTH);
  assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.prompts.map(p => [p.id, p.state, p.action]), [['weekly-update', 'new', 'install']]);
  assert.deepEqual(plan.skills.items.map(i => [i.id, i.state, i.action]), [['alpha', 'cached', 'install'], ['house-style', 'local', 'install']]);
  const result = await applyProjectApply(input(f), plan.revision, signal());
  assert.deepEqual(result.applied.map(x => [x.kind, x.id, x.action]), [['skill', 'alpha', 'install'], ['skill', 'house-style', 'install'], ['prompt', 'weekly-update', 'install']]);
  assert.equal(read(f, '.claude/commands/weekly-update.md'), 'Summarize the week.\n');
  const wrapper = read(f, '.agents/skills/prompt-weekly-update/SKILL.md');
  assert.match(wrapper, /^---\nname: prompt-weekly-update\n/); assert.ok(wrapper.endsWith('Summarize the week.\n'));
  assert.equal(read(f, '.claude/skills/synthetic-alpha/references/guide.md'), '# Guide\nVersion 1.0.0\n');
  assert.equal(read(f, '.agents/skills/house-style/SKILL.md'), read(f, '.bowerloom/skills/house-style/SKILL.md'));
  assert.ok(exists(f, '.bowerloom/managed/catalog/prompt-weekly-update.json'));
  // Nothing is left to do, and the next plan says so.
  const again = await planProjectApply(input(f));
  assert.deepEqual(again.prompts.map(p => [p.id, p.state, p.action]), [['weekly-update', 'up-to-date', 'none']]);
  assert.ok(again.skills.items.every(i => i.action === 'none'), JSON.stringify(again.skills.items));
});

test('AGENTS.md and CLAUDE.md stay byte for byte; the plan carries a pointer instead', async t => {
  const f = syncProject(t); await createPrompt(f, 'review'); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  fs.writeFileSync(path.join(f.projectDir, 'CLAUDE.md'), '# Project memory\nKeep it short.\n', { mode: 0o644 });
  const agents = exactTree(path.join(f.projectDir, 'AGENTS.md')), claude = exactTree(path.join(f.projectDir, 'CLAUDE.md'));
  const { plan, result } = await applied(f);
  assert.match(plan.pointer, /AGENTS\.md and CLAUDE\.md/); assert.match(plan.pointer, /\.claude\/commands/); assert.match(plan.pointer, /prompt-<name>/);
  assert.equal(result.pointer, plan.pointer);
  assert.equal(exactTree(path.join(f.projectDir, 'AGENTS.md')), agents); assert.equal(exactTree(path.join(f.projectDir, 'CLAUDE.md')), claude);
  assert.equal(read(f, 'AGENTS.md'), 'Keep founder governance.\n');
});

test('--harness claude adds Claude Code copies only; a later codex apply adds and removes nothing', async t => {
  const f = syncProject(t); await createPrompt(f, 'review', 'Review it.\n'); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  const first = await applied(f, ['claude']);
  assert.deepEqual(first.plan.harnesses, ['claude']);
  assert.deepEqual(first.plan.prompts[0].harnesses, ['claude']); assert.deepEqual(first.plan.skills.items[0].harnesses, ['claude']);
  assert.ok(exists(f, '.claude/commands/review.md')); assert.ok(exists(f, '.claude/skills/house-style/SKILL.md'));
  assert.equal(exists(f, '.agents'), false);
  const claudeFiles = contentTree(path.join(f.projectDir, '.claude'));
  const second = await applied(f, ['codex']);
  assert.deepEqual(byId(second.plan.prompts).review.state, 'harnesses-changed'); assert.deepEqual(byId(second.plan.prompts).review.harnesses, BOTH);
  assert.deepEqual(second.plan.skills.items[0].harnesses, BOTH);
  assert.ok(exists(f, '.agents/skills/prompt-review/SKILL.md')); assert.ok(exists(f, '.agents/skills/house-style/SKILL.md'));
  assert.equal(read(f, '.claude/commands/review.md'), 'Review it.\n'); assert.ok(exists(f, '.claude/skills/house-style/SKILL.md'));
  // A Claude-only apply now has nothing to do: it never drops the Codex copies.
  const third = await planProjectApply(input(f, ['claude']));
  assert.ok(third.prompts.every(p => p.action === 'none') && third.skills.items.every(i => i.action === 'none'), JSON.stringify(third));
  assert.ok(exists(f, '.agents/skills/prompt-review/SKILL.md'));
  assert.equal(contentTree(path.join(f.projectDir, '.claude')), claudeFiles);
});

test('name collisions refuse APPLY_NAME_COLLISION and nothing is written', async t => {
  // A Claude Code command the user wrote by hand.
  const f = syncProject(t); await createPrompt(f, 'review');
  fs.mkdirSync(path.join(f.projectDir, '.claude/commands'), { recursive: true }); fs.writeFileSync(path.join(f.projectDir, '.claude/commands/review.md'), 'Mine.\n');
  let before = exactTree(f.base);
  await assert.rejects(planProjectApply(input(f)), e => code('APPLY_NAME_COLLISION')(e) && /\.claude\/commands\/review\.md/.test(e.message));
  assert.equal(exactTree(f.base), before);
  // A Codex skill folder of the same name as a local skill.
  const g = syncProject(t); localSkill(g, 'house-style'); writeManifest(g, [localEntry('house-style')]);
  fs.mkdirSync(path.join(g.projectDir, '.agents/skills/house-style'), { recursive: true }); fs.writeFileSync(path.join(g.projectDir, '.agents/skills/house-style/SKILL.md'), 'Not Bowerloom.\n');
  before = exactTree(g.base);
  await assert.rejects(planProjectApply(input(g)), e => code('APPLY_NAME_COLLISION')(e) && /\.agents\/skills\/house-style/.test(e.message));
  assert.equal(exactTree(g.base), before);
  // Two pinned skills that would both project to one folder name.
  const h = syncProject(t), a = npmPackage('alpha', { name: 'shared-name' }), b = npmPackage('bravo', { name: 'shared-name' });
  writeManifest(h, [a.entry, b.entry]); await prefill(h, a); await prefill(h, b);
  before = exactTree(h.base);
  await assert.rejects(planProjectApply(input(h)), e => code('APPLY_NAME_COLLISION')(e) && /alpha/.test(e.message) && /bravo/.test(e.message));
  assert.equal(exactTree(h.base), before);
});

test('a pin that is not cached refuses SKILLS_OFFLINE, names skills sync, and writes nothing anywhere', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); await createPrompt(f, 'review'); writeManifest(f, [a.entry]);
  const before = exactTree(f.base);
  await assert.rejects(planProjectApply(input(f)), e => code('SKILLS_OFFLINE')(e) && /bowerloom skills sync/.test(e.message) && /alpha/.test(e.message));
  assert.equal(exactTree(f.base), before); assert.equal(fs.existsSync(f.stateRoot), false);
});

test('one approval covers the apply: each child gets a revision computed in the same locked run', async t => {
  const f = syncProject(t); await createPrompt(f, 'review'); await createPrompt(f, 'weekly-update'); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  const plans = [], applies = [];
  const lockedNow = async () => { try { await withProjectLock(f.projectDir, signal(), async () => {}); return false; } catch (e) { if (e.code === 'PROJECT_LOCKED') return true; throw e; } };
  const managed = {
    async plan(req, options) { const r = await planManagedItem(req, options); plans.push({ id: req.item.id, kind: req.item.kind, revision: r.revision, locked: await lockedNow() }); return r; },
    async apply(held, req, revision, options) { applies.push({ id: req.item.id, revision, held: isHeldProjectLock(held) && await lockedNow() }); return applyManagedItem(held, req, revision, options); },
  };
  const parent = await planProjectApply(input(f)), result = await applyProjectApply(input(f), parent.revision, signal(), { managed });
  assert.deepEqual(result.applied.map(x => x.id), ['house-style', 'review', 'weekly-update']);
  assert.ok(plans.every(p => p.locked), JSON.stringify(plans));
  for (const id of ['house-style', 'review', 'weekly-update']) {
    const mine = plans.filter(p => p.id === id), apply = applies.find(x => x.id === id);
    assert.equal(mine.length, 2, id); assert.ok(apply.held, id);
    assert.equal(apply.revision, mine[1].revision, id); assert.notEqual(apply.revision, parent.revision);
  }
  assert.deepEqual([...new Set(plans.map(p => p.kind))].sort(), ['prompt', 'skill']);
});

test('a prompt edited after the plan refuses STALE_APPROVAL, and nothing is written', async t => {
  const f = syncProject(t), file = await createPrompt(f, 'review', 'One.\n');
  const plan = await planProjectApply(input(f)); fs.writeFileSync(file, 'Two.\n');
  const before = exactTree(f.base);
  await assert.rejects(applyProjectApply(input(f), plan.revision, signal()), code('STALE_APPROVAL'));
  await assert.rejects(applyProjectApply(input(f), 'not a revision', signal()), code('STALE_APPROVAL'));
  assert.equal(exactTree(f.base), before);
});

test('an edited prompt updates its copies; a hand-edited command is held and the other prompts apply', async t => {
  const f = syncProject(t), file = await createPrompt(f, 'review', 'One.\n'); await createPrompt(f, 'weekly-update', 'Week.\n');
  await applied(f);
  fs.writeFileSync(file, 'Two.\n');
  const update = await applied(f);
  assert.deepEqual(update.plan.prompts.map(p => [p.id, p.state, p.action]), [['review', 'edited', 'update'], ['weekly-update', 'up-to-date', 'none']]);
  assert.equal(read(f, '.claude/commands/review.md'), 'Two.\n'); assert.ok(read(f, '.agents/skills/prompt-review/SKILL.md').endsWith('Two.\n'));
  const command = path.join(f.projectDir, '.claude/commands/weekly-update.md'); fs.appendFileSync(command, 'My own line.\n'); const mine = fs.readFileSync(command, 'utf8');
  fs.writeFileSync(file, 'Three.\n');
  const held = await applied(f);
  assert.deepEqual(held.plan.prompts.map(p => [p.id, p.state, p.action]), [['review', 'edited', 'update'], ['weekly-update', 'drift', 'hold']]);
  assert.equal(byId(held.plan.prompts)['weekly-update'].hold.code, 'MANAGED_SKILL_LOCAL_DRIFT');
  assert.match(byId(held.plan.prompts)['weekly-update'].hold.next, /\.claude\/commands\/weekly-update\.md/);
  assert.deepEqual(held.result.held.map(h => [h.kind, h.id, h.code]), [['prompt', 'weekly-update', 'MANAGED_SKILL_LOCAL_DRIFT']]);
  assert.equal(fs.readFileSync(command, 'utf8'), mine); assert.equal(read(f, '.claude/commands/review.md'), 'Three.\n');
});

test('a prompt that is not a plain file of yours refuses PROMPT_INVALID before any write', async t => {
  const f = syncProject(t), file = await createPrompt(f, 'review'); fs.chmodSync(file, 0o666);
  const before = exactTree(f.base);
  await assert.rejects(planProjectApply(input(f)), e => code('PROMPT_INVALID')(e) && /prompts\/review\.md/.test(e.message));
  assert.equal(exactTree(f.base), before);
});

test('with no skills.json and no prompts there is nothing to apply, and the plan says so', async t => {
  const f = syncProject(t), plan = await planProjectApply(input(f));
  assert.equal(plan.skills, null); assert.deepEqual(plan.prompts, []); assert.equal(plan.actionable, false);
  const before = exactTree(f.base), result = await applyProjectApply(input(f), plan.revision, signal());
  assert.deepEqual(result.applied, []); assert.equal(exactTree(f.base), before);
  await assert.rejects(planProjectApply(input(f, [])), code('USAGE'));
  await assert.rejects(planProjectApply(input(f, ['codex', 'claude'])), code('USAGE'));
});
