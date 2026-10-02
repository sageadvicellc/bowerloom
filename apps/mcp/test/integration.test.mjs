import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRecipeMcpServer } from '../src/server.ts';
import { openRecipeService, runRecipeCommand } from '../../../dist/apps/cli/src/recipe.js';
import { spec } from '../../../dist/tests/recipes-fixtures.js';

test('compiled recipe controller rejects invalid MCP arguments and matches CLI inspection without connections', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'trellis-mcp-proof-')));
  const installation = join(folder, 'installation.json');
  const passwordFile = join(folder, 'password.json');
  await writeFile(passwordFile, JSON.stringify({ password: 'synthetic-unused-password' }), { mode: 0o600 });
  await writeFile(installation, JSON.stringify({ format: 'trellis/recipe-installation/v1', recipe: spec,
    postgres: { host: '127.0.0.1', port: 65431, database: 'trellis_synthetic', user: 'postgres', passwordFile,
      controlSchema: 'trellis_mcp_test', checkpointSchema: 'trellis_mcp_checkpoints' },
    github: { tokenFile: join(folder, 'never-read.json') }, approval: { subject: 'synthetic-operator', enabled: false },
  }), { mode: 0o600 });
  const controller = await openRecipeService(installation);
  const server = createRecipeMcpServer(controller);
  const client = new Client({ name: 'integration-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const cli = await runRecipeCommand(['recipe', 'inspect', '--installation', installation]);
    const mcp = await client.callTool({ name: 'trellis_recipe_inspect', arguments: {} });
    assert.deepEqual(JSON.parse(mcp.content[0].text), cli);
    for (const [name, args, code] of [
      ['inspect', { installation: '/another/path' }, 'RECIPE_ARGUMENTS'],
      ['status', { jobId: 1 }, 'INVALID_JOB_ID'],
      ['status', { jobId: 'bad', approval: true }, 'RECIPE_ARGUMENTS'],
      ['approve', { jobId: 'bad', planDigest: 'forged' }, 'UNKNOWN_OR_UNAVAILABLE_TOOL'],
    ]) {
      const response = await client.callTool({ name: `trellis_recipe_${name}`, arguments: args });
      assert.equal(response.isError, true);
      assert.equal(response.content[0].text, code);
    }
    const child = spawn(process.execPath, ['dist/apps/mcp/src/main.js', '--installation', installation], {
      cwd: new URL('../../../', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    const response = once(child.stdout, 'data');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stdio-proof', version: '1' },
      } }) + '\n');
      await response;
      assert.equal(JSON.parse(stdout.trim()).result.serverInfo.name, 'bowerloom');
      child.stdin.end();
      assert.deepEqual(await exited, [0, null]);
      assert.equal(stderr, '');
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); }
  } finally { await client.close(); await server.close(); await controller.close(); await rm(folder, { recursive: true }); }
});
