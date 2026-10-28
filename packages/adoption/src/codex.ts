/**
 * Codex CLI 0.157.0 project files back to parts (locked-in parts spec 5.2, 6.2, 7.2, 8.2, 8.3): `.codex/config.toml`
 * (MCP servers, the sandbox, hooks, the model, and other keys), `.codex/hooks.json`, `.codex/agents/*.toml`, and
 * `.codex/rules/*.rules`. TOML is read in the subset of `toml.ts`; a file outside it is listed, never guessed.
 */
import { isId, isPermissionKey, safeName } from '../../harness-definition/src/index.js';
import type { JsonValue } from '../../harness-definition/src/index.js';
import { lose, place, type Context, type LostAction } from './context.js';
import type { Gate } from './model.js';
import { utf8 } from './files.js';
import { PERMISSION_REASON, addServer, blockOf, isObj, leftovers, oneLine, kp, privateKeys, readHooks, readJson } from './shared.js';
import type { Obj } from './shared.js';
import { secretName, textSecretRule } from './secrets.js';
import { parseTomlSubset } from './toml.js';

const ENGINE = 'codex' as const;
const CONFIG = '.codex/config.toml';
export const codexProjectDir = (command: string): string => command.replace(/\$\(git rev-parse --show-toplevel\)/g, '${PROJECT_DIR}');
/**
 * Codex tool names as the Claude Code names a neutral matcher uses, the inverse of the hook writer's map (fidelity,
 * locked-hooks.ts): `exec_command` is Bash, `spawn_agent` is Agent, and `apply_patch`, the Codex edit tool, stands for
 * every Claude Code edit tool (review item K1). The writer maps those back to apply_patch for Codex.
 */
