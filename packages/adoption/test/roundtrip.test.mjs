// Definition spec section 12, checks 1 and 9.
// Check 1, portable half: adopt the portable files of one engine, project the definition back to that engine with the
// step 2 portable projection into a fresh project, and compare meaning: the instruction text the engine loads, and
// each skill the engine loads with its core fields, body, and files. Engine-private blocks stay unchanged in the
// definition.
// Check 1, locked-in half: adopt an engine's MCP servers, subagents, hooks, guardrails, and sandbox, project them with
// the full projection into a fresh project, and adopt that project again. MCP servers, subagents, hooks, and the
// sandbox must come back as the same entries with the same private blocks. Guardrails are compared by the decision the
// engine makes from the source file and from the projected file, for the same requests. Every difference is listed
// in EXPECTED with the result word of its loss line; nothing else may differ.
// Check 9: an entry with an unknown field passes through adoption unchanged, into its own engine's block only, and the
// locked-in writers project it to its own engine without loss.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { entryHash, loadDefinition, readFrontmatter, selectForEngine } from '../../../dist/packages/harness-definition/src/index.js';
import { applyPortable, planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { claudeCodeDecide, claudeCodeRequest, openCodeDecide, openCodeFromConfig, openCodeRequest } from '../../../dist/packages/fidelity/src/index.js';
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

// ---- check 1, locked-in half ----------------------------------------------------------------------------------------------

const VERSIONS = { 'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2' };
const ENTRY_LISTS = { subagents: d => d.entries.subagents, guardrails: d => [...d.entries.rules, ...d.entries.sandbox], hooks: d => d.entries.hooks, mcp: d => d.entries.mcp };

/** Adopts a project with every gated entry acknowledged and every approval confirmed. */
async function adoptAll(dir, stateDir, engines) {
  const first = planAdoption({ projectDir: dir, stateDir, engines });
  const input = { projectDir: dir, stateDir, engines, acknowledged: first.unmapped.filter(u => u.gate === 'acknowledge').map(u => u.id) };
  const plan = planAdoption(input);
  assert.equal(plan.ready, true, JSON.stringify({ conflicts: plan.conflicts, problems: plan.problems }));
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const r = loadDefinition(path.join(dir, '.bowerloom'));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  return { plan, def: r.definition };
}

/** A recorded approval for each line the fidelity check refused, as a person records one. */
const approvalsFor = (def, refused) => refused.map(l => ({
  part: l.part, entry: l.entry, ...(l.field !== undefined ? { field: l.field } : {}), engine: l.engine, result: l.result,
  entryHash: entryHash(ENTRY_LISTS[l.part](def).find(e => e.id === l.entry)), who: 'Test Person', when: '2026-10-28T10:00:00Z', reason: 'Synthetic round trip.',
}));

/** Adopts the files, projects the definition with the full projection into a fresh project, and adopts that project. */
async function roundTrip(t, files, engines) {
  const a = project(t, files);
  const ids = engines.map(id => ({ id, version: VERSIONS[id] }));
  const one = await adoptAll(a.dir, a.stateDir, ids);
  const fresh = path.join(a.base, 'fresh');
  fs.mkdirSync(fresh, { mode: 0o755 });
  const input = { projectDir: fresh, definitionFolder: a.def, stateDir: path.join(a.base, 'state', 'portable'), engines: ids };
  let approvals = [];
  try { planPortable(input); } catch (e) { if (e.code !== 'PORTABLE_FIDELITY' || !e.refused) throw e; approvals = approvalsFor(one.def, e.refused); }
  const plan = planPortable({ ...input, approvals });
  await applyPortable({ ...input, approvals }, plan.revision);
  const two = await adoptAll(fresh, path.join(a.base, 'state', 'again'), ids);
  return { dir: a.dir, fresh, one, two, plan };
}

const byId = list => [...list].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
const lineOf = (plan, part, entry) => plan.loss.find(l => l.part === part && l.entry === entry && l.field === undefined);
const ruleOf = (def, action, pattern, effect) => def.entries.rules.find(r => r.action === action && r.pattern === pattern && r.effect === effect);
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

/** The parts that come back as the same entries, private blocks included (check 9). */
function sameEntries(r, parts) {
  for (const part of parts) {
    const list = part === 'rules' || part === 'sandbox' ? d => d.entries[part] : d => d.entries[part];
    assert.deepEqual(byId(list(r.two.def)), byId(list(r.one.def)), `${part} come back the same`);
  }
}

/** Neutral requests whose decisions the guardrail comparison reads. */
const REQUESTS = [
  { action: 'shell', command: 'npm test' }, { action: 'shell', command: 'git push origin main' }, { action: 'shell', command: 'git commit -m push' },
  { action: 'shell', command: 'rm -rf build' }, { action: 'shell', command: 'git status' }, { action: 'shell', command: 'ls' },
  { action: 'read', path: '.env' }, { action: 'read', path: 'src/a.ts' }, { action: 'read', path: 'docs/a.md' },
  { action: 'edit', path: '.env' }, { action: 'edit', path: 'src/a.ts' }, { action: 'write', path: '.env' },
  { action: 'web', host: 'example.test' }, { action: 'web', host: 'sub.example.test' }, { action: 'web', search: true },
  { action: 'subagent', name: 'planner' }, { action: 'subagent', name: 'other' },
];
const shown = r => Object.values(r).join(' ');
/** Every request where the decision from the source file and from the projected file differ. */
const decisionDiffs = (source, projected) => REQUESTS.flatMap(r => (source(r) === projected(r) ? [] : [[shown(r), source(r), projected(r)]]));

const CLAUDE_FILES = {
  '.claude/settings.json': json({
    permissions: { allow: ['Bash(npm test)', 'Read(src/**)'], ask: ['Bash(git push:*)'], deny: ['Read(./.env)', 'WebFetch(domain:example.test)'] },
    sandbox: { enabled: true, ignoreViolations: { '*': ['/tmp'] } },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/scripts/check.sh', timeout: 10, statusMessage: 'Checking' }] }] },
    outputStyle: 'Explanatory',
  }),
  '.mcp.json': json({ mcpServers: {
    docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], env: { DOCS_TOKEN: '${DOCS_TOKEN}' }, alwaysLoad: true, futureField: { a: [1, 'two'] } },
    web: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { 'X-Team': 'demo' } },
  } }),
  '.claude/agents/reader.md': agent('reader', 'tools: Read, Grep, Glob\nmodel: model-a\ncolor: blue\nnested:\n  depth: 2\n'),
};

