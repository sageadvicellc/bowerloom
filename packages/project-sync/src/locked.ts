/**
 * The locked-in writers of Bowerloom 0.8, step 3 (locked-in parts spec, sections 5 to 8 and 12). They plan the files of
 * MCP servers, subagents, hooks, guardrails, and the sandbox for each engine, inside the plan of the portable projection:
 * the same approval revision, receipt, journal, removal, and recovery. This module reads only.
 *
 * - Guardrails and the sandbox take the engine form and the loss lines of the fidelity package as they are. A line
 *   changes only where the writer cannot carry what the line claims: a Codex MCP rule for a server the projection does
 *   not write, and a DeepSeek Harness sandbox requirement (see `dshSandbox`).
 * - A file a person keeps (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, `.codex/hooks.json`,
 *   `opencode.json`, `.pi/mcp.json`) gets entries added by text insertion. Every other byte stays. The base of the
 *   insertion is the file as it was before Bowerloom first wrote it, so a second projection gives the same bytes.
 * - A file Bowerloom owns whole is rendered. A subagent file that a person made is never overwritten.
 */
import {
  envDefaultIn, translateGuardrails, translateHooks, translateMcp, translateSubagents, type CodexForm, type HookForm,
  type McpServerForm, type OpenCodeForm, type SubagentForm,
} from '../../fidelity/src/index.js';
import type { ClaudeCodeForm } from '../../fidelity/src/index.js';
import { entryHash } from '../../harness-definition/src/index.js';
import type { Definition, EngineId, EngineView, LossLine } from '../../harness-definition/src/index.js';
import { readProject, refuse, stateOrUnsafe } from './portable-files.js';
import { blob } from './portable-state.js';
import type { PortableEngine, ReceiptFile } from './portable-state.js';
import {
  Ordered, editJson, editToml, frontmatter, tomlLines, yamlBlock, type EditResult, type JsonOp, type Out, type TomlTable, type YamlOut,
} from './locked-text.js';

/** The engine versions Bowerloom writes locked-in parts for (checks 6 and 13). Any other recorded version is refused. */
export const PINNED_VERSIONS: Readonly<Partial<Record<EngineId, readonly string[]>>> = Object.freeze({
  opencode: Object.freeze(['1.18.30']),
  'deepseek-harness': Object.freeze(['0.2.2-alpha.2', 'dsh-v0.2.2-alpha.2']),
});
/** The Codex permission profile Bowerloom writes, and the built-in profile it extends. */
export const CODEX_PROFILE = 'bowerloom';
export const CODEX_PROFILE_BASE = ':workspace';
/** The DeepSeek Harness patch file Bowerloom owns. The person passes it with `--patch`. */
export const DSH_PATCH = '.dsh/bowerloom.patch.yml';
export const OPENCODE_PLUGIN = '.opencode/plugins/bowerloom-hooks.js';

export type LockedPart = 'subagents' | 'guardrails' | 'hooks' | 'mcp';
export const LOCKED_PARTS: readonly LockedPart[] = Object.freeze(['subagents', 'guardrails', 'hooks', 'mcp']);

/** Whether an engine loads a written file now, or only after a person's trust step (checks 8 and 14). */
export interface TrustLine {
  readonly engine: EngineId;
  readonly path: string;
  /** Set for a line about one entry, such as one Codex hook. */
  readonly part?: LockedPart;
  readonly entry?: string;
  readonly state: 'pending trust' | 'trusted';
  readonly reason: string;
}
/** Code the plan shows in full, for a person to read before Bowerloom writes it (decision 3). */
export interface ReviewItem { readonly path: string; readonly engine: EngineId; readonly kind: 'code'; readonly text: string }

/** A person's statement that both Codex trust steps are done: the folder, and each hook by the hash of its entry. */
export interface CodexTrust { readonly folderTrusted: boolean; readonly reviewedHooks: readonly string[] }

