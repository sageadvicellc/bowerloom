/**
 * `bowerloom store migrate` (spec 08, 3.1 to 3.3, sageadvicellc/bowerloom#80 phase 7). It copies chosen skills, prompts,
 * and teams from a project's `.bowerloom` to the store, `~/.bowerloom`, then lists them with the source store in
 * bowerloom.json, and in a shared project adds their lock items. It deletes nothing (decision 6), and it changes no
 * project file but bowerloom.json and bowerloom.lock.json.
 *
 * A plan reads only. In a shared project it reads api.github.com to prove the pushed copy of a written item that is
 * already in the store, and only then reads the token (spec 07). Apply reads no network: under the store lock, then the
 * project lock, it makes the plan again from the files (with the proofs the plan bound) and refuses STALE_APPROVAL for
 * any difference, then copies through a staging folder, adds the skills.json entries, writes the store receipt once,
 * and writes bowerloom.json and the lock. Every step is safe to repeat (3.2).
 *
 * The existing `migrate.ts` is `skills migrate`, for the older install format. This module is not that one.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DefinitionError, canonicalJson } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { adoptCreatedMarker, inspectStore, isHeldProjectLock, projectRefusal, storeRootOf, verifyProjectPins, verifyStorePins, withProjectLock, withStoreForWrite } from '../../project-context/src/index.js';
import type { StoreContext } from '../../project-context/src/index.js';
import type { DirectoryIdentity, HeldProjectLock, PinnedDirectory, ProjectContext } from '../../project-context/src/types.js';
import { LIMITS, lstatOrNull, makeFolder, readGuarded, readTree, realFolder, removeScratch, syncFolder, writeNewFile } from '../../project-authoring/src/files.js';
import type { FilePin } from '../../project-authoring/src/files.js';
import { authoringRefusal, refuse as authoringRefuse } from '../../project-authoring/src/refusal.js';
import { AUTHORING_FOLDER, itemPath, readAuthoringState, receiptOf, recordText, stageName } from '../../project-authoring/src/state.js';
import type { AuthoredItem, AuthoringState } from '../../project-authoring/src/state.js';
import { writeReceiptRecord } from '../../project-authoring/src/receipt-write.js';
import { readConfig } from '../../project-config/src/config.js';
import { CONFIG_FILE, serializeConfig } from '../../project-config/src/schema.js';
import type { ConfigEntry, ProjectConfig } from '../../project-config/src/schema.js';
import { LOCK_FILE, LOCK_FORMAT, LOCK_LISTS, lockAgrees, lockItem, lockSourceLabel, parseLock, readLock, serializeLock } from '../../project-config/src/lock.js';
import type { LockItem, ProjectLock } from '../../project-config/src/lock.js';
import { MIGRATE_REASON, NOT_SHAREABLE, configRefusal, honestShared, lockMismatch, migrateTeamMissing, migrateUnsupported, refusalWithNext } from '../../project-config/src/refusal.js';
import type { MigrateReason } from '../../project-config/src/refusal.js';
import { isSharedProject } from '../../project-config/src/shared.js';
import { readStoreRepo } from '../../project-config/src/git.js';
import { writeGuardedFile } from '../../project-config/src/write.js';
import { applyManifestChange, manifestAfter, planManifestChange, readManifestState, storeTarget } from '../../skill-manifest/src/add.js';
import { MANIFEST_LIMITS, STORE_MANIFEST_LIMITS, parseManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, Manifest, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { createPublicTransport } from '../../skill-manifest/src/public-get.js';
import { proveAuthored } from '../../skill-manifest/src/resolve-store-git.js';
import { GithubToken } from '../../skill-manifest/src/github-token.js';
import { initialConfig, NETWORK_LINE, NO_TOKEN_LINE, requestCount, scratchFiles } from './change.js';
import { localItemRows } from './store-items.js';
import { TOKEN_STALE_NOTE, credentialsFor, onceTokenSource, repositoryOf, requireRequestBudget } from './store-git.js';
import type { Credentials, StoreTransportFactory, TokenSource } from './store-git.js';
import { offlineNetwork, PARTIAL_HINT, partialRefusal, staleBecause, syncError } from './refusal.js';

export const STORE_MIGRATE_PLAN_FORMAT = 'bowerloom/store-migrate-plan/v1beta1' as const;
export const STORE_MIGRATE_RESULT_FORMAT = 'bowerloom/store-migrate-result/v1beta1' as const;
type Kind = 'skill' | 'prompt' | 'team';
export interface Read { sha256: string; bytes: number }
const KINDS: readonly Kind[] = ['skill', 'prompt', 'team'];
const LIST = { skill: 'skills', prompt: 'prompts', team: 'teams' } as const;
const FOLDER_ORDER = ['authoring', 'skills', 'prompts', 'teams'] as const;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, HEX40 = /^[a-f0-9]{40}$/;
const FIRST_TEAM = 'first-team', ASSISTANT = 'personal-assistant';
const sha = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const kindOrder = (a: { kind: Kind; id: string }, b: { kind: Kind; id: string }): number => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || byteOrder(a.id, b.id);
const stale = (note?: string): Error => note === undefined ? manifestRefusal('STALE_APPROVAL') : syncError('STALE_APPROVAL', note);
const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const pairOf = (i: { kind: string; id: string }): string => `${i.kind} ${i.id}`;
/** The sentence of a copy-only item that is new in the store (rule 9). */
export const NEW_IN_STORE = 'It is new in your store and not pushed yet';
const FIX = 'Fix this, then run this command again';

