/**
 * The adapters of the real-setup reader: one small table row for each program, and pure parsers that turn the text of one file into records.
 * An adapter knows WHERE a program keeps things (relative to the home folder, and as folder names to look for in a work folder) and WHAT a file at a path means.
 * It reads no file and runs no code: the caller hands it a path and, in the second step only, the text. A shape it does not know gives no record (and a flag), never an error.
 *
 * What is kept from a connection or a hook is only: its name, the name of the program it starts (no arguments), the host of a web address (no path, no query, no
 * login), and the NAMES of environment variables and headers. A value never leaves the parser. Tests grep every result for a made-up key value.
 */
import { firstSentence, parseFrontmatter, parseJsonLoose } from './frontmatter.js';
import { HIDDEN, cleanLine, cleanPath, commandName, cut, hostOf, keyName, keyNames, looksSecretName, safeText, scrubText } from './redact.js';
import { parseToml, tomlText } from './toml.js';
import { isList, isMap, listOf, parseYaml, textOf } from './yaml.js';
import type { YamlValue } from './yaml.js';
import { REAL_LIMITS } from './types.js';
import type { RealApp, RealKind } from './types.js';

export type ConfigKind = 'claude-settings' | 'claude-json' | 'mcp-json' | 'codex-toml' | 'opencode-json' | 'hermes-yaml';

/** What a file at a path means, decided from the path alone. */
export type FileRole =
  | { readonly what: 'skill' | 'agent' | 'prompt' | 'plugin' | 'note' | 'profile' }
  | { readonly what: 'config'; readonly config: ConfigKind };

/** The facts about one found thing that no screen needs a file for. */
export interface RecordMeta {
  readonly role?: string;
  readonly model?: string;
  readonly skills?: readonly string[];
  /** The tool names an agent lists, as written (`Read`, `mcp__github__search`, `github_*`). Names only. */
  readonly toolNames?: readonly string[];
  readonly command?: string;
  readonly host?: string;
  readonly envNames?: readonly string[];
  readonly headerNames?: readonly string[];
  readonly event?: string;
  readonly matcher?: string;
  readonly runs?: readonly string[];
  /** The instruction text of an agent, without its front matter. Step two only. */
  readonly body?: string;
}

/** One thing found in one file. `text` is empty in step one, and in step two holds the file text (for a skill, an agent or a prompt) or a safe summary (for a connection or a hook). */
export interface RawRecord {
  readonly kind: RealKind;
  readonly app: RealApp;
  readonly name: string;
  /** The name the path gives it (the skill folder, the file name, the entry key): what two programs' copies of one thing share even when their front matter names differ. */
  readonly slug: string;
  readonly description: string;
  /** Relative to the place folder, with `/`. */
  readonly relPath: string;
  readonly text: string;
  /** True when the front matter could not be understood. The record is still listed. */
  readonly partial: boolean;
  readonly meta: RecordMeta;
}

export interface FileRecords { readonly records: readonly RawRecord[]; readonly partial: boolean; readonly unreadable: boolean }

export interface AppAdapter {
  readonly id: RealApp;
  readonly label: string;
  /** Folders under the home folder (with `/`) and the single files beside them. */
  readonly homeFolders: readonly string[];
  readonly homeFiles: readonly { readonly path: string; readonly config: ConfigKind }[];
  /** Folder names to look for in a work folder, and files that sit in the work folder itself. */
  readonly projectFolders: readonly string[];
  readonly projectFiles: readonly { readonly name: string; readonly config: ConfigKind }[];
  /** Folder names inside a tool folder that are never entered: logs, caches, plug-in stores and the like. */
  readonly skipInside: readonly string[];
}

const SKILL_FOLDER = /^skills?\/(?:.+\/)?SKILL\.md$/i;
const SKILL_FLAT = /^skills?\/[^/]+\.md$/i;
const BODY_CHARS = 20000;
const NOT_A_THING = /^(readme|license|licence|changelog|contributing)(\..*)?$/i;

