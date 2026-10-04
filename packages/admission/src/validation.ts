import { Ajv } from 'ajv';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { AccountState, AccountObservation, AdmissionPolicy, ReservationRequest, ReconciliationProof } from './types.js';

export class AdmissionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AdmissionError'; }
}
export const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$', not: { enum: ['__proto__', 'prototype', 'constructor'] } };
export const timeSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positive = { ...timeSchema, minimum: 1 };
const percent = { type: 'number', minimum: 0, maximum: 100 };
const sha = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const object = (properties: Record<string, object>): object => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (schema: object): object => ({ anyOf: [schema, { type: 'null' }] });
const ids = (minimum = 0): object => ({ type: 'array', items: idSchema, minItems: minimum, maxItems: 32, uniqueItems: true });
const record = (schema: object, limit = 32): object => ({ type: 'object', propertyNames: idSchema, additionalProperties: schema, maxProperties: limit });
const policySchema = object({ thresholdPercent: { type: 'number', minimum: 0.01, maximum: 95 }, maxWorkers: { type: 'integer', minimum: 1, maximum: 2 },
  maxObservationAgeMs: positive, headroomPercent: percent, admittedRoutes: ids(1), completedResetPolicy: { enum: ['hold', 'release-covered'] } });
const windowSchema = object({ usedPercent: percent, durationMs: positive, resetAtMs: positive, accountedThroughMs: nullable(timeSchema) });
const observationSchema = object({ observationId: idSchema, accountId: idSchema, observedAtMs: timeSchema,
  authentication: { enum: ['subscription', 'none', 'other'] }, ordinaryUsageAllowed: { type: 'boolean' },
  windows: record(nullable(windowSchema)), routes: record(nullable(object({ requiredWindows: ids(1), optionalWindows: ids() }))) });
const requestSchema = object({ accountAlias: idSchema, jobId: idSchema, candidateRevision: sha, modelRoute: idSchema,
  role: { enum: ['lead', 'reviewer', 'worker', 'support'] }, attempt: { enum: ['initial', 'retry'] },
  allowancePercent: { ...record({ type: 'number', exclusiveMinimum: 0, maximum: 100 }), minProperties: 1 }, paidFallback: { const: false } });
const proofSchema = object({ kind: { enum: ['not-started', 'completed'] }, proofRef: idSchema, observedAtMs: timeSchema, processRef: nullable(idSchema), fencedLauncherId: nullable(idSchema) });
const reservationSchema = object({ request: requestSchema, requestDigest: sha, reservationId: sha,
  status: { enum: ['RESERVED', 'LAUNCHING', 'RUNNING', 'UNKNOWN', 'COMPLETED', 'CANCELLED'] },
  createdAtMs: timeSchema, claimedAtMs: nullable(timeSchema), launcherId: nullable(idSchema), completedAtMs: nullable(timeSchema), processRef: nullable(idSchema), permitHash: nullable(sha),
  retained: record(object({ percent: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, resetAtMs: positive, durationMs: positive })),
  proofs: { type: 'array', items: proofSchema, maxItems: 16 } });
