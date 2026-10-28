/**
 * Readers shared by several engines: command hooks in the Claude Code form (Claude Code `settings.json`, Codex
 * `hooks.json` and `[hooks]`), MCP server entries, and the leftover keys of a settings file, which become an
 * engine-private file under `engines/<engine>/`.
 */
import { DEFINITION_LIMITS, isPermissionKey, isSafeName, isServerName, parseStrictJson } from '../../harness-definition/src/index.js';
import { utf8 } from './files.js';
import type { EngineId, EnvValue, JsonValue, McpTransport } from '../../harness-definition/src/index.js';
import { lose, place, type Context, type LostAction } from './context.js';
import type { Blocks, Gate, Place } from './model.js';
import { referenceName, scrubTree, secretName, secretRule, withoutSecret } from './secrets.js';

export type Obj = Record<string, JsonValue>;
export const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * One pointer segment for a key of an object: `/<key>` when the key is a safe name, else `/#<index>`, so a pointer never
 * shows a key that could be a secret (ruling A10).
 */
export const kp = (obj: object, key: string): string => isSafeName(key) ? `/${key}` : `/#${Object.keys(obj).indexOf(key)}`;
const CONTROL = /[\0-\x08\x0a-\x1f\x7f]/;
export const oneLine = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max && !CONTROL.test(v);

export const PERMISSION_REASON = 'This key is permission-like, and a private block holds no permission-like key. It has no neutral form, so it is not adopted.';
export const SECRET_NAME_REASON = 'This name looks like a secret, so the entry is not adopted. It is listed by place, never by name.';
export const HOOK_APPROVAL = 'A hook runs a command. A person reads the command before Bowerloom writes it into an engine.';
export const STDIO_APPROVAL = 'An MCP server that uses stdio runs a command. A person reads the command before Bowerloom writes it into an engine.';
export const REFERENCE_APPROVAL = 'This MCP server holds a ${NAME} reference in its command, arguments, URL, environment, or headers, so it could send that value anywhere. A person checks where it goes.';

