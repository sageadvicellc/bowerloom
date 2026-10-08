/**
 * The fixed refusals of team, skill and prompt create (build plan 01, M2). Every refusal has a fixed code and a fixed
 * message. A message never carries a path or a name, so output stays safe to share.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  USAGE: 'Use bowerloom team create <name>, bowerloom skill create <name> or bowerloom prompt create <name>.',
  TEAM_EXISTS: 'This project already has a team with that id.',
  TEAM_ID_RESERVED: 'The id first-team belongs to the team that setup created. Choose another id.',
  TEAM_NAME_TAKEN: 'This id is the display name of first-team, the team that setup created, so bowerloom up --team would name that team. Choose another id.',
  TEAM_NAME_INVALID: 'A team id is lower-case letters and digits in words joined by single hyphens, at most 64 characters, such as research-desk.',
  TEAM_NOT_FOUND: 'This project has no team with that id. Run bowerloom ls teams to see the teams.',
  SKILL_EXISTS: 'This project already has a skill with that id, in .bowerloom/skills or in skills.json.',
  SKILL_NAME_RESERVED: 'The skill id personal-assistant and ids that start with prompt- are reserved.',
  SKILL_NAME_INVALID: 'A skill id is lower-case letters and digits in words joined by single hyphens, at most 64 characters, such as house-style.',
  PROMPT_EXISTS: 'This project already has a prompt with that id.',
  PROMPT_NAME_INVALID: 'A prompt id is lower-case letters and digits in words joined by single hyphens, at most 57 characters, such as weekly-update.',
  PROMPT_RESTORE_TEAMS: 'This prompt is registered, and its file is gone. A restore keeps the teams the prompt was created with. Run the same command without --team to restore it.',
  PROMPT_RESTORE_UNAVAILABLE: 'This prompt is registered, and its file is gone. Its recorded text is not the text that prompt create writes, so create cannot restore it. Restore the file from version control, for example with git restore .bowerloom/prompts.',
  PROJECT_BRIEF_INVALID: 'The project brief, .bowerloom/brief.json, is missing, unsafe or not valid, so a team cannot be made from it.',
  AUTHORING_PENDING: 'An earlier create was interrupted, and what it left does not match its record. Check .bowerloom/authoring/pending.json and the item it names.',
  AUTHORING_RECEIPT_INVALID: 'The record of created items, .bowerloom/authoring/receipt.json, is not valid. Restore it from version control.',
  AUTHORING_UNSAFE_PATH: 'A folder or file that create reads or writes is not safe: a link, a file with more than one link, a file you do not own, a file others can write, or a file over the size limit.',
  AUTHORING_UNREGISTERED: 'This folder or file is not one that create made. Remove it, or move it out of .bowerloom.',
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  AUTHORING_WRITE_INTERRUPTED: 'The project changed while create was writing, so it stopped. Part of the item may be in place. Run the same command again: its plan finishes or clears what was left.',
  AUTHORING_ITEM_MISSING: 'A team, skill or prompt that create made is gone from .bowerloom, but its record still lists it. Restore it from version control. To restore a prompt, run bowerloom prompt create with its id.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  REVISION_PENDING: 'A revise of this project is not finished. Finish it with bowerloom revise recover first.',
} as const;

export type AuthoringRefusalCode = keyof typeof MESSAGES;
export const AUTHORING_REFUSAL_CODES: readonly AuthoringRefusalCode[] = Object.freeze(Object.keys(MESSAGES) as AuthoringRefusalCode[]);

// Membership is the error object itself: only authoringRefusal adds to it.
const own = new WeakSet<object>();
export function authoringRefusal(code: AuthoringRefusalCode): DefinitionError {
  if (!Object.hasOwn(MESSAGES, code)) throw new TypeError('authoringRefusal takes a listed code only.');
  const error = new DefinitionError(code, MESSAGES[code]); own.add(error); return error;
}
export function refuse(code: AuthoringRefusalCode): never { throw authoringRefusal(code); }
export function ensure(ok: unknown, code: AuthoringRefusalCode): asserts ok { if (!ok) refuse(code); }
/** True only for an error that authoringRefusal made. */
export function isAuthoringRefusal(error: unknown): error is DefinitionError & { code: AuthoringRefusalCode } {
  return typeof error === 'object' && error !== null && own.has(error);
}
