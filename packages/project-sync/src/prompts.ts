/**
 * Prompts in `bowerloom apply` (build plan 01, M6). A prompt is an authored file, `.bowerloom/prompts/<name>.md`,
 * registered by `prompt create`. Apply installs it as a managed v1beta2 item of kind `prompt`: Claude Code gets
 * `.claude/commands/<name>.md`, Codex gets the skill wrapper `.agents/skills/prompt-<name>/SKILL.md` (owner,
 * answer 6). Its private folder and catalog are named `prompt-<name>`.
 *
 * Planning reads only. Every check of the planned child mirrors the skill check in apply.ts.
 */
import { lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { LIMITS, OP_TEMP, directory, exists, names, stablePins } from '../../managed-skills/src/observed.js';
import { readLocalPrompt } from '../../managed-skills/src/local-source.js';
import { catalogPath, currentV2, ownSurface } from '../../managed-skills/src/v2-observed.js';
import type { InventoryRow, ItemRef, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import type { ItemSurface, SyncItem } from './plan.js';
import { MIN_FREE_BYTES, beforePins, driftNext, driftedPaths, historyNext, readCatalog, recoverNext, strayHold, union } from './plan.js';
import { managedCode, syncError } from './refusal.js';
import type { WriterEngine } from '../../skill-manifest/src/engine.js';
import { fromWire, toWire } from './wire.js';
import { faultNote, probeStoreCache } from './store-git.js';
import type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { locateV2 } from '../../managed-skills/src/v2-observed.js';
import type { ItemClosure } from '../../managed-skills/src/v2-types.js';

export type PromptState = 'new' | 'edited' | 'engines-changed' | 'up-to-date' | 'drift' | 'orphaned';
export { promptNotices } from './notices.js';
export type { PromptNotice } from './notices.js';
import { promptNotices } from './notices.js';
import type { PromptNotice } from './notices.js';
export interface PromptItem {
  /** The prompt name, `.bowerloom/prompts/<id>.md`. */
  id: string;
  /** `prompt-<id>`: the name of its private folder and its catalog. */
  itemId: string;
  /** The teams the prompt is limited to; empty means every team. */
  teams: string[];
  state: PromptState; action: SyncItem['action'];
  /** The installed engines plus the requested ones. An engine is never dropped. */
  engines: WriterEngine[];
  /** Paths relative to the project. `files` is the authored prompt's inventory. */
  expected: { files: InventoryRow[]; surfaces: ItemSurface[] };
  before: SyncItem['before'];
  previousReceiptRevision: string | null;
  history: number;
  hold: { code: string; next: string } | null;
  /**
   * What the prompt's Claude Code command can do beyond text. Empty for an orphan. Null for a prompt from the lock that
   * this machine does not hold yet: Bowerloom shows its notices after the fetch (spec 06, 3.16, decision A).
   */
  notices: PromptNotice[] | null;
  /** Spec 06, 4.4: where the prompt is defined (null for an orphan), the teams it was picked through, and where its bytes come from. */
  origin: 'store' | 'project' | null; via: string[]; resolvedFrom: 'store' | 'lock' | 'project';
  lockPin: AuthoredPin | null;
  /** For a prompt from the lock: whether the store cache holds it now. Shown, not bound. */
  storeCache: 'held' | 'missing' | null;
}
/** Where a prompt of a config project comes from (spec 06, 3.12). Absent: the project, as in beta.2. */
export interface PromptSource {
  origin: 'store' | 'project'; via: string[]; resolvedFrom: 'store' | 'lock' | 'project';
  /** The live store folder, for a prompt from the store. */
  storeDir: string | null;
  lockPin: AuthoredPin | null;
  /** The store cache, for a prompt from the lock. */
  storeCacheRoot: string;
  /** Review F5: the plan notes, which name a store cache entry that fails verification. */
  notes?: string[];
  /** Review F5: a run that fetches nothing holds an item whose store cache entry fails verification, with that code. */
  offline?: boolean;
}
const PROJECT_SOURCE = { origin: 'project' as const, via: [] as string[], resolvedFrom: 'project' as const, lockPin: null, storeCache: null };

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const NULL_PINS = revisionOf(null);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);

/** The registered prompts, from `.bowerloom/authoring/receipt.json`, sorted by name. Reads with the authoring guards. */
export function registeredPrompts(project: string): { id: string; teams: string[] }[] {
  const state = readAuthoringState(join(project, '.bowerloom'));
  return (state.receipt?.value.items ?? []).filter(i => i.kind === 'prompt').map(i => ({ id: i.id, teams: [...i.teams] })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The item surfaces of a prompt for these engines, as the managed planner places them. */
export function promptSurfaces(project: string, id: string, engines: readonly WriterEngine[]): { id: ItemSurface['id']; kind: 'directory' | 'file'; path: string }[] {
  const req = { projectDir: project, item: { kind: 'prompt', id }, harnesses: toWire(engines) } as unknown as ManagedItemRequest;
  return locateV2(req, { name: id } as ItemClosure, { ignore: false, legacy: false }).filter(ownSurface);
}

const collision = (paths: string[], id: string) => syncError('APPLY_NAME_COLLISION', `Prompt ${id} goes to ${paths.join(' and ')}, and Bowerloom did not install what is there. Move it out of the way or rename the prompt, then run bowerloom apply.`);

/**
 * True only when a registered prompt's file is simply not there: `.bowerloom/prompts` is absent, or it is a real folder
 * (never a link) without the file. Anything else that cannot be read stays PROMPT_INVALID.
 */
function promptMissing(project: string, id: string): boolean {
  const gone = (path: string): boolean | null => { try { return lstatSync(path).isSymbolicLink() ? null : false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? true : null; } };
  const folder = join(project, '.bowerloom', 'prompts'), parent = gone(folder);
  if (parent === true) return true;
  if (parent === null) return false;
  try { if (!lstatSync(folder).isDirectory()) return false; } catch { return false; }
  return gone(join(folder, id + '.md')) === true;
}
/** Review freeze finding 1: the hold of a registered prompt whose file is gone. `prompt create <id>` restores it. */
export const missingPromptHold = (id: string): { code: string; next: string } => ({
  code: 'AUTHORING_ITEM_MISSING',
  next: `.bowerloom/prompts/${id}.md is gone. Run bowerloom prompt create ${id} to restore it, then run bowerloom apply.`,
});

/** The store folder a prompt is read from now: the live store, or its store cache folder; null when it is not on this machine. */
function promptFolder(id: string, src: PromptSource): { dir: string | null; fault: { code: string; key: string } | null } {
  if (src.resolvedFrom === 'store') return { dir: src.storeDir, fault: null };
  const probe = probeStoreCache(src.storeCacheRoot, 'prompt', id, src.lockPin!.hash);
  if (probe.fault) src.notes?.push(faultNote(probe.fault.key));
  return probe;
}
/** A prompt the resolver holds (CONFIG_ITEM_MISSING, STORE_ITEM_MISSING): no definition to read, and the copies stay. */
export function heldPrompt(project: string, id: string, teams: string[], target: WriterEngine[], hold: { code: string; next: string }, r: Pick<PromptSource, 'origin' | 'via' | 'resolvedFrom'>): PromptItem {
  const surfaces = promptSurfaces(project, id, target);
  return {
    id, itemId: 'prompt-' + id, teams, state: 'drift', action: 'hold', engines: [...target],
    expected: { files: [], surfaces: surfaces.map(s => ({ id: s.id, path: relative(project, s.path) })) }, before: beforePins(surfaces, project),
    previousReceiptRevision: null, history: 0, hold, notices: [], origin: r.origin, via: [...r.via], resolvedFrom: r.resolvedFrom, lockPin: null, storeCache: null,
  };
}
/** Classifies one prompt: a registered project prompt, or, in a config project, a store prompt live or from the lock. Reads only. */
export function classifyPrompt(project: string, itemsRoot: string, id: string, teams: string[], target: WriterEngine[], src?: PromptSource): PromptItem {
  let files: InventoryRow[], notices: PromptNotice[] | null, storeCache: PromptItem['storeCache'] = null, fault: { code: string } | null = null;
  const fromStore = src !== undefined && src.origin === 'store', where = fromStore ? (src.resolvedFrom === 'store' ? `~/.bowerloom/prompts/${id}.md` : `the store at ${src.lockPin!.remote.slice('https://'.length)}`) : `.bowerloom/prompts/${id}.md`;
  const tag = src === undefined ? PROJECT_SOURCE : { origin: src.origin, via: [...src.via], resolvedFrom: src.resolvedFrom, lockPin: src.resolvedFrom === 'lock' ? src.lockPin : null, storeCache: null };
  if (fromStore) {
    const probe = promptFolder(id, src), folder = probe.dir; fault = probe.fault;
    if (src.resolvedFrom === 'lock') storeCache = folder === null ? 'missing' : 'held';
    if (folder === null && src.resolvedFrom === 'lock') { files = src.lockPin!.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })); notices = null; }
    else {
      try { const read = readLocalPrompt(project, id, () => {}, { bowerloom: folder!, origin: 'store' }); files = [...read.inventory]; notices = promptNotices(read.files[0]!.text); }
      catch { throw syncError('PROMPT_INVALID', `The prompt is ${where}.`); }
    }
  } else try { if (id.startsWith('prompt-')) throw new Error('reserved'); const read = readLocalPrompt(project, id, () => {}); files = [...read.inventory]; notices = promptNotices(read.files[0]!.text); }
  catch {
    if (id.startsWith('prompt-') || !promptMissing(project, id)) throw syncError('PROMPT_INVALID', `The prompt is .bowerloom/prompts/${id}.md.`);
    // Held, never a refusal of the whole plan: the other skills and prompts still apply, and the copies stay.
    return heldPrompt(project, id, teams, target, missingPromptHold(id), tag);
  }
  const ref: ItemRef = { kind: 'prompt', id }, itemId = 'prompt-' + id, stateDir = join(itemsRoot, itemId);
  let hold: PromptItem['hold'] = null, heldCode: string | null = null, state: PromptState = 'drift', action: SyncItem['action'] = 'hold', previous: ManagedItemReceipt | null = null;
  let engines = [...target];
  let ops: string[] = [];
  if (exists(stateDir)) {
    try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
    const all = names(stateDir).filter(n => !OP_TEMP.test(n)); ops = all.filter(n => /^op-[a-f0-9]{64}$/.test(n));
    const stray = all.filter(n => !ops.includes(n));
    if (stray.length) hold = strayHold(itemId, stray, 'bowerloom apply');
    else if (ops.some(n => !exists(join(stateDir, n, 'receipt.json')))) hold = { code: 'MANAGED_SKILL_RECOVERY_REQUIRED', next: recoverNext(itemId) };
  }
  const catalog = catalogPath(project, ref);
  if (!exists(catalog)) { state = 'new'; action = 'install'; }
  else if (!exists(stateDir)) throw collision([relative(project, catalog)], id);
  else {
    try { previous = currentV2(project, stateDir, ref); } catch (e) { previous = null; heldCode = managedCode(e); }
    if (heldCode === 'MANAGED_SKILL_PATH_OCCUPIED') throw collision([relative(project, catalog)], id);
    if (previous !== null) {
      const was = fromWire(previous.harnesses, `The receipt of prompt ${id}`);
      engines = union(was, target);
      if (!same(readCatalog(catalog).inventory, files)) { state = 'edited'; action = 'update'; }
      else if (engines.length > was.length) { state = 'engines-changed'; action = 'update'; }
      else { state = 'up-to-date'; action = 'none'; }
    }
  }
  const surfaces = promptSurfaces(project, id, engines), before = beforePins(surfaces, project);
  if (heldCode !== null && hold === null) {
    const changed = heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftedPaths(project, stateDir, ref.id) : [];
    hold = { code: heldCode, next: heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftNext(changed.length ? changed : before.map(b => b.path), fromStore && src.resolvedFrom === 'lock' ? null : where).replace('bowerloom skills sync', 'bowerloom apply').replace('Sync never', 'Apply never') : `Run bowerloom status to see what changed in the copies of prompt ${id}.` };
  }
  if (action === 'install' && hold === null) {
    const taken = before.filter(b => b.stablePinsDigest !== NULL_PINS).map(b => b.path);
    if (taken.length) throw collision(taken, id);
  }
  if ((action === 'install' || action === 'update') && hold === null && ops.length >= LIMITS.history) {
    hold = { code: 'MANAGED_SKILL_HISTORY_FULL', next: historyNext(itemId, previous ? `op-${previous.operationKey}` : 'the newest op-<key> folder', 'bowerloom apply') };
  }
  if (fault !== null && src?.offline === true && hold === null && (action === 'install' || action === 'update')) hold = { code: fault.code, next: 'Run bowerloom apply --frozen.' };
  if (hold !== null) action = 'hold';
  return {
    id, itemId, teams, state, action, engines,
    expected: { files, surfaces: surfaces.map(s => ({ id: s.id, path: relative(project, s.path) })) }, before,
    previousReceiptRevision: previous?.revision ?? null, history: ops.length, hold, notices, ...tag, storeCache,
  };
}

