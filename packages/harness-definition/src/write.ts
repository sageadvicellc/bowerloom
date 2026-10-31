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
 * - `knowledge.json` as `JSON.stringify(value, null, 2)` and a newline, as `harness.json` is. The last source removed
 *   deletes the file.
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
import { isKnowledgeKind, isKnowledgePath } from './knowledge.js';
import type { Definition, DefinitionFile, EngineTarget, JsonValue, KnowledgeSource, Problem, SourceRecord } from './types.js';
import { DEFINITION_LIMITS, KNOWLEDGE_FILE, KNOWLEDGE_KINDS, OVERRIDABLE_PARTS, isId } from './words.js';

/** The kinds of edit, one set for every caller. */
export const EDIT_KINDS = Object.freeze([
  'set-skill', 'add-skill', 'remove-skill', 'set-agent', 'set-instructions', 'set-engines', 'set-source', 'remove-source', 'add-agent', 'set-borrowed', 'remove-borrowed',
] as const);

/**
 * One edit of one folder's definition.
 * - `set-skill`: replaces the full text of `skills/<id>/SKILL.md`. The other files of the skill stay.
 * - `add-skill`: creates `skills/<id>/SKILL.md` and lists the skills part in `harness.json` when it was not listed.
 * - `remove-skill`: deletes every file of the skill, its settings in `harness.json`, and its link in each agent. A
 *   reference the definition keeps elsewhere, such as tool guidance or `sources.json`, makes the result invalid.
 * - `set-agent`: sets the linked `skills`, the `tools`, and the `notes` of `agents/<id>.md`. A field left out stays;
 *   `null` removes it. A skill newly linked must be a skill of this folder, and a source newly listed in `notes` must be
 *   a source of this folder's `knowledge.json`.
 * - `set-instructions`: replaces the full text of `instructions/AGENTS.md`, creating it when the definition had none.
 * - `set-engines`: replaces the engine list of `harness.json`.
 * - `set-source`: adds a knowledge source to `knowledge.json`, creating the file, or replaces the source of the same name
 *   in place. The path must already be in stored form (`storedKnowledgePath` gives it): relative inside the harness
 *   folder, or `~/<path>`.
 * - `remove-source`: removes a source from `knowledge.json`, and its name from the `notes` of each agent, as
 *   `remove-skill` does for skills. A `notes` list left empty is removed. The last source removed deletes the file.
 * - `add-agent`: creates `agents/<id>.md` with the text given, and lists the subagents part in `harness.json` when it was
 *   not listed. A ready-made kit brings its agent this way.
 * - `set-borrowed`: records borrowed items in `sources.json` (harness definition spec, section 7): a name, a marketplace, a
 *   pinned version, and the items. It adds the record, creating the file and listing the plugins part, or replaces the
 *   record of the same name in place. Every other record and the `adopted` list stay.
 * - `remove-borrowed`: removes the record of that name. When no record and no adopted skill is left, the file goes, and so
 *   does its pointer in `harness.json`.
 */
export type DefinitionEdit =
  | { readonly kind: 'set-skill'; readonly id: string; readonly text: string }
  | { readonly kind: 'add-skill'; readonly id: string; readonly text: string }
  | { readonly kind: 'remove-skill'; readonly id: string }
  | {
    readonly kind: 'set-agent'; readonly id: string; readonly skills?: readonly string[] | null; readonly tools?: readonly string[] | null;
    readonly notes?: readonly string[] | null;
  }
  | { readonly kind: 'set-instructions'; readonly text: string }
  | { readonly kind: 'set-engines'; readonly engines: readonly EngineTarget[] }
  | { readonly kind: 'set-source'; readonly source: KnowledgeSource }
  | { readonly kind: 'remove-source'; readonly name: string }
  | { readonly kind: 'add-agent'; readonly id: string; readonly text: string }
  | { readonly kind: 'set-borrowed'; readonly source: SourceRecord }
  | { readonly kind: 'remove-borrowed'; readonly name: string };

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
 * - `EDIT_UNKNOWN_ID`: the skill, agent, or knowledge source does not exist in the folder.
 * - `EDIT_DUPLICATE_ID`: `add-skill` names a skill that exists.
 * - `EDIT_UNSAFE_PATH`: a knowledge source path is not in stored form: it is absolute, holds `..`, or is otherwise not
 *   a relative path inside the harness folder or a `~/` path.
 * - `EDIT_TOO_LARGE`: a text, the list of edits, or the result is over `DEFINITION_LIMITS`, a line of 4096 characters among them.
 * - `EDIT_SECRET_FOUND`: the result holds a secret value.
 * - `EDIT_INVALID`: the loader refuses the result; `problems` lists why.
 */
