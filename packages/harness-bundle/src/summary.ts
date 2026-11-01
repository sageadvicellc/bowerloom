/**
 * What a bundle holds, for a person to read: the counts, the tools, the files that can run, the references the file reads from this computer, the notes names, the
 * borrowed items, and the text that holds a path of another computer. Pure: it reads no disk and starts nothing. It works from a loaded definition (the files with a
 * placeholder source for each notes name), so `encodeBundle` and `inspectBundle` give the same summary for the same files.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, oneLine } from '../../contracts/src/index.js';
import type { Definition, DefinitionFile, HookEntry, McpServer } from '../../harness-definition/src/index.js';
import { addressOf } from './address.js';
import { BundleRefusal } from './codes.js';
import { codeWhy } from './code-files.js';
import { BUNDLE_LIMITS } from './limits.js';
import type {
  BundleCodeFile, BundleForeignPath, BundleNameValue, BundleNote, BundleSecret, BundleSink, BundleSinkField, BundleSource, BundleSummary, BundleTool, EncodeOptions,
} from './types.js';

export const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Text for the summary, cut to BUNDLE_LIMITS.displayChars code points, with an ellipsis when it was cut. It is plain text; the caller makes it safe to show. */
export function cut(text: string, limit: number = BUNDLE_LIMITS.displayChars): string {
  if (text.length <= limit) return text;
  // At most `limit * 2 + 2` units are looked at, which holds more than `limit` code points when the text is longer; a pair of surrogates is never split.
  const head = Array.from(text.slice(0, limit * 2 + 2));
  return head.length <= limit && text.length <= limit * 2 + 2 ? text : `${head.slice(0, limit).join('')}\u2026`;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const entryHash = (entry: unknown): string => sha256Hex(canonicalJson(JSON.parse(JSON.stringify(entry)) as unknown));

// ---- references ---------------------------------------------------------------------------------------------------------------

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

class Secrets {
  private readonly byKey = new Map<string, { kind: 'env' | 'keychain'; name: string; sinks: Map<string, BundleSink> }>();
  add(kind: 'env' | 'keychain', name: string, sink: BundleSink): void {
    const key = `${kind}\0${name}`;
    let entry = this.byKey.get(key);
    if (entry === undefined) { entry = { kind, name, sinks: new Map() }; this.byKey.set(key, entry); }
    entry.sinks.set(`${sink.tool}\0${sink.field}\0${sink.host ?? ''}`, sink);
  }
  /** `${NAME}` references in a text. */
  text(value: string, tool: string, field: BundleSinkField, host: string | undefined): void {
    for (const m of value.matchAll(REFERENCE)) this.add('env', cut(m[1]!), { tool, field, ...(host !== undefined ? { host } : {}) });
  }
  /** A value of an env or header map: text with references, or a keychain reference. */
  value(value: unknown, tool: string, field: BundleSinkField, host: string | undefined): void {
    if (typeof value === 'string') this.text(value, tool, field, host);
    else if (value !== null && typeof value === 'object' && typeof (value as { keychain?: unknown }).keychain === 'string') {
      this.add('keychain', cut((value as { keychain: string }).keychain), { tool, field, ...(host !== undefined ? { host } : {}) });
    }
  }
  list(): BundleSecret[] {
    return [...this.byKey.values()]
      .sort((a, b) => byText(a.kind, b.kind) || byText(a.name, b.name))
      .map(e => ({
        kind: e.kind, name: e.name,
        sinks: [...e.sinks.values()].sort((a, b) => byText(a.tool, b.tool) || byText(a.field, b.field) || byText(a.host ?? '', b.host ?? '')),
      }));
  }
}

// ---- tools --------------------------------------------------------------------------------------------------------------------

/** A variable or a header as a row: the value as the file holds it, a keychain reference as its JSON. */
const rowsOf = (map: Readonly<Record<string, unknown>> | undefined): BundleNameValue[] =>
  Object.entries(map ?? {}).map(([name, v]) => ({ name, value: typeof v === 'string' ? v : JSON.stringify(v) }));

/** What follows the authority of an address: path, query and fragment, as written. An address that does not look like `scheme://authority…` is returned whole, so nothing is hidden. */
function pathOf(url: string): string {
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\\]*/.exec(url);
  return m === null ? url : url.slice(m[0].length);
}

