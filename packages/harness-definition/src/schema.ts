/**
 * Field checks for each definition file. Each check adds problems and returns the entry, or undefined when the entry
 * has a fault. Unknown fields are refused everywhere. An `x-<engine>` key is an engine-private block: it is kept
 * unchanged on subagents, guardrail rules, the sandbox, hooks, MCP servers, and skill settings in `harness.json`, and
 * refused in portable skill frontmatter (portable parts spec, decision 2) and at the top of `harness.json`.
 *
 * A private block holds no permission-like key, at any depth (security review S6): permissions belong in
 * `guardrails.json`, where layers and the fidelity check see them. A string in a private block uses no `${...}` form
 * other than `${NAME}`.
 *
 * Messages never repeat a value. A key appears only when `safeName` finds it plain (security review S7).
 */
import { isRecord } from './json.js';
import { safeName } from './secrets.js';
import type {
  EngineTarget, EnvValue, GuardrailRule, HarnessFile, HookEntry, JsonValue, LayerOverride, McpServer, PartPointers,
  PrivateBlocks, Problem, SandboxRequirement, SkillEntry, SkillSettings, SourceRecord, SubagentEntry,
} from './types.js';
import {
  DEFINITION_LIMITS, ENGINE_IDS, GUARDRAIL_ACTIONS, GUARDRAIL_EFFECTS, HARNESS_FORMAT, MCP_TRANSPORTS, OVERRIDABLE_PARTS,
  PART_KEYS, STRENGTHS, TOOL_CLASSES, isEngineId, isId, isServerName,
} from './words.js';
import type { EngineId, OverridablePart, ToolClass } from './words.js';

/** Collects the problems of one file. */
export class Checker {
  readonly problems: Problem[] = [];
  constructor(readonly path: string) {}
  fail(code: string, message: string): undefined { this.problems.push({ code, path: this.path, message }); return undefined; }
}

