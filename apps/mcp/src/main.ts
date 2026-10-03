#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openRecipeService } from '../../cli/src/recipe.js';
import { createRecipeMcpServer } from './server.js';
import { ownMcpLifecycle } from './lifecycle.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--installation' || !args[1] || args[1].startsWith('-')) {
  process.stderr.write('Use bowerloom-mcp --installation /absolute/private-installation.json\n');
  process.exitCode = 2;
} else {
  try {
    const controller = await openRecipeService(args[1], {requireControl:true});
    const server = createRecipeMcpServer(controller);
    const { close } = ownMcpLifecycle(server, controller, process.stdin, process, () => {
      process.stderr.write('Bowerloom MCP cleanup failed. Read the saved recipe state before retrying.\n');
      process.exitCode = 1;
    });
    try { await server.connect(new StdioServerTransport()); }
    catch (error) { await close(); throw error; }
  } catch {
    process.stderr.write('Bowerloom MCP stopped. Read the private installation and saved recipe state before retrying.\n');
    process.exitCode = 1;
  }
}