export type EditRefusalCode =
  | 'EDIT_BAD_EDIT' | 'EDIT_UNSAFE_ID' | 'EDIT_UNKNOWN_ID' | 'EDIT_DUPLICATE_ID' | 'EDIT_UNSAFE_PATH' | 'EDIT_TOO_LARGE' | 'EDIT_SECRET_FOUND'
  | 'EDIT_INVALID';

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
  const knowledge = new KnowledgeDraft(work);
  const borrowed = new BorrowedDraft(work, harness);
  edits.forEach((edit, i) => {
    try { applyOne(work, harness, knowledge, borrowed, snapshot(edit)); } catch (error) {
      if (error instanceof Refusal && error.edit === undefined) throw new Refusal(error.code, error.message, i, error.problems);
      throw error;
    }
  });
  borrowed.flush();
  harness.flush();
  knowledge.flush();

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
  'set-agent': { required: ['id'], optional: ['skills', 'tools', 'notes'] },
  'set-instructions': { required: ['text'], optional: [] },
  'set-engines': { required: ['engines'], optional: [] },
  'set-source': { required: ['source'], optional: [] },
  'remove-source': { required: ['name'], optional: [] },
  'add-agent': { required: ['id', 'text'], optional: [] },
  'set-borrowed': { required: ['source'], optional: [] },
  'remove-borrowed': { required: ['name'], optional: [] },
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

/** A knowledge source of a `set-source` edit: exactly a kind, a name, and a stored path. The message never repeats a path. */
function sourceOf(value: unknown): KnowledgeSource {
  if (!isPlain(value)) throw new Refusal('EDIT_BAD_EDIT', 'A set-source edit needs a source: an object with a kind, a name, and a path.');
  const keys = Object.keys(value);
  if (keys.length !== 3 || !['kind', 'name', 'path'].every(k => keys.includes(k))) throw new Refusal('EDIT_BAD_EDIT', 'A source has exactly a kind, a name, and a path.');
  const { kind, name, path } = value;
  if (!isKnowledgeKind(kind)) throw new Refusal('EDIT_BAD_EDIT', `A source kind must be ${KNOWLEDGE_KINDS.join(', or ')}.`);
  const id = idOf(name, 'source');
  if (typeof path !== 'string') throw new Refusal('EDIT_BAD_EDIT', 'A source path must be text.');
  if (!isKnowledgePath(path)) throw new Refusal('EDIT_UNSAFE_PATH', 'A source path must be a folder inside the harness folder, relative to it, or a folder in ~/ form, with no "..".');
  return { kind, name: id, path };
}

// ---- the edits ------------------------------------------------------------------------------------------------------

