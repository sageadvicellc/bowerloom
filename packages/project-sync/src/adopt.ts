/**
 * `team adopt <id>` (spec 06, 3.17): copies a store team into `.bowerloom/teams/<id>` and switches bowerloom.json to the
 * project copy. Decision 1 on #80 (variant A): a store team that bowerloom.json does not list yet is copied and added. The plan is the create plan of the copy and the config change; it reads no network. Apply runs both under
 * one project lock: the create path (pending record, staging, move, receipt), then bowerloom.json, then the lock.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../contracts/src/index.js';
import { inspectStore, projectRefusal } from '../../project-context/src/index.js';
import type { HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import { applyCreate, planCreate } from '../../project-authoring/src/index.js';
import type { AuthoringReceipt, CreatePlan } from '../../project-authoring/src/index.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import { lstatOrNull, readTree } from '../../project-authoring/src/files.js';
import { authoringRefusal } from '../../project-authoring/src/refusal.js';
import { readConfig } from '../../project-config/src/config.js';
import { configRefusal, refusalWithNext, teamListedFromProject } from '../../project-config/src/refusal.js';
import { lockItem, readLock } from '../../project-config/src/lock.js';
import { applyConfigChange, initialConfig, planConfigChange } from './change.js';
import { PARTIAL_HINT } from './refusal.js';
import type { ConfigChangePlan, ConfigChangeResult } from './change.js';
import { readStoreCache } from './store-git.js';
import { readStoreDefinitions } from './resolve.js';
import type { StoreDefinitions } from './resolve.js';

export const ADOPT_PLAN_FORMAT = 'bowerloom/team-adopt-plan/v1beta1' as const;
export const ADOPT_RESULT_FORMAT = 'bowerloom/team-adopt-result/v1beta1' as const;
export interface AdoptPlan {
  format: typeof ADOPT_PLAN_FORMAT; create: CreatePlan | null; config: ConfigChangePlan;
  /** True for a recovery plan: the copy and its receipt are in place, and only bowerloom.json and the lock remain. */
  finishing: boolean;
  /** Where the copy comes from: the live store, or a store cache folder. Null for a recovery plan. */
  from: 'store' | 'store-cache' | null;
  /**
   * Decision 1 on #80 (variant A): for a team that bowerloom.json does not list yet, the store skills and prompts tagged
   * to it, as `<kind> <id>`. They stay store items and are not picked. Empty for a team listed from the store.
   */
  storeOnly: string[];
  /** Review L2 of PR 100: tagged store items the store names but cannot use, each `<kind> <id> (<reason>)`. */
  storeUnusable: string[];
  /** Notes for the review, such as a recovery copy that differs from the store team now. */
  notes: string[];
  revision: string;
}
export interface AdoptResult { format: typeof ADOPT_RESULT_FORMAT; planRevision: string; receipt: AuthoringReceipt | null; config: ConfigChangeResult; storeOnly: string[]; storeUnusable: string[]; executionAuthorized: false }
export interface AdoptInput { project: ProjectContext; home: string; stateRoot: string; id: string }
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');
export const ADOPT_MISSING_NEXT = (id: string): string => `Run bowerloom apply --frozen, then bowerloom team adopt ${id} again.`;

/**
 * The folder a listed team is copied from: the live store when it defines the team, else the store cache folder of its
 * lock item. A store that is there and refuses (unsafe, a linked area, not a store) refuses the plan with its own code,
 * as the resolver does; only an absent store leaves the store cache as the source.
 */
function sourceRoot(input: AdoptInput): { root: string; from: 'store' | 'store-cache' } {
  const found = inspectStore(input.home);
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  if (found.state === 'store' && readStoreDefinitions(found.context).teams.has(input.id)) return { root: found.context.dir, from: 'store' };
  const lock = readLock(input.project), item = lock.state === 'present' ? lockItem(lock.lock, 'team', input.id) : null;
  if (item !== null && 'authored' in item) {
    const cached = readStoreCache(join(input.stateRoot, 'store-cache'), 'team', input.id, item.authored.hash);
    if (cached !== null) return { root: cached.dir, from: 'store-cache' };
  }
  throw refusalWithNext('STORE_ITEM_MISSING', ADOPT_MISSING_NEXT(input.id));
}
/** The recovery check (3.17): the receipt registers the team, its folder matches the receipt pins, and the config still lists it from the store. */
function recovering(project: ProjectContext, id: string): boolean {
  if (project.bowerloomIdentity === null) return false;
  const item = (readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []).find(i => i.kind === 'team' && i.id === id);
  if (!item) return false;
  try { if (canonicalJson(readTree(join(project.dir, '.bowerloom'), `teams/${id}`)) !== canonicalJson(item.files)) return false; } catch { return false; }
  const read = readConfig(project);
  return read.state === 'valid' && read.config.teams.some(t => t.id === id && t.source === 'store');
}

