/**
 * What `skills sync` calls outside itself. Production network reads stay inside the existing acquisition modules:
 * `acquireNpmSkill` and `acquireGitSkill`, each run on an acquisition plan the orchestrator computed in the same
 * locked run and approved with that plan's own revision. Fetched bytes are hashed and copied, never interpreted.
 * Tests pass a fake Acquirer (no network) and may wrap the managed port to watch every child plan and apply.
 */
import { acquireNpmSkill } from '../../skill-sources/src/npm.js';
import type { NpmAcquisitionPlan } from '../../skill-sources/src/npm.js';
import { acquireGitSkill } from '../../skill-sources/src/git.js';
import type { GitAcquisitionPlan } from '../../skill-sources/src/git.js';
import type { AcquiredSkillCacheReceipt } from '../../skill-sources/src/cache.js';
import { planManagedItem } from '../../managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../managed-skills/src/v2-transaction.js';
import type { ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';

export interface Acquirer {
  npm(plan: Readonly<NpmAcquisitionPlan>, approval: string, signal: AbortSignal): Promise<Readonly<AcquiredSkillCacheReceipt>>;
  git(plan: Readonly<GitAcquisitionPlan>, approval: string, signal: AbortSignal): Promise<Readonly<AcquiredSkillCacheReceipt>>;
}
/** The managed v1beta2 entry points one child uses: plan (reads only) and apply (under the caller's held lock). */
export interface ManagedPort {
  plan(req: ManagedItemRequest, options: { signal?: AbortSignal }): Promise<ManagedItemPlan | UpToDateV2>;
  apply(held: HeldProjectLock, req: ManagedItemRequest, revision: string, options: Record<string, never>): Promise<ManagedItemReceipt>;
}
/**
 * `signal` is the person's interrupt. It stops planning and fetching at once, but a child that has begun applying
 * always finishes: the orchestrator checks the signal only between children.
 */
export interface SyncDeps { acquirer: Acquirer; signal: AbortSignal; managed?: ManagedPort }

/** The production Acquirer: the existing guarded npm and GitHub acquisitions, nothing else. */
export const productionAcquirer: Acquirer = Object.freeze({
  npm: (plan: Readonly<NpmAcquisitionPlan>, approval: string, signal: AbortSignal) => acquireNpmSkill(plan, { approvalRevision: approval, signal }),
  git: (plan: Readonly<GitAcquisitionPlan>, approval: string, signal: AbortSignal) => acquireGitSkill(plan, { approvalRevision: approval, signal }),
});
/** The production managed port. */
export const managedPort: ManagedPort = Object.freeze({
  plan: (req: ManagedItemRequest, options: { signal?: AbortSignal }) => planManagedItem(req, options.signal ? { signal: options.signal } : {}),
  apply: (held: HeldProjectLock, req: ManagedItemRequest, revision: string) => applyManagedItem(held, req, revision, {}),
});
