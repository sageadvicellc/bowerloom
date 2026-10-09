import type { Scope } from '../../broker/src/types.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { validateDiscoveryAuthorityState } from './authority.js';
import type { DiscoveryAuthorityState, DiscoveryAuthorityStore } from './authority.js';
import type { McpContainerRecoveryCollection } from './container-recovery-collector.js';
import { data, fail, sha256 } from './model.js';

export interface McpContainerRecoveryReceipt {
  format: 'bowerloom/mcp-container-recovery-receipt/v1beta1';
  recordKind: 'historical-read-only-observation';
  scope: Scope; operationKey: string; authorityRevision: string;
  collection: McpContainerRecoveryCollection;
  journalOrigin: 'unverified-local-user-file'; hostSession: 'unknown';
  authorityDisposition: 'unchanged'; cleanupAuthorized: false; retryAuthorized: false; executionAuthorized: false;
  revision: string;
}
export interface RecoveryReceiptStore extends DiscoveryAuthorityStore {
  recordRecoveryReceipt(expected: DiscoveryAuthorityState, collection: McpContainerRecoveryCollection, checkActive: () => void): Promise<McpContainerRecoveryReceipt>;
}
const hash = (v: unknown) => 'sha256:' + sha256(canonicalJson(v));
function requireValue(v: unknown): asserts v { if (!v) fail('MCP_RECOVERY_RECEIPT_INVALID'); }
function exact(v: unknown, keys: string[]): Record<string, unknown> {
  requireValue(v && typeof v === 'object' && !Array.isArray(v));
  const r = v as Record<string, unknown>;
  requireValue(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r;
}
function integer(v: unknown, min = 0): void { requireValue(Number.isSafeInteger(v) && (v as number) >= min); }
function revision(v: unknown): void { requireValue(typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v)); }
function bound<T>(value: T): T { const cloned = data(value); requireValue(Buffer.byteLength(canonicalJson(cloned)) <= 16384); return cloned as T; }
function revised(v: Record<string, unknown>): void { const { revision: r, ...body } = v; revision(r); requireValue(hash(body) === r); }
function scopeValue(v: unknown): Scope {
  const s = exact(v, ['workspaceId', 'runId', 'taskId']);
  requireValue(Object.values(s).every(x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(x))); return s as unknown as Scope;
}
function collectionValue(value: unknown): McpContainerRecoveryCollection {
  const c = exact(value, ['format', 'evidenceScope', 'operationKey', 'authorityRevision', 'journalOrigin', 'journal', 'observations', 'planner', 'authorityUnchangedAtFinalCheck', 'journalUnchangedAtFinalCheck', 'localUserTrustRequired', 'cleanupAuthorized', 'retryAuthorized', 'executionAuthorized', 'hostRestartSafetyVerified', 'revision']);
  requireValue(c.format === 'bowerloom/mcp-container-recovery-collection/v1beta1' && c.evidenceScope === 'local-read-only-observations'
    && c.journalOrigin === 'unverified-local-user-file' && c.authorityUnchangedAtFinalCheck === true && c.journalUnchangedAtFinalCheck === true && c.localUserTrustRequired === true);
  for (const k of ['cleanupAuthorized', 'retryAuthorized', 'executionAuthorized', 'hostRestartSafetyVerified']) requireValue(c[k] === false);
  revision(c.operationKey); revision(c.authorityRevision); revised(c);
  const j = exact(c.journal, ['status', 'sha256', 'bytes']); integer(j.bytes);
  requireValue(j.status === 'missing' ? j.sha256 === null && j.bytes === 0 : j.status === 'stable-private-file' && (j.bytes as number) > 0 && (j.bytes as number) <= 12288);
  if (j.status === 'stable-private-file') revision(j.sha256);
  const o = exact(c.observations, ['guardian', 'attach', 'container']);
  for (const key of ['guardian', 'attach']) {
    const p = exact(o[key], ['pid', 'state', 'observedAtMs']); integer(p.observedAtMs, 1);
    requireValue(['present', 'absent', 'unknown', 'not-recorded'].includes(p.state as string));
    if (p.state === 'not-recorded') requireValue(p.pid === null); else { integer(p.pid, 1); requireValue((p.pid as number) <= 2147483647); }
  }
  const t = exact(o.container, ['requestedCid', 'returnedCid', 'state', 'observedAtMs', 'commandClosed']); integer(t.observedAtMs, 1);
  for (const key of ['requestedCid', 'returnedCid']) requireValue(t[key] === null || typeof t[key] === 'string' && /^[a-f0-9]{64}$/.test(t[key] as string));
  requireValue(['present', 'absent', 'unknown', 'not-queried'].includes(t.state as string));
  requireValue(t.state === 'not-queried' ? t.requestedCid === null && t.commandClosed === null : t.requestedCid !== null && typeof t.commandClosed === 'boolean');
  requireValue(t.state === 'present' ? t.returnedCid === t.requestedCid : t.returnedCid === null);
  if (t.state === 'present' || t.state === 'absent') requireValue(t.commandClosed === true);
  const p = exact(c.planner, ['format', 'contentScope', 'evidenceScope', 'operationKey', 'proposalRevision', 'launchRevision', 'journalSha256', 'finding', 'containerId', 'observedAtMs', 'evidenceRevision', 'authorityDisposition', 'requiresReconciliation', 'cleanupAuthorized', 'retryAuthorized', 'executionAuthorized', 'liveVerified', 'hostRestartSafetyVerified', 'grants', 'revision']);
  requireValue(p.format === 'bowerloom/mcp-container-recovery-report/v1beta1' && p.contentScope === 'private-synthetic-plan' && p.evidenceScope === 'supplied-observations-only'
    && p.operationKey === c.operationKey && p.finding === 'HOLD_HOST_SESSION' && p.authorityDisposition === 'unchanged' && p.requiresReconciliation === true
    && p.journalSha256 === null && p.containerId === null && Array.isArray(p.grants) && p.grants.length === 0);
  for (const key of ['proposalRevision', 'launchRevision', 'evidenceRevision']) revision(p[key]);
  for (const key of ['cleanupAuthorized', 'retryAuthorized', 'executionAuthorized', 'liveVerified', 'hostRestartSafetyVerified']) requireValue(p[key] === false);
  requireValue(p.observedAtMs === Math.min(...Object.values(o).map(v => (v as { observedAtMs: number }).observedAtMs))); revised(p);
  if (j.status === 'missing') requireValue((o.guardian as { state: string }).state === 'not-recorded' && (o.attach as { state: string }).state === 'not-recorded' && t.state === 'not-queried');
  return c as unknown as McpContainerRecoveryCollection;
}
/** Structural integrity only. Hashes never establish trusted journal or host provenance. */
export function validateMcpContainerRecoveryReceipt(value: unknown, selected: Scope): McpContainerRecoveryReceipt {
  const v = exact(bound(value), ['format', 'recordKind', 'scope', 'operationKey', 'authorityRevision', 'collection', 'journalOrigin', 'hostSession', 'authorityDisposition', 'cleanupAuthorized', 'retryAuthorized', 'executionAuthorized', 'revision']);
  requireValue(v.format === 'bowerloom/mcp-container-recovery-receipt/v1beta1' && v.recordKind === 'historical-read-only-observation' && canonicalJson(scopeValue(v.scope)) === canonicalJson(scopeValue(data(selected)))
    && v.journalOrigin === 'unverified-local-user-file' && v.hostSession === 'unknown' && v.authorityDisposition === 'unchanged');
  for (const k of ['cleanupAuthorized', 'retryAuthorized', 'executionAuthorized']) requireValue(v[k] === false);
  const c = collectionValue(v.collection); requireValue(v.operationKey === c.operationKey && v.authorityRevision === c.authorityRevision); revised(v);
  return v as unknown as McpContainerRecoveryReceipt;
}
/** Internal trusted store boundary; callers cannot gain authority by supplying valid bytes. */
export function createMcpContainerRecoveryReceipt(expected: DiscoveryAuthorityState, collection: McpContainerRecoveryCollection): McpContainerRecoveryReceipt {
  const state = validateDiscoveryAuthorityState(expected), c = collectionValue(bound(collection));
  requireValue(state.status === 'NEEDS_RECONCILIATION' && state.intent && state.proposal.effect.kind === 'container-stdio'
    && c.operationKey === state.operationKey && c.authorityRevision === hash(state) && c.planner.proposalRevision === state.proposal.revision
    && c.planner.launchRevision === state.proposal.effect.launchRevision);
  const body = { format: 'bowerloom/mcp-container-recovery-receipt/v1beta1' as const, recordKind: 'historical-read-only-observation' as const, scope: state.scope, operationKey: state.operationKey, authorityRevision: hash(state), collection: c,
    journalOrigin: 'unverified-local-user-file' as const, hostSession: 'unknown' as const, authorityDisposition: 'unchanged' as const,
    cleanupAuthorized: false as const, retryAuthorized: false as const, executionAuthorized: false as const };
  return validateMcpContainerRecoveryReceipt({ ...body, revision: hash(body) }, state.scope);
}