/** Splits the keys of an object into a private block and permission-like keys, which are listed as unmapped. */
export function privateKeys(ctx: Context, value: Obj, path: string, base: string, part: Parameters<Context['r']['miss']>[1], gate: Gate = 'none', found?: { secret: boolean }): Obj {
  const out: Obj = {};
  const strip = (v: JsonValue, at: string): JsonValue | undefined => {
    if (Array.isArray(v)) return v.map((x, i) => strip(x, `${at}/${i}`) ?? null);
    if (!isObj(v)) return v;
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      if (secretName(k)) { ctx.r.miss(path, part, SECRET_NAME_REASON, `${at}${kp(v, k)}`, gate); if (found) found.secret = true; continue; }
      if (isPermissionKey(k)) { ctx.r.miss(path, part, PERMISSION_REASON, `${at}${kp(v, k)}`, gate); continue; }
      const s = strip(x, `${at}${kp(v, k)}`);
      if (s !== undefined) o[k] = s;
    }
    return o;
  };
  for (const [k, v] of Object.entries(value)) {
    if (secretName(k)) { ctx.r.miss(path, part, SECRET_NAME_REASON, `${base}${kp(value, k)}`, gate); if (found) found.secret = true; continue; }
    if (isPermissionKey(k)) { ctx.r.miss(path, part, PERMISSION_REASON, `${base}${kp(value, k)}`, gate); continue; }
    const s = strip(v, `${base}${kp(value, k)}`);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

/** A private block for each engine, with every secret replaced. Returns the block and the replaced secrets. */
export function blockOf(engines: readonly EngineId[], value: Obj, path: string, base: string, hint: string): { blocks: Blocks; secrets: { path: string; pointer: string; reference: string }[] } {
  if (Object.keys(value).length === 0 || engines.length === 0) return { blocks: {}, secrets: [] };
  const scrubbed = scrubTree(value, hint, base);
  const blocks: Blocks = {};
  for (const e of engines) blocks[e] = scrubbed.value;
  return { blocks, secrets: scrubbed.replaced.map(x => ({ path, pointer: x.pointer, reference: x.reference })) };
}

/** The leftover keys of a settings file: an engine-private file under `engines/<engine>/`, with secrets replaced. */
export function leftovers(ctx: Context, engine: EngineId, path: string, value: Obj, file: string, shape: string): void {
  if (!ctx.engines.includes(engine)) return;
  const kept = privateKeys(ctx, value, path, '', 'engine-private');
  if (Object.keys(kept).length === 0) return;
  const scrubbed = scrubTree(kept, engine.replace(/-/g, '_'));
  ctx.cands.push({
    part: 'engine-private', id: `engines/${engine}/${file}`, engine, value: scrubbed.value as Obj,
    place: place(path, [engine], shape, engine), blocks: {}, notes: ['Keys with no neutral form, kept unchanged for this engine only.'],
    needsApproval: [], secrets: scrubbed.replaced.map(x => ({ path, pointer: x.pointer, reference: x.reference })),
  });
}

// ---- hooks ---------------------------------------------------------------------------------------------------------------

/** Events whose command can block an action: a hook on them is `enforced`. Other hooks are `advisory`. */
const BLOCKING = new Set(['PreToolUse', 'UserPromptSubmit', 'PermissionRequest']);
const HANDLER = new Set(['type', 'command', 'timeout']);

/**
 * Hooks in the Claude Code form: `{ <event>: [ { matcher, hooks: [ { type: "command", command, timeout } ] } ] }`.
 * The timeout is in seconds and becomes milliseconds. `rewrite` turns the engine's project folder form into
 * `${PROJECT_DIR}` (locked-in parts spec, section 7.3 rule 6). `matcher`, when given, turns the engine's tool names
 * into the Claude Code names a neutral matcher uses.
 */
export function readHooks(ctx: Context, value: JsonValue, at: { path: string; base: string; engine: EngineId; shape: string; rewrite: (command: string) => string; matcher?: (matcher: string) => string }): void {
  const { r } = ctx;
  if (!ctx.engines.includes(at.engine)) return;
  if (!isObj(value)) { r.miss(at.path, 'hooks', 'The hooks are not an object of events, so they are not adopted.', at.base); return; }
  for (const [event, groups] of Object.entries(value)) {
    const ep = `${at.base}${kp(value, event)}`;
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event) || !Array.isArray(groups)) { r.miss(at.path, 'hooks', 'This is not an event name with a list of hook groups.', ep); continue; }
    groups.forEach((group, gi) => {
      const gp = `${ep}/${gi}`;
      if (!isObj(group) || !Array.isArray(group.hooks)) { r.miss(at.path, 'hooks', 'A hook group needs a list of hooks.', gp); return; }
      const matcher = group.matcher;
      if (matcher !== undefined && matcher !== '' && !oneLine(matcher, 1024)) { r.miss(at.path, 'hooks', 'The matcher is not one line of text.', `${gp}/matcher`); return; }
      const groupFound = { secret: false };
      const groupExtra = privateKeys(ctx, Object.fromEntries(Object.entries(group).filter(([k]) => k !== 'matcher' && k !== 'hooks')), at.path, gp, 'hooks', 'none', groupFound);
      if (groupFound.secret) return;
      group.hooks.forEach((h, hi) => {
        const hp = `${gp}/hooks/${hi}`;
        if (!isObj(h) || h.type !== 'command') { r.miss(at.path, 'hooks', 'Only command hooks are portable. Other handler types are absent in the other engines (locked-in parts spec, section 7.3 rule 1).', hp); return; }
        if (!oneLine(h.command, DEFINITION_LIMITS.lineChars)) { r.miss(at.path, 'hooks', 'The command is not one line of at most 4,096 characters.', hp); return; }
        if (secretRule('command', h.command) !== null) { r.miss(at.path, 'hooks', 'The command holds a value that looks like a secret. Adoption never copies a secret value, and one inside a command cannot be replaced with a reference safely.', hp); return; }
        let timeout: number | undefined;
        if (h.timeout !== undefined) {
          const ms = typeof h.timeout === 'number' ? Math.round(h.timeout * 1000) : NaN;
          if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 86_400_000) { r.miss(at.path, 'hooks', 'The timeout is not a number of seconds above 0 and at most one day, so the hook is adopted without it.', `${hp}/timeout`); }
          else timeout = ms;
        }
        const handlerFound = { secret: false };
        const extra = { ...groupExtra, ...privateKeys(ctx, Object.fromEntries(Object.entries(h).filter(([k]) => !HANDLER.has(k))), at.path, hp, 'hooks', 'none', handlerFound) };
        if (handlerFound.secret) return;
        const { blocks, secrets } = blockOf([at.engine], extra, at.path, hp, `${event}_hook`);
        ctx.cands.push({
          part: 'hooks', id: '', place: place(at.path, [at.engine], at.shape, at.engine, { pointer: hp }), blocks, secrets,
          hook: { event, ...(typeof matcher === 'string' && matcher !== '' ? { matcher: at.matcher ? at.matcher(matcher) : matcher } : {}), command: at.rewrite(h.command), ...(timeout !== undefined ? { timeout } : {}), strength: BLOCKING.has(event) ? 'enforced' : 'advisory' },
          needsApproval: [HOOK_APPROVAL],
          notes: BLOCKING.has(event) ? ['The event can block an action, so the hook is enforced.'] : ['The event cannot block an action, so the hook is advisory.'],
        });
      });
    });
  }
}

