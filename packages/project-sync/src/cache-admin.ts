/**
 * Spec 09: `cache list` and `cache prune` (sageadvicellc/bowerloom#80, phase 8). Eviction is manual only (decision 10).
 *
 * Three places hold cached bytes, all under the private state root: the machine's skills cache (`cache`, `op-<id>`
 * operations), the store cache (`store-cache`, `<kind>-<id>-<hash>` folders), and the read-only per-project caches of
 * earlier betas (`<projectId>/cache`). Listing reads only, takes no lock and writes nothing. No index file exists: what
 * refers to an entry is rebuilt each time from the store skills.json and live store items, and from the current
 * project's skills.json, lock pins and lock hashes (3.2). A source that cannot be read is unknown, and then
 * `--unreferenced` picks nothing.
 *
 * Pruning is a plan, an approval of its revision, and an apply under the one cache lock. Apply plans again, checks the
 * approval, then re-lists under the lock and refuses STALE_APPROVAL before any delete when a picked entry changed, became
 * referenced, or became busy. Every delete goes through removeCacheEntry, which never follows a link.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../contracts/src/index.js';
import { CachePruneRefusal, cacheEntryProblem, cacheRootProblem, inspectSkillCache, leftoverBlocked, leftoverFix, leftoverTreeFix, NO_COMMAND, RUN_FIX, removeCacheEntry } from '../../skill-sources/src/cache.js';
import type { CacheInspection } from '../../skill-sources/src/cache.js';
import { directory } from '../../managed-skills/src/observed.js';
import { inspectStore, projectRefusal, storeRootOf, withCacheLock } from '../../project-context/src/index.js';
import type { StoreContext } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { MANIFEST_LIMITS, parseManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { readConfig } from '../../project-config/src/config.js';
import { readLock } from '../../project-config/src/lock.js';
import { cacheOperationId, CACHE_ATTEMPTS, entryRequest } from './cache-index.js';
import { cacheLayout, stateProjectNested, storeStateNested } from './plan.js';
import { readStoreDefinitions } from './resolve.js';
import { localItemRows } from './store-items.js';
import { readStoreCache, storeCacheKey, STORE_CACHE_FOLDER } from './store-git.js';
import { syncError } from './refusal.js';

export const CACHE_LIST_FORMAT = 'bowerloom/cache-list/v1beta1' as const;
export const CACHE_PRUNE_PLAN_FORMAT = 'bowerloom/cache-prune-plan/v1beta1' as const;
export const CACHE_PRUNE_RESULT_FORMAT = 'bowerloom/cache-prune-result/v1beta1' as const;
/** At most this many entries are listed (3.3, step 5). */
export const CACHE_LIST_LIMIT = 4096;
/** An owner lock older than this counts as not active for --partial, --all and --entry (3.4). */
export const STALE_OWNER_MS = 24 * 60 * 60 * 1000;
/** How long prune waits for the cache lock (3.6). */
export const PRUNE_LOCK_WAIT_MS = 60_000;

