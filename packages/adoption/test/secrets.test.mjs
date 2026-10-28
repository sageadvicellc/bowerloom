// Definition spec section 8 rule 3 and check 3: a literal secret in an engine file is never copied. Adoption replaces
// it with a ${NAME} reference, reports it in the plan (never the value), and marks the entry as needing approval.
// The values below are synthetic and only shaped like credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition, scanSecrets } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { item, json, project, skill } from './fixture.mjs';

const GH = 'ghp_' + 'A1b2C3d4'.repeat(4) + 'E5f6';
const ANT = 'sk-ant-' + 'synthetic0value0'.repeat(2);
const PASS = 'x9Y8w7V6u5T4s3R2';
const CC = [{ id: 'claude-code' }];

test('MCP env, headers, arguments, private blocks, and leftover settings: each literal secret becomes ${NAME}', async t => {
  const p = project(t, {
    '.mcp.json': json({
      mcpServers: {
        docs: { command: 'npx', args: ['-y', 'example-docs-mcp', '--token', PASS], env: { GITHUB_TOKEN: GH, LOG_LEVEL: 'info' }, oauth: { clientId: 'demo', clientSecret: PASS } },
        remote: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: `Bearer ${ANT}` } },
      },
    }),
    '.claude/settings.json': json({ apiToken: PASS, outputStyle: 'Explanatory' }),
  });
  const plan = planAdoption(p.input({ engines: CC }));
  const text = JSON.stringify(plan);
  for (const secret of [GH, ANT, PASS]) assert.equal(text.includes(secret), false, 'the plan never holds the value');
  assert.deepEqual(plan.secrets.map(s => [s.path, s.pointer, s.reference, s.part, s.id]), [
    ['.claude/settings.json', '/apiToken', '${CLAUDE_CODE_API_TOKEN}', 'engine-private', 'engines/claude-code/settings.json'],
    ['.mcp.json', '/mcpServers/docs/args/3', '${DOCS_ARG_TOKEN}', 'mcp', 'docs'],
    ['.mcp.json', '/mcpServers/docs/env/GITHUB_TOKEN', '${GITHUB_TOKEN}', 'mcp', 'docs'],
    ['.mcp.json', '/mcpServers/docs/oauth/clientSecret', '${DOCS_OAUTH_CLIENT_SECRET}', 'mcp', 'docs'],
    ['.mcp.json', '/mcpServers/remote/headers/Authorization', '${REMOTE_AUTHORIZATION}', 'mcp', 'remote'],
  ]);
  for (const id of ['docs', 'remote']) assert.ok(item(plan, 'mcp', id).needsApproval.some(n => /secret was replaced/.test(n)), id);
  await applyAdoption(p.input({ engines: CC }), plan.revision);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(scanSecrets(r.definition.files), []);
  for (const f of r.definition.files) for (const secret of [GH, ANT, PASS]) assert.equal(Buffer.from(f.bytes).toString().includes(secret), false, f.path);
  const docs = r.definition.entries.mcp.find(s => s.name === 'docs');
  assert.deepEqual(docs.env, { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'info' });
  assert.deepEqual(docs.args, ['-y', 'example-docs-mcp', '--token', '${DOCS_ARG_TOKEN}']);
  assert.deepEqual(r.definition.entries.mcp.find(s => s.name === 'remote').headers, { Authorization: 'Bearer ${REMOTE_AUTHORIZATION}' });
  // The originals still hold the values: adoption never edits an engine file.
  assert.equal(fs.readFileSync(path.join(p.dir, '.mcp.json'), 'utf8').includes(GH), true);
});

test('a secret where a reference cannot take its place: the entry is listed with the reason, never copied', t => {
  const p = project(t, {
    'AGENTS.md': `# Demo\n\nUse the token ${GH} for the API.\n`,
    '.claude/skills/leaky/SKILL.md': skill('leaky', '', `Call with ${ANT}.\n`),
    '.claude/settings.json': json({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `curl -H "Authorization: Bearer ${ANT}" https://x.example.test` }] }] } }),
    '.mcp.json': json({ mcpServers: { cred: { type: 'http', url: `https://user:${PASS}@mcp.example.test/` } } }),
  });
  const plan = planAdoption(p.input({ engines: CC }));
  const text = JSON.stringify(plan);
  for (const secret of [GH, ANT, PASS]) assert.equal(text.includes(secret), false);
  const reasons = plan.unmapped.map(u => `${u.path} ${u.reason}`).join('\n');
  assert.match(reasons, /AGENTS\.md This file holds a value that looks like a secret/);
  assert.match(reasons, /\.claude\/skills\/leaky .*looks like a secret/);
  assert.match(reasons, /\.claude\/settings\.json The command holds a value that looks like a secret/);
  assert.match(reasons, /\.mcp\.json The URL holds a value that looks like a secret/);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.ready, true);
});
