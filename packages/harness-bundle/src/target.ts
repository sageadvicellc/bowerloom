/**
 * The target of an import, and the test for a harness that an import may fill. Both are pure.
 */
import { editDefinition } from '../../harness-definition/src/index.js';
import { KNOWLEDGE_FILE } from '../../harness-definition/src/index.js';
import { EMPTY_HARNESS_DESCRIPTION } from '../../harness-definition/src/defaults.js';
import type { Definition, DefinitionEdit, DefinitionFile, EditRefusalCode } from '../../harness-definition/src/index.js';
import { BundleRefusal, causeOf } from './codes.js';
import { loadBundleParts, recallLoaded } from './codec.js';
import { BUNDLE_LIMITS } from './limits.js';
import type { DecodedBundle, ImportChoices } from './types.js';

const REASONS: Readonly<Record<EditRefusalCode, ConstructorParameters<typeof BundleRefusal>[0]>> = {
  EDIT_BAD_EDIT: 'BUNDLE_USAGE', EDIT_UNSAFE_ID: 'BUNDLE_USAGE', EDIT_UNKNOWN_ID: 'BUNDLE_USAGE', EDIT_DUPLICATE_ID: 'BUNDLE_USAGE', EDIT_UNSAFE_PATH: 'BUNDLE_USAGE',
  EDIT_TOO_LARGE: 'BUNDLE_TOO_LARGE', EDIT_SECRET_FOUND: 'BUNDLE_SECRET_FOUND', EDIT_INVALID: 'BUNDLE_INVALID',
};
/** The loader's own codes for a fault of the choices (two names linked to one folder). They are `BUNDLE_USAGE`, not `BUNDLE_INVALID`: the files are fine. */
const CHOICE_FAULTS = new Set(['KNOWLEDGE_DUPLICATE_PATH', 'KNOWLEDGE_PATH', 'DUPLICATE_ID']);

/**
 * The loaded definition of a decoded bundle: remembered from `decodeBundle` for a bundle it issued, else loaded again from the object's files each time. An object that
 * `decodeBundle` did not issue is never remembered, so changing one after a first look cannot leave a stale definition behind.
 */
export function definitionOf(bundle: DecodedBundle): Definition {
  const known = recallLoaded(bundle);
  if (known !== undefined) return known;
  try {
    if (bundle === null || typeof bundle !== 'object' || !Array.isArray(bundle.files) || !Array.isArray(bundle.knowledge)) throw new BundleRefusal('BUNDLE_USAGE');
    return loadBundleParts(bundle.files, bundle.knowledge);
  } catch (error) {
    if (error instanceof BundleRefusal) throw error;
    throw new BundleRefusal('BUNDLE_INVALID', [], [], causeOf(error));
  }
}

/**
 * The files of a loaded definition that belong in a bundle: every file but `knowledge.json` (the placeholder). These are the copies the loader made and checked, not the
 * bytes of the bundle object, so a caller that changes those bytes after the load changes neither a summary nor a target.
 */
export const bundleFilesOf = (def: Definition): readonly DefinitionFile[] => def.files.filter(f => f.path !== KNOWLEDGE_FILE);

export function targetFromBundle(bundle: DecodedBundle, choices: ImportChoices): readonly DefinitionFile[] {
  try {
    if (choices === null || typeof choices !== 'object' || !(choices.link instanceof Map) || !(choices.leave instanceof Set)) throw new BundleRefusal('BUNDLE_USAGE');
    const def = definitionOf(bundle);
    const names = new Set(bundle.knowledge.map(k => k.name));
    if (choices.link.size + choices.leave.size > BUNDLE_LIMITS.notesNames) throw new BundleRefusal('BUNDLE_USAGE');
    for (const name of choices.link.keys()) if (typeof name !== 'string' || !names.has(name) || choices.leave.has(name)) throw new BundleRefusal('BUNDLE_USAGE');
    for (const name of choices.leave) if (typeof name !== 'string' || !names.has(name)) throw new BundleRefusal('BUNDLE_USAGE');
    // A name linked gets its folder; a name left out, or in neither list, leaves every agent's notes.
    const edits: DefinitionEdit[] = bundle.knowledge.map(k => {
      const at = choices.link.get(k.name);
      return at === undefined ? { kind: 'remove-source', name: k.name } : { kind: 'set-source', source: { kind: k.kind, name: k.name, path: at } };
    });
    if (edits.length === 0) return bundleFilesOf(def).map(f => ({ path: f.path, bytes: Uint8Array.from(f.bytes), ...(f.executable === true ? { executable: true } : {}) }));
    const result = editDefinition(def, edits);
    if (!result.ok) {
      const faulty = result.problems?.some(p => CHOICE_FAULTS.has(p.code)) === true;
      throw new BundleRefusal(faulty ? 'BUNDLE_USAGE' : REASONS[result.code], [], result.code === 'EDIT_INVALID' && !faulty ? result.problems ?? [] : []);
    }
    return result.files;
  } catch (error) {
    if (error instanceof BundleRefusal) throw error;
    throw new BundleRefusal('BUNDLE_INVALID', [], [], causeOf(error));
  }
}

export { EMPTY_HARNESS_DESCRIPTION };

/**
 * What a harness holds that an import would overwrite, in plain words, in a fixed order; an empty list means the harness is empty. Parts: skills, agents, guardrails (rules and
 * sandbox), hooks, tools, instructions, notes sources, borrowed sources, scripts, engine files. Settings of `harness.json` that a person made: a description other than the one
 * "Make an empty harness here" writes (`EMPTY_HARNESS_DESCRIPTION`), an engine with a version or a model, an override, and the settings of a skill. A plain list of engines does
 * not count, because a new harness lists the engines found. The check fails closed: a value that is not a definition, or one that cannot be read, gives `['a harness that cannot be read']`.
 */
export function harnessPartsFound(def: Definition): readonly string[] {
  try {
    const e = def.entries, h = def.harness;
    const found: string[] = [];
    if (e.skills.length > 0) found.push('skills');
    if (e.subagents.length > 0) found.push('agents');
    if (e.rules.length > 0 || e.sandbox.length > 0) found.push('guardrails');
    if (e.hooks.length > 0) found.push('hooks');
    if (e.mcp.length > 0) found.push('tools');
    if (def.instructions !== undefined) found.push('instructions');
    if (def.knowledge.length > 0) found.push('notes sources');
    if (def.sources.length > 0 || def.adopted.length > 0) found.push('borrowed sources');
    if (def.scripts.length > 0) found.push('scripts');
    if (Object.values(def.enginePrivate).some(list => list !== undefined && list.length > 0)) found.push('engine files');
    if (h.description !== EMPTY_HARNESS_DESCRIPTION) found.push('a description you wrote');
    if (h.engines.some(x => x.version !== undefined || x.model !== undefined)) found.push('an engine with a version or a model');
    if (h.overrides.length > 0) found.push('an override');
    if (Object.keys(h.skills).length > 0) found.push('settings of a skill');
    return found;
  } catch { return ['a harness that cannot be read']; }
}

/** True when the harness holds no part and no setting that an import would overwrite (`harnessPartsFound` is empty). */
export function isEmptyHarness(def: Definition): boolean {
  return harnessPartsFound(def).length === 0;
}

/** Refuses `IMPORT_FOLDER_HAS_HARNESS` unless the harness is empty, and names what it found (`harnessPartsFound`) in the refusal's paths. */
export function assertEmptyHarness(def: Definition): void {
  const found = harnessPartsFound(def);
  if (found.length > 0) throw new BundleRefusal('IMPORT_FOLDER_HAS_HARNESS', found);
}
