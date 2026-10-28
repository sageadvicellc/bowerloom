// Review rulings A7, A9, A14, and A17: what a person must confirm before adoption writes. Apply takes the confirmed
// approval ids; the input takes the acknowledged ids of unmapped deny, ask, and sandbox entries. Synthetic values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { INSTRUCTIONS, code, gated, item, json, project } from './fixture.mjs';

const CC = [{ id: 'claude-code' }];
const GH = 'ghp_' + 'A1b2C3d4'.repeat(4) + 'E5f6';

test('A7: apply refuses until every item that needs approval is confirmed by id', async t => {
  const p = project(t, { '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'] } } }) });
  const plan = planAdoption(p.input({ engines: CC }));
  assert.deepEqual(plan.approvalsRequired, ['mcp/docs']);
  await assert.rejects(applyAdoption(p.input({ engines: CC }), plan.revision, []), code('ADOPTION_APPROVAL_REQUIRED'));
  await assert.rejects(applyAdoption(p.input({ engines: CC }), plan.revision, ['mcp/docs', 'mcp/other']), code('ADOPTION_USAGE'));
  await assert.rejects(applyAdoption(p.input({ engines: CC }), plan.revision, 'mcp/docs'), code('ADOPTION_USAGE'));
  assert.equal(fs.existsSync(p.def), false);
  await applyAdoption(p.input({ engines: CC }), plan.revision, ['mcp/docs']);
  assert.equal(fs.existsSync(path.join(p.def, 'harness.json')), true);
});

test('A7: a replaced secret names the person\'s own value; a ${NAME} in a command, an argument, or a URL needs approval', t => {
  const p = project(t, {
    '.mcp.json': json({
      mcpServers: {
        docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], env: { GITHUB_TOKEN: GH } },
        argref: { type: 'http', url: 'https://mcp.example.test/${TEAM}/mcp' },
      },
    }),
    '.pi/mcp.json': json({ mcpServers: { cmdref: { command: '${TOOL_HOME}/bin/server', args: ['--home', '${TOOL_HOME}'] } } }),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'pi' }] }));
  assert.ok(item(plan, 'mcp', 'docs').needsApproval.some(n => n === 'Your own value of GITHUB_TOKEN will be sent to this server.'));
  for (const id of ['argref', 'cmdref']) assert.ok(item(plan, 'mcp', id).needsApproval.some(n => /\$\{NAME\} reference/.test(n)), id);
});

test('A9: a private block or engine file that holds a command, a URL, or a credential helper needs approval', t => {
  const p = project(t, {
    '.claude/settings.json': json({ awsAuthRefresh: 'aws sso login', outputStyle: 'Explanatory' }),
    '.codex/config.toml': 'notify = ["notify-send", "done"]\n',
    '.mcp.json': json({ mcpServers: { docs: { type: 'http', url: 'https://mcp.example.test/mcp', oauth: { authServerMetadataUrl: 'https://auth.example.test/meta' } } } }),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  for (const key of ['engine-private/engines/claude-code/settings.json', 'engine-private/engines/codex/config.json', 'mcp/docs']) assert.ok(plan.approvalsRequired.includes(key), key);
  assert.ok(item(plan, 'mcp', 'docs').needsApproval.some(n => /command, a URL, or a credential helper/.test(n)));
});

test('A14: instructions that only some engines read need approval, since every engine reads them after projection', t => {
  const p = project(t, { 'CLAUDE.md': '# Claude only\n' });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  assert.deepEqual(item(plan, 'system-prompt', 'AGENTS.md').engines, ['claude-code']);
  assert.ok(item(plan, 'system-prompt', 'AGENTS.md').needsApproval.some(n => /after projection every listed engine reads this text/.test(n)));
  const q = project(t, { 'AGENTS.md': INSTRUCTIONS });
  assert.deepEqual(item(planAdoption(q.input({ engines: [{ id: 'codex' }] })), 'system-prompt', 'AGENTS.md').needsApproval, []);
});

test('A17: an unmapped deny, ask, or sandbox entry keeps the plan not ready until a person acknowledges it by id', async t => {
  const p = project(t, { '.claude/settings.json': json({ permissions: { deny: ['Read(//etc/**)', 'Bash(rm *)'], allow: ['Glob'] }, sandbox: { enabled: false, network: { allowedDomains: ['x.example.test'] } } }) });
  const plan = planAdoption(p.input({ engines: CC }));
  assert.equal(plan.ready, false);
  const ids = gated(plan);
  assert.deepEqual(ids, ['.claude/settings.json#/permissions/deny/0', '.claude/settings.json#/sandbox/network']);
  assert.equal(plan.unmapped.find(u => u.pointer === '/permissions/allow/0').gate, 'none', 'a lost allow blocks nothing more, so it needs no acknowledgement');
  await assert.rejects(applyAdoption(p.input({ engines: CC }), plan.revision, plan.approvalsRequired), code('ADOPTION_ACKNOWLEDGEMENT_REQUIRED'));
  assert.throws(() => planAdoption(p.input({ engines: CC, acknowledged: ['.claude/settings.json#/nope'] })), code('ADOPTION_CHOICE_INVALID'));
  const acked = planAdoption(p.input({ engines: CC, acknowledged: ids }));
  assert.equal(acked.ready, true);
  assert.ok(acked.unmapped.filter(u => u.gate === 'acknowledge').every(u => u.acknowledged));
  await applyAdoption(p.input({ engines: CC, acknowledged: ids }), acked.revision, acked.approvalsRequired);
});

test('the state folder must be outside the project', t => {
  const p = project(t, { 'AGENTS.md': INSTRUCTIONS });
  assert.throws(() => planAdoption({ projectDir: p.dir, stateDir: path.join(p.dir, 'state'), engines: CC }), code('ADOPTION_STATE_UNSAFE'));
  assert.throws(() => planAdoption({ projectDir: p.dir, engines: CC }), code('ADOPTION_USAGE'));
});
