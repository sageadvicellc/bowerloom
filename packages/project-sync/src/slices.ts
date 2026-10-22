/**
 * Context slices in `bowerloom apply` (spec 05). A slice is an authored file, `.bowerloom/slices/<id>.yaml`, registered by
 * `slice create`. Apply installs it as a managed v1beta2 item of kind `slice`: one index skill,
 * `.claude/skills/slice-<id>/SKILL.md`, and a catalog record `slice_<id>.json`. The index holds paths and titles, never
 * member text. Its private folder is named `slice_<id>`.
 *
 * Planning reads only. A bad slice holds that one slice; the rest of the plan still applies. Apply never removes an
 * index and never overwrites one it did not install. The structure follows prompts.ts.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { LIMITS, OP_TEMP, directory, exists, names, raw, sameOrInside, stablePins } from '../../managed-skills/src/observed.js';
import { readSliceTree } from '../../managed-skills/src/local-source.js';
import type { SliceTreeResult } from '../../managed-skills/src/local-source.js';
import { catalogPath, currentV2, locateV2, ownSurface } from '../../managed-skills/src/v2-observed.js';
import type { SliceCatalogRoot, InventoryRow, ItemClosure, ItemRef, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, RegisteredLookup, SliceRequestRoot, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { resolveRegisteredRoot } from '../../project-context/src/registered-folders.js';
import { identityFrom, projectId } from '../../project-context/src/discovery.js';
import type { DirectoryIdentity } from '../../project-context/src/types.js';
import { SLICE_LIMITS, isSliceId } from '../../context-slices/src/slice-file.js';
import type { SliceDefinition } from '../../context-slices/src/slice-file.js';
import { folderNames, lstatOrNull, readGuarded, realFolder } from '../../project-authoring/src/files.js';
import type { ParsedAgent } from '../../project-authoring/src/agent-file.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import type { ItemSurface, SyncItem } from './plan.js';
import { MIN_FREE_BYTES, beforePins, driftNext, driftedPaths, historyNext, readCatalog, recoverNext, strayHold } from './plan.js';
import { managedCode, syncError } from './refusal.js';

export type SliceState = 'new' | 'edited' | 'up-to-date' | 'drift' | 'orphaned' | 'held';
/** What the catalog of a slice records as its source. It holds no absolute path. */
export interface SliceCatalogSource { kind: 'slice'; path: string; root: SliceCatalogRoot; guard: 'root' | 'none' }
export interface SliceItem {
  id: string;
  /** `slice_<id>`: the name of its private folder and its catalog. */
  itemId: string;
  state: SliceState;
  action: 'install' | 'update' | 'none' | 'hold';
  harnesses: ['claude'];
  definition: { path: string; sha256: string; bytes: number } | null;
  root: { kind: 'project'; path: string; dir: string; identity: DirectoryIdentity }
    | { kind: 'registered'; name: string; path: string; dir: string; identity: DirectoryIdentity; recordSha256: string; holdsProject: boolean } | null;
  /** For a registered root: what the index copies out of the folder, so the plan can say so. Null for a root in the project. */
  copies: { summary: 'heading' | 'frontmatter' | 'none'; key: string | null; count: number; folder: string } | null;
  guard: 'root' | 'none' | null;
  /** Relative to the root, sorted. */
  members: string[];
  /** Relative to the root, each ending in `/`, sorted. `./` is the root. */
  covered: string[];
  changes: { added: number; gone: number; summaries: number; rootChanged: boolean; guardChanged: boolean };
  notes: { unparsed: string[]; unresolvedLinks: number; ambiguousLinks: number; emptyPatterns: string[]; notText: number; oversize: string[]; skippedEntries: number; truncatedLinks: number; outsideProject: boolean; wholeProject: boolean };
  /** Roles that name it, sorted. Filled once the agents are known. */
  agents: string[];
  /** A verified catalog record exists. */
  installed: boolean;
  expected: { files: InventoryRow[]; surfaces: ItemSurface[]; source: SliceCatalogSource | null };
  before: SyncItem['before'];
  previousReceiptRevision: string | null;
  history: number;
  hold: { code: string; next: string } | null;
}

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const fileOf = (id: string): string => `.bowerloom/slices/${id}.yaml`;
const NO_CHANGES: SliceItem['changes'] = Object.freeze({ added: 0, gone: 0, summaries: 0, rootChanged: false, guardChanged: false });
const NO_NOTES: SliceItem['notes'] = Object.freeze({ unparsed: [], unresolvedLinks: 0, ambiguousLinks: 0, emptyPatterns: [], notText: 0, oversize: [], skippedEntries: 0, truncatedLinks: 0, outsideProject: false, wholeProject: false });

