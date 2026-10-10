/**
 * `skills sync` planning (build plan 01, sections 3 and 4, M5). Reads only: the project, `.bowerloom/skills.json`,
 * the authored local skills, the managed catalogs and receipts, and the private cache. It never creates a folder and
 * never reads the network.
 *
 * The plan, `bowerloom/skills-sync-plan/v1beta1`, binds every input that a child approval binds: the project and
 * private-state ancestry, the manifest sha256, each pin's request digest and cache operation id, the expected
 * material and surfaces per item, the before-pins of every item surface, each previous receipt and the harness set.
 * Its revision is the one approval that stands in for every child approval of the run.
 */
import fs from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { revisionOf, freezeSkillData } from '../../skill-sources/src/validation.js';
import { LIMITS, OP_TEMP, directory, exists, names, path as managedPath, raw, stablePins, temporary } from '../../managed-skills/src/observed.js';
import { MANAGED_ROOT, MARKER_V2, catalogItem, currentV2, ignoreState, locateV2, matchesV2, ownSurface, readPending, receiptAtV2, surfaceV2 } from '../../managed-skills/src/v2-observed.js';
import { readLocalSkill } from '../../managed-skills/src/local-source.js';
import { legacyPresent } from '../../managed-skills/src/migrate.js';
import type { Identity } from '../../managed-skills/src/observed-types.js';
import type { Harness, InventoryRow, ItemClosure, ManagedItemReceipt, ManagedItemRequest, SurfaceId, SurfaceKind } from '../../managed-skills/src/v2-types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { isId, parseManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, Manifest, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { pinOf } from '../../skill-manifest/src/check.js';
import { verifyProjectPins } from '../../project-context/src/index.js';
import type { DirectoryIdentity, PinnedDirectory, ProjectContext } from '../../project-context/src/types.js';
import { entryRequest, lookupCache } from './cache-index.js';
import type { CacheLookup, PinnedRequest } from './cache-index.js';
import { managedCode, outward, syncError } from './refusal.js';

export const SYNC_PLAN_FORMAT = 'bowerloom/skills-sync-plan/v1beta1' as const;
/** The free space each child keeps beyond its own bytes, the managed-skills minimum; also the cache reserve. */
export const MIN_FREE_BYTES = 33554432;
/** At most this many items in one plan: 32 manifest skills and 32 orphans. */
export const SYNC_ITEM_LIMIT = 64;
const HOSTS = { npm: 'registry.npmjs.org', git: 'api.github.com' } as const;

export interface SyncInput {
  project: ProjectContext; stateRoot: string; team: string | null; offline: boolean;
  /**
   * Set only by `bowerloom apply` (M6): the harnesses it adds copies for, in place of the skills.json set. A copy for a
   * harness outside this set is kept as it is and never reported as one to remove. Absent for `skills sync`.
   */
  apply?: { harnesses: Harness[] };
}
export type ItemState = 'up-to-date' | 'needs-fetch' | 'cached' | 'drift' | 'pin-changed' | 'harnesses-changed' | 'orphaned' | 'local';
export type ItemAction = 'none' | 'install' | 'update' | 'hold';
export interface ItemSurface { id: SurfaceId; path: string }
export interface SyncItem {
  id: string;
  /** The skills.json source kind; null for an orphan, which skills.json no longer names. */
  kind: 'npm' | 'git' | 'local' | null;
  /** The pin in one line, as `skills check` prints it: `<package>@<version>:<path>`, `<owner>/<repo>@<commit>:<path>` or the local path. */
  pin: string | null;
  state: ItemState; action: ItemAction;
  /** The child request's harnesses: the installed set plus the skills.json set. A harness is never dropped. */
  harnesses: Harness[];
  requestDigest: string | null; cacheOperationId: string | null; cache: CacheLookup | null;
  /** Paths relative to the project. `files` is the material of every copy: the pinned inventory, or the authored one. */
  expected: { files: InventoryRow[]; surfaces: ItemSurface[] };
  before: { id: SurfaceId; path: string; stablePinsDigest: string | null }[];
  previousReceiptRevision: string | null;
  /** Operations in the item's private history (at most LIMITS.history). */
  history: number;
  /** The skill's `allowed-tools`, when it declares any. Part of the plan, so an approval binds it. */
  allowedTools?: string;
  /** Why the item is held, and the next step for a person. Null unless `action` is `hold`. */
  hold: { code: string; next: string } | null;
}
export interface SyncPlan {
  format: typeof SYNC_PLAN_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity };
  manifest: { sha256: string; bytes: number };
  harnesses: Harness[]; team: string | null; offline: boolean;
  privateState: { root: string; projectId: string; cacheRoot: string; itemsRoot: string; create: string[]; pins: { path: string; identity: Identity }[] };
  managed: { ignore: 'absent' | 'exact' };
  items: SyncItem[];
  network: { required: boolean; hosts: string[] };
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
/** The plan and what apply needs beside it: the parsed entries and the private folders by item. */
export interface Observed { plan: SyncPlan; entries: ReadonlyMap<string, Entry>; manifest: Manifest }

