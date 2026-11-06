/** The engine readers, in a fixed order, and the files that name an engine. */
import type { EngineId } from '../../harness-definition/src/index.js';
import type { Context } from './context.js';
import type { ProjectReader } from './files.js';
import { readClaudeCode } from './claude-code.js';
import { readCodex } from './codex.js';
import { readOpenCode } from './opencode.js';
import { readPi } from './pi.js';

/** Files and folders whose presence names an engine. `AGENTS.md` and `.agents/skills` name none: several engines read them. */
const MARKERS: Readonly<Record<EngineId, readonly string[]>> = {
  'claude-code': ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'],
  codex: ['.codex', 'AGENTS.override.md'],
  opencode: ['opencode.json', 'opencode.jsonc', '.opencode'],
  pi: ['.pi'],
  'deepseek-harness': ['.dsh'],
};

export function detectEngines(r: ProjectReader): Set<EngineId> {
  const out = new Set<EngineId>();
  for (const [engine, paths] of Object.entries(MARKERS) as [EngineId, readonly string[]][]) if (paths.some(p => r.kind(p) !== null)) out.add(engine);
  return out;
}

/**
 * Engine folders and root files that the sweep walks after the readers ran, so every file in them is accounted for,
 * with the engine that owns each. `.agents` is shared.
 */
export const SWEPT: readonly { readonly path: string; readonly engine: EngineId | null }[] = Object.freeze([
  { path: '.mcp.json', engine: 'claude-code' }, { path: 'opencode.json', engine: 'opencode' }, { path: 'opencode.jsonc', engine: 'opencode' },
  { path: '.agents', engine: null }, { path: '.claude', engine: 'claude-code' }, { path: '.codex', engine: 'codex' }, { path: '.dsh', engine: 'deepseek-harness' },
  { path: '.opencode', engine: 'opencode' }, { path: '.pi', engine: 'pi' },
]);

/** Lists every file no reader took. A file of an engine the harness does not list says so. */
export function sweep(ctx: Context): void {
  for (const { path, engine } of SWEPT) {
    if (engine !== null && !ctx.engines.includes(engine)) ctx.r.sweep(path, 1, `This file belongs to ${engine}, which is not an engine of this harness, so it is not read.`);
    else ctx.r.sweep(path);
  }
}

/** The readers of each engine's locked-in files. */
export const ENGINE_READERS: readonly ((ctx: Context) => void)[] = Object.freeze([readClaudeCode, readCodex, readOpenCode, readPi]);
