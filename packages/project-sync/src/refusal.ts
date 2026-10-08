/**
 * The fixed refusals of `skills sync`, `skills recover --item` and `skills migrate` (build plan 01, M5).
 * Each code has a fixed message. A message may add checked item ids and Bowerloom commands, never fetched text.
 * MANAGED_SKILL_* codes from managed-skills pass through under their own code, with words of their own here.
 */
import { DefinitionError } from '../../contracts/src/index.js';
import { ManagedSkillError } from '../../managed-skills/src/observed.js';
import { MANAGED_ITEM_CODES } from '../../managed-skills/src/v2-observed.js';

const MESSAGES = {
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  SKILLS_OFFLINE: 'Bowerloom could not fetch a pinned skill. Nothing in the project changed.',
  SKILLS_SYNC_CONTENT_MISMATCH: 'The bytes Bowerloom holds for a skill do not match the pins and file hashes in .bowerloom/skills.json. Nothing in the project changed.',
  SKILLS_SYNC_INTERRUPTED: 'skills sync stopped between two skills, as asked. Each skill it finished is complete; no skill was left half done.',
  SKILLS_SYNC_LIMIT: 'This sync is larger than this beta allows: 64 skills at most, counting the skills that are no longer in skills.json.',
  SKILLS_CACHE_RECOVERY_REQUIRED: 'The private skills cache holds an unfinished or unclear operation for a pin, and every operation id of that pin is used.',
  SKILLS_STATE_UNSAFE: 'The private state folder is not safe to use. Each folder must be a real folder you own, with no write access for others, and Bowerloom\'s own folders must be mode 0700.',
  SKILLS_RECOVER_NOTHING: 'This item has no unfinished operation to recover.',
  SKILLS_MIGRATE_NOTHING: 'This project has no skill installed by an earlier Bowerloom (.bowerloom-skills), so there is nothing to migrate.',
  SKILLS_MIGRATE_STATE_INVALID: 'The folder given with --state does not hold the committed earlier install of this project.',
  SKILLS_MIGRATE_NOT_IN_MANIFEST: '.bowerloom/skills.json does not pin the installed skill with the same source and file hashes.',
  REVISION_PENDING: 'A revise of this project is unfinished. Finish it first (bowerloom help advanced lists revise recover).',
  MANAGED_SKILL_LEGACY_PRESENT: 'This project still holds a skill installed by an earlier Bowerloom (.bowerloom-skills). Migrate it first: bowerloom skills migrate plan --state <v1-state-dir>.',
  MANAGED_SKILL_RECOVERY_REQUIRED: 'A managed skill operation is unfinished.',
  MANAGED_SKILL_LOCAL_DRIFT: 'A managed copy was changed on this machine since Bowerloom installed it.',
  MANAGED_SKILL_PATH_OCCUPIED: 'A place a managed copy goes is already taken by something Bowerloom did not install.',
  MANAGED_SKILL_HISTORY_FULL: 'A skill has 64 operations in its private history, the most Bowerloom keeps.',
  MANAGED_SKILL_STALE_APPROVAL: 'A managed skill changed after the plan was made. Nothing more was applied.',
  MANAGED_SKILL_LOCKED: 'Another Bowerloom command is changing this project.',
  MANAGED_SKILL_LOCK_NOT_HELD: 'The project lock was lost during the run.',
  MANAGED_SKILL_LOCK_SLOT_COLLISION: 'Another program holds the local port that Bowerloom uses to lock this project.',
  MANAGED_SKILL_ABORTED: 'A managed skill operation was stopped.',
  MANAGED_SKILL_TIMEOUT: 'A managed skill operation ran past its time limit.',
  MANAGED_SKILL_REFUSED: 'A managed skill operation was refused by its safety checks.',
} as const;

export type SyncCode = keyof typeof MESSAGES;
export const SYNC_REFUSAL_CODES: readonly SyncCode[] = Object.freeze(Object.keys(MESSAGES) as SyncCode[]);
const own = new WeakSet<object>();

/** The refusal for `code`, with its fixed message and, when given, a sentence about the item and the next command. */
export function syncError(code: SyncCode, extra?: string): DefinitionError {
  if (!Object.hasOwn(MESSAGES, code)) throw new TypeError('syncError takes a listed code only.');
  const error = new DefinitionError(code, extra ? `${MESSAGES[code]} ${extra}` : MESSAGES[code]); own.add(error); return error;
}
export const isSyncError = (error: unknown): error is DefinitionError => typeof error === 'object' && error !== null && own.has(error);
/** A managed-skills code as it passes through: its own code when listed, else MANAGED_SKILL_REFUSED. */
export function managedCode(error: unknown): SyncCode {
  const code = error instanceof ManagedSkillError && MANAGED_ITEM_CODES.includes(error.code) ? error.code : 'MANAGED_SKILL_REFUSED';
  return Object.hasOwn(MESSAGES, code) ? code as SyncCode : 'MANAGED_SKILL_REFUSED';
}
/**
 * Keeps a refusal that already has words for a person (this module's, the manifest's or the project layer's, all
 * DefinitionError), passes a managed-skills code through with its words, and gives anything else `fallback`.
 */
export function outward(error: unknown, fallback: SyncCode = 'MANAGED_SKILL_REFUSED', extra?: string): DefinitionError {
  if (error instanceof DefinitionError) return error;
  if (error instanceof ManagedSkillError) return syncError(managedCode(error), extra);
  return syncError(fallback, extra);
}
