#!/usr/bin/env node
// `bowerloom-mcp`: the old name of the MCP server. Stdout carries JSON-RPC, so this shim never writes a notice and never
// writes to stdout at all. It runs `latebrake-mcp` in this process.
async function main() {
  try {
    const { forward } = await import('../lib/forward.js');
    await forward('latebrake-mcp');
  } catch {
    try { process.stderr.write('bowerloom-mcp: could not start latebrake-mcp because the latebrake package is missing or cannot load.\n'); } catch { /* stderr is gone */ }
    process.exitCode = 1;
  }
}
void main();
