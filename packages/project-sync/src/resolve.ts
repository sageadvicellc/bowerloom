/**
 * The resolver (spec 06, 3.2, 3.3, 4.3): what a project installs, and where each item's bytes come from. Reads only.
 *
 * Legacy mode (no `bowerloom.json`): every entry of `.bowerloom/skills.json`, every registered prompt and every created
 * team, exactly as in beta.2. The store and the lock are never read (a lock file is noticed by name only, for status).
 *
 * Config mode: only the items `bowerloom.json` lists. A project entry resolves to its definition in `.bowerloom`, or is
 * held CONFIG_ITEM_MISSING. A store entry, in a normal run, resolves to the live store, else to its lock item, else is
 * held STORE_ITEM_MISSING. A frozen run reads only the lock, and refuses a missing, invalid, or disagreeing lock before
 * any other read.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { inspectStore, projectRefusal, verifyStorePins } from '../../project-context/src/index.js';
import type { StoreContext } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import type { AuthoredItem } from '../../project-authoring/src/state.js';
import { readManifestState, storeTarget } from '../../skill-manifest/src/add.js';
import { MANIFEST_FORMAT, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS, compare, parseManifest, serializeEntry } from '../../skill-manifest/src/schema.js';
import type { Entry, Harness, Manifest, PinnedEntry } from '../../skill-manifest/src/schema.js';
import type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { configRefusal, lockMismatch } from '../../project-config/src/refusal.js';
import { readConfig } from '../../project-config/src/config.js';
import type { ConfigEntry, ProjectConfig } from '../../project-config/src/schema.js';
import { LOCK_FILE, lockAgrees, lockItem, readLock } from '../../project-config/src/lock.js';
import type { LockItem, ProjectLock } from '../../project-config/src/lock.js';
import { isSharedProject, unknownSharedNote } from '../../project-config/src/shared.js';
import { localItemRows } from './store-items.js';

export type ItemKind = 'skill' | 'prompt' | 'team';
export type LockState = 'not-used' | 'absent' | 'valid' | 'stale' | 'invalid' | 'mismatch' | 'orphan';
export interface StoreView {
  state: 'not-needed' | 'absent' | 'present'; context: StoreContext | null;
  skills: { manifest: Manifest; sha256: string; bytes: number } | null;
  authoring: { items: AuthoredItem[]; sha256: string | null; bytes: number | null } | null;
}
export interface ResolvedItem {
  kind: ItemKind; id: string; origin: 'store' | 'project'; via: string[];
  resolvedFrom: 'store' | 'lock' | 'project'; entry: Entry | null; teams: string[]; lockPin: AuthoredPin | null;
  hold: { code: string; next: string } | null;
}
export interface Resolved {
  mode: 'config' | 'legacy'; frozen: boolean; config: { sha256: string; bytes: number } | null;
  lock: { state: LockState; sha256: string | null; bytes: number | null; code: string | null };
  harnesses: Harness[]; manifest: Manifest | null; projectManifest: { sha256: string; bytes: number } | null;
  skills: ResolvedItem[]; prompts: ResolvedItem[]; teams: ResolvedItem[]; store: StoreView;
  unselected: { skills: string[]; prompts: string[]; teams: string[] }; notes: string[];
  /** The parsed config and lock, for callers that change them (change.ts). Null when absent or unreadable. */
  configValue: ProjectConfig | null; lockValue: ProjectLock | null;
  /** The result of `isSharedProject`, in config mode. False in legacy mode. */
  shared: boolean;
  /** The `<kind> <id>` pairs whose live store item differs from its lock item. */
  stale: string[];
  /** The STORE_* code of a store that refused, when `tolerateStore` was set. */
  storeCode: string | null;
}
export interface ResolveInput {
  project: ProjectContext; home: string; frozen: boolean;
  /** For `ls` and `status`: a store that refuses (a STORE_* code) leaves the store items missing instead of refusing. */
  tolerateStore?: boolean;
}