export interface MigrateItem {
  kind: Kind; id: string;
  /** `pinned` only for a skill with an npm or git entry. */
  how: 'pinned' | 'local';
  state: 'copy' | 'register' | 'present';
  /** Review C1 of PR 98: true when the store record of created items lists the item already. No second record is written. */
  recorded: boolean;
  /** True when the config entry changes to store in this run. */
  switch: boolean;
  notSwitched: { code: string; sentence: string } | null;
  /** The item's team tag. */
  teams: string[];
  /** The pins of the item's files, relative to `.bowerloom` and to the store alike. Empty for a pinned skill. */
  files: FilePin[];
  /** The skills.json entry, for a skill. */
  entry: Entry | null;
  /** The compiled candidate of a team. */
  candidate: string | null;
  /** The lock source label, when a lock item is added. */
  lock: string | null;
}
export interface StoreMigratePlan {
  format: typeof STORE_MIGRATE_PLAN_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity | null };
  store: { create: boolean; dir: string; identity: DirectoryIdentity | null; skills: Read | null; authoring: Read | null };
  shared: boolean;
  /** What the person asked for. Apply makes the plan again from it. */
  selectors: { skills: string[]; prompts: string[]; teams: string[]; all: boolean; commit: string | null };
  items: MigrateItem[];
  /** The items `--all` leaves in the project, each with the words of its plan line. */
  skipped: { kind: Kind; id: string; line: string }[];
  /** Store folders to create, in order. */
  folders: string[];
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  /** `adds` names the items the config did not list, which this run adds as store entries. */
  config: { before: Read | null; after: Read; text: string; created: boolean; adds: string[] } | null;
  lock: { before: Read | null; after: Read; text: string } | null;
  /** Store scratch. */
  scratch: string[];
  /** Project config and lock scratch. */
  projectScratch: string[];
  network: { hosts: string[]; credentials: Credentials | null };
  /** The commit the lock items use. */
  commit: string | null;
  /** The Network:, rate and unpushed-HEAD lines of a proof (spec 06 and 07). */
  notes: string[];
  /** The `<kind> <id>` pairs where the lock disagrees with bowerloom.json, in a shared project. */
  staleLock: string[];
  /** The lines printed after the plan: the git rm lines, then the skills.json reminders. */
  removeLines: string[];
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface StoreMigrateResult {
  format: typeof STORE_MIGRATE_RESULT_FORMAT; planRevision: string;
  /** Review M2 of PR 98: the items that switched to the store in this run. */
  moved: { kind: Kind; id: string; state: MigrateItem['state'] }[];
  /** The items copied or recorded in the store that did not switch. */
  copied: { kind: Kind; id: string; state: MigrateItem['state'] }[];
  notSwitched: { kind: Kind; id: string; code: string }[];
  /** The items the plan left in the project, with their lines. */
  skipped: StoreMigratePlan['skipped'];
  /** True when every chosen item switched and none was left in the project. */
  complete: boolean;
  configSha256: string | null; configBytes: number | null; lockSha256: string | null; lockBytes: number | null;
  removeLines: string[]; executionAuthorized: false;
}
export interface MigrateInput {
  project: ProjectContext; home: string;
  selectors: { skills: string[]; prompts: string[]; teams: string[] };
  all: boolean; commit: string | null;
  /** Spec 07: the token, or the CLI's reader. Read only when a written item's pushed copy is proved. */
  githubToken: TokenSource;
  storeTransport?: StoreTransportFactory;
  signal: AbortSignal;
}
/** Test hooks. Product code passes nothing. */
export interface MigrateHooks {
  afterStep?(n: 3 | 4 | 5 | 7): void;
  afterItem?(kind: string, id: string): void;
  locked?(name: 'store' | 'project'): void;
  /** After an item is staged and before it is checked and moved: `dir` is the staged item. */
  afterStage?(kind: string, id: string, dir: string): void;
}
export interface MigrateDeps { signal: AbortSignal; githubToken: GithubToken | null; project: ProjectContext; home: string; hooks?: MigrateHooks }

/** The selection as given: every id a plain id, no id twice, and `--all` alone. Throws USAGE. The CLI calls it before it looks for the project. */
export function checkMigrateSelectors(input: Pick<MigrateInput, 'selectors' | 'all' | 'commit'>): void { checkSelectors(input); }
function checkSelectors(input: Pick<MigrateInput, 'selectors' | 'all' | 'commit'>): void {
  const s = input.selectors;
  if (s === null || typeof s !== 'object' || ![s.skills, s.prompts, s.teams].every(Array.isArray)) usage('Use bowerloom store migrate with --skill, --prompt, --team, or --all.');
  const named = s.skills.length + s.prompts.length + s.teams.length;
  if (input.all !== true && named === 0) usage('Name at least one item with --skill, --prompt, or --team, or pass --all.');
  if (input.all === true && named > 0) usage('Use --all alone, or name the items with --skill, --prompt, and --team.');
  for (const list of [s.skills, s.prompts, s.teams]) {
    if (!list.every(id => typeof id === 'string' && ID.test(id) && id.length <= 64)) usage('An item id is lower-case letters, digits and single hyphens, at most 64 characters.');
    if (new Set(list).size !== list.length) usage('Name each item once.');
  }
  if (input.commit !== null && (typeof input.commit !== 'string' || !HEX40.test(input.commit))) usage('Use --commit with the 40 lower-case hex characters of a pushed commit.');
}

/** The store as one plan reads it. `context` is null when the store is absent (or was just made, at apply). */
interface StoreState {
  create: boolean; dir: string; context: StoreContext | null;
  manifest: Manifest | null; manifestRead: Read | null;
  auth: AuthoringState;
}
function readStore(dir: string, context: StoreContext | null, create: boolean): StoreState {
  if (context === null || create) return { create, dir, context: create ? null : context, manifest: null, manifestRead: null, auth: { folder: false, receipt: null, pending: null, scratch: [] } };
  verifyStorePins(context);
  const state = readManifestState(storeTarget(context.dir), { allowAbsent: true });
  const manifest = state.file ? parseManifest(state.file.bytes, STORE_MANIFEST_LIMITS) : null;
  const auth = readAuthoringState(context.dir);
  return { create, dir, context, manifest, manifestRead: state.file ? { sha256: state.file.sha256, bytes: state.file.bytes.length } : null, auth };
}

/** One project item that may move, with what the plan needs of it. */
interface Found { kind: Kind; id: string; how: 'pinned' | 'local'; entry: Entry | null; teams: string[]; files: FilePin[]; candidate: string | null; explicit: boolean; inReceipt: boolean }
const localEntry = (id: string, teams: readonly string[]): Entry => ({ id, ...(teams.length ? { teams: [...teams] } : {}), source: { kind: 'local', path: `skills/${id}` } }) as Entry;
/** The pins of an item under `base` (a `.bowerloom` folder or the store): every file of a folder, or the prompt file. */
function pinsUnder(base: string, kind: Kind, id: string): FilePin[] {
  if (kind === 'prompt') { const bytes = readGuarded(join(base, itemPath('prompt', id)), LIMITS.fileBytes); return [{ path: itemPath('prompt', id), sha256: sha(bytes), bytes: bytes.length }]; }
  return readTree(base, itemPath(kind, id));
}
const samePins = (a: readonly FilePin[], b: readonly FilePin[]): boolean => canonicalJson(a) === canonicalJson(b);
/**
 * The pins of a store item. Second security review L1: a stop between a prompt's link and its stage unlink leaves the
 * stage copy as the prompt's second link, so that one path is allowed, as `create` allows it, and the next run finishes
 * the item. Any other unsafe path refuses AUTHORING_UNSAFE_PATH naming it, with a next step that looks at the store.
 */
