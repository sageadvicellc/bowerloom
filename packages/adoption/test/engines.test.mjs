// Codex, OpenCode, Pi, and DeepSeek Harness files back to parts, and the version checks (locked-in parts spec 5.2, 6.2,
// 7.2, 8.2, 10; checks 6 and 13). Every file is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { DSH_PINNED_TAG, applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { code, gated, item, json, project, skill } from './fixture.mjs';

const reasonAt = (plan, path, pointer) => plan.unmapped.find(u => u.path === path && (pointer === undefined || u.pointer === pointer))?.reason;
async function adopt(p, engines, extra = {}) {
  // Gated entries are acknowledged here; gates.test.mjs tests the acknowledgement itself.
  const first = planAdoption(p.input({ engines, ...extra }));
  const input = p.input({ engines, ...extra, acknowledged: gated(first) });
  const plan = planAdoption(input);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.ready, true, JSON.stringify(plan.conflicts));
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const r = loadDefinition(p.def); assert.equal(r.ok, true, JSON.stringify(r.problems));
  return { plan, def: r.definition };
}
const fileOf = (def, path) => JSON.parse(Buffer.from(def.files.find(f => f.path === path).bytes).toString());

// ---- Codex ---------------------------------------------------------------------------------------------------------------

const CONFIG = `model = "model-b"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
model_reasoning_effort = "high"

[sandbox_workspace_write]
network_access = false

[mcp_servers.docs]
command = "npx"
args = ["-y", "example-docs-mcp"]
env = { LOG_LEVEL = "info" }
env_vars = ["DOCS_HOME"]
tool_timeout_sec = 30
startup_timeout_sec = 10
disabled_tools = ["delete_page"]

[mcp_servers.remote]
url = "https://mcp.example.test/mcp"
bearer_token_env_var = "REMOTE_TOKEN"
env_http_headers = { "X-Team" = "TEAM_NAME" }

[[hooks.PreToolUse]]
matcher = "Bash"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "$(git rev-parse --show-toplevel)/scripts/check.sh"
timeout = 10
`;

test('Codex config.toml: MCP servers, disabled tools as deny rules, the sandbox, hooks, the model, and the rest', async t => {
  const p = project(t, { '.codex/config.toml': CONFIG });
  const { plan, def } = await adopt(p, [{ id: 'codex' }]);
  const docs = def.entries.mcp.find(s => s.name === 'docs');
  assert.deepEqual({ command: docs.command, args: docs.args, env: docs.env, timeout: docs.timeout, privateBlocks: docs.privateBlocks }, {
    command: 'npx', args: ['-y', 'example-docs-mcp'], env: { LOG_LEVEL: 'info', DOCS_HOME: '${DOCS_HOME}' }, timeout: 30000, privateBlocks: { codex: { startup_timeout_sec: 10 } },
  });
  const remote = def.entries.mcp.find(s => s.name === 'remote');
  assert.deepEqual(remote.headers, { Authorization: 'Bearer ${REMOTE_TOKEN}', 'X-Team': '${TEAM_NAME}' });
  assert.equal(remote.transport, 'http');
  assert.deepEqual(def.entries.rules.map(r => [r.action, r.pattern, r.effect, r.engines]), [['mcp', 'docs/delete_page', 'deny', undefined]]);
  assert.deepEqual(def.entries.sandbox.map(s => [s.files, s.network]), [[true, true]]);
  assert.deepEqual(def.entries.hooks.map(h => [h.event, h.matcher, h.command, h.timeout]), [['PreToolUse', 'Bash', '${PROJECT_DIR}/scripts/check.sh', 10000]]);
  assert.deepEqual(def.harness.engines, [{ id: 'codex', model: 'model-b' }]);
  assert.deepEqual(fileOf(def, 'engines/codex/config.json'), { model_reasoning_effort: 'high' });
  assert.match(reasonAt(plan, '.codex/config.toml', '/approval_policy'), /modes/);
  assert.equal(plan.engines[0].shapes.some(s => s.path === '.codex/config.toml' && s.shapeVersion === '0.157.0'), true);
});

