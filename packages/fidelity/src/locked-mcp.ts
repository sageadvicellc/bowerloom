/**
 * MCP servers (locked-in parts spec, section 5; capability matrix of section 10). One server form per engine, in
 * memory, and one loss line or more per server. MCP servers are advisory, so no line here refuses a projection; a
 * server that an engine cannot carry is not written, and its line says why.
 *
 * - Claude Code 2.1.310 and Pi 1.4.0: the `.mcp.json` shape. Claude Code expands `${NAME}` in every field. Pi expands it
 *   in `env` and `headers` only, and documents no timeout.
 * - Codex 0.157.0: a `[mcp_servers.<name>]` table. Codex documents no expansion, so a reference becomes `env_vars`,
 *   `bearer_token_env_var`, or `env_http_headers`, or the server is not written.
 * - OpenCode 1.18.30: the `mcp` key, `command` as one array, `{env:NAME}` for a reference.
 * - DeepSeek Harness 0.2.2-alpha.2: one `@deepseek-ai/dsh-mcp-client` plugin row, with `!!js` for a reference, in a
 *   patch file the person passes with `--patch` (check 15). Read from the README of that package at the pinned tag.
 * - `sse` and `ws` have no Codex, OpenCode, Pi, or DeepSeek Harness result (section 5.3 rule 3).
 * - A keychain reference is never written into an engine file: the server is absent.
 */
import type { EngineId, EnvValue, JsonValue, McpServer } from '../../harness-definition/src/index.js';
import { Lines, addPrivate, holdsEnvDefault, privateLine, referenceParts, references, type LockedProblem } from './locked-common.js';

/** A JavaScript expression that DeepSeek Harness evaluates, written with the YAML tag `!!js`. */
export interface JsExpression { readonly js: string }
/** A value of a DeepSeek Harness row: JSON, or a `!!js` expression at any depth. */
export type DshValue = string | number | boolean | null | JsExpression | readonly DshValue[] | { readonly [key: string]: DshValue };
export interface DshRow { readonly id: string; readonly name: string; readonly config: { readonly [key: string]: DshValue } }

/** The plugin that DeepSeek Harness uses for one MCP server, at the pinned tag. */
export const DSH_MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client';

export type McpServerForm =
  | { readonly engine: 'claude-code' | 'pi' | 'opencode'; readonly name: string; readonly value: { readonly [key: string]: JsonValue } }
  | { readonly engine: 'codex'; readonly name: string; readonly table: readonly (readonly [string, JsonValue])[] }
  | { readonly engine: 'deepseek-harness'; readonly name: string; readonly row: DshRow };

export interface McpTranslation {
  readonly engine: EngineId;
  readonly servers: readonly McpServerForm[];
  readonly lines: readonly import('../../harness-definition/src/index.js').LossLine[];
  readonly problems: readonly LockedProblem[];
}

const isKeychain = (v: EnvValue): boolean => typeof v !== 'string';
const textOf = (map: Readonly<Record<string, EnvValue>> | undefined): Record<string, string> => Object.fromEntries(Object.entries(map ?? {}).map(([k, v]) => [k, v as string]));
const hasRef = (s: string | undefined): boolean => s !== undefined && references(s).names.length > 0;
const plainFields = (s: McpServer): string[] => [s.command, ...(s.args ?? []), s.url].filter((x): x is string => x !== undefined);

/** Translates the servers that apply to one engine. */
export function translateMcp(engine: EngineId, servers: readonly McpServer[]): McpTranslation {
  const out = new Lines('mcp', engine);
  const forms: McpServerForm[] = [];
  for (const s of servers) {
    if (holdsEnvDefault(s)) { out.envDefault(s.id); continue; }
    if ([...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})].some(isKeychain)) {
      out.line(s.id, 'absent', 'The server holds a keychain reference. Bowerloom never writes a keychain value into an engine file, and no engine reads the keychain itself, so the server is not written.');
      continue;
    }
    const form = (() => {
      switch (engine) {
        case 'claude-code': case 'pi': return claudeShape(engine, s, out);
        case 'codex': return codex(s, out);
        case 'opencode': return openCode(s, out);
        case 'deepseek-harness': return dsh(s, out);
      }
    })();
    if (form) forms.push(form);
  }
  return { engine, servers: forms, lines: out.lines, problems: out.problems };
}