function storePins(storeDir: string, scratch: readonly string[], kind: Kind, id: string): FilePin[] {
  try {
    if (kind !== 'prompt') return readTree(storeDir, itemPath(kind, id));
    const at = join(storeDir, itemPath('prompt', id));
    const stage = scratch.filter(n => n.startsWith('.stage-')).map(n => join(storeDir, AUTHORING_FOLDER, n, itemPath('prompt', id))).find(p => lstatOrNull(p) !== null) ?? null;
    const bytes = readGuarded(at, LIMITS.fileBytes, stage);
    return [{ path: itemPath('prompt', id), sha256: sha(bytes), bytes: bytes.length }];
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'AUTHORING_UNSAFE_PATH') throw error;
    const named = authoringRefusal('AUTHORING_UNSAFE_PATH', `The path is ~/.bowerloom/${itemPath(kind, id)}.`);
    Object.defineProperty(named, 'next', { value: 'ls -la ~/.bowerloom', enumerable: false });
    throw named;
  }
}
const AREAS = ['skills', 'prompts', 'teams'] as const;
/** Review S1 of PR 98: an area folder that is there must be a real folder (not a link, dangling or not) inside `base`. */
function checkArea(base: string, shown: string, area: string): void {
  const at = join(base, area);
  if (lstatOrNull(at) === null) return;
  let inside = false;
  try { realFolder(at); inside = fs.realpathSync(at) === join(fs.realpathSync(base), area); } catch { inside = false; }
  if (!inside) authoringRefuse('AUTHORING_UNSAFE_PATH', `The folder is ${shown}/${area}.`);
}
function checkAreas(base: string, shown: string): void { for (const area of AREAS) checkArea(base, shown, area); }
/** The item's own path, really inside its area of `base`: no link on the way. */
function insideArea(base: string, shown: string, kind: Kind, id: string): void {
  checkArea(base, shown, LIST[kind]);
  let real: string | null = null; try { real = fs.realpathSync(join(base, itemPath(kind, id))); } catch { real = null; }
  if (real !== join(fs.realpathSync(base), itemPath(kind, id))) authoringRefuse('AUTHORING_UNSAFE_PATH', `The folder is ${shown}/${LIST[kind]}.`);
}
/** Review L1: true when a folder has more entries or levels than readTree takes (LIMITS.itemEntries, LIMITS.depth). Links are not followed. */
function pastTreeLimits(root: string): boolean {
  let entries = 0;
  const walk = (dir: string, depth: number): boolean => {
    if (depth > LIMITS.depth) return true;
    let list: fs.Dirent[]; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of list) { if (++entries > LIMITS.itemEntries) return true; if (e.isDirectory() && walk(join(dir, e.name), depth + 1)) return true; }
    return false;
  };
  return walk(root, 1);
}
const reasonOf = (error: unknown): MigrateReason => (error as Error | null)?.message?.endsWith(NOT_SHAREABLE.size) ? 'size' : 'file';

/** A proof outcome the plan bound for a present written item in a shared project. */
type Proof = { switch: true; item: LockItem } | { switch: false; code: string; sentence: string };
interface Proofs { byPair: Map<string, Proof>; notes: string[]; hosts: string[]; credentials: Credentials | null; commit: string | null }
type Mode =
  | { kind: 'plan'; token: TokenSource; transport: StoreTransportFactory | undefined; signal: AbortSignal }
  | { kind: 'apply'; plan: StoreMigratePlan; store: StoreContext; created: boolean };

/** The sentence of a store repository problem, without its final period (3.1, `<sentence>`). */
function problemSentence(problem: keyof typeof NOT_SHAREABLE): string {
  const base = NOT_SHAREABLE[problem].replace(/\.$/, '');
  return problem === 'unsupported-remote' || problem === 'unreadable' ? `${base}. ${FIX}` : base;
}

/** Proves the present written items of a shared project (rule 9). Reads the token and the network only when it must. */
async function prove(store: StoreState, needs: readonly Found[], commit: string | null, mode: Extract<Mode, { kind: 'plan' }>): Promise<Proofs> {
  const byPair = new Map<string, Proof>(), notes: string[] = [];
  if (!needs.length) return { byPair, notes, hosts: [], credentials: null, commit: null };
  const repo = readStoreRepo(store.dir, commit);
  if (repo.problem !== null) {
    for (const n of needs) byPair.set(pairOf(n), { switch: false, code: 'STORE_ITEM_NOT_SHAREABLE', sentence: problemSentence(repo.problem) });
    return { byPair, notes, hosts: [], credentials: null, commit: null };
  }
  if (commit === null && repo.head !== null && repo.head !== repo.pushed) notes.push(`Your store has commits that are not pushed (HEAD differs from origin/${repo.branch}). The lock records the pushed commit ${repo.pushed!.slice(0, 8)}.`);
  const rows = needs.map(n => ({ need: n, rows: localItemRows(store.dir, n.kind, n.id) }));
  // Spec 07, 3.2: the token is read here, for the proof, before any network read.
  const token = onceTokenSource(mode.token)();
  const r = requestCount(rows.map(x => ({ local: { distinct: new Set(x.rows.rows.map(row => row.sha256)).size } })));
  requireRequestBudget(r); notes.push(NETWORK_LINE(needs.length, r)); if (r > 60 && token === null) notes.push(NO_TOKEN_LINE);
  const ids = needs.map(pairOf).join(', ');
  const options = token !== null ? { githubAuth: { token, repositories: [repositoryOf(repo.remote!)] } } : {};
  const make = () => (mode.transport ?? createPublicTransport)(options);
  for (const { need, rows: local } of rows) {
    let outcome, transport: ReturnType<typeof make> | null = null;
    try { transport = make(); outcome = await proveAuthored(transport, { remote: repo.remote!, commit: repo.pushed!, kind: need.kind, id: need.id, ...(need.kind !== 'team' ? { teams: need.teams } : {}) }, local.hash, mode.signal, make); }
    catch (error) {
      if (mode.signal.aborted) throw syncError('SKILLS_SYNC_INTERRUPTED', 'It stopped while checking the pushed copy, before any change.');
      const code = error instanceof DefinitionError ? error.code : null;
      if (code === 'SKILLS_ADD_NETWORK') throw offlineNetwork(`Checking ${ids} needs api.github.com, and the network was not reachable.`);
      // Review L2: a pushed file Bowerloom cannot check is not the same finding as a pushed copy that differs.
      if (code === 'SKILLS_ADD_UNSAFE_CONTENT') { byPair.set(pairOf(need), { switch: false, code: 'SKILLS_ADD_UNSAFE_CONTENT', sentence: 'The pushed copy holds a file that Bowerloom cannot check' }); continue; }
      if (code === 'SKILLS_ADD_NOT_FOUND') { byPair.set(pairOf(need), { switch: false, code: 'LOCK_STORE_NOT_PUSHED', sentence: 'The pushed copy differs from your store' }); continue; }
      throw error;
    } finally { transport?.close(); }
    if (outcome.outcome === 'commit-missing') {
      // A --commit the remote does not have makes the item copy-only. The pushed commit of the branch missing means the
      // repository cannot be read: the person must fix the access first, so the command refuses.
      if (commit !== null) { byPair.set(pairOf(need), { switch: false, code: 'LOCK_COMMIT_UNREACHABLE', sentence: `The commit is not on the remote. ${FIX}` }); continue; }
      throw token !== null ? manifestRefusal('STORE_REMOTE_AUTH_FAILED') : configRefusal('STORE_REMOTE_PRIVATE');
    }
    if (outcome.outcome === 'not-pushed') { byPair.set(pairOf(need), { switch: false, code: 'LOCK_STORE_NOT_PUSHED', sentence: 'The pushed copy differs from your store' }); continue; }
    byPair.set(pairOf(need), { switch: true, item: { id: need.id, from: 'store', authored: outcome.pin } });
  }
  return { byPair, notes, hosts: ['api.github.com'], credentials: token !== null ? credentialsFor([repo.remote!]) : null, commit: repo.pushed };
}

