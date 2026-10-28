/**
 * The locked-in writers of Bowerloom 0.8, step 3 (locked-in parts spec, sections 5 to 8 and 12). They plan the files of
 * MCP servers, subagents, hooks, guardrails, and the sandbox for each engine, inside the plan of the portable projection:
 * the same approval revision, receipt, journal, removal, and recovery. This module reads only.
 *
 * - Guardrails and the sandbox take the engine form and the loss lines of the fidelity package as they are. A line
 *   changes only where the writer does not carry what the line claims: a Codex MCP rule for a server the projection does
 *   not write, the Codex permission profile while its switch is off (ruling B6), and Claude Code hooks that a person's
 *   settings turn off or put under a permission mode (ruling B11).
 * - A file a person keeps (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, `.codex/hooks.json`,
 *   `opencode.json`, `.pi/mcp.json`) gets entries added by text insertion. Every other byte stays, and so does its mode.
 *   The base of the insertion is the file as it was before Bowerloom first wrote it, so a second projection gives the
 *   same bytes.
 * - A file Bowerloom owns whole is rendered. A file at one of those paths that Bowerloom did not write is never
 *   overwritten.
 */
import {
  JsExpression, openCodeSubstitution, translateGuardrails, translateHooks, translateMcp, translateSubagents, type CodexForm, type HookForm,
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

/**
 * The engine versions Bowerloom writes locked-in parts for. OpenCode and DeepSeek Harness are strict (checks 6 and 13):
 * any other recorded version is refused. Claude Code, Codex, and Pi refuse an older version and note a newer one (B7).
 */
export const PINNED_VERSIONS: Readonly<Partial<Record<EngineId, readonly string[]>>> = Object.freeze({
  opencode: Object.freeze(['1.18.30']),
  'deepseek-harness': Object.freeze(['0.2.2-alpha.2', 'dsh-v0.2.2-alpha.2']),
});
export const CHECKED_VERSIONS: Readonly<Partial<Record<EngineId, string>>> = Object.freeze({ 'claude-code': '2.1.310', codex: '0.157.0', pi: '1.4.0' });
const ENGINE_NAMES: Readonly<Record<EngineId, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi', 'deepseek-harness': 'DeepSeek Harness' };
/**
 * The switch of the Codex permission profile. While it is off, Bowerloom writes no `default_permissions` and no profile,
 * until the live check of step 5 confirms their syntax (ruling B6).
 */
export const CODEX_PROFILE_ENABLED: boolean = false;
/** The Codex permission profile Bowerloom would write, and the built-in profile it would extend. */
export const CODEX_PROFILE = 'bowerloom';
export const CODEX_PROFILE_BASE = ':workspace';
/** The DeepSeek Harness patch file Bowerloom owns. The person passes it with `--patch`. */
export const DSH_PATCH = '.dsh/bowerloom.patch.yml';
export const OPENCODE_PLUGIN = '.opencode/plugins/bowerloom-hooks.js';
export const CODEX_RULES = '.codex/rules/bowerloom.rules';

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
/**
 * What a person reads before Bowerloom writes it (decision 3; ruling B12): a whole file of code, or one command that an
 * engine will run, with the part and entry it comes from. The text of a server command is its program and arguments as
 * JSON, as the engine form writes them.
 */
export interface ReviewItem {
  readonly path: string;
  readonly engine: EngineId;
  readonly kind: 'code' | 'command';
  readonly part?: LockedPart;
  readonly entry?: string;
  readonly text: string;
  /**
   * For a server command: each environment name the server gets, with its value, or null when the value holds a
   * `${NAME}` reference that the engine reads at run time (ruling D7). A value such as NODE_OPTIONS can run code too.
   */
  readonly env?: Readonly<Record<string, string | null>>;
}

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
  /** A sentence about the engine version, added to every line of that engine (rulings B7 and B18). */
  readonly notes: ReadonlyMap<EngineId, string>;
}

const hasLocked = (v: EngineView): boolean => v.subagents.length + v.rules.length + v.sandbox.length + v.hooks.length + v.mcp.length > 0;
/** A semantic version: major, minor, patch, and prerelease identifiers. Build metadata does not count. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/**
 * -1, 0, or 1 by semver precedence (ruling D6): a prerelease comes before its release, so 2.1.310-rc.1 is older than
 * 2.1.310. Null for a version that is not semver.
 */
