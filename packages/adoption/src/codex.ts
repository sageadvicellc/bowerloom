/**
 * Codex CLI 0.157.0 project files back to parts (locked-in parts spec 5.2, 6.2, 7.2, 8.2, 8.3): `.codex/config.toml`
 * (MCP servers, the sandbox, hooks, the model, and other keys), `.codex/hooks.json`, `.codex/agents/*.toml`, and
 * `.codex/rules/*.rules`. TOML is read in the subset of `toml.ts`; a file outside it is listed, never guessed.
 */
import { isId, isPermissionKey } from '../../harness-definition/src/index.js';
import type { JsonValue } from '../../harness-definition/src/index.js';
import { place, type Context } from './context.js';
import { utf8 } from './files.js';
import { PERMISSION_REASON, addServer, blockOf, isObj, leftovers, oneLine, privateKeys, ptr, readHooks, readJson } from './shared.js';
import type { Obj } from './shared.js';
import { textSecretRule } from './secrets.js';
import { parseTomlSubset } from './toml.js';

const ENGINE = 'codex' as const;
const CONFIG = '.codex/config.toml';
export const codexProjectDir = (command: string): string => command.replace(/\$\(git rev-parse --show-toplevel\)/g, '${PROJECT_DIR}');
const MODES_REASON = 'Approval policies and permission modes do not translate between engines (locked-in parts spec, section 8.3 rule 12). Bowerloom writes the engine default.';

function toml(ctx: Context, path: string, part: Parameters<Context['r']['miss']>[1]): Obj | null {
  const f = ctx.r.file(path, part);
  if (!f) return null;
  const text = utf8(f.bytes);
  if (text === null) { ctx.r.miss(path, part, 'This file is not UTF-8 text.'); return null; }
  const parsed = parseTomlSubset(text);
  if (!parsed.ok) { ctx.r.miss(path, part, `Line ${parsed.line} uses a TOML form outside the subset adoption reads (${parsed.code}): multi-line strings, dates, and number forms such as hex are not read. The file is not adopted.`); return null; }
  return parsed.value as Obj;
}

function readConfig(ctx: Context): void {
  const c = toml(ctx, CONFIG, 'mcp');
  if (!c) return;
  const shape = 'Codex config.toml';
  const rest: Obj = {};
  for (const [key, value] of Object.entries(c)) {
    if (key === 'mcp_servers') readServers(ctx, value);
    else if (key === 'hooks') readHooks(ctx, value, { path: CONFIG, base: '/hooks', engine: ENGINE, shape, rewrite: codexProjectDir });
    else if (key === 'sandbox_mode' || key === 'sandbox_workspace_write') continue;
    else if (key === 'approval_policy' || key === 'default_permissions' || key === 'permissions') ctx.r.miss(CONFIG, 'guardrails', key === 'approval_policy' ? MODES_REASON : 'Permission profiles have no neutral form beyond the sandbox requirement, so they are not adopted.', ptr(key));
    else if (key === 'model') { if (oneLine(value, 256)) ctx.models[ENGINE] = { model: value, path: CONFIG }; else ctx.r.miss(CONFIG, null, 'The model is not one line of text.', '/model'); }
    else rest[key] = value;
  }
  readSandbox(ctx, c);
  leftovers(ctx, ENGINE, CONFIG, rest, 'config.json', shape);
}

/**
 * `sandbox_mode`: `read-only` and `workspace-write` require a file sandbox; the network is sandboxed unless
 * `sandbox_workspace_write.network_access` is true. `danger-full-access` asks for no sandbox, which has no neutral form.
 */