/** The proofs the plan bound, read back at apply: each switched written item must still have the hash it was proved with. */
function boundProofs(plan: StoreMigratePlan, store: StoreState): Proofs {
  const byPair = new Map<string, Proof>();
  let lock: ProjectLock | null = null;
  if (plan.lock !== null) { try { lock = parseLock(Buffer.from(plan.lock.text)); } catch { throw stale(); } }
  for (const item of plan.items) {
    if (item.how !== 'local' || !plan.shared || item.state !== 'present') continue;
    if (!item.switch) { if (item.notSwitched === null) throw stale(); byPair.set(pairOf(item), { switch: false, code: item.notSwitched.code, sentence: item.notSwitched.sentence }); continue; }
    const bound = lock === null ? null : lockItem(lock, item.kind, item.id);
    if (bound === null || !('authored' in bound)) throw stale();
    let hash: string; try { hash = localItemRows(store.dir, item.kind, item.id).hash; } catch { throw stale(); }
    if (hash !== bound.authored.hash) throw stale();
    byPair.set(pairOf(item), { switch: true, item: bound });
  }
  return { byPair, notes: [...plan.notes], hosts: [...plan.network.hosts], credentials: plan.network.credentials, commit: plan.commit };
}

/** The command, without --approve, that makes the plan of these selectors again (second security review M1). */
export function rerunOf(s: StoreMigratePlan['selectors']): string {
  const words = ['bowerloom', 'store', 'migrate'];
  if (s.all) words.push('--all');
  for (const id of s.skills) words.push('--skill', id);
  for (const id of s.prompts) words.push('--prompt', id);
  for (const id of s.teams) words.push('--team', id);
  if (s.commit !== null) words.push('--commit', s.commit);
  return words.join(' ');
}
const REMOVE_REMINDER = (id: string): string => `Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill ${id} yourself.`;