function mcpTool(server: McpServer, secrets: Secrets): BundleTool {
  const host = server.url !== undefined ? addressOf(server.url) : undefined;
  const runsCode = server.transport === 'stdio' || server.command !== undefined;
  for (const [, v] of Object.entries(server.env ?? {})) secrets.value(v, server.name, 'env', host?.host);
  for (const [, v] of Object.entries(server.headers ?? {})) secrets.value(v, server.name, 'header', host?.host);
  for (const a of server.args ?? []) secrets.text(a, server.name, 'arg', host?.host);
  if (server.url !== undefined) secrets.text(server.url, server.name, 'url', host?.host);
  if (server.command !== undefined) secrets.text(server.command, server.name, 'command', host?.host);
  return {
    name: server.name, kind: 'mcp', transport: server.transport, runsCode,
    // Whole, never cut: `checkToolText` has refused a bundle whose command or arguments are too long to show.
    ...(server.command !== undefined ? { command: server.command } : {}),
    ...(server.args !== undefined ? { args: [...server.args] } : {}),
    ...(server.env !== undefined && Object.keys(server.env).length > 0 ? { env: rowsOf(server.env) } : {}),
    ...(server.headers !== undefined && Object.keys(server.headers).length > 0 ? { headers: rowsOf(server.headers) } : {}),
    ...(server.url !== undefined && pathOf(server.url) !== '' ? { path: pathOf(server.url) } : {}),
    ...(host !== undefined ? { host: host.host } : {}),
    ...(host !== undefined && host.flags.length > 0 ? { addressFlags: host.flags } : {}),
    sha256: entryHash(server),
  };
}

function hookTool(hook: HookEntry, secrets: Secrets): BundleTool {
  secrets.text(hook.command, hook.id, 'command', undefined);
  return { name: hook.id, kind: 'hook', runsCode: true, command: hook.command, event: hook.event, sha256: entryHash(hook) };
}

/**
 * Refuses `BUNDLE_INVALID` when a tool could not be shown whole: an MCP command, an argument, a hook command, a variable or header name or value, or a url of more than
 * `BUNDLE_LIMITS.commandChars` characters, or a server with more than `BUNDLE_LIMITS.toolArgs` arguments, variables or headers. The acknowledgement binds the whole entry of a tool that runs code or reaches a host, so what a person reads must be the
 * whole entry. The refusal names each tool by the words "a tool's command or arguments are too long to show in full", and its problems carry the same words by code.
 */
export function checkToolText(def: Definition): void {
  const long: string[] = [];
  const over = (text: string | undefined): boolean => text !== undefined && text.length > BUNDLE_LIMITS.commandChars;
  const rowsOver = (map: Readonly<Record<string, unknown>> | undefined): boolean =>
    rowsOf(map).length > BUNDLE_LIMITS.toolArgs || rowsOf(map).some(r => over(r.name) || over(r.value));
  for (const s of def.entries.mcp) {
    if (over(s.command) || (s.args?.length ?? 0) > BUNDLE_LIMITS.toolArgs || (s.args ?? []).some(a => over(a)) || over(s.url) || rowsOver(s.env) || rowsOver(s.headers)) long.push(`mcp.json: ${s.name}`);
  }
  for (const h of def.entries.hooks) if (over(h.command)) long.push(`hooks.json: ${h.id}`);
  if (long.length === 0) return;
  throw new BundleRefusal(
    'BUNDLE_INVALID',
    long.map(l => `a tool's command or arguments are too long to show in full (${l})`),
    [{ code: 'TOOL_TEXT_TOO_LONG', path: long[0]!.split(':')[0]!, message: `A tool's command is too long to show in full: at most ${BUNDLE_LIMITS.commandChars} characters in a text, and ${BUNDLE_LIMITS.toolArgs} arguments, variables or headers.` }],
  );
}

// ---- paths of another computer --------------------------------------------------------------------------------------------------

/** What follows the start of a path, up to a space, a quote, a bracket, a separator of a list, or a glob character. */
const TAIL = '[^\\s"\'`<>()\\[\\]{},;|*?!]';
const BEFORE_POSIX = '(?<![\\w.~:/\\\\${}-])';
const ROOTS = 'Users|home|root|Volumes|mnt|media|private|tmp|var|opt|srv|usr|bin|sbin|etc|Applications|Library|nix|snap';
/**
 * Three shapes, in one pass: an absolute POSIX path under a known root (`/Users/…`, `/home/…`), a home path (`~/…`), a Windows drive path (`C:\…`, `C:/…`, and the
 * JSON-escaped `C:\\…`), and a file URL. A path inside a URL (`https://host/home/x`) does not match, because a word character comes before it.
 */
const FOREIGN = new RegExp(
  `${BEFORE_POSIX}(?:\\/(?:${ROOTS})\\/${TAIL}+|~\\/${TAIL}+)|(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\{1,2}|\\/)${TAIL}+|file:\\/\\/${TAIL}+`, 'g',
);
const STANDARD_INTERPRETER = /^\/(?:usr\/)?(?:local\/)?bin\/(?:env|sh|bash|zsh|dash|python3?|node|perl|ruby)$/;
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Most hits listed for one file, and for the whole bundle. A file past its cap ends its list with one line that says so; a bundle past the total ends the whole list with one. The acknowledgement covers the line. */
const HITS_PER_FILE = 100, HITS_IN_ALL = 1000;
export const MORE_PATHS = 'More paths of this kind were found and are not listed.';