const sameValue = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const actionable = (i: SyncItem): boolean => i.action === 'install' || i.action === 'update';
export const isActionable = actionable;
const NULL_PINS = revisionOf(null);

/** The project folders discovery pinned are still those folders, and so is every ancestor. */
export function checkProjectAncestry(project: ProjectContext): void {
  verifyProjectPins(project);
  for (const a of project.ancestry) {
    let s: fs.BigIntStats; try { s = fs.lstatSync(a.path, { bigint: true }); } catch { throw syncError('STALE_APPROVAL'); }
    if (!s.isDirectory() || s.isSymbolicLink() || s.dev.toString() !== a.identity.device || s.ino.toString() !== a.identity.inode || s.birthtimeNs.toString() !== a.identity.birthtimeNs) throw syncError('STALE_APPROVAL');
  }
}

function requireTeam(project: ProjectContext, team: string): void {
  let ok = false;
  try { const s = fs.lstatSync(join(project.dir, '.bowerloom', 'teams', team)); ok = s.isDirectory() && !s.isSymbolicLink(); } catch { ok = false; }
  if (!ok) throw manifestRefusal('TEAM_NOT_FOUND');
}

/** The pending marker names an unfinished operation: refuse, and name the item to recover. */
export function pendingRefusal(project: string): Error {
  try { const m = readPending(project); const id = m.item.kind === 'prompt' ? 'prompt-' + m.item.id : m.item.id; return syncError('MANAGED_SKILL_RECOVERY_REQUIRED', `It belongs to ${id}. Run bowerloom skills recover plan --item ${id}.`); }
  catch { return syncError('MANAGED_SKILL_RECOVERY_REQUIRED', 'Run bowerloom status, then bowerloom skills recover plan --item <id>.'); }
}

const within = (inner: string, outer: string): boolean => inner === outer || inner.startsWith(outer === '/' ? '/' : outer + '/');
/**
 * True when the private state root and the project are nested either way: by path, or by device and inode along the
 * ancestry, so a symlink, a case alias or a `/System/Volumes/Data` spelling of one folder is caught too.
 */
function nested(project: ProjectContext, stateRoot: string, statePins: readonly { path: string; identity: Identity }[]): boolean {
  if (within(stateRoot, project.dir) || within(project.dir, stateRoot)) return true;
  const key = (id: { device: string; inode: string }) => `${id.device}:${id.inode}`, projectKey = key(project.identity);
  // The state root, or a folder above it, is the project: the state is inside the project.
  if (statePins.some(p => key(p.identity) === projectKey)) return true;
  // The project, or a folder above it, is the state root or one of its existing folders: the project is inside the state.
  const below = new Set(statePins.filter(p => within(p.path, stateRoot)).map(p => key(p.identity)));
  return [project.identity, ...project.ancestry.map(a => a.identity)].some(id => below.has(key(id)));
}