// ---- MCP servers ---------------------------------------------------------------------------------------------------------

export interface ServerInput {
  readonly path: string;
  readonly base: string;
  readonly engines: readonly EngineId[];
  readonly owner: EngineId;
  readonly shape: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly command?: JsonValue;
  readonly args?: JsonValue;
  readonly url?: JsonValue;
  readonly env?: JsonValue;
  readonly headers?: JsonValue;
  readonly timeout?: number;
  readonly enabled?: JsonValue;
  /** Keys with no neutral form. Permission-like ones are listed; the others go to a private block. */
  readonly extra: Obj;
  readonly notes?: readonly string[];
}

const PORTABLE_REF = /^(?:[^$]|\$\{[A-Za-z_][A-Za-z0-9_]*\})*$/;

/** One MCP server as a candidate. A server the neutral form cannot carry is listed with the reason. */
export function addServer(ctx: Context, s: ServerInput): void {
  const { r } = ctx;
  const engines = s.engines.filter(e => ctx.engines.includes(e));
  if (engines.length === 0) return;
  const miss = (reason: string, pointer = s.base): void => r.miss(s.path, 'mcp', reason, pointer);
  if (secretName(s.name)) return miss(SECRET_NAME_REASON);
  if (!isServerName(s.name)) return miss('The server name is not letters, digits, _ and -, up to 64 characters.');
  const secrets: { path: string; pointer: string; reference: string }[] = [];
  const server: { -readonly [K in keyof import('./model.js').ServerShape]: import('./model.js').ServerShape[K] } = { transport: s.transport };
  if (s.transport === 'stdio') {
    if (!oneLine(s.command)) return miss('A stdio server needs a command of one line.');
    if (secretRule('command', s.command) !== null) return miss('The command holds a value that looks like a secret, and one inside a command cannot be replaced with a reference safely.');
    server.command = s.command;
    if (s.args !== undefined) {
      if (!Array.isArray(s.args) || s.args.some(a => typeof a !== 'string')) return miss('The arguments are not a list of text.');
      const scrubbed = scrubTree(s.args, `${s.name}_arg`, `${s.base}/args`, 'args');
      for (const x of scrubbed.replaced) secrets.push({ path: s.path, pointer: x.pointer, reference: x.reference });
      server.args = scrubbed.value as string[];
    }
  } else {
    if (typeof s.url !== 'string') return miss(`A ${s.transport} server needs a URL.`);
    let url: URL;
    try { url = new URL(s.url); } catch { return miss('The URL does not parse.'); }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return miss('The URL must use http, https, ws, or wss.');
    if (secretRule('url', s.url) !== null) return miss('The URL holds a value that looks like a secret. The neutral URL is a literal, so a reference cannot take its place.');
    server.url = s.url;
  }
  for (const field of ['env', 'headers'] as const) {
    const v = s[field];
    if (v === undefined) continue;
    if (!isObj(v)) return miss(`The ${field} is not a map of text.`);
    const out: Record<string, EnvValue> = {};
    for (const [k, x] of Object.entries(v)) {
      if (secretName(k)) return miss(SECRET_NAME_REASON, `${s.base}/${field}${kp(v, k)}`);
      if (typeof x !== 'string') return miss(`A value of ${field} is not text.`, `${s.base}/${field}${kp(v, k)}`);
      if (!PORTABLE_REF.test(x)) return miss(`A value of ${field} uses a $ form other than \${NAME}, such as \${NAME:-x} or $NAME. It is not portable, and Bowerloom never copies it as literal text.`, `${s.base}/${field}${kp(v, k)}`);
      const name = field === 'env' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : referenceName(s.name, k);
      const got = withoutSecret(k, x, name);
      if (got.replaced) secrets.push({ path: s.path, pointer: `${s.base}/${field}${kp(v, k)}`, reference: `\${${name}}` });
      out[k] = got.value;
    }
    server[field] = out;
  }
  if (s.timeout !== undefined) {
    if (Number.isSafeInteger(s.timeout) && s.timeout > 0 && s.timeout <= 86_400_000) server.timeout = s.timeout;
    else miss('The timeout is not a whole number of milliseconds above 0 and at most one day, so the server is adopted without it.', `${s.base}/timeout`);
  }
  if (s.enabled !== undefined) { if (typeof s.enabled === 'boolean') server.enabled = s.enabled; else miss('enabled is not true or false, so the server is adopted without it.', `${s.base}/enabled`); }
  const found = { secret: false };
  const extra = privateKeys(ctx, s.extra, s.path, s.base, 'mcp', 'none', found);
  if (found.secret) return;
  const { blocks, secrets: blockSecrets } = blockOf([s.owner].filter(e => engines.includes(e)), extra, s.path, s.base, s.name);
  // Ruling A7: a reference anywhere the server reads it, its command, arguments, URL, environment, or headers.
  const refs = [server.command, server.url, ...(server.args ?? []), ...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {})].some(v => typeof v === 'string' && v.includes('${'));
  const p: Place = place(s.path, engines, s.shape, s.owner, { pointer: s.base });
  ctx.cands.push({
    part: 'mcp', id: s.name, server, place: p, blocks, secrets: [...secrets, ...blockSecrets], notes: [...(s.notes ?? [])],
    needsApproval: [...(s.transport === 'stdio' ? [STDIO_APPROVAL] : []), ...(refs ? [REFERENCE_APPROVAL] : [])],
  });
}