const CODEX_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  exec_command: ['Bash'], spawn_agent: ['Agent'], apply_patch: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
};
/** A hook matcher that lists tool names, with Codex names turned into Claude Code names and repeats removed. */
export function codexMatcher(matcher: string): string {
  if (!/^[A-Za-z0-9_]+(?:\|[A-Za-z0-9_]+)*$/.test(matcher)) return matcher;
  return [...new Set(matcher.split('|').flatMap(n => CODEX_TOOL_NAMES[n] ?? [n]))].join('|');
}
/** The justification the rules writer gives a rule with none of its own. Adoption does not keep it. */
const BOWERLOOM_JUSTIFICATION = /^Bowerloom guardrail [a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODES_REASON = 'Approval policies and permission modes do not translate between engines (locked-in parts spec, section 8.3 rule 12). Bowerloom writes the engine default.';

function toml(ctx: Context, path: string, part: Parameters<Context['r']['miss']>[1], guard?: LostAction): Obj | null {
  const gate: Gate = guard ? 'acknowledge' : 'none';
  const f = ctx.r.file(path, part, gate);
  if (!f) { if (guard && ctx.r.unmapped.some(u => u.path === path)) lose(ctx, ENGINE, guard); return null; }
  const text = utf8(f.bytes);
  const parsed = text === null ? null : parseTomlSubset(text);
  if (parsed === null || !parsed.ok) {
    const why = parsed === null ? 'This file is not UTF-8 text.'
      : parsed.code === 'TOML_TOO_DEEP' ? `Line ${parsed.line} nests keys, arrays, or tables deeper than 64 (TOML_TOO_DEEP). The file is not adopted.`
        : `Line ${parsed.line} uses a TOML form outside the subset adoption reads (${parsed.code}): multi-line strings, dates, and number forms such as hex are not read. The file is not adopted.`;
    ctx.r.miss(path, part, why, undefined, gate);
    if (guard) lose(ctx, ENGINE, guard);
    return null;
  }
  return parsed.value as Obj;
}

function readConfig(ctx: Context): void {
  const c = toml(ctx, CONFIG, 'mcp', '*');
  if (!c) return;
  const shape = 'Codex config.toml';
  const rest: Obj = {};
  for (const [key, value] of Object.entries(c)) {
    if (key === 'mcp_servers') readServers(ctx, value);
    else if (key === 'hooks') readHooks(ctx, value, { path: CONFIG, base: '/hooks', engine: ENGINE, shape, rewrite: codexProjectDir, matcher: codexMatcher });
    else if (key === 'sandbox_mode' || key === 'sandbox_workspace_write') continue;
    else if (key === 'approval_policy') ctx.r.miss(CONFIG, 'guardrails', MODES_REASON, kp(c, key), 'acknowledge');
    else if (key === 'default_permissions' || key === 'permissions') {
      // A permission profile can deny paths, so it needs acknowledgement, and the allows it could limit are dropped.
      ctx.r.miss(CONFIG, 'guardrails', 'Permission profiles have no neutral form beyond the sandbox requirement, so they are not adopted.', kp(c, key), 'acknowledge');
      lose(ctx, ENGINE, '*');
    } else if (key === 'model') { if (oneLine(value, 256)) ctx.models[ENGINE] = { model: value, path: CONFIG }; else ctx.r.miss(CONFIG, null, 'The model is not one line of text.', '/model'); }
    else rest[key] = value;
  }
  readSandbox(ctx, c);
  leftovers(ctx, ENGINE, CONFIG, rest, 'config.json', shape);
}

/**
 * `sandbox_mode`: `read-only` and `workspace-write` require a file sandbox; the network is sandboxed unless
 * `sandbox_workspace_write.network_access` is true. `danger-full-access` asks for no sandbox, which has no neutral form.
 * Every sandbox value that is not carried is listed on its own and needs acknowledgement (rulings A17 and A18).
 */
function readSandbox(ctx: Context, c: Obj): void {
  const mode = c.sandbox_mode, table = c.sandbox_workspace_write;
  const drop = (reason: string, pointer: string): void => ctx.r.miss(CONFIG, 'guardrails', reason, pointer, 'acknowledge');
  const dropTable = (reason: string): void => {
    if (isObj(table)) for (const k of Object.keys(table)) drop(reason, `/sandbox_workspace_write${kp(table, k)}`);
    else if (table !== undefined) drop(reason, '/sandbox_workspace_write');
  };
  if (mode === undefined) { dropTable('sandbox_workspace_write applies only with a sandbox_mode, which this file does not set, so this value is not adopted.'); return; }
  if (mode === 'danger-full-access') {
    ctx.r.miss(CONFIG, 'guardrails', 'danger-full-access asks for no sandbox. The neutral form has a requirement for a sandbox, and no form for no sandbox, so nothing is adopted.', '/sandbox_mode');
    dropTable('The mode asks for no sandbox, so this value has no requirement to belong to.');
    return;
  }
  if (mode !== 'read-only' && mode !== 'workspace-write') { drop('sandbox_mode is not read-only, workspace-write, or danger-full-access, so no sandbox is required.', '/sandbox_mode'); dropTable('The mode is not read, so this value has no requirement to belong to.'); return; }
  let network = true;
  let extra: Obj = {};
  if (table !== undefined) {
    if (!isObj(table)) drop('sandbox_workspace_write is not a table.', '/sandbox_workspace_write');
    else {
      if (table.network_access === true) network = false;
      else if (table.network_access !== undefined && table.network_access !== false) drop('network_access is not true or false, so the network stays sandboxed.', '/sandbox_workspace_write/network_access');
      const found = { secret: false };
      extra = privateKeys(ctx, Object.fromEntries(Object.entries(table).filter(([k]) => k !== 'network_access')), CONFIG, '/sandbox_workspace_write', 'guardrails', 'acknowledge', found);
      if (found.secret) { drop('The sandbox table holds a key name that looks like a secret, so the sandbox requirement is not adopted.', '/sandbox_workspace_write'); return; }
    }
  }
  const { blocks, secrets } = blockOf([ENGINE], extra, CONFIG, '/sandbox_workspace_write', 'sandbox');
  ctx.cands.push({
    part: 'guardrails', id: 'sandbox', sandbox: { files: true, network }, place: place(CONFIG, [ENGINE], 'Codex config.toml', ENGINE, { pointer: '/sandbox_mode' }),
    blocks, secrets, needsApproval: [],
    notes: [`The Codex mode ${mode} becomes a requirement for a file sandbox${network ? ' and a network sandbox' : ''}. The mode name itself has no neutral form.`],
  });
}

const SERVER_KNOWN = new Set(['command', 'args', 'url', 'env', 'env_vars', 'tool_timeout_sec', 'enabled', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'disabled_tools', 'enabled_tools']);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The servers of `mcp_servers`. A server is adopted with every tool limit it has, or not at all (ruling A4): an allow
 * list (`enabled_tools`) has no neutral form, and `disabled_tools` become deny rules only when every name can be one.
 * A server that is not adopted names the disabled tools that go with it (A18). A header you set is never overwritten.
 */
function readServers(ctx: Context, value: JsonValue): void {
  if (!isObj(value)) { ctx.r.miss(CONFIG, 'mcp', 'mcp_servers is not a table of servers.', '/mcp_servers'); return; }
  for (const [name, s] of Object.entries(value)) {
    const base = `/mcp_servers${kp(value, name)}`;
    if (!isObj(s)) { ctx.r.miss(CONFIG, 'mcp', 'This server is not a table.', base); continue; }
    const disabled = s.disabled_tools;
    const disabledOk = disabled === undefined || (Array.isArray(disabled) && disabled.every(t => typeof t === 'string' && /^[A-Za-z0-9_*-]+$/.test(t) && !secretName(t)));
    const dropped = (): void => {
      if (disabled === undefined || !disabledOk || (disabled as string[]).length === 0) return;
      const names = (disabled as string[]).map(t => safeName(t)).join(', ');
      ctx.r.miss(CONFIG, 'guardrails', `The server is not adopted, so its disabled tools go with it: ${names}.`, `${base}/disabled_tools`);
    };
    const skip = (reason: string, field: string): void => { ctx.r.miss(CONFIG, 'mcp', reason, `${base}/${field}`); dropped(); };
    if (s.enabled_tools !== undefined) { skip('An allow list of MCP tools has no neutral form: a deny rule cannot name every other tool. Without it the server would be wider than the source, so the server is not adopted.', 'enabled_tools'); continue; }
    if (!disabledOk) { ctx.r.miss(CONFIG, 'mcp', 'disabled_tools is not a list of tool names that can each be a deny rule. Without them the server would be wider than the source, so the server is not adopted.', `${base}/disabled_tools`); continue; }
    const env: Obj = isObj(s.env) ? { ...s.env } : {};
    if (s.env !== undefined && !isObj(s.env)) { skip('env is not a table, so the server is not adopted.', 'env'); continue; }
    if (s.env_vars !== undefined) {
      if (!Array.isArray(s.env_vars) || !s.env_vars.every(v => typeof v === 'string' && NAME.test(v))) { skip('env_vars is not a list of variable names, so the server is not adopted.', 'env_vars'); continue; }
      for (const v of s.env_vars as string[]) if (env[v] === undefined) env[v] = `\${${v}}`;
    }
    const headers: Obj = {};
    if (s.http_headers !== undefined) { if (isObj(s.http_headers)) Object.assign(headers, s.http_headers); else { skip('http_headers is not a table, so the server is not adopted.', 'http_headers'); continue; } }
    const has = (h: string): boolean => Object.keys(headers).some(k => k.toLowerCase() === h.toLowerCase());
    if (s.env_http_headers !== undefined) {
      if (!isObj(s.env_http_headers) || !Object.values(s.env_http_headers).every(v => typeof v === 'string' && NAME.test(v))) { skip('env_http_headers is not a table of variable names, so the server is not adopted.', 'env_http_headers'); continue; }
      for (const [h, v] of Object.entries(s.env_http_headers)) {
        if (has(h)) ctx.r.miss(CONFIG, 'mcp', 'http_headers already sets this header. Adoption never overwrites a header you set, so this one is not adopted.', `${base}/env_http_headers${kp(s.env_http_headers, h)}`);
        else headers[h] = `\${${v as string}}`;
      }
    }
    if (s.bearer_token_env_var !== undefined) {
      if (typeof s.bearer_token_env_var !== 'string' || !NAME.test(s.bearer_token_env_var)) { skip('bearer_token_env_var is not a variable name, so the server is not adopted.', 'bearer_token_env_var'); continue; }
      if (has('Authorization')) ctx.r.miss(CONFIG, 'mcp', 'An Authorization header is already set. Adoption never overwrites a header you set, so bearer_token_env_var is not adopted.', `${base}/bearer_token_env_var`);
      else headers.Authorization = `Bearer \${${s.bearer_token_env_var}}`;
    }
    const sec = s.tool_timeout_sec;
    const timeout = typeof sec === 'number' ? Math.round(sec * 1000) : undefined;
    if (sec !== undefined && typeof sec !== 'number') ctx.r.miss(CONFIG, 'mcp', 'tool_timeout_sec is not a number, so the server is adopted without it.', `${base}/tool_timeout_sec`);
    const before = ctx.cands.length;
    addServer(ctx, {
      path: CONFIG, base, engines: [ENGINE], owner: ENGINE, shape: 'Codex config.toml', name, transport: s.url !== undefined && s.command === undefined ? 'http' : 'stdio',
      ...(s.command !== undefined ? { command: s.command } : {}), ...(s.args !== undefined ? { args: s.args } : {}), ...(s.url !== undefined ? { url: s.url } : {}),
      ...(Object.keys(env).length ? { env } : {}), ...(Object.keys(headers).length ? { headers } : {}), ...(timeout !== undefined ? { timeout } : {}),
      ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      extra: Object.fromEntries(Object.entries(s).filter(([k]) => !SERVER_KNOWN.has(k))),
    });
    if (ctx.cands.length === before) { dropped(); continue; }
    // Locked-in parts spec, section 8.2 and fidelity: Codex carries an MCP deny as disabled tools.
    ((disabled ?? []) as string[]).forEach((tool, i) => ctx.cands.push({
      part: 'guardrails', id: '', rule: { action: 'mcp', pattern: `${name}/${tool}`, effect: 'deny', strength: 'enforced' },
      place: place(CONFIG, [ENGINE], 'Codex config.toml', ENGINE, { pointer: `${base}/disabled_tools/${i}` }), blocks: {}, secrets: [], needsApproval: [], notes: ['A disabled MCP tool becomes a deny rule.'],
    }));
  }
}

function readHooksFile(ctx: Context): void {
  const h = readJson(ctx, '.codex/hooks.json', 'hooks');
  if (!h) return;
  for (const [k, v] of Object.entries(h)) {
    if (k === 'hooks') readHooks(ctx, v, { path: '.codex/hooks.json', base: '/hooks', engine: ENGINE, shape: 'Codex hooks.json', rewrite: codexProjectDir, matcher: codexMatcher });
    else ctx.r.miss('.codex/hooks.json', 'hooks', 'Adoption reads only hooks in hooks.json.', kp(h, k));
  }
}

const AGENT_NOT_PER_SUBAGENT = 'Codex cannot set this per subagent: a subagent takes the sandbox, the approval policy, and MCP servers of its parent turn (locked-in parts spec, section 6.3 rule 4). It is not adopted.';

function readAgents(ctx: Context): void {
  const { r } = ctx;
  const root = '.codex/agents';
  const listed = r.list(root, 'subagents');
  if (listed === null) return;
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.toml')) continue;
    const f = r.file(rel, 'subagents');
    if (!f) continue;
    if (textSecretRule('agent.toml', f.bytes)) { r.miss(rel, 'subagents', 'This file holds a value that looks like a secret. Adoption never copies a secret value.'); continue; }
    const a = toml(ctx, rel, 'subagents');
    if (!a) continue;
    // Review item C3: a read-only agent is a tool limit, like the feature switches; without it the agent would be wider.
    if (a.sandbox_mode === 'read-only') { r.miss(rel, 'subagents', 'The agent asks for the read-only sandbox, a tool limit the neutral tool list cannot carry exactly. Without it the subagent would be wider than the source, so it is not adopted.'); continue; }
    if (a.features !== undefined) { r.miss(rel, 'subagents', 'The feature switches are a tool limit that the neutral tool list cannot carry exactly. Without them the subagent would be wider than the source, so it is not adopted.'); continue; }
    if (!isId(a.name)) { r.miss(rel, 'subagents', 'The agent has no name that is a valid id.'); continue; }
    if (!(typeof a.description === 'string' && a.description.trim() !== '' && [...a.description].length <= 1024)) { r.miss(rel, 'subagents', 'The agent has no description of 1 to 1,024 characters.'); continue; }
    if (typeof a.developer_instructions !== 'string' || a.developer_instructions.trim() === '') { r.miss(rel, 'subagents', 'The agent has no developer_instructions, which a subagent needs as its body.'); continue; }
    const extra: Obj = {};
    for (const [k, v] of Object.entries(a)) {
      if (['name', 'description', 'developer_instructions', 'model'].includes(k)) continue;
      if (k === 'sandbox_mode' || k === 'approval_policy' || k === 'mcp_servers' || k === 'model_provider') { r.miss(rel, 'subagents', AGENT_NOT_PER_SUBAGENT, kp(a, k), k === 'sandbox_mode' || k === 'approval_policy' ? 'acknowledge' : 'none'); continue; }
      if (isPermissionKey(k)) { r.miss(rel, 'subagents', PERMISSION_REASON, kp(a, k)); continue; }
      extra[k] = v;
    }
    const models: { codex?: string } = {};
    if (a.model !== undefined) { if (oneLine(a.model, 256)) models.codex = a.model; else r.miss(rel, 'subagents', 'The model is not one line of text.', '/model'); }
    const body = a.developer_instructions.replace(/\r\n?/g, '\n');
    const found = { secret: false };
    const kept = privateKeys(ctx, extra, rel, '', 'subagents', 'none', found);
    if (found.secret) continue;
    const { blocks, secrets } = blockOf([ENGINE], kept, rel, '', a.name);
    ctx.cands.push({
      part: 'subagents', id: a.name, subagent: { description: a.description, body: body.endsWith('\n') ? body : `${body}\n` }, models,
      place: place(rel, [ENGINE], 'Codex agent file', ENGINE), blocks, secrets, needsApproval: [], notes: ['developer_instructions becomes the body.'],
    });
  }
  r.rest(root, listed, 'subagents');
}

