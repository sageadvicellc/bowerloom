/**
 * `team adopt <id>` (spec 06, 3.17): copies a store team into `.bowerloom/teams/<id>` and switches bowerloom.json to the
 * project copy. The plan is the create plan of the copy and the config change; it reads no network. Apply runs both under
 * one project lock: the create path (pending record, staging, move, receipt), then bowerloom.json, then the lock.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../contracts/src/index.js';
import { inspectStore, verifyStorePins } from '../../project-context/src/index.js';
import type { HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import { applyCreate, planCreate } from '../../project-authoring/src/index.js';
import type { AuthoringReceipt, CreatePlan } from '../../project-authoring/src/index.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import { lstatOrNull, readTree } from '../../project-authoring/src/files.js';
import { authoringRefusal } from '../../project-authoring/src/refusal.js';
import { readConfig } from '../../project-config/src/config.js';
import { configRefusal } from '../../project-config/src/refusal.js';
import { lockItem, readLock } from '../../project-config/src/lock.js';
import { applyConfigChange, planConfigChange } from './change.js';
import type { ConfigChangePlan, ConfigChangeResult } from './change.js';
import { readStoreCache } from './store-git.js';

export const ADOPT_PLAN_FORMAT = 'bowerloom/team-adopt-plan/v1beta1' as const;
export const ADOPT_RESULT_FORMAT = 'bowerloom/team-adopt-result/v1beta1' as const;
export interface AdoptPlan {
  format: typeof ADOPT_PLAN_FORMAT; create: CreatePlan | null; config: ConfigChangePlan;
  /** True for a recovery plan: the copy and its receipt are in place, and only bowerloom.json and the lock remain. */
  finishing: boolean;
  /** Where the copy comes from: the live store, or a store cache folder. Null for a recovery plan. */
  from: 'store' | 'store-cache' | null;
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
  throw new DefinitionError('STORE_ITEM_MISSING', `${configRefusal('STORE_ITEM_MISSING').message} Next: ${ADOPT_MISSING_NEXT(input.id)}`);
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

/** Plans `team adopt <id>`. Reads only, and never the network. */
export async function planAdopt(input: AdoptInput): Promise<AdoptPlan> {
  const { project, id } = input;
  if (id === 'first-team') throw authoringRefusal('TEAM_ID_RESERVED');
  const read = readConfig(project);
  if (read.state === 'invalid') throw configRefusal(read.code);
  if (read.state !== 'valid' || !read.config.teams.some(t => t.id === id && t.source === 'store')) throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
  const finishing = recovering(project, id);
  let create: CreatePlan | null = null, from: AdoptPlan['from'] = null;
  if (!finishing) {
    const src = sourceRoot(input); from = src.from;
    create = await planCreate({ kind: 'team', project: project.dir, name: id, copyFrom: { root: src.root } });
  }
  const config = await planConfigChange({ project, home: input.home, op: 'adopt', kind: 'team', id });
  return { format: ADOPT_PLAN_FORMAT, create, config, finishing, from, revision: sha(canonicalJson({ create: create?.revision ?? null, config: config.revision })) };
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