export type CacheScope = 'machine' | 'store' | 'project-legacy';
export type SourceName = 'store' | 'project';
export interface CacheEntry {
  scope: CacheScope; id: string; projectId: string | null; status: 'completed' | 'partial'; name: string;
  active: boolean; stale: boolean; kind: 'npm' | 'git' | 'store-git' | null; label: string | null; skillName: string | null;
  files: number | null; bytes: number | null; key: string | null; references: { store: boolean | null; project: boolean | null };
  /** Review L3 of PR 99: why a partial entry is partial. Null for a completed one. */
  partialReason: PartialReason | null;
  /** Round 3 of the reviews of PR 99 (M-A): the command that lets a stuck leftover be deleted, or null. */
  next: string | null;
}
export type PartialReason = 'unfinished-fetch' | 'unreadable' | 'changed' | 'prune-leftover' | 'write-leftover';
/** Review H2 of PR 99: a name in a cache folder that is not an entry, and why. */
export interface UnlistedName { place: 'cache' | 'store-cache' | 'legacy'; name: string; reason: string; next: string | null }
/** Review M1 of PR 99: why a source could not be read: its refusal code, and the file or item, when one is known. */
export interface Unreadable { source: SourceName; code: string; item: string | null }
export interface CacheList {
  format: typeof CACHE_LIST_FORMAT; stateRoot: string; entries: CacheEntry[]; totals: { entries: number; bytes: number };
  unlisted: number; truncated: boolean; unreadableSources: SourceName[];
  /** The first 256 unlisted names with their reasons. */
  unlistedNames: UnlistedName[];
  unreadable: Unreadable[];
}
export interface CachePruneSelectors { unreferenced: boolean; partial: boolean; legacy: boolean; all: boolean; entries: string[] }
export interface CacheBound { snapshotRevision: string | null; receiptRevision: string | null; contentHash: string | null }
export interface PickedEntry {
  scope: CacheScope; id: string; name: string; projectId: string | null; status: 'completed' | 'partial'; label: string | null;
  files: number | null; bytes: number | null; references: { store: boolean | null; project: boolean | null };
  /** True when the entry's owner lock is older than a day, so it counts as not in use. */
  stale: boolean;
  partialReason: PartialReason | null;
  bound: CacheBound;
}
export interface SkippedEntry { scope: CacheScope; id: string; projectId: string | null; reason: 'active'; label: string | null }
export interface CachePrunePlan {
  format: typeof CACHE_PRUNE_PLAN_FORMAT; stateRoot: string; selectors: CachePruneSelectors;
  picked: PickedEntry[]; skipped: SkippedEntry[]; freed: number;
  /** False outside a project, and when the project could not be read. */
  projectChecked: boolean;
  /** More than 4096 entries exist; only the listed ones can be picked. */
  truncated: boolean;
  unreadableSources: SourceName[];
  unreadable: Unreadable[];
  /** Round 3, L-b: names in the cache folders that are not entries and are never pruned. */
  unlisted: number;
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface CachePruneResult {
  format: typeof CACHE_PRUNE_RESULT_FORMAT; planRevision: string; deleted: { scope: CacheScope; id: string; projectId: string | null }[];
  skipped: { scope: CacheScope; id: string; projectId: string | null; reason: 'active' }[]; freed: number; executionAuthorized: false;
}
/** Test hooks. Product code passes none. */
export interface CacheAdminHooks {
  /** Replaces the inspection of one skills-cache operation. */
  inspect?(root: string, id: string): Promise<CacheInspection>;
  /** Runs after each entry is deleted, under the cache lock. */
  afterRemove?(index: number): void | Promise<void>;
  /** Runs once apply holds the cache lock, before it lists again. */
  underLock?(): void | Promise<void>;
  /** Runs inside removeCacheEntry's lock checks: step 0 before the rename, step 1 before the delete. */
  heldCheck?(index: number, step: 0 | 1): void;
}
export interface CacheAdminInput {
  stateRoot: string;
  /** The project of the current folder, or null outside one. */
  project: ProjectContext | null;
  home: string; env: NodeJS.ProcessEnv;
  /** The code of a discovery refusal other than PROJECT_NOT_FOUND: the project source is then unknown (3.2). */
  projectError?: string | null;
  hooks?: CacheAdminHooks;
}
export interface CachePruneInput extends CacheAdminInput { selectors: CachePruneSelectors }

/** What one readable source refers to: skills-cache operation ids with their content key, and store-cache folder names with their hash. */
export interface ReferenceSet { operations: Map<string, string>; storeKeys: Map<string, string> }
export interface ReferenceSets { store: ReferenceSet | null; project: ReferenceSet | null; projectChecked: boolean; unreadableSources: SourceName[]; unreadable: Unreadable[] }

const OP = /^op-([a-f0-9]{32})$/, STORE_ENTRY = /^(skill|prompt|team)-([a-z0-9]+(?:-[a-z0-9]+)*)-([a-f0-9]{64})$/;
const PRUNE_LEFTOVER = /^\.prune-.{1,200}$/, TMP_LEFTOVER = /^\.tmp-.{1,200}$/, PROJECT_ID = /^[a-f0-9]{32}$/, LEGACY_PREFIX = /^([a-f0-9]{8,32})\/([a-f0-9]{8,32})$/;
const NOT_A_NAME = 'the name is not a cache entry name', UNLISTED_LIMIT = 256;
const SCOPES: readonly CacheScope[] = ['machine', 'store', 'project-legacy'];
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const exists = (path: string): boolean => { try { fs.lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw syncError('SKILLS_STATE_UNSAFE'); } };
const sortedNames = (dir: string): string[] => fs.readdirSync(dir).sort(byteOrder);

/** One listed entry and the values a plan binds for it. */
interface Listed { entry: CacheEntry; bound: CacheBound }
interface Scan { entries: Listed[]; unlisted: number; unlistedNames: UnlistedName[]; truncated: boolean }

/**
 * Before listing (3.3): the state chain and the machine cache pass the rules of cacheLayout, the store cache is a private
 * folder of this user, and the state root is not inside the store or the project, or they inside it.
 */
function checkState(input: CacheAdminInput): void {
  const layout = cacheLayout(input.stateRoot);
  const storeCache = join(input.stateRoot, STORE_CACHE_FOLDER);
  if (exists(storeCache)) { try { directory(storeCache, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); } }
  let store: StoreContext | null = null;
  try { const found = inspectStore(input.home); store = found.state === 'store' ? found.context : null; } catch { store = null; }
  if (storeStateNested(store, storeRootOf(input.home), input.stateRoot, layout.pins)) throw projectRefusal('STORE_STATE_NESTED');
  if (input.project !== null && stateProjectNested(input.project, input.stateRoot, layout.pins)) throw syncError('SKILLS_STATE_UNSAFE', 'The private state folder and the project must not be inside one another. Set XDG_STATE_HOME to a folder outside the project.');
}

/** The label of a completed skills-cache receipt (3.3). */
function receiptLabel(inspection: CacheInspection): string | null {
  const r = inspection.receipt; if (r === null) return null;
  const s = r.source as unknown as Record<string, unknown>, root = (r.skill as { sourceRoot?: unknown }).sourceRoot;
  if (s.kind === 'npm') return `${String(s.package)}@${String(s.version)}:${String(root)}`;
  if (s.kind === 'git') return `${String(s.repository)}@${String(s.commit).slice(0, 8)}:${String(root)}`;
  return null;
}
/** The owner lock of an operation: present, and older than a day. lstat only, so a link is never followed. */
function ownerLock(op: string): { present: boolean; stale: boolean } {
  // Review L5 of PR 99: only a lock that is not there is no lock. A lock that cannot be read counts as held.
  try { const s = fs.lstatSync(join(op, 'owner.lock')); return { present: true, stale: Date.now() - s.mtimeMs > STALE_OWNER_MS }; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { present: false, stale: false } : { present: true, stale: false }; }
}
/** One `op-<id>` folder of the skills cache or a legacy cache (3.3, steps 2 and 4). */
async function operationEntry(input: CacheAdminInput, root: string, scope: CacheScope, projectId: string | null, name: string, id: string): Promise<Listed> {
  let inspection: CacheInspection | null = null;
  try { inspection = await (input.hooks?.inspect ?? ((r: string, o: string) => inspectSkillCache({ root: r, operationId: o })))(root, id); } catch { inspection = null; }
  const lock = ownerLock(join(root, name));
  // An owner lock makes the entry active even when the inspection fails: an unreadable fetch in progress is never "not in use".
  const active = (inspection?.activeOwner ?? false) || lock.present;
  const completed = inspection !== null && inspection.status === 'COMPLETED' && inspection.receipt !== null && !active;
  const receipt = completed ? inspection!.receipt! : null;
  return {
    entry: {
      scope, id, projectId, status: completed ? 'completed' : 'partial', name, active, stale: lock.present && lock.stale,
      kind: receipt ? (receipt.source as { kind: 'npm' | 'git' }).kind : null, label: receipt ? receiptLabel(inspection!) : null,
      skillName: receipt ? receipt.skill.name : null, files: receipt ? receipt.inventory.length : null,
      bytes: receipt ? receipt.inventory.reduce((n, f) => n + f.bytes, 0) : null, key: null, references: { store: null, project: null },
      partialReason: completed ? null : inspection === null ? 'unreadable' : 'unfinished-fetch', next: null,
    },
    bound: { snapshotRevision: inspection?.snapshotRevision ?? null, receiptRevision: receipt?.revision ?? null, contentHash: null },
  };
}
/** A `.prune-*` or `.tmp-*` leftover: partial, never active, nothing bound, its name as its id. */
function leftoverEntry(scope: CacheScope, projectId: string | null, name: string, root: string): Listed {
  const blocked = name.startsWith('.prune-') && leftoverBlocked(join(root, name)) !== null;
  return { entry: { scope, id: name, projectId, status: 'partial', name, active: false, stale: false, kind: null, label: null, skillName: null, files: null, bytes: null, key: null, references: { store: null, project: null }, partialReason: name.startsWith('.prune-') ? 'prune-leftover' : 'write-leftover', next: blocked ? leftoverTreeFix(join(root, name)) ?? NO_COMMAND : null }, bound: { snapshotRevision: null, receiptRevision: null, contentHash: null } };
}
/** One `<kind>-<id>-<hash>` folder of the store cache (3.3, step 3). */
function storeEntry(root: string, name: string, kind: 'skill' | 'prompt' | 'team', id: string, hash: string): Listed | null {
  let status: 'completed' | 'partial' = 'partial', label: string | null = `${kind} ${id}`, files: number | null = null, bytes: number | null = null, contentHash: string | null = null;
  let partialReason: PartialReason | null = 'changed';
  try {
    const read = readStoreCache(root, kind, id, hash);
    if (read === null) return null;
    status = 'completed'; files = read.rows.length; bytes = read.rows.reduce((n, r) => n + r.bytes, 0); contentHash = hash; partialReason = null;
  } catch (error) {
    // A hash mismatch is a changed folder: partial, with its label. Any other refusal is a guard failure: no label.
    if ((error as { code?: unknown } | null)?.code !== 'LOCK_HASH_MISMATCH') { label = null; partialReason = 'unreadable'; }
  }
  return { entry: { scope: 'store', id: hash, projectId: null, status, name, active: false, stale: false, kind: 'store-git', label, skillName: null, files, bytes, key: null, references: { store: null, project: null }, partialReason, next: null }, bound: { snapshotRevision: null, receiptRevision: null, contentHash } };
}

/**
 * Lists the three places, at most CACHE_LIST_LIMIT entries. Reads only. Review H2 of PR 99: a name is an entry only when
 * removeCacheEntry would accept it (steps 0, 0a and 2), so no plan picks a folder that the delete refuses. Any other
 * name counts under `unlisted`, with its reason.
 */
async function scan(input: CacheAdminInput): Promise<Scan> {
  const out: Scan = { entries: [], unlisted: 0, unlistedNames: [], truncated: false };
  const stateRoot = input.stateRoot;
  if (!exists(stateRoot)) return out;
  const full = (): boolean => { if (out.entries.length >= CACHE_LIST_LIMIT) { out.truncated = true; return true; } return false; };
  // Round 3, M-C: a leftover name that the delete refuses gets the command that clears it.
  const unlist = (place: UnlistedName['place'], name: string, reason: string, path: string): void => {
    out.unlisted++;
    const base = name.slice(name.lastIndexOf('/') + 1), next = reason !== NOT_A_NAME && (base.startsWith('.tmp-') || base.startsWith('.prune-')) ? leftoverFix(path) : null;
    if (out.unlistedNames.length < UNLISTED_LIMIT) out.unlistedNames.push({ place, name, reason, next });
  };
  /** The skills cache or one legacy cache: `op-` operations and `.prune-` leftovers. */
  const operations = async (root: string, scope: CacheScope, projectId: string | null): Promise<boolean> => {
    const place = scope === 'machine' ? 'cache' as const : 'legacy' as const, shown = (name: string): string => projectId === null ? name : `${projectId}/${name}`;
    for (const name of sortedNames(root)) {
      const op = OP.exec(name);
      if (op === null && !PRUNE_LEFTOVER.test(name)) { unlist(place, shown(name), NOT_A_NAME, join(root, name)); continue; }
      const problem = cacheEntryProblem(stateRoot, { scope, projectId }, name);
      if (problem !== null) { unlist(place, shown(name), problem, join(root, name)); continue; }
      if (full()) return false;
      out.entries.push(op ? await operationEntry(input, root, scope, projectId, name, op[1]!) : leftoverEntry(scope, projectId, name, root));
    }
    return true;
  };
  const cacheRoot = join(stateRoot, 'cache');
  if (exists(cacheRoot) && !await operations(cacheRoot, 'machine', null)) return out;
  const storeRoot = join(stateRoot, STORE_CACHE_FOLDER);
  if (exists(storeRoot)) {
    for (const name of sortedNames(storeRoot)) {
      const m = STORE_ENTRY.exec(name);
      if (m === null && !PRUNE_LEFTOVER.test(name) && !TMP_LEFTOVER.test(name)) { unlist('store-cache', name, NOT_A_NAME, join(storeRoot, name)); continue; }
      const problem = cacheEntryProblem(stateRoot, { scope: 'store', projectId: null }, name);
      if (problem !== null) { unlist('store-cache', name, problem, join(storeRoot, name)); continue; }
      if (full()) return out;
      const listed = m ? storeEntry(storeRoot, name, m[1] as 'skill' | 'prompt' | 'team', m[2]!, m[3]!) : leftoverEntry('store', null, name, storeRoot);
      if (listed !== null) out.entries.push(listed);
    }
  }
  for (const projectId of sortedNames(stateRoot)) {
    if (!PROJECT_ID.test(projectId)) continue;
    const folder = join(stateRoot, projectId), root = join(folder, 'cache');
    let s: fs.Stats; try { s = fs.lstatSync(folder); } catch { continue; }
    // A project folder with no cache is not a legacy cache. Anything else is checked as removeCacheEntry checks it (step 0a).
    if (s.isDirectory() && !s.isSymbolicLink()) { try { fs.lstatSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; } }
    const problem = cacheRootProblem(stateRoot, { scope: 'project-legacy', projectId });
    if (problem !== null) { unlist('legacy', projectId, problem, folder); continue; }
    if (!await operations(root, 'project-legacy', projectId)) return out;
  }
  return out;
}

const emptySet = (): ReferenceSet => ({ operations: new Map(), storeKeys: new Map() });
function addPin(set: ReferenceSet, entry: Entry): void {
  if (entry.source.kind === 'local') return;
  const digest = entryRequest(entry as PinnedEntry).digest;
  for (let attempt = 0; attempt < CACHE_ATTEMPTS; attempt++) set.operations.set(cacheOperationId(digest, attempt), digest);
}
/** A refusal, or a system error, has a code: the source is then unknown. An error with none is a fault, and is thrown (review M1). */
function unknownBecause(error: unknown, source: SourceName, item: string | null): Unreadable {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{1,100}$/.test(code)) throw error;
  return { source, code, item };
}
type SourceRead = { set: ReferenceSet; unreadable: null } | { set: null; unreadable: Unreadable };
const unread = (unreadable: Unreadable): SourceRead => ({ set: null, unreadable });
/** The store source (3.2): its skills.json pins and its live written items, or why it cannot be read. */
function storeReferences(home: string): SourceRead {
  let item: string | null = null;
  try {
    const found = inspectStore(home);
    if (found.state === 'absent') return { set: emptySet(), unreadable: null };
    // Decision B: a folder at ~/.bowerloom that is not a store may hold what a person thinks of as their store: unknown, not empty.
    if (found.state === 'foreign') return unread({ source: 'store', code: 'STORE_INVALID', item: null });
    // Review S1 of PR 98: an area folder of the store is never read through a link. A linked area makes the store unknown.
    for (const area of ['skills', 'prompts', 'teams']) {
      item = area;
      let s: fs.Stats | null = null; try { s = fs.lstatSync(join(found.context.dir, area)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (s !== null && (!s.isDirectory() || s.isSymbolicLink())) return unread({ source: 'store', code: 'AUTHORING_UNSAFE_PATH', item: area });
    }
    item = 'skills.json';
    const defs = readStoreDefinitions(found.context), set = emptySet();
    for (const entry of defs.skills.values()) {
      item = `skill ${entry.id}`;
      if (entry.source.kind !== 'local') { addPin(set, entry); continue; }
      const hash = localItemRows(found.context.dir, 'skill', entry.id).hash; set.storeKeys.set(storeCacheKey('skill', entry.id, hash), hash);
    }
    for (const [kind, items] of [['prompt', defs.prompts], ['team', defs.teams]] as const) {
      for (const id of items.keys()) { item = `${kind} ${id}`; const hash = localItemRows(found.context.dir, kind, id).hash; set.storeKeys.set(storeCacheKey(kind, id, hash), hash); }
    }
    return { set, unreadable: null };
  } catch (error) { return unread(unknownBecause(error, 'store', item !== null && item === 'skills.json' && /^AUTHORING_/.test(String((error as { code?: unknown }).code)) ? 'authoring/receipt.json' : item)); }
}
/** The project source (3.2): its skills.json pins, its lock pins and its lock hashes, or why it cannot be read. */
function projectReferences(project: ProjectContext): SourceRead {
  let item = '.bowerloom/skills.json';
  try {
    const set = emptySet();
    const state = readManifestState(project.dir, { allowAbsent: true });
    if (state.file) for (const entry of parseManifest(state.file.bytes, MANIFEST_LIMITS).skills) addPin(set, entry);
    item = 'bowerloom.json';
    const config = readConfig(project);
    if (config.state === 'invalid') return unread({ source: 'project', code: config.code, item });
    item = 'bowerloom.lock.json';
    const lock = readLock(project);
    if (lock.state === 'present') {
      for (const [list, kind] of [[lock.lock.skills, 'skill'], [lock.lock.prompts, 'prompt'], [lock.lock.teams, 'team']] as const) {
        for (const entry of list) {
          if ('pin' in entry) addPin(set, entry.pin);
          else set.storeKeys.set(storeCacheKey(kind, entry.id, entry.authored.hash), entry.authored.hash);
        }
      }
    }
    return { set, unreadable: null };
  } catch (error) { return unread(unknownBecause(error, 'project', item)); }
}
/** What the store and the current project refer to (3.2). An unreadable source is null, named in `unreadableSources`, and its cause is in `unreadable`. */
export async function referenceSets(input: CacheAdminInput): Promise<ReferenceSets> {
  const store = storeReferences(input.home);
  const project: SourceRead | null = input.project !== null ? projectReferences(input.project)
    : typeof input.projectError === 'string' ? unread({ source: 'project', code: input.projectError, item: null }) : null;
  const unreadable = [store.unreadable, project?.unreadable ?? null].filter((u): u is Unreadable => u !== null);
  return { store: store.set, project: project?.set ?? null, projectChecked: project?.set != null, unreadableSources: unreadable.map(u => u.source), unreadable };
}
function fillReferences(listed: Listed[], sets: ReferenceSets, inProject: boolean): void {
  for (const { entry } of listed) {
    if (entry.scope === 'project-legacy') { entry.key = null; entry.references = { store: null, project: null }; continue; }
    const leftover = entry.id === entry.name;
    const refers = (set: ReferenceSet | null): string | null | undefined => {
      if (set === null) return undefined;
      if (leftover) return null;
      return (entry.scope === 'machine' ? set.operations.get(entry.id) : set.storeKeys.get(entry.name)) ?? null;
    };
    const s = refers(sets.store), p = refers(sets.project);
    entry.references = { store: s === undefined ? null : s !== null, project: !inProject || p === undefined ? null : p !== null };
    entry.key = s ?? (inProject ? p ?? null : null);
  }
}
const sortListed = (listed: Listed[]): Listed[] => [...listed].sort((a, b) =>
  SCOPES.indexOf(a.entry.scope) - SCOPES.indexOf(b.entry.scope) || byteOrder(a.entry.projectId ?? '', b.entry.projectId ?? '') || byteOrder(a.entry.id, b.entry.id) || byteOrder(a.entry.name, b.entry.name));

interface Observed { listed: Listed[]; scan: Scan; sets: ReferenceSets }
async function observe(input: CacheAdminInput): Promise<Observed> {
  checkState(input);
  const found = await scan(input), sets = await referenceSets(input);
  fillReferences(found.entries, sets, input.project !== null && sets.project !== null);
  return { listed: sortListed(found.entries), scan: found, sets };
}

/** `cache list` (3.3): what the three places hold. Reads only, takes no lock, writes nothing. */
export async function listCache(input: CacheAdminInput): Promise<CacheList> {
  const { listed, scan: found, sets } = await observe(input);
  const entries = listed.map(l => l.entry);
  return {
    format: CACHE_LIST_FORMAT, stateRoot: input.stateRoot, entries,
    totals: { entries: entries.length, bytes: entries.reduce((n, e) => n + (e.status === 'completed' && e.bytes !== null ? e.bytes : 0), 0) },
    unlisted: found.unlisted, truncated: found.truncated, unreadableSources: sets.unreadableSources,
    unlistedNames: found.unlistedNames, unreadable: sets.unreadable,
  };
}

/** A usage error of the cache commands. Its next step is the cache help (spec 09, section 5). */
export const cacheUsage = (message: string): DefinitionError => Object.assign(new DefinitionError('USAGE', message), { next: 'bowerloom help cache' });
const usage = (message: string): never => { throw cacheUsage(message); };
export const CACHE_USAGE = 'Use bowerloom cache list [--json] or bowerloom cache prune with a selector. See bowerloom help cache.';
const PREFIX = /^[a-f0-9]{8,64}$/;
/** The selector rules of 3.4. A broken rule is USAGE. */
export function checkSelectors(selectors: CachePruneSelectors): void {
  const s = selectors;
  if (!s || !Array.isArray(s.entries)) usage(CACHE_USAGE);
  if (!s.unreferenced && !s.partial && !s.legacy && !s.all && s.entries.length === 0) usage(CACHE_USAGE);
  if (s.all && (s.unreferenced || s.partial || s.legacy || s.entries.length > 0)) usage(CACHE_USAGE);
  for (const prefix of s.entries) if (typeof prefix !== 'string' || !(PREFIX.test(prefix) || STORE_ENTRY.test(prefix) || LEGACY_PREFIX.test(prefix))) usage(CACHE_USAGE);
  if (new Set(s.entries).size !== s.entries.length) usage(CACHE_USAGE);
}
/** In use: an owner holds it. An owner lock older than a day does not count (3.4; decision D: for --legacy too). */
const busy = (e: CacheEntry): boolean => e.active && !e.stale;
/** The group selectors that pick an entry, and those that would pick it but for its owner (3.4). */
function groupPick(e: CacheEntry, s: CachePruneSelectors, sourcesKnown: boolean): { pick: boolean; skip: boolean } {
  let pick = false, skip = false;
  const want = (matches: boolean, inUse: boolean): void => { if (!matches) return; if (inUse) skip = true; else pick = true; };
  if (s.unreferenced && sourcesKnown) want(e.scope !== 'project-legacy' && e.status === 'completed' && e.references.store === false && e.references.project !== true, e.active);
  if (s.partial) want(e.status === 'partial', busy(e));
  if (s.legacy) want(e.scope === 'project-legacy', busy(e));
  if (s.all) want(true, busy(e));
  return { pick, skip: skip && !pick };
}
/** The entries an `--entry` prefix names (3.4). */
function entryMatches(listed: Listed[], prefix: string): Listed[] {
  if (STORE_ENTRY.test(prefix)) return listed.filter(l => l.entry.scope === 'store' && l.entry.name === prefix);
  // Review L2 of PR 99: `<projectId>/<id-prefix>`, as cache list prints a legacy entry, picks one of two projects.
  const legacy = LEGACY_PREFIX.exec(prefix);
  if (legacy) return listed.filter(l => l.entry.scope === 'project-legacy' && l.entry.id !== l.entry.name && l.entry.projectId!.startsWith(legacy[1]!) && l.entry.id.startsWith(legacy[2]!));
  return listed.filter(l => l.entry.id !== l.entry.name && l.entry.id.startsWith(prefix));
}
function pickedOf(l: Listed): PickedEntry {
  const e = l.entry;
  return { scope: e.scope, id: e.id, name: e.name, projectId: e.projectId, status: e.status, label: e.label, files: e.files, bytes: e.bytes, references: { ...e.references }, stale: e.active && e.stale, partialReason: e.partialReason, bound: { ...l.bound } };
}
/** How a two-match USAGE names an entry: a form that --entry takes. */
const matchName = (e: CacheEntry): string => e.scope === 'machine' ? `cache ${e.id}` : e.scope === 'store' ? `store-cache ${e.name}` : `legacy ${e.projectId}/${e.id}`;
/** How a plan line names an entry: `<place> <id8>`, or the whole name of a leftover (3.4). */
export const lineName = (e: { scope: CacheScope; projectId: string | null; id: string; name: string }): string => `${e.scope === 'machine' ? 'cache' : e.scope === 'store' ? 'store-cache' : `legacy ${e.projectId!.slice(0, 8)}`} ${e.id === e.name ? e.name : e.id.slice(0, 8)}`;
const relPath = (e: { scope: CacheScope; projectId: string | null; name: string }): string => `${e.scope === 'machine' ? 'cache' : e.scope === 'store' ? 'store-cache' : `${e.projectId}/cache`}/${e.name}`;
const placeKey = (e: { scope: string; projectId: string | null; name: string }): string => `${e.scope}\0${e.projectId ?? ''}\0${e.name}`;

/** The plan body for selectors over an observation, before its revision. */
function planBody(input: CachePruneInput, seen: Observed): Omit<CachePrunePlan, 'revision'> {
  const s = input.selectors, known = seen.sets.unreadableSources.length === 0;
  const picked = new Map<string, Listed>(), skipped = new Map<string, Listed>();
  for (const l of seen.listed) { const g = groupPick(l.entry, s, known); if (g.pick) picked.set(placeKey(l.entry), l); else if (g.skip) skipped.set(placeKey(l.entry), l); }
  for (const prefix of s.entries) {
    const found = entryMatches(seen.listed, prefix);
    if (found.length === 0) throw syncError('CACHE_ENTRY_NOT_FOUND');
    if (found.length > 1) usage(`The prefix matches more than one entry. Use more characters. It matches ${found.map(l => matchName(l.entry)).join(', ')}.`);
    if (busy(found[0]!.entry)) throw syncError('CACHE_ENTRY_BUSY');
    picked.set(placeKey(found[0]!.entry), found[0]!); skipped.delete(placeKey(found[0]!.entry));
  }
  // Round 3, M-A: a .prune- leftover goes after every other pick, so one that cannot be deleted never blocks the rest.
  const sorted = sortListed([...picked.values()]), isPrune = (l: Listed): boolean => l.entry.name.startsWith('.prune-');
  // Round 5, L-2: a leftover that cannot be deleted as it is (it has a fix) goes after every other leftover.
  const blocked = (l: Listed): boolean => l.entry.next !== null;
  const order = [...sorted.filter(l => !isPrune(l)), ...sorted.filter(l => isPrune(l) && !blocked(l)), ...sorted.filter(l => isPrune(l) && blocked(l))].map(pickedOf);
  return {
    format: CACHE_PRUNE_PLAN_FORMAT, stateRoot: input.stateRoot,
    selectors: { unreferenced: s.unreferenced, partial: s.partial, legacy: s.legacy, all: s.all, entries: [...s.entries] },
    picked: order,
    skipped: sortListed([...skipped.values()]).map(l => ({ scope: l.entry.scope, id: l.entry.id, projectId: l.entry.projectId, reason: 'active' as const, label: l.entry.label })),
    freed: order.reduce((n, p) => n + (p.bytes ?? 0), 0),
    projectChecked: seen.sets.projectChecked, truncated: seen.scan.truncated, unreadableSources: [...seen.sets.unreadableSources], unreadable: seen.sets.unreadable.map(u => ({ ...u })), unlisted: seen.scan.unlisted,
    writesAuthorized: false, executionAuthorized: false,
  };
}
/** The revision of a plan: sha256 over the canonical JSON of its body (4.2). */
export const pruneRevision = (body: Omit<CachePrunePlan, 'revision'>): string => sha256(canonicalJson(body));

/** `cache prune` plan (3.4). Reads only. */
export async function planCachePrune(input: CachePruneInput): Promise<CachePrunePlan> {
  checkSelectors(input.selectors);
  const body = planBody(input, await observe(input));
  return { ...body, revision: pruneRevision(body) };
}

const stale = (why?: string): DefinitionError => why === undefined ? syncError('STALE_APPROVAL') : syncError('STALE_APPROVAL', why);
/** Review L6 of PR 99: a STALE_APPROVAL under the lock names the entry and what changed. */
const changed = (p: PickedEntry, what: string): DefinitionError => stale(`Entry ${lineName(p)} changed after the plan: ${what}.`);
/** The `<stateRoot>/cache` folder that the cache lock is keyed on, made private when missing (3.4): the only folder prune creates. */
function lockFolder(stateRoot: string): string {
  const cacheRoot = join(stateRoot, 'cache'), layout = cacheLayout(stateRoot);
  if (layout.missing.includes(cacheRoot)) {
    if (layout.missing.length !== 1) throw stale('The private state folder is gone since the plan.');
    try { directory(dirname(cacheRoot)); fs.mkdirSync(cacheRoot, { mode: 0o700 }); fs.chmodSync(cacheRoot, 0o700); directory(cacheRoot, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
  }
  return cacheRoot;
}
/** The interrupt of a prune: an AbortError with the count of entries it deleted and the entry it stopped at. */
export interface PruneInterrupt extends Error { deleted: number; of: number; stoppedAt: string }
const interrupt = (deleted: number, of: number, stoppedAt: string): PruneInterrupt => Object.assign(new Error(`cache prune stopped. Deleted ${deleted} of ${of} entries. It stopped at ${stoppedAt}.`), { name: 'AbortError', deleted, of, stoppedAt });
const codeOf = (error: unknown): string => { const c = (error as { code?: unknown } | null)?.code, n = (error as { name?: unknown } | null)?.name; return typeof c === 'string' ? c : typeof n === 'string' ? n : 'Error'; };
const withCause = <E extends Error>(error: E, cause: unknown): E => { if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause, enumerable: false }); return error; };

/**
 * `cache prune` apply (3.4). Plans again and requires the approved revision. Then, under the cache lock, lists again and
 * requires every picked entry to be there with the same bound values, status, label and size, still pickable by the
 * selectors (for --unreferenced, with every source readable and none listing it), and not in use. Any difference refuses
 * STALE_APPROVAL, naming the entry, before anything is deleted. A new entry that is not in the plan stays. Each entry then
 * goes through removeCacheEntry in plan order. The loop yields before each entry, so an interrupt and the cache lock's
 * own listener run between two deletes (review H1). A failure refuses CACHE_PRUNE_FAILED and names the entry, the step,
 * and how far it got; a lost lock refuses PROJECT_LOCK_UNAVAILABLE with the same count (review H2).
 */
export async function applyCachePrune(input: CachePruneInput, revision: string, signal: AbortSignal): Promise<CachePruneResult> {
  const plan = await planCachePrune(input);
  if (plan.revision !== revision) throw stale();
  const result = (deleted: CachePruneResult['deleted']): CachePruneResult => ({ format: CACHE_PRUNE_RESULT_FORMAT, planRevision: revision, deleted, skipped: plan.skipped.map(s => ({ scope: s.scope, id: s.id, projectId: s.projectId, reason: s.reason })), freed: plan.freed, executionAuthorized: false });
  if (plan.picked.length === 0) return result([]);
  if (signal.aborted) throw interrupt(0, plan.picked.length, lineName(plan.picked[0]!));
  const cacheRoot = lockFolder(input.stateRoot);
  return withCacheLock(cacheRoot, signal, async held => {
    await input.hooks?.underLock?.();
    const now = await observe(input), known = now.sets.unreadableSources.length === 0;
    const current = new Map(now.listed.map(l => [placeKey(l.entry), l]));
    for (const p of plan.picked) {
      const l = current.get(placeKey(p));
      if (l === undefined) throw changed(p, 'it is gone');
      if (busy(l.entry)) throw changed(p, 'another command is using it now');
      const again = pickedOf(l);
      if (again.status !== p.status) throw changed(p, `its status is now ${again.status}`);
      if (canonicalJson({ ...again, references: null }) !== canonicalJson({ ...p, references: null })) throw changed(p, 'its bytes changed');
      const viaEntry = input.selectors.entries.some(prefix => entryMatches(now.listed, prefix).some(m => placeKey(m.entry) === placeKey(p)));
      // groupPick reads the references of now: a source that lists the entry, or cannot be read, ends an --unreferenced pick.
      if (!groupPick(l.entry, input.selectors, known).pick && !viaEntry) {
        const u = now.sets.unreadable[0];
        throw changed(p, u !== undefined ? `${u.source} can no longer be read (${u.code})` : 'your store or this project now lists it');
      }
    }
    const deleted: CachePruneResult['deleted'] = [], of = plan.picked.length;
    for (const [index, p] of plan.picked.entries()) {
      // Review H1: a macrotask turn between two deletes, so SIGINT and the lock listener run.
      await new Promise<void>(done => setImmediate(done));
      if (signal.aborted) throw interrupt(deleted.length, of, lineName(p));
      let step: 0 | 1 = 0;
      const guard = { assertHeld: (): void => { held.assertHeld(); input.hooks?.heldCheck?.(index, step); step = 1; } };
      try { await removeCacheEntry(input.stateRoot, { scope: p.scope, projectId: p.projectId }, p.name, guard); }
      catch (error) {
        const count = `Deleted ${deleted.length} of ${of} entries. It stopped at ${lineName(p)}.`;
        if (codeOf(error) === 'PROJECT_LOCK_UNAVAILABLE') throw withCause(new DefinitionError('PROJECT_LOCK_UNAVAILABLE', `${(error as Error).message} ${count}`), error);
        if (error instanceof CachePruneRefusal) {
          const refusal = withCause(syncError('CACHE_PRUNE_FAILED', `Could not delete ${error.where}${error.reason.startsWith('at the ') ? ' ' : ': '}${error.reason}. ${count}${error.fix ? RUN_FIX : ''}`), error.cause);
          throw error.next === undefined ? refusal : Object.assign(refusal, { next: error.next, ...(error.fix ? { fix: error.fix } : {}) });
        }
        // L-c: a fault with no code is the code's own fault, and passes through as itself.
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code !== 'string') throw error;
        throw withCause(syncError('CACHE_PRUNE_FAILED', `Could not delete ${relPath(p)} at the ${step === 0 ? 'check' : 'delete'} step (${code}). ${count}`), code);
      }
      deleted.push({ scope: p.scope, id: p.id, projectId: p.projectId });
      await input.hooks?.afterRemove?.(index);
    }
    return result(deleted);
  }, { waitMs: PRUNE_LOCK_WAIT_MS });
}