const KINDS = [['skills', 'skill'], ['prompts', 'prompt'], ['teams', 'team']] as const;
const HARNESSES: Harness[] = ['claude', 'codex'];
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const lstatOrNull = (path: string) => { try { return lstatSync(path); } catch { return null; } };
const realFolder = (path: string): boolean => { const s = lstatOrNull(path); return s !== null && s.isDirectory() && !s.isSymbolicLink(); };
const plainFile = (path: string): boolean => { const s = lstatOrNull(path); return s !== null && s.isFile() && !s.isSymbolicLink(); };
const localEntry = (id: string, teams: readonly string[]): Entry => ({ id, ...(teams.length ? { teams: [...teams] } : {}), source: { kind: 'local', path: `skills/${id}` } }) as Entry;
export const missingNext = (kind: ItemKind, id: string): string => `Define it with bowerloom ${kind} create ${id}, or run bowerloom unuse ${kind} ${id}.`;
export const storeMissingNext = (kind: ItemKind, id: string): string => `Create it with bowerloom ${kind} create ${id} --global, or run bowerloom unuse ${kind} ${id}.`;
export const STALE_NOTE = (pairs: readonly string[]): string => `The lock is out of date for ${pairs.join(', ')}. Run bowerloom lock update.`;
export const SHARED_NO_LOCK_NOTE = 'This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.';
/**
 * Review L3, and track 11 of beta.3, item 3: in a shared project each plan names each store item the config asks for,
 * and where this run takes it from. The live store says "your store". On a machine with no store, or in a frozen run,
 * an item the person wrote comes from the lock and the store repository, and a pin from the lock and npm or GitHub.
 */
export function storeItemNote(item: Pick<ResolvedItem, 'kind' | 'id' | 'resolvedFrom' | 'entry' | 'lockPin' | 'hold'>): string {
  return `  ${item.kind} ${item.id} comes from ${noteSource(item)}; this project asks for it`;
}
/**
 * PR 102 round 1, item 3: each branch tests one fact. Only the hold STORE_ITEM_MISSING says that nothing holds the item.
 * A lock item the person wrote names the store repository; a pin names npm or GitHub; any other pin kind gets neutral
 * words, never a guess.
 */
function noteSource(item: Pick<ResolvedItem, 'resolvedFrom' | 'entry' | 'lockPin' | 'hold'>): string {
  if (item.hold?.code === 'STORE_ITEM_MISSING') return 'a store, and neither your store nor the lock holds it';
  if (item.resolvedFrom === 'store') return 'your store';
  if (item.resolvedFrom === 'project') return 'this project';
  if (item.lockPin !== null) return 'the lock and the store repository';
  const kind = (item.entry?.source as { kind?: unknown } | undefined)?.kind;
  if (kind === 'npm') return 'the lock and npm';
  // PR 102 round 2, item 6: a git pin is always on github.com. readLock checks each pin with validateEntry, and the
  // schema takes only `host: GIT_HOST`, which is 'github.com' (skill-manifest/src/schema.ts); any other host is
  // LOCK_INVALID. So "GitHub" is exact here, not a guess.
  if (kind === 'git') return 'the lock and its GitHub repository';
  // A skill the person wrote resolves from the lock with a local entry and its lockPin, handled above.
  return 'the lock';
}

/** The definitions a project holds in `.bowerloom`: skills.json, the authoring receipt, and first-team. */
interface Definitions { manifest: Manifest | null; read: { sha256: string; bytes: number } | null; prompts: Map<string, AuthoredItem>; teams: Map<string, AuthoredItem | null> }
function projectDefinitions(project: ProjectContext, legacy: boolean): Definitions {
  const state = readManifestState(project.dir, { allowAbsent: !legacy });
  const manifest = state.file ? parseManifest(state.file.bytes, MANIFEST_LIMITS) : null;
  const bowerloom = join(project.dir, '.bowerloom');
  // Legacy mode reads the receipt as beta.2 did: only the planners that need it (apply's prompts) refuse a bad one.
  let items: AuthoredItem[] = [];
  if (project.bowerloomIdentity !== null) { try { items = readAuthoringState(bowerloom).receipt?.value.items ?? []; } catch (error) { if (!legacy) throw error; } }
  const prompts = new Map(items.filter(i => i.kind === 'prompt').map(i => [i.id, i]));
  const teams = new Map<string, AuthoredItem | null>(items.filter(i => i.kind === 'team').map(i => [i.id, i]));
  if (project.bowerloomIdentity !== null && realFolder(join(bowerloom, 'teams', 'first-team'))) teams.set('first-team', null);
  return { manifest, read: state.file ? { sha256: state.file.sha256, bytes: state.file.bytes.length } : null, prompts, teams };
}

