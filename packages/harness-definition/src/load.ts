/**
 * Reads one definition folder: the `.bowerloom` folder of a layer, laid out as in section 8. Only the section 8 paths
 * are read. Other files in the folder, such as `skills.json`, `bowerloom.json`, `manifest.json`, `team.yaml`, and the
 * receipts, are neither read nor changed (rule 6). Nothing is written.
 *
 * Every definition file is accounted for: a part file that `harness.json` does not point to, a pointer to a missing
 * file, and an unexpected file inside a part folder are refused, so nothing is dropped in silence. Symbolic links are
 * refused. `.DS_Store` is skipped; any other name that starts with `.` is refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeText, parseStrictJson, readFrontmatter, toLf } from './json.js';
import { computeRevision } from './revision.js';
import {
  Checker, checkGuardrails, checkHarness, checkHooks, checkMcp, checkSkill, checkSources, checkSubagent,
} from './schema.js';
import { scanSecrets } from './secrets.js';
import type {
  Definition, DefinitionFile, HarnessFile, JsonValue, LoadResult, PartEntries, Problem, SkillEntry, SourceRecord, SubagentEntry,
} from './types.js';
import { DEFINITION_LIMITS, ENGINE_IDS, PART_LOCATIONS, isEngineId, isId } from './words.js';
import type { EngineId, PartKey } from './words.js';

/** Top-level names of section 8, with the part key that must point to each. `engines/` has no pointer. */
const TOP: Readonly<Record<string, { dir: boolean; key: PartKey | null }>> = {
  'harness.json': { dir: false, key: null },
  instructions: { dir: true, key: 'system-prompt' },
  skills: { dir: true, key: 'skills' },
  agents: { dir: true, key: 'subagents' },
  scripts: { dir: true, key: 'scripts' },
  engines: { dir: true, key: null },
  'hooks.json': { dir: false, key: 'hooks' },
  'guardrails.json': { dir: false, key: 'guardrails' },
  'mcp.json': { dir: false, key: 'mcp' },
  'sources.json': { dir: false, key: 'plugins' },
};
const IGNORED = new Set(['.DS_Store']);
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

class Reader {
  readonly problems: Problem[] = [];
  readonly files = new Map<string, Uint8Array>();
  private total = 0;
  private readonly canonical = new Set<string>();
  constructor(readonly root: string) {}

  fail(code: string, rel: string, message: string): void { this.problems.push({ code, path: rel, message }); }