export interface StateLayout { root: string; cacheRoot: string; itemsRoot: string }
/** The existing folders of the private state chain, pinned, and the private ones checked 0700. */
export function stateLayout(input: Pick<SyncInput, 'project' | 'stateRoot'>): StateLayout & { pins: { path: string; identity: Identity }[]; missing: string[] } {
  const root = join(input.stateRoot, input.project.projectId), cacheRoot = join(root, 'cache'), itemsRoot = join(root, 'items');
  try {
    for (const p of [input.stateRoot, root, cacheRoot, itemsRoot]) managedPath(p);
    const chain: string[] = []; for (let at = input.stateRoot; at !== '/'; at = dirname(at)) chain.unshift(at);
    const privateOnes = new Set([root, cacheRoot, itemsRoot]), pins: { path: string; identity: Identity }[] = [], missing: string[] = [];
    for (const p of [...chain, root, cacheRoot, itemsRoot]) {
      if (!exists(p)) { missing.push(p); continue; }
      if (missing.length && !privateOnes.has(p)) throw syncError('SKILLS_STATE_UNSAFE');
      pins.push({ path: p, identity: directory(p, privateOnes.has(p)) });
    }
    // Only the end of the chain may be missing: a folder inside a missing one cannot exist.
    if (missing.length > 8 || missing.some(p => pins.some(q => q.path.startsWith(p + '/')))) throw syncError('SKILLS_STATE_UNSAFE');
    // Review M5 finding 1: the private state and the project are never nested, either way. Receipts and cached bytes
    // in the project could be committed, and a project inside the state folder could be swept by it.
    if (nested(input.project, input.stateRoot, pins)) throw syncError('SKILLS_STATE_UNSAFE', 'The private state folder and the project must not be inside one another. Set XDG_STATE_HOME to a folder outside the project.');
    return { root, cacheRoot, itemsRoot, pins, missing };
  } catch (e) { if (e instanceof Error && 'code' in e && e.code === 'SKILLS_STATE_UNSAFE') throw e; throw syncError('SKILLS_STATE_UNSAFE'); }
}

/** The item surfaces of a skill for these harnesses, as the managed planner places them. */
export function itemSurfaces(project: string, id: string, name: string, harnesses: Harness[]): { id: SurfaceId; kind: SurfaceKind; path: string }[] {
  const req = { projectDir: project, item: { kind: 'skill', id }, harnesses } as unknown as ManagedItemRequest;
  return locateV2(req, { name } as ItemClosure, { ignore: false, legacy: false }).filter(ownSurface);
}
export function beforePins(surfaces: { id: SurfaceId; kind: SurfaceKind; path: string }[], project: string): SyncItem['before'] {
  return surfaces.map(s => { let digest: string | null; try { digest = revisionOf(stablePins(surfaceV2(s.id, s.kind, s.path).pins)); } catch { digest = null; } return { id: s.id, path: relative(project, s.path), stablePinsDigest: digest }; });
}
export const union = (a: readonly Harness[], b: readonly Harness[]): Harness[] => (['claude', 'codex'] as Harness[]).filter(h => a.includes(h) || b.includes(h));
export const byPath = (rows: InventoryRow[]): InventoryRow[] => [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));

export interface CatalogView { source: Record<string, unknown>; skill: { name?: unknown; sourceRoot?: unknown } | null; inventory: unknown }
export function readCatalog(file: string): CatalogView {
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw(file, 262144, false).bytes), 262144) as Record<string, unknown>;
  return { source: value.source as Record<string, unknown>, skill: value.skill as CatalogView['skill'], inventory: value.inventory };
}
/** The fields that name where a skill comes from: a skill keeps them for its whole life. */
function sameOrigin(entry: Entry, c: CatalogView): boolean {
  const s = entry.source, was = c.source;
  if (s.kind === 'local') return was.kind === 'local' && was.path === s.path;
  const skill = (entry as PinnedEntry).skill;
  if (!(c.skill && c.skill.name === skill.name && c.skill.sourceRoot === skill.sourceRoot)) return false;
  return s.kind === 'npm' ? was.kind === 'npm' && was.package === s.package && was.registry === s.registry : was.kind === 'git' && was.host === s.host && was.repository === s.repository;
}
/** The exact pin: npm version, integrity, metadata and publisher, or the Git commit, trees and metadata. */
function samePin(entry: Entry, c: CatalogView): boolean {
  const s = entry.source, was = c.source;
  if (s.kind === 'local') return true;
  if (s.kind === 'npm') return was.version === s.version && was.integrity === s.integrity && was.metadataSha256 === s.metadataSha256 && was.publisher === s.publisher;
  return was.commit === s.commit && was.tree === s.tree && sameValue(was.pathTrees, s.pathTrees) && was.metadataSha256 === s.metadataSha256;
}

