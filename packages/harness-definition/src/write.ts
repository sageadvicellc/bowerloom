/**
 * Edits one loaded definition and gives the full target file set (save step, lane B). The function is pure: it reads the
 * definition it is given, touches no disk, and changes neither the definition nor the edits.
 *
 * The edits are a closed set (`DefinitionEdit`), applied in order to a working copy of the files. A file that no edit
 * names stays byte-identical, with its execute bit: x-blocks, hooks, MCP servers, guardrails, `sources.json`, scripts, and
 * `engines/` pass through unread. A file that an edit names is written whole:
 * - `harness.json` as `JSON.stringify(value, null, 2)` and a newline, from the parsed file, so key order and every field
 *   an edit does not name stay as they were.
 * - An agent file with its YAML frontmatter edited in place, so comments and key order stay, and the same body.
 * - A skill or the instructions as the text given.
 *
 * The result is checked with the package loader, run over the files in memory (`loadDefinitionFiles`), so it is exactly
 * what `loadDefinition` accepts. A fault comes back as a typed refusal, never a throw, and never repeats a value.
 */
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { canonicalJson } from '../../contracts/src/index.js';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { decodeText, isRecord, parseStrictJson, readFrontmatter, toLf } from './json.js';
import { loadDefinitionFiles } from './load.js';
import { safeName } from './secrets.js';
import type { Definition, DefinitionFile, EngineTarget, JsonValue, Problem } from './types.js';
import { DEFINITION_LIMITS, isId } from './words.js';

/** The kinds of edit, one set for every caller. */
export const EDIT_KINDS = Object.freeze(['set-skill', 'add-skill', 'remove-skill', 'set-agent', 'set-instructions', 'set-engines'] as const);

/**
 * One edit of one folder's definition.
 * - `set-skill`: replaces the full text of `skills/<id>/SKILL.md`. The other files of the skill stay.
 * - `add-skill`: creates `skills/<id>/SKILL.md` and lists the skills part in `harness.json` when it was not listed.
 * - `remove-skill`: deletes every file of the skill, its settings in `harness.json`, and its link in each agent. A
 *   reference the definition keeps elsewhere, such as tool guidance or `sources.json`, makes the result invalid.
 * - `set-agent`: sets the linked `skills` and the `tools` of `agents/<id>.md`. A field left out stays; `null` removes it.
 *   A skill newly linked must be a skill of this folder.
 * - `set-instructions`: replaces the full text of `instructions/AGENTS.md`, creating it when the definition had none.
 * - `set-engines`: replaces the engine list of `harness.json`.
 */
export type DefinitionEdit =
  | { readonly kind: 'set-skill'; readonly id: string; readonly text: string }
  | { readonly kind: 'add-skill'; readonly id: string; readonly text: string }
  | { readonly kind: 'remove-skill'; readonly id: string }
  | { readonly kind: 'set-agent'; readonly id: string; readonly skills?: readonly string[] | null; readonly tools?: readonly string[] | null }
  | { readonly kind: 'set-instructions'; readonly text: string }
  | { readonly kind: 'set-engines'; readonly engines: readonly EngineTarget[] };

/** What a result does to one path, compared with the definition given. */
export interface EditChange {
  readonly path: string;
  readonly kind: 'create' | 'update' | 'delete';
}

/**
 * Why an edit was refused.
 * - `EDIT_BAD_EDIT`: the edit is not one of the shapes above.
 * - `EDIT_UNSAFE_ID`: an id is not lowercase letters, digits, and single hyphens up to 64 characters, so it cannot name a
 *   skill or an agent, and never a path.
 * - `EDIT_UNKNOWN_ID`: the skill or agent does not exist in the folder.
 * - `EDIT_DUPLICATE_ID`: `add-skill` names a skill that exists.
 * - `EDIT_TOO_LARGE`: a text, the list of edits, or the result is over `DEFINITION_LIMITS`, a line of 4096 characters among them.
 * - `EDIT_SECRET_FOUND`: the result holds a secret value.
 * - `EDIT_INVALID`: the loader refuses the result; `problems` lists why.
 */