function readSandbox(ctx: Context, c: Obj): void {
  const mode = c.sandbox_mode, table = c.sandbox_workspace_write;
  if (mode === undefined) { if (table !== undefined) ctx.r.miss(CONFIG, 'guardrails', 'sandbox_workspace_write applies only with a sandbox_mode, which this file does not set.', '/sandbox_workspace_write'); return; }
  if (mode === 'danger-full-access') { ctx.r.miss(CONFIG, 'guardrails', 'danger-full-access asks for no sandbox. The neutral form has a requirement for a sandbox, and no form for no sandbox, so nothing is adopted.', '/sandbox_mode'); return; }
  if (mode !== 'read-only' && mode !== 'workspace-write') { ctx.r.miss(CONFIG, 'guardrails', 'sandbox_mode is not read-only, workspace-write, or danger-full-access.', '/sandbox_mode'); return; }
  let network = true;
  let extra: Obj = {};
  if (table !== undefined) {
    if (!isObj(table)) ctx.r.miss(CONFIG, 'guardrails', 'sandbox_workspace_write is not a table.', '/sandbox_workspace_write');
    else {
      if (table.network_access === true) network = false;
      extra = privateKeys(ctx, Object.fromEntries(Object.entries(table).filter(([k]) => k !== 'network_access')), CONFIG, '/sandbox_workspace_write', 'guardrails');
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

function readServers(ctx: Context, value: JsonValue): void {
  if (!isObj(value)) { ctx.r.miss(CONFIG, 'mcp', 'mcp_servers is not a table of servers.', '/mcp_servers'); return; }
  for (const [name, s] of Object.entries(value)) {
    const base = `/mcp_servers${ptr(name)}`;
    if (!isObj(s)) { ctx.r.miss(CONFIG, 'mcp', 'This server is not a table.', base); continue; }
    const env: Obj = isObj(s.env) ? { ...s.env } : {};
    if (s.env !== undefined && !isObj(s.env)) { ctx.r.miss(CONFIG, 'mcp', 'env is not a table.', `${base}/env`); continue; }
    if (s.env_vars !== undefined) {
      if (!Array.isArray(s.env_vars) || !s.env_vars.every(v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))) { ctx.r.miss(CONFIG, 'mcp', 'env_vars is not a list of variable names, so the server is not adopted.', `${base}/env_vars`); continue; }
      for (const v of s.env_vars as string[]) if (env[v] === undefined) env[v] = `\${${v}}`;
    }
    const headers: Obj = {};
    if (s.http_headers !== undefined) { if (isObj(s.http_headers)) Object.assign(headers, s.http_headers); else { ctx.r.miss(CONFIG, 'mcp', 'http_headers is not a table.', `${base}/http_headers`); continue; } }
    if (s.env_http_headers !== undefined) {
      if (!isObj(s.env_http_headers) || !Object.values(s.env_http_headers).every(v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))) { ctx.r.miss(CONFIG, 'mcp', 'env_http_headers is not a table of variable names.', `${base}/env_http_headers`); continue; }
      for (const [h, v] of Object.entries(s.env_http_headers)) headers[h] = `\${${v as string}}`;
    }
    if (s.bearer_token_env_var !== undefined) {
      if (typeof s.bearer_token_env_var !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.bearer_token_env_var)) { ctx.r.miss(CONFIG, 'mcp', 'bearer_token_env_var is not a variable name.', `${base}/bearer_token_env_var`); continue; }
      headers.Authorization = `Bearer \${${s.bearer_token_env_var}}`;
    }
    const sec = s.tool_timeout_sec;
    const timeout = typeof sec === 'number' ? Math.round(sec * 1000) : undefined;
    if (sec !== undefined && typeof sec !== 'number') ctx.r.miss(CONFIG, 'mcp', 'tool_timeout_sec is not a number, so the server is adopted without it.', `${base}/tool_timeout_sec`);
    if (s.enabled_tools !== undefined) ctx.r.miss(CONFIG, 'mcp', 'An allow list of MCP tools has no neutral form: a deny rule cannot name every other tool. It is not adopted.', `${base}/enabled_tools`);
    const before = ctx.cands.length;
    addServer(ctx, {
      path: CONFIG, base, engines: [ENGINE], owner: ENGINE, shape: 'Codex config.toml', name, transport: s.url !== undefined && s.command === undefined ? 'http' : 'stdio',
      ...(s.command !== undefined ? { command: s.command } : {}), ...(s.args !== undefined ? { args: s.args } : {}), ...(s.url !== undefined ? { url: s.url } : {}),
      ...(Object.keys(env).length ? { env } : {}), ...(Object.keys(headers).length ? { headers } : {}), ...(timeout !== undefined ? { timeout } : {}),
      ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      extra: Object.fromEntries(Object.entries(s).filter(([k]) => !SERVER_KNOWN.has(k))),
    });
    if (ctx.cands.length === before) continue;
    // Locked-in parts spec, section 8.2 and fidelity: Codex carries an MCP deny as disabled tools.
    if (s.disabled_tools !== undefined) {
      if (!Array.isArray(s.disabled_tools) || !s.disabled_tools.every(t => typeof t === 'string' && /^[A-Za-z0-9_*-]+$/.test(t))) { ctx.r.miss(CONFIG, 'guardrails', 'disabled_tools is not a list of tool names.', `${base}/disabled_tools`); continue; }
      (s.disabled_tools as string[]).forEach((tool, i) => ctx.cands.push({
        part: 'guardrails', id: '', rule: { action: 'mcp', pattern: `${name}/${tool}`, effect: 'deny', strength: 'enforced' },
        place: place(CONFIG, [ENGINE], 'Codex config.toml', ENGINE, { pointer: `${base}/disabled_tools/${i}` }), blocks: {}, secrets: [], needsApproval: [], notes: ['A disabled MCP tool becomes a deny rule.'],
      }));
    }
  }
}