function applyOne(work: Work, harness: HarnessDraft, knowledge: KnowledgeDraft, borrowed: BorrowedDraft, edit: Record<string, unknown> & { kind: (typeof EDIT_KINDS)[number] }): void {
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
      const notes = edit.notes === undefined || edit.notes === null ? edit.notes : listOf(edit.notes, 'notes list').map(n => idOf(n, 'source'));
      if (skills === undefined && tools === undefined && notes === undefined) throw new Refusal('EDIT_BAD_EDIT', 'A set-agent edit needs skills, tools, notes, or more than one.');
      rewriteAgent(work, at, data => {
        const had = Array.isArray(data.skills) ? data.skills : [];
        for (const s of skills ?? []) if (!had.includes(s) && !skillFiles(work, s).length) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no skill ${safeName(s)} to link.`);
        for (const n of notes ?? []) if (!knowledge.has(n)) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no knowledge source ${safeName(n)} to list in notes.`);
        const skillsChanged = setField(data, 'skills', skills), toolsChanged = setField(data, 'tools', tools), notesChanged = setField(data, 'notes', notes);
        return skillsChanged + toolsChanged + notesChanged > 0;
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
    case 'set-source':
      knowledge.set(sourceOf(edit.source));
      return;
    case 'remove-source': {
      const name = idOf(edit.name, 'source');
      if (!knowledge.has(name)) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no knowledge source ${safeName(name)}.`);
      knowledge.remove(name);
      for (const path of [...work.keys()]) if (AGENT_FILE.test(path)) rewriteAgent(work, path, data => unlinkNotes(data, name));
      return;
    }
    case 'add-agent': {
      const id = idOf(edit.id, 'agent'), body = textOf(edit.text, 'agent');
      const at = `agents/${id}.md`;
      if (work.has(at)) throw new Refusal('EDIT_DUPLICATE_ID', `The folder already holds an agent ${safeName(id)}.`);
      work.set(at, { bytes: Buffer.from(body, 'utf8'), executable: false });
      harness.part('subagents', 'agents/');
      return;
    }
    case 'set-borrowed':
      borrowed.set(borrowedOf(edit.source));
      return;
    case 'remove-borrowed': {
      const name = edit.name;
      if (typeof name !== 'string' || name === '' || name.length > 256) throw new Refusal('EDIT_BAD_EDIT', 'A remove-borrowed edit needs the name of a record.');
      if (!borrowed.has(name)) throw new Refusal('EDIT_UNKNOWN_ID', `The folder holds no borrowed record ${safeName(name)}.`);
      borrowed.remove(name);
      return;
    }
  }
}

/**
 * A record of a `set-borrowed` edit: exactly a name, a marketplace, a version, and one or more items, each exactly a part
 * that can be borrowed and an id. The loader checks the rest of the result: a pinned version, and that each item exists.
 */
function borrowedOf(value: unknown): SourceRecord {
  const bad = (why: string) => new Refusal('EDIT_BAD_EDIT', why);
  if (!isPlain(value)) throw bad('A set-borrowed edit needs a source: an object with a name, a marketplace, a version, and items.');
  const keys = Object.keys(value);
  if (keys.length !== 4 || !['name', 'marketplace', 'version', 'items'].every(k => keys.includes(k))) throw bad('A borrowed record has exactly a name, a marketplace, a version, and items.');
  const { name, marketplace, version, items } = value;
  for (const [what, v] of [['name', name], ['marketplace', marketplace], ['version', version]] as const) {
    if (typeof v !== 'string' || v === '' || v.length > 256) throw bad(`The ${what} of a borrowed record must be text of 1 to 256 characters.`);
  }
  const list = listOf(items, 'items list');
  if (list.length === 0) throw bad('A borrowed record lists one item or more.');
  const refs = list.map(item => {
    if (!isPlain(item) || Object.keys(item).length !== 2 || !(OVERRIDABLE_PARTS as readonly unknown[]).includes(item.part) || !isId(item.id)) {
      throw bad(`Each borrowed item has exactly a part (${OVERRIDABLE_PARTS.join(', ')}) and an id.`);
    }
    return { part: item.part as SourceRecord['items'][number]['part'], id: item.id };
  });
  return { name: name as string, marketplace: marketplace as string, version: version as string, items: refs };
}

/** The paths of one skill folder, in the working copy. */
function skillFiles(work: Work, id: string): string[] {
  const prefix = `${SKILLS_DIR}${id}/`;
  return [...work.keys()].filter(p => p.startsWith(prefix));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sets a field of agent frontmatter: undefined leaves it, null removes it. Returns 1 when the data changed. */
function setField(data: Obj, key: (typeof AGENT_LIST_FIELDS)[number], value: readonly string[] | null | undefined): 0 | 1 {
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

/** Takes a source out of the notes of an agent. A list left empty is removed. Returns true when the data changed. */
function unlinkNotes(data: Obj, name: string): boolean {
  if (!Array.isArray(data.notes) || !data.notes.includes(name)) return false;
  const left = data.notes.filter(n => n !== name);
  if (left.length) data.notes = left; else delete data.notes;
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
const AGENT_LIST_FIELDS = ['skills', 'tools', 'notes'] as const;

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

/**
 * `sources.json` as a list of borrowed records that edits change. `flush` writes it only when its meaning changed, so an
 * edit that nets out keeps the original bytes. It deletes the file, and its pointer, when no record and no adopted skill
 * is left. A file that is not valid stays as it is for the loader to refuse; a borrowed edit of it is refused.
 */
class BorrowedDraft {
  private static readonly FILE = 'sources.json';
  private readonly original: JsonValue | null;
  private readonly value: Obj | null;
  private records: Obj[];
  private touched = false;
  constructor(private readonly work: Work, private readonly harness: HarnessDraft) {
    const file = work.get(BorrowedDraft.FILE);
    const text = file ? decodeText(file.bytes) : null;
    const parsed = text === null ? null : parseStrictJson(text);
    const ok = parsed?.ok === true && isRecord(parsed.value) && Array.isArray(parsed.value.sources) ? parsed.value : null;
    this.value = ok;
    this.original = ok === null ? null : JSON.parse(JSON.stringify(ok)) as JsonValue;
    this.records = ok === null ? [] : (ok.sources as JsonValue[]).map(s => s as Obj);
  }

  private usable(): void {
    if (this.work.has(BorrowedDraft.FILE) && this.value === null) throw new Refusal('EDIT_INVALID', 'sources.json is not valid.');
  }

  has(name: string): boolean { return this.records.some(r => isRecord(r) && r.name === name); }

  set(record: SourceRecord): void {
    this.usable();
    this.touched = true;
    const next = JSON.parse(JSON.stringify(record)) as Obj;
    const at = this.records.findIndex(r => isRecord(r) && r.name === record.name);
    if (at >= 0) this.records[at] = next; else this.records.push(next);
  }

  remove(name: string): void {
    this.usable();
    this.touched = true;
    this.records = this.records.filter(r => !isRecord(r) || r.name !== name);
  }

  flush(): void {
    if (!this.touched) return;
    const had = this.work.get(BorrowedDraft.FILE);
    const next: Obj = { ...(this.value ?? {}), sources: this.records as unknown as JsonValue };
    if (this.original !== null && canonicalJson(next) === canonicalJson(this.original)) return;
    const adopted = Array.isArray(next.adopted) && next.adopted.length > 0;
    if (this.records.length === 0 && !adopted) {
      if (had) this.work.delete(BorrowedDraft.FILE);
      this.harness.part('plugins', null);
      return;
    }
    this.work.set(BorrowedDraft.FILE, { bytes: Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8'), executable: had?.executable ?? false });
    this.harness.part('plugins', BorrowedDraft.FILE);
  }
}

/**
 * `knowledge.json` as a list of sources that edits change. `flush` writes it only when its meaning changed, so an edit
 * that nets out keeps the original bytes, and deletes it when the last source is gone. A file that is not valid stays as
 * it is for the loader to refuse; an edit of it is refused.
 */
class KnowledgeDraft {
  private readonly original: JsonValue | null;
  private readonly value: Obj | null;
  private sources: KnowledgeSource[];
  constructor(private readonly work: Work) {
    const file = work.get(KNOWLEDGE_FILE);
    const text = file ? decodeText(file.bytes) : null;
    const parsed = text === null ? null : parseStrictJson(text);
    const ok = parsed?.ok === true && isRecord(parsed.value) && Array.isArray(parsed.value.sources) ? parsed.value : null;
    this.value = ok;
    this.original = ok === null ? null : JSON.parse(JSON.stringify(ok)) as JsonValue;
    // The loader checks every source of the result; a source that is not a record is kept for it to refuse.
    this.sources = ok === null ? [] : (ok.sources as readonly JsonValue[]).map(s => s as unknown as KnowledgeSource);
  }

  private usable(): void {
    if (this.work.has(KNOWLEDGE_FILE) && this.value === null) throw new Refusal('EDIT_INVALID', 'knowledge.json is not valid.');
  }

  has(name: string): boolean { return this.sources.some(s => isRecord(s as unknown as JsonValue) && s.name === name); }

  set(source: KnowledgeSource): void {
    this.usable();
    const at = this.sources.findIndex(s => isRecord(s as unknown as JsonValue) && s.name === source.name);
    if (at >= 0) this.sources[at] = source; else this.sources.push(source);
  }

  remove(name: string): void {
    this.usable();
    this.sources = this.sources.filter(s => !isRecord(s as unknown as JsonValue) || s.name !== name);
  }

  flush(): void {
    const had = this.work.get(KNOWLEDGE_FILE);
    if (had && this.value === null) return;
    const next: Obj = { ...(this.value ?? {}), sources: this.sources.map(s => ({ ...s })) as unknown as JsonValue };
    if (this.original !== null && canonicalJson(next) === canonicalJson(this.original)) return;
    if (this.sources.length === 0) {
      if (had) this.work.delete(KNOWLEDGE_FILE);
      return;
    }
    this.work.set(KNOWLEDGE_FILE, { bytes: Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8'), executable: had?.executable ?? false });
  }
}
