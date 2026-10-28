/**
 * Subagents (locked-in parts spec, section 6; decision 2 of section 13; check 3). One form per engine, in memory.
 *
 * - A tool limit is enforced, and never more permissive than the source:
 *   - Claude Code carries it as the `tools` allowlist, `exact`.
 *   - OpenCode carries it as `deny` keys of the agent's `permission`, `translated`. No key is ever `allow` or `ask`:
 *     the agent's keys come after the configuration's and win, so an `allow` there could reopen a guardrail `deny`.
 *   - Codex has feature switches and no per-tool list, so the limit is `weakened`: it is refused unless a person
 *     approves an override, which adds the limit to the instructions as advisory text (decision 2).
 *   - Pi and DeepSeek Harness have no subagents in core: the subagent is `absent`, and one with a tool limit is refused
 *     unless a recorded override exists (check 12).
 * - Bowerloom never translates a model name: the definition names one per engine, or none (decision 4).
 * - A skill list preloads in Claude Code. In Codex and OpenCode the skills stay discoverable but are not preloaded.
 */
import type { EngineId, JsonValue, LossLine, SubagentEntry, ToolClass } from '../../harness-definition/src/index.js';
import { Lines, addPrivate, holdsEnvDefault, privateLine, type LockedProblem } from './locked-common.js';

export type SubagentForm =
  | { readonly engine: 'claude-code' | 'opencode'; readonly id: string; readonly frontmatter: readonly (readonly [string, JsonValue | readonly (readonly [string, string])[]])[]; readonly body: string }
  | { readonly engine: 'codex'; readonly id: string; readonly table: readonly (readonly [string, JsonValue])[] };

export interface SubagentTranslation {
  readonly engine: EngineId;
  readonly subagents: readonly SubagentForm[];
  readonly lines: readonly LossLine[];
  readonly problems: readonly LockedProblem[];
}

export interface SubagentContext {
  /** The MCP servers of the definition for this engine. OpenCode denies the tools of each one a limit leaves out. */
  readonly servers?: readonly string[];
}

/** Claude Code tool names for each neutral tool class. */
export const CLAUDE_CODE_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  read: ['Read'], search: ['Grep', 'Glob'], edit: ['Edit', 'NotebookEdit'], write: ['Write'], shell: ['Bash'], web: ['WebFetch', 'WebSearch'],
  task: ['Agent'], skill: ['Skill'],
});
/** OpenCode 1.x permission keys for each neutral tool class. `edit` and `write` share one key. */
export const OPENCODE_TOOL_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  read: ['read'], search: ['grep', 'glob', 'list'], edit: ['edit'], write: ['edit'], shell: ['bash'], web: ['webfetch', 'websearch'],
  task: ['task'], skill: ['skill'],
});
const CLASSES = ['read', 'search', 'edit', 'write', 'shell', 'web', 'task', 'skill'] as const;
const servers = (tools: readonly ToolClass[]): string[] => tools.filter(t => t.startsWith('mcp:')).map(t => t.slice(4));