export type EditRefusalCode =
  | 'EDIT_BAD_EDIT' | 'EDIT_UNSAFE_ID' | 'EDIT_UNKNOWN_ID' | 'EDIT_DUPLICATE_ID' | 'EDIT_TOO_LARGE' | 'EDIT_SECRET_FOUND' | 'EDIT_INVALID';

export type EditResult =
  | {
    readonly ok: true;
    /** The full target file set, in byte order of path. It loads with `loadDefinition` once written. */
    readonly files: readonly DefinitionFile[];
    /** The paths that differ from the definition given, in byte order. Empty when the edits change nothing. */
    readonly changes: readonly EditChange[];
    /** The revision of the definition given. */
    readonly base: string;
    /** The revision of the target file set. */
    readonly revision: string;
  }
  | {
    readonly ok: false;
    readonly code: EditRefusalCode;
    readonly message: string;
    /** The index of the edit at fault, when one edit is. */
    readonly edit?: number;
    /** The loader problems, for `EDIT_INVALID`, `EDIT_SECRET_FOUND`, and a limit the loader found. */
    readonly problems?: readonly Problem[];
  };

class Refusal extends Error {
  constructor(readonly code: EditRefusalCode, message: string, readonly edit?: number, readonly problems?: readonly Problem[]) { super(message); }
}

type Obj = Record<string, JsonValue>;
type Work = Map<string, { bytes: Buffer; executable: boolean }>;
const HARNESS = 'harness.json';
const INSTRUCTIONS = 'instructions/AGENTS.md';
const SKILLS_DIR = 'skills/';
const AGENT_FILE = /^agents\/([^/]+)\.md$/;
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Applies the edits, in order, to the definition. Returns the target file set and the change list, or a refusal. It never
 * throws. Several edits cost one load of the result, so a state between two edits may be invalid if the end is not.
 */
export function editDefinition(def: Definition, edits: readonly DefinitionEdit[]): EditResult {
  try {
    return apply(def, edits);
  } catch (error) {
    if (error instanceof Refusal) {
      return { ok: false, code: error.code, message: error.message, ...(error.edit !== undefined ? { edit: error.edit } : {}), ...(error.problems ? { problems: error.problems } : {}) };
    }
    return { ok: false, code: 'EDIT_INVALID', message: 'The edits could not be applied.' };
  }
}

function apply(def: Definition, edits: readonly DefinitionEdit[]): EditResult {
  if (!Array.isArray(edits)) throw new Refusal('EDIT_BAD_EDIT', 'The edits must be a list.');
  if (edits.length > DEFINITION_LIMITS.entries) throw new Refusal('EDIT_TOO_LARGE', `A save holds at most ${DEFINITION_LIMITS.entries} edits.`);

  const work: Work = new Map(def.files.map(f => [f.path, { bytes: Buffer.from(f.bytes), executable: f.executable === true }]));
  const harness = new HarnessDraft(work);
  edits.forEach((edit, i) => {
    try { applyOne(work, harness, snapshot(edit)); } catch (error) {
      if (error instanceof Refusal && error.edit === undefined) throw new Refusal(error.code, error.message, i, error.problems);
      throw error;
    }
  });
  harness.flush();

  const files: DefinitionFile[] = [...work.entries()].sort(([a], [b]) => byBytes(a, b)).map(([path, f]) => ({ path, bytes: f.bytes, executable: f.executable }));
  const loaded = loadDefinitionFiles(files, def.folder);
  if (!loaded.ok) throw refusalOf(loaded.problems);
  const target = loaded.definition;

  const before = new Map(def.files.map(f => [f.path, f.bytes]));
  const after = new Map(target.files.map(f => [f.path, f.bytes]));
  const changes: EditChange[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort(byBytes)) {
    const was = before.get(path), now = after.get(path);
    if (was === undefined) changes.push({ path, kind: 'create' });
    else if (now === undefined) changes.push({ path, kind: 'delete' });
    else if (!Buffer.from(was).equals(Buffer.from(now))) changes.push({ path, kind: 'update' });
  }
  return { ok: true, files: target.files, changes, base: def.revision, revision: target.revision };
}

