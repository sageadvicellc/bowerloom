/**
 * The fixed refusals of `bowerloom.json` and `bowerloom.lock.json`. Internal to packages/project-config.
 * CONFIG_UNSAFE lives with the guards that raise it, in packages/project-context/src/refusal.ts.
 * A message never carries a path. Three codes may name checked items, which are plain words of at most 64 characters:
 * CONFIG_DUPLICATE_ID names the kind and the id, LOCK_CONFIG_MISMATCH names up to 8 `kind id` pairs, and
 * STORE_ITEM_NOT_SHAREABLE adds one fixed sentence about the cause (spec 06, section 5).
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  CONFIG_INVALID: 'bowerloom.json does not match the project config format.',
  CONFIG_LIMIT: 'bowerloom.json lists too many items.',
  CONFIG_DUPLICATE_ID: 'bowerloom.json lists an item twice.',
  // Spec 06, section 5.
  CONFIG_ITEM_SELECTED: 'bowerloom use named an item that bowerloom.json already lists from that source.',
  CONFIG_ITEM_NOT_SELECTED: 'The command named an item that bowerloom.json does not list, or there is no bowerloom.json.',
  CONFIG_ITEM_MISSING: 'bowerloom.json lists a project item that has no definition in the project.',
  CONFIG_WRITE_UNCONFIRMED: 'bowerloom.json was written, but it changed before it was read back.',
  STORE_ITEM_NOT_FOUND: 'bowerloom use named an item that the store does not define.',
  STORE_ITEM_MISSING: 'A listed store item is not in the store and not in the lock.',
  STORE_ITEM_NOT_SHAREABLE: 'This project is shared, and a teammate cannot fetch this store item.',
  STORE_REMOTE_PRIVATE: 'The store repository answered 404. It is private or does not exist.',
  TEAM_NOT_SELECTED: 'bowerloom up --team named a team that bowerloom.json does not list.',
  LOCK_MISSING: 'A frozen run needs bowerloom.lock.json, and the file is absent.',
  LOCK_INVALID: 'bowerloom.lock.json does not parse, has conflict markers, or a hash does not match its files.',
  LOCK_UNSAFE: 'bowerloom.lock.json is a link, can be changed by others, has more than one link, or cannot be read.',
  LOCK_LIMIT: 'bowerloom.lock.json passes a limit: 128 skills, 128 prompts, 32 teams, 126 files in an item, 65536 bytes in a file, 2097152 bytes in an item, or 4 MiB in the lock.',
  LOCK_CONFIG_MISSING: 'A lock exists with no bowerloom.json, or a frozen run has no bowerloom.json.',
  LOCK_CONFIG_MISMATCH: 'bowerloom.lock.json and bowerloom.json list different store items.',
  LOCK_HASH_MISMATCH: 'The fetched bytes of an authored item do not match the hash in bowerloom.lock.json.',
  LOCK_STORE_NOT_PUSHED: 'The pushed copy of an item differs from the item in your store.',
  LOCK_COMMIT_UNREACHABLE: 'The commit is not on the store remote.',
  LOCK_WRITE_UNCONFIRMED: 'bowerloom.lock.json was written, but it changed before it was read back.',
  // Review of PR 94.
  STORE_ITEM_GONE_AT_COMMIT: 'The locked commit does not hold this item.',
  GITHUB_REQUEST_BUDGET: 'This run would make more GitHub requests than Bowerloom allows in one run.',
  // Spec 08, section 5: store migrate. The message is the Cause cell; UNSUPPORTED adds its reason and TEAM_MISSING names the team.
  MIGRATE_ITEM_NOT_FOUND: 'A selected item is not defined in the project, or its files are gone.',
  MIGRATE_ITEM_UNSUPPORTED: 'A selected skill or prompt cannot be a store item.',
  MIGRATE_ID_EXISTS: 'The store already holds an item with that kind and id but other bytes.',
  MIGRATE_RESERVED: 'first-team or personal-assistant was named. Setup owns them.',
  MIGRATE_TEAM_MISSING: 'A skill or prompt is limited to a team that is not in the store and not in this run.',
  MIGRATE_LIMIT: 'The store record of created items holds 512 items at most.',
} as const;

export type ConfigRefusalCode = keyof typeof MESSAGES;
export const CONFIG_REFUSAL_CODES: readonly ConfigRefusalCode[] = Object.freeze(Object.keys(MESSAGES) as ConfigRefusalCode[]);
/** The added sentence of STORE_ITEM_NOT_SHAREABLE, one per cause (spec 06, 3.10 and section 5). */
export const NOT_SHAREABLE = Object.freeze({
  none: 'The store is not a git repository.',
  'no-origin': 'The store repository has no remote named origin.',
  'unsupported-remote': 'The store remote is not a github.com repository.',
  unreadable: 'Bowerloom cannot read the git files of the store.',
  unpushed: 'The store has no pushed commit for this branch.',
  file: 'The item holds a file that a lock cannot record.',
  size: 'The item is larger than a lock can record.',
});
export type NotShareableCause = keyof typeof NOT_SHAREABLE;

