/**
 * The save step's own parts of main (0.8.0-beta.1, option C): one folder saves its own harness definition. No inheritance, no hide or replace.
 *  - The window sends edits as a closed list of ids (shared/engine/types.ts, `SaveEdit`). Main turns them into edits of the definition
 *    (packages/harness-definition, `editDefinition`) and reads every byte it writes itself: a skill copied from another folder is read again there, from that
 *    folder's own loaded definition, and scanned for secrets here before the save's own scan.
 *  - The target is the full file set of the folder's `.bowerloom`; packages/adoption `planSave` and `applySave` write it under the project lock.
 *  - Save points: packages/project-sync `recordVersionLocked`, under the project lock, in the folder's private state. One is kept of the harness as it was before
 *    the first save (and before any save when the harness changed since the last save point), and one after each save and each go-back.
 * Nothing here talks to the window: engine-service.ts calls these, inside its gate.
 */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { INCOMPLETE_RULES, editDefinition, loadDefinition, loadDefinitionFiles, scanSecrets } from '../../../packages/harness-definition/src/index.js';
import type { Definition, DefinitionEdit, DefinitionFile, EngineTarget } from '../../../packages/harness-definition/src/index.js';
import { SaveRefusal } from '../../../packages/adoption/src/index.js';
import { checkVersionsFit, listVersions, recordVersionLocked } from '../../../packages/project-sync/src/index.js';
import type { VersionEntry } from '../../../packages/project-sync/src/index.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { ENGINE_IDS } from '../shared/engine/engines.js';
import { SAVE_MAIN_WORDS, SAVE_NO_DEFINITION, SAVE_POINT_TOO_LARGE, SAVE_SOURCE_MISSING } from '../shared/engine/types.js';
import type { DefinitionView, EngineId, SaveEdit, VersionView } from '../shared/engine/types.js';

/** The one folder key of a project's save points: the state layout is per project already, so a project has one list. */
export const VERSION_KEY = 'definition';

const DEF = '.bowerloom';
const byPath = (a: { path: string }, b: { path: string }): number => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

const NO_DEFINITION_WORDS = SAVE_MAIN_WORDS.SAVE_NO_DEFINITION;
const SOURCE_MISSING_WORDS = SAVE_MAIN_WORDS.SAVE_SOURCE_MISSING;

/**
 * The folder's definition as it is now. Only a missing `harness.json` (ENOENT) is SAVE_NO_DEFINITION. One that is a link or not a plain file, or that cannot
 * be read for another reason (`.bowerloom` is a file, say), is the package's SAVE_PATH_UNSAFE; one that does not load is SAVE_DEFINITION_INVALID.
 */