export function translateSubagents(engine: EngineId, subagents: readonly SubagentEntry[], context: SubagentContext = {}): SubagentTranslation {
  const out = new Lines('subagents', engine);
  const forms: SubagentForm[] = [];
  for (const a of subagents) {
    if (holdsEnvDefault(a)) { out.envDefault(a.id); continue; }
    const modelLine = (): void => {
      if (a.model !== undefined && a.model[engine] === undefined) out.line(a.id, 'absent', `The definition names no model for ${engine}, and Bowerloom never translates a model name, so the engine's own default model applies.`, 'model');
    };
    switch (engine) {
      case 'claude-code': {
        const front: [string, JsonValue][] = [['name', a.name], ['description', a.description]];
        if (a.tools !== undefined) {
          if (a.tools.length === 0) out.line(a.id, 'absent', 'An empty tool limit has no documented Claude Code form, and leaving tools out would give the subagent every tool. Not written.', 'tools');
          else {
            const names = [...new Set(a.tools.flatMap(t => t.startsWith('mcp:') ? [`mcp__${t.slice(4)}`] : CLAUDE_CODE_TOOLS[t]!))];
            front.push(['tools', names.join(', ')]);
            const mcp = servers(a.tools);
            if (mcp.length) out.line(a.id, 'translated', `Claude Code carries the limit as the tools list ${names.join(', ')}. The research notes document no whole-server form for a subagent tools list, so ${mcp.map(s => `mcp__${s}`).join(', ')} may name no tool: the subagent then has less, never more. The live check of step 5 confirms it.`, 'tools');
            else out.line(a.id, 'exact', `Claude Code carries the limit as the tools list ${names.join(', ')}.`, 'tools');
          }
        }
        if (a.model?.['claude-code'] !== undefined) front.push(['model', a.model['claude-code']]);
        modelLine();
        if (a.skills !== undefined) { front.push(['skills', [...a.skills]]); out.line(a.id, 'exact', 'Claude Code preloads the listed skills.', 'skills'); }
        const { dropped } = addPrivate(front, a.privateBlocks['claude-code']);
        privateLine(out, a.id, dropped, 'the frontmatter');
        out.line(a.id, 'exact', `Claude Code reads the subagent from .claude/agents/${a.id}.md, with the same name, description, and instructions.`);
        forms.push({ engine, id: a.id, frontmatter: front, body: a.body });
        break;
      }
      case 'codex': {
        // The blank line that follows a frontmatter block is not part of the instructions.
        const text = a.body.replace(/^\n+/, '');
        let instructions = text;
        if (a.tools !== undefined) {
          const listed = a.tools.length ? a.tools.join(', ') : 'none';
          instructions = `${text.endsWith('\n') ? text : `${text}\n`}\nTool limit (advisory; Codex does not enforce it): use only these tool classes: ${listed}.\n`;
          out.line(a.id, 'weakened', 'Codex has feature switches and no per-tool list, so it cannot enforce the tool limit. With a recorded override, the limit is added to developer_instructions as advisory text, which Codex does not enforce.', 'tools');
        }
        const table: [string, JsonValue][] = [['name', a.name], ['description', a.description], ['developer_instructions', instructions]];
        if (a.model?.codex !== undefined) table.push(['model', a.model.codex]);
        modelLine();
        if (a.skills !== undefined) out.line(a.id, 'translated', 'Codex has no skill list per subagent. The skills stay discoverable but are not preloaded.', 'skills');
        const { dropped } = addPrivate(table, a.privateBlocks.codex, true);
        privateLine(out, a.id, dropped, 'TOML');
        out.line(a.id, 'translated', `Codex reads the subagent from .codex/agents/${a.id}.toml: the body becomes developer_instructions. Codex cannot set the sandbox mode, the approval policy, or MCP servers per subagent.`);
        forms.push({ engine, id: a.id, table });
        break;
      }
      case 'opencode': {
        const front: [string, JsonValue | (readonly [string, string])[]][] = [['description', a.description], ['mode', 'subagent']];
        if (a.model?.opencode !== undefined) front.push(['model', a.model.opencode]);
        modelLine();
        if (a.tools !== undefined) {
          const outside = CLASSES.filter(c => !a.tools!.includes(c));
          const keys = [...new Set(outside.flatMap(c => OPENCODE_TOOL_KEYS[c]!))];
          const listed = servers(a.tools);
          const deny: [string, string][] = keys.map(k => [k, 'deny']);
          if (listed.length === 0) deny.push(['*_*', 'deny']);
          else for (const s of (context.servers ?? []).filter(s => !listed.includes(s))) deny.push([`${s}_*`, 'deny']);
          front.push(['permission', deny]);
          const shared = a.tools.includes('edit') !== a.tools.includes('write') ? ' OpenCode has one edit key for edits and writes, so it is denied: the subagent gets less than the limit.' : '';
          const why = `OpenCode carries the limit as deny keys of the agent's permission: ${deny.map(([k]) => k).join(', ') || 'none'}. Tool names differ from the neutral classes, and no key allows anything.${shared} Tools that plugins add are not covered.`;
          if (listed.length) out.line(a.id, 'weakened', `${why} The limit names MCP servers, so only the other servers of the definition are denied; a server outside the definition keeps its tools.`, 'tools');
          else out.line(a.id, 'translated', `${why} Every MCP tool is denied with *_*.`, 'tools');
        }
        if (a.skills !== undefined) out.line(a.id, 'translated', 'OpenCode documents no skill list per agent. The skills stay discoverable but are not preloaded.', 'skills');
        const { dropped } = addPrivate(front as [string, JsonValue][], a.privateBlocks.opencode);
        privateLine(out, a.id, dropped, 'the frontmatter');
        out.line(a.id, 'translated', `OpenCode reads the subagent from .opencode/agents/${a.id}.md: the file name is the name, and mode is subagent.`);
        forms.push({ engine, id: a.id, frontmatter: front, body: a.body });
        break;
      }
      case 'pi':
        out.line(a.id, 'absent', 'Pi has no subagents in core; only an example extension reads agent files. Bowerloom writes none.');
        break;
      case 'deepseek-harness':
        out.line(a.id, 'absent', 'DeepSeek Harness has no subagent files: child setups are presets written as plugin rows. Bowerloom writes none in 0.8.');
        break;
    }
  }
  return { engine, subagents: forms, lines: out.lines, problems: out.problems };
}
