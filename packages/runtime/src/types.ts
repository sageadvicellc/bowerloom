import type { CompiledPlan } from '../../contracts/src/index.js';
import type { TaskConfiguration, Receipt, Proposal } from '../../broker/src/index.js';
import type { ReservationRequest } from '../../admission/src/index.js';
export interface RunInput {
  plan: CompiledPlan;
  task: TaskConfiguration;
  reservation: ReservationRequest;
  taskInput: string;
}
export interface ProcessIdentity { processRef: string; ownershipDigest: string; pid: number; groupId: number; launcherId: string }
export interface ModelProcess {
  identity: ProcessIdentity;
  // Resolve only after the owned process has been reaped; output is one strict proposal.
  result: Promise<string>;
  terminate(): Promise<void>;
}
export interface ModelAdapter {
  // Trusted adapter: exact commands and bounded resources, never worker-supplied commands.
  // Check the signal immediately before spawn, own at most one group, and reap it on abort.
  // A production adapter must add native tool denial, network policy, and an orphan guardian.
  start(input: { launcherId: string; taskInput: string; modelRoute: string }, signal: AbortSignal): Promise<ModelProcess>;
}
export interface Acceptance { accepted: boolean; evidenceRef: string }
export interface AcceptanceContext {
  signal: AbortSignal;
  launcherId: string;
  ownerCredential: unknown;
  guard(): Promise<void>;
}
export interface AcceptanceReader {
  read(input: RunInput, receipt: Receipt, context: AcceptanceContext): Promise<Acceptance>;
  // Controller-owned cleanup hooks; never authorize a new execution.
  cancel?(input: RunInput, receipt?: Receipt): Promise<void>;
  close?(): Promise<void>;
}
export interface ModelOutcome { processRef: string; completedAtMs: number; proofRef: string }
export interface RunState {
  version: 1;
  id: string;
  input: RunInput;
  inputDigest: string;
  cancelled: boolean;
  status: 'QUEUED' | 'WAITING_APPROVAL' | 'HOLD' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTANCE_FAILED';
  reason: string | null;
  process: (ProcessIdentity & { reservationId: string; candidateRevision: string }) | null;
  modelOutcome: ModelOutcome | null;
  proposal: Proposal | null;
  receipt: Receipt | null;
  acceptance: Acceptance | null;
}
export class RuntimeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RuntimeError'; }
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new RuntimeError('INVALID_ID');
  return value;
}
export function schemaName(value: string): string {
  if (!/^trellis_[a-z][a-z0-9_]{0,46}$/.test(value)) throw new RuntimeError('INVALID_SCHEMA');
  return `"${value}"`;
}
