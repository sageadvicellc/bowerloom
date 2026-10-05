import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { acceptObservation, createAccount, evaluateAdmission, evaluateLaunch, PostgresAdmission } from '../../../dist/packages/admission/src/index.js';
import { stateCopy } from '../../../dist/packages/admission/src/validation.js';
import { observation, policy, proof, request } from './fixtures.mjs';

const anchor = 200000;
const sample = (time = 150000, offset = 0, usedPercent = 20) => observation('account', time, {
  windows: { primary: { usedPercent, durationMs: 100000, resetAtMs: anchor + offset, accountedThroughMs: null }, secondary: null },
});
const account = (overrides = {}, usedPercent = 20) => acceptObservation(
  createAccount('account', ['alias'], policy(overrides)), sample(150000, 0, usedPercent), 150000,
).state;
const observe = (state, time, offset = 0, usedPercent = 20) => acceptObservation(state, sample(time, offset, usedPercent), time);

// Construct valid synthetic retained states without opening a database or executing a launcher.
function withReservation(input, status = 'COMPLETED', heldReset = anchor, jobId = 'held') {
  const state = structuredClone(input); const job = request('alias', jobId, { role: 'support' });
  const requestDigest = digest(canonicalJson(job));
  state.reservations[jobId] = {
    request: job, requestDigest, reservationId: digest(canonicalJson({ accountId: 'account', jobId, requestDigest })),
    status, createdAtMs: 150000, claimedAtMs: status === 'RESERVED' ? null : 150001,
    launcherId: status === 'RESERVED' ? null : 'synthetic-launcher', completedAtMs: status === 'COMPLETED' ? 150002 : null,
    processRef: ['RUNNING', 'COMPLETED'].includes(status) ? 'synthetic-process' : null,
    permitHash: status === 'RESERVED' ? digest('synthetic-permit') : null,
    retained: { primary: { percent: 10, resetAtMs: heldReset, durationMs: 100000 } },
    proofs: status === 'COMPLETED' ? [proof('completed', 150002, 'synthetic-process')] : [],
  };
  return stateCopy(state);
}

for (const offset of [-1000, -1, 1, 1000]) test(`reset jitter ${offset}ms preserves the anchor and accepts a current window`, () => {
  const initial = account(); const before = structuredClone(initial); const next = observe(initial, 150001, offset);
  assert.equal(next.accepted, true); assert.deepEqual(initial, before);
  assert.equal(next.state.highWater.primary.resetAtMs, anchor);
  assert.equal(next.state.observation.windows.primary.resetAtMs, anchor + offset, 'retain the authenticated raw sample');
  assert.equal(evaluateAdmission(next.state, request(), 150001).allowed, true);
  assert.equal(evaluateLaunch(next.state, request(), 150001).allowed, true);
  assert.deepEqual(acceptObservation(next.state, next.state.observation, 150001).state, next.state, 'same observation remains idempotent');
});
for (const offset of [-2000, -1001, 1001, 2000]) test(`reset overlap ${offset}ms is rejected without changing accounting`, () => {
  const state = withReservation(account()); const next = observe(state, 150003, offset, 1);
  assert.equal(next.accepted, false);
  assert.equal(next.reason, offset < 0 ? 'OUT_OF_ORDER_WINDOW' : 'OVERLAPPING_RESET');
  assert.deepEqual(next.state, state);
});

test('jitter cannot lower the high-water charge or bypass either capacity decision', () => {
  let state = account({}, 65);
  for (const [index, offset] of [1000, -1000, 0, 500, -500].entries()) {
    const time = 150001 + index; const next = observe(state, time, offset, 1);
    assert.equal(next.accepted, true); state = next.state;
    assert.deepEqual(state.highWater.primary, { resetAtMs: anchor, durationMs: 100000, usedPercent: 65 });
    assert.equal(evaluateAdmission(state, request(), time).reason, 'CAPACITY_LIMIT');
    assert.equal(evaluateLaunch(withReservation(state, 'RESERVED'), request(), time).reason, 'CAPACITY_LIMIT');
  }
  state = observe(state, 150010, 1000, 80).state;
  state = observe(state, 150011, -1000, 2).state;
  assert.equal(state.highWater.primary.usedPercent, 80, 'higher jittered usage also survives later lower readings');
});

test('successive jitter is bounded by the fixed original anchor rather than accumulating', () => {
  for (const direction of [-1, 1]) {
    let state = account();
    for (const [index, distance] of [400, 800, 1000].entries()) {
      const next = observe(state, 150001 + index, direction * distance, 1);
      assert.equal(next.accepted, true); state = next.state;
    }
    const next = observe(state, 150004, direction * 1001, 1);
    assert.equal(next.accepted, false); assert.deepEqual(next.state, state);
    assert.equal(next.state.highWater.primary.resetAtMs, anchor);
  }
});

