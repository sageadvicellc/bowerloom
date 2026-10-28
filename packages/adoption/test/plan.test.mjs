// Definition spec sections 8, 10, and 12 (checks 2 and 3): adoption plans a definition by copy, merges identical items,
// shows conflicts side by side, and writes only after a person approves the revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { ADOPTION_PLAN_FORMAT, applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { INSTRUCTIONS, code, item, json, project, read, skill, snapshot, unmappedAt } from './fixture.mjs';

const TWO = [{ id: 'claude-code' }, { id: 'codex' }];
const loaded = def => { const r = loadDefinition(def); assert.equal(r.ok, true, JSON.stringify(r.problems)); return r.definition; };

test('the plan reads AGENTS.md and the skill folders, writes nothing, and lists the definition files', t => {
  const p = project(t, {
    'AGENTS.md': INSTRUCTIONS,
    '.claude/skills/review/SKILL.md': skill('review'),
    '.claude/skills/review/references/notes.md': 'Notes.\n',
  });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input({ engines: TWO }));
  assert.deepEqual(snapshot(p.dir), before);
  assert.equal(plan.format, ADOPTION_PLAN_FORMAT);
  assert.equal(plan.writesAuthorized, false);
  assert.equal(plan.ready, true);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.files.map(f => f.path), ['harness.json', 'instructions/AGENTS.md', 'skills/review/SKILL.md', 'skills/review/references/notes.md']);
  assert.deepEqual(plan.problems, []);
  const instructions = item(plan, 'system-prompt', 'AGENTS.md');
  assert.deepEqual(instructions.places.map(x => x.path), ['AGENTS.md']);
  // The skill lives only where Claude Code reads it (and OpenCode, which this harness does not list).
  assert.deepEqual(item(plan, 'skills', 'review').engines, ['claude-code']);
  assert.equal(planAdoption(p.input({ engines: TWO })).revision, plan.revision, 'the same input gives the same revision');
});

test('check 2: identical skills from two places become one item that lists both places', t => {
  const p = project(t, { '.claude/skills/review/SKILL.md': skill('review'), '.agents/skills/review/SKILL.md': skill('review') });
  const plan = planAdoption(p.input({ engines: TWO }));
  const skills = plan.items.filter(i => i.part === 'skills');
  assert.equal(skills.length, 1);
  assert.deepEqual(skills[0].places.map(x => x.path), ['.agents/skills/review', '.claude/skills/review']);
  assert.equal(skills[0].engines, null, 'both engines read it, so it needs no filter');
  assert.deepEqual(plan.conflicts, []);
});

test('apply writes the approved plan by copy; the definition loads and the originals stay unchanged', async t => {
  const p = project(t, {
    'AGENTS.md': INSTRUCTIONS,
    '.claude/skills/review/SKILL.md': skill('review'),
    '.claude/skills/review/scripts/run.sh': { mode: 0o755, text: '#!/bin/sh\necho ok\n' },
    '.agents/skills/review/SKILL.md': skill('review'),
    '.agents/skills/review/scripts/run.sh': { mode: 0o755, text: '#!/bin/sh\necho ok\n' },
  });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input({ engines: TWO }));
  const result = await applyAdoption(p.input({ engines: TWO }), plan.revision);
  assert.deepEqual(result.written, plan.files.map(f => f.path));
  const after = snapshot(p.dir);
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, `${k} changed`);
  const def = loaded(p.def);
  assert.equal(result.revision, def.revision);
  assert.equal(def.instructions, INSTRUCTIONS);
  assert.deepEqual(def.entries.skills.map(s => s.id), ['review']);
  assert.deepEqual(def.entries.skills[0].executable, ['scripts/run.sh']);
  assert.deepEqual(def.harness.engines, TWO);
  assert.equal(read(p.def, 'skills/review/SKILL.md'), skill('review'), 'a skill with only core fields is copied byte for byte');
});

