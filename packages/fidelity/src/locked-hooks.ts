/**
 * Command hooks (locked-in parts spec, section 7 and section 8.4; decision 3; checks 7, 8, and 12). Forms in memory.
 *
 * The neutral hook names a Claude Code event and a matcher of Claude Code tool names joined by `|`; no matcher, or `*`,
 * means every tool. A matcher is written only with letters, digits, `_`, and `|` (section 8.4 rule 2), because Codex
 * reads any other character as an unanchored regular expression: any other matcher is `absent` everywhere.
 *
 * - Claude Code: `hooks` in `.claude/settings.json`, `exact`. `${PROJECT_DIR}` becomes `${CLAUDE_PROJECT_DIR}`.
 * - Codex: `.codex/hooks.json` with the eleven shared events plus `Interrupt`, and Codex tool names. `translated` when
 *   advisory. An enforced hook is `weakened`: Codex calls tool hooks a useful guardrail and not a complete boundary,
 *   hosted tools get no hook, and a failed hook lets the call continue. `${PROJECT_DIR}` becomes
 *   `$(git rev-parse --show-toplevel)`. The hook stays `pending trust` until a person trusts the folder and reviews it.
 * - OpenCode: a generated plugin that runs the command and throws on exit 2 or a `deny` decision, `translated`. Only tool
 *   before and after, session start, and compaction have a counterpart. The plugin is code a person reads first.
 * - Pi and DeepSeek Harness: no hook files in 0.8 (lead ruling for section 13.2). Every hook is `absent`, so an enforced
 *   one is refused unless a recorded override exists.
 */
import type { EngineId, HookEntry, JsonValue, LossLine } from '../../harness-definition/src/index.js';
import { Lines, holdsEnvDefault, type LockedProblem } from './locked-common.js';

/** The Claude Code 2.1.310 hook events, from the locked-in research notes. */
export const CLAUDE_CODE_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest', 'PermissionDenied', 'PostToolUse',
  'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'Stop',
  'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'Elicitation', 'ElicitationResult', 'SessionEnd',
]);
/** The Codex 0.157.0 hook events: the eleven shared with Claude Code, and `Interrupt`. */
export const CODEX_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SessionStart', 'SessionEnd', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'UserPromptSubmit', 'SubagentStart',
  'SubagentStop', 'Stop', 'Interrupt',
]);
/** The OpenCode 1.18.30 plugin hook or event for each neutral event that has one. */
export const OPENCODE_HOOK_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  PreToolUse: 'tool.execute.before', PostToolUse: 'tool.execute.after', SessionStart: 'session.created',
  PreCompact: 'experimental.session.compacting', PostCompact: 'session.compacted',
});
/** Events whose matcher names tools. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

/** Codex and OpenCode names for each Claude Code tool name (section 8.4). Null: no counterpart. */
const TOOL_NAMES: Readonly<Record<string, { readonly codex: readonly string[] | null; readonly opencode: readonly string[] | null }>> = Object.freeze({
  Bash: { codex: ['Bash', 'exec_command'], opencode: ['bash'] },
  Read: { codex: null, opencode: ['read'] },
  Grep: { codex: null, opencode: ['grep'] },
  Glob: { codex: null, opencode: ['glob'] },
  LS: { codex: null, opencode: ['list'] },
  Edit: { codex: ['apply_patch'], opencode: ['edit'] },
  MultiEdit: { codex: ['apply_patch'], opencode: ['edit'] },
  Write: { codex: ['apply_patch'], opencode: ['write'] },
  NotebookEdit: { codex: ['apply_patch'], opencode: null },
  WebFetch: { codex: null, opencode: ['webfetch'] },
  WebSearch: { codex: null, opencode: ['websearch'] },
  Agent: { codex: ['spawn_agent'], opencode: ['task'] },
  Task: { codex: ['spawn_agent'], opencode: ['task'] },
  Skill: { codex: null, opencode: ['skill'] },
});
const MCP_TOOL = /^mcp__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)__([A-Za-z0-9_]+)$/;
function counterpart(name: string, engine: 'codex' | 'opencode'): readonly string[] | null {
  const mcp = MCP_TOOL.exec(name);
  if (mcp) return engine === 'codex' ? [name] : [`${mcp[1]}_${mcp[2]}`];
  return TOOL_NAMES[name]?.[engine] ?? null;
}