test('Codex round trip: Codex tool names in a hook matcher adopt as Claude Code names; Bowerloom\'s own justification is not kept', async t => {
  const p = project(t, {
    '.codex/hooks.json': json({ hooks: { PreToolUse: [
      { matcher: 'Bash|exec_command', hooks: [{ type: 'command', command: 'echo one' }] },
      { matcher: 'spawn_agent', hooks: [{ type: 'command', command: 'echo two' }] },
      { matcher: 'apply_patch', hooks: [{ type: 'command', command: 'echo three' }] },
    ] } }),
    '.codex/rules/bowerloom.rules': 'prefix_rule(\n    pattern = ["git", "push"],\n    decision = "forbidden",\n    justification = "Bowerloom guardrail deny-shell-6a69d046",\n)\nprefix_rule(pattern = ["rm"], decision = "prompt", justification = "Ask first.")\n',
  });
  const { def } = await adopt(p, [{ id: 'codex' }]);
  assert.deepEqual(def.entries.hooks.map(h => [h.command, h.matcher]).sort(), [['echo one', 'Bash'], ['echo three', 'apply_patch'], ['echo two', 'Agent']]);
  assert.deepEqual(def.entries.rules.map(r => [r.pattern, r.privateBlocks]).sort(), [['git push *', {}], ['rm *', { codex: { justification: 'Ask first.' } }]]);
});

test('Codex: network access in the workspace sandbox leaves only a file sandbox; danger-full-access leaves none', async t => {
  const a = project(t, { '.codex/config.toml': 'sandbox_mode = "workspace-write"\n[sandbox_workspace_write]\nnetwork_access = true\nwritable_roots = ["/tmp/x"]\n' });
  const { plan, def } = await adopt(a, [{ id: 'codex' }]);
  assert.deepEqual(def.entries.sandbox.map(s => [s.files, s.network]), [[true, false]]);
  assert.match(reasonAt(plan, '.codex/config.toml', '/sandbox_workspace_write/writable_roots'), /permission-like|no neutral form/);
  const b = project(t, { '.codex/config.toml': 'sandbox_mode = "danger-full-access"\n' });
  const second = await adopt(b, [{ id: 'codex' }]);
  assert.deepEqual(second.def.entries.sandbox, []);
  assert.match(reasonAt(second.plan, '.codex/config.toml', '/sandbox_mode'), /no sandbox/);
});

test('Codex rules files: forbidden and prompt become deny and ask, allow stays allow and is never widened', async t => {
  const p = project(t, {
    '.codex/rules/default.rules': [
      '# synthetic rules',
      'prefix_rule(pattern = ["git", "push"], decision = "forbidden", justification = "No pushes.")',
      'prefix_rule(',
      '    pattern = ["npm", ["test", "run"]],',
      '    decision = "prompt",',
      ')',
      'prefix_rule(pattern = ["ls"])',
    ].join('\n'),
  });
  const { plan, def } = await adopt(p, [{ id: 'codex' }]);
  assert.deepEqual(def.entries.rules.map(r => [r.pattern, r.effect, r.strength]).sort(), [
    ['git push *', 'deny', 'enforced'], ['ls *', 'allow', 'advisory'], ['npm run *', 'ask', 'enforced'], ['npm test *', 'ask', 'enforced'],
  ]);
  const deny = def.entries.rules.find(r => r.effect === 'deny');
  assert.deepEqual(deny.privateBlocks, { codex: { justification: 'No pushes.' } });
  assert.match(item(plan, 'guardrails', def.entries.rules.find(r => r.effect === 'allow').id).notes.join(' '), /outside the sandbox/);
});

test('Codex rules files: a deny with a token that has no neutral form, or a file that is not prefix_rule calls, is gated and drops the shell allows', async t => {
  const p = project(t, {
    '.codex/rules/default.rules': 'prefix_rule(pattern = ["ls"])\nprefix_rule(pattern = ["rm", "-rf *"], decision = "forbidden")\n',
    '.codex/rules/odd.rules': 'load("x")\n',
  });
  const { plan, def } = await adopt(p, [{ id: 'codex' }]);
  assert.deepEqual(def.entries.rules, []);
  assert.match(reasonAt(plan, '.codex/rules/default.rules', '/1'), /token/);
  assert.equal(plan.unmapped.find(u => u.path === '.codex/rules/default.rules' && u.pointer === '/1').gate, 'acknowledge');
  assert.match(reasonAt(plan, '.codex/rules/odd.rules'), /prefix_rule/);
  assert.match(reasonAt(plan, '.codex/rules/default.rules', '/0'), /a deny of this action could not be carried/);
});