/** The store for a team that is not listed: STORE_NOT_FOUND when absent, STORE_ITEM_NOT_FOUND when it lacks the team. */
function storeWithTeam(home: string, id: string): StoreDefinitions {
  const found = inspectStore(home);
  if (found.state === 'absent') throw projectRefusal('STORE_NOT_FOUND');
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  const defs = readStoreDefinitions(found.context);
  if (!defs.teams.has(id)) throw configRefusal('STORE_ITEM_NOT_FOUND');
  return defs;
}
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
/**
 * The store skills and prompts tagged to team `id` that the project does not list (`listed` holds `<kind> <id>` pairs):
 * `usable`, which stay store items, and `unusable`, which the store names but cannot use, each with its reason (review L2).
 */
function tagged(defs: StoreDefinitions, listed: ReadonlySet<string>, id: string): { usable: string[]; unusable: string[] } {
  const usable: string[] = [], unusable: string[] = [];
  for (const e of defs.view.skills?.manifest.skills ?? []) {
    if (!(e.teams ?? []).includes(id) || listed.has(`skill ${e.id}`)) continue;
    if (defs.skills.has(e.id)) usable.push(`skill ${e.id}`); else unusable.push(`skill ${e.id} (its folder is missing or is a link)`);
  }
  for (const p of defs.view.authoring?.items ?? []) {
    if (p.kind !== 'prompt' || !p.teams.includes(id) || listed.has(`prompt ${p.id}`)) continue;
    if (defs.prompts.has(p.id)) usable.push(`prompt ${p.id}`); else unusable.push(`prompt ${p.id} (its file is missing or is not a plain file)`);
  }
  return { usable: usable.sort(byteOrder), unusable: unusable.sort(byteOrder) };
}
/**
 * The recovery check for a team that is not listed (review H2): the receipt registers the team and its folder matches
 * the receipt pins. An earlier adopt copied it and stopped before bowerloom.json. The live store team may have changed
 * since; the project keeps its copy. A folder that is not there is no copy; any other read error propagates.
 */
function recoveringUnlisted(project: ProjectContext, id: string): boolean {
  if (project.bowerloomIdentity === null) return false;
  const item = (readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []).find(i => i.kind === 'team' && i.id === id);
  if (!item || lstatOrNull(join(project.dir, '.bowerloom', 'teams', id)) === null) return false;
  return canonicalJson(readTree(join(project.dir, '.bowerloom'), `teams/${id}`)) === canonicalJson(item.files);
}
/** TEAM_EXISTS on the unlisted path, with a next step: the folder is in the way of the store team. */
function withExistsNext(error: unknown, id: string): unknown {
  if (error instanceof DefinitionError && error.code === 'TEAM_EXISTS' && !('next' in error)) Object.defineProperty(error, 'next', { value: `Move .bowerloom/teams/${id} out of the project to adopt the store team, or run bowerloom use team ${id} --project to list the project's own team.`, enumerable: false });
  return error;
}
/**
 * Review H2: a failure after the copy and its receipt landed. The code stays; the words say the team was copied and that
 * the same command finishes, and the next step is that command.
 */
function copiedRefusal(error: unknown, id: string): DefinitionError {
  const rerun = `bowerloom team adopt ${id}`, tail = `The team was copied. Run ${rerun} again to finish.`;
  let out: DefinitionError;
  if (error instanceof DefinitionError) out = new DefinitionError(error.code, `${error.message.replace(/\s*Nothing was applied\.?/g, '').replace(/\s*Run the command again to see the new plan\.?/g, '').trim()} ${tail}`);
  else {
    const system = (error as { code?: unknown } | null)?.code, cause = typeof system === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(system) ? system : 'UNKNOWN';
    out = new DefinitionError('IO_ERROR', `A step failed with the system error ${cause}. ${tail}`);
    Object.defineProperty(out, 'cause', { value: cause, enumerable: false });
  }
  Object.defineProperty(out, 'hint', { value: PARTIAL_HINT, enumerable: false });
  Object.defineProperty(out, 'next', { value: rerun, enumerable: false });
  return out;
}