// ---- rules files ---------------------------------------------------------------------------------------------------------

type Tok = { t: 'str' | 'id' | 'p'; v: string };
function tokens(text: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      for (; j < text.length && text[j] !== c; j++) { if (text[j] === '\n') return null; if (text[j] === '\\') { const e = text[++j]; if (e !== '"' && e !== "'" && e !== '\\') return null; v += e; continue; } v += text[j]; }
      if (j >= text.length) return null;
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('()[],='.includes(c)) { out.push({ t: 'p', v: c }); i++; continue; }
    return null;
  }
  return out;
}
type Val = string | Val[];
/** The `prefix_rule(...)` calls of a rules file, each a map of keyword arguments. Null when the file holds anything else. */
export function prefixRules(text: string): Record<string, Val>[] | { readonly code: 'RULES_TOO_DEEP' } | null {
  const ts = tokens(text);
  if (!ts) return null;
  let tooDeep = false;
  let i = 0;
  const peek = () => ts[i], take = () => ts[i++];
  const is = (t: Tok | undefined, v: string) => t?.t === 'p' && t.v === v;
  const value = (depth = 0): Val | null => {
    // Ruling A5: nesting past 64 is refused before the parser recurses further.
    if (depth > 64) { tooDeep = true; return null; }
    const t = take();
    if (t?.t === 'str') return t.v;
    if (!is(t, '[')) return null;
    const list: Val[] = [];
    while (!is(peek(), ']')) { const v = value(depth + 1); if (v === null) return null; list.push(v); if (is(peek(), ',')) take(); else if (!is(peek(), ']')) return null; }
    take();
    return list;
  };
  const calls: Record<string, Val>[] = [];
  while (i < ts.length) {
    const name = take();
    if (name?.t !== 'id' || name.v !== 'prefix_rule' || !is(take(), '(')) return null;
    const args: Record<string, Val> = {};
    while (!is(peek(), ')')) {
      const k = take();
      if (k?.t !== 'id' || !is(take(), '=') || Object.hasOwn(args, k.v) || k.v === '__proto__') return null;
      const v = value();
      if (v === null) return tooDeep ? { code: 'RULES_TOO_DEEP' } : null;
      args[k.v] = v;
      if (is(peek(), ',')) take(); else if (!is(peek(), ')')) return null;
    }
    take();
    calls.push(args);
  }
  return calls;
}