for (const completedResetPolicy of ['hold', 'release-covered']) test(`${completedResetPolicy}: jitter never releases completed or active retained allowances`, () => {
  for (const status of ['COMPLETED', 'RESERVED', 'LAUNCHING', 'RUNNING', 'UNKNOWN']) {
    for (const offset of [-1000, 1000]) {
      // Include a hold created during the same jitter: even matching retained.resetAtMs is insufficient.
      for (const heldReset of [anchor, anchor + offset]) {
        const original = withReservation(account({ completedResetPolicy }), status, heldReset);
        const covered = sample(150003, offset, 1); covered.windows.primary.accountedThroughMs = 150003;
        const next = acceptObservation(original, covered, 150003);
        assert.equal(next.accepted, true);
        assert.deepEqual(next.state.reservations.held, original.reservations.held);
        const repeated = { ...covered, observationId: 'covered-again', observedAtMs: 150004 };
        assert.deepEqual(acceptObservation(next.state, repeated, 150004).state.reservations.held, original.reservations.held);
      }
    }
  }
});

test('exact same-window coverage still releases a completed hold but never active work', () => {
  let state = withReservation(account()); state = withReservation(state, 'UNKNOWN', anchor, 'active');
  state = observe(state, 150003, 1000).state;
  const covered = sample(150004); covered.windows.primary.accountedThroughMs = 150002;
  const next = acceptObservation(state, covered, 150004);
  assert.equal(next.accepted, true); assert.deepEqual(next.state.reservations.held.retained, {});
  assert.deepEqual(next.state.reservations.active, state.reservations.active);
});

test('the observed weekly timestamp pair preserves both the usage high water and original raw evidence', () => {
  for (const resets of [[1791480104000, 1791480105000], [1791480105000, 1791480104000]]) {
    const time = 1790876000000; const first = observation('account', time);
    Object.assign(first.windows.primary, { durationMs: 604800000, resetAtMs: resets[0], usedPercent: 58 });
    const initial = acceptObservation(createAccount('account', ['alias'], policy()), first, time);
    assert.equal(initial.accepted, true);
    const next = structuredClone(first); next.observationId = 'weekly-next'; next.observedAtMs++;
    Object.assign(next.windows.primary, { resetAtMs: resets[1], usedPercent: 1 });
    const result = acceptObservation(initial.state, next, time + 1);
    assert.equal(result.accepted, true); assert.equal(result.state.highWater.primary.usedPercent, 58);
    assert.equal(result.state.highWater.primary.resetAtMs, resets[0]);
    assert.deepEqual(result.state.observation, next);
  }
});

test('jitter preserves duration, account, ordering, freshness, and ordinary-usage requirements', () => {
  const state = account();
  const duration = sample(150001, 1000); duration.windows.primary.durationMs++;
  assert.equal(acceptObservation(state, duration, 150001).reason, 'WINDOW_DURATION_CHANGED');
  const other = sample(150001, 1000); other.accountId = 'other';
  assert.equal(acceptObservation(state, other, 150001).reason, 'ACCOUNT_MISMATCH');
  assert.equal(acceptObservation(state, sample(150000, 1000), 150000).reason, 'OBSERVATION_CONFLICT');
  assert.equal(acceptObservation(state, sample(149999, 1000), 150000).reason, 'OUT_OF_ORDER_OBSERVATION');
  const next = observe(state, 150001, 1000).state;
  assert.equal(evaluateAdmission(next, request(), 155002).reason, 'STALE_OBSERVATION');
  next.observation.ordinaryUsageAllowed = false;
  assert.equal(evaluateLaunch(next, request(), 150001).reason, 'ORDINARY_USAGE_REFUSED');
});

for (const offset of [-1000, 1000]) test(`jitter ${offset}ms cannot extend the earlier sample/anchor expiry`, () => {
  const deadline = Math.min(anchor, anchor + offset);
  const before = observe(account(), deadline - 1, offset);
  assert.equal(before.accepted, true);
  assert.equal(evaluateAdmission(before.state, request(), deadline - 1).allowed, true);
  for (const now of [deadline, deadline + 1]) {
    assert.equal(evaluateAdmission(before.state, request(), now).reason, 'EXPIRED_WINDOW');
    assert.equal(evaluateLaunch(before.state, request(), now).reason, 'EXPIRED_WINDOW');
    const expired = observe(before.state, now, offset);
    assert.equal(expired.accepted, false); assert.equal(expired.reason, 'EXPIRED_WINDOW');
    assert.deepEqual(expired.state, before.state);
  }
});

test('window history must match the fixed anchor and never understate observed usage', () => {
  const state = observe(account(), 150001, 1000).state;
  for (const mutate of [value => { value.highWater = {}; }, value => { value.highWater.primary.usedPercent = 19; },
    value => { value.observation.windows.primary.resetAtMs = anchor + 100000; value.observation.observedAtMs = anchor; }]) {
    const bad = structuredClone(state); mutate(bad);
    assert.equal(evaluateAdmission(bad, request(), bad.observation.observedAtMs).reason, 'MISSING_WINDOW_HISTORY');
  }
});