/** The neutral path variable of a hook command, and what each engine reads instead. */
export const PROJECT_DIR = '${PROJECT_DIR}';
export const PROJECT_DIR_FORMS: Readonly<Record<'claude-code' | 'codex' | 'opencode', string>> = Object.freeze({
  'claude-code': '${CLAUDE_PROJECT_DIR}', codex: '$(git rev-parse --show-toplevel)', opencode: '${BOWERLOOM_PROJECT_DIR}',
});
/** Claude Code and Codex run a hook for 600 seconds when no timeout is set; the OpenCode plugin uses the same. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600_000;

export type HookForm =
  | { readonly engine: 'claude-code' | 'codex'; readonly entry: string; readonly event: string; readonly matcher?: string; readonly handler: { readonly [key: string]: JsonValue } }
  | {
    readonly engine: 'opencode'; readonly entry: string; readonly event: string; readonly hook: string;
    /** OpenCode tool name to Claude Code tool name; null: every tool. */
    readonly tools: { readonly [name: string]: string } | null;
    readonly command: string; readonly timeoutMs: number; readonly enforced: boolean;
  };

export interface HookTranslation {
  readonly engine: EngineId;
  readonly hooks: readonly HookForm[];
  readonly lines: readonly LossLine[];
  readonly problems: readonly LockedProblem[];
}

const rewrite = (command: string, engine: keyof typeof PROJECT_DIR_FORMS): string => command.split(PROJECT_DIR).join(PROJECT_DIR_FORMS[engine]);

/** The matcher as a list of names, or null for every tool. Undefined when it is outside the written alphabet. */
function names(matcher: string | undefined): readonly string[] | null | undefined {
  if (matcher === undefined || matcher === '*' || matcher === '') return null;
  if (!/^[A-Za-z0-9_]+(?:\|[A-Za-z0-9_]+)*$/.test(matcher)) return undefined;
  return [...new Set(matcher.split('|'))];
}

/** The private block note of a hook. A hook line holds the strength of the hook, so the note is part of its reason. */
function privateNote(h: HookEntry, engine: EngineId, handler: [string, JsonValue][] | null): string {
  const block = h.privateBlocks[engine];
  if (block === undefined) return '';
  if (handler === null || block === null || typeof block !== 'object' || Array.isArray(block)) return ` The x-${engine} block has no place in the ${engine} form and is not written.`;
  const taken = new Set(handler.map(([k]) => k)), dropped: string[] = [];
  for (const [k, v] of Object.entries(block as Record<string, JsonValue>)) { if (taken.has(k)) dropped.push(k); else handler.push([k, v]); }
  return dropped.length ? ` The x-${engine} block names keys Bowerloom writes itself, so these are not written: ${dropped.join(', ')}.` : '';
}