function claudeShape(engine: 'claude-code' | 'pi', s: McpServer, out: Lines): McpServerForm | null {
  const name = engine === 'pi' ? 'Pi' : 'Claude Code';
  const file = engine === 'pi' ? '.pi/mcp.json' : '.mcp.json';
  if (engine === 'pi' && (s.transport === 'sse' || s.transport === 'ws')) { out.line(s.id, 'absent', `Pi documents stdio and HTTP servers only, so a ${s.transport} server is not written.`); return null; }
  if (engine === 'pi' && plainFields(s).some(hasRef)) { out.line(s.id, 'absent', 'Pi expands ${NAME} in env and headers only, so a reference in the command, its arguments, or the URL would stay literal. The server is not written.'); return null; }
  if (s.enabled === false) { out.line(s.id, 'translated', `${name} has no enabled flag in ${file}, so a disabled server is not written.`); return null; }
  const value: [string, JsonValue][] = [['type', s.transport]];
  if (s.command !== undefined) value.push(['command', s.command]);
  if (s.args !== undefined) value.push(['args', [...s.args]]);
  if (s.env !== undefined) value.push(['env', textOf(s.env)]);
  if (s.url !== undefined) value.push(['url', s.url]);
  if (s.headers !== undefined) value.push(['headers', textOf(s.headers)]);
  if (s.timeout !== undefined) {
    if (engine === 'claude-code') value.push(['timeout', s.timeout]);
    else out.line(s.id, 'absent', 'Pi documents no timeout for a server, so the timeout is not written.', 'timeout');
  }
  const { dropped } = addPrivate(value, s.privateBlocks[engine]);
  privateLine(out, s.id, dropped, file);
  out.line(s.id, 'exact', `${name} reads the server in ${file} with the same fields.${engine === 'pi' ? ' Pending trust: Pi skips files under .pi/ in non-interactive runs until a person saves trust.' : ''}`);
  return { engine, name: s.name, value: Object.fromEntries(value) };
}

function codex(s: McpServer, out: Lines): McpServerForm | null {
  if (s.transport === 'sse' || s.transport === 'ws') { out.line(s.id, 'absent', `Codex has no ${s.transport} transport: it runs a command or calls a streamable HTTP URL. The server is not written.`); return null; }
  if (plainFields(s).some(hasRef)) { out.line(s.id, 'absent', 'Codex documents no expansion of ${NAME} in a command, its arguments, or a URL, so the reference would stay literal. The server is not written.'); return null; }
  const table: [string, JsonValue][] = [];
  const notes: string[] = [];
  if (s.command !== undefined) table.push(['command', s.command]);
  if (s.args !== undefined) table.push(['args', [...s.args]]);
  if (s.env !== undefined) {
    const env: Record<string, string> = {}, vars: string[] = [];
    for (const [k, v] of Object.entries(textOf(s.env))) {
      const r = references(v);
      if (r.names.length === 0) env[k] = v;
      else if (r.whole === k) vars.push(k);
      else { out.line(s.id, 'absent', `Codex documents no expansion in env: it passes a variable by its own name only, through env_vars. The value of ${k} names another variable or mixes text with one, so the server is not written.`); return null; }
    }
    if (Object.keys(env).length) table.push(['env', env]);
    if (vars.length) { table.push(['env_vars', vars]); notes.push('a ${NAME} value becomes env_vars, which passes that variable from the environment'); }
  }
  if (s.url !== undefined) table.push(['url', s.url]);
  if (s.headers !== undefined) {
    const plain: Record<string, string> = {}, fromEnv: Record<string, string> = {};
    let bearer: string | null = null;
    for (const [k, v] of Object.entries(textOf(s.headers))) {
      const r = references(v);
      const token = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(v)?.[1];
      if (r.names.length === 0) plain[k] = v;
      else if (k.toLowerCase() === 'authorization' && token !== undefined && bearer === null) bearer = token;
      else if (r.whole !== null) fromEnv[k] = r.whole;
      else { out.line(s.id, 'absent', `Codex documents no expansion in headers. The header ${k} mixes text with a reference in a form Codex cannot carry, so the server is not written.`); return null; }
    }
    if (bearer !== null) { table.push(['bearer_token_env_var', bearer]); notes.push('the Authorization header becomes bearer_token_env_var'); }
    if (Object.keys(plain).length) table.push(['http_headers', plain]);
    if (Object.keys(fromEnv).length) { table.push(['env_http_headers', fromEnv]); notes.push('a ${NAME} header becomes env_http_headers'); }
  }
  if (s.timeout !== undefined) { table.push(['tool_timeout_sec', s.timeout / 1000]); notes.push(`the timeout of ${s.timeout} ms becomes tool_timeout_sec = ${s.timeout / 1000} seconds`); }
  if (s.enabled !== undefined) table.push(['enabled', s.enabled]);
  const { dropped } = addPrivate(table, s.privateBlocks.codex, true);
  privateLine(out, s.id, dropped, 'TOML');
  out.line(s.id, 'translated', `Codex carries the server as the table mcp_servers.${s.name} in .codex/config.toml${notes.length ? `: ${notes.join('; ')}` : ''}. Codex reads a project .codex folder only after a person trusts the project.`);
  return { engine: 'codex', name: s.name, table };
}

