import { assertPortablePath, canonicalJson, digest, PLAN_FORMAT, validateDefinition } from '../../contracts/src/index.js';
import type { CompiledPlan } from '../../contracts/src/index.js';
import type {
  ActionRecord, ApprovalRequest, BrokerStore, Clock, EffectRequest, EffectResult,
  IdentityProvider, Principal, Proposal, Receipt, Scope, TaskConfiguration, TaskState, WorkspaceEffects,
} from './types.js';
export type * from './types.js';

export const BROKER_LIMITS = Object.freeze({ contentBytes: 256 * 1024, proposalBytes: 2 * 1024 * 1024, actionsPerTask: 128, approvalLifetimeMs: 15 * 60 * 1000 });
export class BrokerError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'BrokerError'; }
}
function refuse(code: string, message: string): never { throw new BrokerError(code, message); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameScope = (left: Scope, right: Scope): boolean => canonicalJson(left) === canonicalJson(right);
function copyScope(scope: Scope): Scope {
  if (!exact(scope, ['workspaceId', 'runId', 'taskId']) || !Object.values(scope).every(identifier)) refuse('INVALID_SCOPE', 'The action scope is invalid.');
  return structuredClone(scope);
}

export function parseProposal(serialized: string): Proposal {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > BROKER_LIMITS.proposalBytes) refuse('INVALID_PROPOSAL', 'The action exceeds its request limit.');
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { refuse('INVALID_PROPOSAL', 'The action must be valid JSON.'); }
  if (!exact(value, ['format', 'scope', 'requestId', 'candidateRevision', 'ownerEpoch', 'edit'])
    || value.format !== 'trellis/action/v0.7-alpha' || !identifier(value.requestId) || !sha(value.candidateRevision)
    || !timestamp(value.ownerEpoch) || value.ownerEpoch < 1) refuse('INVALID_PROPOSAL', 'The action envelope is invalid.');
  copyScope(value.scope as Scope);
  const edit = value.edit;
  if (!exact(edit, ['operation', 'path', 'expectedDigest', 'content']) || edit.operation !== 'workspace.write'
    || typeof edit.path !== 'string' || (edit.expectedDigest !== null && !sha(edit.expectedDigest))
    || typeof edit.content !== 'string' || Buffer.byteLength(edit.content) > BROKER_LIMITS.contentBytes
    || Buffer.from(edit.content).toString('utf8') !== edit.content) refuse('INVALID_PROPOSAL', 'Only bounded UTF-8 text writes with a prior digest are supported.');
  try { assertPortablePath(edit.path); } catch { refuse('UNSAFE_PATH', 'The action path must be a safe relative path.'); }
  return value as unknown as Proposal;
}

export function createTaskState(plan: CompiledPlan, configuration: TaskConfiguration): TaskState {
  const { candidateRevision, ...body } = structuredClone(plan);
  if (body.format !== PLAN_FORMAT || !sha(candidateRevision) || digest(canonicalJson(body)) !== candidateRevision) refuse('INVALID_PLAN', 'The compiled candidate digest does not match.');
  validateDefinition(body.definition);
  const task = body.definition.tasks.find(task => task.id === configuration.taskId);
  const scope = copyScope({ workspaceId: configuration.workspaceId, runId: configuration.runId, taskId: configuration.taskId });
  if (!task || !identifier(configuration.ownerSubject) || !timestamp(configuration.ownerEpoch) || configuration.ownerEpoch < 1
    || !Array.isArray(configuration.approverSubjects) || configuration.approverSubjects.length < 1
    || !configuration.approverSubjects.every(identifier) || !timestamp(configuration.readyAtMs)
    || !timestamp(configuration.leaseExpiresAtMs) || configuration.leaseExpiresAtMs <= configuration.readyAtMs
    || !timestamp(configuration.readyAtMs + task.policy.deadlineSeconds * 1000)
    || !Array.isArray(configuration.completedDependencies) || !configuration.completedDependencies.every(identifier)) {
    refuse('INVALID_GRANT', 'The trusted task grant is invalid.');
  }
  return structuredClone({ scope, candidateRevision, task, ownerSubject: configuration.ownerSubject, ownerEpoch: configuration.ownerEpoch,
    approverSubjects: configuration.approverSubjects, readyAtMs: configuration.readyAtMs, leaseExpiresAtMs: configuration.leaseExpiresAtMs,
    completedDependencies: configuration.completedDependencies, cancelRequested: false, actions: {} });
}

export const systemClock: Clock = {
  now: () => Date.now(),
  alarm(deadlineMs, callback) { const timer = setTimeout(callback, Math.max(0, deadlineMs - Date.now())); return () => clearTimeout(timer); },
};

