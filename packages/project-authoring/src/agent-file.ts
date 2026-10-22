/**
 * Validation of one team agent file, `.bowerloom/teams/<team>/agents/<stem>.md` (spec 01a, section 4.1). The file is a
 * Claude Code subagent: YAML frontmatter, then a body. `parseAgent` is pure. It reads no file and starts nothing.
 * Both the status verifier (this package) and `apply` (project-sync) call it, so one file has one verdict.
 *
 * A failure carries a fixed code and a fixed phrase. A phrase names a key only when the key is plain; no message
 * quotes other file text.
 */
import { isMap, isNode, isScalar, parseDocument, visit } from 'yaml';
import { refuse } from './refusal.js';

export type AgentParseCode = 'AGENT_INVALID' | 'AGENT_KEY_UNKNOWN' | 'AGENT_NAME_MISMATCH';
export interface ParsedAgent {
  stem: string; team: string; name: string; description: string;
  /** The frontmatter keys present, in file order. */
  keys: string[];
  /** The tool entries; null when the key `tools` is absent. `tools: []` is an empty list. */
  tools: string[] | null;
  disallowedTools: string[] | null; skills: string[] | null;
  permissionMode: string | null;
}
export type AgentParse = { ok: true; agent: ParsedAgent } | { ok: false; code: AgentParseCode; detail: string };

/** The documented subagent keys (Claude Code sub-agents documentation, fetched 2026-10-22), in documented order. */
export const ALLOWED_AGENT_KEYS: readonly string[] = Object.freeze([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'autoCompactWindow', 'skills',
  'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color', 'initialPrompt', 'experimental',
]);
export const AGENT_STEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AGENT_STEM_MAX = 64;
/** Hidden files and editor backups (`.DS_Store`, `.x.swp`, `x~`) in an agents folder are neither agents nor findings. */
export const skippedAgentName = (name: string): boolean => name.startsWith('.') || name.endsWith('~');
const PLAIN_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const FENCE = /^---[ \t]*$/;
const TOOL = /^[A-Za-z0-9_.:*-]+(\(.{0,100}\))?$/;
const SKILL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,127}$/;
const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan', 'manual'];
const MEMORY = ['user', 'project', 'local'];
const EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

class Failure extends Error {
  constructor(readonly code: AgentParseCode, readonly detail: string) { super(code); }
}
function invalid(detail: string): never { throw new Failure('AGENT_INVALID', detail); }
const keyWords = (key: string): string => PLAIN_KEY.test(key) ? `the key ${key}` : 'a key with unsupported characters';