/** The servers of a `mcpServers` map in the Claude Code form (Claude Code `.mcp.json`, Pi `mcp.json`). */
export function readMcpServers(ctx: Context, value: JsonValue, at: { path: string; base: string; engines: readonly EngineId[]; owner: EngineId; shape: string }): void {
  if (!isObj(value)) { ctx.r.miss(at.path, 'mcp', 'mcpServers is not an object of servers.', at.base); return; }
  for (const [name, cfg] of Object.entries(value)) {
    const base = `${at.base}${kp(value, name)}`;
    if (!isObj(cfg)) { ctx.r.miss(at.path, 'mcp', 'This server is not an object.', base); continue; }
    const type = cfg.type ?? (cfg.url !== undefined && cfg.command === undefined ? 'http' : 'stdio');
    const transport = type === 'streamable-http' ? 'http' : type;
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse' && transport !== 'ws') { ctx.r.miss(at.path, 'mcp', 'The transport is not stdio, http, sse, or ws.', `${base}/type`); continue; }
    const known = new Set(['type', 'command', 'args', 'url', 'env', 'headers', 'timeout', 'enabled']);
    const timeout = cfg.timeout;
    if (timeout !== undefined && typeof timeout !== 'number') { ctx.r.miss(at.path, 'mcp', 'The timeout is not a number, so the server is adopted without it.', `${base}/timeout`); }
    addServer(ctx, {
      ...at, base, name, transport,
      ...(cfg.command !== undefined ? { command: cfg.command } : {}), ...(cfg.args !== undefined ? { args: cfg.args } : {}),
      ...(cfg.url !== undefined ? { url: cfg.url } : {}), ...(cfg.env !== undefined ? { env: cfg.env } : {}),
      ...(cfg.headers !== undefined ? { headers: cfg.headers } : {}), ...(typeof timeout === 'number' ? { timeout } : {}),
      ...(cfg.enabled !== undefined ? { enabled: cfg.enabled } : {}),
      extra: Object.fromEntries(Object.entries(cfg).filter(([k]) => !known.has(k))),
    });
  }
}

