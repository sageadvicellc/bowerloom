import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { validateDiscoveryAuthorityState } from './authority.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import { data, fail, sha256 } from './model.js';

export type McpContainerRecoveryFinding = 'EXACT_ID_ABSENCE_OBSERVED' | 'KNOWN_ID_PRESENT'
  | 'HOLD_AUTHORITY' | 'HOLD_HOST_SESSION' | 'HOLD_STALE_OBSERVATION' | 'HOLD_TEMPORAL_INCONSISTENCY' | 'HOLD_JOURNAL_MISSING'
  | 'HOLD_JOURNAL_UNTRUSTED' | 'HOLD_JOURNAL_INVALID' | 'HOLD_UNKNOWN_IDENTITY'
  | 'HOLD_PROCESS_ACTIVE' | 'HOLD_PROCESS_UNKNOWN' | 'HOLD_PROCESS_MISMATCH'
  | 'HOLD_CONTAINER_UNKNOWN' | 'HOLD_CONTAINER_MISMATCH';
export interface McpContainerRecoveryReport {
  format: 'bowerloom/mcp-container-recovery-report/v1beta1';
  contentScope: 'private-synthetic-plan'; evidenceScope: 'supplied-observations-only';
  operationKey: string; proposalRevision: string; launchRevision: string; journalSha256: string | null;
  finding: McpContainerRecoveryFinding; containerId: string | null; observedAtMs: number; evidenceRevision: string;
  authorityDisposition: 'unchanged'; requiresReconciliation: true;
  cleanupAuthorized: false; retryAuthorized: false; executionAuthorized: false;
  liveVerified: false; hostRestartSafetyVerified: false; grants: []; revision: string;
}
function refuse(): never { return fail('MCP_CONTAINER_RECOVERY_INPUT'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key))) refuse(); return v;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) refuse(); return value as number;
}
function nullablePid(value: unknown): number | null {
  if (value === null) return null;
  const pid = integer(value, 1); if (pid > 2147483647) refuse(); return pid;
}
function cid(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) refuse(); return value as string;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) refuse(); return value as string;
}
function processObservation(value: unknown): { pid: number | null; state: string } {
  const v = record(value, ['pid', 'state']), pid = nullablePid(v.pid);
  if (!['absent', 'present', 'unknown', 'not-recorded'].includes(v.state as string)
    || (v.state === 'not-recorded' ? pid !== null : pid === null)) refuse();
  return { pid, state: v.state as string };
}
/** Pure internal planning. Every observation is caller-supplied synthetic data, never execution authority. */
export function planMcpContainerRecovery(input: unknown): McpContainerRecoveryReport {
  try { return plan(input); } catch { return refuse(); }
}
function plan(input: unknown): McpContainerRecoveryReport {
  const v = record(data(input), ['format', 'synthetic', 'authority', 'expectedJob', 'journal', 'observations', 'nowMs']);
  if (v.format !== 'bowerloom/mcp-container-recovery-input/v1beta1' || v.synthetic !== true) refuse();
  const authority = validateDiscoveryAuthorityState(v.authority), effect = authority.proposal.effect;
  if (effect.kind !== 'container-stdio') refuse();
  const launch = planMcpContainerDiscoveryLaunch(effect.launch);
  const expected = record(v.expectedJob, ['operationKey', 'launchRevision', 'deadlineMs']);
  if (digest(expected.operationKey) !== authority.operationKey || digest(expected.launchRevision) !== launch.revision
    || launch.revision !== effect.launchRevision) refuse();
  const deadline = integer(expected.deadlineMs, 1), now = integer(v.nowMs, 1);
  const source = record(v.journal, ['status', 'text', 'expectedSha256']);
  if (!['trusted-snapshot', 'untrusted', 'missing'].includes(source.status as string)) refuse();
  if (source.status === 'missing' ? source.text !== null || source.expectedSha256 !== null
    : typeof source.text !== 'string' || Buffer.byteLength(source.text) > 8192) refuse();
  if (source.expectedSha256 !== null) digest(source.expectedSha256);
  const observed = record(v.observations, ['observedAtMs', 'hostSession', 'guardian', 'attach', 'container']);
  const at = integer(observed.observedAtMs, 1);
  if (!['same-host-session', 'unknown-or-restarted'].includes(observed.hostSession as string)) refuse();
  const guardian = processObservation(observed.guardian), attach = processObservation(observed.attach);
  const container = record(observed.container, ['requestedCid', 'state', 'returnedCid']);
  const requestedCid = cid(container.requestedCid), returnedCid = cid(container.returnedCid);
  if (!['absent', 'present', 'unknown', 'not-queried'].includes(container.state as string)
    || (container.state === 'present' ? !returnedCid : returnedCid !== null)
    || (container.state === 'not-queried' ? requestedCid !== null : requestedCid === null)) refuse();
  let journalHash: string | null = null, knownId: string | null = null;
  function report(finding: McpContainerRecoveryFinding): McpContainerRecoveryReport {
    const body = { format: 'bowerloom/mcp-container-recovery-report/v1beta1' as const,
      contentScope: 'private-synthetic-plan' as const, evidenceScope: 'supplied-observations-only' as const,
      operationKey: authority.operationKey, proposalRevision: authority.proposal.revision, launchRevision: launch.revision,
      journalSha256: journalHash, finding, containerId: knownId, observedAtMs: at, evidenceRevision: 'sha256:' + sha256(canonicalJson(v)), authorityDisposition: 'unchanged' as const,
      requiresReconciliation: true as const, cleanupAuthorized: false as const, retryAuthorized: false as const,
      executionAuthorized: false as const, liveVerified: false as const, hostRestartSafetyVerified: false as const, grants: [] as [] };
    return { ...body, revision: 'sha256:' + sha256(canonicalJson(body)) };
  }
  if (authority.status !== 'NEEDS_RECONCILIATION' || !authority.intent
    || deadline > authority.intent.deadlineMs || deadline <= authority.intent.startedAtMs) return report('HOLD_AUTHORITY');
  if (observed.hostSession !== 'same-host-session') return report('HOLD_HOST_SESSION');
  if (at > now || now - at > 5000) return report('HOLD_STALE_OBSERVATION');
  if (at < authority.intent.startedAtMs) return report('HOLD_TEMPORAL_INCONSISTENCY');
  if (source.status === 'missing') return report('HOLD_JOURNAL_MISSING');
  if (source.status !== 'trusted-snapshot' || source.expectedSha256 === null) return report('HOLD_JOURNAL_UNTRUSTED');
  let journal: Record<string, unknown>;
  try {
    const text = source.text as string;
    journalHash = 'sha256:' + sha256(text);
    if (journalHash !== source.expectedSha256) throw Error('JOURNAL');
    journal = record(data(strictJson(text, 8192)), ['format', 'operationKey', 'launchOperationKey', 'launchRevision', 'name', 'cid', 'stage', 'deadlineMs', 'guardianPid', 'attachPid', 'reason', 'lease']);
    if (canonicalJson(journal) !== text || journal.format !== 'bowerloom/mcp-container-journal/v1beta1'
      || journal.operationKey !== authority.operationKey || journal.launchOperationKey !== launch.spec.operationKey
      || journal.launchRevision !== launch.revision || journal.name !== 'bowerloom-mcp-' + launch.spec.operationKey.slice(7)
      || journal.deadlineMs !== deadline || !['PREPARED', 'CREATING', 'CREATED', 'STARTED', 'REAPED', 'CANCELLED', 'UNCERTAIN'].includes(journal.stage as string)
      || !(journal.reason === null || (typeof journal.reason === 'string' && /^[A-Z_]{1,64}$/.test(journal.reason)))) throw Error('JOURNAL');
    integer(journal.guardianPid, 1); nullablePid(journal.guardianPid); nullablePid(journal.attachPid);
    const id = cid(journal.cid);
    if (['CREATED', 'STARTED', 'REAPED'].includes(journal.stage as string) && id === null
      || ['PREPARED', 'CREATING', 'CANCELLED'].includes(journal.stage as string) && id !== null
      || journal.stage === 'STARTED' && journal.attachPid === null) throw Error('JOURNAL');
    const lease = record(journal.lease, ['sequence', 'lastRenewedAtMs', 'expiresMonotonicMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']);
    integer(lease.sequence); if (typeof lease.expiresMonotonicMs !== 'number' || lease.expiresMonotonicMs < 0) throw Error('JOURNAL');
    for (const key of ['lastRenewedAtMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']) if (lease[key] !== null) integer(lease[key], 1);
    if (lease.sequence === 0 || lease.lastRenewedAtMs === null || lease.expiresMonotonicMs === 0) throw Error('JOURNAL');
    knownId = id;
  } catch { knownId = null; return report('HOLD_JOURNAL_INVALID'); }
  const lease = journal.lease as Record<string, number | null>;
  // Wall-clock discontinuities stay uncertain. Guardian-monotonic expiry is deliberately excluded.
  const renewed = lease.lastRenewedAtMs!, stopped = lease.stopRequestedAtMs!, absent = lease.containerAbsentAtMs!, reaped = lease.attachReapedAtMs!;
  if ([renewed, stopped, absent, reaped].some(event => event !== null && (event < authority.intent!.startedAtMs || event > at))
    || stopped !== null && stopped < renewed
    || absent !== null && (stopped === null || absent < stopped)
    || reaped !== null && reaped < renewed) return report('HOLD_TEMPORAL_INCONSISTENCY');
  if (guardian.pid !== journal.guardianPid || attach.pid !== journal.attachPid) return report('HOLD_PROCESS_MISMATCH');
  if (guardian.state === 'present' || attach.state === 'present') return report('HOLD_PROCESS_ACTIVE');
  if (guardian.state !== 'absent' || !['absent', 'not-recorded'].includes(attach.state)) return report('HOLD_PROCESS_UNKNOWN');
  if (knownId === null) return report('HOLD_UNKNOWN_IDENTITY');
  // A crash can occur between attach spawn and persistence of its PID. Missing is not reaped.
  if (journal.attachPid === null) return report('HOLD_PROCESS_UNKNOWN');
  if (container.state === 'not-queried') return report('HOLD_CONTAINER_UNKNOWN');
  if (requestedCid !== knownId || returnedCid !== null && returnedCid !== knownId) return report('HOLD_CONTAINER_MISMATCH');
  if (container.state === 'absent') return report('EXACT_ID_ABSENCE_OBSERVED');
  if (container.state === 'present') return report('KNOWN_ID_PRESENT');
  return report('HOLD_CONTAINER_UNKNOWN');
}
