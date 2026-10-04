import { canonicalJson } from '../../contracts/src/index.js';
import type { AccountState, AccountObservation, AdmissionPolicy, ReservationRequest, CapacityDecision } from './types.js';
import { AdmissionError, identifier, observationCopy, policyCopy, requestCopy, stateCopy, validTime } from './validation.js';
export const activeReservation = (status: string): boolean => ['RESERVED', 'LAUNCHING', 'RUNNING', 'UNKNOWN'].includes(status);
const charge = (percent: number): number => Math.ceil(percent * 100);
const threshold = (percent: number): number => Math.floor(percent * 100);
const own = <T>(values: Record<string, T>, key: string): T | undefined => Object.hasOwn(values, key) ? values[key] : undefined;
type WindowIdentity = { resetAtMs: number; durationMs: number };
// Compare against the original high-water anchor, never the previous sample.
// Nonoverlapping windows remain real rollovers even when their duration is short.
const sameAccountingWindow = (anchor: WindowIdentity, sample: WindowIdentity): boolean => {
  const difference = Math.abs(sample.resetAtMs - anchor.resetAtMs);
  return sample.durationMs === anchor.durationMs && difference <= 1000 && difference < anchor.durationMs;
};

export function createAccount(accountId: string, aliases: string[], policy: AdmissionPolicy): AccountState {
  identifier(accountId);
  if (!Array.isArray(aliases) || aliases.length < 1 || aliases.length > 32 || new Set(aliases).size !== aliases.length) {
    throw new AdmissionError('INVALID_ALIASES', 'An account needs distinct bounded aliases.');
  }
  return stateCopy({ version: 1, accountId, aliases: aliases.map(identifier).sort(), policy: policyCopy(policy), observation: null, highWater: {}, reservations: {} });
}
function observationReason(state: AccountState, observation: AccountObservation, now: number): string | null {
  if (!validTime(now)) return 'CLOCK_UNAVAILABLE';
  if (observation.accountId !== state.accountId) return 'ACCOUNT_MISMATCH';
  if (observation.observedAtMs > now) return 'FUTURE_OBSERVATION';
  if (now - observation.observedAtMs > state.policy.maxObservationAgeMs) return 'STALE_OBSERVATION';
  const previous = state.observation;
  if (previous && canonicalJson(previous) !== canonicalJson(observation)) {
    if (observation.observationId === previous.observationId) return 'OBSERVATION_CONFLICT';
    if (observation.observedAtMs <= previous.observedAtMs) return 'OUT_OF_ORDER_OBSERVATION';
  }
  for (const route of Object.values(observation.routes)) if (route) {
    if (route.requiredWindows.some(window => route.optionalWindows.includes(window))) return 'INVALID_APPLICABILITY';
  }
  for (const [name, window] of Object.entries(observation.windows)) if (window) {
    if (window.resetAtMs <= now) return 'EXPIRED_WINDOW';
    if (window.resetAtMs < window.durationMs || window.resetAtMs - window.durationMs > observation.observedAtMs) return 'FUTURE_WINDOW';
    if (window.accountedThroughMs !== null && window.accountedThroughMs > observation.observedAtMs) return 'FUTURE_COVERAGE';
    const prior = own(state.highWater, name);
    if (prior) {
      if (window.durationMs !== prior.durationMs) return 'WINDOW_DURATION_CHANGED';
      if (sameAccountingWindow(prior, window)) {
        if (prior.resetAtMs <= now) return 'EXPIRED_WINDOW';
      } else {
        if (window.resetAtMs < prior.resetAtMs) return 'OUT_OF_ORDER_WINDOW';
        if (window.resetAtMs - window.durationMs < prior.resetAtMs) return 'OVERLAPPING_RESET';
      }
    }
  }
  return null;
}
export function acceptObservation(input: AccountState, value: unknown, now: number): { state: AccountState; accepted: boolean; reason: string } {
  const state = stateCopy(input);
  let observation: AccountObservation;
  try { observation = observationCopy(value); }
  catch { return { state, accepted: false, reason: 'INVALID_OBSERVATION' }; }
  const reason = observationReason(state, observation, now);
  if (reason) return { state, accepted: false, reason };
  const jitteredWindows = new Set<string>();
  for (const [name, window] of Object.entries(observation.windows)) if (window) {
    const prior = own(state.highWater, name);
    const sameWindow = prior && sameAccountingWindow(prior, window);
    if (sameWindow && prior.resetAtMs !== window.resetAtMs) jitteredWindows.add(name);
    state.highWater[name] = { resetAtMs: sameWindow ? prior.resetAtMs : window.resetAtMs, durationMs: window.durationMs,
      usedPercent: sameWindow ? Math.max(prior.usedPercent, window.usedPercent) : window.usedPercent };
  }
  state.observation = observation;
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.status !== 'COMPLETED' || reservation.completedAtMs === null || observation.observedAtMs <= reservation.completedAtMs) continue;
    const covered = Object.entries(reservation.retained).every(([name, retained]) => {
      const window = own(observation.windows, name);
      // Timestamp tolerance establishes neither exact coverage nor a reset that can release a hold.
      if (jitteredWindows.has(name) || !window || window.accountedThroughMs === null || window.accountedThroughMs < reservation.completedAtMs!) return false;
      const sameWindow = window.resetAtMs === retained.resetAtMs && window.durationMs === retained.durationMs;
      const resolvedReset = state.policy.completedResetPolicy === 'release-covered' && window.resetAtMs > retained.resetAtMs
        && window.resetAtMs - window.durationMs >= retained.resetAtMs;
      return sameWindow || resolvedReset;
    });
    if (covered) reservation.retained = {};
  }
  return { state: stateCopy(state), accepted: true, reason: 'OBSERVATION_ACCEPTED' };
}
function evaluate(stateInput: AccountState, requestInput: ReservationRequest, now: number, proposed: boolean): CapacityDecision {
  const state = stateCopy(stateInput); const request = requestCopy(requestInput);
  const deny = (reason: string): CapacityDecision => ({ allowed: false, reason });
  if (!state.aliases.includes(request.accountAlias)) return deny('ACCOUNT_MISMATCH');
  if (!state.policy.admittedRoutes.includes(request.modelRoute)) return deny('ROUTE_NOT_ADMITTED');
  const observation = state.observation;
  if (!observation) return deny('MISSING_OBSERVATION');
  const invalid = observationReason(state, observation, now);
  if (invalid) return deny(invalid);
  if (observation.authentication !== 'subscription') return deny('SUBSCRIPTION_REQUIRED');
  if (!observation.ordinaryUsageAllowed) return deny('ORDINARY_USAGE_REFUSED');
  const applicability = own(observation.routes, request.modelRoute);
  if (!applicability) return deny('UNKNOWN_APPLICABILITY');
  const windows = [...applicability.requiredWindows];
  for (const name of applicability.requiredWindows) if (!Object.hasOwn(observation.windows, name) || observation.windows[name] === null) return deny('MISSING_REQUIRED_WINDOW');
  for (const name of applicability.optionalWindows) {
    if (!Object.hasOwn(observation.windows, name)) return deny('UNKNOWN_OPTIONAL_WINDOW');
    if (observation.windows[name] !== null) windows.push(name);
  }
  if (canonicalJson([...windows].sort()) !== canonicalJson(Object.keys(request.allowancePercent).sort())) return deny('ALLOWANCE_WINDOWS_MISMATCH');
  for (const reservation of Object.values(state.reservations)) {
    if (!activeReservation(reservation.status) && Object.keys(reservation.retained).length === 0) continue;
    for (const name of Object.keys(reservation.retained)) {
      if (!own(observation.windows, name)) return deny('UNRESOLVED_RESERVATION_WINDOWS');
    }
    const route = own(observation.routes, reservation.request.modelRoute);
    if (!route) return deny('UNRESOLVED_RESERVATION_WINDOWS');
    for (const name of [...route.requiredWindows, ...route.optionalWindows]) {
      const sample = own(observation.windows, name);
      if (sample === undefined || (sample === null && route.requiredWindows.includes(name))
        || (sample !== null && !Object.hasOwn(reservation.request.allowancePercent, name))) return deny('UNRESOLVED_RESERVATION_WINDOWS');
    }
  }
  const workers = Object.values(state.reservations).filter(reservation => activeReservation(reservation.status) && reservation.request.role === 'worker').length;
  if (request.role === 'worker' && workers + (proposed ? 1 : 0) > state.policy.maxWorkers) return deny('WORKER_LIMIT');
  for (const name of windows) {
    const highWater = own(state.highWater, name); const sample = own(observation.windows, name);
    if (!sample || !highWater || !sameAccountingWindow(highWater, sample) || highWater.usedPercent < sample.usedPercent) return deny('MISSING_WINDOW_HISTORY');
    const retained = Object.values(state.reservations).reduce((total, reservation) => total + charge(own(reservation.retained, name)?.percent ?? 0), 0);
    const total = charge(highWater.usedPercent) + retained + charge(state.policy.headroomPercent) + (proposed ? charge(request.allowancePercent[name]!) : 0);
    if (total >= threshold(state.policy.thresholdPercent)) return deny('CAPACITY_LIMIT');
  }
  return { allowed: true, windows };
}
export const evaluateAdmission = (state: AccountState, request: ReservationRequest, now: number): CapacityDecision => evaluate(state, request, now, true);
export const evaluateLaunch = (state: AccountState, request: ReservationRequest, now: number): CapacityDecision => evaluate(state, request, now, false);
