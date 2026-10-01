import { Ajv } from 'ajv';
import { assertPortablePath, canonicalJson, crewSchema, CREW_FORMAT, digest } from '../../contracts/src/index.js';
import { BROKER_LIMITS, parseProposal } from '../../broker/src/index.js';
import type { Scope, TaskState } from '../../broker/src/index.js';

export class BrokerStoreError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'BrokerStoreError'; }
}
export const STATE_VERSION = 1;
export const STATE_BYTES_LIMIT = 40 * 1024 * 1024;
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$', not: { enum: ['__proto__', 'prototype', 'constructor'] } };
const sha = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const time = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const epoch = { ...time, minimum: 1 };
const nullable = (value: object): object => ({ anyOf: [value, { type: 'null' }] });
const object = (properties: Record<string, object>): object => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ids = { type: 'array', items: id, maxItems: 256, uniqueItems: true };
const scopeSchema = object({ workspaceId: id, runId: id, taskId: id });
const approval = object({ candidateRevision: sha, actionDigest: sha, ownerEpoch: epoch, expiresAtMs: time,
  subject: id, proofRef: { type: 'string', minLength: 1, maxLength: 256 }, scope: scopeSchema, requestId: id });
const receipt = object({ format: { const: 'trellis/effect-receipt/v0.7-alpha' }, operationKey: sha, actionDigest: sha,
  workspaceId: id, path: { type: 'string' }, beforeDigest: nullable(sha), afterDigest: sha,
  bytes: { ...time, maximum: BROKER_LIMITS.contentBytes }, appliedAtMs: time });
const action = object({ proposal: { type: 'object' }, actionDigest: sha, operationKey: sha,
  status: { enum: ['PREPARED', 'IN_FLIGHT', 'COMPLETED', 'NOT_APPLIED', 'NEEDS_RECONCILIATION', 'CANCELLED'] },
  approval: nullable(approval), preparedAtMs: time, dispatchedAtMs: nullable(time), dispatchDeadlineMs: nullable(time),
  receipt: nullable(receipt), outcomeReason: nullable({ enum: ['PRECONDITION_FAILED', 'NO_ACCEPTED_RECEIPT', 'INTERRUPTED_DISPATCH'] }) });
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true }).addSchema(crewSchema);
const scopeValidator = ajv.compile<Scope>(scopeSchema);
const stateValidator = ajv.compile<TaskState>(object({ scope: scopeSchema, candidateRevision: sha,
  task: { $ref: `${CREW_FORMAT}#/properties/tasks/items` }, ownerSubject: id, ownerEpoch: epoch,
  approverSubjects: { ...ids, minItems: 1 }, readyAtMs: time, leaseExpiresAtMs: time,
  completedDependencies: ids, cancelRequested: { type: 'boolean' },
  actions: { type: 'object', propertyNames: id, maxProperties: BROKER_LIMITS.actionsPerTask, additionalProperties: action } }));

