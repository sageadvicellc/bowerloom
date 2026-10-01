import { canonicalJson, digest } from '../../contracts/src/index.js';
import { BrokerError } from './index.js';
import type { BrokerStore, Clock, EffectRequest, EffectResult, Receipt, Scope, TaskState, WorkspaceEffects } from './types.js';

// These adapters are for deterministic tests. They provide no persistent state or OS containment.
export class InMemoryBrokerStore implements BrokerStore {
  readonly #states = new Map<string, TaskState>();
  #queue: Promise<void> = Promise.resolve();
  seed(state: TaskState): void {
    const key = canonicalJson(state.scope);
    if (this.#states.has(key)) throw new BrokerError('SCOPE_EXISTS', 'The synthetic task already exists.');
    this.#states.set(key, structuredClone(state));
  }
  transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T> {
    const key = canonicalJson(scope);
    const result = this.#queue.then(() => {
      const current = this.#states.get(key);
      if (!current) throw new BrokerError('SCOPE_NOT_FOUND', 'The synthetic task does not exist.');
      const draft = structuredClone(current);
      const result = mutate(draft);
      if (result && typeof result === 'object' && 'then' in result) throw new BrokerError('ASYNC_TRANSACTION', 'The transaction callback must be synchronous.');
      const detachedResult = structuredClone(result);
      this.#states.set(key, structuredClone(draft));
      return detachedResult;
    });
    this.#queue = result.then(() => {}, () => {});
    return result;
  }
}

export class InMemoryWorkspaceEffects implements WorkspaceEffects {
  readonly #files = new Map<string, string>();
  readonly #receipts = new Map<string, Receipt>();
  readonly #clock: Clock;
  constructor(clock: Clock) { this.#clock = clock; }
  seed(workspaceId: string, path: string, content: string): void { this.#files.set(canonicalJson({ workspaceId, path }), content); }
  read(workspaceId: string, path: string): string | undefined { return this.#files.get(canonicalJson({ workspaceId, path })); }
  async apply(request: EffectRequest, signal: AbortSignal): Promise<EffectResult> {
    const existing = this.#receipts.get(request.operationKey);
    if (existing) {
      if (existing.actionDigest !== request.actionDigest) throw new BrokerError('RECEIPT_CONFLICT', 'The operation key already identifies a different effect.');
      return { kind: 'applied', receipt: structuredClone(existing) };
    }
    if (signal.aborted || this.#clock.now() >= request.deadlineMs) throw new BrokerError('DISPATCH_STOPPED', 'The synthetic effect deadline or cancellation stopped this call.');
    const { scope, edit } = request.proposal;
    const fileKey = canonicalJson({ workspaceId: scope.workspaceId, path: edit.path });
    const previous = this.#files.get(fileKey);
    const beforeDigest = previous === undefined ? null : digest(previous);
    if (beforeDigest !== edit.expectedDigest) return { kind: 'not-applied', operationKey: request.operationKey, actionDigest: request.actionDigest, reason: 'PRECONDITION_FAILED' };
    const receipt: Receipt = { format: 'trellis/effect-receipt/v0.7-alpha', operationKey: request.operationKey, actionDigest: request.actionDigest,
      workspaceId: scope.workspaceId, path: edit.path, beforeDigest, afterDigest: digest(edit.content), bytes: Buffer.byteLength(edit.content), appliedAtMs: this.#clock.now() };
    this.#files.set(fileKey, edit.content);
    this.#receipts.set(request.operationKey, receipt);
    return { kind: 'applied', receipt: structuredClone(receipt) };
  }
  async lookup(request: EffectRequest): Promise<Receipt | null> {
    const receipt = this.#receipts.get(request.operationKey);
    return receipt ? structuredClone(receipt) : null;
  }
}