const PLAIN_TOKEN = /^[A-Za-z0-9_./:@%+,=-]+$/;
const DECISIONS = { forbidden: 'deny', prompt: 'ask', allow: 'allow' } as const;

/**
 * `.codex/rules`. Every entry is taken or listed (ruling A1). Anything here that is not read could hold a deny or an ask,
 * so it needs acknowledgement, and the Codex shell allows are dropped (ruling A2). A rule is refused before its
 * alternatives expand past 64 (ruling A5).
 */
function readRules(ctx: Context): void {
  const { r } = ctx;
  const root = '.codex/rules';
  const strict = (path: string, reason: string, pointer?: string): void => { r.miss(path, 'guardrails', reason, pointer, 'acknowledge'); lose(ctx, ENGINE, 'shell'); };
  const before = r.unmapped.length;
  const listed = r.list(root, 'guardrails', 'acknowledge');
  if (listed === null) { if (r.unmapped.length > before) lose(ctx, ENGINE, 'shell'); return; }
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.rules')) continue;
    const f = r.file(rel, 'guardrails', 'acknowledge');
    if (!f) { lose(ctx, ENGINE, 'shell'); continue; }
    const text = utf8(f.bytes);
    const calls = text === null ? null : prefixRules(text);
    if (calls === null || !Array.isArray(calls)) {
      strict(rel, calls?.code === 'RULES_TOO_DEEP' ? 'This rules file nests lists deeper than 64, so adoption does not read it.' : 'This rules file holds something other than prefix_rule calls with text and list arguments, so adoption does not read it.');
      continue;
    }
    calls.forEach((call, i) => {
      const pointer = `/${i}`;
      const known = new Set(['pattern', 'decision', 'justification', 'match', 'not_match']);
      if (Object.keys(call).some(k => !known.has(k))) { strict(rel, 'This prefix_rule has an argument adoption does not know.', pointer); return; }
      const decision = call.decision ?? 'allow';
      if (typeof decision !== 'string' || !Object.hasOwn(DECISIONS, decision)) { strict(rel, 'The decision is not allow, prompt, or forbidden.', pointer); return; }
      const effect = DECISIONS[decision as keyof typeof DECISIONS];
      const miss = (reason: string): void => { if (effect === 'allow') r.miss(rel, 'guardrails', reason, pointer); else strict(rel, reason, pointer); };
      const pattern = call.pattern;
      if (!Array.isArray(pattern) || pattern.length === 0) { miss('The pattern is not a list of tokens.'); return; }
      const slots = pattern.map(p => typeof p === 'string' ? [p] : Array.isArray(p) && p.every(x => typeof x === 'string') ? p as string[] : null);
      if (slots.some(s => s?.some(x => secretName(x)))) { miss('A pattern token looks like a secret, so the rule is not adopted.'); return; }
      if (slots.some(s => s === null || s.length === 0 || s.some(x => !PLAIN_TOKEN.test(x)))) {
        miss('A pattern token holds a space, a wildcard, or a quote. Codex reads * as a literal, and the neutral shell pattern reads it as a wildcard, so the token has no exact neutral form.'); return;
      }
      let count = 1;
      for (const s of slots as string[][]) { count *= s.length; if (count > 64) break; }
      if (count > 64) { miss('The pattern has more than 64 alternatives, so it is not expanded.'); return; }
      let prefixes: string[][] = [[]];
      for (const s of slots as string[][]) prefixes = prefixes.flatMap(p => s.map(x => [...p, x]));
      const extra: Obj = {};
      for (const k of ['justification', 'match', 'not_match'] as const) if (call[k] !== undefined) extra[k] = call[k] as JsonValue;
      // The justification Bowerloom writes for a rule with none of its own names the rule; it is not the person's text.
      if (typeof extra.justification === 'string' && BOWERLOOM_JUSTIFICATION.test(extra.justification)) delete extra.justification;
      const { blocks, secrets } = blockOf([ENGINE], extra, rel, pointer, 'rule');
      for (const p of prefixes) ctx.cands.push({
        part: 'guardrails', id: '', rule: { action: 'shell', pattern: `${p.join(' ')} *`, effect, strength: effect === 'allow' ? 'advisory' : 'enforced' },
        place: place(rel, [ENGINE], 'Codex rules file', ENGINE, { pointer }), blocks, secrets, needsApproval: [],
        notes: ['A Codex prefix matches the command and any arguments after it, as the neutral trailing " *" does.',
          ...(effect === 'allow' ? ['A Codex allow runs the command outside the sandbox without asking. The neutral allow runs it without asking and says nothing about the sandbox, and a projection to Codex writes no allow rule (locked-in parts spec, section 8.3 rule 2).'] : [])],
      });
    });
  }
  const restBefore = r.unmapped.length;
  r.rest(root, listed, 'guardrails', 'acknowledge');
  if (r.unmapped.length > restBefore) lose(ctx, ENGINE, 'shell');
}

export function readCodex(ctx: Context): void {
  if (!ctx.engines.includes(ENGINE)) return;
  readConfig(ctx);
  readHooksFile(ctx);
  readAgents(ctx);
  readRules(ctx);
}