/** The registered slices, from `.bowerloom/authoring/receipt.json`, sorted by id. Reads with the authoring guards. */
export function registeredSlices(project: string): string[] {
  const state = readAuthoringState(join(project, '.bowerloom'));
  return (state.receipt?.value.items ?? []).filter(i => i.kind === 'slice').map(i => i.id).sort(cmp);
}
/**
 * The names in `.bowerloom/slices`, none when the folder is absent. A folder that is a link or writable by others, or a
 * name that is not plain, refuses AUTHORING_UNSAFE_PATH.
 */
export function sliceFolderNames(project: string): string[] {
  const folder = join(project, '.bowerloom', 'slices');
  if (lstatOrNull(folder) === null) return [];
  realFolder(folder);
  return folderNames(folder);
}

/** The item surfaces of a slice, as the managed planner places them. */
export function sliceSurfaces(project: string, id: string): { id: ItemSurface['id']; kind: 'directory' | 'file'; path: string }[] {
  const req = { projectDir: project, item: { kind: 'slice', id }, harnesses: ['claude'] } as unknown as ManagedItemRequest;
  return locateV2(req, { name: id } as ItemClosure, { ignore: false, legacy: false }).filter(ownSurface);
}

/** The words of a hold from the reading of a slice: its code and the next step. */
export function holdOf(id: string, hold: { code: string; detail: string; errno?: string; inside?: boolean }): { code: string; next: string } {
  const path = fileOf(id);
  switch (hold.code) {
    case 'SLICE_INVALID': return { code: hold.code, next: `Fix ${path}: ${hold.detail}. Then run bowerloom apply.` };
    case 'SLICE_KEY_UNKNOWN': return { code: hold.code, next: `Remove ${/^[A-Za-z0-9_.-]{1,64}$/.test(hold.detail) ? `the key ${hold.detail}` : 'a key with unsupported characters'} from ${path}, then run bowerloom apply.` };
    case 'SLICE_PATH_MISSING': return { code: hold.code, next: `${hold.detail} is gone. Fix the path in ${path}, or restore the file, then run bowerloom apply.` };
    case 'SLICE_ROOT_MISSING': return { code: hold.code, next: 'Run bowerloom folder list, or register the folder with bowerloom folder add <folder-name> <path>, then run bowerloom apply.' };
    case 'SLICE_ROOT_UNSAFE': return { code: hold.code, next: hold.inside === true ? `Use root: ${hold.detail} instead.` : hold.errno !== undefined ? `Bowerloom cannot read ${hold.detail} (${hold.errno}). Run ls -ld ${hold.detail}, let your user read it, then run bowerloom apply.` : `ls -ld ${hold.detail}` };
    case 'FOLDER_NOT_ALLOWED': return { code: hold.code, next: `bowerloom folder allow ${hold.detail}` };
    case 'SLICE_SOURCE_UNSAFE': return { code: hold.code, next: hold.errno === undefined ? `ls -l ${hold.detail}` : `Bowerloom cannot read ${hold.detail} (${hold.errno}). Run ls -l ${hold.detail}, let your user read it, then run bowerloom apply.` };
    case 'SLICE_EMPTY': return { code: hold.code, next: `Widen include in ${path}, then run bowerloom apply.` };
    default: return { code: 'SLICE_TOO_LARGE', next: 'Narrow the slice, or set summary: none, then run bowerloom apply.' };
  }
}