function foreignPaths(files: readonly DefinitionFile[], options: EncodeOptions | undefined): BundleForeignPath[] {
  const found: BundleForeignPath[] = [];
  const home = options?.home !== undefined && options.home.length > 1 ? options.home.replace(/\/+$/, '') : undefined;
  const user = options?.user !== undefined && options.user.length >= 3 ? options.user : undefined;
  const literal = [
    ...(home !== undefined && home.length > 1 ? [`${escapeRegExp(home)}${TAIL}*`] : []),
    ...(user !== undefined ? [`(?<![A-Za-z0-9_])${escapeRegExp(user)}(?![A-Za-z0-9_])`] : []),
  ];
  const re = literal.length > 0 ? new RegExp(`${FOREIGN.source}|${literal.join('|')}`, 'g') : new RegExp(FOREIGN.source, 'g');
  for (const file of files) {
    // Text that is not UTF-8, or holds a NUL (UTF-8 with a stray byte, a script with a trailing NUL), is read as bytes: a path is made of ASCII, which survives.
    let text: string;
    try { text = strictUtf8.decode(file.bytes); if (text.includes('\0')) throw new Error('NUL'); } catch {
      text = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.length).toString('latin1').replace(/\0/g, ' ');
    }
    const seen = new Set<string>();
    let line = 1, scanned = 0, perFile = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index!;
      for (const brk of text.slice(scanned, at).matchAll(/\r\n|\r|\n/g)) { void brk; line += 1; }
      scanned = at;
      const hit = m[0].replace(/[.:]+$/, '');
      if (hit === '' || (text.slice(Math.max(0, at - 3), at).includes('#!') && STANDARD_INTERPRETER.test(hit))) continue;
      const key = `${line}\0${hit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The cap of a file ends the list of that file, with one line that says so; the next file is scanned. Only the cap of the whole bundle ends the scan.
      if (perFile >= HITS_PER_FILE || found.length >= HITS_IN_ALL) {
        found.push({ path: file.path, text: MORE_PATHS, sha256: sha256Hex(MORE_PATHS) });
        if (found.length >= HITS_IN_ALL) return found;
        break;
      }
      perFile += 1;
      found.push({ path: file.path, line, text: cut(hit), sha256: sha256Hex(hit) });
    }
  }
  return found;
}

// ---- the summary --------------------------------------------------------------------------------------------------------------

/**
 * The summary of a loaded definition. `files` are the bundle's files (never `knowledge.json`), `knowledge` the notes names. `def` was loaded from those files and a
 * placeholder source for each name, so it holds no path of the exporter.
 */
export function summarize(def: Definition, files: readonly DefinitionFile[], knowledge: readonly BundleSource[], options?: EncodeOptions): BundleSummary {
  const secrets = new Secrets();
  const tools: BundleTool[] = [
    ...def.entries.mcp.map(s => mcpTool(s, secrets)),
    ...def.entries.hooks.map(h => hookTool(h, secrets)),
  ];
  const codeFiles: BundleCodeFile[] = [];
  let bytes = 0;
  for (const f of files) {
    bytes += f.bytes.length;
    const why = codeWhy(f.path, f.bytes, f.executable === true);
    if (why !== null) codeFiles.push({ path: f.path, why, sha256: sha256Hex(f.bytes) });
  }
  const notes: BundleNote[] = knowledge.map(k => ({
    name: k.name, kind: k.kind,
    readBy: def.entries.subagents.filter(a => (a.notes ?? []).includes(k.name)).map(a => a.id),
  }));
  return {
    harness: def.harness.id,
    engines: def.harness.engines.map(e => e.id),
    instructions: def.instructions !== undefined,
    counts: {
      skills: def.entries.skills.length, agents: def.entries.subagents.length, mcp: def.entries.mcp.length, hooks: def.entries.hooks.length,
      guardrails: def.entries.rules.length + def.entries.sandbox.length, scripts: def.scripts.length, files: files.length, bytes,
    },
    tools, codeFiles, secrets: secrets.list(), notes,
    borrowed: def.sources.map(s => ({ name: s.name, marketplace: s.marketplace, version: s.version })),
    foreignPaths: foreignPaths(files, options),
  };
}

/** Text of a loader problem for a refusal: one line, cut. The loader's messages never repeat a value; this makes sure a path or code cannot hold a control character. */
export const safeLine = (text: string): string => oneLine(cut(text, 300));
