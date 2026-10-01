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
  readonly #outcomes = new Map<string, EffectResult>();
  readonly #clock: Clock;
  constructor(clock: Clock) { this.#clock = clock; }
  seed(workspaceId: string, path: string, content: string): void { this.#files.set(canonicalJson({ workspaceId, path }), content); }
  read(workspaceId: string, path: string): string | undefined { return this.#files.get(canonicalJson({ workspaceId, path })); }
  async apply(request: EffectRequest, signal: AbortSignal): Promise<EffectResult> {
    const existing = this.#outcomes.get(request.operationKey);
    if (existing) {
      const actionDigest = existing.kind === 'applied' ? existing.receipt.actionDigest : existing.actionDigest;
      if (actionDigest !== request.actionDigest) throw new BrokerError('RECEIPT_CONFLICT', 'The operation key already identifies a different effect.');
      return structuredClone(existing);
    }
    if (signal.aborted || this.#clock.now() >= request.deadlineMs) throw new BrokerError('DISPATCH_STOPPED', 'The synthetic effect deadline or cancellation stopped this call.');
    const { scope, edit } = request.proposal;
    const fileKey = canonicalJson({ workspaceId: scope.workspaceId, path: edit.path });
    const previous = this.#files.get(fileKey);
    const beforeDigest = previous === undefined ? null : digest(previous);
    if (beforeDigest !== edit.expectedDigest) {
      const result: EffectResult = { kind: 'not-applied', operationKey: request.operationKey, actionDigest: request.actionDigest, reason: 'PRECONDITION_FAILED' };
      this.#outcomes.set(request.operationKey, result);
      return structuredClone(result);
    }
    const receipt: Receipt = { format: 'trellis/effect-receipt/v0.7-alpha', operationKey: request.operationKey, actionDigest: request.actionDigest,
      workspaceId: scope.workspaceId, path: edit.path, beforeDigest, afterDigest: digest(edit.content), bytes: Buffer.byteLength(edit.content), appliedAtMs: this.#clock.now() };
    this.#files.set(fileKey, edit.content);
    this.#outcomes.set(request.operationKey, { kind: 'applied', receipt });
    return { kind: 'applied', receipt: structuredClone(receipt) };
  }
  async lookup(request: EffectRequest): Promise<Receipt | null> {
    const outcome = this.#outcomes.get(request.operationKey);
    return outcome?.kind === 'applied' ? structuredClone(outcome.receipt) : null;
  }
}