test('apply refuses a revision that is not the current plan, and writes nothing', async t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS });
  const plan = planAdoption(p.input({ engines: TWO }));
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), INSTRUCTIONS + 'More.\n');
  await assert.rejects(applyAdoption(p.input({ engines: TWO }), plan.revision), code('ADOPTION_STALE_APPROVAL'));
  await assert.rejects(applyAdoption(p.input({ engines: TWO }), 'not-a-revision'), code('ADOPTION_STALE_APPROVAL'));
  assert.equal(fs.existsSync(p.def), false);
});

test('a folder that already holds harness.json is a definition, and adoption refuses it', t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS, '.bowerloom/harness.json': json({ format: 'bowerloom/harness/v1beta1' }) });
  assert.throws(() => planAdoption(p.input({ engines: TWO })), code('ADOPTION_DEFINED'));
});

test('a .bowerloom folder with a name that is neither 0.7 nor a 0.7 skill folder is refused, not read in part', t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS, '.bowerloom/hooks.json': json({ hooks: [] }) });
  assert.throws(() => planAdoption(p.input({ engines: TWO })), code('ADOPTION_FOLDER_OCCUPIED'));
});

test('input faults are refused', t => {
  const p = project(t, {});
  assert.throws(() => planAdoption({ projectDir: 'relative/path' }), code('ADOPTION_USAGE'));
  assert.throws(() => planAdoption(null), code('ADOPTION_USAGE'));
  assert.throws(() => planAdoption(p.input({ engines: [{ id: 'hermes' }] })), code('ADOPTION_USAGE'));
  assert.throws(() => planAdoption(p.input({ engines: [{ id: 'codex' }, { id: 'codex' }] })), code('ADOPTION_USAGE'));
  assert.throws(() => planAdoption(p.input({ harness: { id: 'Not An Id' } })), code('ADOPTION_USAGE'));
});