export function translateHooks(engine: EngineId, hooks: readonly HookEntry[]): HookTranslation {
  const out = new Lines('hooks', engine);
  const forms: HookForm[] = [];
  for (const h of hooks) {
    if (holdsEnvDefault(h)) { out.envDefault(h.id); continue; }
    if (engine === 'pi') { out.line(h.id, 'absent', 'Pi has no declarative hook file: hooks are TypeScript extensions, and Bowerloom generates none in 0.8.'); continue; }
    if (engine === 'deepseek-harness') { out.line(h.id, 'absent', 'DeepSeek Harness runs hooks only through an experimental bridge that a person mounts as a plugin row. Bowerloom writes no hook files for it in 0.8.'); continue; }
    const list = names(h.matcher);
    if (list === undefined) { out.line(h.id, 'absent', 'The matcher holds a character other than a letter, a digit, _, or |. Codex reads such a matcher as an unanchored regular expression and Claude Code may too, so Bowerloom writes no hook for it.'); continue; }
    const toolEvent = TOOL_EVENTS.has(h.event);
    const seconds = h.timeout === undefined ? undefined : Math.ceil(h.timeout / 1000);
    const rounded = h.timeout !== undefined && h.timeout % 1000 !== 0 ? ` The timeout of ${h.timeout} ms is rounded up to ${seconds} seconds.` : '';
    switch (engine) {
      case 'claude-code': {
        if (!CLAUDE_CODE_HOOK_EVENTS.has(h.event)) { out.line(h.id, 'absent', `Claude Code has no ${h.event} event.`); break; }
        const handler: [string, JsonValue][] = [['type', 'command'], ['command', rewrite(h.command, engine)]];
        if (seconds !== undefined) handler.push(['timeout', seconds]);
        const note = privateNote(h, engine, handler);
        out.line(h.id, rounded || note ? 'translated' : 'exact', `Claude Code runs the command on ${h.event} from .claude/settings.json; \${PROJECT_DIR} becomes \${CLAUDE_PROJECT_DIR}.${rounded}${note}`);
        forms.push({ engine, entry: h.id, event: h.event, ...(list ? { matcher: list.join('|') } : {}), handler: Object.fromEntries(handler) });
        break;
      }
      case 'codex': {
        if (!CODEX_HOOK_EVENTS.has(h.event)) { out.line(h.id, 'absent', `Codex has no ${h.event} event, and Bowerloom does not emulate one.`); break; }
        let matcher: string | undefined;
        const missing: string[] = [];
        if (list) {
          if (toolEvent) {
            const mapped = [...new Set(list.flatMap(n => { const c = counterpart(n, 'codex'); if (c === null) missing.push(n); return c ?? []; }))];
            if (mapped.length === 0) { out.line(h.id, 'absent', `Codex has no hook tool name for ${list.join(', ')}, so the hook would never run.`); break; }
            matcher = mapped.join('|');
          } else matcher = list.join('|');
        }
        const handler: [string, JsonValue][] = [['type', 'command'], ['command', rewrite(h.command, engine)]];
        if (seconds !== undefined) handler.push(['timeout', seconds]);
        const note = privateNote(h, engine, handler);
        const gap = missing.length ? ` Codex has no hook tool name for ${missing.join(', ')}, so the hook does not run for those tools.` : '';
        const base = `Codex runs the command on ${h.event} from .codex/hooks.json${matcher ? ` for ${matcher}` : ''}; \${PROJECT_DIR} becomes $(git rev-parse --show-toplevel), because Codex can start in a subfolder.${gap}${rounded}${note} Pending trust: Codex runs it only after a person trusts the project .codex folder and reviews the hook by its hash.`;
        if (h.strength === 'enforced') out.line(h.id, 'weakened', `${base} Codex calls tool hooks a useful guardrail and not a complete boundary: hosted tools such as web search get no hook, and a hook that fails lets the call continue, so the hook cannot fail closed.`);
        else out.line(h.id, missing.length ? 'weakened' : 'translated', base);
        forms.push({ engine, entry: h.id, event: h.event, ...(matcher ? { matcher } : {}), handler: Object.fromEntries(handler) });
        break;
      }
      case 'opencode': {
        const hook = OPENCODE_HOOK_EVENTS[h.event];
        if (hook === undefined) { out.line(h.id, 'absent', `OpenCode has no counterpart of ${h.event}. Its documentation describes no hook that blocks a prompt or continues a stop.`); break; }
        let tools: Record<string, string> | null = null;
        const missing: string[] = [];
        if (list && toolEvent) {
          tools = {};
          for (const n of list) { const c = counterpart(n, 'opencode'); if (c === null) missing.push(n); else for (const x of c) tools[x] = n; }
          if (Object.keys(tools).length === 0) { out.line(h.id, 'absent', `OpenCode has no tool name for ${list.join(', ')}, so the hook would never run.`); break; }
        }
        const ignored = list && !toolEvent ? ` OpenCode's ${hook} has no matcher, so the plugin runs the hook for every ${hook} and ignores ${list.join('|')}.` : '';
        const gap = missing.length ? ` OpenCode has no tool name for ${missing.join(', ')}, so the hook does not run for those tools.` : '';
        const note = privateNote(h, engine, null);
        out.line(h.id, missing.length ? 'weakened' : 'translated', `OpenCode runs the command from the generated plugin .opencode/plugins/bowerloom-hooks.js on ${hook}. The plugin passes the hook input as JSON on standard input and throws on exit 2 or a deny decision; \${PROJECT_DIR} becomes the project folder of the plugin context. The plugin is code that a person reads in the plan before Bowerloom writes it.${ignored}${gap}${note}`);
        forms.push({ engine, entry: h.id, event: h.event, hook, tools, command: rewrite(h.command, engine), timeoutMs: h.timeout ?? DEFAULT_HOOK_TIMEOUT_MS, enforced: h.strength === 'enforced' });
        break;
      }
    }
  }
  return { engine, hooks: forms, lines: out.lines, problems: out.problems };
}
