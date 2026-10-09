import type { SkillSourceInput, SkillSourceValidation } from '../../skill-sources/src/types.js';
export interface SyntheticDirectoryIdentity { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }
export interface ManagedSkillTarget {
  project: { path: string; identity: SyntheticDirectoryIdentity };
  state: { path: string; identity: SyntheticDirectoryIdentity };
  projectParentIdentity: SyntheticDirectoryIdentity; stateParentIdentity: SyntheticDirectoryIdentity;
  harness: 'codex' | 'claude';
}
export interface SkillInventoryEntry { path: string; kind: 'file' | 'directory'; sha256: string | null; bytes: number; mode: number }
export interface ManagedSkillSnapshot {
  format: 'bowerloom/synthetic-managed-skill-snapshot/v1beta1'; synthetic: true;
  policyVersion: 'bowerloom/managed-skill-projection/v1beta1'; source: SkillSourceInput;
  target: ManagedSkillTarget; managedInventory: SkillInventoryEntry[]; previousRevision: string | null;
  executionAuthorized: false; writesAuthorized: false; grantsAuthority: false; revision: string;
}
export interface ManagedSkillPlanInput {
  format: 'bowerloom/synthetic-managed-skill-request/v1beta1'; synthetic: true;
  operation: 'install' | 'update'; source: SkillSourceInput; target: ManagedSkillTarget;
  prior: ManagedSkillSnapshot | null; currentInventory: SkillInventoryEntry[];
}
export interface ManagedSkillPlan {
  format: 'bowerloom/synthetic-managed-skill-plan/v1beta1'; operation: 'install' | 'update';
  evidence: 'synthetic-caller-supplied'; policyVersion: 'bowerloom/managed-skill-projection/v1beta1';
  target: ManagedSkillTarget; source: SkillSourceValidation; priorRevision: string | null;
  beforeInventory: SkillInventoryEntry[]; afterInventory: SkillInventoryEntry[];
  changes: { path: string; action: 'add' | 'change' | 'remove'; before: SkillInventoryEntry | null; after: SkillInventoryEntry | null }[];
  writes: { path: string; text: string; sha256: string; mode: number }[];
  proposedState: ManagedSkillSnapshot;
  acquisitionVerified: false; filesystemObserved: false; installationVerified: false;
  executionAuthorized: false; writesAuthorized: false; grantsAuthority: false; revision: string;
}