/** What the store defines (3.12): its skills.json entries, and its prompts and teams whose file or folder is there. */
export interface StoreDefinitions { skills: Map<string, Entry>; prompts: Map<string, AuthoredItem>; teams: Map<string, AuthoredItem>; view: StoreView }
/**
 * Round 2 of the reviews of PR 100, S1 (the rule of review S1 of PR 98, store-items.ts): each area folder of the store
 * that is there, `skills`, `prompts`, and `teams`, is a real folder and really inside the store. A link there would make
 * every reader, team adopt among them, read or copy files from outside the store. Checked once here, for every reader.
 */
export function storeAreasInside(storeDir: string): void {
  let real: string;
  try { real = realpathSync(storeDir); } catch { throw projectRefusal('STORE_UNREADABLE'); }
  for (const area of ['skills', 'prompts', 'teams']) {
    const at = join(storeDir, area), s = lstatOrNull(at);
    if (s === null) continue;
    let inside = false;
    try { inside = s.isDirectory() && !s.isSymbolicLink() && realpathSync(at) === join(real, area); } catch { inside = false; }
    if (!inside) throw projectRefusal('STORE_UNSAFE', `The store folder ${area} is a link or is not inside the store.`);
  }
}
/**
 * Reads the store definitions with the store pins checked before and after: `skills.json` with the store limits, and the
 * store authoring receipt. A local skill exists only with its folder, a prompt only with its file, a team only with its folder.
 */
export function readStoreDefinitions(store: StoreContext): StoreDefinitions {
  verifyStorePins(store);
  storeAreasInside(store.dir);
  const state = readManifestState(storeTarget(store.dir), { allowAbsent: true });
  const manifest = state.file ? parseManifest(state.file.bytes, STORE_MANIFEST_LIMITS) : null;
  const authoring = readAuthoringState(store.dir);
  const items = authoring.receipt?.value.items ?? [];
  const skills = new Map<string, Entry>();
  for (const e of manifest?.skills ?? []) if (e.source.kind !== 'local' || realFolder(join(store.dir, 'skills', e.id))) skills.set(e.id, e);
  const prompts = new Map(items.filter(i => i.kind === 'prompt' && plainFile(join(store.dir, 'prompts', `${i.id}.md`))).map(i => [i.id, i]));
  const teams = new Map(items.filter(i => i.kind === 'team' && realFolder(join(store.dir, 'teams', i.id))).map(i => [i.id, i]));
  verifyStorePins(store);
  const view: StoreView = { state: 'present', context: store, skills: manifest && state.file ? { manifest, sha256: state.file.sha256, bytes: state.file.bytes.length } : null, authoring: { items: [...items], sha256: authoring.receipt?.read.sha256 ?? null, bytes: authoring.receipt?.read.bytes ?? null } };
  return { skills, prompts, teams, view };
}

/** The store, read only when a config entry needs it. A foreign or unsafe store refuses with its STORE_* code; an absent one is no error. */
function storeFor(home: string): StoreDefinitions | null {
  const found = inspectStore(home);
  if (found.state === 'absent') return null;
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  return readStoreDefinitions(found.context);
}