test('check 1, locked-in half: Claude Code MCP servers, subagents, hooks, guardrails, and the sandbox adopt and project back with the same meaning', async t => {
  const r = await roundTrip(t, CLAUDE_FILES, ['claude-code']);
  const e = r.one.def.entries;
  assert.deepEqual([e.mcp.length, e.subagents.length, e.hooks.length, e.rules.length, e.sandbox.length], [2, 1, 1, 5, 1], 'every locked-in part is adopted');
  sameEntries(r, ['mcp', 'subagents', 'hooks', 'sandbox']);
  const source = readJson(r.dir, '.claude/settings.json').permissions, projected = readJson(r.fresh, '.claude/settings.json').permissions;
  const decide = lists => req => claudeCodeDecide(lists, claudeCodeRequest(req));
  // Expected: a neutral web deny also covers subdomains, so the projection blocks more. Its line is weakened.
  assert.deepEqual(decisionDiffs(decide(source), decide(projected)), [['web sub.example.test', 'default', 'deny']]);
  assert.equal(lineOf(r.plan, 'guardrails', ruleOf(r.one.def, 'web', 'example.test', 'deny').id).result, 'weakened');
  // Expected: the projection forbids commands outside the sandbox (ruling B11), a key with no neutral form; the
  // engine-private file of leftover settings is not projected in this step.
  assert.deepEqual(readJson(r.fresh, '.claude/settings.json').sandbox, { enabled: true, allowUnsandboxedCommands: false, ignoreViolations: { '*': ['/tmp'] } });
  assert.equal(lineOf(r.plan, 'guardrails', 'sandbox').result, 'exact');
  assert.deepEqual(r.two.plan.unmapped.filter(u => u.gate !== 'none').map(u => u.pointer), ['/sandbox/allowUnsandboxedCommands']);
  assert.equal(lineOf(r.plan, 'engine-private', 'engines/claude-code/settings.json').result, 'absent');
});

