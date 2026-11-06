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
  const error = new DefinitionError(code, code === 'CONFIG_DUPLICATE_ID' && message !== undefined ? message : code === 'CONFIG_INVALID' && message !== undefined ? `${MESSAGES[code]} ${message}` : MESSAGES[code]); own.add(error);
  // The sentence a CONFIG_INVALID adds (which engine id is wrong) travels with the error, so a reader can pass it on.
  if (code === 'CONFIG_INVALID' && message !== undefined) Object.defineProperty(error, 'detail', { value: message, enumerable: false });
  return error;
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
export const MIGRATE_REASON = Object.freeze({ file: 'It holds a file that a store item cannot hold.', size: 'It is larger than a store item can be.', unreadable: 'Bowerloom could not read all of it safely.', names: 'It holds names that Bowerloom does not read.',
  // Round 5 of the reviews of PR 101: the faults that are not about the content of a file.
  folder: 'It holds a folder that a store item cannot hold.', notfolder: 'It is not a real folder that you own.', area: 'It sits in a folder of .bowerloom that is a link or not a real folder.', link: 'It holds a link or a special file that a store item cannot hold.', empty: 'It holds an empty file, which a store item cannot hold.', count: 'It holds more files than a store item can hold.' });
export type MigrateReason = keyof typeof MIGRATE_REASON;
/** MIGRATE_ITEM_UNSUPPORTED with its reason. */
export function migrateUnsupported(reason: MigrateReason, next?: string): DefinitionError {
  const error = new DefinitionError('MIGRATE_ITEM_UNSUPPORTED', `${MESSAGES.MIGRATE_ITEM_UNSUPPORTED} ${MIGRATE_REASON[reason]}`); own.add(error);
  // Round 3 of the reviews of PR 101: the next step of the fault, which names the file and its fix.
  if (next !== undefined) Object.defineProperty(error, 'next', { value: next, enumerable: false });
  return error;
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
// Round 4: an area folder alone (`skills`) is a plain path too.
const STORE_PATH = /^(?:skills|prompts|teams)(?:\/[A-Za-z0-9._-]+)*$/;
/** Round 3: the folder a path is shown under. The store, or the `.bowerloom` of a project for `store migrate`. */
export type ShareRoot = '~/.bowerloom' | '.bowerloom';
const plainPath = (path: string | undefined, root: ShareRoot): string | null =>
  path !== undefined && path.length <= 256 && STORE_PATH.test(path) && !path.split('/').some(part => /^\.+$/.test(part)) ? `${root}/${path}` : null;
/** The place of a fault: `path` is the store path of the file or folder, `item` the store path of the item folder. */
export type ShareProblem = 'name' | 'folder-name' | 'names' | 'too-many' | 'empty' | 'mode' | 'bom' | 'encoding' | 'link' | 'special' | 'unsafe-file' | 'unsafe-folder' | 'unreadable'
  | 'empty-folder' | 'too-deep' | 'not-folder' | 'area' | 'large' | 'count' | 'total';
export interface SharePlace { readonly problem: ShareProblem; readonly path?: string; readonly item?: string; readonly root?: ShareRoot; /** The most files a lock records in one item, for the step of 'too-many'. */ readonly files?: number }
const AGAIN = 'Then run the command again.';
// Round 3: the rules of skillFilePath (packages/skill-sources/src/validation.ts, relativeSkillPath).
const NAMES = 'A name holds only letters, digits, dots, dashes, and underscores, and does not start with a dot. The first name in the item starts with a letter or a digit.';
const RECORDS = `${NAMES} A lock records only files whose names end in .md, .txt, .json, .yaml, .yml, or .csv, and LICENSE and NOTICE files.`;
const ADOPT = 'Or adopt a team into this project with bowerloom team adopt.';
const CAUSE_STEP: Readonly<Record<Exclude<NotShareableCause, 'file' | 'size'>, string>> = {
  none: 'Make the store a git repository and push it to a github.com repository. bowerloom store status shows the commands.',
  'no-origin': 'Add the remote origin of a github.com repository to the store and push it. bowerloom store status shows the commands.',
  'unsupported-remote': 'Point the remote origin of the store at a github.com repository. bowerloom store status shows the command.',
  unpushed: 'Push the branch of the store, or pass --commit <sha> of a pushed commit. bowerloom store status shows the command.',
  unreadable: 'Bowerloom reads the git files of the store itself. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom/.git. A store whose git uses reftable or SHA-256 cannot be read in this beta.',
};
/** The next step of a store repository cause. `adopt` adds the way out through team adopt, which store migrate does not offer. */
export const causeNext = (cause: Exclude<NotShareableCause, 'file' | 'size'>, adopt = true): string => adopt ? `${CAUSE_STEP[cause]} ${ADOPT}` : CAUSE_STEP[cause];
const GENERIC_NEXT = { file: `Find the file or folder of the item in ~/.bowerloom that a lock cannot record, and fix it. bowerloom help store lists the files a lock records. ${AGAIN}`, size: `Make the item in ~/.bowerloom smaller. bowerloom help store gives the limits. ${AGAIN}` };
/** The next step of one fault, naming its path when `plainPath` allows, else its item folder. */
export function shareNext(cause: 'file' | 'size', place?: SharePlace): string {
  if (place === undefined) return GENERIC_NEXT[cause];
  const root: ShareRoot = place.root === '.bowerloom' ? '.bowerloom' : '~/.bowerloom';
  const p = plainPath(place.path, root), item = plainPath(place.item, root) ?? 'the store item';
  // Round 4 of the reviews of PR 101: a path under the .bowerloom of a project is relative to the project folder.
  const run = (command: string): string => root === '.bowerloom' ? `In the project folder, run ${command}.` : `Run ${command}.`;
  // Round 5: a command needs a real path. With no plain path to name, the step gives no command (ls -la the store item).
  const runOn = (command: string, target: string): string => target === 'the store item' ? '' : `${run(`${command} ${target}`)} `;
  // Round 6: a sentence that starts with the item starts with a capital, as when the item has no plain path.
  const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  const sub = p ?? `A file in ${item}`;
  switch (place.problem) {
    case 'name': return p ? `If you do not need ${p}, delete it. Otherwise rename it. ${RECORDS} ${AGAIN}` : `${sub} has a name that a lock cannot record. If you do not need it, delete it. Otherwise rename it. ${RECORDS} ${AGAIN}`;
    case 'folder-name': return `${p ?? `A folder in ${item}`} is a folder whose name a lock cannot record. ${NAMES} Rename the folder, or move its files out of it. ${AGAIN}`;
    case 'names': { const f = p ?? item; return `${cap(f)} holds two names that differ only in case or Unicode form, or a name with a backslash, a control or format character, or more than 255 characters. Rename them. ${AGAIN}`; }
    case 'too-many': { const f = p ?? item; return `${cap(f)} holds more than 256 names, the most Bowerloom reads in one folder. Remove names from it until it holds 256 or fewer.${place.files !== undefined ? ` A lock records at most ${place.files} files in one item.` : ''} ${AGAIN}`; }
    case 'empty': return p ? `${p} is empty. Add content to it, or delete it if you do not need it. ${AGAIN}` : `${sub} is empty. Add content to it, or delete it if you do not need it. ${AGAIN}`;
    case 'mode': return p ? `${run(`chmod a-x ${p}`)} A lock records no file with an execute bit. ${AGAIN}` : `${sub} has an execute bit. Run chmod a-x on it. ${AGAIN}`;
    case 'bom': return p ? `Remove the byte order mark at the start of ${p}. ${AGAIN}` : `${sub} starts with a byte order mark. Remove it. ${AGAIN}`;
    case 'encoding': return p ? `Save ${p} as UTF-8 text. ${AGAIN}` : `${sub} is not UTF-8 text. Save it as UTF-8 text. ${AGAIN}`;
    case 'link': return `${p ?? `A file or folder in ${item}`} is a link, and a lock records no link. Put a copy of what it points to in its place. ${AGAIN}`;
    case 'special': return `${p ?? `An entry in ${item}`} is not a plain file or folder. Move it out of the item. ${AGAIN}`;
    case 'unsafe-file': return p ? `Bowerloom could not read ${p} safely. It must be a plain file that you own, with one link, closed to other users. ${run(`ls -l ${p}`)} If it was made under umask 002, ${root === '.bowerloom' ? 'in the project folder, ' : ''}run chmod -R go-w ${root}. ${AGAIN}`
      : `Bowerloom could not read a file in ${item} safely. Each file must be a plain file that you own, with one link, closed to other users. ${runOn('ls -la', item)}${AGAIN}`;
    case 'unsafe-folder': { const f = p ?? item; return `Bowerloom could not read ${f === 'the store item' ? 'a folder of the store item' : `the folder ${f}`} safely. It must be a real folder that you own, closed to other users. ${runOn('ls -ld', f)}If it was made under umask 002, ${root === '.bowerloom' ? 'in the project folder, ' : ''}run chmod -R go-w ${root}. ${AGAIN}`; }
    case 'unreadable': { const f = p ?? item; return f === 'the store item' ? `Bowerloom could not read the store item. Give yourself read access to the files of the item. ${AGAIN}` : `Bowerloom could not read ${f}. ${runOn('ls -la', f)}Give yourself read access to what it shows. ${AGAIN}`; }
    case 'empty-folder': return `${cap(p ?? item)} is an empty folder. Add a file to it, or remove the folder. ${AGAIN}`;
    case 'too-deep': return `${p ?? `A folder in ${item}`} sits too deep in the item. A lock records at most 7 levels of folders inside an item. Move its files up. ${AGAIN}`;
    case 'not-folder': return `${cap(item)} is not a real folder that you own. ${runOn('ls -ld', item)}${AGAIN}`;
    case 'area': { const a = place.path !== undefined && /^(?:skills|prompts|teams)$/.test(place.path) ? `${root}/${place.path}` : 'A folder of the store'; return `${a} is a link or not a real folder. Make it a real folder in ${root}. ${AGAIN}`; }
    case 'large': return `${p ?? `A file in ${item}`} is larger than 65536 bytes, the most a lock records for one file. Make it smaller, or split it into smaller files. ${AGAIN}`;
    case 'count': return `${cap(item)} holds more than 126 files, the most a lock records for one item. Remove files from it. ${AGAIN}`;
    case 'total': return `${cap(item)} holds more than 2 MiB, the most a lock records for one item. Make it smaller. ${AGAIN}`;
  }
}
/**
 * STORE_ITEM_NOT_SHAREABLE with the sentence of its cause and a next step of its own. For `file` and `size`, `place` says
 * which file or folder and what is wrong with it.
 */
export function notShareable(cause: NotShareableCause, place?: SharePlace): DefinitionError {
  const error = new DefinitionError('STORE_ITEM_NOT_SHAREABLE', `${MESSAGES.STORE_ITEM_NOT_SHAREABLE} ${NOT_SHAREABLE[cause]}`); own.add(error);
  const next = cause === 'file' || cause === 'size' ? shareNext(cause, place) : causeNext(cause);
  Object.defineProperty(error, 'next', { value: next, enumerable: false });
  // Round 4: the fault, so store migrate names it in words of its own.
  if (place !== undefined) Object.defineProperty(error, 'problem', { value: place.problem, enumerable: false });
  return error;
}
/** Round 5 of the reviews of PR 101: the last sentence of the next step of a store fault found at approval time. */
export const APPROVAL_NOTE = 'If you also changed the item, run the command again without --approve.';
/**
 * Rounds 6 and 7: the last sentence of the step of a store repository cause at approval time. Fixing the store (a push,
 * a new remote, or new modes) changes the plan, so the same --approve is stale. It comes last, so "Or adopt a team" stays
 * an alternative to fixing the store, not to running again.
 */
export const APPROVAL_REPO_NOTE = 'After you fix the store, run the command again without --approve.';
/**
 * A store fault found at approval time (decided in round 4): it surfaces as it is, because once the fault is fixed the
 * same --approve works, unless the item also changed. Its next step says so. Any other error is returned as it is.
 */
export function atApproval(error: unknown): unknown {
  if (!(error instanceof DefinitionError) || !own.has(error) || error.code !== 'STORE_ITEM_NOT_SHAREABLE') return error;
  const next = (error as { next?: unknown }).next, problem = (error as { problem?: unknown }).problem;
  if (typeof next !== 'string' || next.endsWith(APPROVAL_NOTE) || next.includes(APPROVAL_REPO_NOTE)) return error;
  // Round 6 of the reviews of PR 101: the item note fits a fault of an item only. A cause of the store repository
  // (none, no-origin, unsupported-remote, unpushed, unreadable) is fixed by a change that changes the plan.
  let value: string;
  if (problem !== undefined) value = `${next} ${APPROVAL_NOTE}`;
  else {
    value = `${next.replace(/\s*Then run the command again\.$/, '')} ${APPROVAL_REPO_NOTE}`;
  }
  const noted = new DefinitionError(error.code, error.message); own.add(noted);
  Object.defineProperty(noted, 'next', { value, enumerable: false });
  if (problem !== undefined) Object.defineProperty(noted, 'problem', { value: problem, enumerable: false });
  return noted;
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