export function compareVersion(a: string, b: string): number | null {
  const m = SEMVER.exec(a), n = SEMVER.exec(b);
  if (!m || !n) return null;
  for (let i = 1; i <= 3; i++) if (Number(m[i]) !== Number(n[i])) return Number(m[i]) > Number(n[i]) ? 1 : -1;
  if (m[4] === undefined || n[4] === undefined) return m[4] === n[4] ? 0 : m[4] === undefined ? 1 : -1;
  const x = m[4].split('.'), y = n[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]!), ny = /^\d+$/.test(y[i]!);
    if (nx && ny) { if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]) ? 1 : -1; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    if (x[i] !== y[i]) return x[i]! > y[i]! ? 1 : -1;
  }
  return 0;
}

/**
 * The version gate (checks 6 and 13; rulings B7 and B18). It refuses only for an engine that gets locked-in parts.
 * - OpenCode and DeepSeek Harness: a version that is not pinned, or no recorded version, is refused. A projection with
 *   no locked-in parts for that engine proceeds, with a note that names the pinned version.
 * - Claude Code, Codex, and Pi: an older or unreadable version is refused. A newer version, or none recorded, gets a
 *   note that names the version whose file shapes Bowerloom checked.
 */
export function checkVersions(engines: readonly PortableEngine[], views: ReadonlyMap<EngineId, EngineView>): Map<EngineId, string> {
  const bad: string[] = [];
  const notes = new Map<EngineId, string>();
  for (const e of engines) {
    const name = ENGINE_NAMES[e.id], locked = hasLocked(views.get(e.id)!);
    const pinned = PINNED_VERSIONS[e.id];
    if (pinned !== undefined) {
      if (e.version !== null && pinned.includes(e.version)) continue;
      if (locked) bad.push(`${e.id} ${e.version ?? '(not recorded)'}`);
      else if (e.version !== null) notes.set(e.id, ` Bowerloom writes locked-in parts for ${name} ${pinned[0]} only. This projection writes none for ${name}, so the recorded version ${e.version} is not refused.`);
      continue;
    }
    const checked = CHECKED_VERSIONS[e.id];
    if (checked === undefined || !locked) continue;
    if (e.version === null) { notes.set(e.id, ` The ${name} version is not recorded; Bowerloom writes the file shape checked at ${checked}.`); continue; }
    const c = compareVersion(e.version, checked);
    if (c === null || c < 0) bad.push(`${e.id} ${e.version}`);
    else if (c > 0) notes.set(e.id, ` ${name} ${e.version} is newer than the version Bowerloom checked; it writes the file shape checked at ${checked}.`);
  }
  if (bad.length) refuse('PORTABLE_ENGINE_VERSION', bad);
  return notes;
}

/** The text and mode of a file the projection adds entries to: as it was before Bowerloom first wrote it, or as it is now. */
function base(ctx: LockedContext, path: string): { readonly text: string | null; readonly mode: number } {
  const mine = ctx.owned.get(path);
  let bytes: Buffer | null, mode = 0o644;
  if (mine) { bytes = mine.original ? blob(ctx.stateDir, mine.original, path) : null; if (mine.original) mode = mine.original.mode; }
  else { const got = readProject(ctx.projectDir, path); bytes = got?.bytes ?? null; if (got) mode = got.state.mode; }
  if (bytes === null) return { text: null, mode };
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) refuse('PORTABLE_TARGET_INVALID', [path]);
  return { text, mode };
}

const shown = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x instanceof JsExpression ? `!!js ${x.js}` : x));
/** The program and arguments of a server, as an engine form writes them. Null for a server that runs no command. */
function serverCommand(f: McpServerForm): unknown[] | null {
  if (f.engine === 'codex') { const t = Object.fromEntries(f.table); return t.command === undefined ? null : [t.command, ...((t.args as unknown[] | undefined) ?? [])]; }
  if (f.engine === 'deepseek-harness') { const c = f.row.config; return c.command === undefined ? null : [c.command, ...((c.args as unknown[] | undefined) ?? [])]; }
  const v = f.value as Record<string, unknown>;
  if (f.engine === 'opencode') return Array.isArray(v.command) ? v.command : null;
  return v.command === undefined ? null : [v.command, ...((v.args as unknown[] | undefined) ?? [])];
}
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function parsed(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try { const v = JSON.parse(text) as unknown; return isObject(v) ? v : null; } catch { return null; }
}

