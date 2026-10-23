/**
 * The fixed refusals of `skills sync`, `skills recover --item` and `skills migrate` (build plan 01, M5), and of
 * `apply` (M6).
 * Each code has a fixed message. A message may add checked item ids and Bowerloom commands, never fetched text.
 * MANAGED_SKILL_* codes from managed-skills pass through under their own code, with words of their own here.
 */
import { DefinitionError } from '../../contracts/src/index.js';
import { ManagedSkillError } from '../../managed-skills/src/observed.js';
import { MANAGED_ITEM_CODES } from '../../managed-skills/src/v2-observed.js';

const MESSAGES = {
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  // Round 3 of the reviews of PR 101: true for a written store item too.
  SKILLS_OFFLINE: 'This run could not get bytes that it needs. Nothing in the project changed.',
  SKILLS_SYNC_CONTENT_MISMATCH: 'The bytes Bowerloom holds for a skill do not match the pins and file hashes in .bowerloom/skills.json. Nothing in the project changed.',
  SKILLS_SYNC_INTERRUPTED: 'skills sync stopped between two skills, as asked. Each skill it finished is complete; no skill was left half done.',
  SKILLS_SYNC_LIMIT: 'This sync is larger than this beta allows: 256 skills at most, counting the skills that are no longer in skills.json.',
  SKILLS_CACHE_RECOVERY_REQUIRED: 'The private skills cache holds an unfinished or unclear operation for a pin, and every operation id of that pin is used.',
  SKILLS_PROJECT_UNSAFE: 'Bowerloom does not write copies into this project, because the project folder or a folder above it can be changed by other users, or has special mode bits. Move the project to a folder only you can change, such as one in your home folder.',
  SKILLS_STATE_UNSAFE: 'The private state folder is not safe to use. Each folder must be a real folder you own, with no write access for others, and Bowerloom\'s own folders must be mode 0700.',
  SKILLS_RECOVER_NOTHING: 'This item has no unfinished operation to recover.',
  SKILLS_MIGRATE_NOTHING: 'This project has no skill installed by an earlier Bowerloom (.bowerloom-skills), so there is nothing to migrate.',
  SKILLS_MIGRATE_STATE_INVALID: 'The folder given with --state does not hold the committed earlier install of this project.',
  SKILLS_MIGRATE_NOT_IN_MANIFEST: '.bowerloom/skills.json does not pin the installed skill with the same source and file hashes.',
  // Beta.3 docs review, fix 2: a frozen fetch whose locked commit GitHub no longer has, in a repository it can read.
  LOCK_COMMIT_GONE: 'The locked commit is no longer on GitHub.',
  SKILLS_STATE_STRAY_ENTRY: 'An item\'s private folder holds an entry that is not one of Bowerloom\'s operations.',
  APPLY_NAME_COLLISION: 'Two items, or an item and something Bowerloom did not install, would take the same place in the project. Nothing was changed.',
  PROMPT_INVALID: 'A prompt in .bowerloom/prompts cannot be read safely: it must be a plain text file you own, with one link, no write access for others, at most 64 KiB. Nothing was changed.',
  AGENT_LIMIT: 'This project holds more than 128 agents. Nothing was changed.',
  APPLY_AGENT_DUPLICATE: 'Two teams hold an agent with the same name.',
  APPLY_AGENTS_FOLDER_UNSAFE: '.claude or .claude/agents is a link, or others can write to it. Nothing was changed.',
  AGENT_GRANT_REVIEW_REQUIRED: 'This agent asks for powers that need your explicit approval.',
  AGENT_TEAM_UNREGISTERED: 'This agent\'s team is not registered in .bowerloom/authoring/receipt.json.',
  AGENT_TARGET_OCCUPIED: 'A file Bowerloom did not install is at an agent\'s place and differs from the source.',
  SLICE_LIMIT: 'This project registers more than 64 slices. Nothing was changed.',
  SLICE_PATH_MISSING: 'A folder or file that a slice names is gone.',
  SLICE_ROOT_MISSING: 'The folder that a slice names cannot be found.',
  SLICE_ROOT_UNSAFE: 'The folder that a slice names is not safe to read.',
  SLICE_SOURCE_UNSAFE: 'A file or folder that a slice selects is not safe to read.',
  SLICE_EMPTY: 'A slice selects no file.',
  SLICE_TOO_LARGE: 'A slice is larger than this beta allows.',
  SLICE_TARGET_OCCUPIED: 'Something Bowerloom did not install is where a slice index goes.',
  AGENT_GUARD_CONFLICT: 'An agent\'s hooks cannot take the read guard.',
  AGENT_GUARD_WORKTREE: 'This agent runs in a git worktree, where its read guard cannot fence the copies of slice files.',
  CONTEXT_SLICE_NOT_FOUND: 'This project registers no slice with that id.',
  CONTEXT_AGENT_NOT_FOUND: 'No team of this project holds an agent with that name.',
  CONTEXT_BASELINE_INVALID: 'The baseline folder cannot be read safely.',
  CONTEXT_MEASURE_LIMIT: 'The baseline folder is larger than this beta measures.',
  GUARD_OUTSIDE_SLICE: 'The read guard blocked a call outside the agent\'s slices.',
  GUARD_SLICE_NOT_INSTALLED: 'The read guard blocked every call, because a slice of the agent is not installed.',
  GUARD_ROOT_MISSING: 'The read guard blocked every call, because the folder of a slice cannot be found.',
  GUARD_PROJECT_MISMATCH: 'The read guard found no record of this agent for the project its copy names.',
  GUARD_INPUT_INVALID: 'The read guard could not read its input, so it blocked the call.',
  GUARD_INTERNAL_ERROR: 'The read guard hit an internal error, so it blocked the call.',
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
  // Spec 09: cache prune.
  CACHE_ENTRY_NOT_FOUND: 'No cache entry starts with that text.',
  CACHE_ENTRY_BUSY: 'Another Bowerloom command is using that cache entry.',
  CACHE_PRUNE_FAILED: 'Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted.',
} as const;

