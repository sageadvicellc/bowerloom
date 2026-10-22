/**
 * `team adopt <id>` (spec 06, 3.17): copies a store team into `.bowerloom/teams/<id>` and switches bowerloom.json to the
 * project copy. Decision 1 on #80 (variant A): a store team that bowerloom.json does not list yet is copied and added. The plan is the create plan of the copy and the config change; it reads no network. Apply runs both under
 * one project lock: the create path (pending record, staging, move, receipt), then bowerloom.json, then the lock.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../contracts/src/index.js';
import { inspectStore, projectRefusal, verifyStorePins } from '../../project-context/src/index.js';
import type { HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import { applyCreate, planCreate } from '../../project-authoring/src/index.js';
import type { AuthoringReceipt, CreatePlan } from '../../project-authoring/src/index.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import { lstatOrNull, readTree } from '../../project-authoring/src/files.js';
import { authoringRefusal } from '../../project-authoring/src/refusal.js';
import { readConfig } from '../../project-config/src/config.js';
import { configRefusal, refusalWithNext } from '../../project-config/src/refusal.js';
import { lockItem, readLock } from '../../project-config/src/lock.js';
import { applyConfigChange, planConfigChange } from './change.js';
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
  revision: string;
}
export interface AdoptResult { format: typeof ADOPT_RESULT_FORMAT; planRevision: string; receipt: AuthoringReceipt | null; config: ConfigChangeResult; executionAuthorized: false }
export interface AdoptInput { project: ProjectContext; home: string; stateRoot: string; id: string }
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');
export const ADOPT_MISSING_NEXT = (id: string): string => `Run bowerloom apply --frozen, then bowerloom team adopt ${id} again.`;

/** The folder the team is copied from: the live store when it holds the team, else the store cache folder of its lock item. */
function sourceRoot(input: AdoptInput): { root: string; from: 'store' | 'store-cache' } {
  try {
    const found = inspectStore(input.home);
    if (found.state === 'store') {
      verifyStorePins(found.context);
      const registered = (readAuthoringState(found.context.dir).receipt?.value.items ?? []).some(i => i.kind === 'team' && i.id === input.id);
      const s = lstatOrNull(join(found.context.dir, 'teams', input.id));
      if (registered && s !== null && s.isDirectory() && !s.isSymbolicLink()) return { root: found.context.dir, from: 'store' };
    }
  } catch { /* An unusable store is no source; the store cache may still be. */ }
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
/** The store skills and prompts tagged to team `id` that the config does not list, as `<kind> <id>`, in byte order. */
function taggedNotListed(defs: StoreDefinitions, listed: ReadonlySet<string>, id: string): string[] {
  const tagged = [...[...defs.skills.entries()].filter(([, e]) => (e.teams ?? []).includes(id)).map(([s]) => `skill ${s}`), ...[...defs.prompts.values()].filter(p => p.teams.includes(id)).map(p => `prompt ${p.id}`)];
  return tagged.filter(pair => !listed.has(pair)).sort(byteOrder);
}
/**
 * The recovery check for a team that is not listed: the receipt registers the team, its folder matches the receipt pins,
 * and those pins equal the live store team. Only then did an earlier adopt copy it and stop before bowerloom.json.
 */
function recoveringUnlisted(project: ProjectContext, defs: StoreDefinitions, id: string): boolean {
  if (project.bowerloomIdentity === null) return false;
  const item = (readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []).find(i => i.kind === 'team' && i.id === id);
  if (!item) return false;
  try {
    const files = canonicalJson(item.files);
    return canonicalJson(readTree(join(project.dir, '.bowerloom'), `teams/${id}`)) === files && canonicalJson(readTree(defs.view.context!.dir, `teams/${id}`)) === files;
  } catch { return false; }
}

/** Plans `team adopt <id>`. Reads only, and never the network. */
export async function planAdopt(input: AdoptInput): Promise<AdoptPlan> {
  const { project, id } = input;
  if (id === 'first-team') throw authoringRefusal('TEAM_ID_RESERVED');
  const read = readConfig(project);
  if (read.state === 'invalid') throw configRefusal(read.code);
  const entry = read.state === 'valid' ? read.config.teams.find(t => t.id === id) ?? null : null;
  // A team the project already lists from the project keeps today's refusal.
  if (entry !== null && entry.source !== 'store') throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
  let create: CreatePlan | null = null, from: AdoptPlan['from'] = null, finishing: boolean, storeOnly: string[] = [];
  if (entry !== null) {
    finishing = recovering(project, id);
    if (!finishing) { const src = sourceRoot(input); from = src.from; create = await planCreate({ kind: 'team', project: project.dir, name: id, copyFrom: { root: src.root } }); }
  } else {
    // Decision 1 on #80 (variant A): a store team that is not listed yet. The copy comes from the live store only.
    const defs = storeWithTeam(input.home, id);
    const listed = new Set(read.state === 'valid' ? [...read.config.skills.map(e => `skill ${e.id}`), ...read.config.prompts.map(e => `prompt ${e.id}`)] : []);
    storeOnly = taggedNotListed(defs, listed, id);
    finishing = recoveringUnlisted(project, defs, id);
    if (!finishing) { const src = sourceRoot(input); from = src.from; create = await planCreate({ kind: 'team', project: project.dir, name: id, copyFrom: { root: src.root } }); }
  }
  const config = await planConfigChange({ project, home: input.home, op: 'adopt', kind: 'team', id });
  const bound = { create: create?.revision ?? null, config: config.revision, ...(storeOnly.length ? { storeOnly } : {}) };
  return { format: ADOPT_PLAN_FORMAT, create, config, finishing, from, storeOnly, revision: sha(canonicalJson(bound)) };
}

/** Applies an approved adopt plan under one held project lock: the create path, then bowerloom.json and the lock. */
export async function applyAdopt(input: AdoptInput, plan: AdoptPlan, revision: string, held: HeldProjectLock): Promise<AdoptResult> {
  const stale = () => new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
  const again = await planAdopt(input);
  if (revision !== plan.revision || again.revision !== revision) throw stale();
  let receipt: AuthoringReceipt | null = null, project = input.project;
  if (again.create !== null) receipt = await applyCreate({ kind: 'team', project: project.dir, name: input.id, copyFrom: again.create.copyFrom! }, again.create.revision, held, undefined, project, made => { project = made; });
  // The config part changes only bowerloom.json and the lock, which the copy does not touch: the same bytes as approved.
  const config = await planConfigChange({ project, home: input.home, op: 'adopt', kind: 'team', id: input.id });
  if (config.config.text !== again.config.config.text || canonicalJson(config.lock) !== canonicalJson(again.config.lock)) throw stale();
  const applied = applyConfigChange(config, config.revision, held, project, input.home);
  return { format: ADOPT_RESULT_FORMAT, planRevision: plan.revision, receipt, config: applied.result, executionAuthorized: false };
}
