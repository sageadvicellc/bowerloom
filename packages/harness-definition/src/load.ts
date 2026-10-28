/**
 * Reads one definition folder: the `.bowerloom` folder of a layer, laid out as in section 8. A folder is a 0.8
 * definition only when it holds `harness.json` (lead ruling R3). Nothing is written.
 *
 * Every entry is accounted for:
 * - At the top, each name is a section 8 name or a 0.7 name (`LEGACY_NAMES`). A 0.7 name is neither read nor changed
 *   (rule 6). Any other name is refused, so a typo such as `guardrail.json` is not dropped in silence.
 * - A part file that `harness.json` does not point to, a pointer to a missing file, and an unexpected file inside a part
 *   folder are refused.
 * - Symbolic links, hard links, and hidden names are refused. `.DS_Store` is skipped when it is a file, and an empty
 *   `.gitkeep` is allowed.
 * - An entry that cannot be read is an UNREADABLE problem with the relative path and the system error code.
 *
 * Reads are bounded: each file is opened without following links, checked with fstat for its kind, link count, and
 * size, and read only up to that size. Folder depth, entries per folder, file count, total bytes, and the problem
 * list are capped (`DEFINITION_LIMITS`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeText, parseStrictJson, readFrontmatter, toLf } from './json.js';
import { computeRevision, fileContentHash, skillContentHash } from './revision.js';
import {
  Checker, checkGuardrails, checkHarness, checkHooks, checkMcp, checkSkill, checkSources, checkSubagent,
} from './schema.js';
import { INCOMPLETE_RULES, safeName, scanSecrets } from './secrets.js';
import type {
  AdoptedRecord, Definition, DefinitionFile, HarnessFile, JsonValue, LoadResult, PartEntries, Problem, SkillEntry, SourceRecord, SubagentEntry,
} from './types.js';
import { DEFINITION_LIMITS, ENGINE_IDS, LEGACY_NAMES, PART_LOCATIONS, isEngineId, isId } from './words.js';
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
const LEGACY = new Set<string>(LEGACY_NAMES);
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
type Kind = 'file' | 'dir' | 'link' | 'other' | null;

class Reader {
  readonly problems: Problem[] = [];
  readonly files = new Map<string, { bytes: Uint8Array; executable: boolean }>();
  private total = 0;
  private readonly canonical = new Set<string>();
  constructor(readonly root: string) {}

  fail(code: string, rel: string, message: string): void {
    if (this.problems.length < DEFINITION_LIMITS.problems) this.problems.push({ code, path: rel, message });
    else if (this.problems.length === DEFINITION_LIMITS.problems) this.problems.push({ code: 'TOO_MANY_PROBLEMS', path: '.', message: `More than ${DEFINITION_LIMITS.problems} problems; the rest are not listed.` });
  }
  unreadable(rel: string, error: unknown): void {
    const code = (error as NodeJS.ErrnoException)?.code;
    this.fail('UNREADABLE', rel, `This entry cannot be read (${typeof code === 'string' && /^E[A-Z]+$/.test(code) ? code : 'an error'}).`);
  }

  /** The kind of an entry, without following a link. Null when it does not exist, `other` after an UNREADABLE problem. */
  kind(rel: string): Kind {
    let st: fs.Stats;
    try { st = fs.lstatSync(path.join(this.root, rel)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      this.unreadable(rel, error);
      return 'other';
    }
    return st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  }

  /** Reads one regular file into the set: no link, one hard link, within the limits, the size checked before the read. */
  read(rel: string): Uint8Array | undefined {
    const key = rel.normalize('NFC');
    if (this.canonical.has(key)) { this.fail('DUPLICATE_PATH', rel, 'Two files have this name in different Unicode forms.'); return undefined; }
    this.canonical.add(key);
    if (this.files.size >= DEFINITION_LIMITS.files) { this.fail('TOO_LARGE', rel, `A definition holds at most ${DEFINITION_LIMITS.files} files.`); return undefined; }
    const abs = path.join(this.root, rel);
    let seen: fs.Stats;
    try { seen = fs.lstatSync(abs); } catch (error) { this.unreadable(rel, error); return undefined; }
    if (seen.isSymbolicLink()) { this.fail('SYMLINK', rel, 'A definition cannot hold a symbolic link.'); return undefined; }
    let fd: number;
    try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') this.fail('SYMLINK', rel, 'A definition cannot hold a symbolic link.');
      else this.unreadable(rel, error);
      return undefined;
    }
    try {
      const st = fs.fstatSync(fd);
      // The file opened must be the file checked: a swap between the two is refused.
      if (st.dev !== seen.dev || st.ino !== seen.ino) { this.fail('FILE_CHANGED', rel, 'This file was replaced while it was read.'); return undefined; }
      if (!st.isFile()) { this.fail('UNEXPECTED_FILE', rel, 'This must be a regular file.'); return undefined; }
      if (st.nlink !== 1) { this.fail('HARDLINK', rel, 'A definition cannot hold a file with more than one hard link.'); return undefined; }
      if (st.size > DEFINITION_LIMITS.fileBytes) { this.fail('TOO_LARGE', rel, 'A definition file holds at most 1 MiB.'); return undefined; }
      if (this.total + st.size > DEFINITION_LIMITS.totalBytes) { this.fail('TOO_LARGE', rel, 'A definition holds at most 32 MiB in all.'); return undefined; }
      const buffer = Buffer.alloc(st.size + 1);
      let length = 0;
      for (;;) {
        const n = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (n === 0) break;
        length += n;
        if (length === buffer.length) break;
      }
      if (length !== st.size) { this.fail('FILE_CHANGED', rel, 'This file changed while it was read.'); return undefined; }
      const bytes = buffer.subarray(0, length);
      this.total += length;
      this.files.set(rel, { bytes, executable: (st.mode & 0o111) !== 0 });
      return bytes;
    } catch (error) {
      this.unreadable(rel, error);
      return undefined;
    } finally { fs.closeSync(fd); }
  }

  /**
   * The names in a folder, in byte order. The folder is checked again just before it is listed. Refuses links, hidden
   * names, and odd characters; skips a `.DS_Store` file and an empty `.gitkeep` file.
   */
  list(rel: string, depth: number): { name: string; kind: 'file' | 'dir' }[] {
    if (depth > DEFINITION_LIMITS.depth) { this.fail('TOO_DEEP', rel, `A definition nests folders at most ${DEFINITION_LIMITS.depth} deep.`); return []; }
    const self = this.kind(rel);
    if (self === 'link') { this.fail('SYMLINK', rel, 'A definition cannot hold a symbolic link.'); return []; }
    if (self !== 'dir') return [];
    let names: string[];
    try { names = fs.readdirSync(path.join(this.root, rel)); } catch (error) { this.unreadable(rel, error); return []; }
    if (names.length > DEFINITION_LIMITS.folderEntries) { this.fail('TOO_LARGE', rel, `A folder holds at most ${DEFINITION_LIMITS.folderEntries} entries.`); return []; }
    const out: { name: string; kind: 'file' | 'dir' }[] = [];
    for (const name of names.sort(byBytes)) {
      const child = `${rel}/${name}`;
      const kind = this.kind(child);
      if (kind === 'link') { this.fail('SYMLINK', child, 'A definition cannot hold a symbolic link.'); continue; }
      if (kind === 'file' && this.skipped(child, name)) continue;
      if (name.startsWith('.') || /[\0-\x1f\x7f\\]/.test(name)) { this.fail('UNEXPECTED_FILE', child, 'A definition cannot hold a hidden name, or a name with a control character or a backslash.'); continue; }
      if (kind === 'file' || kind === 'dir') out.push({ name, kind });
      else if (kind === 'other') this.fail('UNEXPECTED_FILE', child, 'This must be a regular file or a folder.');
    }
    return out;
  }

  /** A `.DS_Store` file, or an empty `.gitkeep` file: metadata, not content. */
  skipped(rel: string, name: string): boolean {
    if (name === '.DS_Store') return true;
    if (name !== '.gitkeep') return false;
    try { return fs.lstatSync(path.join(this.root, rel)).size === 0; } catch { return false; }
  }

  /** Reads every file below a folder. Returns paths relative to that folder. */
  tree(rel: string, prefix = '', depth = 1): string[] {
    const out: string[] = [];
    for (const { name, kind } of this.list(rel, depth)) {
      if (kind === 'dir') out.push(...this.tree(`${rel}/${name}`, `${prefix}${name}/`, depth + 1));
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
      NOT_JSON_VALUE: 'holds a value that is not a JSON value',
    };
    this.fail(parsed.code, rel, `This file ${why[parsed.code] ?? 'is not strict JSON'}.`);
    return undefined;
  }

  merge(c: Checker): void { for (const p of c.problems) this.fail(p.code, p.path, p.message); }
}