export interface LockedContext {
  readonly projectDir: string;
  readonly stateDir: string;
  readonly def: Definition;
  readonly engines: readonly PortableEngine[];
  readonly views: ReadonlyMap<EngineId, EngineView>;
  readonly owned: ReadonlyMap<string, ReceiptFile>;
  readonly piTrustSaved: boolean;
  readonly codexTrust: CodexTrust | null;
}
export interface LockedTarget { readonly bytes: Uint8Array; readonly mode: number; readonly engine: EngineId }
export interface LockedPlan {
  readonly targets: ReadonlyMap<string, LockedTarget>;
  readonly lines: ReadonlyMap<EngineId, ReadonlyMap<LockedPart, readonly LossLine[]>>;
  readonly trust: readonly TrustLine[];
  readonly review: readonly ReviewItem[];
}

const hasLocked = (v: EngineView): boolean => v.subagents.length + v.rules.length + v.sandbox.length + v.hooks.length + v.mcp.length > 0;

/**
 * Checks 6 and 13: a recorded version other than the pinned one is refused, for every projection to that engine. With
 * no recorded version, an engine that gets locked-in parts is refused too: the writer cannot know the shape.
 */
export function checkVersions(engines: readonly PortableEngine[], views: ReadonlyMap<EngineId, EngineView>): void {
  const bad: string[] = [];
  for (const e of engines) {
    const pinned = PINNED_VERSIONS[e.id];
    if (pinned === undefined) continue;
    if (e.version !== null ? !pinned.includes(e.version) : hasLocked(views.get(e.id)!)) bad.push(`${e.id} ${e.version ?? '(not recorded)'}`);
  }
  if (bad.length) refuse('PORTABLE_ENGINE_VERSION', bad);
}

/** The text of a file the projection adds entries to: as it was before Bowerloom first wrote it, or as it is now. */
function baseText(ctx: LockedContext, path: string): string | null {
  const mine = ctx.owned.get(path);
  const bytes = mine ? (mine.original ? blob(ctx.stateDir, mine.original, path) : null) : readProject(ctx.projectDir, path)?.bytes ?? null;
  if (bytes === null) return null;
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) refuse('PORTABLE_TARGET_INVALID', [path]);
  return text;
}