  /** The kind of an entry, without following a link. Null when it does not exist. */
  kind(rel: string): 'file' | 'dir' | 'link' | 'other' | null {
    let st: fs.Stats;
    try { st = fs.lstatSync(path.join(this.root, rel)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  }

  /** Reads one regular file into the set, within the limits. */
  read(rel: string): Uint8Array | undefined {
    const kind = this.kind(rel);
    if (kind === 'link') { this.fail('SYMLINK', rel, 'A definition cannot hold a symbolic link.'); return undefined; }
    if (kind !== 'file') { this.fail('UNEXPECTED_FILE', rel, 'This must be a regular file.'); return undefined; }
    const key = rel.normalize('NFC');
    if (this.canonical.has(key)) { this.fail('DUPLICATE_PATH', rel, 'Two files have this name in different Unicode forms.'); return undefined; }
    this.canonical.add(key);
    if (this.files.size >= DEFINITION_LIMITS.files) { this.fail('TOO_LARGE', rel, `A definition holds at most ${DEFINITION_LIMITS.files} files.`); return undefined; }
    const bytes = fs.readFileSync(path.join(this.root, rel));
    if (bytes.length > DEFINITION_LIMITS.fileBytes) { this.fail('TOO_LARGE', rel, 'A definition file holds at most 1 MiB.'); return undefined; }
    this.total += bytes.length;
    if (this.total > DEFINITION_LIMITS.totalBytes) { this.fail('TOO_LARGE', rel, 'A definition holds at most 32 MiB in all.'); return undefined; }
    this.files.set(rel, bytes);
    return bytes;
  }

  /** The names in a folder, in byte order, without ignored names. Refuses links and hidden names. */
  list(rel: string): { name: string; kind: 'file' | 'dir' }[] {
    const out: { name: string; kind: 'file' | 'dir' }[] = [];
    for (const name of fs.readdirSync(path.join(this.root, rel)).sort(byBytes)) {
      if (IGNORED.has(name)) continue;
      const child = `${rel}/${name}`;
      if (name.startsWith('.') || /[\0-\x1f\x7f\\]/.test(name)) { this.fail('UNEXPECTED_FILE', child, 'A definition cannot hold a hidden file or a name with a control character or a backslash.'); continue; }
      const kind = this.kind(child);
      if (kind === 'link') { this.fail('SYMLINK', child, 'A definition cannot hold a symbolic link.'); continue; }
      if (kind === 'file' || kind === 'dir') out.push({ name, kind });
      else this.fail('UNEXPECTED_FILE', child, 'This must be a regular file or a folder.');
    }
    return out;
  }

  /** Reads every file below a folder. Returns paths relative to that folder. */
  tree(rel: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const { name, kind } of this.list(rel)) {
      if (kind === 'dir') out.push(...this.tree(`${rel}/${name}`, `${prefix}${name}/`));
      else if (this.read(`${rel}/${name}`)) out.push(`${prefix}${name}`);
    }
    return out;
  }

  text(rel: string, bytes: Uint8Array): string | undefined {
    const t = decodeText(bytes);
    if (t === null) { this.fail('TEXT_ENCODING', rel, 'This file must be UTF-8 text with no byte order mark and no NUL.'); return undefined; }
    return t;
  }

  json(rel: string, bytes: Uint8Array): JsonValue | undefined {
    const t = this.text(rel, bytes);
    if (t === undefined) return undefined;
    const parsed = parseStrictJson(t);
    if (parsed.ok) return parsed.value;
    const why: Record<string, string> = {
      DUPLICATE_JSON_KEY: 'repeats a key', INVALID_JSON: 'is not strict JSON: comments, trailing commas, and single quotes are not allowed',
      JSON_BOUND: 'is too large', JSON_COMPLEXITY: 'is nested too deeply', NONFINITE_JSON: 'holds a number that is not finite',
      INVALID_UNICODE: 'holds text that is not valid Unicode', UNSAFE_KEY: 'uses the key __proto__',
    };
    this.fail(parsed.code, rel, `This file ${why[parsed.code] ?? 'is not strict JSON'}.`);
    return undefined;
  }

  merge(c: Checker): void { this.problems.push(...c.problems); }
}

/** Loads the definition in a `.bowerloom` folder. Returns every problem found, or the definition. */
export function loadDefinition(folder: string): LoadResult {
  const root = path.resolve(folder);
  const r = new Reader(root);
  let st: fs.Stats;
  try { st = fs.lstatSync(root); } catch { return fail([{ code: 'FOLDER_MISSING', path: '.', message: 'The definition folder does not exist.' }]); }
  if (!st.isDirectory()) return fail([{ code: 'FOLDER_MISSING', path: '.', message: 'The definition folder must be a folder, not a file or a link.' }]);
  if (r.kind('harness.json') === null) return fail([{ code: 'HARNESS_MISSING', path: 'harness.json', message: 'A definition folder needs a harness.json file.' }]);

  const present = new Set<string>();
  for (const [name, shape] of Object.entries(TOP)) {
    const kind = r.kind(name);
    if (kind === null) continue;
    if (kind === 'link') { r.fail('SYMLINK', name, 'A definition cannot hold a symbolic link.'); continue; }
    if ((kind === 'dir') !== shape.dir) { r.fail('UNEXPECTED_FILE', name, shape.dir ? 'This must be a folder.' : 'This must be a file.'); continue; }
    present.add(name);
  }

  const harnessBytes = present.has('harness.json') ? r.read('harness.json') : undefined;
  const harnessValue = harnessBytes && r.json('harness.json', harnessBytes);
  const hc = new Checker('harness.json');
  const harness = harnessValue === undefined ? undefined : checkHarness(hc, harnessValue);
  r.merge(hc);

  // Read every present part, whether or not it is listed, so each fault is reported in one pass.
  const instructions = present.has('instructions') ? readInstructions(r) : undefined;
  const skills = present.has('skills') ? readSkills(r) : [];
  const subagents = present.has('agents') ? readSubagents(r) : [];
  const scripts = present.has('scripts') ? r.tree('scripts') : [];
  const enginePrivate = present.has('engines') ? readEngines(r) : {};
  const guardrails = readJsonPart(r, present, 'guardrails.json', checkGuardrails) ?? { rules: [], sandbox: [] };
  const hooks = readJsonPart(r, present, 'hooks.json', checkHooks) ?? [];
  const mcp = readJsonPart(r, present, 'mcp.json', checkMcp) ?? [];
  const sources = readJsonPart(r, present, 'sources.json', checkSources) ?? [];

  const entries: PartEntries = { skills, subagents, rules: guardrails.rules, sandbox: guardrails.sandbox, hooks, mcp };
  if (harness) checkPointers(r, harness, present, instructions, entries);
  checkSourceItems(r, sources, entries);

  const files: DefinitionFile[] = [...r.files.entries()].sort(([a], [b]) => byBytes(a, b)).map(([p, bytes]) => ({ path: p, bytes }));
  for (const f of scanSecrets(files)) {
    const at = f.line !== undefined ? `Line ${f.line}` : `The value at ${f.pointer}`;
    r.fail('SECRET_VALUE', f.path, `${at} looks like a secret value (${f.rule}). Store a reference instead: \${NAME} for a variable, or { "keychain": "<entry>" }.`);
  }

  if (r.problems.length || !harness) return fail(r.problems);
  const definition: Definition = {
    folder: root, harness, ...(instructions !== undefined ? { instructions } : {}), entries, sources, scripts, enginePrivate,
    files, revision: computeRevision(files),
  };
  return { ok: true, definition };
}

function fail(problems: readonly Problem[]): LoadResult { return { ok: false, problems }; }

function readInstructions(r: Reader): string | undefined {
  let found: string | undefined;
  for (const { name, kind } of r.list('instructions')) {
    const rel = `instructions/${name}`;
    if (name !== 'AGENTS.md' || kind !== 'file') { r.fail('UNEXPECTED_FILE', rel, 'The instructions folder holds only AGENTS.md.'); continue; }
    const bytes = r.read(rel);
    const t = bytes && r.text(rel, bytes);
    if (t !== undefined) found = toLf(t);
  }
  return found;
}

function readSkills(r: Reader): SkillEntry[] {
  const out: SkillEntry[] = [];
  for (const { name, kind } of r.list('skills')) {
    const rel = `skills/${name}`;
    if (kind !== 'dir') { r.fail('UNEXPECTED_FILE', rel, 'The skills folder holds only skill folders, each with a SKILL.md.'); continue; }
    if (!isId(name)) { r.fail('INVALID_ID', rel, 'A skill folder name must be lowercase letters, digits, and single hyphens, up to 64 characters.'); continue; }
    const files = r.tree(rel).sort(byBytes);
    if (!files.includes('SKILL.md')) { r.fail('SKILL_MISSING', rel, 'A skill folder needs a SKILL.md file.'); continue; }
    const skillPath = `${rel}/SKILL.md`;
    const t = r.text(skillPath, r.files.get(skillPath)!);
    if (t === undefined) continue;
    const fm = readFrontmatter(t);
    if (!fm.ok) { r.fail(fm.code, skillPath, fm.message); continue; }
    const c = new Checker(skillPath);
    const entry = checkSkill(c, name, { ...fm.data }, fm.body, files);
    r.merge(c);
    if (entry) out.push(entry);
  }
  return out;
}

function readSubagents(r: Reader): SubagentEntry[] {
  const out: SubagentEntry[] = [];
  for (const { name, kind } of r.list('agents')) {
    const rel = `agents/${name}`;
    const m = /^(.+)\.md$/.exec(name);
    if (kind !== 'file' || !m) { r.fail('UNEXPECTED_FILE', rel, 'The agents folder holds only <id>.md files.'); continue; }
    if (!isId(m[1])) { r.fail('INVALID_ID', rel, 'A subagent file name must be lowercase letters, digits, and single hyphens, then .md.'); continue; }
    const bytes = r.read(rel);
    const t = bytes && r.text(rel, bytes);
    if (t === undefined) continue;
    const fm = readFrontmatter(t);
    if (!fm.ok) { r.fail(fm.code, rel, fm.message); continue; }
    const c = new Checker(rel);
    const entry = checkSubagent(c, m[1]!, { ...fm.data }, fm.body);
    r.merge(c);
    if (entry) out.push(entry);
  }
  return out;
}

function readEngines(r: Reader): Partial<Record<EngineId, string[]>> {
  const out: Partial<Record<EngineId, string[]>> = {};
  for (const { name, kind } of r.list('engines')) {
    const rel = `engines/${name}`;
    if (kind !== 'dir') { r.fail('UNEXPECTED_FILE', rel, 'The engines folder holds only one folder per engine.'); continue; }
    if (!isEngineId(name)) { r.fail('UNKNOWN_ENGINE', rel, `${name} is not an engine. The engines are ${ENGINE_IDS.join(', ')}.`); continue; }
    out[name] = r.tree(rel).sort(byBytes);
  }
  return out;
}

function readJsonPart<T>(r: Reader, present: Set<string>, name: string, check: (c: Checker, value: JsonValue) => T | undefined): T | undefined {
  if (!present.has(name)) return undefined;
  const bytes = r.read(name);
  const value = bytes && r.json(name, bytes);
  if (value === undefined) return undefined;
  const c = new Checker(name);
  const out = check(c, value);
  r.merge(c);
  return out;
}

/** Each present part has a pointer, each pointer has its part, and each pointer names the section 8 location. */
function checkPointers(r: Reader, harness: HarnessFile, present: Set<string>, instructions: string | undefined, entries: PartEntries): void {
  const parts = harness.parts as Record<string, string | readonly string[] | undefined>;
  for (const [name, shape] of Object.entries(TOP)) {
    if (shape.key && present.has(name) && parts[shape.key] === undefined) {
      r.fail('PART_NOT_LISTED', name, `harness.json does not point to ${name}. Add "${shape.key}": "${PART_LOCATIONS[shape.key as keyof typeof PART_LOCATIONS]}" to parts.`);
    }
  }
  for (const [key, where] of Object.entries(PART_LOCATIONS)) {
    const pointer = parts[key];
    if (pointer === undefined) continue;
    if (pointer !== where) {
      const extra = key === 'memory' ? ' How a knowledge base connects is not defined yet.' : '';
      r.fail('PART_POINTER', 'harness.json', `parts.${key} must be ${where}.${extra}`);
      continue;
    }
    const top = where.split('/')[0]!;
    if (!present.has(top) || (key === 'system-prompt' || key === 'memory') && instructions === undefined) {
      r.fail('PART_MISSING', 'harness.json', `parts.${key} points to ${where}, which does not exist.`);
    }
  }
  for (const pointer of harness.parts['tool-guidance'] ?? []) {
    const heading = /^instructions\/AGENTS\.md#(.+)$/.exec(pointer);
    const skill = /^skills\/([^/]+)$/.exec(pointer);
    const found = heading
      ? instructions !== undefined && instructions.split('\n').some(line => { const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line); return m?.[1] === heading[1]; })
      : skill ? entries.skills.some(s => s.id === skill[1]) : false;
    if (!found) r.fail('PART_POINTER', 'harness.json', `parts.tool-guidance names ${JSON.stringify(pointer)}, which is not a heading of instructions/AGENTS.md (instructions/AGENTS.md#<heading>) or a skill of this layer (skills/<id>).`);
  }
}

function checkSourceItems(r: Reader, sources: readonly SourceRecord[], entries: PartEntries): void {
  const ids: Record<string, readonly { id: string }[]> = {
    skills: entries.skills, subagents: entries.subagents, guardrails: entries.rules, hooks: entries.hooks, mcp: entries.mcp,
  };
  sources.forEach((s, i) => s.items.forEach((item, j) => {
    if (!ids[item.part]!.some(e => e.id === item.id)) r.fail('SOURCE_ITEM_MISSING', 'sources.json', `sources[${i}].items[${j}] names ${item.part}/${item.id}, which this layer does not hold.`);
  }));
}
