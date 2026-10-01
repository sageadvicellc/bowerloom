import type { Clock, IdentityProvider, Receipt, Scope, TaskState } from '../../broker/src/index.js';
import type { RunInput, Acceptance, AcceptanceContext } from '../../runtime/src/types.js';
export const CRITERIA = ['add-job','change-stage','reload','export'] as const;
export interface TestManifest {
  format: 'trellis/registered-test/v0.7-alpha';
  testId: 'craft-shop-ui-v1';
  testerDigest: string;
  environmentDigest: string;
  criteria: readonly ['add-job','change-stage','reload','export'];
  limits: { timeoutMs: number; outputBytes: number; artifactBytes: number };
}
export interface TestRequest {
  format: 'trellis/test-request/v0.7-alpha';
  operationId: string;
  scope: Scope;
  candidateRevision: string;
  ownerEpoch: number;
  writeRequestId: string;
  writeOperationKey: string;
  writeActionDigest: string;
  manifest: TestManifest;
  manifestDigest: string;
  artifact: { path: string; content: string; digest: string; bytes: number };
}
export interface TestExecution extends TestRequest {
  requestDigest: string;
  launcherId: string;
  startedAtMs: number;
  deadlineMs: number;
}
export interface TestReport {
  format: 'trellis/test-report/v0.7-alpha';
  operationId: string;
  requestDigest: string;
  manifestDigest: string;
  artifactDigest: string;
  checks: { id: typeof CRITERIA[number]; passed: boolean; observation: string }[];
  exported: { digest: string; bytes: number } | null;
  exitCode: 0 | 1;
  stdout: { digest: string; bytes: number };
  stderr: { digest: string; bytes: number };
  scratchBytesPeak: number;
  scratchRemoved: true;
}
/** Trusted registered browser implementation, never a worker-supplied callback or command.
 * execute must enforce manifest time/output/scratch permissions and use only its pinned runner.
 * reap only terminates/reaps this executor's owned operation. Unknown ownership must reject.
 * It must also fence a pending execute so it cannot spawn after reap resolves.
 */
export interface TestExecutor {
  execute(request: TestExecution, signal: AbortSignal): Promise<TestReport>;
  reap(operationId: string): Promise<void>;
}
export interface TestEvidence {
  format: 'trellis/test-evidence/v0.7-alpha';
  request: TestExecution;
  approvalDigest: string;
  finishedAtMs: number;
  report: TestReport;
  accepted: boolean;
  processesReaped: true;
}
export interface TestRecord {
  version: 1;
  id: string;
  request: TestExecution;
  approvalDigest: string;
  status: 'CLAIMED' | 'PASSED' | 'FAILED' | 'HOLD' | 'CANCELLED';
  reason: string | null;
  evidence: TestEvidence | null;
  evidenceRef: string | null;
}
export interface TestStore {
  /** Lock the current broker task and scoped test record together; callback is synchronous,
   * invoked once, detached, committed before resolution. Unknown commits reject with no result.
   * Authority is read-only; never publish mutations to it. No callback/commit retry. */
  transaction<T>(scope: Scope, id: string, change: (record: TestRecord | null, authority: TaskState) => {record: TestRecord | null; result: T}): Promise<T>;
}
export interface TestDependencies { store: TestStore; manifest: string; executor: TestExecutor; identity: IdentityProvider; clock?: Clock }
export interface ControlledAcceptance {
  read(input: RunInput, receipt: Receipt, context: AcceptanceContext): Promise<Acceptance>;
  cancel(input: RunInput): Promise<void>;
  close(): Promise<void>;
}
export class TestError extends Error { constructor(readonly code: string) { super(code); this.name='TestError'; } }
