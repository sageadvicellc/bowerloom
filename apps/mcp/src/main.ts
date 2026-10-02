#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openRecipeService } from '../../cli/src/recipe.js';
import { createRecipeMcpServer } from './server.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--installation' || !args[1] || args[1].startsWith('-')) {
  process.stderr.write('Use trellis-mcp --installation /absolute/private-installation.json\n');
  process.exitCode = 2;
} else {
  try {
    const controller = await openRecipeService(args[1]);
    const server = createRecipeMcpServer(controller);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try { await server.close(); }
      finally { await controller.close(); }
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
    server.onclose = () => { void close(); };
    try { await server.connect(new StdioServerTransport()); }
    catch (error) { await close(); throw error; }
  } catch {
    process.stderr.write('Trellis MCP stopped. Read the private installation and saved recipe state before retrying.\n');
    process.exitCode = 1;
  }
}