/** Plans the locked-in files of every engine. Refuses with a coded PortableRefusal. */
export function planLocked(ctx: LockedContext): LockedPlan {
  checkVersions(ctx.engines, ctx.views);
  const targets = new Map<string, LockedTarget>();
  const lines = new Map<EngineId, Map<LockedPart, LossLine[]>>();
  const trust: TrustLine[] = [], review: ReviewItem[] = [];
  const conflicts: string[] = [], invalid: string[] = [], envDefaults: string[] = [], occupied: string[] = [], orderUnsafe: string[] = [];

  const text = (path: string, value: string, engine: EngineId): void => { targets.set(path, { bytes: Buffer.from(value), mode: 0o644, engine }); };
  const merged = (path: string, result: EditResult, engine: EngineId): void => {
    if (result.ok) text(path, result.text, engine);
    else if (result.reason === 'invalid') invalid.push(path);
    else conflicts.push(...result.at.map(k => `${path}: ${k}`));
  };
  /** A subagent file: never written over a file that a person made. */
  const agentFile = (path: string, value: string, engine: EngineId): void => {
    const now = stateOrUnsafe(ctx.projectDir, path);
    if (now !== null && now !== 'unsafe' && !ctx.owned.has(path)) occupied.push(path);
    text(path, value, engine);
  };
  const json = (path: string, ops: readonly JsonOp[], engine: EngineId): void => { if (ops.length) merged(path, editJson(baseText(ctx, path), ops), engine); };

  for (const { id: engine } of ctx.engines) {
    const view = ctx.views.get(engine)!;
    const g = translateGuardrails(engine, { rules: view.rules, sandbox: view.sandbox });
    const m = translateMcp(engine, view.mcp);
    const s = translateSubagents(engine, view.subagents, { servers: view.mcp.map(x => x.name) });
    const h = translateHooks(engine, view.hooks);
    for (const p of [...m.problems, ...s.problems, ...h.problems]) envDefaults.push(`${p.part}/${p.entry}`);
    for (const r of view.rules) if (envDefaultIn(r.pattern)) envDefaults.push(`guardrails/${r.id}`);
    const guardLines = g.lines.map(l => ({ ...l }));
    const setLine = (entry: string, result: LossLine['result'], reason: string): void => {
      for (const [i, l] of guardLines.entries()) if (l.entry === entry) guardLines[i] = { ...l, result, reason };
    };

    switch (engine) {
      case 'claude-code': {
        const form = g.form as ClaudeCodeForm;
        json('.mcp.json', m.servers.length ? [{ kind: 'members', path: ['mcpServers'], members: m.servers.map(f => [f.name, objectOf(f)]) }] : [], engine);
        const ops: JsonOp[] = [];
        for (const effect of ['allow', 'ask', 'deny'] as const) if (form.permissions[effect].length) ops.push({ kind: 'items', path: ['permissions', effect], items: [...form.permissions[effect]] });
        if (form.sandbox) ops.push({ kind: 'members', path: ['sandbox'], members: [['enabled', true]] });
        ops.push(...hookOps(h.hooks));
        json('.claude/settings.json', ops, engine);
        for (const a of s.subagents) agentFile(`.claude/agents/${a.id}.md`, renderAgent(a), engine);
        break;
      }
      case 'codex': {
        const form = g.form as CodexForm;
        const tables: TomlTable[] = [];
        const servers = new Map(m.servers.map(f => [f.name, [...(f as Extract<McpServerForm, { engine: 'codex' }>).table] as [string, Out][]]));
        for (const d of form.mcpDisabled) {
          const table = servers.get(d.server);
          if (!table) {
            for (const w of g.written.filter(x => x.where === `mcp_servers.${d.server}`)) {
              setLine(w.source, 'weakened', `Codex disables an MCP tool only in the server's own entry, and this projection writes no Codex entry for ${d.server}, so there is nothing to disable. A server of that name in the person's own Codex configuration is not covered.`);
            }
            continue;
          }
          if (d.tool === undefined) { const at = table.findIndex(([k]) => k === 'enabled'); if (at >= 0) table[at] = ['enabled', false]; else table.push(['enabled', false]); continue; }
          const at = table.findIndex(([k]) => k === 'disabled_tools');
          const list = at >= 0 ? [...(table[at]![1] as string[])] : [];
          if (!list.includes(d.tool)) list.push(d.tool);
          if (at >= 0) table[at] = ['disabled_tools', list]; else table.push(['disabled_tools', list]);
        }
        for (const [name, entries] of servers) tables.push({ path: ['mcp_servers', name], entries });
        const root: [string, Out][] = [];
        const forbid: string[] = [];
        if (form.filesystem.length || form.sandbox) {
          root.push(['default_permissions', CODEX_PROFILE]);
          forbid.push('sandbox_mode');
          tables.push({ path: ['permissions', CODEX_PROFILE], entries: [['extends', CODEX_PROFILE_BASE]] });
          if (form.filesystem.length) tables.push({ path: ['permissions', CODEX_PROFILE, 'filesystem', ':workspace_roots'], entries: filesystemEntries(form.filesystem) });
        }
        if (root.length || tables.length) merged('.codex/config.toml', editToml(baseText(ctx, '.codex/config.toml'), root, tables, forbid), engine);
        if (form.prefixRules.length) text('.codex/rules/bowerloom.rules', renderRules(form), engine);
        json('.codex/hooks.json', hookOps(h.hooks), engine);
        for (const a of s.subagents) agentFile(`.codex/agents/${a.id}.toml`, tomlLines((a as Extract<SubagentForm, { engine: 'codex' }>).table), engine);
        const folder = ctx.codexTrust?.folderTrusted === true;
        for (const path of ['.codex/config.toml', '.codex/rules/bowerloom.rules']) {
          if (targets.has(path)) trust.push({ engine, path, state: folder ? 'trusted' : 'pending trust', reason: folder ? 'A person says the project .codex folder is trusted.' : 'Codex reads the project .codex folder only after a person trusts the project.' });
        }
        for (const hook of h.hooks) {
          // The hash is of the definition's entry, as an approval's is: a change to any field, or to any private block, voids the review.
          const reviewed = folder && (ctx.codexTrust?.reviewedHooks ?? []).includes(entryHash(ctx.def.entries.hooks.find(x => x.id === hook.entry)!));
          trust.push({ engine, path: '.codex/hooks.json', part: 'hooks', entry: hook.entry, state: reviewed ? 'trusted' : 'pending trust', reason: reviewed ? 'A person says the folder is trusted and this version of the hook is reviewed.' : 'Codex runs a project hook only after a person trusts the .codex folder and reviews the hook by its hash. A changed hook needs a new review.' });
        }
        break;
      }
      case 'opencode': {
        const form = g.form as OpenCodeForm;
        const ops: JsonOp[] = [];
        if (m.servers.length) ops.push({ kind: 'members', path: ['mcp'], members: m.servers.map(f => [f.name, objectOf(f)]) });
        if (view.rules.length) {
          for (const k of form.permission) for (const word of [k.key, ...k.rules.map(r => r.pattern)]) if (/^(?:0|[1-9][0-9]{0,9})$/.test(word) && Number(word) < 2 ** 32 - 1) orderUnsafe.push(`${k.key} ${word}`);
          ops.push({ kind: 'members', path: [], members: [['permission', new Ordered(form.permission.map(k => [k.key, new Ordered(k.rules.map(r => [r.pattern, r.action]))]))]] });
        }
        if (ops.length && !ctx.owned.has('opencode.json') && stateOrUnsafe(ctx.projectDir, 'opencode.jsonc') !== null) conflicts.push('opencode.jsonc: the project keeps its OpenCode settings in opencode.jsonc');
        json('opencode.json', ops, engine);
        for (const a of s.subagents) agentFile(`.opencode/agents/${a.id}.md`, renderAgent(a), engine);
        if (h.hooks.length) {
          const code = renderPlugin(h.hooks.filter((x): x is Extract<HookForm, { engine: 'opencode' }> => x.engine === 'opencode'));
          text(OPENCODE_PLUGIN, code, engine);
          review.push({ path: OPENCODE_PLUGIN, engine, kind: 'code', text: code });
        }
        break;
      }
      case 'pi': {
        json('.pi/mcp.json', m.servers.length ? [{ kind: 'members', path: ['mcpServers'], members: m.servers.map(f => [f.name, objectOf(f)]) }] : [], engine);
        if (targets.has('.pi/mcp.json')) trust.push({ engine, path: '.pi/mcp.json', state: ctx.piTrustSaved ? 'trusted' : 'pending trust', reason: ctx.piTrustSaved ? 'A person saved trust for this project in Pi.' : 'Pi skips files under .pi/ in non-interactive runs until a person saves trust for the project.' });
        break;
      }
      case 'deepseek-harness': {
        if (m.servers.length) text(DSH_PATCH, renderPatch(m.servers), engine);
        for (const box of view.sandbox) setLine(box.id, 'absent', dshSandbox());
        break;
      }
    }

    // A private block of a guardrail entry has no place in a permission rule list: the line says so.
    const note = (entry: string): string => {
      const kept = g.privateBlocks[entry] !== undefined ? ` The x-${engine} block has no place in the ${engine} permission rules and is not written.` : '';
      const left = g.excludedPrivateBlocks.find(x => x.entry === entry);
      return kept + (left ? ` ${left.reason}` : '');
    };
    // Once a person saved trust in Pi, a Pi line no longer says the file is pending trust.
    const mcpLines = engine === 'pi' && ctx.piTrustSaved ? m.lines.map(l => ({ ...l, reason: l.reason.replace(/ Pending trust: [^.]*\./, ' A person saved trust for this project, so Pi loads it.') })) : [...m.lines];
    const byPart = new Map<LockedPart, LossLine[]>([
      ['guardrails', guardLines.map(l => ({ ...l, reason: l.reason + note(l.entry) }))], ['mcp', mcpLines], ['subagents', [...s.lines]], ['hooks', [...h.lines]],
    ]);
    lines.set(engine, byPart);
  }
  if (envDefaults.length) refuse('PORTABLE_ENV_DEFAULT', [...new Set(envDefaults)]);
  if (orderUnsafe.length) refuse('PORTABLE_ORDER_UNSAFE', orderUnsafe);
  if (invalid.length) refuse('PORTABLE_TARGET_INVALID', invalid);
  if (conflicts.length) refuse('PORTABLE_CONFLICT', conflicts);
  if (occupied.length) refuse('PORTABLE_PATH_OCCUPIED', occupied);
  trust.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.entry ?? '') < (b.entry ?? '') ? -1 : 1));
  return { targets, lines, trust, review };
}

