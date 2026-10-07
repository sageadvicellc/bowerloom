/**
 * Managed items v1beta2 (build plan 01, section 3). One operation covers one item, a skill or a prompt,
 * across all of its surfaces. The v1beta1 files (observed.ts, transaction.ts, observed-types.ts) are unchanged.
 */
import type { AcquiredSkillCacheSelector } from '../../skill-sources/src/cache.js';
import type { Identity, FilePin, JournalRecord } from './observed-types.js';
export type { Identity, FilePin, JournalRecord };

/**
 * The five item surfaces of the plan, plus two operation surfaces the plan does not name:
 * `ignore` is the shared `.bowerloom/managed/.gitignore`, planned only by the operation that finds it absent;
 * `legacy` is the whole v1beta1 namespace `.bowerloom-skills/`, moved out (backup only) by a migrate operation.
 */
export type ItemSurfaceId = 'canonical' | 'catalog' | 'projection-claude' | 'projection-codex' | 'command-claude';
export type SurfaceId = ItemSurfaceId | 'ignore' | 'legacy';
export type SurfaceKind = 'directory' | 'file';
export type Harness = 'claude' | 'codex';
export interface SurfaceV2 { id: SurfaceId; kind: SurfaceKind; path: string; pins: FilePin[] | null }
export interface MaterialV2 { id: SurfaceId; kind: SurfaceKind; files: { path: string; text: string; sha256: string; mode: number }[] }
export interface ItemRef { kind: 'skill' | 'prompt'; id: string }
export type ItemSource = { kind: 'cache'; selector: AcquiredSkillCacheSelector } | { kind: 'local'; path: string } | { kind: 'prompt'; name: string };
export interface LegacyRef { stateDir: string; operationKey: string }
export interface ManagedItemRequest {
  operation: 'install' | 'update' | 'migrate'; projectDir: string; stateDir: string; item: ItemRef; harnesses: Harness[];
  source: ItemSource; expectedPreviousRevision: string | null; minFreeBytes: number; legacy: LegacyRef | null;
}
export interface InventoryRow { path: string; sha256: string; bytes: number }
export interface ItemFile { path: string; text: string; sha256: string; mode: number }
/** The local reader's result. Content only: no absolute path, identity or time. */
export interface LocalClosure {
  format: 'bowerloom/local-item-closure/v1beta2'; source: { kind: 'local'; path: string } | { kind: 'prompt'; path: string };
  files: ItemFile[]; inventory: InventoryRow[]; executionAuthorized: false;
}
/** The material source of one item, normalized from a cache closure or a local closure. Content only. */
export interface ItemClosure {
  format: 'bowerloom/managed-item-closure/v1beta2'; source: unknown; skill: { id: string; name: string; sourceRoot: string } | null;
  license: unknown; references: unknown[]; inventory: InventoryRow[]; files: ItemFile[]; name: string;
}
/** The bound v1beta1 install of a migrate operation. The v1 state folder is read, never written. */
export interface LegacyCore { stateDir: string; operationKey: string; receiptRevision: string; receiptPin: FilePin; harness: Harness }
export interface PlanCoreV2 {
  request: ManagedItemRequest; bindings: { path: string; identity: Identity }[];
  closure: ItemClosure; before: SurfaceV2[]; previous: ManagedItemReceipt | null; previousReceiptPin: FilePin | null;
  parents: { path: string; identity: Identity | null }[]; legacy: LegacyCore | null;
}
export interface ManagedItemPlan {
  format: 'bowerloom/managed-item-plan/v1beta2'; policy: 'bowerloom/managed-items/v1beta2';
  core: PlanCoreV2; operationKey: string; material: MaterialV2[]; revision: string;
  filesystemObserved: true; writesAuthorized: false; executionAuthorized: false;
}
export interface MigratedFrom { format: 'bowerloom/observed-managed-skill-receipt/v1beta1'; stateDir: string; operationKey: string; revision: string }
export interface ManagedItemReceipt {
  format: 'bowerloom/managed-item-receipt/v1beta2'; state: 'committed' | 'rolled-back'; item: ItemRef;
  operationKey: string; planRevision: string; previousRevision: string | null;
  projectDir: string; stateDir: string; harnesses: Harness[]; installed: SurfaceV2[]; restoredPrevious: ManagedItemReceipt | null;
  migratedFrom: MigratedFrom | null; executionAuthorized: false; revision: string;
}
export interface UpToDateV2 { format: 'bowerloom/managed-item-up-to-date/v1beta2'; status: 'up-to-date'; item: ItemRef; previousRevision: string; writesAuthorized: false; executionAuthorized: false }
export interface IntentV2 { format: 'bowerloom/managed-item-intent/v1beta2'; plan: ManagedItemPlan; operationIdentity: Identity; approvalRevision: string }
export interface PendingV2 { format: 'bowerloom/managed-item-pending/v1beta2'; item: ItemRef; operationKey: string; stateDir: string; operationIdentity: Identity; intentSha256: string }
export interface RecoveryPlanV2 {
  format: 'bowerloom/managed-item-recovery/v1beta2'; projectDir: string; stateDir: string;
  operationKey: string; action: 'resume' | 'rollback'; snapshotRevision: string; planRevision: string; revision: string;
  writesAuthorized: false; executionAuthorized: false;
}
export interface ManagedItemStatus { item: ItemRef; status: 'committed' | 'drift' | 'unowned' | 'refused'; receiptRevision: string | null; code: string | null }
export interface ManagedProjectInspection {
  format: 'bowerloom/managed-project-inspection/v1beta2'; legacy: boolean;
  pending: { item: ItemRef; operationKey: string; stateDir: string } | null; items: ManagedItemStatus[];
  writesAuthorized: false; executionAuthorized: false;
}
