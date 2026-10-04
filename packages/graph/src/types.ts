import type { CompiledPlan, DataType } from '../../contracts/src/index.js';
import type { Proposal, Receipt } from '../../broker/src/index.js';
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
export interface GraphInput {
  workspaceId: string;
  runId: string;
  plan: CompiledPlan;
  // Trusted UTF-8 snapshots, verified against every compiled asset, including prompts and skills.
  assets: Record<string, string>;
  owners: Record<string, { subject: string; epoch: number }>;
}
export interface Artifact {
  path: string;
  mediaType: string;
  content: string;
  digest: string;
  bytes: number;
}
export interface ValueBinding {
  type: DataType;
  // Artifacts use null here; their value is the verified artifact itself.
  value: JsonValue;
  valueDigest: string;
  artifact: Artifact;
}
export interface ExecutionRequest {
  format: 'trellis/graph-task/v0.7-alpha';
  graphId: string;
  executionId: string;
  requestDigest: string;
  workspaceId: string;
  runId: string;
  taskId: string;
  ownerId: string;
  ownerSubject: string;
  ownerEpoch: number;
  candidateRevision: string;
  inputs: Record<string, ValueBinding>;
  completedDependencies: string[];
  plan: CompiledPlan;
  assets: Record<string, string>;
}
export interface Completion { proposal: Proposal; receipt: Receipt; evidenceRef: string }
export interface ExecutionObservation {
  executionId: string;
  requestDigest: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'HOLD' | 'CANCELLED' | 'ACCEPTANCE_FAILED' | 'COMPLETED';
  reason: string | null;
  completion: Completion | null;
}
export interface TaskExecutor {
  // Controller-only bridge to an already durable runtime; no models or effects in this package.
  // A consumed graph claim is never submitted twice, even after an exception or lost acknowledgement.
  submit(request: ExecutionRequest): Promise<void>;
  inspect(request: ExecutionRequest): Promise<ExecutionObservation | null>;
}
export interface GraphTaskState {
  claim: { executionId: string; requestDigest: string } | null;
  observation: ExecutionObservation | null;
  output: ValueBinding | null;
}
export interface GraphState {
  format: 'trellis/graph-state/v0.7-alpha';
  id: string;
  input: GraphInput;
  inputDigest: string;
  cancelRequested: boolean;
  holdReason: string | null;
  tasks: Record<string, GraphTaskState>;
}
export type GraphStatus = 'READY' | 'RUNNING' | 'WAITING_APPROVAL' | 'HOLD' | 'CANCELLED' | 'ACCEPTANCE_FAILED' | 'COMPLETED';
export interface GraphView { status: GraphStatus; state: GraphState }
export interface GraphStore {
  /**
   * Durable serializable transaction per graph ID, including creation when current is null.
   * Invoke change synchronously exactly once under the lock. Isolate/detach its input and result.
   * Commit its replacement state before resolving; exceptions roll back. Never retry a callback.
   * An ambiguous acknowledgement must reject with no result. Do not convert it to success.
   * Implement version/checksum validation, bounded storage and rollback, and retain history.
   * A Map is suitable for tests only. PostgresGraphStore implements this contract.
   */
  transaction<T>(graphId: string, change: (current: GraphState | null) => { state: GraphState; result: T }): Promise<T>;
}
export class GraphError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'GraphError'; }
}
