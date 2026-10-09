// Private, inert accounting projection. No bootstrap caller or public export.
// Trusted registry/reader provenance is a host obligation, not established by these hashes.
import { isProxy } from 'node:util/types';
import { canonicalJson } from '../../contracts/src/index.js';
import { observationCopy } from '../../admission/src/validation.js';
import type { AccountObservation } from '../../admission/src/types.js';
import { MODEL_ROUTE, POLICY_VERSION } from './policy.js';
import { AdapterError, sha } from './safe.js';

interface HostBinding {
  installationId: string; databaseName: string; admissionSchema: string;
  accountId: string; accountAlias: string; launcherId: string;
}
interface HistoricalEvidence {
  ledgerObservationSha256: string; ledgerChecksum: string; reservationsDigest: string;
  reservationCount: 4; retainedPrimaryPercent: 8;
}
interface HistoricalAccountingBody {
  format: 'bowerloom/codex-historical-accounting/v1'; status: 'active'; reviewRevision: string;
  issuedAtMs: number; expiresAtMs: number; hostBinding: HostBinding; accountBindingDigest: string;
  currentPolicyVersion: string; currentModelRoute: string; historicalModelRoute: 'codex:gpt-5.5:low';
  requiredWindows: ['primary']; optionalWindows: ['secondary']; historicalEvidence: HistoricalEvidence;
  oldLaunchAuthorized: false; coverageReleaseAttested: false;
}
export interface HistoricalAccountingBinding extends HistoricalAccountingBody { revision: string }
export interface HistoricalAccountingExpected {
  hostBinding: HostBinding; accountBindingDigest: string; reviewRevision: string; historicalAccountingRevision: string;
}
const OLD_ROUTE = 'codex:gpt-5.5:low';
const BODY_KEYS = ['format','status','reviewRevision','issuedAtMs','expiresAtMs','hostBinding','accountBindingDigest',
  'currentPolicyVersion','currentModelRoute','historicalModelRoute','requiredWindows','optionalWindows','historicalEvidence',
  'oldLaunchAuthorized','coverageReleaseAttested'];
const refuse = (): never => { throw new AdapterError('HISTORICAL_ACCOUNTING_REFUSED'); };
function requireValue(value: unknown): asserts value { if (!value) refuse(); }
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
function exact(v: any, keys: string[]): void {
  requireValue(v && typeof v === 'object' && !Array.isArray(v) && same(Object.keys(v).sort(), [...keys].sort()));
}
/** Descriptor capture never calls getters or proxy traps. Limits apply to the whole input tree. */
function inert(v: unknown, depth = 0, budget = {nodes: 0, bytes: 0}): any {
  requireValue(depth <= 8 && ++budget.nodes <= 2048);
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { requireValue(Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))); return v; }
  if (typeof v === 'string') {
    const bytes = Buffer.byteLength(v); budget.bytes += bytes;
    requireValue(bytes <= 512 && budget.bytes <= 65536 && !v.includes('\0') && Buffer.from(v).toString('utf8') === v); return v;
  }
  requireValue(v && typeof v === 'object' && !isProxy(v));
  const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
  requireValue(array ? proto === Array.prototype : proto === Object.prototype || proto === null);
  const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
  requireValue(keys.length <= 33 && keys.every(k => typeof k === 'string' && !['__proto__','prototype','constructor'].includes(k)));
  if (array) {
    const length = descriptors.length?.value;
    requireValue(Number.isSafeInteger(length) && length >= 0 && length <= 32 && keys.length === length + 1);
    return Object.freeze(Array.from({length}, (_, i) => {
      const d = descriptors[String(i)]; requireValue(d && Object.hasOwn(d, 'value') && d.enumerable);
      return inert(d.value, depth + 1, budget);
    }));
  }
  const out: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const d = descriptors[key]!; requireValue(Object.hasOwn(d, 'value') && d.enumerable);
    out[key] = inert(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}