// Reject values JSON.stringify silently drops or coerces, and do not invoke getters/toJSON.
function plainJson(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 48) throw new Error('depth');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.includes('\0') || Buffer.from(value).toString('utf8') !== value) throw new Error('text');
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('json');
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('prototype');
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1025) throw new Error('width');
  if (array && (value.length > 1024 || keys.length !== value.length + 1)) throw new Error('array');
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('descriptor');
    plainJson(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

export function copyScope(scope: Scope): Scope {
  try {
    plainJson(scope);
    if (!scopeValidator(scope)) throw new Error('scope');
    return structuredClone(scope);
  } catch { throw new BrokerStoreError('INVALID_SCOPE', 'A complete workspace/run/task scope is required.'); }
}

export function detachResult<T>(value: T): T {
  if (value === undefined) return value;
  try {
    plainJson(value);
    const json = canonicalJson(value);
    if (Buffer.byteLength(json) > STATE_BYTES_LIMIT) throw new Error('size');
    return JSON.parse(json) as T;
  } catch { throw new BrokerStoreError('RESULT_NOT_CLONEABLE', 'The callback result must be bounded plain JSON or undefined.'); }
}

export function encodeState(value: unknown, expected?: Scope): { state: TaskState; json: string; checksum: string } {
  try {
    plainJson(value);
    if (!stateValidator(value)) throw new Error('schema');
    const state = value;
    if (expected && canonicalJson(state.scope) !== canonicalJson(expected)) throw new Error('scope');
    if (state.task.id !== state.scope.taskId || state.leaseExpiresAtMs <= state.readyAtMs
      || !Number.isSafeInteger(state.readyAtMs + state.task.policy.deadlineSeconds * 1000)) throw new Error('grant');
    const policy = state.task.policy;
    if (policy.maxAttempts * policy.timeoutSeconds + (policy.maxAttempts - 1) * policy.backoffSeconds > policy.deadlineSeconds) throw new Error('deadline');
    for (const effect of state.task.effects) {
      if ('path' in effect) assertPortablePath(effect.path);
      if (!state.task.requires.includes(effect.operation)) throw new Error('capability');
    }
    if (state.task.approval === 'required' && !state.task.requires.includes('approval.exact-revision')) throw new Error('approval');
    for (const [requestId, record] of Object.entries(state.actions)) {
      const proposal = parseProposal(JSON.stringify(record.proposal));
      if (proposal.requestId !== requestId || canonicalJson(proposal.scope) !== canonicalJson(state.scope)
        || record.actionDigest !== digest(canonicalJson(proposal))
        || record.operationKey !== digest(canonicalJson({ scope: proposal.scope, requestId, actionDigest: record.actionDigest }))) throw new Error('action');
      const approved = record.approval;
      if (approved && (canonicalJson(approved.scope) !== canonicalJson(state.scope) || approved.requestId !== requestId
        || approved.candidateRevision !== proposal.candidateRevision || approved.actionDigest !== record.actionDigest
        || approved.ownerEpoch !== proposal.ownerEpoch)) throw new Error('approval');
      const pending = record.status === 'PREPARED' || record.status === 'CANCELLED';
      if (pending ? record.dispatchedAtMs !== null || record.dispatchDeadlineMs !== null
        : record.dispatchedAtMs === null || record.dispatchDeadlineMs === null
          || record.dispatchedAtMs < record.preparedAtMs || record.dispatchDeadlineMs <= record.dispatchedAtMs) throw new Error('dispatch');
      if (record.status === 'COMPLETED') {
        const r = record.receipt;
        if (!r || r.operationKey !== record.operationKey || r.actionDigest !== record.actionDigest
          || r.workspaceId !== state.scope.workspaceId || r.path !== proposal.edit.path
          || r.beforeDigest !== proposal.edit.expectedDigest || r.afterDigest !== digest(proposal.edit.content)
          || r.bytes !== Buffer.byteLength(proposal.edit.content) || r.appliedAtMs < record.dispatchedAtMs!) throw new Error('receipt');
      } else if (record.receipt !== null) throw new Error('receipt');
      if (record.status === 'NOT_APPLIED' ? record.outcomeReason !== 'PRECONDITION_FAILED'
        : record.status === 'NEEDS_RECONCILIATION' ? !['NO_ACCEPTED_RECEIPT', 'INTERRUPTED_DISPATCH'].includes(record.outcomeReason ?? '')
          : record.outcomeReason !== null) throw new Error('reason');
    }
    const json = canonicalJson(state);
    if (Buffer.byteLength(json) > STATE_BYTES_LIMIT) throw new Error('size');
    return { state: JSON.parse(json) as TaskState, json, checksum: digest(json) };
  } catch { throw new BrokerStoreError('INVALID_STATE', 'The broker state is invalid or cannot be serialized without loss.'); }
}

export function decodeState(row: { state_version: unknown; state: unknown; checksum: unknown }, scope: Scope): TaskState {
  if (row.state_version !== STATE_VERSION) throw new BrokerStoreError('UNSUPPORTED_STATE_VERSION', 'The stored state version is unsupported.');
  try {
    const encoded = encodeState(row.state, scope);
    if (encoded.checksum !== row.checksum) throw new Error('checksum');
    return encoded.state;
  } catch { throw new BrokerStoreError('CORRUPT_STATE', 'The stored broker state failed validation.'); }
}
