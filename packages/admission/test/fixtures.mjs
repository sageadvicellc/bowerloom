import { digest } from '../../../dist/packages/contracts/src/index.js';
// Synthetic operator inputs for boundary testing. These are not calibrated subscription defaults.
export const policy = (overrides = {}) => ({ thresholdPercent: 75, maxWorkers: 2, maxObservationAgeMs: 5000,
  headroomPercent: 5, admittedRoutes: ['codex-test'], completedResetPolicy: 'hold', ...overrides });
export const observation = (accountId = 'account', observedAtMs = 10000, overrides = {}) => ({
  observationId: `sample-${observedAtMs}`, accountId, observedAtMs, authentication: 'subscription', ordinaryUsageAllowed: true,
  windows: { primary: { usedPercent: 20, durationMs: 100000, resetAtMs: 100000, accountedThroughMs: null }, secondary: null },
  routes: { 'codex-test': { requiredWindows: ['primary'], optionalWindows: ['secondary'] } }, ...overrides });
export const request = (accountAlias = 'alias', jobId = 'job', overrides = {}) => ({
  accountAlias, jobId, candidateRevision: digest('synthetic-candidate'), modelRoute: 'codex-test', role: 'worker',
  attempt: 'initial', allowancePercent: { primary: 10 }, paidFallback: false, ...overrides });
export const proof = (kind, observedAtMs, processRef = null) => ({ kind, observedAtMs, processRef, proofRef: `trusted-${kind}-${observedAtMs}`, fencedLauncherId: null });
export const intercept = (pool, handler) => ({ async connect() {
  const client = await pool.connect();
  return { query: (sql, values) => handler(client, sql, values), release: destroy => client.release(destroy) };
} });
