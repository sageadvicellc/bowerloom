import type { Task } from '../../contracts/src/index.js';

export interface Scope { workspaceId: string; runId: string; taskId: string }
export interface Principal { subject: string; proofRef: string; expiresAtMs: number }
export interface IdentityProvider { authenticate(credential: unknown): Promise<Principal> }
export interface Clock {
  now(): number;
  alarm(deadlineMs: number, callback: () => void): () => void;
}
export interface Proposal {
  format: 'trellis/action/v0.7-alpha';
  scope: Scope;
  requestId: string;
  candidateRevision: string;
  ownerEpoch: number;
  edit: { operation: 'workspace.write'; path: string; expectedDigest: string | null; content: string };
}
export interface ApprovalRequest {
  candidateRevision: string;
  actionDigest: string;
  ownerEpoch: number;
  expiresAtMs: number;
}
export interface Approval extends ApprovalRequest { subject: string; proofRef: string; scope: Scope; requestId: string }
export interface Receipt {
  format: 'trellis/effect-receipt/v0.7-alpha';
  operationKey: string;
  actionDigest: string;
  workspaceId: string;
  path: string;
  beforeDigest: string | null;
  afterDigest: string;
  bytes: number;
  appliedAtMs: number;
}
export type ActionStatus = 'PREPARED' | 'IN_FLIGHT' | 'COMPLETED' | 'NOT_APPLIED' | 'NEEDS_RECONCILIATION' | 'CANCELLED';
export interface ActionRecord {
  proposal: Proposal;
  actionDigest: string;
  operationKey: string;
  status: ActionStatus;
  approval: Approval | null;
  preparedAtMs: number;
  dispatchedAtMs: number | null;
  dispatchDeadlineMs: number | null;
  receipt: Receipt | null;
  outcomeReason: string | null;
}
export interface TaskState {
  scope: Scope;
  candidateRevision: string;
  task: Task;
  ownerSubject: string;
  ownerEpoch: number;
  approverSubjects: string[];
  readyAtMs: number;
  leaseExpiresAtMs: number;
  completedDependencies: string[];
  cancelRequested: boolean;
  actions: Record<string, ActionRecord>;
}
export interface TaskConfiguration extends Scope {
  ownerSubject: string;
  ownerEpoch: number;
  approverSubjects: string[];
  readyAtMs: number;
  leaseExpiresAtMs: number;
  completedDependencies: string[];
}
export interface BrokerStore {
  // The implementation must isolate all changes and commit before resolving.
  transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T>;
}
export interface EffectRequest {
  proposal: Proposal;
  actionDigest: string;
  operationKey: string;
  deadlineMs: number;
}
export type EffectResult =
  | { kind: 'applied'; receipt: Receipt }
  | { kind: 'not-applied'; operationKey: string; actionDigest: string; reason: 'PRECONDITION_FAILED' };
export interface WorkspaceEffects {
  apply(request: EffectRequest, signal: AbortSignal): Promise<EffectResult>;
  lookup(request: EffectRequest): Promise<Receipt | null>;
}
