import type { AcquiredSkillCacheSelector, AcquiredSkillClosure } from '../../skill-sources/src/cache.js';
export interface Identity { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }
export interface FilePin { path: string; identity: Identity; bytes: number; sha256: string | null; mtimeNs: string; ctimeNs: string }
export interface Surface { kind: 'canonical' | 'projection' | 'catalog'; path: string; pins: FilePin[] | null }
export interface Material { kind: Surface['kind']; files: { path: string; text: string; sha256: string; mode: number }[] }
export interface ObservedSkillRequest {
  operation: 'install' | 'update'; projectDir: string; stateDir: string; harness: 'codex' | 'claude';
  cache: AcquiredSkillCacheSelector; expectedPreviousRevision: string | null; minFreeBytes: number;
}
export interface PlanCore {
  request: ObservedSkillRequest; bindings: { path: string; identity: Identity }[];
  closure: AcquiredSkillClosure; before: Surface[]; previous: ObservedSkillReceipt | null; previousReceiptPin: FilePin | null;
  parents: { path: string; identity: Identity | null }[];
}
export interface ObservedSkillPlan {
  format: 'bowerloom/observed-managed-skill-plan/v1beta1'; policy: 'bowerloom/observed-managed-skill/v1beta1';
  core: PlanCore; operationKey: string; material: Material[]; revision: string;
  acquisitionObserved: true; filesystemObserved: true; writesAuthorized: false; executionAuthorized: false;
}
export interface ObservedSkillReceipt {
  format: 'bowerloom/observed-managed-skill-receipt/v1beta1'; state: 'committed' | 'rolled-back';
  operationKey: string; planRevision: string; previousRevision: string | null;
  projectDir: string; stateDir: string; harness: 'codex' | 'claude';
  installed: Surface[]; restoredPrevious: ObservedSkillReceipt | null; revision: string; executionAuthorized: false;
}
export interface SkillInspection {
  format: 'bowerloom/observed-managed-skill-inspection/v1beta1'; status: 'absent' | 'committed' | 'rolled-back' | 'pending';
  receipt: ObservedSkillReceipt | null; operationKey: string | null; executionAuthorized: false; writesAuthorized: false;
}
export interface UpToDate { format: 'bowerloom/managed-skill-up-to-date/v1beta1'; status: 'up-to-date'; previousRevision: string; writesAuthorized: false; executionAuthorized: false }
export interface JournalRecord { sequence: number; previous: string | null; kind: string; data: unknown; revision: string }
export interface Intent { format: 'bowerloom/managed-skill-intent/v1beta1'; plan: ObservedSkillPlan; operationIdentity: Identity; approvalRevision: string }
export interface RecoveryPlan {
  format: 'bowerloom/observed-managed-skill-recovery/v1beta1'; projectDir: string; stateDir: string;
  operationKey: string; action: 'resume' | 'rollback'; snapshotRevision: string; planRevision: string; revision: string;
  writesAuthorized: false; executionAuthorized: false;
}