/** A prompt whose catalog is here and that is no longer registered. It is kept, never removed. */
export function orphanPrompt(project: string, itemsRoot: string, id: string): PromptItem {
  let previous: ManagedItemReceipt | null = null;
  try { previous = currentV2(project, join(itemsRoot, 'prompt-' + id), { kind: 'prompt', id }); } catch { previous = null; }
  return { id, itemId: 'prompt-' + id, teams: [], state: 'orphaned', action: 'none', engines: previous ? fromWire(previous.harnesses, `The receipt of prompt ${id}`) : [], expected: { files: [], surfaces: [] }, before: [], previousReceiptRevision: previous?.revision ?? null, history: 0, hold: null, notices: [], origin: null, via: [], resolvedFrom: 'project', lockPin: null, storeCache: null };
}

/** The child request of one prompt. Every field comes from the plan this run computed; `storeDir` is the store folder of a store prompt. */
export function promptRequest(project: string, itemsRoot: string, item: PromptItem, storeDir: string | null = null): ManagedItemRequest {
  if ((item.origin === 'store') !== (storeDir !== null)) throw stale();
  return {
    operation: item.action === 'install' ? 'install' : 'update', projectDir: project, stateDir: join(itemsRoot, item.itemId),
    item: { kind: 'prompt', id: item.id }, harnesses: toWire(item.engines), source: storeDir !== null ? { kind: 'store-prompt', name: item.id, storeDir } : { kind: 'prompt', name: item.id },
    expectedPreviousRevision: item.previousReceiptRevision, minFreeBytes: MIN_FREE_BYTES, legacy: null,
  };
}

const rel = (dir: string, p: string): string => p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
/** Phase B check of one prompt child against the parent plan's bindings. Anything that differs means a change since the approval. */
export function checkPromptChild(dir: string, item: PromptItem, req: ManagedItemRequest, child: ManagedItemPlan | UpToDateV2): ManagedItemPlan {
  if (child.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale(`Prompt ${item.id} changed since the plan.`);
  const c = child as ManagedItemPlan, closure = c.core.closure;
  if (!same(c.core.request, req)) throw stale();
  if (!same(closure.inventory, item.expected.files) || !same(closure.source, { kind: item.origin === 'store' ? 'store-prompt' : 'prompt', path: `prompts/${item.id}.md` }) || closure.skill !== null) throw stale(`Prompt ${item.id} changed since the plan.`);
  const own = c.core.before.filter(ownSurface);
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path) })), item.expected.surfaces)) throw stale();
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path), stablePinsDigest: revisionOf(stablePins(s.pins)) })), item.before)) throw stale(`Prompt ${item.id} changed since the plan.`);
  if ((c.core.previous?.revision ?? null) !== item.previousReceiptRevision) throw stale();
  return c;
}