/** Plans the locked-in files of every engine. Refuses with a coded PortableRefusal. */
export function planLocked(ctx: LockedContext): LockedPlan {
  const notes = checkVersions(ctx.engines, ctx.views);
  const targets = new Map<string, LockedTarget>();
  const lines = new Map<EngineId, Map<LockedPart, LossLine[]>>();
  const trust: TrustLine[] = [], review: ReviewItem[] = [];
  const conflicts: string[] = [], invalid: string[] = [], envDefaults: string[] = [], occupied: string[] = [], orderUnsafe: string[] = [], unsafeValues: string[] = [];

  const put = (path: string, value: string, engine: EngineId, mode = 0o644): void => { targets.set(path, { bytes: Buffer.from(value), mode, engine }); };
  const merged = (path: string, result: EditResult, engine: EngineId, mode: number): void => {
    if (result.ok) put(path, result.text, engine, mode);
    else if (result.reason === 'invalid') invalid.push(path);
    else conflicts.push(...result.at.map(k => `${path}: ${k}`));
  };
  /** A file Bowerloom owns whole: never written over a file that a person made (ruling B20). */
  const owned = (path: string, value: string, engine: EngineId): void => {
    const now = stateOrUnsafe(ctx.projectDir, path);
    if (now !== null && now !== 'unsafe' && !ctx.owned.has(path)) occupied.push(path);
    put(path, value, engine);
  };
  const jsonFile = (path: string, ops: readonly JsonOp[], engine: EngineId): void => {
    if (!ops.length) return;
    const b = base(ctx, path);
    merged(path, editJson(b.text, ops), engine, b.mode);
  };
  const commands = (path: string, engine: EngineId, servers: readonly McpServerForm[]): void => {
    if (!targets.has(path)) return;
    for (const f of servers) {
      const c = serverCommand(f);
      if (!c) continue;
      const source = ctx.views.get(engine)!.mcp.find(x => x.name === f.name)?.env ?? {};
      const env = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, typeof v === 'string' && !/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(v) ? v : null]));
      review.push({ path, engine, kind: 'command', part: 'mcp', entry: f.name, text: shown(c), ...(Object.keys(env).length ? { env } : {}) });
    }
  };
  const hookCommands = (path: string, engine: EngineId, hooks: readonly HookForm[]): void => {
    if (!targets.has(path)) return;
    for (const h of hooks) if (h.engine !== 'opencode') review.push({ path, engine, kind: 'command', part: 'hooks', entry: h.entry, text: String(h.handler.command) });
  };

  for (const { id: engine } of ctx.engines) {
    const view = ctx.views.get(engine)!;
    const g = translateGuardrails(engine, { rules: view.rules, sandbox: view.sandbox });
    const m = translateMcp(engine, view.mcp);
    const s = translateSubagents(engine, view.subagents, { servers: view.mcp.map(x => x.name) });
    const h = translateHooks(engine, view.hooks);
    for (const p of [...m.problems, ...s.problems, ...h.problems]) (p.code === 'ENV_DEFAULT' ? envDefaults : unsafeValues).push(`${p.part}/${p.entry}`);
    const guardLines = g.lines.map(l => ({ ...l }));
    const hookLines = h.lines.map(l => ({ ...l }));
    const setLine = (entry: string, result: LossLine['result'], reason: string): void => {
      for (const [i, l] of guardLines.entries()) if (l.entry === entry) guardLines[i] = { ...l, result, reason };
    };

    switch (engine) {
      case 'claude-code': {
        const form = g.form as ClaudeCodeForm;
        jsonFile('.mcp.json', m.servers.length ? [{ kind: 'members', path: ['mcpServers'], members: m.servers.map(f => [f.name, objectOf(f)]) }] : [], engine);
        commands('.mcp.json', engine, m.servers);
        if (targets.has('.mcp.json')) trust.push({ engine, path: '.mcp.json', state: 'pending trust', reason: 'Claude Code asks the person to approve each project server in .mcp.json before it runs.' });
        const ops: JsonOp[] = [];
        for (const effect of ['allow', 'ask', 'deny'] as const) if (form.permissions[effect].length) ops.push({ kind: 'items', path: ['permissions', effect], items: [...form.permissions[effect]] });
        // Ruling B11: the sandbox also forbids commands that would leave it.
        if (form.sandbox) ops.push({ kind: 'members', path: ['sandbox'], members: [['enabled', true], ['allowUnsandboxedCommands', false]] });
        ops.push(...hookOps(h.hooks));
        // Rulings B11 and D2: a person's project settings, shared or local, can turn every hook off or set a mode.
        const found: string[] = [];
        for (const [file, text] of [['.claude/settings.json', base(ctx, '.claude/settings.json').text], ['.claude/settings.local.json', readProject(ctx.projectDir, '.claude/settings.local.json')?.bytes.toString('utf8') ?? null]] as const) {
          const settings = parsed(text);
          if (settings === null) continue;
          if (settings.disableAllHooks !== undefined && settings.disableAllHooks !== false) found.push(` The person's ${file} sets disableAllHooks, so Claude Code runs no hook.`);
          if (isObject(settings.permissions) && settings.permissions.defaultMode !== undefined) found.push(` The person's ${file} sets permissions.defaultMode, which Bowerloom does not change; how that mode meets the hook is unverified until the live check of step 5.`);
        }
        const unread = ' Claude Code also reads user and managed settings; user and managed settings are not read, so a hook they turn off is not reported.';
        for (const [i, l] of hookLines.entries()) {
          if (l.result === 'absent') continue;
          hookLines[i] = found.length ? { ...l, result: 'weakened', reason: `${l.reason}${found.join('')}${unread}` } : { ...l, reason: `${l.reason}${unread}` };
        }
        jsonFile('.claude/settings.json', ops, engine);
        hookCommands('.claude/settings.json', engine, h.hooks);
        for (const a of s.subagents) owned(`.claude/agents/${a.id}.md`, renderAgent(a), engine);
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
        const root: [string, Out][] = [], forbid: string[] = [];
        if (form.filesystem.length || form.sandbox) {
          if (CODEX_PROFILE_ENABLED) {
            const profile = codexProfile(form);
            root.push(...profile.root); forbid.push(...profile.forbid); tables.push(...profile.tables);
          } else {
            // Ruling B6: no profile until step 5. Every entry the profile would carry is weakened and says so.
            const held = new Set(g.written.filter(w => w.where.startsWith('filesystem[') || w.where === 'sandbox').map(w => w.source));
            for (const l of [...guardLines]) if (held.has(l.entry)) setLine(l.entry, 'weakened', `Not written: Bowerloom writes no Codex permission profile until the live check of step 5 confirms its syntax. The form it holds back: ${l.reason}`);
          }
        }
        if (root.length || tables.length) {
          const b = base(ctx, '.codex/config.toml');
          merged('.codex/config.toml', editToml(b.text, root, tables, forbid), engine, b.mode);
        }
        commands('.codex/config.toml', engine, m.servers);
        if (form.prefixRules.length) {
          const rules = renderRules(form);
          owned(CODEX_RULES, rules, engine);
          // Ruling D7: the rules file decides what Codex runs, so a person reads it whole.
          review.push({ path: CODEX_RULES, engine, kind: 'code', text: rules });
        }
        jsonFile('.codex/hooks.json', hookOps(h.hooks), engine);
        hookCommands('.codex/hooks.json', engine, h.hooks);
        for (const a of s.subagents) owned(`.codex/agents/${a.id}.toml`, tomlLines((a as Extract<SubagentForm, { engine: 'codex' }>).table), engine);
        const folder = ctx.codexTrust?.folderTrusted === true;
        for (const path of ['.codex/config.toml', CODEX_RULES]) {
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
          // Ruling B4: OpenCode replaces {env:...} and {file:...} anywhere in opencode.json.
          for (const r of view.rules) if (openCodeSubstitution(r.pattern) && g.written.some(w => w.source === r.id)) unsafeValues.push(`guardrails/${r.id}`);
          ops.push({ kind: 'members', path: [], members: [['permission', new Ordered(form.permission.map(k => [k.key, new Ordered(k.rules.map(r => [r.pattern, r.action]))]))]] });
        }
        // Ruling B10: OpenCode also reads settings from these files, and they could relax the written keys.
        if (ops.length && !ctx.owned.has('opencode.json')) {
          for (const other of ['opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc']) {
            if (stateOrUnsafe(ctx.projectDir, other) !== null) conflicts.push(`${other}: the project keeps OpenCode settings in ${other}, which can change what opencode.json says`);
          }
        }
        jsonFile('opencode.json', ops, engine);
        commands('opencode.json', engine, m.servers);
        for (const a of s.subagents) owned(`.opencode/agents/${a.id}.md`, renderAgent(a), engine);
        if (h.hooks.length) {
          const code = renderPlugin(h.hooks.filter((x): x is Extract<HookForm, { engine: 'opencode' }> => x.engine === 'opencode'));
          owned(OPENCODE_PLUGIN, code, engine);
          review.push({ path: OPENCODE_PLUGIN, engine, kind: 'code', text: code });
        }
        break;
      }
      case 'pi': {
        jsonFile('.pi/mcp.json', m.servers.length ? [{ kind: 'members', path: ['mcpServers'], members: m.servers.map(f => [f.name, objectOf(f)]) }] : [], engine);
        commands('.pi/mcp.json', engine, m.servers);
        if (targets.has('.pi/mcp.json')) trust.push({ engine, path: '.pi/mcp.json', state: ctx.piTrustSaved ? 'trusted' : 'pending trust', reason: ctx.piTrustSaved ? 'A person saved trust for this project in Pi.' : 'Pi skips files under .pi/ in non-interactive runs until a person saves trust for the project.' });
        break;
      }
      case 'deepseek-harness': {
        if (m.servers.length) {
          const patch = renderPatch(m.servers);
          owned(DSH_PATCH, patch, engine);
          commands(DSH_PATCH, engine, m.servers);
          // Rulings B2 and B12: DeepSeek Harness evaluates the !!js values of the patch, so a person reads it whole.
          review.push({ path: DSH_PATCH, engine, kind: 'code', text: patch });
        }
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
    lines.set(engine, new Map<LockedPart, LossLine[]>([
      ['guardrails', guardLines.map(l => ({ ...l, reason: l.reason + note(l.entry) }))], ['mcp', mcpLines], ['subagents', [...s.lines]], ['hooks', hookLines],
    ]));
  }
  if (envDefaults.length) refuse('PORTABLE_ENV_DEFAULT', [...new Set(envDefaults)]);
  if (unsafeValues.length) refuse('PORTABLE_UNSAFE_VALUE', [...new Set(unsafeValues)]);
  if (orderUnsafe.length) refuse('PORTABLE_ORDER_UNSAFE', orderUnsafe);
  if (invalid.length) refuse('PORTABLE_TARGET_INVALID', invalid);
  if (conflicts.length) refuse('PORTABLE_CONFLICT', conflicts);
  if (occupied.length) refuse('PORTABLE_PATH_OCCUPIED', occupied);
  const key = (a: { readonly path: string; readonly part?: string; readonly entry?: string; readonly kind?: string }): string => `${a.path}\u0000${a.kind ?? ''}\u0000${a.part ?? ''}\u0000${a.entry ?? ''}`;
  trust.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  review.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { targets, lines, trust, review, notes };
}

const objectOf = (f: McpServerForm): Out => ('value' in f ? f.value : null) as Out;

/** One hook group per hook: the hooks shape of Claude Code and Codex. */
function hookOps(hooks: readonly HookForm[]): JsonOp[] {
  return hooks.filter((x): x is Extract<HookForm, { engine: 'claude-code' | 'codex' }> => x.engine !== 'opencode').map(x => ({
    kind: 'items' as const, path: ['hooks', x.event],
    items: [new Ordered([...(x.matcher !== undefined ? [['matcher', x.matcher] as const] : []), ['hooks', [new Ordered(Object.entries(x.handler))]]])],
  }));
}

/** The profile: the key that selects it, its tables, and the top-level key that would override it. */
export function codexProfile(form: CodexForm): { readonly root: [string, Out][]; readonly tables: TomlTable[]; readonly forbid: string[] } {
  const tables: TomlTable[] = [{ path: ['permissions', CODEX_PROFILE], entries: [['extends', CODEX_PROFILE_BASE]] }];
  if (form.filesystem.length) tables.push({ path: ['permissions', CODEX_PROFILE, 'filesystem', ':workspace_roots'], entries: filesystemEntries(form.filesystem) });
  return { root: [['default_permissions', CODEX_PROFILE]], tables, forbid: ['sandbox_mode'] };
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