/** Builds the plan. At apply (`mode.kind === 'apply'`) it reads the same files under the locks, with the proofs the plan bound. */
async function build(input: MigrateInput, mode: Mode): Promise<StoreMigratePlan> {
  checkSelectors(input);
  const { project } = input, sel = input.selectors;
  // Rule 3: setup owns first-team and personal-assistant.
  if (sel.teams.includes(FIRST_TEAM) || sel.skills.includes(ASSISTANT)) throw configRefusal('MIGRATE_RESERVED');
  verifyProjectPins(project);
  const storeDir = mode.kind === 'apply' ? mode.store.dir : storeRootOf(input.home);
  let storeContext: StoreContext | null, create: boolean;
  if (mode.kind === 'apply') { storeContext = mode.store; create = mode.created; }
  else {
    const found = inspectStore(input.home);
    if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
    storeContext = found.state === 'store' ? found.context : null; create = found.state !== 'store';
  }
  const selectors = { skills: [...sel.skills].sort(byteOrder), prompts: [...sel.prompts].sort(byteOrder), teams: [...sel.teams].sort(byteOrder), all: input.all, commit: input.commit };
  const projectBinding = { dir: project.dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity };
  const bowerloom = join(project.dir, '.bowerloom');
  const finish = (body: Omit<StoreMigratePlan, 'revision'>): StoreMigratePlan => ({ ...body, revision: sha(canonicalJson(body)) });
  // Rule 4: the items live in `.bowerloom`. Without it a selector finds nothing, and --all has nothing to move.
  if (project.bowerloomIdentity === null) {
    if (!input.all) throw configRefusal('MIGRATE_ITEM_NOT_FOUND');
    return finish({
      format: STORE_MIGRATE_PLAN_FORMAT, project: projectBinding, store: { create, dir: storeDir, identity: null, skills: null, authoring: null }, shared: false, selectors,
      items: [], skipped: [], folders: [], manifest: null, config: null, lock: null, scratch: [], projectScratch: [], network: { hosts: [], credentials: null }, commit: null, notes: [], staleLock: [], removeLines: [], writesAuthorized: false, executionAuthorized: false,
    });
  }
  // Rule 4a: nothing half-written in the store or the project, and no revise under way.
  const store = readStore(storeDir, storeContext, create);
  if (store.auth.pending !== null) authoringRefuse('AUTHORING_PENDING');
  const projectAuth = readAuthoringState(bowerloom);
  if (projectAuth.pending !== null) authoringRefuse('AUTHORING_PENDING');
  if (lstatOrNull(join(project.dir, '.bowerloom-revision.json')) !== null) authoringRefuse('REVISION_PENDING');
  // Review S1 of PR 98: a link at an area folder is never followed, in the project or in the store.
  checkAreas(bowerloom, '.bowerloom');
  if (store.context !== null) checkAreas(storeDir, '~/.bowerloom');
  const projectManifestState = readManifestState(project.dir, { allowAbsent: true });
  const projectManifest = projectManifestState.file ? parseManifest(projectManifestState.file.bytes, MANIFEST_LIMITS) : null;
  const receiptItems = projectAuth.receipt?.value.items ?? [];
  const configRead = readConfig(project);
  if (configRead.state === 'invalid') throw configRefusal(configRead.code);
  if (configRead.state === 'absent' && project.configPresent) throw projectRefusal('PROJECT_UNSAFE');
  const config = configRead.state === 'valid' ? configRead.config : null;
  const listed = (kind: Kind, id: string): ConfigEntry | null => config === null ? null : config[LIST[kind]].find(e => e.id === id) ?? null;

  // The candidates: the named items, or with --all every project item (rule 3: never first-team, personal-assistant, or a slice).
  const skipped: StoreMigratePlan['skipped'] = [];
  /** The lines that remove the old copies of items listed from the store. */
  const leftover: string[] = [];
  /** The remove lines of an item's copy in this project: its files, and the skills.json line Bowerloom does not edit. */
  const oldCopy = (kind: Kind, id: string): string[] => {
    const out: string[] = [];
    if (kind === 'skill') {
      const e = projectManifest?.skills.find(x => x.id === id) ?? null;
      if (e === null) return out;
      if (e.source.kind === 'local' && lstatOrNull(join(bowerloom, itemPath('skill', id))) !== null) out.push(`  git rm -r .bowerloom/${itemPath('skill', id)}`);
      if (e.source.kind !== 'local' || !receiptItems.some(i => i.kind === 'skill' && i.id === id)) out.push(REMOVE_REMINDER(id));
      return out;
    }
    if (lstatOrNull(join(bowerloom, itemPath(kind, id))) !== null) out.push(kind === 'prompt' ? `  git rm .bowerloom/${itemPath('prompt', id)}` : `  git rm -r .bowerloom/${itemPath(kind, id)}`);
    return out;
  };
  const candidates: { kind: Kind; id: string; explicit: boolean }[] = [];
  if (input.all) {
    const defined: { kind: Kind; id: string }[] = [
      ...(projectManifest?.skills ?? []).map(s => ({ kind: 'skill' as const, id: s.id })),
      ...receiptItems.filter(i => i.kind === 'prompt').map(i => ({ kind: 'prompt' as const, id: i.id })),
      ...receiptItems.filter(i => i.kind === 'team').map(i => ({ kind: 'team' as const, id: i.id })),
    ];
    const seen = new Set<string>();
    for (const d of defined) {
      if (seen.has(pairOf(d))) continue; seen.add(pairOf(d));
      if ((d.kind === 'team' && d.id === FIRST_TEAM) || (d.kind === 'skill' && d.id === ASSISTANT)) continue;
      if (config !== null) {
        const e = listed(d.kind, d.id);
        // Rule 6, the --all decision (variant B): an item bowerloom.json does not list stays as it is.
        if (e === null) { skipped.push({ kind: d.kind, id: d.id, line: 'not listed in bowerloom.json, so it stays as it is.' }); continue; }
        // Review H2: an item already listed from the store whose old copy is still here is named, with the lines that remove it.
        if (e.source === 'store') { const old = oldCopy(d.kind, d.id); if (old.length) { skipped.push({ kind: d.kind, id: d.id, line: 'already listed from the store; its old copy is still in this project.' }); leftover.push(...old); } continue; }
      }
      candidates.push({ ...d, explicit: false });
    }
    // A config entry from the project with no definition is an item whose files are gone: --all skips it.
  } else for (const kind of KINDS) for (const id of sel[LIST[kind]]) candidates.push({ kind, id, explicit: true });

  // Rules 5 and 5a: find each item, check the file rules of a store item, and read its pins.
  const found: Found[] = [];
  const skip = (c: { kind: Kind; id: string }, line: string) => skipped.push({ kind: c.kind, id: c.id, line });
  for (const c of candidates) {
    // Review M1: --all names an item whose files are gone.
    const missing = (): void => { if (c.explicit) throw configRefusal('MIGRATE_ITEM_NOT_FOUND'); skip(c, 'its files are gone, so it stays as it is.'); };
    let entry: Entry | null = null, teams: string[] = [], how: 'pinned' | 'local' = 'local';
    const registered = receiptItems.find(i => i.kind === c.kind && i.id === c.id) ?? null;
    if (c.kind === 'skill') {
      entry = projectManifest?.skills.find(s => s.id === c.id) ?? null;
      if (entry === null) { missing(); continue; }
      teams = [...(entry.teams ?? [])]; how = entry.source.kind === 'local' ? 'local' : 'pinned';
      if (how === 'local' && lstatOrNull(join(bowerloom, itemPath('skill', c.id))) === null) { missing(); continue; }
    } else {
      if (registered === null || lstatOrNull(join(bowerloom, itemPath(c.kind, c.id))) === null) { missing(); continue; }
      teams = c.kind === 'prompt' ? [...registered.teams] : [];
    }
    // Rule 6: an item listed from the store is not moved again. Review H2: the next step removes the old copy.
    if (c.explicit && listed(c.kind, c.id)?.source === 'store') {
      const old = oldCopy(c.kind, c.id)[0];
      throw old === undefined ? configRefusal('CONFIG_ITEM_SELECTED') : refusalWithNext('CONFIG_ITEM_SELECTED', old.trim());
    }
    let files: FilePin[] = [], candidate: string | null = null;
    if (how === 'local') {
      insideArea(bowerloom, '.bowerloom', c.kind, c.id);
      try { localItemRows(bowerloom, c.kind, c.id); }
      catch (error) {
        if ((error as { code?: unknown }).code !== 'STORE_ITEM_NOT_SHAREABLE') throw error;
        if (c.explicit) throw migrateUnsupported(reasonOf(error));
        skip(c, `stays in this project. ${migrateReasonWords(reasonOf(error))}`); continue;
      }
      // A tree past the limits of readTree (256 entries, depth 8) is larger than a store item can be. Review L1: any
      // other failure is refused as it is.
      try { files = pinsUnder(bowerloom, c.kind, c.id); }
      catch (error) {
        if (!pastTreeLimits(join(bowerloom, itemPath(c.kind, c.id)))) throw error;
        if (c.explicit) throw migrateUnsupported('size');
        skip(c, `stays in this project. ${migrateReasonWords('size')}`); continue;
      }
      if (c.kind === 'team') candidate = (await compileCrew(join(bowerloom, itemPath('team', c.id), 'team.yaml'))).candidateRevision;
    }
    found.push({ kind: c.kind, id: c.id, how, entry, teams, files, candidate, explicit: c.explicit, inReceipt: registered !== null });
  }
  // Rule 7: each tag names a team that is in the store already or moves in this run. first-team is never in the store.
  const storeTeams = new Set((store.auth.receipt?.value.items ?? []).filter(i => i.kind === 'team' && lstatOrNull(join(storeDir, itemPath('team', i.id))) !== null).map(i => i.id));
  const movingTeams = new Set(found.filter(f => f.kind === 'team').map(f => f.id));
  const kept: Found[] = [];
  for (const f of found) {
    const lacking = f.teams.find(t => t === FIRST_TEAM || (!storeTeams.has(t) && !movingTeams.has(t)));
    if (lacking === undefined) { kept.push(f); continue; }
    if (f.explicit) throw migrateTeamMissing(lacking);
    skip(f, `stays in this project. Its team ${lacking} is not in the store.`);
  }
  skipped.sort(kindOrder);
  kept.sort(kindOrder);

  // Rule 8: each item against the store.
  const storeRecords = store.auth.receipt?.value.items ?? [];
  const states = new Map<string, MigrateItem['state']>(), inStoreRecord = new Set<string>();
  for (const f of kept) {
    const record = storeRecords.find(i => i.kind === f.kind && i.id === f.id) ?? null;
    if (record !== null) inStoreRecord.add(pairOf(f));
    const at = join(storeDir, itemPath(f.kind, f.id)), there = store.context !== null && lstatOrNull(at) !== null;
    const exists = (next?: string): never => { throw next === undefined ? configRefusal('MIGRATE_ID_EXISTS') : refusalWithNext('MIGRATE_ID_EXISTS', next); };
    const recordGone = (): never => exists('bowerloom receipt clean --global');
    if (f.how === 'pinned') {
      if (there) exists();
      if (record !== null) recordGone();
      const current = store.manifest?.skills.find(s => s.id === f.id) ?? null;
      if (current === null) { states.set(pairOf(f), 'copy'); continue; }
      if (canonicalJson(current) !== canonicalJson(f.entry)) exists();
      states.set(pairOf(f), 'present'); continue;
    }
    if (f.kind === 'skill') {
      const current = store.manifest?.skills.find(s => s.id === f.id) ?? null;
      if (current !== null && canonicalJson(current) !== canonicalJson(localEntry(f.id, f.teams))) exists();
    }
    if (!there) { if (record !== null) recordGone(); states.set(pairOf(f), 'copy'); continue; }
    if (!samePins(storePins(storeDir, store.auth.scratch, f.kind, f.id), f.files)) exists();
    if (record !== null && canonicalJson(record.teams) !== canonicalJson(f.teams)) exists();
    const entryThere = f.kind !== 'skill' || store.manifest?.skills.some(s => s.id === f.id) === true;
    states.set(pairOf(f), record !== null && entryThere ? 'present' : 'register');
  }
  const stateOf = (f: Found): MigrateItem['state'] => states.get(pairOf(f))!;
  // The store receipt gains a record for each written item that it does not list yet (review C1).
  const recorded = kept.filter(f => f.how === 'local' && stateOf(f) !== 'present' && !inStoreRecord.has(pairOf(f)));
  // Rule 13: the store record of created items, after this run.
  const records: AuthoredItem[] = recorded.map(f => ({ kind: f.kind, id: f.id, teams: [...f.teams], files: f.files.map(p => ({ ...p })), planRevision: '0'.repeat(64) }));
  const nextRecords = [...storeRecords, ...records];
  if (nextRecords.length > LIMITS.items || Buffer.byteLength(recordText(receiptOf(nextRecords))) > LIMITS.recordBytes) throw configRefusal('MIGRATE_LIMIT');
  // Step 4 in memory: one skills.json change per missing entry, in id order, with the store limits.
  const steps: NonNullable<StoreMigratePlan['manifest']>['steps'] = [];
  let current = store.manifest, read = store.manifestRead;
  for (const f of kept.filter(x => x.kind === 'skill').sort((a, b) => byteOrder(a.id, b.id))) {
    if (f.how === 'pinned' ? stateOf(f) !== 'copy' : current?.skills.some(s => s.id === f.id) === true) continue;
    const next = manifestAfter(current, { add: f.how === 'pinned' ? f.entry! : localEntry(f.id, f.teams) }, STORE_MANIFEST_LIMITS);
    const after = { sha256: sha(next.text), bytes: Buffer.byteLength(next.text) };
    steps.push({ id: f.id, before: read, after }); current = next.manifest; read = after;
  }

  // Rule 9: which items switch now. Rules 10 and 11: the config and the lock.
  const sharedState = isSharedProject(project), shared = sharedState.shared;
  let proofs: Proofs;
  try {
    const needs = shared ? kept.filter(f => f.how === 'local' && stateOf(f) === 'present') : [];
    proofs = mode.kind === 'plan' ? await prove(store, needs, input.commit, mode) : boundProofs(mode.plan, store);
  } catch (error) { throw sharedState.unknown !== undefined ? honestShared(error, sharedState.unknown) : error; }
  const items: MigrateItem[] = kept.map(f => {
    let sw = true, notSwitched: MigrateItem['notSwitched'] = null;
    if (shared && f.how === 'local') {
      if (stateOf(f) !== 'present') { sw = false; notSwitched = { code: 'LOCK_STORE_NOT_PUSHED', sentence: NEW_IN_STORE }; }
      else { const p = proofs.byPair.get(pairOf(f)); if (p === undefined) throw stale(); if (!p.switch) { sw = false; notSwitched = { code: p.code, sentence: p.sentence }; } }
    }
    return { kind: f.kind, id: f.id, how: f.how, state: stateOf(f), recorded: inStoreRecord.has(pairOf(f)), switch: sw, notSwitched, teams: [...f.teams], files: f.files, entry: f.entry, candidate: f.candidate, lock: null };
  });
  const switched = items.filter(i => i.switch);
  let configStep: StoreMigratePlan['config'] = null;
  let nextConfig: ProjectConfig | null = null;
  if (switched.length) {
    nextConfig = config !== null ? JSON.parse(JSON.stringify(config)) as ProjectConfig : initialConfig(project).config;
    const adds: string[] = [];
    for (const i of switched) {
      const list = nextConfig[LIST[i.kind]], e = list.find(x => x.id === i.id);
      if (e) { e.source = 'store'; delete e.via; } else { list.push({ id: i.id, source: 'store' }); list.sort((a, b) => byteOrder(a.id, b.id)); adds.push(pairOf(i)); }
    }
    const text = serializeConfig(nextConfig);
    configStep = { before: configRead.state === 'valid' ? { sha256: configRead.sha256, bytes: configRead.bytes } : null, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text, created: configRead.state !== 'valid', adds };
  }
  let oldLock: ProjectLock | null = null, lockRead: Read | null = null;
  try { const got = readLock(project); if (got.state === 'present') { oldLock = got.lock; lockRead = { sha256: got.sha256, bytes: got.bytes }; } }
  catch (error) { throw sharedState.unknown !== undefined ? honestShared(error, sharedState.unknown) : error; }
  let lockStep: StoreMigratePlan['lock'] = null;
  if (switched.length && shared) {
    const lockItems = new Map<string, LockItem>(oldLock ? LOCK_LISTS.flatMap(([name, kind]) => oldLock![name].map(i => [`${kind} ${i.id}`, i] as const)) : []);
    for (const i of switched) {
      const item: LockItem = i.how === 'pinned' ? { id: i.id, from: 'store', pin: i.entry as PinnedEntry } : (proofs.byPair.get(pairOf(i)) as { item: LockItem }).item;
      lockItems.set(pairOf(i), item); i.lock = lockSourceLabel(item);
    }
    const wanted = new Set(LOCK_LISTS.flatMap(([name, kind]) => nextConfig![name].filter(e => e.source === 'store').map(e => `${kind} ${e.id}`)));
    for (const pair of [...lockItems.keys()]) if (!wanted.has(pair)) lockItems.delete(pair);
    const lacking = [...wanted].filter(p => !lockItems.has(p)).sort(byteOrder);
    if (lacking.length) throw lockMismatch(lacking);
    const lock: ProjectLock = { format: LOCK_FORMAT, skills: [], prompts: [], teams: [] };
    for (const [pair, item] of lockItems) lock[LIST[pair.split(' ')[0] as Kind]].push(item);
    for (const [name] of LOCK_LISTS) lock[name].sort((a, b) => byteOrder(a.id, b.id));
    const text = serializeLock(lock);
    lockStep = { before: lockRead, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text };
  }
  // A shared project whose lock disagrees with its config says so in every plan.
  const staleLock = shared && config !== null ? (() => { const a = lockAgrees(oldLock ?? { format: LOCK_FORMAT, skills: [], prompts: [], teams: [] }, config); return [...a.added, ...a.removed].sort(byteOrder); })() : [];
  // The store folders this run makes, in order.
  const copies = items.filter(i => i.state === 'copy' && i.how === 'local');
  const needed = new Set<string>([...(recorded.length ? ['authoring'] : []), ...copies.map(i => LIST[i.kind])]);
  const folders = FOLDER_ORDER.filter(f => needed.has(f) && (store.context === null || lstatOrNull(join(storeDir, f)) === null));
  for (const f of FOLDER_ORDER) if (store.context !== null && needed.has(f) && !folders.includes(f)) realFolder(join(storeDir, f));
  // The lines that remove the old copies: switched items only.
  // Review H2: and the old copies of items that are listed from the store already.
  const removeLines = [
    ...switched.filter(i => i.how === 'local').map(i => i.kind === 'prompt' ? `  git rm .bowerloom/${itemPath('prompt', i.id)}` : `  git rm -r .bowerloom/${itemPath(i.kind, i.id)}`),
    ...leftover.filter(l => l.startsWith('  ')),
    ...switched.filter(i => i.kind === 'skill' && (i.how === 'pinned' || !kept.find(f => f.kind === 'skill' && f.id === i.id)!.inReceipt)).map(i => REMOVE_REMINDER(i.id)),
    ...leftover.filter(l => !l.startsWith('  ')),
  ];
  if (store.context !== null && !create) verifyStorePins(store.context);
  verifyProjectPins(project);
  return finish({
    format: STORE_MIGRATE_PLAN_FORMAT, project: projectBinding,
    store: { create, dir: storeDir, identity: create || store.context === null ? null : store.context.identity, skills: store.manifestRead, authoring: store.auth.receipt?.read ?? null },
    shared, selectors, items, skipped, folders, manifest: steps.length ? { steps } : null, config: configStep, lock: lockStep,
    scratch: store.auth.scratch, projectScratch: scratchFiles(project.dir), network: { hosts: proofs.hosts, credentials: proofs.credentials }, commit: proofs.commit,
    notes: proofs.notes, staleLock, removeLines, writesAuthorized: false, executionAuthorized: false,
  });
}
const migrateReasonWords = (reason: MigrateReason): string => MIGRATE_REASON[reason];