export class ActionBroker {
  readonly #store: BrokerStore;
  readonly #identity: IdentityProvider;
  readonly #effects: WorkspaceEffects;
  readonly #clock: Clock;
  readonly #active = new Map<string, AbortController>();
  constructor(dependencies: { store: BrokerStore; identity: IdentityProvider; effects: WorkspaceEffects; clock?: Clock }) {
    this.#store = dependencies.store;
    this.#identity = dependencies.identity;
    this.#effects = dependencies.effects;
    this.#clock = dependencies.clock ?? systemClock;
  }
  #now(): number {
    const now = this.#clock.now();
    if (!timestamp(now)) refuse('CLOCK_UNAVAILABLE', 'A valid time observation is required.');
    return now;
  }
  async #principal(credential: unknown): Promise<Principal> {
    let principal: Principal;
    try { principal = structuredClone(await this.#identity.authenticate(credential)); }
    catch { return refuse('UNAUTHENTICATED', 'Authentication is required.'); }
    if (!identifier(principal.subject) || typeof principal.proofRef !== 'string' || !principal.proofRef.length || principal.proofRef.length > 256
      || !timestamp(principal.expiresAtMs) || principal.expiresAtMs <= this.#now()) refuse('UNAUTHENTICATED', 'A current identity proof is required.');
    return principal;
  }
  #actor(state: TaskState, scope: Scope, principal: Principal, kind: 'owner' | 'approver' | 'either'): void {
    if (!sameScope(state.scope, scope)) refuse('SCOPE_MISMATCH', 'The stored task does not match this scope.');
    if (principal.expiresAtMs <= this.#now()) refuse('UNAUTHENTICATED', 'The identity proof expired.');
    const owner = state.ownerSubject === principal.subject;
    const approver = state.approverSubjects.includes(principal.subject);
    if ((kind === 'owner' && !owner) || (kind === 'approver' && !approver) || (kind === 'either' && !owner && !approver)) refuse('FORBIDDEN', 'The caller lacks authority for this task.');
  }
  #admit(state: TaskState, proposal: Proposal): void {
    const now = this.#now();
    if (!sameScope(state.scope, proposal.scope) || state.candidateRevision !== proposal.candidateRevision || state.ownerEpoch !== proposal.ownerEpoch) {
      refuse('STALE_AUTHORITY', 'The action does not match the active candidate and ownership epoch.');
    }
    if (state.cancelRequested) refuse('CANCELLED', 'The task has a cancellation request.');
    if (now < state.readyAtMs || state.task.dependsOn.some(id => !state.completedDependencies.includes(id))) refuse('TASK_NOT_READY', 'Task readiness evidence is incomplete.');
    if (now >= state.leaseExpiresAtMs) refuse('LEASE_EXPIRED', 'The task ownership lease expired.');
    if (now >= state.readyAtMs + state.task.policy.deadlineSeconds * 1000) refuse('DEADLINE_EXPIRED', 'The task deadline expired.');
    const allowed = state.task.effects.some(effect => effect.operation === 'workspace.write'
      && (proposal.edit.path === effect.path || proposal.edit.path.startsWith(`${effect.path}/`)));
    if (!allowed || !state.task.requires.includes('workspace.write')) refuse('EFFECT_DENIED', 'The task does not permit this workspace write.');
  }
  #action(state: TaskState, requestId: string): ActionRecord {
    if (!identifier(requestId) || !Object.hasOwn(state.actions, requestId)) return refuse('ACTION_NOT_FOUND', 'The action does not exist in this task.');
    const action = state.actions[requestId]!;
    const expectedKey = digest(canonicalJson({ scope: action.proposal.scope, requestId: action.proposal.requestId, actionDigest: action.actionDigest }));
    if (!sameScope(action.proposal.scope, state.scope) || action.proposal.requestId !== requestId
      || digest(canonicalJson(action.proposal)) !== action.actionDigest || action.operationKey !== expectedKey) {
      refuse('RECORD_CONFLICT', 'The stored action does not match its pinned content and scope.');
    }
    return action;
  }
  async prepare(serialized: string, credential: unknown): Promise<ActionRecord> {
    const proposal = parseProposal(serialized);
    const principal = await this.#principal(credential);
    const actionDigest = digest(canonicalJson(proposal));
    return this.#store.transaction(proposal.scope, state => {
      this.#actor(state, proposal.scope, principal, 'owner');
      this.#admit(state, proposal);
      const existing = state.actions[proposal.requestId];
      if (existing) {
        this.#action(state, proposal.requestId);
        if (existing.actionDigest !== actionDigest) refuse('REQUEST_CONFLICT', 'The request ID already identifies different content.');
        return structuredClone(existing);
      }
      if (Object.keys(state.actions).length >= BROKER_LIMITS.actionsPerTask) refuse('ACTION_LIMIT', 'The task reached its action limit.');
      const record: ActionRecord = { proposal, actionDigest, operationKey: digest(canonicalJson({ scope: proposal.scope, requestId: proposal.requestId, actionDigest })),
        status: 'PREPARED', approval: null, preparedAtMs: this.#now(), dispatchedAtMs: null, dispatchDeadlineMs: null, receipt: null, outcomeReason: null };
      state.actions[proposal.requestId] = record;
      return structuredClone(record);
    });
  }
  async approve(scopeInput: Scope, requestId: string, requested: ApprovalRequest, credential: unknown): Promise<ActionRecord> {
    const scope = copyScope(scopeInput);
    const expected = structuredClone(requested);
    if (!exact(expected, ['candidateRevision', 'actionDigest', 'ownerEpoch', 'expiresAtMs']) || !sha(expected.candidateRevision)
      || !sha(expected.actionDigest) || !timestamp(expected.ownerEpoch) || !timestamp(expected.expiresAtMs)) refuse('INVALID_APPROVAL', 'The approval request is invalid.');
    const principal = await this.#principal(credential);
    return this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'approver');
      const action = this.#action(state, requestId);
      this.#admit(state, action.proposal);
      if (action.status !== 'PREPARED') refuse('ACTION_STATE', 'Only a prepared action can receive approval.');
      if (expected.candidateRevision !== action.proposal.candidateRevision || expected.actionDigest !== action.actionDigest
        || expected.ownerEpoch !== action.proposal.ownerEpoch) refuse('STALE_APPROVAL', 'Approval must identify this exact candidate, action, and ownership epoch.');
      const now = this.#now();
      if (expected.expiresAtMs <= now || expected.expiresAtMs > Math.min(now + BROKER_LIMITS.approvalLifetimeMs, principal.expiresAtMs,
        state.leaseExpiresAtMs, state.readyAtMs + state.task.policy.deadlineSeconds * 1000)) refuse('INVALID_APPROVAL', 'The approval expiry exceeds its permitted interval.');
      action.approval = { ...expected, subject: principal.subject, proofRef: principal.proofRef, scope, requestId };
      return structuredClone(action);
    });
  }
  async revokeApproval(scopeInput: Scope, requestId: string, credential: unknown): Promise<void> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    await this.#store.transaction(scope, state => { this.#actor(state, scope, principal, 'approver'); this.#action(state, requestId).approval = null; });
  }
  #approval(state: TaskState, action: ActionRecord): void {
    if (state.task.approval !== 'required') return;
    const approval = action.approval;
    if (!approval || approval.expiresAtMs <= this.#now() || !state.approverSubjects.includes(approval.subject)
      || !sameScope(approval.scope, state.scope) || approval.requestId !== action.proposal.requestId
      || approval.candidateRevision !== state.candidateRevision || approval.actionDigest !== action.actionDigest
      || approval.ownerEpoch !== state.ownerEpoch) refuse('APPROVAL_REQUIRED', 'A current approval for the exact action is required.');
  }
  #effectRequest(action: ActionRecord): EffectRequest {
    if (action.dispatchDeadlineMs === null) return refuse('ACTION_STATE', 'The action lacks a dispatch record.');
    return { proposal: structuredClone(action.proposal), actionDigest: action.actionDigest, operationKey: action.operationKey, deadlineMs: action.dispatchDeadlineMs };
  }
  #receipt(action: ActionRecord, receipt: Receipt): boolean {
    return exact(receipt, ['format', 'operationKey', 'actionDigest', 'workspaceId', 'path', 'beforeDigest', 'afterDigest', 'bytes', 'appliedAtMs'])
      && receipt.format === 'trellis/effect-receipt/v0.7-alpha' && receipt.operationKey === action.operationKey && receipt.actionDigest === action.actionDigest
      && receipt.workspaceId === action.proposal.scope.workspaceId && receipt.path === action.proposal.edit.path
      && receipt.beforeDigest === action.proposal.edit.expectedDigest && receipt.afterDigest === digest(action.proposal.edit.content)
      && receipt.bytes === Buffer.byteLength(action.proposal.edit.content) && timestamp(receipt.appliedAtMs)
      && action.dispatchedAtMs !== null && receipt.appliedAtMs >= action.dispatchedAtMs && receipt.appliedAtMs <= this.#now();
  }
  async dispatch(scopeInput: Scope, requestId: string, credential: unknown): Promise<ActionRecord> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    const action = await this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'owner');
      const record = this.#action(state, requestId);
      if (['COMPLETED', 'NOT_APPLIED', 'CANCELLED'].includes(record.status)) return structuredClone(record);
      if (record.status !== 'PREPARED') refuse('RECONCILIATION_REQUIRED', 'An in-flight or uncertain action cannot dispatch again.');
      this.#admit(state, record.proposal);
      this.#approval(state, record);
      record.status = 'IN_FLIGHT';
      record.dispatchedAtMs = this.#now();
      record.dispatchDeadlineMs = Math.min(state.leaseExpiresAtMs, state.readyAtMs + state.task.policy.deadlineSeconds * 1000,
        record.dispatchedAtMs + state.task.policy.timeoutSeconds * 1000);
      return structuredClone(record);
    });
    if (action.status !== 'IN_FLIGHT') return action;
    const controller = new AbortController();
    this.#active.set(action.operationKey, controller);
    let cancelAlarm = (): void => {};
    let removeListener = (): void => {};
    let result: EffectResult | null = null;
    try {
      // A post-commit stop can prevent a not-yet-started call. It does not undo dispatch.
      await this.#store.transaction(scope, state => {
        if (state.cancelRequested || this.#now() >= action.dispatchDeadlineMs!) controller.abort();
      });
      const stopped = new Promise<never>((_, reject) => {
        const stop = (): void => reject(new BrokerError('DISPATCH_STOPPED', 'The effect call stopped without an accepted receipt.'));
        controller.signal.addEventListener('abort', stop, { once: true });
        removeListener = () => controller.signal.removeEventListener('abort', stop);
        if (controller.signal.aborted) stop();
      });
      cancelAlarm = this.#clock.alarm(action.dispatchDeadlineMs!, () => controller.abort());
      if (!controller.signal.aborted) result = await Promise.race([this.#effects.apply(this.#effectRequest(action), controller.signal), stopped]);
      else await stopped;
    } catch { result = null; }
    finally { cancelAlarm(); removeListener(); this.#active.delete(action.operationKey); }
    return this.#store.transaction(scope, state => {
      const current = this.#action(state, requestId);
      if (current.operationKey !== action.operationKey) refuse('RECORD_CONFLICT', 'The stored action changed after dispatch.');
      if (current.status === 'COMPLETED') return structuredClone(current);
      if (result?.kind === 'applied' && this.#receipt(current, result.receipt)) {
        current.status = 'COMPLETED'; current.receipt = structuredClone(result.receipt); current.outcomeReason = null;
      } else if (result?.kind === 'not-applied' && result.operationKey === current.operationKey && result.actionDigest === current.actionDigest && result.reason === 'PRECONDITION_FAILED') {
        current.status = 'NOT_APPLIED'; current.outcomeReason = 'PRECONDITION_FAILED';
      } else { current.status = 'NEEDS_RECONCILIATION'; current.outcomeReason = 'NO_ACCEPTED_RECEIPT'; }
      return structuredClone(current);
    });
  }
  async cancel(scopeInput: Scope, credential: unknown): Promise<void> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    const operationKeys = await this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'either');
      state.cancelRequested = true;
      for (const action of Object.values(state.actions)) if (action.status === 'PREPARED') action.status = 'CANCELLED';
      return Object.values(state.actions).filter(action => action.status === 'IN_FLIGHT').map(action => action.operationKey);
    });
    for (const key of operationKeys) this.#active.get(key)?.abort();
  }
  async recover(scopeInput: Scope, credential: unknown): Promise<void> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    await this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'approver');
      for (const action of Object.values(state.actions)) if (action.status === 'IN_FLIGHT') { action.status = 'NEEDS_RECONCILIATION'; action.outcomeReason = 'INTERRUPTED_DISPATCH'; }
    });
  }
  async reconcile(scopeInput: Scope, requestId: string, credential: unknown): Promise<ActionRecord> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    const action = await this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'approver');
      const current = this.#action(state, requestId);
      if (current.status !== 'NEEDS_RECONCILIATION') refuse('ACTION_STATE', 'Only an uncertain action needs reconciliation.');
      return structuredClone(current);
    });
    let receipt: Receipt | null = null;
    try { receipt = await this.#effects.lookup(this.#effectRequest(action)); } catch { /* Retain the hold. */ }
    return this.#store.transaction(scope, state => {
      this.#actor(state, scope, principal, 'approver');
      const current = this.#action(state, requestId);
      if (current.operationKey !== action.operationKey) refuse('RECORD_CONFLICT', 'The stored action changed during reconciliation.');
      if (current.status === 'NEEDS_RECONCILIATION' && receipt && this.#receipt(current, receipt)) {
        current.status = 'COMPLETED'; current.receipt = structuredClone(receipt); current.outcomeReason = null;
      }
      return structuredClone(current);
    });
  }
  async inspect(scopeInput: Scope, requestId: string, credential: unknown): Promise<ActionRecord> {
    const scope = copyScope(scopeInput);
    const principal = await this.#principal(credential);
    return this.#store.transaction(scope, state => { this.#actor(state, scope, principal, 'either'); return structuredClone(this.#action(state, requestId)); });
  }
}