/** The hold of an item whose private folder holds entries that are not Bowerloom operations. Names are relative. */
export function strayHold(itemId: string, stray: readonly string[], rerun: string): { code: string; next: string } {
  const shown = stray.slice(0, 4).map(n => `items/${itemId}/${n}`).join(', ') + (stray.length > 4 ? ` and ${stray.length - 4} more` : '');
  return { code: 'SKILLS_STATE_STRAY_ENTRY', next: `Bowerloom keeps only its own op-<key> folders in the private state folder of ${itemId}. Move ${shown} out of the private state folder with mv in a terminal (Finder adds a .DS_Store), then run ${rerun}.` };
}
/** The manual history rule. Names are relative to the private state folder; `mv` keeps Finder from adding entries. */
export function historyNext(itemId: string, keep: string, rerun: string): string {
  return `Bowerloom deletes no history by itself. With mv in a terminal, move every op-<key> folder except ${keep} out of items/${itemId} in the private state folder into a folder of your own, then run ${rerun}.`;
}
export const recoverNext = (id: string) => `Run bowerloom skills recover plan --item ${id}, then bowerloom skills sync.`;
/**
 * The next step of a copy changed by hand. `source` is the project's own source of the copies (a local skill folder or a
 * prompt file): edits to keep go there. A pinned skill has none, so its edits go into a skill of the person's own.
 * Review freeze finding 15: a local skill is already the person's own.
 */
export const driftNext = (paths: string[], source: string | null = null) => source !== null
  ? `Undo your edits in ${paths.join(', ')} (to keep them, put them in ${source}, the source of the copies), then run bowerloom skills sync. Sync never overwrites a changed copy.`
  : `Undo your edits in ${paths.join(', ')} (or copy them into a skill of your own with bowerloom skill create <name>), then run bowerloom skills sync. Sync never overwrites a changed copy.`;