export const ADAPTERS: readonly AppAdapter[] = Object.freeze([
  { id: 'claude-code', label: 'Claude Code', homeFolders: ['.claude'], homeFiles: [{ path: '.claude.json', config: 'claude-json' }], projectFolders: ['.claude'], projectFiles: [{ name: '.mcp.json', config: 'mcp-json' }],
    skipInside: ['projects', 'plugins', 'todos', 'shell-snapshots', 'statsig', 'file-history', 'ide', 'telemetry', 'cache', 'paste-cache', 'session-env', 'debug', 'backups', 'downloads', 'sessions', 'logs', 'history', 'node_modules', '.git'] },
  { id: 'codex', label: 'Codex', homeFolders: ['.codex', '.agents'], homeFiles: [], projectFolders: ['.codex', '.agents'], projectFiles: [],
    skipInside: ['sessions', 'log', 'logs', 'history', 'cache', 'tmp', 'archived_sessions', 'shell_snapshots', 'node_modules', '.git'] },
  { id: 'opencode', label: 'OpenCode', homeFolders: ['.config/opencode'], homeFiles: [], projectFolders: ['.opencode'], projectFiles: [{ name: 'opencode.json', config: 'opencode-json' }, { name: 'opencode.jsonc', config: 'opencode-json' }],
    skipInside: ['node_modules', 'cache', 'log', 'logs', 'snapshot', 'storage', '.git'] },
  { id: 'hermes', label: 'Hermes', homeFolders: ['.hermes'], homeFiles: [], projectFolders: [], projectFiles: [],
    skipInside: ['sessions', 'logs', 'log', 'cache', 'node_modules', 'checkpoints', 'audio_cache', 'image_cache', 'history', '.git', 'venv', '.venv', 'hermes-agent'] },
  { id: 'bowerloom', label: 'Bowerloom', homeFolders: [], homeFiles: [], projectFolders: ['.bowerloom'], projectFiles: [],
    skipInside: ['managed', 'cache', 'node_modules', '.git'] },
]);

export const adapterOf = (app: RealApp): AppAdapter => ADAPTERS.find(a => a.id === app)!;
export const appLabel = (app: RealApp): string => adapterOf(app).label;

/** Whether the world of the home screens has room for this program (it is one of its three interfaces). */
export const isKnownInterface = (app: RealApp): app is 'claude-code' | 'codex' | 'opencode' => app === 'claude-code' || app === 'codex' || app === 'opencode';

const stem = (file: string): string => file.replace(/\.[^.]+$/, '');
const parts = (rel: string): string[] => rel.split('/');