const CODEX_FILES = {
  '.codex/config.toml': [
    'sandbox_mode = "workspace-write"', 'file_opener = "vscode"', '', '[sandbox_workspace_write]', 'exclude_slash_tmp = true', '',
    '[mcp_servers.docs]', 'command = "npx"', 'args = ["-y", "example-docs-mcp"]', 'env_vars = ["DOCS_TOKEN"]', 'startup_timeout_sec = 20', '',
    '[mcp_servers.web]', 'url = "https://mcp.example.test/mcp"', 'bearer_token_env_var = "WEB_TOKEN"', '',
  ].join('\n'),
  '.codex/rules/default.rules': 'prefix_rule(\n    pattern = ["git", "push"],\n    decision = "forbidden",\n    justification = "No pushes from an agent.",\n)\nprefix_rule(pattern = ["rm"], decision = "prompt")\n',
  '.codex/hooks.json': json({ hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '$(git rev-parse --show-toplevel)/scripts/check.sh', timeout: 10 }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'echo ready' }] }],
  } }),
  '.codex/agents/reviewer.toml': 'name = "reviewer"\ndescription = "Reviews a change."\ndeveloper_instructions = "Read the diff and report."\nmodel = "model-b"\nmodel_reasoning_effort = "low"\n',
};

test('check 1, locked-in half: Codex MCP servers, subagents, hooks, and rules adopt and project back with the same meaning; the sandbox is a listed loss', async t => {
  const r = await roundTrip(t, CODEX_FILES, ['codex']);
  const e = r.one.def.entries;
  assert.deepEqual([e.mcp.length, e.subagents.length, e.hooks.length, e.rules.length, e.sandbox.length], [2, 1, 2, 2, 1], 'every locked-in part is adopted');
  // The rules come back as the same entries: the Codex rules reader is exact for prefix rules, and a justification
  // rides in the rule's x-codex block both ways.
  sameEntries(r, ['mcp', 'subagents', 'hooks', 'rules']);
  assert.deepEqual(ruleOf(r.one.def, 'shell', 'git push *', 'deny').privateBlocks, { codex: { justification: 'No pushes from an agent.' } });
  // Expected: Bowerloom writes no Codex permission profile until the live check of step 5 (ruling B6), so the sandbox
  // requirement and its x-codex block are not written. Its line is weakened.
  assert.equal(lineOf(r.plan, 'guardrails', 'sandbox').result, 'weakened');
  assert.deepEqual(r.two.def.entries.sandbox, []);
  assert.equal(lineOf(r.plan, 'engine-private', 'engines/codex/config.json').result, 'absent');
});

const OPENCODE_FILES = {
  'opencode.json': json({
    $schema: 'https://opencode.ai/config.json',
    permission: { bash: { 'git push *': 'deny', 'rm *': 'ask', 'git status': 'allow' }, edit: 'ask', webfetch: 'deny', task: { planner: 'deny' } },
    mcp: {
      docs: { type: 'local', command: ['npx', '-y', 'example-docs-mcp'], environment: { DOCS_TOKEN: '{env:DOCS_TOKEN}' }, enabled: true },
      remote: { type: 'remote', url: 'https://mcp.example.test/mcp', headers: { 'X-Team': 'demo' }, timeout: 4000, oauth: false },
    },
    agent: { lead: { description: 'Leads.', prompt: 'Lead the work.', mode: 'primary', temperature: 0.2 } },
  }),
  '.opencode/agents/helper.md': '---\ndescription: Helps.\nmode: subagent\nmodel: provider/model-c\ntop_p: 0.9\n---\nHelp with the task.\n',
};

test('check 1, locked-in half: OpenCode MCP servers, subagents, and permission adopt and project back with the same meaning', async t => {
  const r = await roundTrip(t, OPENCODE_FILES, ['opencode']);
  const e = r.one.def.entries;
  assert.deepEqual([e.mcp.length, e.subagents.length, e.rules.length], [2, 2, 6], 'every locked-in part OpenCode has is adopted');
  sameEntries(r, ['mcp', 'subagents']);
  assert.deepEqual(byId(r.two.def.entries.subagents).map(s => [s.id, s.privateBlocks]), [['helper', { opencode: { mode: 'subagent', top_p: 0.9 } }], ['lead', { opencode: { mode: 'primary', temperature: 0.2 } }]]);
  const decide = config => req => openCodeDecide(openCodeFromConfig(config), openCodeRequest(req));
  const diffs = decisionDiffs(decide(readJson(r.dir, 'opencode.json').permission), decide(readJson(r.fresh, 'opencode.json').permission));
  // Expected: Bowerloom writes "*": { "*": "ask" } first for OpenCode, whose own default is allow, so every request
  // the source leaves to the default asks.
  const byDefault = diffs.filter(([, from, to]) => from === 'default' && to === 'ask');
  assert.deepEqual(byDefault.map(([req]) => req), ['shell npm test', 'shell ls', 'read .env', 'read src/a.ts', 'read docs/a.md', 'subagent other']);
  // Expected: a shell pattern is written with * for its spaces, and the neutral web * also covers web search, so the
  // projection blocks more. Both lines are translated.
  assert.deepEqual(diffs.filter(d => !byDefault.includes(d)), [['shell git commit -m push', 'default', 'deny'], ['web true', 'default', 'deny']]);
  assert.equal(lineOf(r.plan, 'guardrails', ruleOf(r.one.def, 'shell', 'git push *', 'deny').id).result, 'translated');
  assert.equal(lineOf(r.plan, 'guardrails', ruleOf(r.one.def, 'web', '*', 'deny').id).result, 'translated');
  assert.equal(lineOf(r.plan, 'engine-private', 'engines/opencode/opencode.json').result, 'absent');
});