test('engines come from the engine files when the input names none, and from the 0.7 default when nothing names one', t => {
  const a = project(t, { 'AGENTS.md': INSTRUCTIONS, '.opencode/skills/review/SKILL.md': skill('review'), '.pi/skills/lint/SKILL.md': skill('lint') });
  assert.deepEqual(planAdoption(a.input()).engines.map(e => e.id), ['opencode', 'pi']);
  const b = project(t, { 'AGENTS.md': INSTRUCTIONS });
  const plan = planAdoption(b.input());
  assert.deepEqual(plan.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.match(plan.warnings.join('\n'), /No engine file names an engine/);
});

test('a link, a hidden name, and a file no reader knows are listed with the reason, never read and never dropped silently', t => {
  const p = project(t, {
    '.claude/skills/review/SKILL.md': skill('review'),
    '.claude/skills/review/.secret-notes': 'x\n',
    '.claude/skills/linked': { link: '../elsewhere' },
    '.claude/unknown.txt': 'x\n',
  });
  const plan = planAdoption(p.input({ engines: TWO }));
  const reasons = Object.fromEntries(plan.unmapped.map(u => [u.path, u.reason]));
  assert.match(reasons['.claude/skills/linked'], /link/);
  assert.match(reasons['.claude/skills/review/.secret-notes'], /hidden/);
  assert.match(reasons['.claude/unknown.txt'], /no reader/);
  assert.deepEqual(item(plan, 'skills', 'review').places.map(x => x.path), ['.claude/skills/review']);
});

test('same name, different content: both appear side by side and apply waits for a person to choose', async t => {
  const p = project(t, {
    '.claude/skills/review/SKILL.md': skill('review', '', 'Claude version.\n'),
    '.agents/skills/review/SKILL.md': skill('review', '', 'Codex version.\n'),
  });
  const plan = planAdoption(p.input({ engines: TWO }));
  assert.equal(plan.ready, false);
  assert.equal(item(plan, 'skills', 'review'), undefined);
  assert.equal(plan.conflicts.length, 1);
  const c = plan.conflicts[0];
  assert.equal(c.key, 'skills/review');
  assert.deepEqual(c.variants.map(v => v.key), ['.agents/skills/review', '.claude/skills/review'], 'variants in path order, not import order');
  assert.deepEqual(c.options, ['pick', 'rename']);
  assert.equal(c.choice, null);
  await assert.rejects(applyAdoption(p.input({ engines: TWO }), plan.revision), code('ADOPTION_CHOICE_REQUIRED'));
  assert.equal(fs.existsSync(p.def), false);

  // Pick one: it applies to every engine that had a variant. The other variant is listed as not adopted.
  const picked = planAdoption(p.input({ engines: TWO, choices: { 'skills/review': { pick: '.claude/skills/review' } } }));
  assert.equal(picked.ready, true);
  assert.equal(item(picked, 'skills', 'review').engines, null);
  assert.match(unmappedAt(picked, '.agents/skills/review')[0].reason, /picked/);
  assert.equal(picked.conflicts[0].choice.pick, '.claude/skills/review');

  // Keep both under distinct names: each keeps the engines that read it.
  const input = p.input({ engines: TWO, choices: { 'skills/review': { rename: { '.agents/skills/review': 'review-codex' } } } });
  const both = planAdoption(input);
  assert.equal(both.ready, true);
  assert.deepEqual(item(both, 'skills', 'review').engines, ['claude-code']);
  assert.deepEqual(item(both, 'skills', 'review-codex').engines, ['codex']);
  await applyAdoption(input, both.revision);
  const def = loaded(p.def);
  assert.deepEqual(def.entries.skills.map(s => [s.id, s.name, s.body.trim()]), [['review', 'review', 'Claude version.'], ['review-codex', 'review-codex', 'Codex version.']]);
});

test('a choice that names nothing in the plan, or names that clash, is refused', t => {
  const p = project(t, {
    '.claude/skills/review/SKILL.md': skill('review', '', 'A.\n'),
    '.agents/skills/review/SKILL.md': skill('review', '', 'B.\n'),
    '.agents/skills/other/SKILL.md': skill('other'),
  });
  for (const choices of [
    { 'skills/nope': { pick: 'x' } },
    { 'skills/review': { pick: '.pi/skills/review' } },
    { 'skills/review': { rename: { '.agents/skills/review': 'Bad Name' } } },
    { 'skills/review': { rename: { '.agents/skills/review': 'other' } } },
    { 'skills/review': { rename: { '.agents/skills/review': 'x', '.claude/skills/review': 'x' } } },
    { 'skills/review': { pick: '.agents/skills/review', rename: {} } },
  ]) assert.throws(() => planAdoption(p.input({ engines: TWO, choices })), code('ADOPTION_CHOICE_INVALID'), JSON.stringify(choices));
});

test('instructions that differ between AGENTS.md and CLAUDE.md are shown side by side; a person picks one', t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS, 'CLAUDE.md': '# Claude\n\nOther text.\n' });
  const plan = planAdoption(p.input({ engines: TWO }));
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.conflicts.map(c => [c.key, c.options, c.variants.map(v => v.key)]), [['system-prompt/AGENTS.md', ['pick'], ['AGENTS.md', 'CLAUDE.md']]]);
  const picked = planAdoption(p.input({ engines: TWO, choices: { 'system-prompt/AGENTS.md': { pick: 'CLAUDE.md' } } }));
  assert.equal(picked.ready, true);
  assert.deepEqual(item(picked, 'system-prompt', 'AGENTS.md').places.map(x => x.path), ['CLAUDE.md']);
});

test('a CLAUDE.md that follows AGENTS.md is one more place of the same instructions', t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS, 'CLAUDE.md': '@AGENTS.md\n' });
  const plan = planAdoption(p.input({ engines: TWO }));
  assert.equal(plan.ready, true);
  assert.deepEqual(item(plan, 'system-prompt', 'AGENTS.md').places.map(x => x.path), ['AGENTS.md', 'CLAUDE.md']);
});

test('files of an engine the harness does not list are listed with that reason, not as files no reader knows', t => {
  const p = project(t, { '.claude/settings.json': json({ permissions: { deny: ['Bash(rm *)'] } }), '.mcp.json': json({ mcpServers: {} }), 'AGENTS.md': INSTRUCTIONS });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  for (const path of ['.claude/settings.json', '.mcp.json']) assert.match(plan.unmapped.find(u => u.path === path).reason, /not an engine of this harness/, path);
  assert.equal(plan.items.some(i => i.part === 'guardrails'), false);
});
