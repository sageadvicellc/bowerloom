// Claude Code files back to parts (definition spec 10.2; locked-in parts spec 5.2, 6.2, 7.2, 8.2, 8.4): permission
// rules to guardrails, hooks to hooks.json, the sandbox, MCP entries to mcp.json, agent files to subagents. A field with
// no neutral form goes to an x-claude-code block, unless it is permission-like; then it is listed with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinition, selectForEngine } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { agent, item, json, project, skill } from './fixture.mjs';

const CC = [{ id: 'claude-code' }];
const reasonAt = (plan, path, pointer) => plan.unmapped.find(u => u.path === path && (pointer === undefined || u.pointer === pointer))?.reason;
async function adopt(p, extra = {}) {
  const plan = planAdoption(p.input({ engines: CC, ...extra }));
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.ready, true, JSON.stringify(plan.conflicts));
  await applyAdoption(p.input({ engines: CC, ...extra }), plan.revision);
  const r = loadDefinition(p.def); assert.equal(r.ok, true, JSON.stringify(r.problems));
  return { plan, def: r.definition };
}

test('permission rules become guardrail rules; a rule outside the neutral language is listed with the reason', async t => {
  const p = project(t, {
    '.claude/settings.json': json({
      permissions: {
        allow: ['Bash(npm run test:*)', 'Read(./src/**)', 'WebFetch(domain:docs.example.test)', 'Glob'],
        ask: ['Bash(git push *)', 'mcp__docs__search'],
        deny: ['Read(/secrets/**)', 'Read(//etc/**)', 'Edit(.env)', 'WebFetch', 'Agent(planner)', 'Skill(deploy)', 'WebSearch'],
        defaultMode: 'acceptEdits',
      },
    }),
  });
  const { plan, def } = await adopt(p);
  const rules = def.entries.rules.map(r => [r.action, r.pattern, r.effect, r.strength]).sort();
  assert.deepEqual(rules, [
    ['edit', '.env', 'deny', 'enforced'],
    ['mcp', 'docs/search', 'ask', 'enforced'],
    ['read', './secrets/**', 'deny', 'enforced'],
    ['read', './src/**', 'allow', 'advisory'],
    ['shell', 'git push *', 'ask', 'enforced'],
    ['shell', 'npm run test:*', 'allow', 'advisory'],
    ['skill', 'deploy', 'deny', 'enforced'],
    ['subagent', 'planner', 'deny', 'enforced'],
    ['web', '*', 'deny', 'enforced'],
    ['web', 'docs.example.test', 'allow', 'advisory'],
  ]);
  assert.match(reasonAt(plan, '.claude/settings.json', '/permissions/deny/1'), /absolute/);
  assert.match(reasonAt(plan, '.claude/settings.json', '/permissions/deny/6'), /web search alone/);
  assert.match(reasonAt(plan, '.claude/settings.json', '/permissions/allow/3'), /no form for this tool/);
  assert.match(reasonAt(plan, '.claude/settings.json', '/permissions/defaultMode'), /modes/);
  const web = plan.items.find(i => i.part === 'guardrails' && i.id.startsWith('deny-web-'));
  assert.match(web.notes.join(' '), /also covers web search/);
});

test('hooks: command handlers become hooks with milliseconds and ${PROJECT_DIR}; other handler types are listed', async t => {
  const p = project(t, {
    '.claude/settings.json': json({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/scripts/check.sh', timeout: 30, statusMessage: 'Checking' }] }],
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/scripts/format.sh' }, { type: 'http', url: 'https://hooks.example.test/x' }] }],
      },
    }),
  });
  const { plan, def } = await adopt(p);
  const hooks = def.entries.hooks.map(h => ({ event: h.event, matcher: h.matcher, command: h.command, timeout: h.timeout, strength: h.strength, privateBlocks: h.privateBlocks }));
  assert.deepEqual(hooks.sort((a, b) => a.event.localeCompare(b.event)), [
    { event: 'PostToolUse', matcher: 'Edit|Write', command: '${PROJECT_DIR}/scripts/format.sh', timeout: undefined, strength: 'advisory', privateBlocks: {} },
    { event: 'PreToolUse', matcher: 'Bash', command: '"${PROJECT_DIR}"/scripts/check.sh', timeout: 30000, strength: 'enforced', privateBlocks: { 'claude-code': { statusMessage: 'Checking' } } },
  ]);
  assert.match(reasonAt(plan, '.claude/settings.json', '/hooks/PostToolUse/0/hooks/1'), /Only command hooks/);
  assert.ok(plan.items.filter(i => i.part === 'hooks').every(i => i.needsApproval.some(n => /runs a command/.test(n))));
});

test('sandbox, model, env, and the other settings keys', async t => {
  const p = project(t, {
    '.claude/settings.json': json({
      model: 'model-a',
      sandbox: { enabled: true, autoAllowBashIfSandboxed: true },
      env: { LOG_LEVEL: 'debug' },
      outputStyle: 'Explanatory',
      cleanupPeriodDays: 20,
      statusLine: { type: 'command', command: 'echo hi' },
    }),
    '.claude/settings.local.json': json({ permissions: { allow: ['Bash(*)'] } }),
  });
  const { plan, def } = await adopt(p);
  assert.deepEqual(def.entries.sandbox.map(s => [s.id, s.files, s.network]), [['sandbox', true, true]]);
  assert.deepEqual(def.harness.engines, [{ id: 'claude-code', model: 'model-a' }]);
  assert.deepEqual(def.enginePrivate['claude-code'], ['settings.json']);
  const privateFile = def.files.find(f => f.path === 'engines/claude-code/settings.json');
  assert.deepEqual(JSON.parse(Buffer.from(privateFile.bytes).toString()), { outputStyle: 'Explanatory', cleanupPeriodDays: 20 });
  assert.match(reasonAt(plan, '.claude/settings.json', '/sandbox/autoAllowBashIfSandboxed'), /permission-like/);
  assert.match(reasonAt(plan, '.claude/settings.json', '/env'), /permission-like/);
  assert.match(reasonAt(plan, '.claude/settings.json', '/statusLine'), /permission-like/);
  assert.match(reasonAt(plan, '.claude/settings.local.json'), /local scope/);
});