interface ItemContext { input: SyncInput; manifest: Manifest; layout: StateLayout; ignore: 'absent' | 'exact'; target: Harness[] }
/** The paths of the item surfaces that differ from the closest committed receipt: what a person changed. */
export function driftedPaths(project: string, stateDir: string, id: string): string[] {
  let best: string[] | null = null;
  try {
    for (const n of names(stateDir)) {
      if (!/^op-[a-f0-9]{64}$/.test(n) || !exists(join(stateDir, n, 'receipt.json'))) continue;
      const r = receiptAtV2(stateDir, n.slice(3)); if (r.state !== 'committed' || r.item.id !== id) continue;
      const changed = r.installed.filter(ownSurface).filter(s => { try { return !matchesV2([surfaceV2(s.id, s.kind, s.path)], [s]); } catch { return true; } }).map(s => relative(project, s.path));
      if (changed.length && (best === null || changed.length < best.length)) best = changed;
    }
  } catch { /* The hint falls back to every surface. */ }
  return best ?? [];
}
interface Classified { item: SyncItem; pinned: PinnedRequest | null }
function classify(entry: Entry, ctx: ItemContext): Classified {
  const dir = ctx.input.project.dir, id = entry.id, kind = entry.source.kind, stateDir = join(ctx.layout.itemsRoot, id);
  const name = kind === 'local' ? id : (entry as PinnedEntry).skill.name;
  const pinned = kind === 'local' ? null : entryRequest(entry as PinnedEntry);
  let hold: SyncItem['hold'] = null, heldCode: string | null = null, state: ItemState = 'drift', action: ItemAction = 'hold', previous: ManagedItemReceipt | null = null;
  let harnesses = [...ctx.target];
  // The material every copy gets: the pinned inventory, or what the authored folder holds now.
  let files: InventoryRow[] = [];
  if (pinned) files = byPath(pinned.request.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })));
  else { try { files = [...readLocalSkill(dir, 'skills/' + id, () => {}).inventory]; } catch (e) { hold = { code: managedCode(e), next: `Check .bowerloom/skills/${id}: it must be a folder with a SKILL.md, of plain text files you own, with no links or hidden files. Then run bowerloom skills sync.` }; } }

  // The item's private history: only finished operations, each with its receipt.
  let ops: string[] = [];
  if (exists(stateDir)) {
    try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
    const all = names(stateDir).filter(n => !OP_TEMP.test(n)); ops = all.filter(n => /^op-[a-f0-9]{64}$/.test(n));
    // Review M5 finding 3: an entry that is no operation of Bowerloom's (a Finder .DS_Store) is named, not sent to recovery.
    const stray = all.filter(n => !ops.includes(n));
    if (stray.length) hold ??= strayHold(id, stray, 'bowerloom skills sync');
    else if (ops.some(n => !exists(join(stateDir, n, 'receipt.json')))) hold ??= { code: 'MANAGED_SKILL_RECOVERY_REQUIRED', next: recoverNext(id) };
  }
  const catalog = join(dir, MANAGED_ROOT, 'catalog', id + '.json');
  if (!exists(catalog)) { state = kind === 'local' ? 'local' : 'needs-fetch'; action = 'install'; }
  else if (!exists(stateDir)) {
    hold ??= { code: 'MANAGED_SKILL_PATH_OCCUPIED', next: `.bowerloom/managed/catalog/${id}.json was not installed by Bowerloom on this machine. Move it and the copies of ${id} out of the project, then run bowerloom skills sync.` };
  } else {
    try { previous = currentV2(dir, stateDir, { kind: 'skill', id }); } catch (e) { previous = null; heldCode = managedCode(e); }
    if (previous !== null) {
      harnesses = union(previous.harnesses, ctx.target);
      const c = readCatalog(catalog), add = harnesses.length > previous.harnesses.length, drop = !ctx.input.apply && previous.harnesses.some(h => !ctx.manifest.harnesses.includes(h));
      if (!sameOrigin(entry, c)) hold ??= { code: 'MANAGED_SKILL_REFUSED', next: `skills.json now names another source for ${id}. A skill keeps its source: restore the old entry, or add the new source under another id with --id.` };
      else if (!samePin(entry, c)) { state = 'pin-changed'; action = 'update'; }
      else if (!sameValue(c.inventory, files)) {
        // The same immutable pin with other file hashes: skills.json contradicts what was installed from that pin.
        if (pinned) throw syncError('SKILLS_SYNC_CONTENT_MISMATCH', `skills.json lists other file hashes for the same pin of ${id}.`);
        state = 'local'; action = 'update';
      } else if (add) { state = 'harnesses-changed'; action = 'update'; }
      else if (drop) { state = 'harnesses-changed'; action = 'none'; }
      else { state = 'up-to-date'; action = 'none'; }
    }
  }
  const surfaces = itemSurfaces(dir, id, name, harnesses), before = beforePins(surfaces, dir);
  if (heldCode !== null && hold === null) {
    const changed = heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftedPaths(dir, stateDir, id) : [];
    hold = { code: heldCode, next: heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftNext(changed.length ? changed : before.map(b => b.path), kind === 'local' ? `.bowerloom/skills/${id}` : null) : heldCode === 'MANAGED_SKILL_PATH_OCCUPIED'
      ? `.bowerloom/managed/catalog/${id}.json has no receipt on this machine. Move it and the copies of ${id} out of the project, then run bowerloom skills sync.` : `Run bowerloom status to see what changed in the copies of ${id}.` };
  }
  if (action === 'install' && hold === null) {
    const taken = before.filter(b => b.stablePinsDigest !== NULL_PINS).map(b => b.path);
    if (taken.length) hold = { code: 'MANAGED_SKILL_PATH_OCCUPIED', next: `Move ${taken.join(', ')} out of the way (Bowerloom did not install it), then run bowerloom skills sync.` };
  }
  if ((action === 'install' || action === 'update') && hold === null && ops.length >= LIMITS.history) {
    const keep = previous ? `op-${previous.operationKey}` : 'the newest op-<key> folder';
    hold = { code: 'MANAGED_SKILL_HISTORY_FULL', next: historyNext(id, keep, 'bowerloom skills sync') };
  }
  if (hold !== null) action = 'hold';
  return {
    pinned,
    item: {
      id, kind, pin: pinOf(entry), state, action, harnesses, requestDigest: pinned?.digest ?? null, cacheOperationId: null, cache: null,
      expected: { files, surfaces: surfaces.map(s => ({ id: s.id, path: relative(dir, s.path) })) }, before,
      previousReceiptRevision: previous?.revision ?? null, history: ops.length, hold,
      ...(kind !== 'local' && (entry as PinnedEntry).skill.allowedTools !== undefined ? { allowedTools: (entry as PinnedEntry).skill.allowedTools } : {}),
    },
  };
}

