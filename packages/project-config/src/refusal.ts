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
  // Round 2 of the reviews of PR 100, C1: team adopt raises it too, so the words name no command.
  STORE_ITEM_NOT_FOUND: 'The command named an item that the store does not define.',
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
  // Round 2 of the reviews of PR 101: the store repository is only the copy on GitHub.
  'no-origin': 'The git repository of the store has no remote named origin.',
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
  const honest = new DefinitionError(error.code, `Bowerloom could not read ${what} and treats this project as shared${error.message.slice('This project is shared'.length)}`); own.add(honest);
  // Round 1 of the reviews of PR 101, M3: the error's own next step stays with it.
  const next = (error as { next?: unknown }).next;
  if (typeof next === 'string') Object.defineProperty(honest, 'next', { value: next, enumerable: false });
  return honest;
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
/** Round 2 of the reviews of PR 100, C2: CONFIG_ITEM_NOT_SELECTED for a team that bowerloom.json already lists from the project. */
export function teamListedFromProject(id: string): DefinitionError {
  const error = new DefinitionError('CONFIG_ITEM_NOT_SELECTED', ID.test(id) && id.length <= 64 ? `bowerloom.json already lists team ${id} from the project.` : 'bowerloom.json already lists that team from the project.'); own.add(error); return error;
}
/**
 * Rounds 1 and 2 of the reviews of PR 101: each cause and each fault of STORE_ITEM_NOT_SHAREABLE carries its own next
 * step, because the next step of the code, to give the store a remote, does not fit them. A store path is named only
 * when it is plain, inside a store area, so nothing else reaches a terminal: no control character, no space, no `..`.
 * For a path that is not plain, the line names the item folder, and for an item that is not plain, "the store item".
 */
const STORE_PATH = /^(?:skills|prompts|teams)(?:\/[A-Za-z0-9._-]+)+$/;
const plainPath = (path: string | undefined): string | null =>
  path !== undefined && path.length <= 256 && STORE_PATH.test(path) && !path.split('/').some(part => /^\.+$/.test(part)) ? `~/.bowerloom/${path}` : null;
/** The place of a fault: `path` is the store path of the file or folder, `item` the store path of the item folder. */
export type ShareProblem = 'name' | 'empty' | 'mode' | 'bom' | 'encoding' | 'link' | 'special' | 'unsafe-file' | 'unsafe-folder' | 'unreadable'
  | 'empty-folder' | 'too-deep' | 'not-folder' | 'area' | 'large' | 'count' | 'total';