export type SyncCode = keyof typeof MESSAGES;
export const SYNC_REFUSAL_CODES: readonly SyncCode[] = Object.freeze(Object.keys(MESSAGES) as SyncCode[]);
const own = new WeakSet<object>();

/** The refusal for `code`, with its fixed message and, when given, a sentence about the item and the next command. */
export function syncError(code: SyncCode, extra?: string): DefinitionError {
  if (!Object.hasOwn(MESSAGES, code)) throw new TypeError('syncError takes a listed code only.');
  const error = new DefinitionError(code, extra ? `${MESSAGES[code]} ${extra}` : MESSAGES[code]); own.add(error); return error;
}
/**
 * Rounds 2 and 3 of the reviews of PR 101: the next step of SKILLS_OFFLINE for each real cause. Each raise site carries
 * the step of its cause, so a person is never sent back to the command that just failed in the same conditions.
 */
// Round 5 of the reviews of PR 101: a failed fetch leaves its cache operation and the private folders it made, as the
// cache keeps every operation it opened until cache prune deletes it. The next plan names a new operation, so a step that
// runs the command again says to leave out --approve and see the new plan.
export const OFFLINE_NEXT = Object.freeze({
  network: 'Connect to the network, then run the command again without --approve to see a new plan.',
  response: 'Run the command again later, without --approve, to see a new plan. If it fails again, check that the version or commit of the pin still exists on its registry.',
  nonpublic: 'Check the DNS or proxy configuration of this machine. Then run the command again without --approve to see a new plan.',
  requests: 'Check with bowerloom skills check that the pin names the package or commit you expect. If it does, report the code and the output of bowerloom --version.',
  other: 'Run the command again without --approve to see a new plan. If it fails again, report the code and the output of bowerloom --version.',
  nocode: 'Run the command again without --approve to see a new plan. If it fails again, report the error name above and the output of bowerloom --version.',
  offline: 'Run the command again without --offline and without --approve.',
  apply: 'Run bowerloom skills sync, then bowerloom apply.',
  approved: 'Run the command again without --offline and without --approve, to see a plan that fetches it.',
});
export type OfflineCause = keyof typeof OFFLINE_NEXT;
export const NETWORK_NEXT = OFFLINE_NEXT.network;
/** SKILLS_OFFLINE with the next step of its cause. */
export function offlineBecause(cause: OfflineCause, extra: string): DefinitionError {
  const error = syncError('SKILLS_OFFLINE', extra);
  Object.defineProperty(error, 'next', { value: OFFLINE_NEXT[cause], enumerable: false });
  return error;
}
/** SKILLS_OFFLINE for a fetch that failed on the network: only a transport failure. */
export const offlineNetwork = (extra: string): DefinitionError => offlineBecause('network', extra);
/**
 * Review M5 finding 2: STALE_APPROVAL after earlier children of the run applied. Its fixed message never says that
 * nothing was applied; it names the finished items, which are complete, and the item that changed.
 */