/**
 * The item that puts back a missing shared ignore file when nothing else changes: the first up-to-date item of
 * skills.json with room left in its private history. Undefined when there is none.
 */
export function ignoreCarrier<T extends { state: string; kind: unknown; history: number; action: string }>(items: readonly T[]): T | undefined {
  return items.find(i => i.state === 'up-to-date' && i.kind !== null && i.action === 'none' && i.history < LIMITS.history);
}
/**
 * Two skills.json entries whose copies would take one place (one skill name, or an npm name equal to a local id):
 * every later one is held, with the earlier one named. Holding keeps the file usable: the schema still accepts it,
 * so `skills check` and every other skill work on each machine; refusing the file would block them all.
 * Places are compared case-folded, as a case-insensitive volume would.
 */
export function holdSharedPlaces(items: SyncItem[]): void {
  const owner = new Map<string, string>();
  for (const item of items) {
    if (item.state === 'orphaned') continue;
    const clash = item.expected.surfaces.map(s => ({ path: s.path, other: owner.get(s.path.normalize('NFC').toLowerCase()) })).find(c => c.other !== undefined && c.other !== item.id);
    if (clash && (item.action === 'install' || item.action === 'update' || item.hold?.code === 'MANAGED_SKILL_PATH_OCCUPIED')) {
      item.action = 'hold';
      item.hold = { code: 'MANAGED_SKILL_PATH_OCCUPIED', next: `${item.id} would go to ${clash.path}, where ${clash.other} goes. Give one of them another skill name or id in .bowerloom/skills.json, then run bowerloom skills sync.` };
      continue;
    }
    for (const s of item.expected.surfaces) { const k = s.path.normalize('NFC').toLowerCase(); if (!owner.has(k)) owner.set(k, item.id); }
  }
}

/** A managed skill whose catalog is here and whose id skills.json no longer names. It is kept, never removed. */
function orphan(project: string, itemsRoot: string, id: string): SyncItem {
  let previous: ManagedItemReceipt | null = null;
  try { previous = currentV2(project, join(itemsRoot, id), { kind: 'skill', id }); } catch { previous = null; }
  return { id, kind: null, pin: null, state: 'orphaned', action: 'none', harnesses: previous ? [...previous.harnesses] : [], requestDigest: null, cacheOperationId: null, cache: null, expected: { files: [], surfaces: [] }, before: [], previousReceiptRevision: previous?.revision ?? null, history: 0, hold: null };
}