/** Plans `store migrate`. It writes nothing. In a shared project it may read api.github.com, and only then the token. */
export async function planStoreMigrate(input: MigrateInput): Promise<StoreMigratePlan> {
  return build(input, { kind: 'plan', token: input.githubToken, transport: input.storeTransport, signal: input.signal });
}

/** True when the plan has nothing to write: no copy, no record, no config or lock change (rule 14). */
export const migrateIsNoop = (plan: StoreMigratePlan): boolean => plan.items.every(i => i.state === 'present') && plan.config === null && plan.lock === null;

/**
 * Applies an approved plan (3.2). The revision must be the plan's own. The store lock is taken first, then the project
 * lock; a PROJECT_LOCKED of the project lock leaves `withStoreForWrite` as a value and is thrown again here, so it is not
 * reported as STORE_LOCKED. Reads no network.
 */
export async function applyStoreMigrate(plan: StoreMigratePlan, revision: string, deps: MigrateDeps): Promise<StoreMigrateResult> {
  if (plan === null || typeof plan !== 'object' || typeof revision !== 'string' || revision !== plan.revision) throw stale();
  const { revision: _r, ...body } = plan;
  if (sha(canonicalJson(body)) !== revision) throw stale();
  // Spec 07, 3.5: a plan with credentials needs a token; a plan that proved an item without one needs none.
  const tokenSet = GithubToken.isToken(deps.githubToken);
  if (plan.network.credentials !== null && !tokenSet) throw stale(TOKEN_STALE_NOTE);
  if (plan.network.credentials === null && plan.network.hosts.length > 0 && tokenSet) throw stale(TOKEN_STALE_NOTE);
  const { project, hooks = {} } = deps;
  if (project.dir !== plan.project.dir) throw projectRefusal('USAGE');
  const outcome = await withStoreForWrite(deps.home, deps.signal, async (store, heldStore, created) => {
    hooks.locked?.('store');
    let entered = false;
    try {
      return { result: await withProjectLock(project.dir, deps.signal, async heldProject => { entered = true; hooks.locked?.('project'); return work(plan, store, heldStore, created, heldProject, deps); }) };
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'PROJECT_LOCKED') throw error;
      // Review L3: the store lock came first and made the store; the old plan saw none, so the next plan is needed.
      if (!entered && created) {
        const refused = projectRefusal('PROJECT_LOCKED', 'Bowerloom made the store at ~/.bowerloom before it waited for the project. Run the command again without --approve to see the next plan.');
        // Second security review M1: the store was written, so this refusal is partial, and its Next line is that command.
        Object.defineProperty(refused, 'hint', { value: PARTIAL_HINT, enumerable: false });
        Object.defineProperty(refused, 'next', { value: rerunOf(plan.selectors), enumerable: false });
        return { projectLocked: refused };
      }
      return { projectLocked: error };
    }
  });
  if ('projectLocked' in outcome) throw outcome.projectLocked;
  return outcome.result;
}