/** Plans `team adopt <id>`. Reads only, and never the network. */
export async function planAdopt(input: AdoptInput): Promise<AdoptPlan> {
  const { project, id } = input;
  if (id === 'first-team') throw authoringRefusal('TEAM_ID_RESERVED');
  const read = readConfig(project);
  if (read.state === 'invalid') throw configRefusal(read.code);
  const entry = read.state === 'valid' ? read.config.teams.find(t => t.id === id) ?? null : null;
  // A team the project already lists from the project: the same code, with words of its own (review C2).
  if (entry !== null && entry.source !== 'store') throw teamListedFromProject(id);
  let create: CreatePlan | null = null, from: AdoptPlan['from'] = null, finishing: boolean, storeOnly: string[] = [], storeUnusable: string[] = [];
  const notes: string[] = [];
  if (entry !== null) {
    finishing = recovering(project, id);
    if (!finishing) { const src = sourceRoot(input); from = src.from; create = await planCreate({ kind: 'team', project: project.dir, name: id, copyFrom: { root: src.root } }); }
  } else {
    // Decision 1 on #80 (variant A): a store team that is not listed yet. The copy comes from the live store only: with no
    // lock item there is no store cache folder to fall back on.
    const defs = storeWithTeam(input.home, id), root = defs.view.context!.dir;
    const config = read.state === 'valid' ? read.config : initialConfig(project).config;
    const listed = new Set([...config.skills.map(e => `skill ${e.id}`), ...config.prompts.map(e => `prompt ${e.id}`)]);
    ({ usable: storeOnly, unusable: storeUnusable } = tagged(defs, listed, id));
    finishing = recoveringUnlisted(project, id);
    if (finishing) {
      const item = (readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []).find(i => i.kind === 'team' && i.id === id)!;
      if (canonicalJson(readTree(root, `teams/${id}`)) !== canonicalJson(item.files)) notes.push(`The copy in .bowerloom/teams/${id} differs from the store team now. The project keeps its copy.`);
    } else {
      from = 'store';
      try { create = await planCreate({ kind: 'team', project: project.dir, name: id, copyFrom: { root } }); } catch (error) { throw withExistsNext(error, id); }
    }
  }
  const config = await planConfigChange({ project, home: input.home, op: 'adopt', kind: 'team', id });
  const bound = { create: create?.revision ?? null, config: config.revision, ...(storeOnly.length ? { storeOnly } : {}), ...(storeUnusable.length ? { storeUnusable } : {}), ...(notes.length ? { notes } : {}) };
  return { format: ADOPT_PLAN_FORMAT, create, config, finishing, from, storeOnly, storeUnusable, notes, revision: sha(canonicalJson(bound)) };
}

/** Applies an approved adopt plan under one held project lock: the create path, then bowerloom.json and the lock. */
export async function applyAdopt(input: AdoptInput, plan: AdoptPlan, revision: string, held: HeldProjectLock): Promise<AdoptResult> {
  const stale = () => new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
  const again = await planAdopt(input);
  if (revision !== plan.revision || again.revision !== revision) throw stale();
  let receipt: AuthoringReceipt | null = null, project = input.project;
  if (again.create !== null) receipt = await applyCreate({ kind: 'team', project: project.dir, name: input.id, copyFrom: again.create.copyFrom! }, again.create.revision, held, undefined, project, made => { project = made; });
  try {
    // The config part changes only bowerloom.json and the lock, which the copy does not touch: the same bytes as approved.
    const config = await planConfigChange({ project, home: input.home, op: 'adopt', kind: 'team', id: input.id });
    if (config.config.text !== again.config.config.text || canonicalJson(config.lock) !== canonicalJson(again.config.lock)) throw stale();
    const applied = applyConfigChange(config, config.revision, held, project, input.home);
    return { format: ADOPT_RESULT_FORMAT, planRevision: plan.revision, receipt, config: applied.result, storeOnly: again.storeOnly, storeUnusable: again.storeUnusable, executionAuthorized: false };
  } catch (error) { throw again.create !== null ? copiedRefusal(error, input.id) : error; }
}