/** Why a DeepSeek Harness sandbox requirement is absent. Read from the pinned tag on 2026-10-28. */
export function dshSandbox(): string {
  return 'DeepSeek Harness has sandbox modes, but at the pinned tag a mode governs file effects only: network is outside its vocabulary. '
    + 'A mode is a session default that a person can switch with /permission, and an approved retry can run outside it. '
    + 'Bowerloom has no confirmed patch row that sets the mode at that tag, so it writes nothing, and the requirement is absent.';
}

const objectOf = (f: McpServerForm): Out => ('value' in f ? f.value : null) as Out;

/** One hook group per hook: the hooks shape of Claude Code and Codex. */
function hookOps(hooks: readonly HookForm[]): JsonOp[] {
  return hooks.filter((x): x is Extract<HookForm, { engine: 'claude-code' | 'codex' }> => x.engine !== 'opencode').map(x => ({
    kind: 'items' as const, path: ['hooks', x.event],
    items: [new Ordered([...(x.matcher !== undefined ? [['matcher', x.matcher] as const] : []), ['hooks', [new Ordered(Object.entries(x.handler))]]])],
  }));
}

/** Codex lets one path hold one access: the strictest one wins when two rules name a path. */
function filesystemEntries(entries: CodexForm['filesystem']): [string, Out][] {
  const rank = { deny: 0, read: 1, write: 2 } as const;
  const best = new Map<string, keyof typeof rank>();
  for (const e of entries) { const had = best.get(e.path); if (had === undefined || rank[e.access] < rank[had]) best.set(e.path, e.access); }
  return [...best].map(([p, a]) => [p, a]);
}