const indexLines = (text: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) { const m = /^- `([^`]+)`/.exec(line); if (m) out.set(m[1]!, line); }
  return out;
};
/** A member path with the root it belongs to, so that two roots never share a name for the same path. */
const rootKey = (root: SliceDefinition['root'] | undefined): string => root === undefined ? '' : root.kind === 'registered' ? `@${root.name}/${root.path}` : root.path === '.' ? '' : root.path;
const qualified = (root: string, member: string): string => root === '' ? member : `${root}/${member}`;

export type SliceTreeHook = (projectDir: string, name: string, root: SliceRequestRoot, live: () => void, registered?: RegisteredLookup) => SliceTreeResult;

/** The store lookup of registered folders, for `readSliceTree`: the project-context resolver with the identity cut to what a request carries. */
export function registeredLookup(home: string, projectId: string, birthtimeNs: string, stateRoot?: string): RegisteredLookup {
  return (name, path) => {
    const found = resolveRegisteredRoot(home, name, path, { projectId, birthtimeNs, ...(stateRoot !== undefined ? { stateRoot } : {}) });
    if (!found.ok) return found;
    return { ok: true, dir: found.dir, identity: { device: found.identity.device, inode: found.identity.inode, birthtimeNs: found.identity.birthtimeNs }, recordSha256: found.recordSha256 };
  };
}

/** Reads one slice through the hook, and turns a change during the read into the stale refusal. */
function readTree(read: SliceTreeHook, project: string, id: string, registered?: RegisteredLookup): SliceTreeResult {
  try { return read(project, id, { kind: 'project' }, () => {}, registered); }
  catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'MANAGED_SKILL_STALE_APPROVAL') throw stale(`A file of slice ${id} changed while Bowerloom read it. Run bowerloom apply again.`);
    if (code === 'MANAGED_SKILL_ABORTED' || code === 'MANAGED_SKILL_TIMEOUT') throw syncError(code);
    // An error with no string code is a bug in Bowerloom: it must not look like a fault in the person's files.
    if (typeof code !== 'string') throw e;
    return { definition: null, file: null, resolution: { members: [], covered: [], notes: { unparsed: [], unresolvedLinks: 0, ambiguousLinks: 0, emptyPatterns: [], notText: 0, oversize: [], skippedEntries: 0, truncatedLinks: 0 }, hold: null, readBytes: 0 }, index: null, hold: { code: 'SLICE_SOURCE_UNSAFE', detail: fileOf(id), errno: code }, rootDir: null, recordSha256: null, rootId: null };
  }
}

function heldItem(project: string, id: string, extra: Partial<SliceItem>, hold: { code: string; next: string }): SliceItem {
  const surfaces = sliceSurfaces(project, id);
  return {
    id, itemId: 'slice_' + id, state: 'held', action: 'hold', harnesses: ['claude'], definition: null, root: null, copies: null, guard: null, members: [], covered: [],
    changes: { ...NO_CHANGES }, notes: { ...NO_NOTES, unparsed: [], emptyPatterns: [], oversize: [] }, agents: [], installed: false,
    expected: { files: [], surfaces: surfaces.map(s => ({ id: s.id, path: relative(project, s.path) })), source: null }, before: beforePins(surfaces, project),
    previousReceiptRevision: null, history: 0, hold, ...extra,
  };
}

/** Classifies one registered slice. Reads only. */
export function classifySlice(project: string, itemsRoot: string, id: string, read: SliceTreeHook, registered?: RegisteredLookup): SliceItem {
  const ref: ItemRef = { kind: 'slice', id }, itemId = 'slice_' + id, stateDir = join(itemsRoot, itemId), catalog = catalogPath(project, ref);
  const surfaces = sliceSurfaces(project, id), before = beforePins(surfaces, project);
  if (lstatOrNull(join(project, fileOf(id))) === null) {
    // A registered slice whose file is gone is held, never a refusal of the whole plan: the other items still apply.
    const hold = { code: 'AUTHORING_ITEM_MISSING', next: `${fileOf(id)} is gone. Restore it from version control, then run bowerloom apply.` };
    return heldItem(project, id, { installed: installedState(project, itemsRoot, ref) !== null }, hold);
  }
  const tree = readTree(read, project, id, registered);
  const def = tree.definition, res = tree.resolution;
  // The root folder is read once more for its identity. A folder that cannot be read now holds the slice, never a plan without a root.
  let rootItem: SliceItem['root'] = null, holdsProject = false;
  if (def !== null && tree.rootDir !== null) {
    try {
      const identity = identityFrom(lstatSync(tree.rootDir, { bigint: true }));
      holdsProject = def.root.kind === 'registered' && sameOrInside(project, tree.rootDir);
      rootItem = def.root.kind === 'project' ? { kind: 'project', path: def.root.path, dir: tree.rootDir, identity } : { kind: 'registered', name: def.root.name, path: def.root.path, dir: tree.rootDir, identity, recordSha256: tree.recordSha256 ?? '', holdsProject };
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException | null)?.code;
      if (typeof errno !== 'string') throw error;
      const missing = errno === 'ENOENT' || errno === 'ENOTDIR';
      return heldItem(project, id, { installed: installedState(project, itemsRoot, ref).installed }, missing ? holdOf(id, { code: 'SLICE_ROOT_MISSING', detail: def.root.kind === 'registered' ? def.root.name : def.root.path }) : holdOf(id, { code: 'SLICE_ROOT_UNSAFE', detail: tree.rootDir, errno }));
    }
  }
  const notes = {
    unparsed: [...res.notes.unparsed], unresolvedLinks: res.notes.unresolvedLinks, ambiguousLinks: res.notes.ambiguousLinks, emptyPatterns: [...res.notes.emptyPatterns],
    notText: res.notes.notText, oversize: [...res.notes.oversize], skippedEntries: res.notes.skippedEntries, truncatedLinks: res.notes.truncatedLinks,
    outsideProject: def !== null && def.root.kind === 'registered' && tree.rootDir !== null && !holdsProject,
    wholeProject: def !== null && def.guard === 'root' && ((def.root.kind === 'project' && def.root.path === '.') || (def.root.kind === 'registered' && holdsProject)),
  };
  const copies: SliceItem['copies'] = def !== null && def.root.kind === 'registered' && tree.rootDir !== null ? { summary: def.summary.kind, key: def.summary.kind === 'frontmatter' ? def.summary.key : null, count: res.members.length, folder: tree.rootDir } : null;
  const source: SliceCatalogSource | null = def === null ? null : { kind: 'slice', path: `slices/${id}.yaml`, root: def.root.kind === 'registered' ? { ...def.root, id: tree.rootId ?? '' } : def.root, guard: def.guard };
  const previous = installedState(project, itemsRoot, ref);
  const base: Partial<SliceItem> = {
    definition: tree.file === null ? null : { path: fileOf(id), ...tree.file }, root: rootItem, guard: def?.guard ?? null, members: res.members.map(m => m.path), covered: [...res.covered], notes, copies, installed: previous.installed,
  };
  if (tree.hold !== null) return heldItem(project, id, base, holdOf(id, tree.hold));

  let hold: SliceItem['hold'] = null, heldCode: string | null = null, state: SliceState = 'held', action: SliceItem['action'] = 'hold', current: ManagedItemReceipt | null = null, ops: string[] = [];
  const occupiedCatalog = { code: 'MANAGED_SKILL_PATH_OCCUPIED', next: `Move .bowerloom/managed/catalog/${itemId}.json aside, then run bowerloom apply.` };
  if (exists(stateDir)) {
    try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
    const all = names(stateDir).filter(n => !OP_TEMP.test(n)); ops = all.filter(n => /^op-[a-f0-9]{64}$/.test(n));
    const stray = all.filter(n => !ops.includes(n));
    if (stray.length) hold = strayHold(itemId, stray, 'bowerloom apply');
    else if (ops.some(n => !exists(join(stateDir, n, 'receipt.json')))) hold = { code: 'MANAGED_SKILL_RECOVERY_REQUIRED', next: recoverNext(itemId) };
  }
  let changes = { ...NO_CHANGES };
  const files: InventoryRow[] = [{ path: 'SKILL.md', sha256: createHashHex(tree.index!), bytes: Buffer.byteLength(tree.index!) }];
  if (!exists(catalog)) {
    // Apply never adopts a slice index: only Bowerloom writes one.
    if (exists(join(project, '.claude/skills', 'slice-' + id)) || lstatOrNull(join(project, '.claude/skills', 'slice-' + id)) !== null) hold = hold ?? { code: 'SLICE_TARGET_OCCUPIED', next: `Move .claude/skills/slice-${id} aside, then run bowerloom apply.` };
    else { state = 'new'; action = 'install'; }
  } else if (!exists(stateDir)) hold = hold ?? occupiedCatalog;
  else {
    try { current = currentV2(project, stateDir, ref); } catch (e) { current = null; heldCode = managedCode(e); }
    if (heldCode === 'MANAGED_SKILL_PATH_OCCUPIED') { hold = hold ?? occupiedCatalog; heldCode = null; }
    if (current !== null) {
      const view = readCatalog(catalog), was = view.source as unknown as SliceCatalogSource, refs = (view as unknown as { references?: string[] }).references ?? rawReferences(catalog);
      if (refs === null) { hold = hold ?? { code: 'MANAGED_SKILL_LOCAL_DRIFT', next: driftNext([`.bowerloom/managed/catalog/${itemId}.json`], fileOf(id)).replace('bowerloom skills sync', 'bowerloom apply').replace('Sync never', 'Apply never') }; state = 'drift'; }
      else {
      const oldMembers = refs.filter(r => !r.endsWith('/')), oldCovered = refs.filter(r => r.endsWith('/'));
      const wasRoot = rootKey(was?.root), nowRoot = rootKey(def!.root);
      const oldSet = new Set(oldMembers.map(m => qualified(wasRoot, m))), newSet = new Set(base.members!.map(m => qualified(nowRoot, m)));
      const installedIndex = readInstalledIndex(project, id);
      const oldLines = installedIndex === null ? new Map<string, string>() : indexLines(installedIndex), newLines = indexLines(tree.index!);
      let summaries = 0; for (const [p, line] of newLines) { const was2 = oldLines.get(p); if (was2 !== undefined && was2 !== line) summaries++; }
      changes = {
        added: [...newSet].filter(p => !oldSet.has(p)).length, gone: [...oldSet].filter(p => !newSet.has(p)).length, summaries,
        rootChanged: !same(was?.root ?? null, source!.root), guardChanged: was?.guard !== def!.guard,
      };
      const differs = !same(view.inventory, files) || !same(oldMembers, base.members) || !same(oldCovered, base.covered) || changes.rootChanged || changes.guardChanged;
      if (differs) { state = 'edited'; action = 'update'; } else { state = 'up-to-date'; action = 'none'; }
      }
    }
  }
  if (heldCode !== null && hold === null) {
    const changed = heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftedPaths(project, stateDir, id) : [];
    hold = { code: heldCode, next: heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftNext(changed.length ? changed : before.map(b => b.path), fileOf(id)).replace('bowerloom skills sync', 'bowerloom apply').replace('Sync never', 'Apply never') : `Run bowerloom status to see what changed in the copies of slice ${id}.` };
    if (heldCode === 'MANAGED_SKILL_LOCAL_DRIFT') state = 'drift';
  }
  if ((action === 'install' || action === 'update') && hold === null && ops.length >= LIMITS.history) {
    hold = { code: 'MANAGED_SKILL_HISTORY_FULL', next: historyNext(itemId, current ? `op-${current.operationKey}` : 'the newest op-<key> folder', 'bowerloom apply') };
  }
  if (hold !== null) { action = 'hold'; if (state !== 'drift') state = 'held'; }
  return {
    ...heldItem(project, id, {}, hold ?? { code: '', next: '' }), ...base, id, itemId, state, action, changes: action === 'install' || action === 'update' ? changes : { ...NO_CHANGES },
    expected: { files, surfaces: surfaces.map(s => ({ id: s.id, path: relative(project, s.path) })), source }, before, previousReceiptRevision: current?.revision ?? null, history: ops.length, hold,
  };
}

import { createHash } from 'node:crypto';
const createHashHex = (text: string): string => createHash('sha256').update(text).digest('hex');
/** The `references` of a catalog file, or null when the file cannot be read or holds no list of text. Null is a hold, never "every member is new". */
export function rawReferences(catalog: string): string[] | null {
  try {
    const v = JSON.parse(raw(catalog, 262144, false).bytes.toString('utf8')) as { references?: unknown };
    return Array.isArray(v.references) && v.references.every((r): r is string => typeof r === 'string') ? v.references : null;
  } catch { return null; }
}
/** The verified current receipt of an installed slice, or null. */
function installedState(project: string, itemsRoot: string, ref: ItemRef): { installed: boolean; receipt: ManagedItemReceipt | null; error: string | null } {
  if (!exists(catalogPath(project, ref))) return { installed: false, receipt: null, error: null };
  // A copy is on disk. When its record cannot be verified, the slice is still installed, and the reason stays with it.
  try { return { installed: true, receipt: currentV2(project, join(itemsRoot, 'slice_' + ref.id), ref), error: null }; } catch (e) { return { installed: true, receipt: null, error: managedCode(e) }; }
}
function readInstalledIndex(project: string, id: string): string | null {
  try { return raw(join(project, '.claude/skills', 'slice-' + id, 'SKILL.md'), 65536, false).bytes.toString('utf8'); } catch { return null; }
}

/** A slice whose catalog is here and that is no longer registered. It is kept, never removed. */
export function orphanSlice(project: string, itemsRoot: string, id: string): SliceItem {
  let previous: ManagedItemReceipt | null = null, code: string | null = null;
  try { previous = currentV2(project, join(itemsRoot, 'slice_' + id), { kind: 'slice', id }); } catch (e) { code = managedCode(e); }
  const base: SliceItem = { ...heldItem(project, id, {}, { code: '', next: '' }), state: 'orphaned', action: 'none', hold: null, installed: previous !== null, previousReceiptRevision: previous?.revision ?? null, before: [], expected: { files: [], surfaces: [], source: null } };
  if (code === null) return base;
  const next = code === 'MANAGED_SKILL_PATH_OCCUPIED' ? `Move .bowerloom/managed/catalog/slice_${id}.json aside, then run bowerloom apply.` : `Run bowerloom status to see what changed in the copies of slice ${id}. Its definition is no longer registered, so Bowerloom keeps what is there.`;
  return { ...base, state: code === 'MANAGED_SKILL_LOCAL_DRIFT' ? 'drift' : 'held', action: 'hold', hold: { code, next } };
}

/** The root a child request names: the project, or the registered folder's root with the identity the plan read. */
export function requestRoot(item: SliceItem): SliceRequestRoot {
  const root = item.root;
  // A registered slice with no root was held and has no child request. Naming the project for it would read another folder.
  if (root === null && item.expected.source?.root.kind === 'registered') throw new Error('A registered slice has no root to read.');
  if (root === null || root.kind === 'project') return { kind: 'project' };
  return { kind: 'registered', name: root.name, dir: root.dir, identity: { device: root.identity.device, inode: root.identity.inode, birthtimeNs: root.identity.birthtimeNs } };
}

/** The child request of one slice. Every field comes from the plan this run computed. */
export function sliceRequest(project: string, itemsRoot: string, item: SliceItem): ManagedItemRequest {
  return {
    operation: item.action === 'install' ? 'install' : 'update', projectDir: project, stateDir: join(itemsRoot, item.itemId),
    item: { kind: 'slice', id: item.id }, harnesses: ['claude'], source: { kind: 'slice', name: item.id, root: requestRoot(item) },
    expectedPreviousRevision: item.previousReceiptRevision, minFreeBytes: MIN_FREE_BYTES, legacy: null,
  };
}

const rel = (dir: string, p: string): string => p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
/** Phase B check of one slice child against the parent plan's bindings. Anything that differs means a change since the approval. */
export function checkSliceChild(dir: string, item: SliceItem, req: ManagedItemRequest, child: ManagedItemPlan | UpToDateV2): ManagedItemPlan {
  if (child.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale(`Slice ${item.id} changed since the plan.`);
  const c = child as ManagedItemPlan, closure = c.core.closure;
  if (!same(c.core.request, req)) throw stale();
  const refs = [...item.members, ...item.covered];
  if (!same(closure.inventory, item.expected.files) || !same(closure.source, item.expected.source) || !same(closure.references, refs) || closure.skill !== null) throw stale(`Slice ${item.id} changed since the plan.`);
  const own = c.core.before.filter(ownSurface);
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path) })), item.expected.surfaces)) throw stale();
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path), stablePinsDigest: revisionOf(stablePins(s.pins)) })), item.before)) throw stale(`Slice ${item.id} changed since the plan.`);
  if ((c.core.previous?.revision ?? null) !== item.previousReceiptRevision) throw stale();
  return c;
}

export interface SliceScan { items: SliceItem[]; unregistered: string[] }
/** The registered slice ids and the files that no receipt lists. An unsafe `slices` folder refuses; more than 64 slices refuse SLICE_LIMIT. */
export function listSlices(project: string): { ids: string[]; unregistered: string[] } {
  const folder = sliceFolderNames(project), ids = registeredSlices(project);
  if (ids.length > SLICE_LIMITS.slices) throw syncError('SLICE_LIMIT');
  const listed = new Set(ids.map(id => `${id}.yaml`));
  return { ids, unregistered: folder.filter(n => !listed.has(n)) };
}
/** Plans every registered slice, then adds the catalogs of slices that are no longer registered. */
export function scanSlices(project: string, itemsRoot: string, read: SliceTreeHook = readSliceTree as SliceTreeHook, catalogNames: readonly string[] = [], registered?: RegisteredLookup): SliceScan {
  const { ids, unregistered } = listSlices(project);
  const items = ids.map(id => classifySlice(project, itemsRoot, id, read, registered));
  for (const n of catalogNames) {
    const m = /^slice_([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(n);
    if (m && isSliceId(m[1]) && !ids.includes(m[1]!)) items.push(orphanSlice(project, itemsRoot, m[1]!));
  }
  items.sort((a, b) => cmp(a.id, b.id));
  return { items, unregistered };
}

/** What an agent's `skills` list says about slices (spec 05, section 3.8). */
export interface AgentContext {
  slices: string[]; guard: string[] | null; guardRoots: string[]; unknown: string[]; beyondPreloadLimit: string[]; plainSkills: string[]; heldNeverInstalled: string[]; omitClaudeMd: boolean;
  /** Departure from the frozen type: guarded slices that are held but were installed before, so the copy stays and the guard blocks. */
  heldAfterInstalled: string[];
  /** Departure from the frozen type: the position (from 1) of each entry of `beyondPreloadLimit`, so the plan can print it. */
  beyondPreloadPositions: number[];
  /** Departure: the tool names (before any parenthesis) the agent lists, or null when it inherits every tool. */
  tools: string[] | null;
  /** Departure: the agent sets mcpServers. */
  mcpServers: boolean;
}
export const EMPTY_CONTEXT: AgentContext = Object.freeze({ slices: [], guard: null, guardRoots: [], unknown: [], beyondPreloadLimit: [], plainSkills: [], heldNeverInstalled: [], heldAfterInstalled: [], omitClaudeMd: false, beyondPreloadPositions: [], tools: null, mcpServers: false }) as AgentContext;

export function agentContext(agent: ParsedAgent, slices: readonly SliceItem[], plainIds: ReadonlySet<string>): AgentContext {
  const byId = new Map(slices.filter(s => s.state !== 'orphaned').map(s => [s.id, s]));
  const entries = [...new Set(agent.skills ?? [])];
  const everyTool = agent.tools === null || agent.tools.length === 0 || agent.tools.some(e => e.split('(')[0]!.includes('*'));
  const out: AgentContext = { slices: [], guard: null, guardRoots: [], unknown: [], beyondPreloadLimit: [], plainSkills: [], heldNeverInstalled: [], heldAfterInstalled: [], omitClaudeMd: agent.omitClaudeMd, beyondPreloadPositions: [], tools: everyTool ? null : agent.tools!.map(e => e.split('(')[0]!), mcpServers: agent.keys.includes('mcpServers') };
  entries.forEach((entry, i) => {
    if (!entry.startsWith('slice-')) return;
    const x = entry.slice('slice-'.length);
    if (byId.has(x)) { out.slices.push(x); if (i >= 32) { out.beyondPreloadLimit.push(x); out.beyondPreloadPositions.push(i + 1); } }
    else if (plainIds.has(entry)) out.plainSkills.push(entry);
    else out.unknown.push(x);
  });
  out.slices.sort(cmp); out.unknown.sort(cmp); out.plainSkills.sort(cmp);
  // A slice whose definition did not parse counts as guarded, so a broken definition fails closed.
  if (out.slices.some(id => byId.get(id)!.guard !== 'none')) {
    out.guard = [...out.slices];
    out.guardRoots = out.guard.flatMap(id => {
      const root = byId.get(id)!.root; if (root === null) return [];
      try { const real = realpathSync(root.dir); return [`${id}:${projectId(real, identityFrom(lstatSync(real, { bigint: true })))}`]; }
      catch (error) { const errno = (error as NodeJS.ErrnoException).code; if (errno === 'ENOENT' || errno === 'ENOTDIR') return []; throw error; }
    });
    out.heldNeverInstalled = out.guard.filter(id => { const s = byId.get(id)!; return s.action === 'hold' && !s.installed; });
    out.heldAfterInstalled = out.guard.filter(id => { const s = byId.get(id)!; return s.action === 'hold' && s.installed; });
  }
  return out;
}

const gitignores = (sub: string): string[] => ['.claude', '.claude/', `.claude/${sub}`, `.claude/${sub}/`, '**/.claude', '**/.claude/', `**/.claude/${sub}`, `**/.claude/${sub}/`];
/**
 * True when `.claude/agents`, or with `sub` set to `skills` `.claude/skills`, may be committed (spec 05, section 3.8). It reads `.gitignore` files and `.git/info/exclude`,
 * never the global excludes file of git, and starts no process. Without a repository folder it says false.
 */
export function agentsMayBeTracked(projectDir: string, home: string = homedir(), sub: 'agents' | 'skills' = 'agents'): boolean {
  const GITIGNORES = gitignores(sub);
  let repo: string | null = null;
  for (let at = projectDir; ; at = join(at, '..')) {
    if (at === home || at === '/' || at === '') break;
    if (lstatOrNull(join(at, '.git')) !== null) { repo = at; break; }
  }
  if (repo === null) return false;
  const files: { path: string; base: string }[] = [];
  for (let at = projectDir; ; at = join(at, '..')) {
    files.push({ path: join(at, '.gitignore'), base: at });
    if (at === repo) break;
  }
  const info = join(repo, '.git', 'info', 'exclude'); const gitDir = lstatOrNull(join(repo, '.git'));
  if (gitDir?.isDirectory()) files.push({ path: info, base: repo });
  let ignored = false;
  for (const f of files) {
    let text: string; try { text = readGuarded(f.path, 262144).toString('utf8'); } catch { continue; }
    const fromHere = relative(f.base, projectDir);
    for (const raw0 of text.split('\n')) {
      const line = raw0.replace(/[ \t]+$/, '');
      if (line === '' || line.startsWith('#')) continue;
      if (line.startsWith('!') && line.includes('.claude')) return true;
      if (GITIGNORES.includes(line)) ignored = true;
      else { const lead = fromHere === '' ? '/' : `/${fromHere}/`; if ([`${lead}.claude`, `${lead}.claude/`, `${lead}.claude/${sub}`, `${lead}.claude/${sub}/`].includes(line)) ignored = true; }
    }
  }
  return !ignored;
}
