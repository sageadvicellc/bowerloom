import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { PostgresAdmission } from '../../../dist/packages/admission/src/index.js';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { observation, policy, request, proof, intercept } from './fixtures.mjs';
const enabled = process.env.TRELLIS_ADMISSION_PROOF === 'trellis-alpha-proof@127.0.0.1:56582';
test('account admission against a dedicated synthetic PostgreSQL database', { skip: !enabled, timeout: 60000 }, async t => {
  if (!process.env.TRELLIS_ADMISSION_CREDENTIALS_FILE) throw new Error('Supply the private proof credentials file path.');
  const credentials = JSON.parse(readFileSync(process.env.TRELLIS_ADMISSION_CREDENTIALS_FILE, 'utf8'));
  if (typeof credentials.POSTGRES_PASSWORD !== 'string' || !credentials.POSTGRES_PASSWORD) throw new Error('Missing proof PostgreSQL credential.');
  const config = { host: '127.0.0.1', port: 56582, user: 'postgres', password: credentials.POSTGRES_PASSWORD,
    ssl: false, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, application_name: 'trellis_admission_tests' };
  const database = `trellis_admission_test_${randomBytes(8).toString('hex')}`;
  const schema = 'trellis_admission_test'; const accounts = `"${schema}".accounts`;
  const admin = new pg.Client({ ...config, database: 'postgres' });
  const pools = [new pg.Pool({ ...config, database, max: 3 }), new pg.Pool({ ...config, database, max: 3 })];
  for (const pool of pools) pool.on('error', () => {});
  const [pool, otherPool] = pools;
  let now = 10000; let created = false;
  const open = (connection = pool, launcherId = 'test-controller') => new PostgresAdmission(connection, { schema, launcherId, now: () => now });
  const admission = open(); const other = open(otherPool, 'second-controller');
  const names = ['shared', 'same-job', 'highwater', 'launch', 'coverage', 'hold', 'release', 'reserve-unknown', 'claim-unknown',
    'start-unknown', 'crash-claim', 'crash-start', 'delay', 'invalid', 'corrupt', 'detached'];
  const sample = (name, overrides = {}) => observation(name, now, overrides);
  const req = (name, jobId = 'job', overrides = {}) => request(`${name}-a`, jobId, overrides);
  const state = async name => (await pool.query(`SELECT state FROM ${accounts} WHERE account_id=$1`, [name])).rows[0].state;
  const children = new Set();
  const report = { observedAt: new Date().toISOString(), database, schema, tests: [], modelCalls: 0, dockerOperations: 0,
    scope: 'Synthetic explicit policy and process callbacks only; no provider reader, model turn, or provider-enforced quota.' };
  const run = async (name, check) => t.test(name, async () => {
    const started = performance.now();
    try { await check(); report.tests.push({ name, passed: true, milliseconds: performance.now() - started }); }
    catch (error) { report.tests.push({ name, passed: false, milliseconds: performance.now() - started }); throw error; }
  });
  const child = (mode, value, valueObservation, permit, launcherId) => {
    const worker = fork(new URL('./process-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME }, execArgv: [] });
    children.add(worker); worker.once('exit', () => children.delete(worker));
    const exited = once(worker, 'exit');
    const message = Promise.race([once(worker, 'message').then(([value]) => value),
      exited.then(() => { throw new Error('Synthetic launcher exited before sending its observation'); })]);
    worker.send({ config: { ...config, database }, schema, request: value, observation: valueObservation, permit, mode, launcherId });
    return { worker, message, exited };
  };
  try {
    await admin.connect(); report.serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    await admission.createSchema(names.map(accountId => ({ accountId, aliases: [`${accountId}-a`, `${accountId}-b`],
      policy: policy(accountId === 'release' ? { completedResetPolicy: 'release-covered' } : {}) })));
    await run('explicit policy replacement retains history, handles races, and survives lost acknowledgement', async () => {
      const policySchema = `${schema}_policy`;
      const policyOpen = (connection = pool) => new PostgresAdmission(connection, { schema: policySchema, launcherId: 'policy-controller', now: () => now });
      const admission = policyOpen(); const other = policyOpen(otherPool);
      const state = async () => (await pool.query(`SELECT state FROM \"${policySchema}\".accounts WHERE account_id='policy-change'`)).rows[0].state;
      const initial = policy(); const increased = policy({ thresholdPercent: 95 });
      await admission.createSchema([{ accountId: 'policy-change', aliases: ['policy-change-a', 'policy-change-b'], policy: initial }]);
      const reserved = await admission.reserve(req('policy-change'), sample('policy-change'));
      assert.equal(reserved.kind, 'accepted');
      const before = await state();
      assert.deepEqual(await admission.replacePolicy('policy-change-a', initial, increased), increased);
      const after = await state();
      assert.deepEqual({ ...after, policy: before.policy }, before);
      const contenders = await Promise.allSettled([
        admission.replacePolicy('policy-change-a', increased, policy({ thresholdPercent: 90 })),
        other.replacePolicy('policy-change-b', increased, policy({ thresholdPercent: 85 })),
      ]);
      assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(contenders.find(result => result.status === 'rejected').reason.code, 'POLICY_CONFLICT');
      const current = await admission.policy('policy-change-a');
      let lost = false;
      const uncertain = policyOpen(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values);
        if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('lost acknowledgement'); }
        return result;
      }));
      await assert.rejects(uncertain.replacePolicy('policy-change-a', current, increased), { code: 'COMMIT_UNKNOWN' });
      assert.deepEqual(await other.policy('policy-change-b'), increased);
      assert.deepEqual(await other.replacePolicy('policy-change-b', current, increased), increased);
      assert.deepEqual((await state()).reservations, before.reservations);
      assert.deepEqual((await other.lookup('policy-change-a', 'job')).retained, reserved.reservation.retained);
      assert.throws(() => admission.replacePolicy('policy-change-a', increased, policy({ thresholdPercent: 95.01 })), { code: 'INVALID_POLICY' });
    });
    await run('different clients and aliases serialize two workers and charge every role against one account', async () => {
      const pids = await Promise.all(pools.map(pool => pool.query('SELECT pg_backend_pid() AS pid')));
      assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid); report.distinctClientBackends = true;
      const inputs = [req('shared', 'crew-a'), req('shared', 'crew-b', { accountAlias: 'shared-b' }), req('shared', 'crew-c')];
      const results = await Promise.all(inputs.map((value, i) => (i % 2 ? other : admission).reserve(value, sample('shared'))));
      assert.equal(results.filter(value => value.kind === 'accepted').length, 2);
      assert.equal(results.filter(value => value.reason === 'WORKER_LIMIT').length, 1);
      assert.equal((await other.reserve(req('shared', 'lead', { role: 'lead' }), sample('shared'))).kind, 'accepted');
      assert.equal((await admission.reserve(req('shared', 'review', { role: 'reviewer', allowancePercent: { primary: 20 } }), sample('shared'))).reason, 'CAPACITY_LIMIT');
      assert.equal((await admission.reserve(req('shared', 'retry', { role: 'support', attempt: 'retry', allowancePercent: { primary: 20 } }), sample('shared'))).reason, 'CAPACITY_LIMIT');
      assert.equal(Object.keys((await state('shared')).reservations).length, 3);
    });
    await run('concurrent same-job retries disclose one permit and changed pinned inputs conflict', async () => {
      const value = req('same-job'); const results = await Promise.all([admission.reserve(value, sample('same-job')), other.reserve(value, sample('same-job'))]);
      assert.equal(results.filter(value => value.kind === 'accepted').length, 1);
      const existing = results.find(value => value.kind === 'existing'); assert.ok(existing); assert.equal(Object.hasOwn(existing, 'launchPermit'), false);
      for (const changed of [{ candidateRevision: digest('changed') }, { accountAlias: 'same-job-b' }, { modelRoute: 'other' },
        { role: 'lead' }, { allowancePercent: { primary: 1 } }, { attempt: 'retry' }]) {
        assert.equal((await other.reserve({ ...value, ...changed }, sample('same-job'))).reason, 'JOB_CONFLICT');
      }
      const lookup = await other.lookup('same-job-b', 'job'); assert.equal(Object.hasOwn(lookup, 'permitHash'), false);
      assert.equal(lookup.reservationId, existing.reservation.reservationId);
    });
    await run('a denied valid observation persists high water even with an invalid paid-fallback request', async () => {
      const high = sample('highwater'); high.windows.primary.usedPercent = 75;
      assert.equal((await admission.reserve(req('highwater', 'paid', { paidFallback: true }), high)).reason, 'INVALID_REQUEST');
      now++; const low = sample('highwater'); low.windows.primary.usedPercent = 1;
      assert.equal((await other.reserve(req('highwater', 'low'), low)).reason, 'CAPACITY_LIMIT');
      assert.equal((await state('highwater')).highWater.primary.usedPercent, 75);
      assert.equal((await state('highwater')).observation.windows.primary.usedPercent, 1); now = 10000;
    });
    await run('a launch permit starts exactly once across racing clients, retries, and completion', async () => {
      const value = req('launch'); const reserved = await admission.reserve(value, sample('launch')); assert.equal(reserved.kind, 'accepted');
      let starts = 0; const start = async pinned => { starts++; assert.deepEqual(pinned, value); return { processRef: 'process-once' }; };
      const results = await Promise.all([admission.launchOnce('launch-a', 'job', reserved.launchPermit, sample('launch'), start),
        other.launchOnce('launch-b', 'job', reserved.launchPermit, sample('launch'), start)]);
      assert.equal(starts, 1); assert.equal(results.filter(value => value.kind === 'started').length, 1);
      assert.equal(results.filter(value => value.reason === 'ALREADY_CLAIMED').length, 1);
      assert.equal((await other.reserve(value, sample('launch'))).kind, 'existing');
      const completion = proof('completed', now, 'process-once'); await admission.complete('launch-a', 'job', completion);
      assert.equal((await other.complete('launch-b', 'job', completion)).status, 'COMPLETED');
      assert.equal((await admission.launchOnce('launch-a', 'job', reserved.launchPermit, sample('launch'), start)).reason, 'ALREADY_CLAIMED');
      assert.equal(starts, 1); report.exactlyOnceCallback = { starts, competingClients: 2 };
    });
    await run('all refused observations and routes start zero callbacks and leave their original permit unused', async () => {
      const value = req('invalid'); const reserved = await admission.reserve(value, sample('invalid')); let starts = 0;
      const start = async () => { starts++; return { processRef: 'must-not-start' }; };
      const cases = [
        ['missing', () => undefined, 'INVALID_OBSERVATION'],
        ['invalid', value => { value.windows.primary.usedPercent = NaN; return value; }, 'INVALID_OBSERVATION'],
        ['future', value => ({ ...value, observedAtMs: now + 1 }), 'FUTURE_OBSERVATION'],
        ['stale', value => ({ ...value, observedAtMs: now - 5001 }), 'STALE_OBSERVATION'],
        ['expired', value => { value.windows.primary.resetAtMs = now; return value; }, 'EXPIRED_WINDOW'],
        ['auth', value => ({ ...value, authentication: 'none' }), 'SUBSCRIPTION_REQUIRED'],
        ['ordinary', value => ({ ...value, ordinaryUsageAllowed: false }), 'ORDINARY_USAGE_REFUSED'],
        ['route', value => ({ ...value, routes: {} }), 'UNKNOWN_APPLICABILITY'],
        ['required', value => { value.windows.primary = null; return value; }, 'MISSING_REQUIRED_WINDOW'],
        ['optional', value => { delete value.windows.secondary; return value; }, 'UNKNOWN_OPTIONAL_WINDOW'],
        ['new-window', value => { value.windows.secondary = { ...value.windows.primary }; return value; }, 'ALLOWANCE_WINDOWS_MISMATCH'],
        ['capacity', value => { value.windows.primary.usedPercent = 60; return value; }, 'CAPACITY_LIMIT'],
      ];
      for (const [name, mutate, reason] of cases) {
        now++; const denied = await admission.launchOnce('invalid-a', 'job', reserved.launchPermit, mutate(sample('invalid')), start);
        assert.equal(denied.reason, reason, name); assert.equal(starts, 0, name);
      }
      now++; assert.equal((await admission.launchOnce('invalid-a', 'job', '0'.repeat(64), sample('invalid'), start)).reason, 'INVALID_PERMIT');
      assert.equal((await admission.launchOnce('invalid-a', 'unknown-job', reserved.launchPermit, sample('invalid'), start)).reason, 'UNKNOWN_JOB');
      await assert.rejects(admission.launchOnce('unknown-account', 'job', reserved.launchPermit, sample('invalid'), start), { code: 'UNKNOWN_ACCOUNT' });
      assert.equal((await admission.lookup('invalid-a', 'job')).status, 'RESERVED'); assert.equal(starts, 0);
      report.refusedLaunches = { syntheticCases: cases.length + 3, callbackStarts: starts }; now = 10000;
    });
    await run('completed allowances need later per-window coverage and disappearing retained windows block admission', async () => {
      const value = req('coverage', 'job', { allowancePercent: { primary: 10, secondary: 10 } });
      const both = sample('coverage'); both.windows.secondary = { ...both.windows.primary, usedPercent: 10 };
      const reserved = await admission.reserve(value, both);
      await admission.launchOnce('coverage-a', 'job', reserved.launchPermit, both, async () => ({ processRef: 'covered-process' }));
      now++; const missing = sample('coverage'); assert.equal((await admission.reserve(req('coverage', 'missing'), missing)).reason, 'UNRESOLVED_RESERVATION_WINDOWS');
      await admission.complete('coverage-a', 'job', proof('completed', now, 'covered-process'));
      assert.equal(Object.keys((await admission.lookup('coverage-a', 'job')).retained).length, 2);
      now++; const lagging = sample('coverage'); lagging.windows.secondary = { ...lagging.windows.primary, accountedThroughMs: now - 2 };
      await admission.observe('coverage-a', lagging); assert.equal(Object.keys((await admission.lookup('coverage-a', 'job')).retained).length, 2);
      now++; const primaryCovered = sample('coverage'); primaryCovered.windows.primary.accountedThroughMs = now - 2;
      primaryCovered.windows.secondary = { ...primaryCovered.windows.primary, accountedThroughMs: null };
      await admission.observe('coverage-a', primaryCovered);
      assert.deepEqual(Object.keys((await admission.lookup('coverage-a', 'job')).retained).sort(), ['primary', 'secondary']);
      now++; const allCovered = sample('coverage'); allCovered.windows.primary.accountedThroughMs = now - 3;
      allCovered.windows.secondary = { ...allCovered.windows.primary };
      await admission.observe('coverage-a', allCovered); assert.deepEqual((await admission.lookup('coverage-a', 'job')).retained, {});
      assert.equal((await admission.reserve(req('coverage', 'next', { allowancePercent: { primary: 10, secondary: 10 } }), allCovered)).kind, 'accepted'); now = 10000;
    });
    await run('resets retain pending work and require explicit completed-reset policy plus fresh coverage', async () => {
      for (const name of ['hold', 'release']) {
        now = 10000; const sampleBefore = sample(name); const reserved = await admission.reserve(req(name, 'completed'), sampleBefore);
        await admission.launchOnce(`${name}-a`, 'completed', reserved.launchPermit, sampleBefore, async () => ({ processRef: `${name}-process` }));
        await admission.complete(`${name}-a`, 'completed', proof('completed', now, `${name}-process`));
        await admission.reserve(req(name, 'pending'), sampleBefore);
        now = 100001; const reset = sample(name); Object.assign(reset.windows.primary, { usedPercent: 1, resetAtMs: 200000 });
        await admission.observe(`${name}-a`, reset);
        assert.equal(Object.keys((await admission.lookup(`${name}-a`, 'completed')).retained).length, 1);
        now++; const covered = sample(name); Object.assign(covered.windows.primary, { usedPercent: 1, resetAtMs: 200000, accountedThroughMs: now - 1 });
        await admission.observe(`${name}-a`, covered);
        assert.equal(Object.keys((await admission.lookup(`${name}-a`, 'completed')).retained).length, name === 'hold' ? 1 : 0);
        assert.equal(Object.keys((await admission.lookup(`${name}-a`, 'pending')).retained).length, 1);
        assert.equal((await admission.lookup(`${name}-a`, 'pending')).status, 'RESERVED');
      }
      now = 10000;
    });
    await run('refused admissions never reach the controller launch callback', async () => {
      let starts = 0;
      const reserveAndLaunch = async (value, observed) => {
        const result = await admission.reserve(value, observed);
        if (result.kind === 'accepted') await admission.launchOnce(value.accountAlias, value.jobId, result.launchPermit, observed, async () => {
          starts++; return { processRef: 'must-not-start' };
        });
        return result;
      };
      const cases = [
        [req('shared', 'third-worker'), sample('shared'), 'WORKER_LIMIT'],
        [req('shared', 'paid', { paidFallback: true }), sample('shared'), 'INVALID_REQUEST'],
        [req('shared', 'unadmitted', { modelRoute: 'other' }), sample('shared'), 'ROUTE_NOT_ADMITTED'],
        [req('shared', 'bad-allowance', { allowancePercent: { secondary: 1 } }), sample('shared'), 'ALLOWANCE_WINDOWS_MISMATCH'],
        [req('shared', 'review-new', { role: 'reviewer', allowancePercent: { primary: 20 } }), sample('shared'), 'CAPACITY_LIMIT'],
        [req('same-job', 'job', { candidateRevision: digest('other') }), sample('same-job'), 'JOB_CONFLICT'],
      ];
      for (const [value, observed, reason] of cases) assert.equal((await reserveAndLaunch(value, observed)).reason, reason);
      assert.equal((await reserveAndLaunch(req('same-job'), sample('same-job'))).kind, 'existing'); assert.equal(starts, 0);
      report.refusedAdmissions = { syntheticCases: cases.length + 1, callbackStarts: starts };
    });
    await run('lost reservation commit acknowledgement yields no permit and requires explicit reconciliation', async () => {
      let lost = false; const uncertain = open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values); if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('Synthetic lost acknowledgement'); } return result;
      }));
      const value = req('reserve-unknown'); await assert.rejects(uncertain.reserve(value, sample('reserve-unknown')), { code: 'COMMIT_UNKNOWN' });
      assert.equal((await admission.lookup('reserve-unknown-a', 'job')).status, 'RESERVED');
      const fresh = child('reserve', value, sample('reserve-unknown'), null, 'fresh-controller'); const observed = await fresh.message; await fresh.exited;
      assert.equal(observed.result.kind, 'existing'); assert.equal(Object.hasOwn(observed.result, 'launchPermit'), false);
      await admission.reconcile(value, proof('not-started', now));
      assert.equal((await admission.reserve(value, sample('reserve-unknown'))).reservation.status, 'CANCELLED');
      const absent = req('reserve-unknown', 'missing');
      const unsentCommit = open(intercept(pool, async (client, sql, values) => {
        if (sql === 'COMMIT') throw new Error('Synthetic unsent commit'); return client.query(sql, values);
      }));
      await assert.rejects(unsentCommit.reserve(absent, sample('reserve-unknown')), { code: 'COMMIT_UNKNOWN' });
      assert.equal(await admission.lookup('reserve-unknown-a', 'missing'), null);
      await admission.reconcile(absent, proof('not-started', now));
      assert.equal((await admission.reserve(absent, sample('reserve-unknown'))).kind, 'existing');
      report.unknownReservationCommit = { freshProcessRetryPermit: false, explicitTombstone: true };
    });
    await run('lost launch-claim commit acknowledgement cannot invoke the callback or reissue its permit', async () => {
      const value = req('claim-unknown'); const reserved = await admission.reserve(value, sample('claim-unknown')); let starts = 0; let lost = false;
      const uncertain = open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values); if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('Synthetic lost acknowledgement'); } return result;
      }));
      const start = async () => { starts++; return { processRef: 'no-start' }; };
      await assert.rejects(uncertain.launchOnce('claim-unknown-a', 'job', reserved.launchPermit, sample('claim-unknown'), start), { code: 'COMMIT_UNKNOWN' });
      assert.equal(starts, 0); assert.equal((await admission.lookup('claim-unknown-a', 'job')).status, 'LAUNCHING');
      assert.equal((await admission.launchOnce('claim-unknown-a', 'job', reserved.launchPermit, sample('claim-unknown'), start)).reason, 'ALREADY_CLAIMED');
      await assert.rejects(admission.reconcile(value, proof('not-started', now)), { code: 'LAUNCHER_FENCE_REQUIRED' });
      // The synthetic interceptor has returned and cannot dispatch. A real controller must supply a supervisor fence.
      await admission.reconcile(value, { ...proof('not-started', now), fencedLauncherId: 'test-controller' }); assert.equal(starts, 0);
    });
    await run('a thrown callback preserves unknown capacity and cannot start a second process', async () => {
      const value = req('start-unknown'); const reserved = await admission.reserve(value, sample('start-unknown')); let starts = 0;
      const start = async () => { starts++; throw new Error('Synthetic process may have started'); };
      await assert.rejects(admission.launchOnce('start-unknown-a', 'job', reserved.launchPermit, sample('start-unknown'), start), { code: 'LAUNCH_UNKNOWN' });
      assert.equal((await admission.lookup('start-unknown-a', 'job')).status, 'UNKNOWN');
      assert.equal((await admission.launchOnce('start-unknown-a', 'job', reserved.launchPermit, sample('start-unknown'), start)).reason, 'ALREADY_CLAIMED');
      assert.equal(starts, 1);
      await assert.rejects(admission.reconcile(value, proof('not-started', now)), { code: 'LAUNCHER_FENCE_REQUIRED' });
      const resolved = await admission.reconcile(value, proof('completed', now, 'synthetic-completed'));
      assert.equal(resolved.status, 'COMPLETED'); assert.equal(resolved.retained.primary.percent, 10);
    });
    await run('lost running-result acknowledgement holds the already started process without replay', async () => {
      const value = req('start-unknown', 'lost-running'); const observed = sample('start-unknown');
      const reserved = await admission.reserve(value, observed); let starts = 0; let commits = 0;
      const uncertain = open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values);
        if (sql === 'COMMIT' && ++commits === 2) throw new Error('Synthetic lost running acknowledgement');
        return result;
      }));
      const start = async () => { starts++; return { processRef: 'started-once' }; };
      await assert.rejects(uncertain.launchOnce('start-unknown-a', 'lost-running', reserved.launchPermit, observed, start), { code: 'LAUNCH_UNKNOWN' });
      assert.equal((await admission.lookup('start-unknown-a', 'lost-running')).status, 'RUNNING');
      assert.equal((await admission.launchOnce('start-unknown-a', 'lost-running', reserved.launchPermit, observed, start)).reason, 'ALREADY_CLAIMED');
      assert.equal(starts, 1);
      await assert.rejects(admission.reconcile(value, { ...proof('not-started', now), fencedLauncherId: 'test-controller' }), { code: 'INVALID_PROOF' });
    });
    for (const mode of ['claim', 'started']) await run(`process interruption at ${mode} holds the launch across a fresh process`, async () => {
      const name = mode === 'claim' ? 'crash-claim' : 'crash-start'; const value = req(name); const observed = sample(name);
      const reserved = await admission.reserve(value, observed); const launcherId = `isolated-${mode}-launcher`;
      const worker = child(mode, value, observed, reserved.launchPermit, launcherId); const checkpoint = await worker.message;
      assert.equal(checkpoint.type, mode); assert.equal(checkpoint.starts, mode === 'claim' ? 0 : 1);
      await assert.rejects(admission.reconcile(value, proof('not-started', now)), { code: 'LAUNCHER_FENCE_REQUIRED' });
      await assert.rejects(admission.reconcile(value, { ...proof('not-started', now), fencedLauncherId: 'other-launcher' }), { code: 'LAUNCHER_FENCE_REQUIRED' });
      assert.equal((await admission.lookup(`${name}-a`, 'job')).status, 'LAUNCHING');
      worker.worker.kill('SIGKILL'); const [, signal] = await worker.exited; assert.equal(signal, 'SIGKILL');
      const fresh = child('replay', value, observed, reserved.launchPermit, 'restart-controller'); const retried = await fresh.message; await fresh.exited;
      assert.equal(retried.result.reason, 'ALREADY_CLAIMED'); assert.equal(retried.starts, 0);
      if (mode === 'claim') {
        const resolved = await admission.reconcile(value, { ...proof('not-started', now), fencedLauncherId: launcherId });
        assert.equal(resolved.status, 'CANCELLED'); assert.deepEqual(resolved.retained, {});
      } else {
        const resolved = await admission.reconcile(value, proof('completed', now, 'synthetic-child-process'));
        assert.equal(resolved.status, 'COMPLETED'); assert.equal(resolved.retained.primary.percent, 10);
      }
      report[`${mode}Crash`] = { checkpointStarts: checkpoint.starts, freshProcessStarts: retried.starts, oldLauncherKilled: true,
        unfencedReleaseRefused: true, wrongFenceRefused: true };
    });
    await run('stale evidence after commit acknowledgement cannot launch', async () => {
      const value = req('delay'); const reserved = await admission.reserve(value, sample('delay')); let starts = 0; let delayed = false;
      const delayedAdmission = open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values); if (sql === 'COMMIT' && !delayed) { delayed = true; now += 5001; } return result;
      }));
      const result = await delayedAdmission.launchOnce('delay-a', 'job', reserved.launchPermit, sample('delay'), async () => { starts++; return { processRef: 'must-not-start' }; });
      assert.equal(result.reason, 'LAUNCH_EVIDENCE_EXPIRED'); assert.equal(starts, 0);
      assert.equal((await admission.lookup('delay-a', 'job')).status, 'UNKNOWN'); now = 10000;
    });
    await run('row-lock waits cannot make an expired observation current', async () => {
      const blocker = await otherPool.connect(); await blocker.query('BEGIN');
      await blocker.query(`SELECT account_id FROM ${accounts} WHERE account_id='detached' FOR UPDATE`);
      let selected; let waitingPid; const reached = new Promise(resolve => { selected = resolve; });
      const blocked = open(intercept(pool, async (client, sql, values) => {
        if (sql.includes('WHERE account_id=(SELECT')) { waitingPid = client.processID; selected(); } return client.query(sql, values);
      }));
      const pending = blocked.reserve(req('detached', 'wait'), sample('detached'));
      try {
        await reached; let waiting = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const activity = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [waitingPid])).rows[0];
          if (activity?.wait_event_type === 'Lock') { waiting = true; break; }
          await delay(10);
        }
        assert.equal(waiting, true); report.observedRowLockWait = true; now += 5001;
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
      assert.equal((await pending).reason, 'STALE_OBSERVATION'); assert.equal(await admission.lookup('detached-a', 'wait'), null); now = 10000;
    });
    await run('input snapshots and returned views are detached from the durable pinned request', async () => {
      const value = req('detached'); const observed = sample('detached');
      const pending = admission.reserve(value, observed); value.role = 'lead'; observed.windows.primary.usedPercent = 99;
      const reserved = await pending; assert.equal(reserved.kind, 'accepted');
      reserved.reservation.request.allowancePercent.primary = 99;
      let starts = 0;
      const launched = await other.launchOnce('detached-b', 'job', reserved.launchPermit, sample('detached'), async pinned => {
        starts++; assert.equal(pinned.role, 'worker'); assert.equal(pinned.allowancePercent.primary, 10);
        pinned.allowancePercent.primary = 99; return { processRef: 'detached-process' };
      });
      assert.equal(launched.kind, 'started'); assert.equal(starts, 1);
      assert.equal((await admission.lookup('detached-a', 'job')).request.allowancePercent.primary, 10);
    });
    await run('unknown schema, unavailable store, corrupt states, versions, and failed transactions cannot launch', async () => {
      const value = req('corrupt'); const reserved = await admission.reserve(value, sample('corrupt')); let starts = 0;
      const start = async () => { starts++; return { processRef: 'must-not-start' }; };
      const launch = target => target.launchOnce('corrupt-a', 'job', reserved.launchPermit, sample('corrupt'), start);
      await assert.rejects(launch(new PostgresAdmission(pool, { schema: 'trellis_missing', launcherId: 'test' })), { code: 'DATABASE_ERROR' });
      await assert.rejects(launch(open({ connect() { throw new Error('Synthetic disconnected store'); } })), { code: 'STORE_UNAVAILABLE' });
      const row = (await pool.query(`SELECT * FROM ${accounts} WHERE account_id='corrupt'`)).rows[0];
      for (const [sql, values, code] of [
        [`UPDATE ${accounts} SET checksum='invalid' WHERE account_id='corrupt'`, [], 'CORRUPT_ACCOUNT'],
        [`UPDATE ${accounts} SET checksum=$1, version=2 WHERE account_id='corrupt'`, [row.checksum], 'UNSUPPORTED_VERSION'],
        [`UPDATE ${accounts} SET version=1, state='{}'::jsonb WHERE account_id='corrupt'`, [], 'CORRUPT_ACCOUNT'],
      ]) { await pool.query(sql, values); await assert.rejects(launch(admission), { code }); }
      const broken = structuredClone(row.state); broken.reservations.job.retained.primary.percent = 1;
      await pool.query(`UPDATE ${accounts} SET state=$1::jsonb, checksum=$2 WHERE account_id='corrupt'`, [JSON.stringify(broken), digest(canonicalJson(broken))]);
      await assert.rejects(launch(admission), { code: 'CORRUPT_ACCOUNT' });
      await pool.query(`UPDATE ${accounts} SET state=$1::jsonb, checksum=$2 WHERE account_id='corrupt'`, [JSON.stringify(row.state), row.checksum]);
      await pool.query(`UPDATE "${schema}".metadata SET version=2`); await assert.rejects(launch(admission), { code: 'UNSUPPORTED_VERSION' });
      await pool.query(`UPDATE "${schema}".metadata SET version=1`);
      const failing = open(intercept(pool, async (client, sql, values) => {
        if (sql.startsWith('UPDATE ')) throw new Error('Synthetic precommit failure'); return client.query(sql, values);
      }));
      await assert.rejects(launch(failing), { code: 'DATABASE_ERROR' }); assert.equal(starts, 0);
      assert.equal((await admission.lookup('corrupt-a', 'job')).status, 'RESERVED');
    });
    report.reservations = (await pool.query(`SELECT state FROM ${accounts}`)).rows.flatMap(row => Object.values(row.state.reservations)).reduce((result, value) => {
      result[value.status] = (result[value.status] ?? 0) + 1; return result;
    }, {});
    report.databaseBytes = Number((await pool.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
  } finally {
    const cleanupErrors = [];
    for (const worker of children) try { const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited; } catch { cleanupErrors.push('child'); }
    for (const pool of pools) try { await pool.end(); } catch { cleanupErrors.push('pool'); }
    if (created) try { await admin.query(`DROP DATABASE "${database}"`); report.databaseRemoved = true; } catch { cleanupErrors.push('database'); }
    try { await admin.end(); } catch { cleanupErrors.push('admin'); }
    report.childrenReaped = children.size === 0; report.cleanupErrors = cleanupErrors; report.finishedAt = new Date().toISOString();
    report.passed = report.tests.length === 18 && report.tests.every(value => value.passed) && report.databaseRemoved === true && report.childrenReaped && cleanupErrors.length === 0;
    mkdirSync('packages/admission/.trellis', { recursive: true });
    writeFileSync('packages/admission/.trellis/test-result.json', JSON.stringify(report, null, 2) + '\n');
    if (cleanupErrors.length) throw new Error('Synthetic admission test cleanup failed; inspect local result.');
  }
});