const stateSchema = object({ version: { const: 1 }, accountId: idSchema, aliases: ids(1), policy: policySchema,
  observation: nullable(observationSchema), highWater: record(object({ usedPercent: percent, resetAtMs: positive, durationMs: positive })),
  reservations: record(reservationSchema, 1024) });
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true });
const policyCheck = ajv.compile<AdmissionPolicy>(policySchema);
const observationCheck = ajv.compile<AccountObservation>(observationSchema);
const requestCheck = ajv.compile<ReservationRequest>(requestSchema);
const proofCheck = ajv.compile<ReconciliationProof>(proofSchema);
const stateCheck = ajv.compile<AccountState>(stateSchema);
const idCheck = ajv.compile<string>(idSchema);
export const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function plain(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('depth');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.includes('\0') || Buffer.byteLength(value) > 512) throw new Error('string'); return; }
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) throw new Error('json');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1025) throw new Error('width');
  if (Array.isArray(value) && keys.length !== value.length + 1) throw new Error('array');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !descriptor.enumerable || !('value' in descriptor)) throw new Error('property');
    plain(descriptor.value, depth + 1);
  }
}
function copy<T>(value: unknown, check: (value: unknown) => value is T, code: string): T {
  try { plain(value); if (!check(value)) throw new Error('schema'); return structuredClone(value); }
  catch { throw new AdmissionError(code, 'The admission input is invalid.'); }
}
export const policyCopy = (value: unknown): AdmissionPolicy => copy(value, policyCheck, 'INVALID_POLICY');
export const observationCopy = (value: unknown): AccountObservation => copy(value, observationCheck, 'INVALID_OBSERVATION');
export const requestCopy = (value: unknown): ReservationRequest => copy(value, requestCheck, 'INVALID_REQUEST');
export const proofCopy = (value: unknown): ReconciliationProof => copy(value, proofCheck, 'INVALID_PROOF');
export function identifier(value: unknown): string {
  if (!idCheck(value)) throw new AdmissionError('INVALID_ID', 'A bounded identifier is required.');
  return value;
}
export function stateCopy(value: unknown): AccountState {
  const state = copy(value, stateCheck, 'CORRUPT_ACCOUNT');
  const corrupt = (): never => { throw new AdmissionError('CORRUPT_ACCOUNT', 'The persisted admission state is inconsistent.'); };
  if (state.observation && state.observation.accountId !== state.accountId) corrupt();
  for (const [jobId, reservation] of Object.entries(state.reservations)) {
    if (reservation.request.jobId !== jobId || !state.aliases.includes(reservation.request.accountAlias)
      || reservation.requestDigest !== digest(canonicalJson(reservation.request))
      || reservation.reservationId !== digest(canonicalJson({ accountId: state.accountId, jobId, requestDigest: reservation.requestDigest }))) corrupt();
    const active = ['RESERVED', 'LAUNCHING', 'RUNNING', 'UNKNOWN'].includes(reservation.status);
    if (active && canonicalJson(Object.keys(reservation.retained).sort()) !== canonicalJson(Object.keys(reservation.request.allowancePercent).sort())) corrupt();
    for (const [window, held] of Object.entries(reservation.retained)) {
      if (held.percent !== reservation.request.allowancePercent[window] || held.durationMs > held.resetAtMs) corrupt();
    }
    if (reservation.status === 'RESERVED') {
      if (!reservation.permitHash || reservation.claimedAtMs !== null || reservation.launcherId !== null || reservation.processRef !== null || reservation.completedAtMs !== null) corrupt();
    } else if (reservation.permitHash !== null) corrupt();
    if (['LAUNCHING', 'RUNNING', 'UNKNOWN'].includes(reservation.status)) {
      if (reservation.claimedAtMs === null || reservation.completedAtMs !== null) corrupt();
    }
    if (['LAUNCHING', 'UNKNOWN'].includes(reservation.status) && reservation.processRef !== null) corrupt();
    if (active && reservation.proofs.length) corrupt();
    if (reservation.status === 'RUNNING' && reservation.processRef === null) corrupt();
    if ((reservation.claimedAtMs === null) !== (reservation.launcherId === null)) corrupt();
    if (reservation.claimedAtMs !== null && reservation.claimedAtMs < reservation.createdAtMs) corrupt();
    if (reservation.status === 'COMPLETED' && (reservation.completedAtMs === null || reservation.claimedAtMs === null || reservation.processRef === null || reservation.proofs.length !== 1)) corrupt();
    if (reservation.status === 'CANCELLED' && (reservation.completedAtMs === null || Object.keys(reservation.retained).length || reservation.processRef !== null || reservation.proofs.length !== 1)) corrupt();
    if (reservation.completedAtMs !== null) {
      if (reservation.completedAtMs < (reservation.claimedAtMs ?? reservation.createdAtMs)) corrupt();
      const proof = reservation.proofs[0];
      if (!proof || proof.observedAtMs !== reservation.completedAtMs || proof.processRef !== reservation.processRef
        || proof.kind !== (reservation.status === 'CANCELLED' ? 'not-started' : 'completed')) corrupt();
      if (reservation.status === 'CANCELLED' && reservation.claimedAtMs !== null && proof!.fencedLauncherId !== reservation.launcherId) corrupt();
    }
  }
  return state;
}