export function currentDefinition(dir: string): Definition {
  let plain: boolean;
  try { plain = lstatSync(join(dir, DEF, 'harness.json')).isFile(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DefinitionError(SAVE_NO_DEFINITION, NO_DEFINITION_WORDS);
    throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json']);
  }
  if (!plain) throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json']);
  const loaded = loadDefinition(join(dir, DEF));
  if (!loaded.ok) throw new SaveRefusal('SAVE_DEFINITION_INVALID', [...new Set(loaded.problems.map(p => `${p.path} (${p.code})`))], loaded.problems);
  return loaded.definition;
}

/** The harness as the editor draws it. Ids, names and the one-line descriptions only; no file text. */
export function definitionView(def: Definition): DefinitionView {
  const h = def.harness as unknown as { id?: unknown; description?: unknown; engines: readonly { id: string }[] };
  return {
    id: typeof h.id === 'string' ? h.id : '',
    description: typeof h.description === 'string' ? h.description : '',
    engines: ENGINE_IDS.filter(e => h.engines.some(x => x.id === e)),
    skills: def.entries.skills.map(s => ({ id: s.id, name: s.name, description: s.description })),
    agents: def.entries.subagents.map(a => ({ id: a.id, name: a.name, description: a.description, skills: [...(a.skills ?? [])] })),
    instructions: def.instructions !== undefined,
  };
}

/** The definition view of a target file set, through the loader run in memory. The save plan validated the same set first. */
export function targetView(files: readonly DefinitionFile[], dir: string): DefinitionView {
  const loaded = loadDefinitionFiles(files, join(dir, DEF));
  if (!loaded.ok) throw new SaveRefusal('SAVE_DEFINITION_INVALID', [...new Set(loaded.problems.map(p => `${p.path} (${p.code})`))], loaded.problems);
  return definitionView(loaded.definition);
}

/**
 * Every file of one skill in another folder's harness, relative to the skill folder, read through that folder's own loader (which never follows a link and
 * scans every file for secrets), then scanned again here. A source whose harness refuses a secret in that skill is SAVE_SECRET_FOUND; any other fault, or no
 * such skill, is SAVE_SOURCE_MISSING. A message never repeats a value. `loaded` is the source's load, when the caller made it already.
 */
export function skillFrom(sourceDir: string, id: string, loaded: ReturnType<typeof loadDefinition> = loadDefinition(join(sourceDir, DEF))): DefinitionFile[] {
  const prefix = `skills/${id}/`;
  if (!loaded.ok) {
    const secret = loaded.problems.filter(p => p.code === 'SECRET_VALUE' && p.path.startsWith(prefix));
    if (secret.length) throw new SaveRefusal('SAVE_SECRET_FOUND', [...new Set(secret.map(p => p.path))]);
    throw new DefinitionError(SAVE_SOURCE_MISSING, SOURCE_MISSING_WORDS);
  }
  const files = loaded.definition.files.filter(f => f.path.startsWith(prefix));
  if (!files.some(f => f.path === `${prefix}SKILL.md`)) throw new DefinitionError(SAVE_SOURCE_MISSING, SOURCE_MISSING_WORDS);
  const incomplete = new Set<string>(INCOMPLETE_RULES);
  const findings = scanSecrets(files).filter(f => !incomplete.has(f.rule));
  if (findings.length) throw new SaveRefusal('SAVE_SECRET_FOUND', [...new Set(findings.map(f => f.path))]);
  return files.map(f => ({ path: f.path.slice(prefix.length), bytes: Buffer.from(f.bytes), executable: f.executable === true }));
}

/** An engine the harness keeps keeps its version and model; a new one is its id alone. */
function engineOf(def: Definition, id: EngineId): EngineTarget {
  const was = def.harness.engines.find(e => e.id === id) as { id: EngineId; version?: unknown; model?: unknown } | undefined;
  return {
    id,
    ...(typeof was?.version === 'string' ? { version: was.version } : {}),
    ...(typeof was?.model === 'string' ? { model: was.model } : {}),
  } as EngineTarget;
}

/** The most `add-skill` edits one save takes: each one reads and scans a whole skill of another folder. */
export const ADD_SKILL_LIMIT = 16;
/** True when the `add-skill` edits are at most ADD_SKILL_LIMIT and no (from, id) pair comes twice. Main's input check refuses anything else. */
export function copiesOk(edits: readonly SaveEdit[]): boolean {
  const pairs = edits.filter((e): e is Extract<SaveEdit, { kind: 'add-skill' }> => e.kind === 'add-skill').map(e => `${e.from}\u0000${e.id}`);
  return pairs.length <= ADD_SKILL_LIMIT && new Set(pairs).size === pairs.length;
}

/**
 * The full target file set of the folder after the window's edits, in path order. `sourceDir` names the folder of an `add-skill` by its id; it throws the
 * call's own refusal for an id main does not know. Each source folder is asked for and loaded once per call. A refusal of `editDefinition` keeps its code
 * and its words. Edits over the copy bounds (`copiesOk`) are EDIT_TOO_LARGE.
 */
export function targetOf(def: Definition, edits: readonly SaveEdit[], sourceDir: (folderId: string) => string): DefinitionFile[] {
  if (!copiesOk(edits)) throw new DefinitionError('EDIT_TOO_LARGE', `One save copies at most ${ADD_SKILL_LIMIT} skills, each from one folder once. Nothing was written.`);
  const out: DefinitionEdit[] = [];
  const sources = new Map<string, { dir: string; loaded: ReturnType<typeof loadDefinition> }>();
  const source = (folderId: string): { dir: string; loaded: ReturnType<typeof loadDefinition> } => {
    let got = sources.get(folderId);
    if (got === undefined) { const dir = sourceDir(folderId); got = { dir, loaded: loadDefinition(join(dir, DEF)) }; sources.set(folderId, got); }
    return got;
  };
  // The other files of the last copy of each skill id: an earlier copy that a later edit removed brings none of its files back.
  const copied = new Map<string, DefinitionFile[]>();
  for (const e of edits) {
    switch (e.kind) {
      case 'set-agent': out.push({ kind: 'set-agent', id: e.id, skills: [...e.skills] }); break;
      case 'remove-skill': out.push({ kind: 'remove-skill', id: e.id }); copied.delete(e.id); break;
      case 'set-engines': out.push({ kind: 'set-engines', engines: e.engines.map(id => engineOf(def, id)) }); break;
      case 'add-skill': {
        const from = source(e.from);
        const files = skillFrom(from.dir, e.id, from.loaded);
        const main = files.find(f => f.path === 'SKILL.md')!;
        out.push({ kind: 'add-skill', id: e.id, text: Buffer.from(main.bytes).toString('utf8') });
        copied.set(e.id, files.filter(f => f.path !== 'SKILL.md').map(f => ({ path: `skills/${e.id}/${f.path}`, bytes: f.bytes, executable: f.executable === true })));
        break;
      }
    }
  }
  const r = editDefinition(def, out);
  if (!r.ok) throw new DefinitionError(r.code, r.message);
  // The other files of a copied skill go with it, unless a later edit removed the skill. The save plan loads and scans the whole set again.
  const have = new Set(r.files.map(f => f.path));
  const extra = [...copied].filter(([id]) => have.has(`skills/${id}/SKILL.md`)).flatMap(([, files]) => files).filter(f => !have.has(f.path));
  return [...r.files, ...extra].sort(byPath);
}

/**
 * Refuses SAVE_POINT_TOO_LARGE, with words, when the save points of the harness before a save and after it could not both be kept: a save never runs when Go
 * back would have no entry for it. Any other refusal of the store passes through.
 */
export function keepable(before: readonly DefinitionFile[], after: readonly DefinitionFile[]): void {
  try { checkVersionsFit(VERSION_KEY, [before, after]); } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'VERSION_TOO_LARGE') throw new DefinitionError(SAVE_POINT_TOO_LARGE, SAVE_MAIN_WORDS.SAVE_POINT_TOO_LARGE);
    throw error;
  }
}