/** True when a folder holds `harness.json`, so it is a 0.8 definition (lead ruling R3). */
export function isDefinitionFolder(folder: string): boolean {
  try { return fs.lstatSync(path.join(path.resolve(folder), 'harness.json')).isFile(); } catch { return false; }
}

/** Loads the definition in a `.bowerloom` folder. Returns every problem found, up to the cap, or the definition. */
export function loadDefinition(folder: string): LoadResult {
  const root = path.resolve(folder);
  const r = new Reader(root);
  let st: fs.Stats;
  try { st = fs.lstatSync(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail([{ code: 'FOLDER_MISSING', path: '.', message: 'The definition folder does not exist.' }]);
    r.unreadable('.', error);
    return fail(r.problems);
  }
  if (!st.isDirectory()) return fail([{ code: 'FOLDER_MISSING', path: '.', message: 'The definition folder must be a folder, not a file or a link.' }]);
  if (r.kind('harness.json') === null) return fail([{ code: 'HARNESS_MISSING', path: 'harness.json', message: 'A definition folder needs a harness.json file.' }]);

  const present = topLevel(r);

  const harnessBytes = present.has('harness.json') ? r.read('harness.json') : undefined;
  const harnessValue = harnessBytes && r.json('harness.json', harnessBytes);
  const hc = new Checker('harness.json');
  const harness = harnessValue === undefined ? undefined : checkHarness(hc, harnessValue);
  r.merge(hc);

  // Read every present part, whether or not it is listed, so each fault is reported in one pass.
  const instructions = present.has('instructions') ? readInstructions(r) : undefined;
  const rawSkills = present.has('skills') ? readSkills(r) : [];
  const subagents = present.has('agents') ? readSubagents(r) : [];
  const scripts = present.has('scripts') ? r.tree('scripts') : [];
  const enginePrivate = present.has('engines') ? readEngines(r) : {};
  const guardrails = readJsonPart(r, present, 'guardrails.json', checkGuardrails) ?? { rules: [], sandbox: [] };
  const hooks = readJsonPart(r, present, 'hooks.json', checkHooks) ?? [];
  const mcp = readJsonPart(r, present, 'mcp.json', checkMcp) ?? [];
  const { sources, adopted } = readJsonPart(r, present, 'sources.json', checkSources) ?? { sources: [], adopted: [] };

  const skills = harness ? applySkillSettings(r, harness, rawSkills) : rawSkills;
  const entries: PartEntries = { skills, subagents, rules: guardrails.rules, sandbox: guardrails.sandbox, hooks, mcp };
  if (harness) {
    checkPointers(r, harness, present, instructions, entries);
    checkEnginesListed(r, harness, entries, enginePrivate);
  }
  checkSourceItems(r, sources, adopted, entries);

  const files: DefinitionFile[] = [...r.files.entries()].sort(([a], [b]) => byBytes(a, b)).map(([p, f]) => ({ path: p, bytes: f.bytes, executable: f.executable }));
  const incomplete = new Set<string>(INCOMPLETE_RULES);
  for (const f of scanSecrets(files)) {
    if (f.rule === 'unparseable-json' && Object.hasOwn(TOP, f.path)) continue; // already a JSON problem of its own
    const at = f.line !== undefined ? `Line ${f.line}` : f.pointer !== undefined ? `The value at ${f.pointer || '/'}` : 'The file';
    if (incomplete.has(f.rule)) r.fail('SECRET_SCAN_INCOMPLETE', f.path, `${at} could not be scanned for secrets (${f.rule}), so the definition is refused.`);
    else r.fail('SECRET_VALUE', f.path, `${at} looks like a secret value (${f.rule}). Store a reference instead: \${NAME} for a variable, or { "keychain": "<entry>" }.`);
  }

  if (r.problems.length || !harness) return fail(r.problems);
  const scriptEntries = scripts.map(p => {
    const f = r.files.get(`scripts/${p}`)!;
    return { id: p, contentHash: fileContentHash({ path: `scripts/${p}`, bytes: f.bytes }), executable: f.executable };
  });
  const definition: Definition = {
    folder: root, harness, ...(instructions !== undefined ? { instructions } : {}), entries, sources, adopted, scripts, scriptEntries,
    enginePrivate, files, revision: computeRevision(files),
  };
  return { ok: true, definition };
}

function fail(problems: readonly Problem[]): LoadResult { return { ok: false, problems }; }

/** Checks every top-level name. Returns the section 8 names present with the right kind. */
function topLevel(r: Reader): Set<string> {
  const present = new Set<string>();
  let names: string[];
  try { names = fs.readdirSync(r.root).sort(byBytes); } catch (error) { r.unreadable('.', error); return present; }
  for (const name of names) {
    const kind = r.kind(name);
    if (kind === 'link') { r.fail('SYMLINK', name, 'A definition folder cannot hold a symbolic link.'); continue; }
    const shape = TOP[name];
    if (shape) {
      if (kind !== 'file' && kind !== 'dir') { if (kind !== 'other' || !r.problems.some(p => p.path === name)) r.fail('UNEXPECTED_FILE', name, 'This must be a regular file or a folder.'); continue; }
      if ((kind === 'dir') !== shape.dir) { r.fail('UNEXPECTED_FILE', name, shape.dir ? 'This must be a folder.' : 'This must be a file.'); continue; }
      present.add(name);
      continue;
    }
    if (LEGACY.has(name)) continue;
    if (kind === 'file' && (name === '.DS_Store' || name === '.gitkeep')) continue;
    r.fail('UNEXPECTED_FILE', name, `${safeName(name)} is neither a section 8 name nor a known 0.7 name, so the folder is refused rather than read in part.`);
  }
  return present;
}

function readInstructions(r: Reader): string | undefined {
  let found: string | undefined;
  for (const { name, kind } of r.list('instructions', 1)) {
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
  for (const { name, kind } of r.list('skills', 1)) {
    const rel = `skills/${name}`;
    if (kind !== 'dir') { r.fail('UNEXPECTED_FILE', rel, 'The skills folder holds only skill folders, each with a SKILL.md.'); continue; }
    if (!isId(name)) { r.fail('INVALID_ID', rel, 'A skill folder name must be lowercase letters, digits, and single hyphens, up to 64 characters.'); continue; }
    const before = r.problems.length;
    const files = r.tree(rel, '', 2).sort(byBytes);
    const skillPath = `${rel}/SKILL.md`;
    const skillFile = r.files.get(skillPath);
    if (!skillFile) {
      if (!r.problems.slice(before).some(p => p.path === skillPath)) r.fail('SKILL_MISSING', rel, 'A skill folder needs a SKILL.md file.');
      continue;
    }
    const t = r.text(skillPath, skillFile.bytes);
    if (t === undefined) continue;
    const fm = readFrontmatter(t);
    if (!fm.ok) { r.fail(fm.code, skillPath, fm.message); continue; }
    const c = new Checker(skillPath);
    const content = skillContentHash(name, files.map(f => ({ path: `${rel}/${f}`, bytes: r.files.get(`${rel}/${f}`)!.bytes })));
    const executable = files.filter(f => r.files.get(`${rel}/${f}`)!.executable);
    const entry = checkSkill(c, name, { ...fm.data }, fm.body, files, content, executable);
    r.merge(c);
    if (entry) out.push(entry);
  }
  return out;
}

/** Joins each skill with its settings in harness.json. A setting for a skill this layer does not hold is refused. */
function applySkillSettings(r: Reader, harness: HarnessFile, skills: readonly SkillEntry[]): SkillEntry[] {
  for (const id of Object.keys(harness.skills)) {
    if (!skills.some(s => s.id === id)) r.fail('SKILL_SETTINGS_UNKNOWN', 'harness.json', `skills.${id} names a skill that this layer does not hold.`);
  }
  return skills.map(s => {
    const settings = harness.skills[s.id];
    return settings ? { ...s, ...(settings.engines ? { engines: settings.engines } : {}), privateBlocks: settings.privateBlocks } : s;
  });
}

function readSubagents(r: Reader): SubagentEntry[] {
  const out: SubagentEntry[] = [];
  for (const { name, kind } of r.list('agents', 1)) {
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
  for (const { name, kind } of r.list('engines', 1)) {
    const rel = `engines/${name}`;
    if (kind !== 'dir') { r.fail('UNEXPECTED_FILE', rel, 'The engines folder holds only one folder per engine.'); continue; }
    if (!isEngineId(name)) { r.fail('UNKNOWN_ENGINE', rel, `${safeName(name)} is not an engine. The engines are ${ENGINE_IDS.join(', ')}.`); continue; }
    out[name] = r.tree(rel, '', 2).sort(byBytes);
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

/** The Markdown headings outside fenced code blocks. */
function headings(markdown: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (fence === null) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; continue; }
    if (fence !== null) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push(m[1]!);
  }
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
  const titles = instructions === undefined ? [] : headings(instructions);
  (harness.parts['tool-guidance'] ?? []).forEach((pointer, i) => {
    const heading = /^instructions\/AGENTS\.md#(.+)$/.exec(pointer);
    const skill = /^skills\/([^/]+)$/.exec(pointer);
    const found = heading ? titles.includes(heading[1]!) : skill ? entries.skills.some(s => s.id === skill[1]) : false;
    if (!found) r.fail('PART_POINTER', 'harness.json', `parts.tool-guidance[${i}] is not a heading of instructions/AGENTS.md outside code (instructions/AGENTS.md#<heading>) or a skill of this layer (skills/<id>).`);
  });
}

/** An engine the harness does not list cannot be targeted by a filter, a private block, a model, or a folder (R4). */
function checkEnginesListed(r: Reader, harness: HarnessFile, entries: PartEntries, enginePrivate: Partial<Record<EngineId, string[]>>): void {
  const listed = new Set(harness.engines.map(e => e.id));
  const named: [string, string, Iterable<string>][] = [];
  const files: Record<string, string> = { skills: 'harness.json', rules: 'guardrails.json', sandbox: 'guardrails.json', hooks: 'hooks.json', mcp: 'mcp.json' };
  for (const [part, list] of Object.entries(entries) as [keyof PartEntries, readonly { id: string; engines?: readonly EngineId[]; privateBlocks: Record<string, unknown> }[]][]) {
    for (const e of list) {
      const file = part === 'subagents' ? `agents/${e.id}.md` : files[part]!;
      named.push([file, `${part} ${e.id}`, [...(e.engines ?? []), ...Object.keys(e.privateBlocks)]]);
      if (part === 'subagents') named.push([file, `subagents ${e.id} model`, Object.keys((e as SubagentEntry).model ?? {})]);
    }
  }
  for (const [file, what, engines] of named) {
    for (const engine of engines) if (!listed.has(engine as EngineId)) r.fail('ENGINE_NOT_LISTED', file, `${what} targets the engine ${engine}, which harness.json does not list.`);
  }
  for (const engine of Object.keys(enginePrivate)) {
    if (!listed.has(engine as EngineId)) r.fail('ENGINE_NOT_LISTED', `engines/${engine}`, `harness.json does not list the engine ${engine}.`);
  }
}

function checkSourceItems(r: Reader, sources: readonly SourceRecord[], adopted: readonly AdoptedRecord[], entries: PartEntries): void {
  const ids: Record<string, readonly { id: string }[]> = {
    skills: entries.skills, subagents: entries.subagents, guardrails: [...entries.rules, ...entries.sandbox], hooks: entries.hooks, mcp: entries.mcp,
  };
  sources.forEach((s, i) => s.items.forEach((item, j) => {
    if (!ids[item.part]!.some(e => e.id === item.id)) r.fail('SOURCE_ITEM_MISSING', 'sources.json', `sources[${i}].items[${j}] names an item of ${item.part} that this layer does not hold.`);
  }));
  adopted.forEach((a, i) => {
    if (!entries.skills.some(e => e.id === a.id)) r.fail('SOURCE_ITEM_MISSING', 'sources.json', `adopted[${i}] names a skill that this layer does not hold.`);
  });
}