test('Codex agent files become subagents; feature switches are a tool limit the neutral list cannot carry', async t => {
  const p = project(t, {
    '.codex/agents/reviewer.toml': 'name = "reviewer"\ndescription = "Reviews a change."\ndeveloper_instructions = "Read the diff and report."\nmodel = "model-b"\nmodel_reasoning_effort = "low"\nsandbox_mode = "workspace-write"\n',
    '.codex/agents/locked.toml': 'name = "locked"\ndescription = "No shell."\ndeveloper_instructions = "Read only."\n[features]\nshell_tool = false\n',
  });
  const { plan, def } = await adopt(p, [{ id: 'codex' }]);
  assert.deepEqual(def.entries.subagents.map(s => [s.id, s.body, s.model, s.privateBlocks]), [['reviewer', 'Read the diff and report.\n', { codex: 'model-b' }, { codex: { model_reasoning_effort: 'low' } }]]);
  assert.match(reasonAt(plan, '.codex/agents/reviewer.toml', '/sandbox_mode'), /per subagent/);
  assert.match(reasonAt(plan, '.codex/agents/locked.toml'), /feature switches/);
});

test('a TOML form outside the subset is listed with the reason, not guessed', t => {
  const p = project(t, { '.codex/config.toml': 'model = """multi"""\n' });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  assert.match(reasonAt(plan, '.codex/config.toml'), /TOML/);
});

// ---- OpenCode ------------------------------------------------------------------------------------------------------------