function renderRules(form: CodexForm): string {
  const head = '# Bowerloom writes this file from the guardrails of a harness definition. Removal restores what was here before.\n'
    + '# A neutral allow never becomes a Codex allow rule: Codex would run the command outside the sandbox without asking.\n';
  return head + form.prefixRules.map(r => `\nprefix_rule(\n    pattern = [${r.pattern.map(t => JSON.stringify(t)).join(', ')}],\n    decision = ${JSON.stringify(r.decision)},\n    justification = ${JSON.stringify(r.justification ?? 'Bowerloom guardrail')},\n)\n`).join('');
}

function renderAgent(a: SubagentForm): string {
  if (a.engine === 'codex') return tomlLines(a.table);
  return frontmatter(a.frontmatter, a.body);
}

function renderPatch(servers: readonly McpServerForm[]): string {
  const rows = servers.filter((f): f is Extract<McpServerForm, { engine: 'deepseek-harness' }> => f.engine === 'deepseek-harness');
  const head = `# Bowerloom writes this file from the MCP servers of a harness definition. Pass it to DeepSeek Harness with\n# dsh web --patch ${DSH_PATCH}\n# Bowerloom never edits cordis.patch.yml. Removal restores what was here before.\n- insert:\n`;
  return head + rows.map(f => `    - id: ${JSON.stringify(f.row.id)}\n      name: ${JSON.stringify(f.row.name)}\n      config:\n${yamlBlock(f.row.config as { readonly [key: string]: YamlOut }, 8)}`).join('');
}

