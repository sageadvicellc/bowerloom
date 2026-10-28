// Definition spec section 12, checks 1 and 9.
// Check 1, portable half: adopt the portable files of one engine, project the definition back to that engine with the
// step 2 portable projection into a fresh project, and compare meaning: the instruction text the engine loads, and
// each skill the engine loads with its core fields, body, and files. Engine-private blocks stay unchanged in the
// definition. The locked-in half waits for the locked-in writers of step 3, lane B.
// Check 9: an entry with an unknown field passes through adoption unchanged, into its own engine's block only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadDefinition, readFrontmatter, selectForEngine } from '../../../dist/packages/harness-definition/src/index.js';
import { applyPortable, planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { SKILL_PLACES, applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { agent, json, project, skill } from './fixture.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const CORE = ['name', 'description', 'license', 'compatibility', 'metadata'];

/** The instruction text an engine loads from a project folder (portable parts spec, section 4.1). */
function instructionsOf(dir, engine) {
  const read = rel => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } };
  const agents = read('AGENTS.md'), claude = read('CLAUDE.md');
  if (engine === 'claude-code') return claude !== null && /^@AGENTS\.md\s*$/.test(claude) ? agents : claude ?? agents;
  return agents ?? claude;
}

/** The skills an engine loads from a project folder, by name: core fields, body, and every other file. */
function skillsOf(dir, engine) {
  const out = {};
  for (const { root, engines } of SKILL_PLACES) {
    if (!engines.includes(engine)) continue;
    let names = [];
    try { names = fs.readdirSync(path.join(dir, root)).sort(); } catch { continue; }
    for (const name of names) {
      const folder = path.join(dir, root, name);
      const fm = readFrontmatter(fs.readFileSync(path.join(folder, 'SKILL.md'), 'utf8'));
      assert.equal(fm.ok, true);
      const files = [];
      const walk = rel => { for (const n of fs.readdirSync(path.join(folder, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; const st = fs.statSync(path.join(folder, r)); if (st.isDirectory()) walk(r); else if (r !== 'SKILL.md') files.push([r, sha(fs.readFileSync(path.join(folder, r))), (st.mode & 0o111) !== 0]); } };
      walk('');
      const meaning = { core: Object.fromEntries(CORE.filter(k => fm.data[k] !== undefined).map(k => [k, fm.data[k]])), body: fm.body, files };
      const id = fm.data.name ?? name;
      if (out[id] !== undefined) assert.deepEqual(meaning, out[id], `${engine} loads two copies of ${id}, and they differ`);
      out[id] = meaning;
    }
  }
  return out;
}

const ENGINE_FILES = {
  'claude-code': { 'CLAUDE.md': '# Claude rules\n\nStanding fact: tests run with npm.\n', '.claude/skills/review/SKILL.md': skill('review', 'license: MIT\nwhen_to_use: Before a merge.\n'), '.claude/skills/review/references/notes.md': 'Notes.\n', '.claude/skills/review/scripts/check.sh': { mode: 0o755, text: '#!/bin/sh\necho ok\n' } },
  codex: { 'AGENTS.md': '# Codex rules\n\nStanding fact: the main branch is protected.\n', '.agents/skills/lint/SKILL.md': skill('lint', 'metadata:\n  owner: demo\n'), '.agents/skills/lint/assets/rules.txt': 'rule one\n' },
  opencode: { 'AGENTS.md': '# OpenCode rules\n', '.opencode/skills/format/SKILL.md': skill('format', 'compatibility: Needs a formatter.\n') },
  pi: { 'AGENTS.md': '# Pi rules\n', '.pi/skills/notes/SKILL.md': skill('notes') },
  'deepseek-harness': { 'AGENTS.md': '# DeepSeek Harness rules\n', '.dsh/skills/tidy/SKILL.md': skill('tidy') },
};

for (const [engine, files] of Object.entries(ENGINE_FILES)) {
  test(`check 1, portable half: ${engine} files adopt and project back to ${engine} with the same meaning`, async t => {
    const a = project(t, files);
    const input = a.input({ engines: [{ id: engine }] });
    const plan = planAdoption(input);
    assert.equal(plan.ready, true, JSON.stringify({ conflicts: plan.conflicts, problems: plan.problems }));
    await applyAdoption(input, plan.revision, plan.approvalsRequired);

    const b = path.join(a.base, 'fresh');
    fs.mkdirSync(b, { mode: 0o755 });
    const portable = { projectDir: b, definitionFolder: a.def, stateDir: path.join(a.base, 'state', 'portable') };
    const projection = planPortable(portable);
    assert.deepEqual(projection.loss.filter(l => l.result !== 'exact' && l.field === undefined && l.part !== 'memory'), [], 'every portable line is exact');
    await applyPortable(portable, projection.revision);

    assert.equal(instructionsOf(b, engine), instructionsOf(a.dir, engine));
    assert.deepEqual(skillsOf(b, engine), skillsOf(a.dir, engine));
    assert.ok(Object.keys(skillsOf(a.dir, engine)).length > 0);
  });
}

test('check 1: an engine-private block of a skill stays unchanged in the definition, for its own engine only', async t => {
  const a = project(t, ENGINE_FILES['claude-code']);
  const input = a.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] });
  const plan = planAdoption(input);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const def = loadDefinition(a.def).definition;
  assert.deepEqual(def.harness.skills.review.privateBlocks, { 'claude-code': { when_to_use: 'Before a merge.' } });
  assert.deepEqual(selectForEngine(def, 'codex').skills.find(s => s.id === 'review'), undefined, 'the skill lives where Claude Code reads it only');
});

test.todo('check 1, locked-in half (step 3, lane B): adopt subagents, guardrails, hooks, MCP servers, the sandbox, and engine-private blocks from each engine, project them back with the locked-in writers, and compare meaning; every private block comes back byte for byte');

test('check 9, adoption half: an entry with an unknown field keeps it unchanged in its own engine\'s block, and other engines never see it', async t => {
  const a = project(t, {
    '.claude/agents/reader.md': agent('reader', 'color: blue\nbackground: true\nnested:\n  depth: 2\n'),
    '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], alwaysLoad: true, futureField: { a: [1, 'two'] } } } }),
    '.claude/skills/review/SKILL.md': skill('review', 'future-field: kept\n'),
    // The same skill without the key, where Codex reads it: one item, with the block for Claude Code only.
    '.agents/skills/review/SKILL.md': skill('review'),
  });
  const input = a.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] });
  const plan = planAdoption(input);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const def = loadDefinition(a.def).definition;
  const claude = selectForEngine(def, 'claude-code'), codex = selectForEngine(def, 'codex');
  assert.deepEqual(claude.subagents[0].privateBlocks, { 'claude-code': { color: 'blue', background: true, nested: { depth: 2 } } });
  assert.deepEqual(claude.mcp[0].privateBlocks, { 'claude-code': { alwaysLoad: true, futureField: { a: [1, 'two'] } } });
  assert.deepEqual(claude.skills[0].privateBlocks, { 'claude-code': { 'future-field': 'kept' } });
  for (const part of ['subagents', 'mcp', 'skills']) for (const e of codex[part]) assert.deepEqual(e.privateBlocks, {}, part);
  assert.ok(codex.excluded.some(x => x.reason === 'private-block' && x.engine === 'claude-code'));
});

test.todo('check 9, projection half (step 3, lane B): the locked-in writers project each unknown field of a private block to its own engine without loss');