type Obj = Record<string, JsonValue>;
const PRIVATE_KEY = /^x-(.+)$/;
const list = (words: readonly string[]) => words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`;

/**
 * Checks the keys of an object: every required key present, no key outside required and optional, and `x-<engine>`
 * keys only when private blocks are allowed. Returns the private blocks, or undefined on a fault.
 */
function keys(c: Checker, value: JsonValue | undefined, where: string, required: readonly string[], optional: readonly string[], allowPrivate: boolean, unknownCode = 'UNKNOWN_FIELD'): { obj: Obj; blocks: PrivateBlocks } | undefined {
  if (!isRecord(value)) return c.fail('INVALID_FIELD', `${where} must be an object.`);
  let ok = true;
  const blocks: Partial<Record<EngineId, JsonValue>> = {};
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    const m = PRIVATE_KEY.exec(key);
    if (m && allowPrivate) {
      if (!isEngineId(m[1])) { c.fail('UNKNOWN_ENGINE', `${where} has the private block ${safeName(key)}, for an engine that does not exist. The engines are ${list(ENGINE_IDS)}.`); ok = false; continue; }
      if (!privateBlock(c, value[key]!, `${where}: x-${m[1]}`)) { ok = false; continue; }
      blocks[m[1]] = value[key]!;
      continue;
    }
    c.fail(unknownCode, `${where} has the unknown field ${safeName(key)}.`); ok = false;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) { c.fail('INVALID_FIELD', `${where} is missing the field ${key}.`); ok = false; }
  return ok ? { obj: value, blocks } : undefined;
}

/**
 * Words of a key that make it permission-like: it would grant, ask, trust, sandbox, hook, reach tools or servers, run a
 * command, set the environment, fetch a credential, load a plugin or marketplace, or widen what the engine can write or
 * reach (step 3 contract change, ruling A9: `awsAuthRefresh`, `awsCredentialExport`, `extraKnownMarketplaces`,
 * `enabledPlugins`, `notify`, `model_providers`).
 *
 * `mode` alone is not a word here: OpenCode's agent `mode` (primary, subagent, all) is a plain engine-only field. The
 * mode keys that grant or ask stay refused by their other words (`sandbox_mode`, `permissionMode`, `approval_mode`) or
 * by a phrase (`defaultMode`).
 */
const PERMISSION_WORDS = new Set([
  'permission', 'permissions', 'allow', 'allowed', 'allowlist', 'deny', 'denied', 'denylist', 'disallowed', 'ask',
  'sandbox', 'approval', 'approvals', 'approve', 'autoapprove', 'trust', 'trusted', 'bypass', 'dangerously', 'yolo',
  'tools', 'hook', 'hooks', 'mcp', 'server', 'servers', 'writable', 'network', 'shell', 'environment', 'env', 'command',
  'commands', 'cmd', 'exec', 'executable', 'args', 'argv', 'script', 'scripts', 'helper', 'policy', 'profile',
  'notify', 'credential', 'credentials', 'marketplace', 'marketplaces', 'plugin', 'plugins',
]);
const PERMISSION_PHRASES = ['full_auto', 'status_line', 'default_mode', 'auth_refresh', 'model_provider'];
const keyWords = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** True when a key of a private block is permission-like, such as `permissions`, `allowed-tools`, or `sandbox_mode`. */
export function isPermissionKey(key: string): boolean {
  const w = keyWords(key);
  const joined = w.join('_');
  return w.some(x => PERMISSION_WORDS.has(x)) || PERMISSION_PHRASES.some(p => joined.includes(p));
}
const BAD_REFERENCE = /\$\{(?![A-Za-z_][A-Za-z0-9_]*\})/;

/** Checks one private block at every depth. */
function privateBlock(c: Checker, value: JsonValue, where: string): boolean {
  let ok = true;
  const walk = (v: JsonValue): void => {
    if (typeof v === 'string') {
      if (ok && BAD_REFERENCE.test(v)) { ok = false; c.fail('ENV_REFERENCE', `${where} holds a \${...} form other than \${NAME}. Defaults such as \${NAME:-x} are not portable.`); }
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isRecord(v)) return;
    for (const [key, inner] of Object.entries(v)) {
      if (isPermissionKey(key)) { ok = false; c.fail('PRIVATE_BLOCK_PERMISSION', `${where} has the permission-like key ${safeName(key)}. Permissions belong in guardrails.json, where layers and the fidelity check see them.`); continue; }
      walk(inner);
    }
  };
  walk(value);
  return ok;
}

function text(c: Checker, value: JsonValue | undefined, where: string, max = 1024): string | undefined {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > max || /[\0-\x08\x0b-\x1f\x7f]/.test(value)) {
    return c.fail('INVALID_FIELD', `${where} must be text of 1 to ${max} characters with no control characters.`);
  }
  return value;
}
function oneLine(c: Checker, value: JsonValue | undefined, where: string, max = 1024): string | undefined {
  const t = text(c, value, where, max);
  if (t !== undefined && /[\n\r]/.test(t)) return c.fail('INVALID_FIELD', `${where} must be one line.`);
  return t;
}
function word<T extends string>(c: Checker, value: JsonValue | undefined, words: readonly T[], where: string): T | undefined {
  return typeof value === 'string' && (words as readonly string[]).includes(value) ? value as T : c.fail('INVALID_FIELD', `${where} must be ${list(words)}.`);
}
function positiveMs(c: Checker, value: JsonValue | undefined, where: string): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 86_400_000 ? value as number : c.fail('INVALID_FIELD', `${where} must be a whole number of milliseconds above 0.`);
}
function array(c: Checker, value: JsonValue | undefined, where: string, min = 0): readonly JsonValue[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > DEFINITION_LIMITS.entries) return c.fail('INVALID_FIELD', `${where} must be a list of ${min} to ${DEFINITION_LIMITS.entries} items.`);
  return value;
}

/** The engine filter of an entry: a non-empty list of distinct engine ids. */
function engineFilter(c: Checker, obj: Obj, where: string): readonly EngineId[] | undefined | null {
  if (!Object.hasOwn(obj, 'engines')) return null;
  const items = array(c, obj.engines, `${where}: engines`, 1);
  if (!items) return undefined;
  for (const [i, item] of items.entries()) if (!isEngineId(item)) return c.fail('UNKNOWN_ENGINE', `${where}: engines[${i}] is not an engine id. The engines are ${list(ENGINE_IDS)}.`);
  if (new Set(items).size !== items.length) return c.fail('INVALID_FIELD', `${where}: engines lists an engine twice.`);
  return items as EngineId[];
}

/** Refuses two items with one key. The message shows the key only when it is a checked id. */
function unique<T>(c: Checker, items: readonly T[], id: (item: T) => string, what: string): void {
  const seen = new Set<string>();
  items.forEach((item, i) => { const k = id(item); if (seen.has(k)) c.fail('DUPLICATE_ID', `${what}[${i}] repeats the key ${safeName(k)} of an earlier item.`); seen.add(k); });
}

// ---- harness.json --------------------------------------------------------------------------------------------------

export function checkHarness(c: Checker, value: JsonValue): HarnessFile | undefined {
  const k = keys(c, value, 'harness.json', ['format', 'id', 'description', 'engines', 'parts'], ['overrides', 'skills'], false);
  if (!k) return undefined;
  const { obj } = k;
  if (obj.format !== HARNESS_FORMAT) return c.fail('FORMAT_UNSUPPORTED', `The format must be ${HARNESS_FORMAT}.`);
  const id = isId(obj.id) ? obj.id : c.fail('INVALID_ID', 'The id must be lowercase letters, digits, and single hyphens, up to 64 characters.');
  const description = oneLine(c, obj.description, 'The description');
  const engines = checkEngines(c, obj.engines);
  const parts = checkPointers(c, obj.parts);
  const overrides = Object.hasOwn(obj, 'overrides') ? checkOverrides(c, obj.overrides) : [];
  const skills = Object.hasOwn(obj, 'skills') ? checkSkillSettings(c, obj.skills) : {};
  if (id === undefined || description === undefined || !engines || !parts || !overrides || !skills) return undefined;
  return { format: HARNESS_FORMAT, id, description, engines, parts, overrides, skills };
}

/** `skills` in harness.json: the engine filter and engine-only keys of each skill (lead ruling R5). */
function checkSkillSettings(c: Checker, value: JsonValue | undefined): Record<string, SkillSettings> | undefined {
  if (!isRecord(value)) return c.fail('INVALID_FIELD', 'skills must map skill ids to settings.');
  const out: Record<string, SkillSettings> = {};
  let ok = true;
  for (const [id, settings] of Object.entries(value)) {
    if (!isId(id)) { ok = false; c.fail('INVALID_ID', `skills has the key ${safeName(id)}, which is not a skill id.`); continue; }
    const k = keys(c, settings, `skills.${id}`, [], ['engines'], true);
    const filter = k ? engineFilter(c, k.obj, `skills.${id}`) : undefined;
    if (!k || filter === undefined) { ok = false; continue; }
    out[id] = { ...(filter ? { engines: filter } : {}), privateBlocks: k.blocks };
  }
  return ok ? out : undefined;
}

function checkEngines(c: Checker, value: JsonValue | undefined): EngineTarget[] | undefined {
  const items = array(c, value, 'engines', 1);
  if (!items) return undefined;
  const out: EngineTarget[] = [];
  let ok = true;
  items.forEach((item, i) => {
    const k = keys(c, item, `engines[${i}]`, ['id'], ['version', 'model'], false);
    if (!k) { ok = false; return; }
    if (!isEngineId(k.obj.id)) { ok = false; c.fail('UNKNOWN_ENGINE', `engines[${i}].id is not an engine id. The engines are ${list(ENGINE_IDS)}.`); return; }
    const entry: { id: EngineId; version?: string; model?: string } = { id: k.obj.id };
    for (const f of ['version', 'model'] as const) {
      if (!Object.hasOwn(k.obj, f)) continue;
      const v = oneLine(c, k.obj[f], `engines[${i}].${f}`, 256);
      if (v === undefined) ok = false; else entry[f] = v;
    }
    out.push(entry);
  });
  const before = c.problems.length;
  unique(c, out, e => e.id, 'engines');
  return ok && c.problems.length === before ? out : undefined;
}

function checkPointers(c: Checker, value: JsonValue | undefined): PartPointers | undefined {
  const k = keys(c, value, 'parts', [], PART_KEYS, false);
  if (!k) return undefined;
  const out: Record<string, string | readonly string[]> = {};
  let ok = true;
  for (const [key, v] of Object.entries(k.obj)) {
    if (key === 'tool-guidance') {
      const items = array(c, v, 'parts.tool-guidance', 1);
      if (!items || items.some(item => typeof item !== 'string' || item === '') || new Set(items).size !== items.length) { ok = false; if (items) c.fail('INVALID_FIELD', 'parts.tool-guidance must list distinct pointers.'); continue; }
      out[key] = items as string[];
    } else if (typeof v === 'string' && v !== '') out[key] = v;
    else { ok = false; c.fail('INVALID_FIELD', `parts.${key} must be a path.`); }
  }
  return ok ? out as PartPointers : undefined;
}

function checkOverrides(c: Checker, value: JsonValue | undefined): LayerOverride[] | undefined {
  const items = array(c, value, 'overrides');
  if (!items) return undefined;
  const out: LayerOverride[] = [];
  let ok = true;
  items.forEach((item, i) => {
    const k = keys(c, item, `overrides[${i}]`, ['part', 'id', 'action'], [], false);
    if (!k) { ok = false; return; }
    const part = word(c, k.obj.part, OVERRIDABLE_PARTS, `overrides[${i}].part`);
    const action = word(c, k.obj.action, ['hide', 'replace'] as const, `overrides[${i}].action`);
    const id = part === 'mcp' ? (isServerName(k.obj.id) ? k.obj.id : undefined) : (isId(k.obj.id) ? k.obj.id : undefined);
    if (part && id === undefined) c.fail('INVALID_ID', `overrides[${i}].id is not a valid id for ${part}.`);
    if (!part || !action || id === undefined) { ok = false; return; }
    out.push({ part, id, action });
  });
  const before = c.problems.length;
  unique(c, out, o => `${o.part}/${o.id}`, 'overrides');
  return ok && c.problems.length === before ? out : undefined;
}

// ---- skills and subagents ------------------------------------------------------------------------------------------

const SKILL_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata'] as const;

/** Portable skill frontmatter: the open core fields only. Any other key is refused, `x-` keys among them. */
export function checkSkill(c: Checker, folder: string, data: Obj, body: string, files: readonly string[], contentHash: string, executable: readonly string[]): SkillEntry | undefined {
  const k = keys(c, data, 'The skill frontmatter', ['name', 'description'], SKILL_FIELDS.slice(2), false, 'SKILL_UNKNOWN_FIELD');
  if (!k) return undefined;
  const { obj } = k;
  if (typeof obj.name !== 'string') return c.fail('INVALID_FIELD', 'The skill name must be text.');
  if (obj.name !== folder) return c.fail('SKILL_NAME_MISMATCH', 'The skill name must equal its folder name.');
  const description = text(c, obj.description, 'The skill description', 1024);
  let ok = description !== undefined;
  const entry: { -readonly [K in keyof SkillEntry]: SkillEntry[K] } = { id: folder, name: folder, description: description ?? '', body, files, contentHash, executable, privateBlocks: {} };
  for (const f of ['license', 'compatibility'] as const) {
    if (!Object.hasOwn(obj, f)) continue;
    const v = text(c, obj[f], `The skill ${f}`, 500);
    if (v === undefined) ok = false; else entry[f] = v;
  }
  if (Object.hasOwn(obj, 'metadata')) {
    const m = obj.metadata;
    if (!isRecord(m) || Object.values(m).some(v => typeof v !== 'string')) { ok = false; c.fail('INVALID_FIELD', 'The skill metadata must map text keys to text values.'); }
    else entry.metadata = { ...(m as Record<string, string>) };
  }
  return ok ? entry : undefined;
}

const TOOL_CLASS = new RegExp(`^(?:${TOOL_CLASSES.join('|')})$|^mcp:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`);

export function checkSubagent(c: Checker, stem: string, data: Obj, body: string): SubagentEntry | undefined {
  const k = keys(c, data, 'The subagent frontmatter', ['name', 'description'], ['model', 'tools', 'skills', 'engines'], true);
  if (!k) return undefined;
  const { obj, blocks } = k;
  if (typeof obj.name !== 'string') return c.fail('INVALID_FIELD', 'The subagent name must be text.');
  if (obj.name !== stem) return c.fail('SUBAGENT_NAME_MISMATCH', 'The subagent name must equal its file name, without .md.');
  const description = text(c, obj.description, 'The subagent description', 1024);
  let ok = description !== undefined;
  if (body.trim() === '') { ok = false; c.fail('INVALID_FIELD', 'The subagent needs instructions in the body.'); }
  const entry: { -readonly [K in keyof SubagentEntry]: SubagentEntry[K] } = { id: stem, name: stem, description: description ?? '', body, privateBlocks: blocks };
  if (Object.hasOwn(obj, 'model')) {
    const m = obj.model;
    if (!isRecord(m) || Object.keys(m).length === 0) { ok = false; c.fail('INVALID_FIELD', 'The subagent model must map engines to model names.'); }
    else {
      const model: Partial<Record<EngineId, string>> = {};
      for (const [engine, name] of Object.entries(m)) {
        if (!isEngineId(engine)) { ok = false; c.fail('UNKNOWN_ENGINE', `The subagent model has the key ${safeName(engine)}, which is not an engine id.`); continue; }
        const v = oneLine(c, name, `The model for ${engine}`, 256);
        if (v === undefined) ok = false; else model[engine] = v;
      }
      entry.model = model;
    }
  }
  if (Object.hasOwn(obj, 'tools')) {
    const items = array(c, obj.tools, 'The subagent tools');
    if (!items || items.some(t => typeof t !== 'string' || !TOOL_CLASS.test(t)) || new Set(items).size !== items.length) {
      ok = false; if (items) c.fail('INVALID_FIELD', `The subagent tools must be distinct tool classes: ${TOOL_CLASSES.join(', ')}, or mcp:<server>.`);
    } else entry.tools = items as ToolClass[];
  }
  if (Object.hasOwn(obj, 'skills')) {
    const items = array(c, obj.skills, 'The subagent skills');
    if (!items || items.some(s => !isId(s)) || new Set(items).size !== items.length) { ok = false; if (items) c.fail('INVALID_FIELD', 'The subagent skills must be distinct skill ids.'); }
    else entry.skills = items as string[];
  }
  const filter = engineFilter(c, obj, 'The subagent');
  if (filter === undefined) ok = false; else if (filter !== null) entry.engines = filter;
  return ok ? entry : undefined;
}

// ---- guardrails.json, hooks.json, mcp.json, sources.json -----------------------------------------------------------

export function checkGuardrails(c: Checker, value: JsonValue): { rules: GuardrailRule[]; sandbox: SandboxRequirement[] } | undefined {
  const k = keys(c, value, 'guardrails.json', ['rules'], ['sandbox'], false);
  if (!k) return undefined;
  const items = array(c, k.obj.rules, 'rules');
  if (!items) return undefined;
  const rules = entries(items, (item, i) => {
    const where = `rules[${i}]`;
    const r = keys(c, item, where, ['id', 'action', 'pattern', 'effect', 'strength'], ['engines'], true);
    if (!r) return undefined;
    const id = isId(r.obj.id) ? r.obj.id : c.fail('INVALID_ID', `${where}.id must be lowercase letters, digits, and single hyphens.`);
    const action = word(c, r.obj.action, GUARDRAIL_ACTIONS, `${where}.action`);
    const pattern = oneLine(c, r.obj.pattern, `${where}.pattern`, 4096);
    const effect = word(c, r.obj.effect, GUARDRAIL_EFFECTS, `${where}.effect`);
    const strength = word(c, r.obj.strength, STRENGTHS, `${where}.strength`);
    const filter = engineFilter(c, r.obj, where);
    if (id === undefined || !action || pattern === undefined || !effect || !strength || filter === undefined) return undefined;
    return { id, action, pattern, effect, strength, ...(filter ? { engines: filter } : {}), privateBlocks: r.blocks };
  });
  let sandbox: SandboxRequirement[] | undefined = [];
  if (Object.hasOwn(k.obj, 'sandbox')) {
    const s = keys(c, k.obj.sandbox, 'sandbox', ['id', 'files', 'network'], ['strength', 'engines'], true);
    const filter = s ? engineFilter(c, s.obj, 'sandbox') : undefined;
    const id = s && (isId(s.obj.id) ? s.obj.id : c.fail('INVALID_ID', 'sandbox.id must be lowercase letters, digits, and single hyphens.'));
    if (!s || filter === undefined || id === undefined) sandbox = undefined;
    else if (Object.hasOwn(s.obj, 'strength') && s.obj.strength !== 'enforced') sandbox = c.fail('INVALID_FIELD', 'sandbox.strength can only be enforced: a sandbox requirement is always enforced.');
    else if (typeof s.obj.files !== 'boolean' || typeof s.obj.network !== 'boolean' || (!s.obj.files && !s.obj.network)) {
      sandbox = c.fail('INVALID_FIELD', 'sandbox.files and sandbox.network must be true or false, and at least one must be true.');
    } else sandbox = [{ id, strength: 'enforced', files: s.obj.files, network: s.obj.network, ...(filter ? { engines: filter } : {}), privateBlocks: s.blocks }];
  }
  if (!rules || !sandbox) return undefined;
  const before = c.problems.length;
  // The sandbox shares the id namespace of the rules.
  unique(c, [...rules, ...sandbox], r => r.id, 'rules');
  return c.problems.length === before ? { rules, sandbox } : undefined;
}

export function checkHooks(c: Checker, value: JsonValue): HookEntry[] | undefined {
  const k = keys(c, value, 'hooks.json', ['hooks'], [], false);
  const items = k && array(c, k.obj.hooks, 'hooks');
  if (!items) return undefined;
  const hooks = entries(items, (item, i) => {
    const where = `hooks[${i}]`;
    const h = keys(c, item, where, ['id', 'event', 'command', 'strength'], ['matcher', 'timeout', 'engines'], true);
    if (!h) return undefined;
    const id = isId(h.obj.id) ? h.obj.id : c.fail('INVALID_ID', `${where}.id must be lowercase letters, digits, and single hyphens.`);
    const event = typeof h.obj.event === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(h.obj.event) ? h.obj.event : c.fail('INVALID_FIELD', `${where}.event must be an event name such as PreToolUse.`);
    // At most one scanned line (DEFINITION_LIMITS.lineChars), so the secret scan reads all of it.
    const command = oneLine(c, h.obj.command, `${where}.command`, DEFINITION_LIMITS.lineChars);
    const strength = word(c, h.obj.strength, STRENGTHS, `${where}.strength`);
    const matcher = Object.hasOwn(h.obj, 'matcher') ? oneLine(c, h.obj.matcher, `${where}.matcher`) : null;
    const timeout = Object.hasOwn(h.obj, 'timeout') ? positiveMs(c, h.obj.timeout, `${where}.timeout`) : null;
    const filter = engineFilter(c, h.obj, where);
    if (id === undefined || event === undefined || command === undefined || !strength || matcher === undefined || timeout === undefined || filter === undefined) return undefined;
    return {
      id, event, ...(matcher !== null ? { matcher } : {}), command, ...(timeout !== null ? { timeout } : {}), strength,
      ...(filter ? { engines: filter } : {}), privateBlocks: h.blocks,
    };
  });
  if (!hooks) return undefined;
  const before = c.problems.length;
  unique(c, hooks, h => h.id, 'hooks');
  return c.problems.length === before ? hooks : undefined;
}

const MCP_OPTIONAL = ['command', 'args', 'url', 'env', 'headers', 'timeout', 'enabled', 'engines'];

export function checkMcp(c: Checker, value: JsonValue): McpServer[] | undefined {
  const k = keys(c, value, 'mcp.json', ['servers'], [], false);
  const items = k && array(c, k.obj.servers, 'servers');
  if (!items) return undefined;
  const servers = entries(items, (item, i) => {
    const where = `servers[${i}]`;
    const s = keys(c, item, where, ['name', 'transport'], MCP_OPTIONAL, true);
    if (!s) return undefined;
    const o = s.obj;
    const name = isServerName(o.name) ? o.name : c.fail('INVALID_ID', `${where}.name must be letters, digits, _ and -, up to 64 characters.`);
    const transport = word(c, o.transport, MCP_TRANSPORTS, `${where}.transport`);
    if (name === undefined || !transport) return undefined;
    const out: { -readonly [K in keyof McpServer]: McpServer[K] } = { id: name, name, transport, privateBlocks: s.blocks };
    let ok = true;
    if (transport === 'stdio') {
      if (Object.hasOwn(o, 'url')) { ok = false; c.fail('INVALID_FIELD', `${where} uses stdio and cannot have a url.`); }
      const command = Object.hasOwn(o, 'command') ? oneLine(c, o.command, `${where}.command`, 4096) : c.fail('INVALID_FIELD', `${where} uses stdio and needs a command.`);
      if (command === undefined) ok = false; else out.command = command;
      if (Object.hasOwn(o, 'args')) {
        const args = array(c, o.args, `${where}.args`);
        if (!args || args.some(a => typeof a !== 'string')) { ok = false; if (args) c.fail('INVALID_FIELD', `${where}.args must be a list of text.`); }
        else out.args = args as string[];
      }
    } else {
      if (Object.hasOwn(o, 'command') || Object.hasOwn(o, 'args')) { ok = false; c.fail('INVALID_FIELD', `${where} uses ${transport} and cannot have a command or args.`); }
      const url = Object.hasOwn(o, 'url') ? checkUrl(c, o.url, `${where}.url`) : c.fail('INVALID_FIELD', `${where} uses ${transport} and needs a url.`);
      if (url === undefined) ok = false; else out.url = url;
    }
    for (const f of ['env', 'headers'] as const) {
      if (!Object.hasOwn(o, f)) continue;
      const map = envMap(c, o[f], `${where}.${f}`);
      if (map === undefined) ok = false; else out[f] = map;
    }
    if (Object.hasOwn(o, 'timeout')) { const t = positiveMs(c, o.timeout, `${where}.timeout`); if (t === undefined) ok = false; else out.timeout = t; }
    if (Object.hasOwn(o, 'enabled')) { if (typeof o.enabled !== 'boolean') { ok = false; c.fail('INVALID_FIELD', `${where}.enabled must be true or false.`); } else out.enabled = o.enabled; }
    const filter = engineFilter(c, o, where);
    if (filter === undefined) ok = false; else if (filter !== null) out.engines = filter;
    return ok ? out : undefined;
  });
  if (!servers) return undefined;
  const before = c.problems.length;
  unique(c, servers, s => s.id, 'servers');
  return c.problems.length === before ? servers : undefined;
}

function checkUrl(c: Checker, value: JsonValue | undefined, where: string): string | undefined {
  if (typeof value !== 'string') return c.fail('INVALID_FIELD', `${where} must be a URL.`);
  let url: URL;
  try { url = new URL(value); } catch { return c.fail('INVALID_FIELD', `${where} must be a URL.`); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return c.fail('INVALID_FIELD', `${where} must use http, https, ws, or wss.`);
  return value;
}

/**
 * An `env` or `headers` map. A value is a literal, a string whose every `$` opens a `${NAME}` reference, or a keychain
 * reference. `${NAME:-x}` and `$NAME` are refused: neither is portable (locked-in parts spec, section 5.3).
 */
function envMap(c: Checker, value: JsonValue | undefined, where: string): Record<string, EnvValue> | undefined {
  if (!isRecord(value)) return c.fail('INVALID_FIELD', `${where} must be an object.`);
  const out: Record<string, EnvValue> = {};
  let ok = true;
  for (const [key, v] of Object.entries(value)) {
    if (key === '' || /[\0-\x1f\x7f=]/.test(key)) { ok = false; c.fail('INVALID_FIELD', `${where} has a key that is empty or holds = or a control character.`); continue; }
    if (typeof v === 'string') {
      if (v.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').includes('$')) { ok = false; c.fail('ENV_REFERENCE', `${where}.${key} uses a $ form other than \${NAME}. Write \${NAME}; defaults such as \${NAME:-x} are not portable.`); continue; }
      out[key] = v;
    } else if (isRecord(v) && Object.keys(v).length === 1 && typeof v.keychain === 'string' && v.keychain.trim() !== '' && v.keychain.length <= 256) {
      out[key] = { keychain: v.keychain };
    } else { ok = false; c.fail('INVALID_FIELD', `${where}.${key} must be text or { "keychain": "<entry>" }.`); }
  }
  return ok ? out : undefined;
}

/** A pinned version: no range, wildcard, or tag that moves. */
function pinned(version: string): boolean {
  return !/[\^~*<>=|\s]/.test(version) && !/^(?:latest|next|main|master|head)$/i.test(version) && !/(?:^|\.)x(?:\.|$)/i.test(version);
}

export function checkSources(c: Checker, value: JsonValue): SourceRecord[] | undefined {
  const k = keys(c, value, 'sources.json', ['sources'], [], false);
  const items = k && array(c, k.obj.sources, 'sources');
  if (!items) return undefined;
  const sources = entries(items, (item, i) => {
    const where = `sources[${i}]`;
    const s = keys(c, item, where, ['name', 'marketplace', 'version', 'items'], [], false);
    if (!s) return undefined;
    const name = oneLine(c, s.obj.name, `${where}.name`, 256);
    const marketplace = oneLine(c, s.obj.marketplace, `${where}.marketplace`, 256);
    let version = oneLine(c, s.obj.version, `${where}.version`, 256);
    if (version !== undefined && !pinned(version)) version = c.fail('SOURCE_NOT_PINNED', `${where}.version must be one pinned version, not a range or a moving tag.`);
    const list = array(c, s.obj.items, `${where}.items`, 1);
    const refs = list && entries(list, (ref, j) => {
      const r = keys(c, ref, `${where}.items[${j}]`, ['part', 'id'], [], false);
      const part = r && word(c, r.obj.part, OVERRIDABLE_PARTS, `${where}.items[${j}].part`);
      if (!r || !part) return undefined;
      return typeof r.obj.id === 'string' && r.obj.id !== '' ? { part, id: r.obj.id } : c.fail('INVALID_ID', `${where}.items[${j}].id must be an id.`);
    });
    if (name === undefined || marketplace === undefined || version === undefined || !refs) return undefined;
    return { name, marketplace, version, items: refs as { part: OverridablePart; id: string }[] };
  });
  if (!sources) return undefined;
  const before = c.problems.length;
  unique(c, sources, s => `${s.marketplace}\n${s.name}`, 'sources');
  unique(c, sources.flatMap(s => s.items), item => `${item.part}/${item.id}`, 'source items');
  return c.problems.length === before ? sources : undefined;
}

/** Maps every item; undefined when any item had a fault. */
function entries<T>(items: readonly JsonValue[], check: (item: JsonValue, index: number) => T | undefined): T[] | undefined {
  const out: T[] = [];
  let ok = true;
  items.forEach((item, i) => { const v = check(item, i); if (v === undefined) ok = false; else out.push(v); });
  return ok ? out : undefined;
}