/**
 * The OpenCode plugin (decision 3). It runs each command with the hook input as JSON on standard input, as Claude Code
 * does, and throws on exit 2 or a deny decision. It runs commands through the `$` shell of the OpenCode plugin context,
 * so it loads no module of its own. The plan shows it in full: a person reads it before Bowerloom writes it.
 */
export function renderPlugin(hooks: readonly Extract<HookForm, { engine: 'opencode' }>[]): string {
  const data = JSON.stringify(hooks.map(h => ({ entry: h.entry, event: h.event, tools: h.tools, command: h.command, timeoutMs: h.timeoutMs })), null, 2);
  const events = new Set(hooks.map(h => h.event));
  const handlers: string[] = [];
  if (events.has('PreToolUse')) handlers.push('    "tool.execute.before": async (input, output) => { await runTool($, "PreToolUse", input, output, directory); },');
  if (events.has('PostToolUse')) handlers.push('    "tool.execute.after": async (input, output) => { await runTool($, "PostToolUse", input, output, directory); },');
  if (events.has('PreCompact')) handlers.push('    "experimental.session.compacting": async () => { await runEvent($, "PreCompact", directory); },');
  if (events.has('SessionStart') || events.has('PostCompact')) {
    handlers.push('    event: async ({ event }) => {', '      if (event?.type === "session.created") await runEvent($, "SessionStart", directory);', '      if (event?.type === "session.compacted") await runEvent($, "PostCompact", directory);', '    },');
  }
  return `// Bowerloom generated this OpenCode plugin from the hooks of a harness definition. Read it before you approve the plan:
// OpenCode loads every file in .opencode/plugins and runs it with your permissions. Removal restores what was here before.
// Each hook runs its command with /bin/sh through the $ shell of the plugin context, with the hook input as JSON on
// standard input. Exit 2, or a deny decision on standard output, blocks the tool call: the plugin throws with the
// reason. Any other exit lets the call continue. A hook that runs past its timeout lets the call continue too; the
// plugin stops waiting for it but does not stop the command.

const HOOKS = ${data};

function payload(event, tool, args, sessionID, directory) {
  return JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: args ?? {}, session_id: sessionID ?? null, cwd: directory });
}

async function run($, hook, input, directory) {
  const shell = $\`/bin/sh -c \${hook.command} < \${new Response(input)}\`.env({ ...process.env, BOWERLOOM_PROJECT_DIR: directory }).quiet().nothrow();
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), hook.timeoutMs); });
  try {
    const result = await Promise.race([shell, late]);
    if (result === null) return { status: null, stdout: "", stderr: "" };
    return { status: result.exitCode, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } finally { clearTimeout(timer); }
}

function denial(result) {
  if (result.status === 2) return result.stderr.trim() || "A Bowerloom hook blocked this action.";
  let out = null;
  try { out = JSON.parse(result.stdout || "null"); } catch { out = null; }
  const decision = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (decision === "deny" || decision === "block") return out?.hookSpecificOutput?.permissionDecisionReason ?? out?.reason ?? "A Bowerloom hook blocked this action.";
  return null;
}

async function runTool($, event, input, output, directory) {
  for (const hook of HOOKS) {
    if (hook.event !== event) continue;
    const name = hook.tools === null ? input?.tool : hook.tools[input?.tool];
    if (typeof name !== "string") continue;
    const reason = denial(await run($, hook, payload(event, name, output?.args, input?.sessionID, directory), directory));
    if (reason !== null) throw new Error(reason);
  }
}

async function runEvent($, event, directory) {
  for (const hook of HOOKS) if (hook.event === event) await run($, hook, payload(event, null, null, null, directory), directory);
}

export const BowerloomHooks = async ({ directory, $ }) => {
  return {
${handlers.join('\n')}
  };
};
`;
}
