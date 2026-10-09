/**
 * `skills recover plan|apply --item <id>` for managed items v1beta2 (build plan 01, M4 and M5). It finds the one
 * unfinished operation of the item, through the pending marker or, when a kill came before the marker, the one
 * operation folder with no receipt, and plans its recovery with the M4 planner. Apply runs under the project lock
 * and calls the M4 held-lock recovery with the revision computed in that same locked run.
 */
import { join } from 'node:path';
import { directory, exists, names, path as managedPath } from '../../managed-skills/src/observed.js';
import { MARKER_V2, readPending } from '../../managed-skills/src/v2-observed.js';
import { planManagedItemRecovery, recoverManagedItemHeld } from '../../managed-skills/src/v2-transaction.js';
import type { ManagedItemReceipt, RecoveryAction, RecoveryPlanV2 } from '../../managed-skills/src/v2-types.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { checkProjectAncestry } from './plan.js';
import { outward, syncError } from './refusal.js';

export interface RecoverInput { project: ProjectContext; stateRoot: string; item: string; action: RecoveryAction | null }
/** Skill ids, and `prompt-<name>` for a prompt, as the private state folders are named. */
export const ITEM_ID = /^(?:prompt-)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RECOVERY_ACTIONS: readonly RecoveryAction[] = Object.freeze(['resume', 'abandon', 'rollback']);

function operationOf(input: RecoverInput): { stateDir: string; operationKey: string } {
  const dir = input.project.dir;
  if (typeof input.item !== 'string' || input.item.length > 71 || !ITEM_ID.test(input.item)) throw syncError('SKILLS_RECOVER_NOTHING');
  const stateDir = join(input.stateRoot, input.project.projectId, 'items', input.item);
  try { managedPath(stateDir); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
  if (!exists(stateDir)) throw syncError('SKILLS_RECOVER_NOTHING');
  try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
  if (exists(join(dir, MARKER_V2))) {
    let pending; try { pending = readPending(dir); } catch { throw syncError('MANAGED_SKILL_RECOVERY_REQUIRED', 'Its marker, .bowerloom/managed-pending.json, cannot be read. Check it by hand.'); }
    const owner = pending.item.kind === 'prompt' ? 'prompt-' + pending.item.id : pending.item.id;
    if (pending.stateDir !== stateDir) throw syncError('MANAGED_SKILL_RECOVERY_REQUIRED', `It belongs to ${owner}. Run bowerloom skills recover plan --item ${owner}.`);
    return { stateDir, operationKey: pending.operationKey };
  }
  const open = names(stateDir).filter(n => /^op-[a-f0-9]{64}$/.test(n) && !exists(join(stateDir, n, 'receipt.json')));
  if (open.length === 0) throw syncError('SKILLS_RECOVER_NOTHING');
  if (open.length > 1) throw syncError('MANAGED_SKILL_RECOVERY_REQUIRED', 'More than one operation of this item is unfinished. Check its private state folder by hand.');
  return { stateDir, operationKey: open[0]!.slice(3) };
}

/** Plans the recovery. Without an action it takes the first that the M4 planner accepts: resume, then abandon, then rollback. */
export async function planItemRecovery(input: RecoverInput): Promise<RecoveryPlanV2> {
  try {
    checkProjectAncestry(input.project);
    const { stateDir, operationKey } = operationOf(input), actions = input.action ? [input.action] : RECOVERY_ACTIONS;
    let last: unknown;
    for (const action of actions) {
      try { return await planManagedItemRecovery({ projectDir: input.project.dir, stateDir, operationKey, action }); } catch (e) { last = e; }
    }
    throw outward(last, 'MANAGED_SKILL_RECOVERY_REQUIRED', 'No recovery action fits it as it is now. Check its private state folder by hand.');
  } catch (e) { throw outward(e, 'MANAGED_SKILL_RECOVERY_REQUIRED'); }
}

/** Applies the recovery whose revision the person approved, planned again under the lock. */
export async function applyItemRecovery(input: RecoverInput, revision: string): Promise<ManagedItemReceipt> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw syncError('STALE_APPROVAL');
  try {
    return await withProjectLock(input.project.dir, new AbortController().signal, async held => {
      const fresh = await planItemRecovery(input);
      if (fresh.revision !== revision) throw syncError('STALE_APPROVAL');
      return recoverManagedItemHeld(held, fresh, revision, {});
    });
  } catch (e) { throw outward(e, 'MANAGED_SKILL_RECOVERY_REQUIRED'); }
}