const openCodeText = (v: string): string => v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '{env:$1}');
const openCodeMap = (m: Readonly<Record<string, EnvValue>>): Record<string, string> => Object.fromEntries(Object.entries(textOf(m)).map(([k, v]) => [k, openCodeText(v)]));

function openCode(s: McpServer, out: Lines): McpServerForm | null {
  if (s.transport === 'sse' || s.transport === 'ws') { out.line(s.id, 'absent', `OpenCode has local and remote servers only, so a ${s.transport} server is not written.`); return null; }
  const all = [...plainFields(s), ...Object.values(textOf(s.env)), ...Object.values(textOf(s.headers))];
  if (all.some(v => /\{(?:env|file):/.test(v))) { out.line(s.id, 'absent', 'OpenCode replaces {env:...} and {file:...} anywhere in its file, so a value that holds one as literal text would change meaning. The server is not written.'); return null; }
  const value: [string, JsonValue][] = [];
  if (s.transport === 'stdio') {
    value.push(['type', 'local'], ['command', [s.command!, ...(s.args ?? [])].map(openCodeText)]);
    if (s.env !== undefined) value.push(['environment', openCodeMap(s.env)]);
  } else {
    value.push(['type', 'remote'], ['url', openCodeText(s.url!)]);
    if (s.headers !== undefined) value.push(['headers', openCodeMap(s.headers)]);
  }
  if (s.enabled !== undefined) value.push(['enabled', s.enabled]);
  if (s.timeout !== undefined) value.push(['timeout', s.timeout]);
  const { dropped } = addPrivate(value, s.privateBlocks.opencode);
  privateLine(out, s.id, dropped, 'opencode.json');
  out.line(s.id, 'translated', `OpenCode carries the server under mcp in opencode.json as a ${s.transport === 'stdio' ? 'local server whose command is one array' : 'remote server'}; a \${NAME} reference becomes {env:NAME}.`);
  return { engine: 'opencode', name: s.name, value: Object.fromEntries(value) };
}

/** A DeepSeek Harness value: plain text, or a `!!js` expression for a text with references. */
function dshText(v: string): DshValue {
  const r = references(v);
  if (r.names.length === 0) return v;
  if (r.whole !== null) return { js: `process.env.${r.whole}` };
  const body = referenceParts(v).map(p => 'name' in p ? `\${process.env.${p.name}}` : p.literal.replace(/[\\`$]/g, c => `\\${c}`)).join('');
  return { js: `\`${body}\`` };
}
const dshMap = (m: Readonly<Record<string, EnvValue>>): Record<string, DshValue> => Object.fromEntries(Object.entries(textOf(m)).map(([k, v]) => [k, dshText(v)]));

function dsh(s: McpServer, out: Lines): McpServerForm | null {
  if (s.transport === 'sse' || s.transport === 'ws') { out.line(s.id, 'absent', `DeepSeek Harness has stdio and streamable-http servers only, so a ${s.transport} server is not written.`); return null; }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s.name)) { out.line(s.id, 'absent', 'DeepSeek Harness takes a server name of at most 32 letters, digits, _, and -, so the server is not written.'); return null; }
  if (s.enabled === false) { out.line(s.id, 'translated', 'A DeepSeek Harness row has no enabled flag, so a disabled server is not written.'); return null; }
  const config: Record<string, DshValue> = { serverName: s.name, transport: s.transport === 'stdio' ? 'stdio' : 'streamable-http' };
  if (s.command !== undefined) config.command = dshText(s.command);
  if (s.args !== undefined) config.args = s.args.map(dshText);
  if (s.env !== undefined) config.env = dshMap(s.env);
  if (s.url !== undefined) config.url = dshText(s.url);
  if (s.headers !== undefined) config.headers = dshMap(s.headers);
  if (s.timeout !== undefined) config.toolCallTimeoutMs = s.timeout;
  const entries = Object.entries(config) as [string, JsonValue][];
  const { dropped } = addPrivate(entries, s.privateBlocks['deepseek-harness']);
  privateLine(out, s.id, dropped, 'the patch file');
  out.line(s.id, 'translated', `DeepSeek Harness carries the server as one ${DSH_MCP_PLUGIN} row in .dsh/bowerloom.patch.yml, a file Bowerloom owns. The person passes it with dsh --patch .dsh/bowerloom.patch.yml; Bowerloom never edits cordis.patch.yml. A \${NAME} reference becomes a !!js expression that reads process.env. Every DeepSeek Harness release is a prerelease, so the live check of step 5 confirms the row.`);
  return { engine: 'deepseek-harness', name: s.name, row: { id: `bowerloom-mcp-${s.name}`, name: DSH_MCP_PLUGIN, config: Object.fromEntries(entries) as Record<string, DshValue> } };
}
