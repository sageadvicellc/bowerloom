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
  ADOPTION_PARTIAL: 'Adoption stopped part way and could not remove every file it wrote. The journal stays in the state folder, so plan a recovery. The paths listed are left over.',
  ADOPTION_STATE_UNSAFE: 'The state folder must be a normalized absolute path outside the project, and a private folder of yours (mode 0700) when it exists.',
  ADOPTION_STATE_INVALID: 'The adoption journal in the state folder is damaged, names another project, or names a path outside .bowerloom. Nothing was changed.',
  ADOPTION_RECOVERY_REQUIRED: 'An earlier adoption stopped part way, and its journal is in the state folder. Plan and approve a recovery first. Nothing was changed.',
  ADOPTION_RECOVER_NOTHING: 'No adoption of this project is unfinished, so there is nothing to recover.',
  ADOPTION_APPROVAL_REQUIRED: 'Items need a person\'s approval, and the approvals given do not confirm every one. Nothing was written.',
  ADOPTION_ACKNOWLEDGEMENT_REQUIRED: 'Unmapped entries could hold a deny, an ask, or a sandbox value. A person acknowledges each by id before adoption writes. Nothing was written.',
  ADOPTION_AT_IMPORT: 'The instructions use an @path import, which the portable projection refuses. Inline the imported text first. Nothing was written.',
  ADOPTION_TOO_LARGE: 'The project holds more than adoption reads in one run: the limits match the definition loader (files, bytes, entries per folder, folder depth). Nothing was read past the limit.',
  ADOPTION_ABORTED: 'The run was stopped. Adoption removed what it wrote.',
} as const;
export type AdoptionCode = keyof typeof MESSAGES;
export const ADOPTION_REFUSAL_CODES: readonly AdoptionCode[] = Object.freeze(Object.keys(MESSAGES) as AdoptionCode[]);

/** An adoption refusal. `paths` names what it is about, `problems` the loader's problems. */
export class AdoptionRefusal extends DefinitionError {
  /** For ADOPTION_PARTIAL: the code of the error that stopped the run (ruling A16). */
  readonly original?: string;
  constructor(code: AdoptionCode, readonly paths: readonly string[] = [], readonly problems: readonly Problem[] = [], original?: string) {
    const cause = original !== undefined ? ` The run stopped on ${/^[A-Z][A-Z0-9_]{0,63}$/.test(original) ? original : 'an error'}.` : '';
    super(code, `${MESSAGES[code]}${cause}${paths.length ? ` ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    if (original !== undefined) this.original = original;
    this.name = 'AdoptionRefusal';
  }
}
export function refuse(code: AdoptionCode, paths: readonly string[] = [], problems: readonly Problem[] = [], original?: string): never { throw new AdoptionRefusal(code, paths, problems, original); }