/** Inside both locks: the steps of 3.2. Every PROJECT_LOCKED here is the project lock's; the store lock's is STORE_LOCKED. */
async function work(plan: StoreMigratePlan, store: StoreContext, heldStore: HeldProjectLock, created: boolean, heldProject: HeldProjectLock, deps: MigrateDeps): Promise<StoreMigrateResult> {
  const { project, hooks = {} } = deps;
  // Review L6: a store lock that is not held is the store's refusal.
  if (!isHeldProjectLock(heldStore)) throw projectRefusal('STORE_LOCKED');
  if (!isHeldProjectLock(heldProject)) throw manifestRefusal('PROJECT_LOCKED');
  const storeHeld = (): void => { try { heldStore.assertHeld(store.dir); } catch { throw projectRefusal('STORE_LOCKED'); } };
  const live = (): void => { storeHeld(); verifyStorePins(store); heldProject.assertHeld(project.dir); verifyProjectPins(project); };
  // Review H1: what this run wrote, so that a refusal part way says so and names it.
  const done: string[] = created ? ['the store at ~/.bowerloom (store.json)'] : [];
  try {
    // A store this run made is the store the plan saw absent, and only then.
    if (created !== plan.store.create) throw stale();
    live();
    let again: StoreMigratePlan;
    try {
      again = await build({ project, home: deps.home, selectors: { skills: plan.selectors.skills, prompts: plan.selectors.prompts, teams: plan.selectors.teams }, all: plan.selectors.all, commit: plan.selectors.commit, githubToken: null, signal: deps.signal }, { kind: 'apply', plan, store, created });
    } catch (error) {
      // Any refusal of the plan made again is a change since the approval. Review M3: its code is kept as the cause.
      if (error instanceof DefinitionError && error.code !== 'STORE_LOCKED' && error.code !== 'PROJECT_LOCKED') throw error.code === 'STALE_APPROVAL' ? error : staleBecause(error);
      throw error;
    }
    if (again.revision !== plan.revision) throw stale();
    return await steps(plan, store, heldStore, heldProject, deps, live, storeHeld, done);
  } catch (error) { throw partialRefusal(error, done, rerunOf(plan.selectors)); }
}