test('.mcp.json servers become mcp.json entries; an unknown field goes to x-claude-code (check 9, adoption half)', async t => {
  const p = project(t, {
    '.mcp.json': json({
      mcpServers: {
        docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], env: { LOG_LEVEL: 'info', DOCS_TOKEN: '${DOCS_TOKEN}' }, alwaysLoad: true },
        remote: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { 'X-Team': 'demo' }, timeout: 5000 },
        helper: { type: 'http', url: 'https://mcp.example.test/h', headersHelper: './get-headers.sh' },
        defaults: { command: 'npx', env: { REGION: '${REGION:-eu}' } },
      },
    }),
  });
  const { plan, def } = await adopt(p);
  const byName = Object.fromEntries(def.entries.mcp.map(s => [s.name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ['docs', 'helper', 'remote']);
  assert.deepEqual(byName.docs.privateBlocks, { 'claude-code': { alwaysLoad: true } });
  assert.deepEqual(byName.docs.env, { LOG_LEVEL: 'info', DOCS_TOKEN: '${DOCS_TOKEN}' });
  assert.equal(byName.remote.transport, 'http');
  assert.equal(byName.remote.timeout, 5000);
  assert.match(reasonAt(plan, '.mcp.json', '/mcpServers/helper/headersHelper'), /permission-like/);
  assert.match(reasonAt(plan, '.mcp.json', '/mcpServers/defaults/env/REGION'), /\$\{NAME:-x\}/);
  assert.ok(item(plan, 'mcp', 'docs').needsApproval.some(n => /stdio/.test(n)));
  // The private block reaches its own engine only.
  assert.deepEqual(selectForEngine(def, 'claude-code').mcp.find(s => s.name === 'docs').privateBlocks, { 'claude-code': { alwaysLoad: true } });
});

test('agent files become subagents: tools to classes, narrowed when a class is not fully listed; extra keys to x-claude-code', async t => {
  const p = project(t, {
    '.claude/agents/reader.md': agent('reader', 'tools: Read, Grep, Glob, mcp__docs\nmodel: model-a\ncolor: blue\nmaxTurns: 5\npermissionMode: plan\nskills:\n  - review\n'),
    '.claude/agents/writer.md': agent('writer', 'tools:\n  - Read\n  - Grep\n  - Edit\n  - TodoWrite\n'),
    '.claude/agents/free.md': agent('free'),
    '.claude/agents/Bad_Name.md': agent('Bad_Name'),
    '.claude/agents/empty.md': agent('empty', '', ''),
  });
  const { plan, def } = await adopt(p);
  const by = Object.fromEntries(def.entries.subagents.map(s => [s.id, s]));
  assert.deepEqual(Object.keys(by).sort(), ['free', 'reader', 'writer']);
  assert.deepEqual(by.reader.tools, ['read', 'search', 'mcp:docs']);
  assert.deepEqual(by.reader.model, { 'claude-code': 'model-a' });
  assert.deepEqual(by.reader.skills, ['review']);
  assert.deepEqual(by.reader.privateBlocks, { 'claude-code': { color: 'blue', maxTurns: 5 } });
  assert.equal(by.reader.body, '\nRead the files and report.\n');
  assert.deepEqual(by.writer.tools, ['read', 'edit']);
  assert.match(item(plan, 'subagents', 'writer').notes.join(' '), /narrower/);
  assert.equal(by.free.tools, undefined);
  assert.match(reasonAt(plan, '.claude/agents/reader.md', '/permissionMode'), /permission-like/);
  assert.match(reasonAt(plan, '.claude/agents/Bad_Name.md'), /valid id/);
  assert.match(reasonAt(plan, '.claude/agents/empty.md'), /instructions/);
});

test('a skill: allowed-tools becomes allow rules that need approval (ruling R5); engine-only keys go to harness.json', async t => {
  const p = project(t, {
    '.claude/skills/deploy/SKILL.md': skill('deploy', 'allowed-tools: Bash(git add:*), Read\nwhen_to_use: Before a release.\ndisable-model-invocation: true\nhooks:\n  PreToolUse: []\n'),
  });
  const { plan, def } = await adopt(p);
  const s = def.entries.skills[0];
  assert.deepEqual(s.privateBlocks, { 'claude-code': { when_to_use: 'Before a release.', 'disable-model-invocation': true } });
  assert.deepEqual(def.entries.rules.map(r => [r.action, r.pattern, r.effect]).sort(), [['read', '**', 'allow'], ['shell', 'git add:*', 'allow']]);
  assert.ok(plan.items.filter(i => i.part === 'guardrails').every(i => i.needsApproval.some(n => /wider/.test(n))));
  assert.match(reasonAt(plan, '.claude/skills/deploy/SKILL.md', '/hooks'), /permission-like/);
  const text = Buffer.from(def.files.find(f => f.path === 'skills/deploy/SKILL.md').bytes).toString();
  assert.equal(text, '---\nname: deploy\ndescription: Reviews a change before merge.\n---\n\nUse deploy with care.\n');
});