test('OpenCode 1.x: permission keys, MCP entries, and agents; last match wins is reported where precedence differs', async t => {
  const p = project(t, {
    'opencode.json': json({
      $schema: 'https://opencode.ai/config.json',
      model: 'provider/model-c',
      permission: { bash: { '*': 'ask', 'git status': 'allow', 'git push *': 'deny' }, edit: 'ask', webfetch: 'deny', task: { 'planner': 'deny' }, skill: { '*': 'allow' }, read: { 'docs/*': 'allow' } },
      mcp: {
        docs: { type: 'local', command: ['npx', '-y', 'example-docs-mcp'], environment: { DOCS_TOKEN: '{env:DOCS_TOKEN}' }, enabled: true },
        remote: { type: 'remote', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer {env:REMOTE_TOKEN}' }, timeout: 4000 },
      },
      agent: { helper: { description: 'Helps.', prompt: 'Help with the task.', model: 'provider/model-c', temperature: 0.2 } },
      plugin: ['example-plugin'],
    }),
    '.opencode/agents/reviewer.md': '---\ndescription: Reviews.\nmode: subagent\n---\nReview the change.\n',
    '.opencode/agents/limited.md': '---\ndescription: Limited.\ntools:\n  write: false\n---\nRead only.\n',
    '.opencode/plugins/guard.js': 'export default async () => ({})\n',
  });
  const { plan, def } = await adopt(p, [{ id: 'opencode', version: '1.18.30' }]);
  assert.deepEqual(def.entries.rules.map(r => [r.action, r.pattern, r.effect]).sort(), [
    ['edit', '**', 'ask'], ['shell', '*', 'ask'], ['shell', 'git push *', 'deny'], ['shell', 'git status', 'allow'], ['skill', '*', 'allow'], ['subagent', 'planner', 'deny'], ['web', '*', 'deny'],
  ]);
  assert.match(reasonAt(plan, 'opencode.json', '/permission/read/#0'), /across folders/);
  assert.match(plan.warnings.join('\n'), /last match/);
  const docs = def.entries.mcp.find(s => s.name === 'docs');
  assert.deepEqual([docs.command, docs.args, docs.env], ['npx', ['-y', 'example-docs-mcp'], { DOCS_TOKEN: '${DOCS_TOKEN}' }]);
  assert.deepEqual(def.entries.mcp.find(s => s.name === 'remote').headers, { Authorization: 'Bearer ${REMOTE_TOKEN}' });
  assert.deepEqual(def.entries.subagents.map(s => [s.id, s.model, s.privateBlocks]).sort(), [
    ['helper', { opencode: 'provider/model-c' }, { opencode: { temperature: 0.2 } }],
    ['reviewer', undefined, { opencode: { mode: 'subagent' } }],
  ]);
  // Step 3 contract change: an OpenCode agent's mode (primary, subagent, all) rides in its x-opencode block.
  assert.equal(reasonAt(plan, '.opencode/agents/reviewer.md', '/mode'), undefined);
  assert.match(reasonAt(plan, '.opencode/agents/limited.md'), /tool limit/);
  assert.match(reasonAt(plan, 'opencode.json', '/plugin'), /plugin/);
  assert.match(reasonAt(plan, '.opencode/plugins'), /JavaScript/);
  assert.deepEqual(def.harness.engines, [{ id: 'opencode', version: '1.18.30', model: 'provider/model-c' }]);
  assert.deepEqual(fileOf(def, 'engines/opencode/opencode.json'), { $schema: 'https://opencode.ai/config.json' });
});

test('OpenCode agent mode: primary, subagent, and all ride in x-opencode; any other value is listed', async t => {
  const p = project(t, {
    'opencode.json': json({ agent: { lead: { description: 'Leads.', prompt: 'Lead the work.', mode: 'primary' }, odd: { description: 'Odd.', prompt: 'Be odd.', mode: 'background' } } }),
    '.opencode/agents/both.md': '---\ndescription: Both ways.\nmode: all\n---\nWork either way.\n',
    '.opencode/agents/listed.md': '---\ndescription: Listed.\nmode: 3\n---\nWork.\n',
  });
  const { plan, def } = await adopt(p, [{ id: 'opencode', version: '1.18.30' }]);
  assert.deepEqual(def.entries.subagents.map(s => [s.id, s.privateBlocks]).sort(), [
    ['both', { opencode: { mode: 'all' } }], ['lead', { opencode: { mode: 'primary' } }], ['listed', {}], ['odd', {}],
  ]);
  assert.match(reasonAt(plan, 'opencode.json', '/agent/odd/mode'), /primary, subagent, or all/);
  assert.match(reasonAt(plan, '.opencode/agents/listed.md', '/mode'), /primary, subagent, or all/);
});

test('check 6: an OpenCode file in the 2.x shape, or a recorded version other than 1.x, is refused', t => {
  const a = project(t, { 'opencode.json': json({ permission: { shell: [{ pattern: '*', action: 'ask' }] } }) });
  assert.throws(() => planAdoption(a.input({ engines: [{ id: 'opencode' }] })), code('ADOPTION_OPENCODE_VERSION'));
  const b = project(t, { 'opencode.json': json({ permission: { bash: 'ask' } }) });
  assert.throws(() => planAdoption(b.input({ engines: [{ id: 'opencode', version: '2.0.1' }] })), code('ADOPTION_OPENCODE_VERSION'));
  assert.equal(planAdoption(b.input({ engines: [{ id: 'opencode', version: '1.18.30' }] })).ready, true);
});

test('OpenCode reads opencode.jsonc with comments and trailing commas', async t => {
  const p = project(t, { 'opencode.jsonc': '{\n  // a comment\n  "permission": { "bash": { "rm *": "deny", }, },\n}\n' });
  const { def } = await adopt(p, [{ id: 'opencode' }]);
  assert.deepEqual(def.entries.rules.map(r => [r.pattern, r.effect]), [['rm *', 'deny']]);
});

// ---- Pi and DeepSeek Harness ---------------------------------------------------------------------------------------------

test('Pi: .pi/mcp.json servers and skills; extensions, prompts, and packages are listed', async t => {
  const p = project(t, {
    '.pi/mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'] } } }),
    '.pi/skills/lint/SKILL.md': skill('lint'),
    '.pi/settings.json': json({ packages: ['example-package'], theme: 'dark', defaultProjectTrust: 'always' }),
    '.pi/extensions/guard.ts': 'export default {}\n',
    '.pi/prompts/fix.md': '---\ndescription: Fix.\n---\nFix $1.\n',
  });
  const { plan, def } = await adopt(p, [{ id: 'pi' }]);
  assert.deepEqual(def.entries.mcp.map(s => s.name), ['docs']);
  assert.deepEqual(def.entries.skills.map(s => s.id), ['lint']);
  assert.deepEqual(fileOf(def, 'engines/pi/settings.json'), { theme: 'dark' });
  assert.match(reasonAt(plan, '.pi/settings.json', '/packages'), /package/);
  assert.match(reasonAt(plan, '.pi/settings.json', '/defaultProjectTrust'), /permission-like/);
  assert.match(reasonAt(plan, '.pi/extensions'), /TypeScript/);
  assert.match(reasonAt(plan, '.pi/prompts'), /Commands/);
});

test('check 13: DeepSeek Harness is pinned; any other tag is refused, and the pinned tag is recorded', t => {
  const p = project(t, { '.dsh/skills/lint/SKILL.md': skill('lint'), '.dsh/cordis.patch.yml': 'insert: []\n' });
  assert.throws(() => planAdoption(p.input({ engines: [{ id: 'deepseek-harness', version: '0.2.3-alpha.1' }] })), code('ADOPTION_DSH_TAG'));
  const plan = planAdoption(p.input());
  assert.deepEqual(plan.engines.map(e => [e.id, e.version]), [['deepseek-harness', DSH_PINNED_TAG]]);
  assert.equal(item(plan, 'skills', 'lint').engines, null);
  assert.match(reasonAt(plan, '.dsh/cordis.patch.yml'), /no reader/);
});