export function staleAfterApplied(done: readonly string[], id: string, rerun: string): DefinitionError {
  const error = new DefinitionError('STALE_APPROVAL', `The plan changed part way through the run: ${id} changed after the approval, so it was not applied. Finished before it: ${done.join(', ')}. Each finished item is complete. Run ${rerun} again to see the new plan.`);
  own.add(error); return error;
}
/**
 * Review H1 of PR 98: a refusal after a run already wrote something. It keeps the code (and any `next` and `cause`), drops
 * the words that say nothing was applied, names what was written, and says that the same command finishes the rest.
 * Before any write the error is returned as it is.
 */
export function partialRefusal(error: unknown, done: readonly string[], rerun: string): unknown {
  if (done.length === 0) return error;
  let code: string, base: string, cause: unknown;
  if (error instanceof DefinitionError) {
    code = error.code; cause = (error as { cause?: unknown }).cause;
    base = error.message.replace(/\s*Nothing was applied\.?/g, '').replace(/\s*Nothing in the project changed\.?/g, '').replace(/\s*Run the command again to see the new plan\.?/g, '').trim();
  } else {
    // Second security review L2: a system error after a write (EIO, EPERM, EXDEV) is a partial refusal too, with its code as the cause.
    const system = (error as { code?: unknown } | null)?.code;
    cause = typeof system === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(system) ? system : 'UNKNOWN';
    code = 'IO_ERROR'; base = `A step failed with the system error ${cause as string}.`;
  }
  const partial = new DefinitionError(code, `${base} The run stopped part way. Already written: ${done.join('; ')}. Nothing else was changed. Run ${rerun} again: its plan shows what is left and finishes it.`);
  // Second security review M1: the words of a partial refusal, and its Next line, which is the command that finishes it.
  Object.defineProperty(partial, 'hint', { value: PARTIAL_HINT, enumerable: false });
  // Round 4 of the reviews of PR 101: the next step of the cause comes first, then the command that finishes the run.
  // Round 5: a trailing "Then run ..." of the cause gives way to the command that finishes the run, so "run" is said once.
  const existing = error instanceof DefinitionError ? (error as { next?: unknown }).next : undefined;
  const step = typeof existing === 'string' ? existing.replace(/\s*Then run [^.]*\.$/, '').trim() : '';
  Object.defineProperty(partial, 'next', { value: step ? `${step} Then run ${rerun}.` : rerun, enumerable: false });
  if (cause !== undefined) Object.defineProperty(partial, 'cause', { value: cause, enumerable: false });
  own.add(partial); return partial;
}
/** The hint of a refusal after a partial write. apps/cli/src/human.ts gives it its own words. */
export const PARTIAL_HINT = 'partial' as const;
/**
 * Review M3 of PR 98: STALE_APPROVAL for a plan made again at apply that refused. The code it refused with is kept in
 * `cause` and named in the message, so the person sees what changed.
 */
export function staleBecause(error: DefinitionError): DefinitionError {
  const stale = new DefinitionError('STALE_APPROVAL', `The plan changed after you saw it: ${error.code}. ${error.message} Nothing was applied. Run the command again to see the new plan.`);
  Object.defineProperty(stale, 'cause', { value: error.code, enumerable: false });
  // Round 3 of the reviews of PR 101: the next step of the cause, which lifts it, is kept.
  const next = (error as { next?: unknown }).next;
  if (typeof next === 'string') Object.defineProperty(stale, 'next', { value: next, enumerable: false });
  own.add(stale); return stale;
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