/** Splits a comma string at each comma outside parentheses. Unbalanced parentheses fail. */
function splitOutsideParens(value: string, key: string): string[] {
  const out: string[] = []; let depth = 0, from = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth < 0) return invalid(`${keyWords(key)} has unbalanced parentheses`); }
    else if (c === ',' && depth === 0) { out.push(value.slice(from, i)); from = i + 1; }
  }
  if (depth !== 0) return invalid(`${keyWords(key)} has unbalanced parentheses`);
  out.push(value.slice(from));
  return out.map(s => s.trim());
}
function balanced(entry: string): boolean {
  let depth = 0;
  for (const c of entry) { if (c === '(') depth++; else if (c === ')' && --depth < 0) return false; }
  return depth === 0;
}
/** `tools`, `disallowedTools` and `skills`: a comma string or a list of strings. */
function entries(key: string, value: unknown, pattern: RegExp): string[] {
  let list: string[];
  if (typeof value === 'string') list = splitOutsideParens(value, key);
  else if (Array.isArray(value) && value.every(v => typeof v === 'string')) list = [...value] as string[];
  else return invalid(`${keyWords(key)} must be a comma-separated string or a list of strings`);
  if (list.length > 64) invalid(`${keyWords(key)} lists more than 64 entries`);
  for (const entry of list) if (entry.length < 1 || entry.length > 128 || !balanced(entry) || !pattern.test(entry)) invalid(`${keyWords(key)} has an entry that is not valid`);
  return list;
}
const oneOf = (key: string, value: unknown, list: readonly string[]): string => {
  if (typeof value !== 'string' || !list.includes(value)) invalid(`${keyWords(key)} has a value that is not allowed`);
  return value as string;
};
const integer = (key: string, value: unknown, min: number, max: number): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${keyWords(key)} must be a whole number from ${min} to ${max}`);
};
const depthOf = (value: unknown): number => {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return 1 + Math.max(0, ...children.map(depthOf));
};
/** `hooks` and `mcpServers`: a map or a list, at most 6 levels deep, and at most 4096 bytes of the source text. */
function opaque(key: string, value: unknown, sourceBytes: number): void {
  if (value === null || typeof value !== 'object') return invalid(`${keyWords(key)} must be a map or a list`);
  if (depthOf(value) > 6) invalid(`${keyWords(key)} is nested more than 6 levels deep`);
  if (sourceBytes > 4096) invalid(`${keyWords(key)} is larger than 4096 bytes`);
}

/** The bytes the value of a top-level key takes in the frontmatter text. */
function sourceSize(doc: ReturnType<typeof parseDocument>, key: string, block: string): number {
  const root = doc.contents;
  if (!isMap(root)) return 0;
  for (const pair of root.items) if (isScalar(pair.key) && pair.key.value === key && isNode(pair.value) && pair.value.range) return Buffer.byteLength(block.slice(pair.value.range[0], pair.value.range[1]));
  return 0;
}
function frontmatter(text: string): { block: string; body: string } {
  if (text.includes('\0') || text.includes('\r')) invalid('the file holds a null byte or a carriage return');
  if (text.startsWith('\uFEFF')) invalid('the file starts with a byte order mark');
  const lines = text.split('\n');
  if (!FENCE.test(lines[0] ?? '')) invalid('the file does not start with a --- line');
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end < 0) invalid('the frontmatter has no closing --- line');
  const body = lines.slice(end + 1).join('\n').replace(/\n+$/, '');
  if (body.trim() === '') invalid('the body is empty');
  // Claude Code ends the frontmatter at the first --- anywhere, even inside a comment or a value, and its YAML retry
  // rewrites leading tabs. Bowerloom would read more lines than Claude Code does, so it refuses both.
  const inside = lines.slice(1, end);
  if (inside.some(l => l.includes('---'))) invalid('the frontmatter holds --- inside a line');
  if (inside.some(l => l.startsWith('\t'))) invalid('a frontmatter line starts with a tab');
  return { block: inside.join('\n'), body };
}

function validate(text: string, stem: string, team: string): ParsedAgent {
  if (typeof stem !== 'string' || stem.length > AGENT_STEM_MAX || !AGENT_STEM.test(stem) || stem.startsWith('prompt-')) throw new Failure('AGENT_NAME_MISMATCH', 'the file name is not a valid role name');
  if (typeof text !== 'string') return invalid('the file is not text');
  const { block } = frontmatter(text);
  const doc = parseDocument(block, { uniqueKeys: true });
  if (doc.errors.length) invalid('the frontmatter is not valid YAML, or repeats a key');
  if (doc.warnings.length) invalid('the frontmatter holds a tag or a value that YAML cannot resolve');
  let tagged = false; visit(doc, { Node(_key, node) { if (node.tag !== undefined) tagged = true; } });
  if (tagged) invalid('the frontmatter uses an explicit YAML tag, which is not allowed');
  let value: unknown;
  try { value = doc.toJS({ maxAliasCount: 0 }); } catch { return invalid('the frontmatter uses an alias, which is not allowed'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('the frontmatter is not a map of keys');
  const map = value as Record<string, unknown>, keys = Object.keys(map);
  let merge = false; visit(doc, { Pair(_key, pair) { if (isScalar(pair.key) && pair.key.value === '<<') merge = true; } });
  if (merge) invalid('the frontmatter uses a merge key, which is not allowed');
  for (const key of keys) if (!ALLOWED_AGENT_KEYS.includes(key)) throw new Failure('AGENT_KEY_UNKNOWN', PLAIN_KEY.test(key) ? key : 'a key with unsupported characters');
  const get = (k: string): unknown => Object.hasOwn(map, k) ? map[k] : undefined;
  // Name and description are required. A key whose value is null is invalid, here and below.
  const name = get('name');
  if (typeof name !== 'string') invalid('the key name is required and must be text');
  if (name !== stem) throw new Failure('AGENT_NAME_MISMATCH', 'the key name differs from the file name');
  const description = get('description');
  if (typeof description !== 'string' || description.length < 1 || description.length > 2048) invalid('the key description is required, from 1 to 2048 characters');
  const parsed: ParsedAgent = { stem, team, name: name as string, description: description as string, keys, tools: null, disallowedTools: null, skills: null, permissionMode: null };
  for (const key of keys) {
    const v = map[key];
    if (key === 'name' || key === 'description') continue;
    if (v === null || v === undefined) invalid(`${keyWords(key)} has no value`);
    switch (key) {
      case 'tools': parsed.tools = entries(key, v, TOOL); break;
      case 'disallowedTools': parsed.disallowedTools = entries(key, v, TOOL); break;
      case 'skills': parsed.skills = entries(key, v, SKILL); break;
      case 'model': if (typeof v !== 'string' || !MODEL.test(v)) invalid('the key model is not valid'); break;
      case 'permissionMode': parsed.permissionMode = oneOf(key, v, PERMISSION_MODES); break;
      case 'maxTurns': integer(key, v, 1, 10000); break;
      case 'autoCompactWindow': integer(key, v, 100000, 1000000); break;
      case 'mcpServers': case 'hooks': opaque(key, v, sourceSize(doc, key, block)); break;
      case 'memory': oneOf(key, v, MEMORY); break;
      case 'background': case 'omitClaudeMd': if (typeof v !== 'boolean') invalid(`${keyWords(key)} must be true or false`); break;
      case 'effort': oneOf(key, v, EFFORT); break;
      case 'isolation': oneOf(key, v, ['worktree']); break;
      case 'color': oneOf(key, v, COLORS); break;
      case 'initialPrompt': if (typeof v !== 'string' || Buffer.byteLength(v) > 8192) invalid('the key initialPrompt must be text of at most 8192 bytes'); break;
      case 'experimental': {
        if (typeof v !== 'object' || Array.isArray(v)) invalid('the key experimental must be a map');
        const inner = v as Record<string, unknown>, innerKeys = Object.keys(inner);
        if (innerKeys.length !== 1 || innerKeys[0] !== 'cacheTtl' || (inner.cacheTtl !== '5m' && inner.cacheTtl !== '1h')) invalid('the key experimental takes only cacheTtl, 5m or 1h');
        break;
      }
      default: break;
    }
  }
  return parsed;
}

/** Validates one agent file. `stem` is the file name without `.md`; `team` is the team folder it sits in. */
export function parseAgent(text: string, stem: string, team: string): AgentParse {
  try { return { ok: true, agent: validate(text, stem, team) }; }
  catch (error) {
    if (error instanceof Failure) return { ok: false, code: error.code, detail: error.detail };
    return { ok: false, code: 'AGENT_INVALID', detail: 'the file cannot be read' };
  }
}
/** `parseAgent`, throwing the authoring refusal of the failure code. */
export function parseAgentOrRefuse(text: string, stem: string, team: string): ParsedAgent {
  const result = parseAgent(text, stem, team);
  if (!result.ok) return refuse(result.code);
  return result.agent;
}
