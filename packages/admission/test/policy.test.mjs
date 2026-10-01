import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccount, acceptObservation, evaluateAdmission, PostgresAdmission } from '../../../dist/packages/admission/src/index.js';
import { stateCopy } from '../../../dist/packages/admission/src/validation.js';
import { observation, policy, request } from './fixtures.mjs';
const fresh = () => createAccount('account', ['alias', 'second-alias'], policy());
const sampled = value => acceptObservation(fresh(), value ?? observation(), 10000).state;
const decision = (value, valueRequest = request(), now = 10000) => evaluateAdmission(sampled(value), valueRequest, now);
test('all policy inputs are explicit, bounded, detached, and without paid fallback', () => {
  for (const override of [{ thresholdPercent: 75.01 }, { thresholdPercent: 0 }, { maxWorkers: 3 }, { maxObservationAgeMs: 0 },
    { admittedRoutes: [] }, { headroomPercent: -1 }, { completedResetPolicy: 'refund' }, { extra: true }]) {
    assert.throws(() => createAccount('account', ['alias'], policy(override)), { code: 'INVALID_POLICY' });
  }
  assert.throws(() => createAccount('account', ['alias'], {}), { code: 'INVALID_POLICY' });
  assert.throws(() => createAccount('account', ['alias', 'alias'], policy()), { code: 'INVALID_ALIASES' });
  const input = policy(); const result = createAccount('account', ['alias'], input); input.maxWorkers = 99;
  assert.equal(result.policy.maxWorkers, 2);
  for (const override of [{ paidFallback: true }, { allowancePercent: {} }, { allowancePercent: { primary: 0 } },
    { allowancePercent: { primary: NaN } }, { role: 'unlimited' }, { candidateRevision: 'unbound' }, { attempt: 'implicit' }]) {
    assert.throws(() => decision(observation(), request('alias', 'job', override)), { code: 'INVALID_REQUEST' });
  }
  assert.throws(() => new PostgresAdmission({}, { schema: 'public;DROP' }), { code: 'INVALID_SCHEMA' });
});
const invalidSamples = [
  ['missing', () => undefined, 'INVALID_OBSERVATION'],
  ['invalid percent', value => { value.windows.primary.usedPercent = 101; return value; }, 'INVALID_OBSERVATION'],
  ['unknown fields', value => ({ ...value, extra: true }), 'INVALID_OBSERVATION'],
  ['mismatched account', value => ({ ...value, accountId: 'different' }), 'ACCOUNT_MISMATCH'],
  ['future', value => ({ ...value, observedAtMs: 10001 }), 'FUTURE_OBSERVATION'],
  ['stale', value => ({ ...value, observedAtMs: 4999 }), 'STALE_OBSERVATION'],
  ['expired window', value => { value.windows.primary.resetAtMs = 10000; return value; }, 'EXPIRED_WINDOW'],
  ['future window', value => { value.windows.primary.resetAtMs = 200000; return value; }, 'FUTURE_WINDOW'],
  ['future coverage', value => { value.windows.primary.accountedThroughMs = 10001; return value; }, 'FUTURE_COVERAGE'],
  ['overlapping applicability', value => { value.routes['codex-test'].optionalWindows.push('primary'); return value; }, 'INVALID_APPLICABILITY'],
];
for (const [name, mutate, reason] of invalidSamples) test(`refuses ${name} observation without changing state`, () => {
  const state = fresh(); const before = structuredClone(state);
  const result = acceptObservation(state, mutate(observation()), 10000);
  assert.equal(result.accepted, false); assert.equal(result.reason, reason); assert.deepEqual(result.state, before); assert.deepEqual(state, before);
});
test('input getters are not invoked and cyclic, inherited, or exotic data is refused', () => {
  let invoked = 0; const value = observation(); Object.defineProperty(value, 'authentication', { enumerable: true, get() { invoked++; return 'subscription'; } });
  assert.equal(acceptObservation(fresh(), value, 10000).accepted, false); assert.equal(invoked, 0);
  const cycle = observation(); cycle.windows.primary = cycle;
  for (const value of [cycle, new Date(), Object.assign(Object.create({ extra: true }), observation())]) {
    assert.equal(acceptObservation(fresh(), value, 10000).accepted, false);
  }
});
test('missing current observation is refused', () => {
  assert.deepEqual(evaluateAdmission(fresh(), request(), 10000), { allowed: false, reason: 'MISSING_OBSERVATION' });
});
const capacityCases = [
  ['subscription authentication', value => { value.authentication = 'none'; }, {}, 'SUBSCRIPTION_REQUIRED'],
  ['ordinary usage refusal', value => { value.ordinaryUsageAllowed = false; }, {}, 'ORDINARY_USAGE_REFUSED'],
  ['unadmitted route', () => {}, { modelRoute: 'other' }, 'ROUTE_NOT_ADMITTED'],
  ['unknown applicability', value => { delete value.routes['codex-test']; }, {}, 'UNKNOWN_APPLICABILITY'],
  ['null applicability', value => { value.routes['codex-test'] = null; }, {}, 'UNKNOWN_APPLICABILITY'],
  ['missing required window', value => { delete value.windows.primary; }, {}, 'MISSING_REQUIRED_WINDOW'],
  ['null required window', value => { value.windows.primary = null; }, {}, 'MISSING_REQUIRED_WINDOW'],
  ['unknown optional window', value => { delete value.windows.secondary; }, {}, 'UNKNOWN_OPTIONAL_WINDOW'],
  ['unbound window allowance', () => {}, { allowancePercent: { secondary: 10 } }, 'ALLOWANCE_WINDOWS_MISMATCH'],
  ['threshold reached', value => { value.windows.primary.usedPercent = 60; }, {}, 'CAPACITY_LIMIT'],
  ['secondary threshold reached', value => { value.windows.secondary = { ...value.windows.primary, usedPercent: 60 }; }, { allowancePercent: { primary: 10, secondary: 10 } }, 'CAPACITY_LIMIT'],
];
for (const [name, mutate, overrides, reason] of capacityCases) test(`admission refuses ${name}`, () => {
  const sample = observation(); mutate(sample);
  assert.deepEqual(decision(sample, request('alias', 'job', overrides)), { allowed: false, reason });
});
test('explicitly absent optional window stays absent and exact-boundary rounding is conservative', () => {
  const state = sampled(); assert.equal(state.observation.windows.secondary, null); assert.equal(Object.hasOwn(state.highWater, 'secondary'), false);
  assert.deepEqual(evaluateAdmission(state, request(), 10000), { allowed: true, windows: ['primary'] });
  state.highWater.primary.usedPercent = 59.999;
  assert.equal(evaluateAdmission(state, request(), 10000).reason, 'CAPACITY_LIMIT');
});
test('denied valid samples raise high water and newer lower samples cannot erase it', () => {
  const initial = observation(); initial.windows.primary.usedPercent = 75; initial.ordinaryUsageAllowed = false;
  const original = fresh(); const first = acceptObservation(original, initial, 10000);
  assert.equal(first.accepted, true); assert.equal(original.observation, null);
  const lower = observation('account', 10001); lower.windows.primary.usedPercent = 1;
  const next = acceptObservation(first.state, lower, 10001);
  assert.equal(next.state.highWater.primary.usedPercent, 75); assert.equal(next.state.observation.windows.primary.usedPercent, 1);
  assert.equal(evaluateAdmission(next.state, request(), 10001).reason, 'CAPACITY_LIMIT');
  lower.windows.primary.usedPercent = 100; assert.equal(next.state.observation.windows.primary.usedPercent, 1);
});
test('observation ordering, conflicting snapshots, and reset boundaries fail closed', () => {
  const state = sampled(); const original = observation();
  assert.equal(acceptObservation(state, original, 10000).accepted, true);
  const conflict = observation(); conflict.windows.primary.usedPercent = 1;
  assert.equal(acceptObservation(state, conflict, 10000).reason, 'OBSERVATION_CONFLICT');
  const old = observation('account', 9999); assert.equal(acceptObservation(state, old, 10000).reason, 'OUT_OF_ORDER_OBSERVATION');
  const cases = [[150000, 100000, 'OVERLAPPING_RESET'], [99999, 100000, 'FUTURE_WINDOW'], [100000, 90000, 'WINDOW_DURATION_CHANGED']];
  for (const [resetAtMs, durationMs, reason] of cases) {
    const next = observation('account', 60000); Object.assign(next.windows.primary, { resetAtMs, durationMs });
    assert.equal(acceptObservation(state, next, 60000).reason, reason);
  }
  const next = observation('account', 100001); Object.assign(next.windows.primary, { resetAtMs: 200000, usedPercent: 1 });
  const accepted = acceptObservation(state, next, 100001); assert.equal(accepted.accepted, true); assert.equal(accepted.state.highWater.primary.usedPercent, 1);
  const backward = observation('account', 100002); backward.windows.primary.resetAtMs = 150000;
  assert.equal(acceptObservation(accepted.state, backward, 100002).reason, 'OUT_OF_ORDER_WINDOW');
});
test('prototype names cannot impersonate unknown routes or window history', () => {
  const state = createAccount('account', ['alias'], policy({ admittedRoutes: ['toString'] }));
  state.observation = observation(); assert.equal(evaluateAdmission(state, request('alias', 'job', { modelRoute: 'toString' }), 10000).reason, 'UNKNOWN_APPLICABILITY');
  const value = observation(); value.routes['codex-test'].requiredWindows = ['hasOwnProperty']; value.windows = { hasOwnProperty: { ...value.windows.primary }, secondary: null };
  const accepted = acceptObservation(fresh(), value, 10000); assert.equal(accepted.accepted, true);
  assert.equal(evaluateAdmission(accepted.state, request('alias', 'toString', { allowancePercent: { hasOwnProperty: 10 } }), 10000).allowed, true);
});
test('unknown state versions, mismatched accounts, and malformed reservation state are rejected', () => {
  const state = sampled(); assert.throws(() => stateCopy({ ...state, version: 2 }), { code: 'CORRUPT_ACCOUNT' });
  state.observation.accountId = 'other'; assert.throws(() => stateCopy(state), { code: 'CORRUPT_ACCOUNT' });
  const bad = fresh(); bad.reservations.job = {}; assert.throws(() => stateCopy(bad), { code: 'CORRUPT_ACCOUNT' });
});
