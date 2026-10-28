/** The refusals of adoption. A message never repeats a value from a file. */
import { DefinitionError, oneLine } from '../../contracts/src/index.js';
import type { Problem } from '../../harness-definition/src/index.js';

const MESSAGES = {
  ADOPTION_USAGE: 'The adoption input is not valid.',
  ADOPTION_PROJECT_UNSAFE: 'The project folder must be the real absolute path of a folder you own, with no link in it.',
  ADOPTION_DEFINED: 'The .bowerloom folder already holds harness.json, so it is a 0.8 definition. Adoption writes a new definition only. Nothing was changed.',
  ADOPTION_FOLDER_OCCUPIED: 'The .bowerloom folder holds a name that is neither a 0.7 name nor a 0.7 skill folder. Adoption would write a definition that does not load, so it refuses rather than read the folder in part. Nothing was changed.',
  ADOPTION_LEGACY_SKILL: 'A 0.7 skill in .bowerloom/skills holds something the definition cannot carry. Adoption never changes that file in place, so the definition would not load. Nothing was changed.',
  ADOPTION_OPENCODE_VERSION: 'An OpenCode file has the shape of another OpenCode version than the one adoption reads. Adoption reads the 1.x shape of OpenCode 1.18.30. Nothing was changed.',
  ADOPTION_DSH_TAG: 'DeepSeek Harness is pinned at tag 0.2.2-alpha.2. Adoption refuses any other tag until a person rechecks the format. Nothing was changed.',
  ADOPTION_CHOICE_INVALID: 'A choice names a conflict or a variant that the plan does not have, or gives a name that is not a valid id or not distinct.',
  ADOPTION_CHOICE_REQUIRED: 'Items with the same name differ. A person picks one or keeps both under distinct names before adoption writes. Nothing was changed.',
  ADOPTION_DEFINITION_INVALID: 'The planned definition does not load, so adoption writes nothing.',
  ADOPTION_STALE_APPROVAL: 'The plan changed after it was approved. Nothing was written. Plan again to see the new plan.',
  ADOPTION_PATH_UNSAFE: 'A path adoption would write is a link, is not yours, or sits in a folder that is not where adoption expects it. Adoption removed what it wrote.',
  ADOPTION_PARTIAL: 'Adoption stopped part way and could not remove every file it wrote. The paths listed are left over.',
} as const;
export type AdoptionCode = keyof typeof MESSAGES;
export const ADOPTION_REFUSAL_CODES: readonly AdoptionCode[] = Object.freeze(Object.keys(MESSAGES) as AdoptionCode[]);

/** An adoption refusal. `paths` names what it is about, `problems` the loader's problems. */
export class AdoptionRefusal extends DefinitionError {
  constructor(code: AdoptionCode, readonly paths: readonly string[] = [], readonly problems: readonly Problem[] = []) {
    super(code, `${MESSAGES[code]}${paths.length ? ` ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    this.name = 'AdoptionRefusal';
  }
}
export function refuse(code: AdoptionCode, paths: readonly string[] = [], problems: readonly Problem[] = []): never { throw new AdoptionRefusal(code, paths, problems); }
