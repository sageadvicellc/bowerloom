import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { planMcpConnectionFiles, McpConnectionError } from '../../../packages/mcp-connections/src/index.js';

function usage(): never {
  throw new DefinitionError('USAGE', 'Use bowerloom mcp plan --declaration <absolute-json-file> --binding <absolute-json-file> --catalog <absolute-json-file> --synthetic. This command reads test files and grants no authority.');
}

export async function runMcpPlanCommand(args: string[]): Promise<unknown> {
  try {
    const [group, command, ...flags] = args;
    if (group !== 'mcp' || command !== 'plan') usage();
    const values = new Map<string, string>();
    let synthetic = false;
    for (let i = 0; i < flags.length; i++) {
      const key = flags[i];
      if (key === '--synthetic') {
        if (synthetic) usage();
        synthetic = true;
        continue;
      }
      if (!key || !['--declaration', '--binding', '--catalog'].includes(key) || values.has(key)) usage();
      const value = flags[++i];
      if (!value || value.startsWith('-')) usage();
      values.set(key, value);
    }
    if (!synthetic || values.size !== 3) usage();
    return await planMcpConnectionFiles({
      declarationFile: values.get('--declaration')!,
      bindingFile: values.get('--binding')!,
      catalogFile: values.get('--catalog')!,
      synthetic: true,
    });
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    if (error instanceof McpConnectionError) {
      throw new DefinitionError(error.code, 'The MCP plan failed. Inspect the selected test files and their declared identities. No connection or tool call started.');
    }
    throw new DefinitionError('MCP_CONNECTION_IO', 'The MCP plan failed to read the selected test files. Inspect their paths and permissions. No connection or tool call started.');
  }
}