for (const completedResetPolicy of ['hold', 'release-covered']) test(`${completedResetPolicy}: genuine nonoverlapping rollover remains explicit and preserves pending holds`, () => {
  let state = withReservation(account({ completedResetPolicy }, 65));
  state = withReservation(state, 'UNKNOWN', anchor, 'active');
  const jitter = observe(state, 198999, -1000, 1); assert.equal(jitter.accepted, true); state = jitter.state;
  assert.equal(state.highWater.primary.resetAtMs, anchor);
  const overlapping = sample(200000, 99000, 1); overlapping.windows.primary.accountedThroughMs = 200000;
  assert.equal(acceptObservation(state, overlapping, 200000).reason, 'OVERLAPPING_RESET');
  const reset = sample(200000, 100000, 1);
  const next = acceptObservation(state, reset, 200000); assert.equal(next.accepted, true);
  assert.deepEqual(next.state.highWater.primary, { resetAtMs: 300000, durationMs: 100000, usedPercent: 1 });
  assert.deepEqual(next.state.reservations, state.reservations, 'no release without coverage');
  const covered = sample(200001, 100000, 1); covered.windows.primary.accountedThroughMs = 200000;
  const result = acceptObservation(next.state, covered, 200001).state;
  assert.deepEqual(result.reservations.held.retained, completedResetPolicy === 'hold' ? state.reservations.held.retained : {});
  assert.deepEqual(result.reservations.active, state.reservations.active);
});

test('a fully nonoverlapping short window is a real rollover, not one-second jitter', () => {
  const first = sample(150000); Object.assign(first.windows.primary, { durationMs: 500, resetAtMs: 150500, usedPercent: 65 });
  const state = acceptObservation(createAccount('account', ['alias'], policy()), first, 150000).state;
  const next = structuredClone(first); next.observationId = 'short-next'; next.observedAtMs = 150500;
  Object.assign(next.windows.primary, { resetAtMs: 151000, usedPercent: 1 });
  const result = acceptObservation(state, next, 150500);
  assert.equal(result.accepted, true); assert.equal(result.state.highWater.primary.usedPercent, 1);
  assert.equal(result.state.highWater.primary.resetAtMs, 151000);
  assert.equal(evaluateAdmission(result.state, request(), 150500).allowed, true);
});

// Deliberately synthetic transaction transport, only for the clock boundary between commit and start.
// This is not a PostgreSQL persistence or concurrency proof and makes no network connection.
function memoryPool(initial, onCommit) {
  let stored = stateCopy(initial);
  return { snapshot: () => stateCopy(stored), async connect() {
    let staged;
    return Object.assign(new EventEmitter(), { release() {}, async query(sql, values) {
      if (sql.startsWith('BEGIN')) staged = stateCopy(stored);
      else if (sql.startsWith('SET LOCAL')) { /* Synthetic transaction settings. */ }
      else if (sql.includes('.metadata FOR SHARE')) return { rows: [{ singleton: true, version: 1 }] };
      else if (sql.includes('WHERE account_id=(SELECT')) return { rows: [{ account_id: 'account', version: 1,
        state: structuredClone(staged), checksum: digest(canonicalJson(staged)) }] };
      else if (sql.startsWith('UPDATE')) {
        staged = stateCopy(JSON.parse(values[1])); assert.equal(values[2], digest(canonicalJson(staged)));
      } else if (sql === 'COMMIT') { stored = staged; onCommit(); }
      else if (sql === 'ROLLBACK') staged = undefined;
      else throw new Error(`Unexpected synthetic query: ${sql}`);
      return { rows: [] };
    } });
  } };
}
for (const offset of [-1000, 1000]) test(`post-commit launch check respects ${offset}ms jitter expiry without losing its hold`, async () => {
  for (const expire of [false, true]) {
    let now = 150000; let jump = false; let starts = 0;
    const deadline = Math.min(anchor, anchor + offset);
    const pool = memoryPool(account(), () => { if (jump) { now = deadline - (expire ? 0 : 1); jump = false; } });
    const admission = new PostgresAdmission(pool, { schema: 'trellis_jitter_fixture', launcherId: 'synthetic-launcher', now: () => now });
    const reserved = await admission.reserve(request(), sample(now)); assert.equal(reserved.kind, 'accepted');
    now = deadline - 2; jump = true;
    const result = await admission.launchOnce('alias', 'job', reserved.launchPermit, sample(now, offset), async () => {
      starts++; return { processRef: 'synthetic-process' };
    });
    assert.equal(starts, expire ? 0 : 1);
    assert.equal(result.kind, expire ? 'denied' : 'started');
    if (expire) assert.equal(result.reason, 'LAUNCH_EVIDENCE_EXPIRED');
    assert.equal(pool.snapshot().reservations.job.status, expire ? 'UNKNOWN' : 'RUNNING');
    assert.deepEqual(pool.snapshot().reservations.job.retained, reserved.reservation.retained);
    assert.equal(pool.snapshot().highWater.primary.resetAtMs, anchor);
  }
});