/**
 * The loader's problems as one refusal: a secret first, then a limit, then any other fault. A line or token too long to
 * scan for secrets is a limit (`DEFINITION_LIMITS.lineChars`), so it counts as one.
 */
function refusalOf(problems: readonly Problem[]): Refusal {
  const has = (...codes: string[]) => problems.some(p => codes.includes(p.code));
  if (has('SECRET_VALUE')) return new Refusal('EDIT_SECRET_FOUND', 'The result holds a secret value. Store a reference instead.', undefined, problems);
  if (has('TOO_LARGE', 'TOO_DEEP', 'SECRET_SCAN_INCOMPLETE')) return new Refusal('EDIT_TOO_LARGE', 'The result is over a limit of a definition.', undefined, problems);
  return new Refusal('EDIT_INVALID', 'The result is not a valid definition.', undefined, problems);
}

// ---- the shape of an edit -------------------------------------------------------------------------------------------

const SHAPES: Readonly<Record<(typeof EDIT_KINDS)[number], { required: readonly string[]; optional: readonly string[] }>> = {
  'set-skill': { required: ['id', 'text'], optional: [] },
  'add-skill': { required: ['id', 'text'], optional: [] },
  'remove-skill': { required: ['id'], optional: [] },
  'set-agent': { required: ['id'], optional: ['skills', 'tools'] },
  'set-instructions': { required: ['text'], optional: [] },
  'set-engines': { required: ['engines'], optional: [] },
};

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** A plain copy of an edit with its own keys only, checked against the closed shape of its kind. */
function snapshot(edit: unknown): Record<string, unknown> & { kind: (typeof EDIT_KINDS)[number] } {
  const bad = (why: string) => new Refusal('EDIT_BAD_EDIT', why);
  let copy: Record<string, unknown>;
  try {
    if (!isPlain(edit)) throw bad('An edit must be an object.');
    copy = Object.fromEntries(Object.keys(edit).map(k => [k, edit[k]]));
  } catch (error) {
    throw error instanceof Refusal ? error : bad('An edit could not be read.');
  }
  const kind = copy.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(SHAPES, kind)) throw bad(`An edit needs a kind: ${EDIT_KINDS.join(', ')}.`);
  const shape = SHAPES[kind as keyof typeof SHAPES];
  for (const key of Object.keys(copy)) if (key !== 'kind' && !shape.required.includes(key) && !shape.optional.includes(key)) throw bad(`A ${kind} edit has a field it does not take.`);
  for (const key of shape.required) if (copy[key] === undefined) throw bad(`A ${kind} edit needs the field ${key}.`);
  return copy as Record<string, unknown> & { kind: (typeof EDIT_KINDS)[number] };
}

function textOf(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Refusal('EDIT_BAD_EDIT', `The ${what} text must be a string.`);
  if (LONE_SURROGATE.test(value)) throw new Refusal('EDIT_BAD_EDIT', `The ${what} text holds a character that is not valid Unicode.`);
  if (Buffer.byteLength(value, 'utf8') > DEFINITION_LIMITS.fileBytes) throw new Refusal('EDIT_TOO_LARGE', `A definition file holds at most 1 MiB; the ${what} text is longer.`);
  return value;
}

function idOf(value: unknown, what: string): string {
  if (!isId(value)) throw new Refusal('EDIT_UNSAFE_ID', `The ${what} id must be lowercase letters, digits, and single hyphens, up to 64 characters.`);
  return value;
}

function listOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Refusal('EDIT_BAD_EDIT', `The ${what} must be a list, or null to remove it.`);
  if (value.length > DEFINITION_LIMITS.entries) throw new Refusal('EDIT_TOO_LARGE', `The ${what} holds at most ${DEFINITION_LIMITS.entries} items.`);
  return [...value];
}