// Membership is the error object itself: only configRefusal adds to it.
const own = new WeakSet<object>();
const KIND_ID = /^(?:skill|prompt|team) [a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The refusal for `code`. `message` replaces the fixed one only for CONFIG_DUPLICATE_ID, which names the item. */
export function configRefusal(code: ConfigRefusalCode, message?: string): DefinitionError {
  if (!Object.hasOwn(MESSAGES, code)) throw new TypeError('configRefusal takes a listed code only.');
  const error = new DefinitionError(code, code === 'CONFIG_DUPLICATE_ID' && message !== undefined ? message : MESSAGES[code]); own.add(error); return error;
}
/**
 * Second review M2: a refusal that a shared state caused, when that state is only unknown, says so: "Bowerloom could not
 * read <what> and treats this project as shared" in place of "This project is shared". Any other error is returned as it is.
 */
export function honestShared(error: unknown, what: string): unknown {
  if (!(error instanceof DefinitionError) || !own.has(error) || !error.message.startsWith('This project is shared')) return error;
  const honest = new DefinitionError(error.code, `Bowerloom could not read ${what} and treats this project as shared${error.message.slice('This project is shared'.length)}`); own.add(honest); return honest;
}
/** Spec 08, section 5: the reason MIGRATE_ITEM_UNSUPPORTED adds, one per fault of `localItemRows`. */
export const MIGRATE_REASON = Object.freeze({ file: 'It holds a file that a store item cannot hold.', size: 'It is larger than a store item can be.' });
export type MigrateReason = keyof typeof MIGRATE_REASON;
/** MIGRATE_ITEM_UNSUPPORTED with its reason. */
export function migrateUnsupported(reason: MigrateReason): DefinitionError {
  const error = new DefinitionError('MIGRATE_ITEM_UNSUPPORTED', `${MESSAGES.MIGRATE_ITEM_UNSUPPORTED} ${MIGRATE_REASON[reason]}`); own.add(error); return error;
}
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** MIGRATE_TEAM_MISSING naming the team. The name is checked, so no other text gets in. */
export function migrateTeamMissing(team: string): DefinitionError {
  const error = new DefinitionError('MIGRATE_TEAM_MISSING', ID.test(team) && team.length <= 64 ? `${MESSAGES.MIGRATE_TEAM_MISSING} The team is ${team}.` : MESSAGES.MIGRATE_TEAM_MISSING); own.add(error); return error;
}
/** STORE_ITEM_NOT_SHAREABLE with the sentence of its cause. */
export function notShareable(cause: NotShareableCause): DefinitionError {
  const error = new DefinitionError('STORE_ITEM_NOT_SHAREABLE', `${MESSAGES.STORE_ITEM_NOT_SHAREABLE} ${NOT_SHAREABLE[cause]}`); own.add(error); return error;
}
/** LOCK_CONFIG_MISMATCH naming up to 8 `kind id` pairs, then `and <n> more`. Each pair is checked, so no other text gets in. */
export function lockMismatch(pairs: readonly string[]): DefinitionError {
  const shown = pairs.filter(p => KIND_ID.test(p)), head = shown.slice(0, 8).join(', '), more = shown.length > 8 ? `, and ${shown.length - 8} more` : '';
  const error = new DefinitionError('LOCK_CONFIG_MISMATCH', shown.length ? `${MESSAGES.LOCK_CONFIG_MISMATCH} ${head}${more}.` : MESSAGES.LOCK_CONFIG_MISMATCH); own.add(error); return error;
}
/**
 * Review C5: the refusal for `code` with its own next step, carried as the property `next` and never in the message, so
 * the plain words print one Next: line, as SKILLS_OFFLINE's held items do.
 */
export function refusalWithNext(code: ConfigRefusalCode, next: string): DefinitionError {
  const error = configRefusal(code);
  Object.defineProperty(error, 'next', { value: next, enumerable: false });
  return error;
}
export function refuse(code: ConfigRefusalCode, message?: string): never { throw configRefusal(code, message); }
export const isConfigRefusal = (error: unknown): error is DefinitionError & { code: ConfigRefusalCode } =>
  error instanceof DefinitionError && (CONFIG_REFUSAL_CODES as readonly string[]).includes(error.code);