/** True when the live store item differs from its lock item: the entry of a pin; the hash and the teams tag of an authored item. */
function differs(defs: StoreDefinitions, kind: ItemKind, id: string, item: LockItem): boolean {
  const storeDir = defs.view.context!.dir;
  if (kind === 'skill') {
    const live = defs.skills.get(id);
    if (!live) return true;
    if (live.source.kind !== 'local') return !('pin' in item) || canonicalJson(serializeEntry(live)) !== canonicalJson(serializeEntry(item.pin));
    if (!('authored' in item)) return true;
    return liveAuthoredDiffers(storeDir, kind, id, live.teams ?? [], item.authored);
  }
  if (!('authored' in item)) return true;
  const live = kind === 'prompt' ? defs.prompts.get(id) : defs.teams.get(id);
  if (!live) return true;
  return liveAuthoredDiffers(storeDir, kind, id, kind === 'team' ? [] : live.teams, item.authored);
}
function liveAuthoredDiffers(storeDir: string, kind: ItemKind, id: string, teams: readonly string[], pin: AuthoredPin): boolean {
  // Review F8: only an item that is not there differs quietly; any other failure to read it is reported.
  if (lstatOrNull(join(storeDir, kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}`)) === null) return true;
  const hash = localItemRows(storeDir, kind, id).hash;
  return hash !== pin.hash || canonicalJson([...teams].sort(compare)) !== canonicalJson(pin.teams ?? []);
}

function legacy(input: ResolveInput, lockSeen: boolean): Resolved {
  const defs = projectDefinitions(input.project, true);
  const item = (kind: ItemKind, id: string, teams: readonly string[], entry: Entry | null): ResolvedItem => ({ kind, id, origin: 'project', via: [], resolvedFrom: 'project', entry, teams: [...teams], lockPin: null, hold: null });
  const skills = (defs.manifest?.skills ?? []).map(e => item('skill', e.id, e.teams ?? [], e));
  const prompts = [...defs.prompts.values()].sort((a, b) => byteOrder(a.id, b.id)).map(p => item('prompt', p.id, p.teams, null));
  const teams = [...defs.teams.keys()].sort(byteOrder).map(id => item('team', id, [], null));
  return {
    mode: 'legacy', frozen: input.frozen, config: null, lock: { state: lockSeen ? 'orphan' : 'not-used', sha256: null, bytes: null, code: null },
    harnesses: defs.manifest ? [...defs.manifest.harnesses] : [...HARNESSES], manifest: defs.manifest, projectManifest: defs.read,
    skills, prompts, teams, store: { state: 'not-needed', context: null, skills: null, authoring: null },
    unselected: { skills: [], prompts: [], teams: [] }, notes: [], configValue: null, lockValue: null, shared: false, stale: [], storeCode: null,
  };
}

/** Resolves the project. Throws the config's own refusal for an invalid bowerloom.json, a STORE_* code, and, frozen, the lock codes. */
export function resolveProject(input: ResolveInput): Resolved {
  const project = input.project, frozen = input.frozen === true;
  const lockSeen = lstatOrNull(join(project.dir, LOCK_FILE)) !== null;
  const read = readConfig(project);
  if (read.state === 'absent') {
    if (project.configPresent) throw projectRefusal('PROJECT_UNSAFE');
    if (frozen) throw configRefusal('LOCK_CONFIG_MISSING');
    return legacy(input, lockSeen);
  }
  if (read.state === 'invalid') throw configRefusal(read.code);
  const config = read.config, needStore = KINDS.some(([name]) => config[name].some(e => e.source === 'store'));
  // The lock: a frozen run refuses any problem with it here, before any other read.
  let lock: ProjectLock | null = null, lockInfo: Resolved['lock'] = { state: 'not-used', sha256: null, bytes: null, code: null };
  try {
    const got = readLock(project);
    if (got.state === 'present') { lock = got.lock; lockInfo = { state: 'valid', sha256: got.sha256, bytes: got.bytes, code: null }; }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (frozen || !(code === 'LOCK_INVALID' || code === 'LOCK_UNSAFE' || code === 'LOCK_LIMIT')) throw error;
    lockInfo = { state: 'invalid', sha256: null, bytes: null, code: code as string };
  }
  if (frozen) {
    if (lock === null && needStore) throw configRefusal('LOCK_MISSING');
    if (lock !== null) { const agree = lockAgrees(lock, config); if (!agree.agrees) throw lockMismatch([...agree.added, ...agree.removed]); }
  }
  const defs = projectDefinitions(project, false);
  let store: StoreDefinitions | null = null, storeCode: string | null = null;
  try { store = !frozen && needStore ? storeFor(input.home) : null; }
  catch (error) { const code = (error as { code?: unknown } | null)?.code; if (!input.tolerateStore || typeof code !== 'string' || !code.startsWith('STORE_')) throw error; storeCode = code; }
  const storeView: StoreView = store?.view ?? { state: !frozen && needStore ? 'absent' : 'not-needed', context: null, skills: null, authoring: null };
  const stale: string[] = [];

  const resolveEntry = (kind: ItemKind, e: ConfigEntry): ResolvedItem => {
    const base = { kind, id: e.id, origin: e.source, via: [...(e.via ?? [])], lockPin: null as AuthoredPin | null };
    if (e.source === 'project') {
      const found = kind === 'skill' ? defs.manifest?.skills.find(s => s.id === e.id) ?? null : null;
      const defined = kind === 'skill' ? found !== null : kind === 'prompt' ? defs.prompts.has(e.id) : defs.teams.has(e.id);
      if (!defined) return { ...base, resolvedFrom: 'project', entry: null, teams: [], hold: { code: 'CONFIG_ITEM_MISSING', next: missingNext(kind, e.id) } };
      const teams = kind === 'skill' ? found!.teams ?? [] : kind === 'prompt' ? defs.prompts.get(e.id)!.teams : [];
      return { ...base, resolvedFrom: 'project', entry: found, teams: [...teams], hold: null };
    }
    const fromLock = lock === null ? null : lockItem(lock, kind, e.id);
    if (store !== null) {
      const live = kind === 'skill' ? store.skills.get(e.id) ?? null : null;
      const liveItem = kind === 'prompt' ? store.prompts.get(e.id) ?? null : kind === 'team' ? store.teams.get(e.id) ?? null : null;
      if (live !== null || liveItem !== null) {
        if (fromLock !== null && differs(store, kind, e.id, fromLock)) stale.push(`${kind} ${e.id}`);
        if (kind === 'skill') {
          const teams = live!.teams ?? [];
          return { ...base, resolvedFrom: 'store', entry: live!.source.kind === 'local' ? localEntry(e.id, teams) : live, teams: [...teams], hold: null };
        }
        return { ...base, resolvedFrom: 'store', entry: null, teams: kind === 'prompt' ? [...liveItem!.teams] : [], hold: null };
      }
    }
    if (fromLock !== null) {
      if ('pin' in fromLock) return { ...base, resolvedFrom: 'lock', entry: fromLock.pin as PinnedEntry, teams: [...(fromLock.pin.teams ?? [])], hold: null };
      const teams = fromLock.authored.teams ?? [];
      return { ...base, resolvedFrom: 'lock', entry: kind === 'skill' ? localEntry(e.id, teams) : null, teams: [...teams], lockPin: fromLock.authored, hold: null };
    }
    // Review F7: when the store refused, the store is what to look at first.
    return { ...base, resolvedFrom: 'store', entry: null, teams: [], hold: { code: 'STORE_ITEM_MISSING', next: storeCode !== null ? 'Run bowerloom store status.' : storeMissingNext(kind, e.id) } };
  };
  const skills = config.skills.map(e => resolveEntry('skill', e)), prompts = config.prompts.map(e => resolveEntry('prompt', e)), teams = config.teams.map(e => resolveEntry('team', e));

  const sharedState = isSharedProject(project), shared = sharedState.shared, notes: string[] = [];
  if (lock !== null && lockInfo.state === 'valid') {
    if (!lockAgrees(lock, config).agrees) lockInfo = { ...lockInfo, state: 'mismatch', code: 'LOCK_CONFIG_MISMATCH' };
    else if (stale.length) lockInfo = { ...lockInfo, state: 'stale' };
  } else if (lock === null && lockInfo.state !== 'invalid') lockInfo = { ...lockInfo, state: needStore && shared ? 'absent' : 'not-used' };
  if (stale.length) notes.push(STALE_NOTE(stale));
  if (lockInfo.state === 'absent') notes.push(SHARED_NO_LOCK_NOTE);
  if (lockInfo.state === 'mismatch' && lock !== null) { const a = lockAgrees(lock, config); notes.push(`bowerloom.lock.json and bowerloom.json list different store items: ${[...a.added, ...a.removed].join(', ')}. Run bowerloom lock update.`); }
  if (sharedState.unknown !== undefined) notes.push(unknownSharedNote(sharedState.unknown));
  // Review L3: in a shared project, each store item the config asks for is named, so private store content entering a clone shows.
  if (shared) for (const item of [...skills, ...prompts, ...teams]) if (item.origin === 'store') notes.push(storeItemNote(item));

  const listed = (name: 'skills' | 'prompts' | 'teams') => new Set(config[name].filter(e => e.source === 'project').map(e => e.id));
  const unselected = {
    skills: (defs.manifest?.skills ?? []).map(s => s.id).filter(id => !listed('skills').has(id)).sort(byteOrder),
    prompts: [...defs.prompts.keys()].filter(id => !listed('prompts').has(id)).sort(byteOrder),
    teams: [...defs.teams.keys()].filter(id => !listed('teams').has(id)).sort(byteOrder),
  };
  const manifest: Manifest = { format: MANIFEST_FORMAT, harnesses: [...config.harnesses], skills: skills.filter(i => i.entry !== null).map(i => i.entry!).sort((a, b) => byteOrder(a.id, b.id)) };
  return {
    mode: 'config', frozen, config: { sha256: read.sha256, bytes: read.bytes }, lock: lockInfo,
    harnesses: [...config.harnesses], manifest, projectManifest: defs.read,
    skills, prompts, teams, store: storeView, unselected, notes, configValue: config, lockValue: lock, shared, stale, storeCode,
  };
}