function engineList(value: unknown): Obj[] {
  const items = listOf(value, 'engine list');
  return items.map(item => {
    if (!isPlain(item) || typeof item.id !== 'string') throw new Refusal('EDIT_BAD_EDIT', 'Each engine needs an id.');
    for (const key of Object.keys(item)) if (key !== 'id' && key !== 'version' && key !== 'model') throw new Refusal('EDIT_BAD_EDIT', 'An engine has an id, and optionally a version and a model.');
    const out: Obj = { id: item.id };
    for (const key of ['version', 'model'] as const) {
      const v = item[key];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw new Refusal('EDIT_BAD_EDIT', `The engine ${key} must be a string.`);
      out[key] = v;
    }
    return out;
  });
}

// ---- the edits ------------------------------------------------------------------------------------------------------

function applyOne(work: Work, harness: HarnessDraft, edit: Record<string, unknown> & { kind: (typeof EDIT_KINDS)[number] }): void {
  switch (edit.kind) {
    case 'set-skill': {
      const id = idOf(edit.id, 'skill'), body = textOf(edit.text, 'skill');
      const at = `${SKILLS_DIR}${id}/SKILL.md`;
      const was = work.get(at);
      if (!was) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no skill ${safeName(id)}.`);
      work.set(at, { bytes: Buffer.from(body, 'utf8'), executable: was.executable });
      return;
    }
    case 'add-skill': {
      const id = idOf(edit.id, 'skill'), body = textOf(edit.text, 'skill');
      if (skillFiles(work, id).length) throw new Refusal('EDIT_DUPLICATE_ID', `The folder already holds a skill ${safeName(id)}.`);
      work.set(`${SKILLS_DIR}${id}/SKILL.md`, { bytes: Buffer.from(body, 'utf8'), executable: false });
      harness.part('skills', SKILLS_DIR);
      return;
    }
    case 'remove-skill': {
      const id = idOf(edit.id, 'skill');
      const gone = skillFiles(work, id);
      if (!gone.length) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no skill ${safeName(id)}.`);
      for (const path of gone) work.delete(path);
      harness.dropSkillSettings(id);
      if (![...work.keys()].some(p => p.startsWith(SKILLS_DIR))) harness.part('skills', null);
      for (const path of [...work.keys()]) if (AGENT_FILE.test(path)) rewriteAgent(work, path, data => unlink(data, id));
      return;
    }
    case 'set-agent': {
      const id = idOf(edit.id, 'agent');
      const at = `agents/${id}.md`;
      if (!work.has(at)) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no agent ${safeName(id)}.`);
      const skills = edit.skills === undefined || edit.skills === null ? edit.skills : listOf(edit.skills, 'skills list').map(s => idOf(s, 'skill'));
      const tools = edit.tools === undefined || edit.tools === null ? edit.tools : listOf(edit.tools, 'tools list').map(t => {
        if (typeof t !== 'string') throw new Refusal('EDIT_BAD_EDIT', 'Each tool must be a string.');
        return t;
      });
      if (skills === undefined && tools === undefined) throw new Refusal('EDIT_BAD_EDIT', 'A set-agent edit needs skills, tools, or both.');
      rewriteAgent(work, at, data => {
        const had = Array.isArray(data.skills) ? data.skills : [];
        for (const s of skills ?? []) if (!had.includes(s) && !skillFiles(work, s).length) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no skill ${safeName(s)} to link.`);
        const skillsChanged = setField(data, 'skills', skills), toolsChanged = setField(data, 'tools', tools);
        return skillsChanged + toolsChanged > 0;
      });
      return;
    }
    case 'set-instructions': {
      const body = textOf(edit.text, 'instructions');
      work.set(INSTRUCTIONS, { bytes: Buffer.from(body, 'utf8'), executable: work.get(INSTRUCTIONS)?.executable ?? false });
      harness.part('system-prompt', INSTRUCTIONS);
      return;
    }
    case 'set-engines':
      harness.setEngines(engineList(edit.engines));
      return;
  }
}