/** Plans the sync. Reads only. Every refusal here happens before any write anywhere. */
export async function observeSync(input: SyncInput): Promise<Observed> {
  try {
    const project = input.project, dir = project.dir;
    if (input.team !== null && !isId(input.team)) throw manifestRefusal('TEAM_NOT_FOUND');
    checkProjectAncestry(project);
    const state = readManifestState(dir);
    if (state.file === null) throw manifestRefusal('MANIFEST_NOT_FOUND');
    const manifest = parseManifest(state.file.bytes);
    if (input.team !== null) requireTeam(project, input.team);
    if (legacyPresent(dir)) throw syncError('MANAGED_SKILL_LEGACY_PRESENT');
    if (exists(join(dir, MARKER_V2)) || exists(temporary(join(dir, MARKER_V2)))) throw pendingRefusal(dir);
    if (exists(join(dir, '.bowerloom-revision.json'))) throw syncError('REVISION_PENDING');
    let ignore: 'absent' | 'exact';
    try { ignore = ignoreState(dir); } catch (e) { throw syncError(managedCode(e), 'The file .bowerloom/managed/.gitignore must hold exactly one line, a single *.'); }
    const target = input.apply ? [...input.apply.harnesses] : [...manifest.harnesses] as Harness[];
    const layout = stateLayout(input), ctx: ItemContext = { input, manifest, layout, ignore, target };
    const selected = manifest.skills.filter(e => input.team === null || !e.teams || e.teams.includes(input.team));
    const classified = selected.map(entry => classify(entry, ctx)), items: SyncItem[] = classified.map(c => c.item);
    const catalogs = join(dir, MANAGED_ROOT, 'catalog');
    if (exists(catalogs)) for (const n of names(catalogs)) {
      const ref = catalogItem(n);
      if (ref.kind === 'skill' && !manifest.skills.some(e => e.id === ref.id)) items.push(orphan(dir, layout.itemsRoot, ref.id));
    }
    if (items.length > SYNC_ITEM_LIMIT) throw syncError('SKILLS_SYNC_LIMIT');
    // A sync that changes nothing else still puts back a missing shared ignore file, through one installed skill.
    // Review M5 finding 4: a later item whose copy would go where an earlier item's goes is held, not left to fail.
    holdSharedPlaces(items);
    // Review M5 finding 5: the carrier has room in its history, so the history rule cannot hold it afterwards.
    if (ignore === 'absent' && !items.some(actionable)) { const first = ignoreCarrier(items); if (first) first.action = 'update'; }
    // Each pin that a child will read: the completed cache operation to reuse, or the id to fetch into.
    for (const { item, pinned } of classified) {
      if (!pinned || !actionable(item)) continue;
      try { item.cache = await lookupCache(layout.cacheRoot, pinned); }
      catch (e) { if (e instanceof Error && 'code' in e && (e.code === 'SKILLS_SYNC_CONTENT_MISMATCH' || e.code === 'SKILLS_CACHE_RECOVERY_REQUIRED')) throw e; throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED'); }
      item.cacheOperationId = item.cache.operationId; if (item.state === 'needs-fetch') item.state = item.cache.status;
    }
    const fetch = items.filter(i => actionable(i) && i.cache?.status === 'needs-fetch');
    // Review freeze finding 13: the fixed message already says that a pin is not cached and that nothing changed.
    const missing = `${fetch.length === 1 ? 'The skill is' : 'The skills are'} ${fetch.map(i => i.id).join(', ')}.`;
    if (input.offline && fetch.length) throw syncError('SKILLS_OFFLINE', input.apply ? `bowerloom apply never fetches. ${missing} Run bowerloom skills sync first, then bowerloom apply.` : `--offline was set. ${missing} Run bowerloom skills sync without --offline.`);
    const work = items.filter(actionable), create: string[] = [];
    if (work.length) {
      create.push(...layout.missing.filter(p => p !== layout.cacheRoot || fetch.length));
      for (const i of work) { const p = join(layout.itemsRoot, i.id); if (!exists(p)) create.push(p); }
    }
    const kinds = [...new Set(fetch.map(i => i.kind as 'npm' | 'git'))].map(k => HOSTS[k]).sort();
    const body = {
      format: SYNC_PLAN_FORMAT,
      project: { dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
      manifest: { sha256: state.file.sha256, bytes: state.file.bytes.length },
      harnesses: target, team: input.team, offline: input.offline,
      privateState: { root: layout.root, projectId: project.projectId, cacheRoot: layout.cacheRoot, itemsRoot: layout.itemsRoot, create, pins: layout.pins },
      managed: { ignore }, items, network: { required: fetch.length > 0, hosts: kinds },
      writesAuthorized: false as const, executionAuthorized: false as const,
    };
    const plan = freezeSkillData({ ...body, revision: revisionOf(body) }) as SyncPlan;
    return { plan, entries: new Map(manifest.skills.map(e => [e.id, e])), manifest };
  } catch (e) { throw outward(e); }
}

/** `skills sync` plan. Reads only. */
export async function planSync(input: SyncInput): Promise<SyncPlan> { return (await observeSync(input)).plan; }
