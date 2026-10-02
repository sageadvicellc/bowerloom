import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRecipeMcpServer } from '../src/server.ts';

test('MCP exposes shared recipe operations but no approval or installation selection', async () => {
  const calls = [];
  const controller = { async dispatch(operation, args) { calls.push({ operation, args }); return { operation, ok: true }; }, async close() {} };
  const server = createRecipeMcpServer(controller);
  const client = new Client({ name: 'trellis-transport-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.ok(tools.every(tool => !tool.name.includes('approve')));
    assert.ok(tools.every(tool => !Object.keys(tool.inputSchema.properties).includes('installation')));
    await client.callTool({ name: 'trellis_recipe_setup', arguments: {} });
    await client.callTool({ name: 'trellis_recipe_status', arguments: { jobId: 'job-1' } });
    assert.deepEqual(calls, [{ operation: 'setup', args: {} }, { operation: 'status', args: { jobId: 'job-1' } }]);
    const denied = await client.callTool({ name: 'trellis_recipe_approve', arguments: { jobId: 'job-1', planDigest: 'forged' } });
    assert.equal(denied.isError, true);
    assert.equal(calls.length, 2);
  } finally { await client.close(); await server.close(); }
});

test('MCP redacts unexpected failures and bounds input before controller dispatch', async () => {
  let calls = 0;
  const controller = { async dispatch() { calls++; throw new Error('private-token-value-and-path'); }, async close() {} };
  const server = createRecipeMcpServer(controller);
  const client = new Client({ name: 'trellis-error-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const failure = await client.callTool({ name: 'trellis_recipe_inspect', arguments: {} });
    assert.equal(failure.isError, true);
    assert.ok(!JSON.stringify(failure).includes('private-token-value'));
    assert.match(JSON.stringify(failure), /RECIPE_OPERATION_FAILED/);
    const tooLarge = await client.callTool({ name: 'trellis_recipe_plan', arguments: { experiment: {}, draft: { markdown: 'a'.repeat(1_048_577) }, metrics: {} } });
    assert.equal(tooLarge.isError, true);
    assert.match(JSON.stringify(tooLarge), /RECIPE_INPUT_TOO_LARGE/);
    assert.equal(calls, 1);
  } finally { await client.close(); await server.close(); }
});
