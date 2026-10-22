/**
 * The fixed refusals of the skills manifest (build plan 01, M3). Every refusal has a fixed code and a fixed message.
 * A message never carries fetched text, a path or a URL, so output stays safe to share and fetched text stays data.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  USAGE: 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team> and --replace, or bowerloom skills check.',
  MANIFEST_NOT_FOUND: 'This project has no .bowerloom/skills.json yet. Add a skill with bowerloom skills add.',
  MANIFEST_INVALID: 'The .bowerloom/skills.json file is not a valid skills manifest. Fix the file, or restore it from version control.',
  MANIFEST_UNSAFE: 'The .bowerloom/skills.json file is not safe to read. It must be a regular file that you own, with one link and no write access for others.',
  MANIFEST_PIN_NOT_EXACT: 'A skill pin must be exact: an npm version such as 1.2.3, or a full 40-character lowercase Git commit. Ranges, tags, branches and short commits are refused.',
  MANIFEST_LICENSE_UNSUPPORTED: 'Bowerloom accepts skills under the MIT or Apache-2.0 license only.',
  MANIFEST_DUPLICATE_ID: 'Two skills in the manifest have the same id.',
  MANIFEST_LIMIT: 'The manifest is too large. It holds at most 128 skills and 1 MiB.',
  SKILLS_ADD_SPEC_INVALID: 'The skill source is not in a form Bowerloom accepts. Use npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>.',
  SKILLS_ADD_EXISTS: 'The manifest already holds a skill with this id or this source. To move that id to another version or commit, add --replace. Otherwise choose another id with --id, or keep the existing entry.',
  SKILLS_ADD_SOURCE_CHANGED: 'The skill with this id comes from another source. --replace changes only the version or commit of the same npm package or GitHub repository, and never a local skill.',
  SKILLS_ADD_REPLACE_MISSING: 'The manifest has no skill with this id to replace. Run the command without --replace to add it, or name the existing id with --id.',
  SKILLS_ADD_NOT_FOUND: 'The registry or GitHub has no such package version, commit or path.',
  SKILLS_ADD_SKILL_MISSING: 'The selected folder has no SKILL.md, so it is not a skill.',
  SKILLS_ADD_LICENSE_UNKNOWN: 'Bowerloom could not find an MIT or Apache-2.0 license for this skill, in the skill folder or in a folder above it.',
  SKILLS_ADD_FRONTMATTER: 'The SKILL.md frontmatter has a key or a value Bowerloom does not accept. It accepts name, description, license, compatibility, metadata, allowed-tools and argument-hint, each as short plain text. Keys that change what an agent does, such as hooks or model, are refused.',
  SKILLS_ADD_UNSAFE_CONTENT: 'The fetched skill holds content Bowerloom does not install: a link, a submodule, a script or other unlisted file type, an oversize file, or text it cannot read safely.',
  SKILLS_ADD_NETWORK: 'Bowerloom could not read the public source. Check the network connection and try again. Nothing was changed.',
  SKILLS_ADD_HOST_REFUSED: 'Bowerloom reads only registry.npmjs.org and api.github.com, at public addresses.',
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  MANIFEST_WRITE_UNCONFIRMED: 'skills.json was written, but reading it back did not give the planned bytes. Another program may have changed it at the same moment. Check it with bowerloom skills check.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  TEAM_NOT_FOUND: 'This project has no team with that id. Run bowerloom ls teams to see the teams.',
  GITHUB_RATE_LIMITED: 'api.github.com answered 429, or 403 with no requests left.',
  GITHUB_REQUEST_FAILED: 'api.github.com refused the request.',
  // Spec 07, section 5.
  GITHUB_TOKEN_INVALID: 'The BOWERLOOM_GITHUB_TOKEN variable does not hold a valid GitHub token.',
  STORE_REMOTE_AUTH_FAILED: 'GitHub did not accept the token for the store repository, or the repository or commit does not exist.',
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
/**
 * MANIFEST_LIMIT for the manifest of `limits`. A store refusal (more than the project's 128 skills allowed) says 256 skills
 * and 4 MiB and carries the hint `store-limit`, so the plain words can point at `skills check --global`.
 */
export function limitRefusal(limits: { readonly skills: number }): DefinitionError {
  if (limits.skills <= 128) return manifestRefusal('MANIFEST_LIMIT');
  const error = new DefinitionError('MANIFEST_LIMIT', 'The manifest is too large. It holds at most 256 skills and 4 MiB.'); own.add(error);
  Object.defineProperty(error, 'hint', { value: 'store-limit', enumerable: false });
  return error;
}
/** GITHUB_REQUEST_FAILED naming the HTTP status: a 401 or 403 that is not the request limit, or a 5xx (spec 06 review F3). */
export function githubRequestFailed(status: number): DefinitionError {
  const shown = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const error = new DefinitionError('GITHUB_REQUEST_FAILED', `${MESSAGES.GITHUB_REQUEST_FAILED} HTTP status ${shown}.`); own.add(error); return error;
}
/** Refuses with the scope-aware MANIFEST_LIMIT unless `ok`. */
export function requireLimit(ok: unknown, limits: { readonly skills: number }): asserts ok { if (!ok) throw limitRefusal(limits); }
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
