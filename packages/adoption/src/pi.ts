/**
 * Pi 1.4.0 project files back to parts (locked-in parts spec, section 10; research note engines-D): `.pi/mcp.json` and
 * `.pi/settings.json`. Pi has no hooks, permission rules, sandbox, or subagents in core: extensions are TypeScript
 * code, prompts are commands, and packages are plugins, so each is listed with the reason. DeepSeek Harness
 * 0.2.2-alpha.2 keeps MCP servers, hooks, and permissions under `~/.dsh` or a `--patch` file, not in the project, so
 * its project files are instructions and skills only; the sweep lists any other file in `.dsh`.
 */
import type { Context } from './context.js';
import { isObj, leftovers, ptr, readJson, readMcpServers } from './shared.js';

const ENGINE = 'pi' as const;

export function readPi(ctx: Context): void {
  if (!ctx.engines.includes(ENGINE)) return;
  const mcp = readJson(ctx, '.pi/mcp.json', 'mcp');
  if (mcp) for (const [k, v] of Object.entries(mcp)) {
    if (k === 'mcpServers') readMcpServers(ctx, v, { path: '.pi/mcp.json', base: '/mcpServers', engines: [ENGINE], owner: ENGINE, shape: 'Pi mcp.json' });
    else ctx.r.miss('.pi/mcp.json', 'mcp', 'Adoption reads only mcpServers in mcp.json.', ptr(k));
  }
  const settings = readJson(ctx, '.pi/settings.json', 'engine-private');
  if (settings) {
    const rest = Object.fromEntries(Object.entries(settings).filter(([k]) => k !== 'packages'));
    if (Object.hasOwn(settings, 'packages')) ctx.r.miss('.pi/settings.json', 'plugins', 'Pi packages are plugins: a package is not a part, and Bowerloom does not install or unpack it here.', '/packages');
    if (isObj(rest)) leftovers(ctx, ENGINE, '.pi/settings.json', rest, 'settings.json', 'Pi settings.json');
  }
  for (const [path, part, reason] of [
    ['.pi/extensions', null, 'Pi extensions are TypeScript code. Bowerloom does not convert code into parts.'],
    ['.pi/prompts', 'commands', 'Commands are not adopted: a portable command is a skill, and a person makes that change.'],
    ['.pi/agents', 'subagents', 'Pi has no subagents in core; these files belong to an extension, so they are not adopted.'],
  ] as const) if (ctx.r.kind(path) !== null) { ctx.r.consumed.add(path); ctx.r.miss(path, part, reason); }
}