function readHooksFile(ctx: Context): void {
  const h = readJson(ctx, '.codex/hooks.json', 'hooks');
  if (!h) return;
  for (const [k, v] of Object.entries(h)) {
    if (k === 'hooks') readHooks(ctx, v, { path: '.codex/hooks.json', base: '/hooks', engine: ENGINE, shape: 'Codex hooks.json', rewrite: codexProjectDir });
    else ctx.r.miss('.codex/hooks.json', 'hooks', 'Adoption reads only hooks in hooks.json.', ptr(k));
  }
}

const AGENT_NOT_PER_SUBAGENT = 'Codex cannot set this per subagent: a subagent takes the sandbox, the approval policy, and MCP servers of its parent turn (locked-in parts spec, section 6.3 rule 4). It is not adopted.';

function readAgents(ctx: Context): void {
  const { r } = ctx;
  const root = '.codex/agents';
  const listed = r.list(root, 'subagents');
  if (listed === null) return;
  r.consumed.add(root);
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.toml')) continue;
    const f = r.file(rel, 'subagents');
    if (!f) continue;
    if (textSecretRule('agent.toml', f.bytes)) { r.miss(rel, 'subagents', 'This file holds a value that looks like a secret. Adoption never copies a secret value.'); continue; }
    const a = toml(ctx, rel, 'subagents');
    if (!a) continue;
    if (a.features !== undefined) { r.miss(rel, 'subagents', 'The feature switches are a tool limit that the neutral tool list cannot carry exactly. Without them the subagent would be wider than the source, so it is not adopted.'); continue; }
    if (!isId(a.name)) { r.miss(rel, 'subagents', 'The agent has no name that is a valid id.'); continue; }
    if (!(typeof a.description === 'string' && a.description.trim() !== '' && [...a.description].length <= 1024)) { r.miss(rel, 'subagents', 'The agent has no description of 1 to 1,024 characters.'); continue; }
    if (typeof a.developer_instructions !== 'string' || a.developer_instructions.trim() === '') { r.miss(rel, 'subagents', 'The agent has no developer_instructions, which a subagent needs as its body.'); continue; }
    const extra: Obj = {};
    for (const [k, v] of Object.entries(a)) {
      if (['name', 'description', 'developer_instructions', 'model'].includes(k)) continue;
      if (k === 'sandbox_mode' || k === 'approval_policy' || k === 'mcp_servers' || k === 'model_provider') { r.miss(rel, 'subagents', AGENT_NOT_PER_SUBAGENT, ptr(k)); continue; }
      if (isPermissionKey(k)) { r.miss(rel, 'subagents', PERMISSION_REASON, ptr(k)); continue; }
      extra[k] = v;
    }
    const models: { codex?: string } = {};
    if (a.model !== undefined) { if (oneLine(a.model, 256)) models.codex = a.model; else r.miss(rel, 'subagents', 'The model is not one line of text.', '/model'); }
    const body = a.developer_instructions.replace(/\r\n?/g, '\n');
    const { blocks, secrets } = blockOf([ENGINE], privateKeys(ctx, extra, rel, '', 'subagents'), rel, '', a.name);
    ctx.cands.push({
      part: 'subagents', id: a.name, subagent: { description: a.description, body: body.endsWith('\n') ? body : `${body}\n` }, models,
      place: place(rel, [ENGINE], 'Codex agent file', ENGINE), blocks, secrets, needsApproval: [], notes: ['developer_instructions becomes the body.'],
    });
  }
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
export function prefixRules(text: string): Record<string, Val>[] | null {
  const ts = tokens(text);
  if (!ts) return null;
  let i = 0;
  const peek = () => ts[i], take = () => ts[i++];
  const is = (t: Tok | undefined, v: string) => t?.t === 'p' && t.v === v;
  const value = (): Val | null => {
    const t = take();
    if (t?.t === 'str') return t.v;
    if (!is(t, '[')) return null;
    const list: Val[] = [];
    while (!is(peek(), ']')) { const v = value(); if (v === null) return null; list.push(v); if (is(peek(), ',')) take(); else if (!is(peek(), ']')) return null; }
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
      if (v === null) return null;
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

function readRules(ctx: Context): void {
  const { r } = ctx;
  const root = '.codex/rules';
  const listed = r.list(root, 'guardrails');
  if (listed === null) return;
  r.consumed.add(root);
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.rules')) continue;
    const f = r.file(rel, 'guardrails');
    if (!f) continue;
    const text = utf8(f.bytes);
    const calls = text === null ? null : prefixRules(text);
    if (!calls) { r.miss(rel, 'guardrails', 'This rules file holds something other than prefix_rule calls with text and list arguments, so adoption does not read it.'); continue; }
    calls.forEach((call, i) => {
      const pointer = `/${i}`;
      const known = new Set(['pattern', 'decision', 'justification', 'match', 'not_match']);
      if (Object.keys(call).some(k => !known.has(k))) { r.miss(rel, 'guardrails', 'This prefix_rule has an argument adoption does not know.', pointer); return; }
      const decision = call.decision ?? 'allow';
      if (typeof decision !== 'string' || !Object.hasOwn(DECISIONS, decision)) { r.miss(rel, 'guardrails', 'The decision is not allow, prompt, or forbidden.', pointer); return; }
      const effect = DECISIONS[decision as keyof typeof DECISIONS];
      const pattern = call.pattern;
      if (!Array.isArray(pattern) || pattern.length === 0) { r.miss(rel, 'guardrails', 'The pattern is not a list of tokens.', pointer); return; }
      const slots = pattern.map(p => typeof p === 'string' ? [p] : Array.isArray(p) && p.every(x => typeof x === 'string') ? p as string[] : null);
      if (slots.some(s => s === null || s.length === 0 || s.some(x => !PLAIN_TOKEN.test(x)))) {
        r.miss(rel, 'guardrails', 'A pattern token holds a space, a wildcard, or a quote. Codex reads * as a literal, and the neutral shell pattern reads it as a wildcard, so the token has no exact neutral form.', pointer); return;
      }
      let prefixes: string[][] = [[]];
      for (const s of slots as string[][]) prefixes = prefixes.flatMap(p => s.map(x => [...p, x]));
      if (prefixes.length > 64) { r.miss(rel, 'guardrails', 'The pattern has more than 64 alternatives.', pointer); return; }
      const extra: Obj = {};
      for (const k of ['justification', 'match', 'not_match'] as const) if (call[k] !== undefined) extra[k] = call[k] as JsonValue;
      const { blocks, secrets } = blockOf([ENGINE], extra, rel, pointer, 'rule');
      for (const p of prefixes) ctx.cands.push({
        part: 'guardrails', id: '', rule: { action: 'shell', pattern: `${p.join(' ')} *`, effect, strength: effect === 'allow' ? 'advisory' : 'enforced' },
        place: place(rel, [ENGINE], 'Codex rules file', ENGINE, { pointer }), blocks, secrets, needsApproval: [],
        notes: ['A Codex prefix matches the command and any arguments after it, as the neutral trailing " *" does.',
          ...(effect === 'allow' ? ['A Codex allow runs the command outside the sandbox without asking. The neutral allow runs it without asking and says nothing about the sandbox, and a projection to Codex writes no allow rule (locked-in parts spec, section 8.3 rule 2).'] : [])],
      });
    });
  }
}

export function readCodex(ctx: Context): void {
  if (!ctx.engines.includes(ENGINE)) return;
  readConfig(ctx);
  readHooksFile(ctx);
  readAgents(ctx);
  readRules(ctx);
}