function host(v: any): void {
  exact(v, ['installationId','databaseName','admissionSchema','accountId','accountAlias','launcherId']);
  requireValue(Object.values(v).every(x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(x)
    && !['__proto__','prototype','constructor'].includes(x)));
  requireValue(/^trellis_[a-z][a-z0-9_]{0,46}$/.test(v.admissionSchema));
}
function body(v: any): asserts v is HistoricalAccountingBody {
  exact(v, BODY_KEYS); host(v.hostBinding);
  requireValue(v.format === 'bowerloom/codex-historical-accounting/v1' && v.status === 'active'
    && hex(v.reviewRevision) && hex(v.accountBindingDigest));
  requireValue(time(v.issuedAtMs) && time(v.expiresAtMs) && v.expiresAtMs > v.issuedAtMs && v.expiresAtMs - v.issuedAtMs <= 300000);
  requireValue(v.currentPolicyVersion === POLICY_VERSION && v.currentModelRoute === MODEL_ROUTE && v.historicalModelRoute === OLD_ROUTE
    && same(v.requiredWindows, ['primary']) && same(v.optionalWindows, ['secondary'])
    && v.oldLaunchAuthorized === false && v.coverageReleaseAttested === false);
  const e = v.historicalEvidence;
  exact(e, ['ledgerObservationSha256','ledgerChecksum','reservationsDigest','reservationCount','retainedPrimaryPercent']);
  requireValue(hex(e.ledgerObservationSha256) && typeof e.ledgerChecksum === 'string' && /^sha256:[a-f0-9]{64}$/.test(e.ledgerChecksum)
    && hex(e.reservationsDigest) && e.reservationCount === 4 && e.retainedPrimaryPercent === 8);
}
function capture(value: unknown, expected: unknown, nowMs: number): Readonly<HistoricalAccountingBinding> {
  const v = inert(value), e = inert(expected); exact(v, [...BODY_KEYS, 'revision']);
  exact(e, ['hostBinding','accountBindingDigest','reviewRevision','historicalAccountingRevision']); host(e.hostBinding);
  requireValue(hex(e.accountBindingDigest) && hex(e.reviewRevision) && hex(e.historicalAccountingRevision));
  const {revision, ...rest} = v; body(rest);
  requireValue(hex(revision) && sha(canonicalJson(rest)) === revision && revision === e.historicalAccountingRevision);
  requireValue(same(v.hostBinding, e.hostBinding) && v.accountBindingDigest === e.accountBindingDigest && v.reviewRevision === e.reviewRevision);
  requireValue(time(nowMs) && v.issuedAtMs <= nowMs && nowMs < v.expiresAtMs);
  return v as Readonly<HistoricalAccountingBinding>;
}
/** Digest construction is not registry authority, grant issuance or evidence of current ledger equality. */
export function historicalAccountingRevision(value: unknown): string {
  try { const v = inert(value); body(v); return sha(canonicalJson(v)); } catch { return refuse(); }
}
export function captureHistoricalAccounting(value: unknown, expected: HistoricalAccountingExpected, nowMs: number): Readonly<HistoricalAccountingBinding> {
  try { return capture(value, expected, nowMs); } catch { return refuse(); }
}
/** Input provenance/freshness comes from the trusted reader and admission; this helper adds neither. */
export function projectHistoricalAccounting(value: unknown, binding: unknown, expected: HistoricalAccountingExpected, nowMs: number): AccountObservation {
  try {
    const b = capture(binding, expected, nowMs), observation = observationCopy(inert(value));
    requireValue(observation.accountId === b.hostBinding.accountId && observation.authentication === 'subscription'
      && observation.ordinaryUsageAllowed === true && observation.observedAtMs <= nowMs);
    requireValue(same(Object.keys(observation.windows).sort(), ['primary','secondary'])
      && observation.windows.primary !== null && observation.windows.secondary === null);
    // Nulls here are validated-observation values, not proof of raw provider field presence.
    for (const window of Object.values(observation.windows)) if (window !== null) requireValue(window.accountedThroughMs === null);
    const routes = Object.keys(observation.routes).sort();
    requireValue(same(routes, [MODEL_ROUTE]) || same(routes, [MODEL_ROUTE, OLD_ROUTE].sort()));
    const applicability = {requiredWindows: [...b.requiredWindows], optionalWindows: [...b.optionalWindows]};
    requireValue(same(observation.routes[MODEL_ROUTE], applicability));
    if (Object.hasOwn(observation.routes, OLD_ROUTE)) requireValue(same(observation.routes[OLD_ROUTE], applicability));
    observation.routes[OLD_ROUTE] = applicability;
    // Normal Object.prototype, detached and deeply frozen; admission's existing copier accepts it.
    return inert(observation) as AccountObservation;
  } catch { return refuse(); }
}