export interface SharePlace { readonly problem: ShareProblem; readonly path?: string; readonly item?: string }
const AGAIN = 'Then run the command again.';
const RECORDS = 'a lock records only md, txt, json, yaml, yml, and csv files, and LICENSE and NOTICE files.';
const ADOPT = 'Or adopt a team into this project with bowerloom team adopt.';
const CAUSE_NEXT: Readonly<Record<Exclude<NotShareableCause, 'file' | 'size'>, string>> = {
  none: `Make the store a git repository and push it to a github.com repository. bowerloom store status shows the commands. ${ADOPT}`,
  'no-origin': `Add the remote origin of a github.com repository to the store and push it. bowerloom store status shows the commands. ${ADOPT}`,
  'unsupported-remote': `Point the remote origin of the store at a github.com repository. bowerloom store status shows the command. ${ADOPT}`,
  unpushed: `Push the branch of the store, or pass --commit <sha> of a pushed commit. bowerloom store status shows the command. ${ADOPT}`,
  unreadable: `Bowerloom reads the git files of the store itself. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom/.git. A store whose git uses reftable or SHA-256 cannot be read in this beta. ${ADOPT}`,
};
const GENERIC_NEXT = { file: `Find the file or folder of the item in ~/.bowerloom that a lock cannot record, and fix it. bowerloom help store lists the files a lock records. ${AGAIN}`, size: `Make the item in ~/.bowerloom smaller. bowerloom help store gives the limits. ${AGAIN}` };
/** The next step of one fault, naming its path when `plainPath` allows, else its item folder. */
export function shareNext(cause: 'file' | 'size', place?: SharePlace): string {
  if (place === undefined) return GENERIC_NEXT[cause];
  const p = plainPath(place.path), item = plainPath(place.item) ?? 'the store item';
  const sub = p ?? `A file in ${item}`;
  switch (place.problem) {
    case 'name': return p ? `If you do not need ${p}, delete it. Otherwise rename it: ${RECORDS} ${AGAIN}` : `${sub} has a name that a lock cannot record. If you do not need it, delete it. Otherwise rename it: ${RECORDS} ${AGAIN}`;
    case 'empty': return p ? `${p} is empty. Add content to it, or delete it if you do not need it. ${AGAIN}` : `${sub} is empty. Add content to it, or delete it if you do not need it. ${AGAIN}`;
    case 'mode': return p ? `Run chmod a-x ${p}. A lock records no file with an execute bit. ${AGAIN}` : `${sub} has an execute bit. Run chmod a-x on it. ${AGAIN}`;
    case 'bom': return p ? `Remove the byte order mark at the start of ${p}. ${AGAIN}` : `${sub} starts with a byte order mark. Remove it. ${AGAIN}`;
    case 'encoding': return p ? `Save ${p} as UTF-8 text. ${AGAIN}` : `${sub} is not UTF-8 text. Save it as UTF-8 text. ${AGAIN}`;
    case 'link': return `${p ?? `A file or folder in ${item}`} is a link, and a lock records no link. Put a copy of what it points to in its place. ${AGAIN}`;
    case 'special': return `${p ?? `An entry in ${item}`} is not a plain file or folder. Move it out of the item. ${AGAIN}`;
    case 'unsafe-file': return p ? `Bowerloom could not read ${p} safely. It must be a plain file that you own, with one link, closed to other users. Run ls -l ${p}. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom. ${AGAIN}`
      : `Bowerloom could not read a file in ${item} safely. Each file must be a plain file that you own, with one link, closed to other users. Run ls -la ${item}. ${AGAIN}`;
    case 'unsafe-folder': { const f = p ?? item; return `Bowerloom could not read the folder ${f} safely. It must be a real folder that you own, closed to other users, with at most 256 names. Run ls -la ${f}. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom. ${AGAIN}`; }
    case 'unreadable': { const f = p ?? item; return `Bowerloom could not read ${f}. Run ls -la ${f}, and fix what it shows. ${AGAIN}`; }
    case 'empty-folder': return `${p ?? item} is an empty folder. Add a file to it, or remove the folder. ${AGAIN}`;
    case 'too-deep': return `${p ?? `A folder in ${item}`} sits too deep in the item. A lock records at most 7 levels of folders inside an item. Move its files up. ${AGAIN}`;
    case 'not-folder': return `${item} is not a real folder that you own. Run ls -ld ${item}. ${AGAIN}`;
    case 'area': { const a = place.path !== undefined && /^(?:skills|prompts|teams)$/.test(place.path) ? `~/.bowerloom/${place.path}` : 'A folder of the store'; return `${a} is a link or not a real folder of the store. Make it a real folder in ~/.bowerloom. ${AGAIN}`; }
    case 'large': return `${p ?? `A file in ${item}`} is larger than 65536 bytes, the most a lock records for one file. Make it smaller, or split it into smaller files. ${AGAIN}`;
    case 'count': return `${item} holds more than 126 files, the most a lock records for one item. Remove files from it. ${AGAIN}`;
    case 'total': return `${item} holds more than 2 MiB, the most a lock records for one item. Make it smaller. ${AGAIN}`;
  }
}
/**
 * STORE_ITEM_NOT_SHAREABLE with the sentence of its cause and a next step of its own. For `file` and `size`, `place` says
 * which file or folder and what is wrong with it.
 */
export function notShareable(cause: NotShareableCause, place?: SharePlace): DefinitionError {
  const error = new DefinitionError('STORE_ITEM_NOT_SHAREABLE', `${MESSAGES.STORE_ITEM_NOT_SHAREABLE} ${NOT_SHAREABLE[cause]}`); own.add(error);
  const next = cause === 'file' || cause === 'size' ? shareNext(cause, place) : CAUSE_NEXT[cause];
  Object.defineProperty(error, 'next', { value: next, enumerable: false });
  return error;
}
/**
 * Round 2 of the reviews of PR 101: in a project that is not shared, a lock update still checks each item it records, and
 * the words say so instead of "This project is shared". Any other error is returned as it is.
 */
export function notSharedYet(error: unknown): unknown {
  const prefix = `${MESSAGES.STORE_ITEM_NOT_SHAREABLE} `;
  if (!(error instanceof DefinitionError) || !own.has(error) || error.code !== 'STORE_ITEM_NOT_SHAREABLE' || !error.message.startsWith(prefix)) return error;
  const plain = new DefinitionError(error.code, `A lock records this item, and a teammate cannot fetch it. ${error.message.slice(prefix.length)}`); own.add(plain);
  const next = (error as { next?: unknown }).next;
  if (typeof next === 'string') Object.defineProperty(plain, 'next', { value: next, enumerable: false });
  return plain;
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