/** Steps 0 to 8 of 3.2. Each write is added to `done` once it is made. */
async function steps(plan: StoreMigratePlan, store: StoreContext, heldStore: HeldProjectLock, heldProject: HeldProjectLock, deps: MigrateDeps, live: () => void, storeHeld: () => void, done: string[]): Promise<StoreMigrateResult> {
  const { project, hooks = {} } = deps;
  const auth = join(store.dir, AUTHORING_FOLDER), bowerloom = join(project.dir, '.bowerloom');
  // 0. The project scratch of the config and lock writer.
  for (const name of plan.projectScratch) { live(); const s = lstatOrNull(join(project.dir, name)); if (s !== null && s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid?.()) { removeScratch(join(project.dir, name)); done.push(`the leftover ${name}, removed`); } }
  // 1. The store's own scratch.
  if (plan.scratch.length) { live(); for (const name of plan.scratch) { removeScratch(join(auth, name)); done.push(`the store scratch ${name}, removed`); } syncFolder(auth); }
  // 2. The store folders (withStoreForWrite made the store itself).
  for (const folder of plan.folders) { live(); makeFolder(join(store.dir, folder)); done.push(`the store folder ${folder}`); }
  if (plan.folders.length) syncFolder(store.dir);
  // 3. Each copy, staged, checked, and moved into place.
  const stage = join(auth, stageName(plan.revision));
  const copies = plan.items.filter(i => i.state === 'copy' && i.how === 'local');
  if (copies.length) { live(); makeFolder(stage); done.push('a staging folder in ~/.bowerloom/authoring'); }
  for (const item of copies) {
    // Review S1: the project area is read without following a link, here as in the plan.
    insideArea(bowerloom, '.bowerloom', item.kind, item.id);
    for (const file of item.files) {
      const source = readGuarded(join(bowerloom, file.path), LIMITS.fileBytes);
      if (sha(source) !== file.sha256 || source.length !== file.bytes) throw stale();
      const segments = file.path.split('/');
      for (let i = 1; i < segments.length; i++) { const folder = join(stage, ...segments.slice(0, i)); if (lstatOrNull(folder) === null) makeFolder(folder); }
      writeNewFile(join(stage, file.path), source);
      const written = readGuarded(join(stage, file.path), LIMITS.fileBytes);
      if (sha(written) !== file.sha256 || written.length !== file.bytes) throw stale();
    }
    const from = join(stage, itemPath(item.kind, item.id));
    hooks.afterStage?.(item.kind, item.id, from);
    if (!samePins(pinsUnder(stage, item.kind, item.id), item.files)) throw stale();
    if (item.kind === 'team') { const compiled = await compileCrew(join(from, 'team.yaml')); if (compiled.candidateRevision !== item.candidate) throw stale(); }
    const parent = join(store.dir, LIST[item.kind]), to = join(store.dir, itemPath(item.kind, item.id));
    live(); realFolder(parent);
    if (lstatOrNull(to) !== null) throw stale();
    if (item.kind === 'prompt') {
      // Review S2: a prompt is linked into place, so a file that appears there meanwhile is never overwritten.
      try { fs.linkSync(from, to); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw stale(); throw error; }
      fs.unlinkSync(from);
    } else fs.renameSync(from, to);
    syncFolder(parent);
    done.push(`${item.kind} ${item.id}, copied to the store`);
    hooks.afterItem?.(item.kind, item.id);
  }
  if (copies.length) hooks.afterStep?.(3);
  // 4. The store skills.json: one change per missing entry, each checked against the bytes the plan bound.
  for (const step of plan.manifest?.steps ?? []) {
    live();
    const item = plan.items.find(i => i.kind === 'skill' && i.id === step.id);
    if (item === undefined) throw stale();
    const change = planManifestChange(storeTarget(store.dir), { add: item.how === 'pinned' ? item.entry! : localEntry(item.id, item.teams) }, { storeCreate: false });
    if ((change.before?.sha256 ?? null) !== (step.before?.sha256 ?? null) || change.after.sha256 !== step.after.sha256 || change.after.bytes !== step.after.bytes) throw stale();
    try { applyManifestChange(change, change.revision, heldStore); } catch (error) { if ((error as { code?: unknown }).code === 'PROJECT_LOCKED') throw projectRefusal('STORE_LOCKED'); throw error; }
    done.push(`the store skills.json entry of skill ${step.id}`);
  }
  if (plan.manifest !== null) hooks.afterStep?.(4);
  // 5. The store receipt, once: every written item copied or found unrecorded. A pinned skill lives only in skills.json.
  const records: AuthoredItem[] = plan.items.filter(i => i.how === 'local' && i.state !== 'present' && !i.recorded).map(i => ({ kind: i.kind, id: i.id, teams: [...i.teams], files: i.files.map(f => ({ ...f })), planRevision: plan.revision }));
  if (records.length) {
    const existing = readAuthoringState(store.dir).receipt?.value.items ?? [];
    writeReceiptRecord(auth, plan.revision, plan.store.authoring, [...existing, ...records], live, () => readAuthoringState(store.dir).receipt?.read ?? null);
    done.push('the store record of created items');
    hooks.afterStep?.(5);
  }
  // 6. The staging folder.
  if (copies.length) { live(); removeScratch(stage); syncFolder(auth); }
  // 7. bowerloom.json. A new file is adopted as the project's marker right after it is written.
  let configWrite: { sha256: string; bytes: number } | null = null, context = project;
  if (plan.config !== null) {
    live();
    const wrote = writeGuardedFile(project.dir, CONFIG_FILE, plan.config.text, plan.config.before?.sha256 ?? null, heldProject, `.${CONFIG_FILE}`);
    configWrite = { sha256: wrote.sha256, bytes: wrote.bytes }; done.push('bowerloom.json');
    if (plan.config.created) context = adoptCreatedMarker(project, 'config', { device: wrote.device, inode: wrote.inode });
    hooks.afterStep?.(7);
  }
  // 8. The lock.
  let lockWrite: { sha256: string; bytes: number } | null = null;
  if (plan.lock !== null) {
    storeHeld(); verifyStorePins(store); heldProject.assertHeld(context.dir); verifyProjectPins(context);
    const wrote = writeGuardedFile(project.dir, LOCK_FILE, plan.lock.text, plan.lock.before?.sha256 ?? null, heldProject, `.${LOCK_FILE}`);
    lockWrite = { sha256: wrote.sha256, bytes: wrote.bytes };
  }
  // Review L5: a copy-only item always carries its reason; a plan without one is not this plan.
  const notSwitched = plan.items.filter(i => !i.switch).map(i => { if (i.notSwitched === null) throw stale(); return { kind: i.kind, id: i.id, code: i.notSwitched.code }; });
  return {
    format: STORE_MIGRATE_RESULT_FORMAT, planRevision: plan.revision,
    moved: plan.items.filter(i => i.switch).map(i => ({ kind: i.kind, id: i.id, state: i.state })),
    copied: plan.items.filter(i => !i.switch && i.state !== 'present').map(i => ({ kind: i.kind, id: i.id, state: i.state })),
    notSwitched, skipped: plan.skipped.map(x => ({ ...x })), complete: notSwitched.length === 0 && plan.skipped.length === 0,
    configSha256: configWrite?.sha256 ?? null, configBytes: configWrite?.bytes ?? null, lockSha256: lockWrite?.sha256 ?? null, lockBytes: lockWrite?.bytes ?? null,
    removeLines: [...plan.removeLines], executionAuthorized: false,
  };
}