/**
 * Comments and trailing commas removed from JSONC text, outside strings. Null when a string or a block comment does not
 * close. Strict JSON parses the result, so a duplicate key is still refused.
 */
export function stripJsonc(text: string): string | null {
  let out = '', i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) { if (text[j] === '\\') j++; if (text[j] === '\n') return null; }
      if (j >= text.length) return null;
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end === -1) return null; out += ' '; i = end + 2; continue; }
    out += c; i++;
  }
  // Trailing commas, outside strings.
  let result = '', inString = false;
  for (let k = 0; k < out.length; k++) {
    const c = out[k]!;
    if (inString) { result += c; if (c === '\\') { result += out[++k] ?? ''; } else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; result += c; continue; }
    if (c === ',') { let n = k + 1; while (n < out.length && /\s/.test(out[n]!)) n++; if (out[n] === '}' || out[n] === ']') continue; }
    result += c;
  }
  return result;
}

/** Reads a JSON (or JSONC) file of an engine. Null after listing it as unmapped when it is not a JSON object. */
export function readJson(ctx: Context, path: string, part: Parameters<Context['r']['miss']>[1], jsonc = false, guard?: { engine: EngineId; action: LostAction }): Obj | null {
  const gate: Gate = guard ? 'acknowledge' : 'none';
  const f = ctx.r.file(path, part, gate);
  if (!f) { if (guard && ctx.r.unmapped.some(u => u.path === path)) lose(ctx, guard.engine, guard.action); return null; }
  const text = utf8(f.bytes);
  const source = text === null ? null : jsonc ? stripJsonc(text) : text;
  const parsed = source === null ? null : parseStrictJson(source);
  if (!parsed || !parsed.ok || !isObj(parsed.value)) {
    ctx.r.miss(path, part, `This file is not a ${jsonc ? 'JSONC' : 'strict JSON'} object adoption can read: comments${jsonc ? ' are fine, but' : ','} duplicate keys and values that are not JSON are refused. It is not adopted.`, undefined, gate);
    if (guard) lose(ctx, guard.engine, guard.action);
    return null;
  }
  return parsed.value;
}

// ---- private blocks that run or reach something (ruling A9) ------------------------------------------------------------

export const RISK_APPROVAL = 'This private block holds a command, a URL, or a credential helper. The engine runs or contacts it, so a person reads it before Bowerloom writes it.';
/** Words of a key that name a command, a place the engine reaches, or a credential helper. */
const RISK_WORDS = new Set([
  'url', 'urls', 'uri', 'endpoint', 'host', 'base', 'command', 'cmd', 'exec', 'run', 'script', 'program', 'binary', 'bin',
  'path', 'refresh', 'export', 'notify', 'helper', 'auth', 'oauth', 'credential', 'credentials', 'login', 'token', 'marketplace',
  'marketplaces', 'plugin', 'plugins', 'provider', 'providers', 'server', 'servers', 'source', 'sources', 'repo', 'repository',
  'hook', 'hooks', 'launch', 'shell', 'socket', 'proxy',
]);
const riskyKey = (key: string): boolean => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).some(w => RISK_WORDS.has(w));
const riskyText = (v: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(?:\/|\.\.?\/|~\/)/.test(v) || v.includes('$(') || v.includes('`');

/**
 * True when a private block holds a command, a URL, or a credential helper: a key named for one, or a value that looks
 * like a URL, a path, or a command substitution. The contract refuses the keys that run a command or grant trust
 * (`isPermissionKey`, step 3); this check also catches a value such as a URL under a plain key.
 */
export function riskOf(value: JsonValue): boolean {
  if (typeof value === 'string') return riskyText(value);
  if (Array.isArray(value)) return value.some(riskOf);
  if (isObj(value)) return Object.entries(value).some(([k, v]) => riskyKey(k) || riskOf(v));
  return false;
}
