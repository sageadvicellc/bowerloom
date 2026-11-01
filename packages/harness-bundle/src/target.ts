/**
 * The target of an import, and the test for a harness that an import may fill. Both are pure.
 */
import { editDefinition } from '../../harness-definition/src/index.js';
import { KNOWLEDGE_FILE } from '../../harness-definition/src/index.js';
import type { Definition, DefinitionEdit, DefinitionFile, EditRefusalCode } from '../../harness-definition/src/index.js';
import { BundleRefusal } from './codes.js';
import { causeOf, loadBundleParts, recallLoaded } from './codec.js';
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

/** The harness.json of a harness made empty by "Make an empty harness here": adoption writes this description when the person gives none. */
export const EMPTY_HARNESS_DESCRIPTION = 'Adopted from the engine files of this project.';

/**
 * True when the definition holds no entry, no instructions, no source and no knowledge. Scripts, engine files and converted skills count as parts too, because the save an
 * import makes would delete them. So do the settings of `harness.json` that the person made: a description other than the one "Make an empty harness here" writes, an engine
 * with a version or a model, an override, and the settings of a skill. The list of engines alone does not count (a new harness lists the engines found). An object that is
 * not a definition is not empty.
 */
export function isEmptyHarness(def: Definition): boolean {
  try {
    const e = def.entries, h = def.harness;
    return e.skills.length === 0 && e.subagents.length === 0 && e.rules.length === 0 && e.sandbox.length === 0 && e.hooks.length === 0 && e.mcp.length === 0
      && def.instructions === undefined && def.sources.length === 0 && def.adopted.length === 0 && def.knowledge.length === 0
      && def.scripts.length === 0 && Object.values(def.enginePrivate).every(list => list === undefined || list.length === 0)
      && h.description === EMPTY_HARNESS_DESCRIPTION && h.overrides.length === 0 && Object.keys(h.skills).length === 0
      && h.engines.every(x => x.version === undefined && x.model === undefined);
  } catch { return false; }
}