/** The paths of one skill folder, in the working copy. */
function skillFiles(work: Work, id: string): string[] {
  const prefix = `${SKILLS_DIR}${id}/`;
  return [...work.keys()].filter(p => p.startsWith(prefix));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sets a field of agent frontmatter: undefined leaves it, null removes it. Returns 1 when the data changed. */
function setField(data: Obj, key: 'skills' | 'tools', value: readonly string[] | null | undefined): 0 | 1 {
  if (value === undefined) return 0;
  if (value === null) { if (!Object.hasOwn(data, key)) return 0; delete data[key]; return 1; }
  if (Object.hasOwn(data, key) && same(data[key], value)) return 0;
  data[key] = [...value];
  return 1;
}

/** Takes a skill out of the linked skills of an agent. Returns true when the data changed. */
function unlink(data: Obj, id: string): boolean {
  if (!Array.isArray(data.skills) || !data.skills.includes(id)) return false;
  data.skills = data.skills.filter(s => s !== id);
  return true;
}

/**
 * Rewrites one agent file when `change` says the frontmatter changed. The YAML document is edited in place: every comment,
 * every key in its order, and every field `change` does not touch stay as they were. A list that changes keeps the node of
 * each item it still holds, with that item's comment. The body is the same. An agent the loader would refuse is left
 * alone; the load of the result reports it.
 */
function rewriteAgent(work: Work, path: string, change: (data: Obj) => boolean): void {
  const file = work.get(path)!;
  const source = decodeText(file.bytes);
  const fm = source === null ? null : readFrontmatter(source);
  if (!fm?.ok) return;
  const data: Obj = { ...fm.data };
  if (!change(data)) return;
  const split = splitFrontmatter(toLf(source!));
  const doc = split === null ? null : parseDocument(split.block, { uniqueKeys: true });
  if (doc === null || doc.errors.length || !isMap(doc.contents)) return;
  for (const key of AGENT_LIST_FIELDS) {
    const before = fm.data[key], after = data[key];
    if (same(before, after)) continue;
    if (after === undefined) { doc.delete(key); continue; }
    const node = doc.get(key, true);
    if (isSeq(node) && Array.isArray(after)) {
      const pool = [...node.items];
      node.items = after.map(value => {
        const at = pool.findIndex(item => isScalar(item) && item.value === value);
        return at < 0 ? doc.createNode(value) : pool.splice(at, 1)[0]!;
      });
    } else doc.set(key, doc.createNode(after));
  }
  const yaml = doc.toString({ lineWidth: 0 });
  work.set(path, { bytes: Buffer.from(`---\n${yaml}---\n${fm.body}`, 'utf8'), executable: file.executable });
}
/** The agent fields an edit sets. */
const AGENT_LIST_FIELDS = ['skills', 'tools'] as const;

/**
 * `harness.json` as a parsed value that edits change. `flush` writes it back only when its meaning changed, so an edit
 * that nets out keeps the original bytes.
 */
class HarnessDraft {
  private readonly original: JsonValue;
  private readonly value: Obj;
  constructor(private readonly work: Work) {
    const text = decodeText(work.get(HARNESS)?.bytes ?? Buffer.alloc(0));
    const parsed = text === null ? null : parseStrictJson(text);
    if (!parsed?.ok || !isRecord(parsed.value)) throw new Refusal('EDIT_INVALID', 'harness.json is not valid.');
    this.value = parsed.value;
    this.original = JSON.parse(JSON.stringify(parsed.value)) as JsonValue;
  }

  /** Lists a part pointer when it is absent (`location`), or drops it (`null`). */
  part(key: string, location: string | null): void {
    const parts = (isRecord(this.value.parts) ? this.value.parts : (this.value.parts = {})) as Obj;
    if (location === null) delete parts[key];
    else if (parts[key] === undefined) parts[key] = location;
  }

  dropSkillSettings(id: string): void {
    const settings = this.value.skills as Obj | undefined;
    if (!isRecord(settings) || !Object.hasOwn(settings, id)) return;
    delete settings[id];
    if (Object.keys(settings).length === 0) delete this.value.skills;
  }

  setEngines(engines: readonly Obj[]): void { this.value.engines = [...engines]; }

  flush(): void {
    if (canonicalJson(this.value) === canonicalJson(this.original)) return;
    const was = this.work.get(HARNESS)!;
    this.work.set(HARNESS, { bytes: Buffer.from(JSON.stringify(this.value, null, 2) + '\n', 'utf8'), executable: was.executable });
  }
}