test('check 1, locked-in half: Pi MCP servers adopt and project back the same; Pi has no other locked-in part', async t => {
  const r = await roundTrip(t, {
    '.pi/mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], env: { DOCS_TOKEN: '${DOCS_TOKEN}' }, lifecycle: 'lazy' } } }),
    '.pi/settings.json': json({ theme: 'dark' }),
  }, ['pi']);
  assert.equal(r.one.def.entries.mcp.length, 1);
  sameEntries(r, ['mcp', 'subagents', 'hooks', 'rules', 'sandbox']);
  assert.deepEqual(r.two.def.entries.mcp[0].privateBlocks, { pi: { lifecycle: 'lazy' } });
  assert.equal(lineOf(r.plan, 'engine-private', 'engines/pi/settings.json').result, 'absent');
});

test('check 1, locked-in half: DeepSeek Harness keeps its locked-in parts outside the project, so there is nothing to carry', async t => {
  const r = await roundTrip(t, { 'AGENTS.md': '# Rules\n', '.dsh/skills/tidy/SKILL.md': skill('tidy') }, ['deepseek-harness']);
  const e = r.one.def.entries;
  assert.deepEqual([e.mcp, e.subagents, e.hooks, e.rules, e.sandbox].map(x => x.length), [0, 0, 0, 0, 0]);
  assert.deepEqual(r.plan.changes.map(c => c.path), ['.agents/skills/tidy/SKILL.md', 'AGENTS.md'], 'the projection writes no locked-in file');
});

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

test('check 9, projection half: the locked-in writers project each unknown field of a private block to its own engine only, without loss', async t => {
  const r = await roundTrip(t, {
    '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], alwaysLoad: true, futureField: { a: [1, 'two'] } } } }),
    '.codex/config.toml': '[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "example-docs-mcp"]\nstartup_timeout_sec = 20\n',
    '.claude/agents/reader.md': '---\nname: reader\ndescription: A careful reader.\ncolor: blue\nbackground: true\n---\nRead the files and report.\n',
    '.codex/agents/reader.toml': 'name = "reader"\ndescription = "A careful reader."\ndeveloper_instructions = "Read the files and report."\nmodel_reasoning_effort = "low"\n',
    '.claude/settings.json': json({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run lint', statusMessage: 'Linting' }] }] } }),
  }, ['claude-code', 'codex']);
  // One entry each, with a block for each engine.
  const docs = r.one.def.entries.mcp.find(s => s.id === 'docs');
  assert.deepEqual(docs.privateBlocks, { 'claude-code': { alwaysLoad: true, futureField: { a: [1, 'two'] } }, codex: { startup_timeout_sec: 20 } });
  assert.deepEqual(r.one.def.entries.subagents.find(s => s.id === 'reader').privateBlocks, { 'claude-code': { color: 'blue', background: true }, codex: { model_reasoning_effort: 'low' } });
  sameEntries(r, ['mcp', 'subagents', 'hooks']);
  // Each block reaches its own engine's file only.
  assert.deepEqual(readJson(r.fresh, '.mcp.json').mcpServers.docs, { type: 'stdio', command: 'npx', args: ['-y', 'example-docs-mcp'], alwaysLoad: true, futureField: { a: [1, 'two'] } });
  const toml = fs.readFileSync(path.join(r.fresh, '.codex/config.toml'), 'utf8');
  assert.match(toml, /startup_timeout_sec = 20/);
  assert.doesNotMatch(toml, /alwaysLoad|futureField/);
  assert.doesNotMatch(fs.readFileSync(path.join(r.fresh, '.claude/agents/reader.md'), 'utf8'), /model_reasoning_effort/);
  assert.doesNotMatch(fs.readFileSync(path.join(r.fresh, '.codex/agents/reader.toml'), 'utf8'), /color|background/);
  // No loss line drops a key of a private block.
  assert.deepEqual(r.plan.loss.filter(l => l.field?.startsWith('x-')), []);
});