/** A short code of an error for words and the usage log, or FAILED. */
const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'FAILED';
};
/**
 * The warnings after a save or a go-back that wrote: its journal could not be removed (`journalLeft`), and the save point after it could not be kept
 * (`pointError`). Each says the save is done and what that leaves. None when both went well.
 */
export function afterSaveWarnings(journalLeft: boolean, pointError: unknown): string[] {
  const out: string[] = [];
  if (pointError !== null && pointError !== undefined) out.push(`The save is done. Bowerloom could not keep a save point of it (${codeOf(pointError)}), so Go back has no entry for this save.`);
  // The app's recovery of a stopped save takes it back; the words say so, so nobody undoes a finished save by surprise.
  if (journalLeft) out.push('The save is done. Bowerloom could not clear its note of the save in progress, so install and other changes wait. Finish a stopped harness clears the note, and it takes this save back.');
  return out;
}
export { codeOf as saveCodeOf };

/** The save points of a folder, newest first, each with whether the harness is that save point now. */
export function versionViews(dirs: HarnessStateDirs, def: Definition): VersionView[] {
  return listVersions(dirs, VERSION_KEY).map(v => viewOf(v, def));
}
/**
 * True when a save point is the harness now: the same revision, and the same execute bit on each file. The revision does not cover the execute bit, and a
 * save writes it, so a bit changed by hand makes the save point another harness.
 */
export function sameAsNow(v: VersionEntry, def: Definition): boolean {
  if (v.revision !== def.revision || v.files.length !== def.files.length) return false;
  const bits = new Map(def.files.map(f => [f.path, f.executable === true]));
  return v.files.every(f => bits.get(f.path) === f.executable);
}
export const viewOf = (v: VersionEntry, def: Definition): VersionView => ({ id: v.id, created: v.created, label: v.label, files: v.files.length, current: sameAsNow(v, def) });

const FIRST = 'As it was before the first save';
const BEFORE = 'As it was before this save';

/**
 * Keeps the harness as it is now as a save point, under the project lock, unless the newest save point is already this harness. Called before every save and
 * go-back, so "Go back" always has the state before it. A store that cannot record refuses the save: a save never runs without a way back.
 */
export async function keepBefore(dir: string, dirs: HarnessStateDirs, now: Date): Promise<void> {
  await recordVersionLocked(dirs, dir, VERSION_KEY, newest => {
    const def = currentDefinition(dir);
    if (newest !== null && sameAsNow(newest, def)) return null;
    return { files: def.files, meta: { revision: def.revision, label: newest === null ? FIRST : BEFORE, now } };
  });
}

/** Keeps the files a save or a go-back wrote as a new save point, under the project lock. Returns its id. */
export async function keepAfter(dir: string, dirs: HarnessStateDirs, files: readonly DefinitionFile[], revision: string, label: string, now: Date): Promise<string> {
  const kept = await recordVersionLocked(dirs, dir, VERSION_KEY, () => ({ files, meta: { revision, label: label.slice(0, 200), now } }));
  return kept!.id;
}

/** The label of a save point after a save: "Saved 3 changes". After a go-back: "Went back to v2". */
export const savedLabel = (n: number): string => `Saved ${n} ${n === 1 ? 'change' : 'changes'}`;
export const wentBackLabel = (id: string): string => `Went back to ${id}`;
