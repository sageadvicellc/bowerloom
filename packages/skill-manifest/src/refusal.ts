/**
 * The fixed refusals of the skills manifest (build plan 01, M3). Every refusal has a fixed code and a fixed message.
 * A message never carries fetched text, a path or a URL, so output stays safe to share and fetched text stays data.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  USAGE: 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id> and --team <team>, or bowerloom skills check.',
  MANIFEST_NOT_FOUND: 'This project has no .bowerloom/skills.json yet. Add a skill with bowerloom skills add.',
  MANIFEST_INVALID: 'The .bowerloom/skills.json file is not a valid skills manifest. Fix the file, or restore it from version control.',
  MANIFEST_UNSAFE: 'The .bowerloom/skills.json file is not safe to read. It must be a regular file that you own, with one link and no write access for others.',
  MANIFEST_PIN_NOT_EXACT: 'A skill pin must be exact: an npm version such as 1.2.3, or a full 40-character lowercase Git commit. Ranges, tags, branches and short commits are refused.',
  MANIFEST_LICENSE_UNSUPPORTED: 'Bowerloom accepts skills under the MIT or Apache-2.0 license only.',
  MANIFEST_DUPLICATE_ID: 'Two skills in the manifest have the same id.',
  MANIFEST_LIMIT: 'The manifest is too large. It holds at most 32 skills and 1 MiB.',
  SKILLS_ADD_SPEC_INVALID: 'The skill source is not in a form Bowerloom accepts. Use npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>.',
  SKILLS_ADD_EXISTS: 'The manifest already holds a skill with this id or this source. Choose another id with --id, or keep the existing entry.',
  SKILLS_ADD_NOT_FOUND: 'The registry or GitHub has no such package version, commit or path.',
  SKILLS_ADD_SKILL_MISSING: 'The selected folder has no SKILL.md, so it is not a skill.',
  SKILLS_ADD_LICENSE_UNKNOWN: 'Bowerloom could not find an MIT or Apache-2.0 license for this skill, in the skill folder or in a folder above it.',
  SKILLS_ADD_UNSAFE_CONTENT: 'The fetched skill holds content Bowerloom does not install: a link, a submodule, a script or other unlisted file type, an oversize file, or text it cannot read safely.',
  SKILLS_ADD_NETWORK: 'Bowerloom could not read the public source. Check the network connection and try again. Nothing was changed.',
  SKILLS_ADD_HOST_REFUSED: 'Bowerloom reads only registry.npmjs.org and api.github.com, at public addresses.',
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  MANIFEST_WRITE_UNCONFIRMED: 'skills.json was written, but reading it back did not give the planned bytes. Another program may have changed it at the same moment. Check it with bowerloom skills check.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  TEAM_NOT_FOUND: 'This project has no team with that id. Run bowerloom ls teams to see the teams.',
} as const;

export type ManifestRefusalCode = keyof typeof MESSAGES;
export const MANIFEST_REFUSAL_CODES: readonly ManifestRefusalCode[] = Object.freeze(Object.keys(MESSAGES) as ManifestRefusalCode[]);

// Membership is the error object itself: only manifestRefusal adds to it, so a forged error with a listed code is not one.
const own = new WeakSet<object>();
/** The refusal for `code`, with its fixed message. */
export function manifestRefusal(code: ManifestRefusalCode): DefinitionError {
  if (!Object.hasOwn(MESSAGES, code)) throw new TypeError('manifestRefusal takes a listed code only.');
  const error = new DefinitionError(code, MESSAGES[code]); own.add(error); return error;
}
export function refuse(code: ManifestRefusalCode): never { throw manifestRefusal(code); }
export function requireManifest(ok: unknown, code: ManifestRefusalCode): asserts ok { if (!ok) refuse(code); }
/** True only for an error that manifestRefusal made. */
export function isManifestRefusal(error: unknown): error is DefinitionError & { code: ManifestRefusalCode } {
  return typeof error === 'object' && error !== null && own.has(error);
}
/** Keeps a manifest refusal; turns anything else into `fallback`. A foreign message never escapes. */
export function fixedRefusal(error: unknown, fallback: ManifestRefusalCode): DefinitionError {
  return isManifestRefusal(error) ? error : manifestRefusal(fallback);
}