/** What the file at `rel` (relative to the program's folder) means, or null when it means nothing to the reader. */
export function classify(app: RealApp, rel: string): FileRole | null {
  const name = parts(rel).pop() ?? '';
  if (app === 'claude-code') {
    if (SKILL_FOLDER.test(rel) || (SKILL_FLAT.test(rel) && !NOT_A_THING.test(name))) return { what: 'skill' };
    if (/^agents\/(?:.+\/)?[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'agent' };
    if (/^commands\/(?:.+\/)?[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'prompt' };
    if (rel === 'settings.json' || rel === 'settings.local.json') return { what: 'config', config: 'claude-settings' };
    return null;
  }
  if (app === 'codex') {
    if (SKILL_FOLDER.test(rel) || (SKILL_FLAT.test(rel) && !NOT_A_THING.test(name))) return { what: 'skill' };
    if (/^agents\/[^/]+\.(toml|md)$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'agent' };
    if (/^prompts\/[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'prompt' };
    if (rel === 'config.toml') return { what: 'config', config: 'codex-toml' };
    return null;
  }
  if (app === 'opencode') {
    if (SKILL_FOLDER.test(rel) || (SKILL_FLAT.test(rel) && !NOT_A_THING.test(name))) return { what: 'skill' };
    if (/^agents?\/(?:.+\/)?[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'agent' };
    if (/^commands?\/(?:.+\/)?[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'prompt' };
    if (/^plugins?\/[^/]+\.(?:[mc]?[jt]s)$/i.test(rel)) return { what: 'plugin' };
    if (rel === 'opencode.json' || rel === 'opencode.jsonc') return { what: 'config', config: 'opencode-json' };
    return null;
  }
  if (app === 'hermes') {
    if (/^(?:profiles\/[^/]+\/)?skills\/(?:.+\/)?SKILL\.md$/i.test(rel)) return { what: 'skill' };
    if (/^(?:profiles\/[^/]+\/)?SOUL\.md$/i.test(rel)) return { what: 'profile' };
    if (/^(?:profiles\/[^/]+\/)?config\.ya?ml$/i.test(rel)) return { what: 'config', config: 'hermes-yaml' };
    if (/^(?:profiles\/[^/]+\/)?memories\/(?:.+\/)?[^/]+\.md$/i.test(rel)) return { what: 'note' };
    return null;
  }
  // Bowerloom's own folder: skills, saved prompts, and the agents of its teams.
  if (SKILL_FOLDER.test(rel)) return { what: 'skill' };
  if (/^teams\/[^/]+\/agents\/[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'agent' };
  if (/^prompts\/[^/]+\.md$/i.test(rel) && !NOT_A_THING.test(name)) return { what: 'prompt' };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------- names

/** A name shown to the person: scrubbed, one line, at most 80 characters. A name can hold a pasted key as easily as a description can. */
const nameChars = (text: string): string => safeText(text, 80);

/** The name a path gives a thing: the skill's folder, the file's name, a command's folder prefix. */
export function nameFromPath(app: RealApp, what: FileRole['what'], rel: string): string {
  const p = parts(rel);
  const file = p.pop() ?? '';
  if (what === 'skill') return nameChars(/^SKILL\.md$/i.test(file) ? (p.pop() ?? stem(file)) : stem(file));
  if (what === 'profile') { const owner = p.length >= 2 && p[0] === 'profiles' ? p[1]! : ''; return nameChars(owner === '' ? 'Hermes' : owner); }
  if (what === 'prompt' && app === 'claude-code') {
    const dirs = p.slice(1);
    return nameChars([...dirs, stem(file)].join(':'));
  }
  return nameChars(stem(file));
}

function record(app: RealApp, kind: RealKind, name: string, description: string, relPath: string, text: string, partial: boolean, meta: RecordMeta = {}, slug = name): RawRecord {
  const plainName = nameChars(name), plainSlug = nameChars(slug);
  return { kind, app, name: plainName === '' ? 'Unnamed' : plainName, slug: plainSlug === '' ? 'unnamed' : plainSlug, description: cut(safeText(description, 4 * REAL_LIMITS.hintChars), REAL_LIMITS.hintChars), relPath: cleanPath(relPath), text, partial, meta };
}

// ---------------------------------------------------------------------------------------------------------------------- files

/**
 * The records in one file. `text` is null in step one: the file is not opened, and a record is made from its path alone (a name and no description). In step two `text`
 * is the file text, and the front matter, the description and the details come from it. A config file is the exception: its structure is read in both steps (for the
 * counts), and in both only names are kept.
 */
export function recordsOfFile(app: RealApp, role: FileRole, relPath: string, rel: string, text: string | null): FileRecords {
  try {
    if (role.what === 'config') {
      if (text === null) return { records: [], partial: false, unreadable: true };
      return fromConfig(app, role.config, relPath, text);
    }
    if (role.what === 'note') return { records: [], partial: false, unreadable: false };
    const base = nameFromPath(app, role.what, rel);
    const kind: RealKind = role.what === 'plugin' ? 'hook' : role.what === 'profile' ? 'agent' : role.what;
    if (text === null) return { records: [record(app, kind, base, '', relPath, '', false, kind === 'hook' ? { event: 'plug-in' } : {}, base)], partial: false, unreadable: false };
    if (role.what === 'plugin') return { records: [record(app, 'hook', base, '', relPath, JSON.stringify({ event: 'plug-in', kinds: ['command'], file: base }), false, { event: 'plug-in' }, base)], partial: false, unreadable: false };
    if (role.what === 'agent' && /\.toml$/i.test(relPath)) return { records: [fromTomlAgent(app, base, relPath, text)], partial: false, unreadable: false };
    const front = parseFrontmatter(text);
    const name = nameChars(textOf(front.data.name)) || base;
    const description = cleanLine(scrubText(textOf(front.data.description) || firstSentence(front.body)));
    const partial = front.state === 'bad';
    const meta: RecordMeta = {
      ...(textOf(front.data.model) === '' ? {} : { model: nameChars(textOf(front.data.model)) }),
      ...(listOf(front.data.skills).length === 0 ? {} : { skills: listOf(front.data.skills).map(nameChars).slice(0, 60) }),
      ...(listOf(front.data.tools).length === 0 ? {} : { toolNames: listOf(front.data.tools).map(nameChars).slice(0, 80) }),
      ...(role.what === 'agent' && description !== '' ? { role: cut(description, 60) } : {}),
      ...(role.what === 'agent' ? { body: scrubText(front.body).slice(0, BODY_CHARS) } : {}),
    };
    return { records: [record(app, kind, name, description, relPath, scrubText(text), partial, meta, base)], partial, unreadable: false };
  } catch { return { records: [], partial: false, unreadable: true }; }
}

function fromTomlAgent(app: RealApp, base: string, relPath: string, text: string): RawRecord {
  const root = parseToml(text)[0];
  const name = nameChars(tomlText(root, 'name')) || base, description = cleanLine(scrubText(tomlText(root, 'description') || firstSentence(tomlText(root, 'developer_instructions'))));
  const model = nameChars(tomlText(root, 'model'));
  return record(app, 'agent', name, description, relPath, scrubText(text), false, { ...(model === '' ? {} : { model }), ...(description === '' ? {} : { role: cut(description, 60) }), body: scrubText(tomlText(root, 'developer_instructions')).slice(0, BODY_CHARS) }, base);
}

// ---------------------------------------------------------------------------------------------------------------------- connections and hooks

interface ServerSpec { readonly command?: unknown; readonly url?: unknown; readonly env?: unknown; readonly headers?: unknown; readonly bearerEnv?: unknown }

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const BEARER_NAME = /^[A-Z_][A-Z0-9_]{0,39}$/;

function serverRecord(app: RealApp, name: string, relPath: string, spec: ServerSpec): RawRecord {
  const first = Array.isArray(spec.command) ? spec.command[0] : spec.command;
  const command = typeof first === 'string' ? commandName(first) : '';
  const host = typeof spec.url === 'string' ? hostOf(spec.url) : '';
  const envNames = new Set(keyNames(spec.env));
  // The variable that holds a bearer token is named in capitals by habit. Anything else may be the token itself, pasted where the name should be.
  if (typeof spec.bearerEnv === 'string' && ENV_NAME.test(spec.bearerEnv)) envNames.add(BEARER_NAME.test(spec.bearerEnv) ? keyName(spec.bearerEnv) : HIDDEN);
  const headerNames = keyNames(spec.headers);
  const description = host !== '' ? `Connects to ${host}.` : command !== '' ? `Starts ${command} on this computer.` : '';
  const summary = { server: nameChars(name), ...(command === '' ? {} : { command }), ...(host === '' ? {} : { host }), ...(envNames.size === 0 ? {} : { env: [...envNames].sort() }), ...(headerNames.length === 0 ? {} : { headers: headerNames }) };
  return record(app, 'mcp', nameChars(name), description, relPath, JSON.stringify(summary, null, 2), false, {
    ...(command === '' ? {} : { command }), ...(host === '' ? {} : { host }), ...(envNames.size === 0 ? {} : { envNames: [...envNames].sort() }), ...(headerNames.length === 0 ? {} : { headerNames }),
  });
}

function serversOf(app: RealApp, relPath: string, servers: unknown): RawRecord[] {
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return [];
  const out: RawRecord[] = [];
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>).slice(0, REAL_LIMITS.recordsPerFile)) {
    if (name === '__proto__' || raw === null || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    out.push(serverRecord(app, name, relPath, { command: s.command, url: s.url, env: s.env ?? s.environment, headers: s.headers ?? s.http_headers }));
  }
  return out;
}

function hooksOfClaude(app: RealApp, relPath: string, hooks: unknown): RawRecord[] {
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const out: RawRecord[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>).slice(0, REAL_LIMITS.recordsPerFile)) {
    if (!Array.isArray(groups) || !ENV_NAME.test(event)) continue;
    for (const group of groups.slice(0, REAL_LIMITS.recordsPerFile)) {
      const g = (group !== null && typeof group === 'object' ? group : {}) as Record<string, unknown>;
      const matcher = typeof g.matcher === 'string' ? safeText(g.matcher, 40) : '';
      const kinds = Array.isArray(g.hooks) ? g.hooks.map(h => (h !== null && typeof h === 'object' && typeof (h as Record<string, unknown>).type === 'string' ? safeText(String((h as Record<string, unknown>).type), 20) : 'command')) : ['command'];
      out.push(record(app, 'hook', matcher === '' ? event : `${event}: ${matcher}`, '', relPath, JSON.stringify({ event, ...(matcher === '' ? {} : { matcher }), kinds }), false, { event, ...(matcher === '' ? {} : { matcher }), runs: kinds }));
    }
  }
  return out;
}

function fromConfig(app: RealApp, config: ConfigKind, relPath: string, text: string): FileRecords {
  if (config === 'claude-settings') {
    const json = parseJsonLoose(text) as Record<string, unknown> | null;
    return { records: json === null || typeof json !== 'object' ? [] : hooksOfClaude(app, relPath, json.hooks), partial: false, unreadable: false };
  }
  if (config === 'claude-json') {
    const json = parseJsonLoose(text) as Record<string, unknown> | null;
    return { records: json === null || typeof json !== 'object' ? [] : serversOf(app, relPath, json.mcpServers), partial: false, unreadable: false };
  }
  if (config === 'mcp-json') {
    const json = parseJsonLoose(text) as Record<string, unknown> | null;
    return { records: json === null || typeof json !== 'object' ? [] : serversOf(app, relPath, json.mcpServers ?? json.servers), partial: false, unreadable: false };
  }
  if (config === 'opencode-json') return { records: fromOpenCode(app, relPath, parseJsonLoose(text)), partial: false, unreadable: false };
  if (config === 'codex-toml') return { records: fromCodexToml(app, relPath, text), partial: false, unreadable: false };
  return { records: fromHermesYaml(app, relPath, text), partial: false, unreadable: false };
}

function fromOpenCode(app: RealApp, relPath: string, json: unknown): RawRecord[] {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return [];
  const j = json as Record<string, unknown>, out = serversOf(app, relPath, j.mcp);
  const agents = j.agent, commands = j.command;
  if (agents !== null && typeof agents === 'object' && !Array.isArray(agents)) {
    for (const [name, raw] of Object.entries(agents as Record<string, unknown>).slice(0, REAL_LIMITS.recordsPerFile)) {
      if (name === '__proto__' || raw === null || typeof raw !== 'object') continue;
      const a = raw as Record<string, unknown>, description = typeof a.description === 'string' ? cleanLine(scrubText(a.description)) : '';
      out.push(record(app, 'agent', nameChars(name), description, relPath, scrubText(JSON.stringify({ name, description, mode: typeof a.mode === 'string' ? a.mode : undefined, model: typeof a.model === 'string' ? a.model : undefined })), false, {
        ...(description === '' ? {} : { role: cut(description, 60) }), ...(typeof a.model === 'string' ? { model: nameChars(a.model) } : {}), toolNames: keyNames(a.tools), ...(typeof a.prompt === 'string' ? { body: scrubText(a.prompt).slice(0, BODY_CHARS) } : {}),
      }));
    }
  }
  if (commands !== null && typeof commands === 'object' && !Array.isArray(commands)) {
    for (const [name, raw] of Object.entries(commands as Record<string, unknown>).slice(0, REAL_LIMITS.recordsPerFile)) {
      if (name === '__proto__' || raw === null || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>, description = typeof c.description === 'string' ? c.description : '';
      out.push(record(app, 'prompt', nameChars(name), description, relPath, scrubText(typeof c.template === 'string' ? c.template : description), false));
    }
  }
  return out;
}

function fromCodexToml(app: RealApp, relPath: string, text: string): RawRecord[] {
  const tables = parseToml(text), out: RawRecord[] = [];
  const server = new Map<string, { command?: string; url?: string; env: Set<string>; headers: Set<string>; bearer?: string }>();
  const entry = (name: string) => { let e = server.get(name); if (e === undefined) { e = { env: new Set(), headers: new Set() }; server.set(name, e); } return e; };
  for (const t of tables) {
    if (t.path[0] !== 'mcp_servers' || t.path.length < 2) continue;
    const name = t.path[1]!, e = entry(name), sub = t.path[2];
    if (sub === undefined) {
      const command = tomlText(t, 'command'), url = tomlText(t, 'url'), bearer = tomlText(t, 'bearer_token_env_var');
      if (command !== '') e.command = command;
      if (url !== '') e.url = url;
      if (bearer !== '') e.bearer = bearer;
      for (const key of ['env', 'http_headers', 'env_http_headers']) {
        const v = t.values.get(key);
        if (v !== undefined && v.t === 'tbl') for (const k of v.keys) (key === 'env' ? e.env : e.headers).add(k);
      }
    } else if (sub === 'env') for (const k of t.values.keys()) e.env.add(k);
    else if (sub === 'http_headers' || sub === 'env_http_headers') for (const k of t.values.keys()) e.headers.add(k);
  }
  for (const [name, e] of [...server].slice(0, REAL_LIMITS.recordsPerFile)) out.push(serverRecord(app, name, relPath, { command: e.command, url: e.url, env: Object.fromEntries([...e.env].map(k => [k, 1])), headers: Object.fromEntries([...e.headers].map(k => [k, 1])), bearerEnv: e.bearer }));
  const notify = tables[0]?.values.get('notify');
  if (notify !== undefined && notify.t === 'arr') out.push(record(app, 'hook', 'Notify', '', relPath, JSON.stringify({ event: 'notify', kinds: ['command'] }), false, { event: 'notify', runs: ['command'] }));
  return out;
}

function fromHermesYaml(app: RealApp, relPath: string, text: string): RawRecord[] {
  const yaml = parseYaml(text), servers = yaml.mcp_servers ?? yaml.mcpServers;
  if (!isMap(servers)) return [];
  const out: RawRecord[] = [];
  for (const [name, raw] of Object.entries(servers).slice(0, REAL_LIMITS.recordsPerFile)) {
    if (!isMap(raw)) continue;
    const command = textOf(raw.command), url = textOf(raw.url);
    out.push(serverRecord(app, name, relPath, { command, url, env: namesToObject(raw.env), headers: namesToObject(raw.headers) }));
  }
  return out;
}

function namesToObject(value: YamlValue | undefined): Record<string, number> {
  if (isMap(value)) return Object.fromEntries(Object.keys(value).map(k => [k, 1]));
  if (isList(value)) return Object.fromEntries(value.flatMap(v => (typeof v === 'string' ? [[v.split('=')[0]!.trim(), 1] as const] : [])));
  return {};
}

/** The name of the variable that most likely holds a secret for a connection: the first of its names that looks like one. */
export function secretNameOf(envNames: readonly string[], headerNames: readonly string[]): string | null {
  return [...envNames, ...headerNames].find(looksSecretName) ?? null;
}
