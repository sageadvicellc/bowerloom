import { canonicalJson, digest, assertPortablePath } from '../../contracts/src/index.js';
import { BROKER_LIMITS, parseProposal } from '../../broker/src/index.js';
import type { EffectRequest, EffectResult, Receipt } from '../../broker/src/index.js';

export class WorkspaceEffectError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'WorkspaceEffectError'; }
}
export const identifier = (value: unknown): value is string => typeof value === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
export const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function registeredPath(path: string): void {
  assertPortablePath(path);
  if (path !== path.toLowerCase()) throw new WorkspaceEffectError('UNREGISTERED_PATH', 'This adapter permits registered lowercase paths only.');
}
function plain(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('depth');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && timestamp(value)) return;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > BROKER_LIMITS.proposalBytes || value.includes('\0')) throw new Error('text');
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('json');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 16) throw new Error('keys');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new Error('property');
    plain(descriptor.value, depth + 1);
  }
}
export function requestCopy(input: EffectRequest): EffectRequest {
  try {
    plain(input);
    if (!exact(input, ['proposal', 'actionDigest', 'operationKey', 'deadlineMs']) || !timestamp(input.deadlineMs)) throw new Error('envelope');
    const proposal = parseProposal(JSON.stringify(input.proposal));
    const actionDigest = digest(canonicalJson(proposal));
    if (input.actionDigest !== actionDigest || input.operationKey !== digest(canonicalJson({ scope: proposal.scope, requestId: proposal.requestId, actionDigest }))) throw new Error('binding');
    registeredPath(proposal.edit.path);
    return structuredClone({ proposal, actionDigest, operationKey: input.operationKey as string, deadlineMs: input.deadlineMs });
  } catch { throw new WorkspaceEffectError('INVALID_REQUEST', 'The bounded workspace effect request or its identity is invalid.'); }
}
export function negative(request: EffectRequest): EffectResult {
  return { kind: 'not-applied', operationKey: request.operationKey, actionDigest: request.actionDigest, reason: 'PRECONDITION_FAILED' };
}
export function appliedReceipt(request: EffectRequest, appliedAtMs: number): Receipt {
  return { format: 'trellis/effect-receipt/v0.7-alpha', operationKey: request.operationKey, actionDigest: request.actionDigest,
    workspaceId: request.proposal.scope.workspaceId, path: request.proposal.edit.path,
    beforeDigest: request.proposal.edit.expectedDigest, afterDigest: digest(request.proposal.edit.content),
    bytes: Buffer.byteLength(request.proposal.edit.content), appliedAtMs };
}
export function outcomeCopy(value: unknown, request: EffectRequest): EffectResult {
  if (exact(value, ['kind', 'operationKey', 'actionDigest', 'reason']) && canonicalJson(value) === canonicalJson(negative(request))) return negative(request);
  if (exact(value, ['kind', 'receipt']) && value.kind === 'applied' && exact(value.receipt,
    ['format', 'operationKey', 'actionDigest', 'workspaceId', 'path', 'beforeDigest', 'afterDigest', 'bytes', 'appliedAtMs'])
    && timestamp(value.receipt.appliedAtMs)) {
    const expected = appliedReceipt(request, value.receipt.appliedAtMs);
    if (canonicalJson(value.receipt) === canonicalJson(expected)) return { kind: 'applied', receipt: expected };
  }
  throw new WorkspaceEffectError('CORRUPT_OPERATION', 'The stored operation outcome is not bound to the request.');
}
