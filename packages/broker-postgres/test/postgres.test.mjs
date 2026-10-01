import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { ActionBroker } from '../../../dist/packages/broker/src/index.js';
import { InMemoryWorkspaceEffects } from '../../../dist/packages/broker/src/synthetic.js';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { plan, state } from './fixtures.mjs';

const enabled = process.env.TRELLIS_BROKER_PROOF === 'trellis-alpha-proof@127.0.0.1:56582';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const pause = ms => new Promise(done => setTimeout(done, ms));
const intercept = (pool, handler) => ({ async connect() {
  const client = await pool.connect();
  return { query: (sql, values) => handler(client, sql, values), release: destroy => client.release(destroy) };
} });

test('dedicated local PostgreSQL transaction proof', { skip: !enabled, timeout: 60_000 }, async t => {
  if (!process.env.TRELLIS_BROKER_CREDENTIALS_FILE) throw new Error('Supply a private credentials file path.');
  const credentials = JSON.parse(readFileSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE, 'utf8'));
  if (typeof credentials.POSTGRES_PASSWORD !== 'string' || !credentials.POSTGRES_PASSWORD) throw new Error('Missing private PostgreSQL password.');
  const config = { host: '127.0.0.1', port: 56582, user: 'postgres', password: credentials.POSTGRES_PASSWORD,
    ssl: false, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, application_name: 'trellis_broker_adapter_tests' };
  const database = `trellis_broker_test_${randomBytes(8).toString('hex')}`;
  const schema = 'trellis_broker_test';
  const table = `"${schema}".task_states`;
  const admin = new pg.Client({ ...config, database: 'postgres' });
  const poolA = new pg.Pool({ ...config, database, max: 3 });
  const poolB = new pg.Pool({ ...config, database, max: 3 });
  poolA.on('error', () => {}); poolB.on('error', () => {});
  const a = new PostgresBrokerStore(poolA, { schema });
  const b = new PostgresBrokerStore(poolB, { schema });
  const children = new Set();
  let created = false;
  const report = { observedAt: new Date().toISOString(), pgPackageVersion: '8.16.3', database, schema,
    tests: [], modelCalls: 0, dockerOperations: 0, limits: 'Synthetic broker state only; no real side-effect replay, server restart, or complete alpha acceptance.' };
  const run = async (name, check) => t.test(name, async () => {
    const started = performance.now();
    try { await check(); report.tests.push({ name, passed: true, milliseconds: performance.now() - started }); }
    catch (error) { report.tests.push({ name, passed: false, milliseconds: performance.now() - started }); throw error; }
  });
  const values = scope => [scope.workspaceId, scope.runId, scope.taskId];
  const rawState = async scope => (await poolB.query(`SELECT state FROM ${table} WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3`, values(scope))).rows[0].state;
  try {
    await admin.connect();
    report.serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    await a.createSchema();
    report.clientPids = [(await poolA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      (await poolB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
    assert.notEqual(report.clientPids[0], report.clientPids[1]);

    await run('scoped seed/read is detached and duplicate-safe', async () => {
      const initial = state('scope'); const scope = structuredClone(initial.scope);
      const seeded = a.seed(initial); initial.ownerEpoch = 88; await seeded;
      assert.equal((await b.read(scope)).ownerEpoch, 1);
      await assert.rejects(b.seed(state('scope')), { code: 'SCOPE_EXISTS' });
      const raced = await Promise.allSettled([a.seed(state('seed-race')), b.seed(state('seed-race'))]);
      assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(raced.find(result => result.status === 'rejected').reason.code, 'SCOPE_EXISTS');
      for (const changed of [{ workspaceId: 'other' }, { runId: 'other' }, { taskId: 'other' }]) {
        await assert.rejects(b.read({ ...scope, ...changed }), { code: 'SCOPE_NOT_FOUND' });
      }
      let retained;
      const result = await a.transaction(scope, draft => { retained = draft; draft.ownerEpoch++; return draft; });
      result.ownerEpoch = 89; retained.ownerEpoch = 90;
      const observed = await b.read(scope); assert.equal(observed.ownerEpoch, 2); observed.ownerEpoch = 91;
      assert.equal((await a.read(scope)).ownerEpoch, 2);
      await assert.rejects(new PostgresBrokerStore(poolA, { schema: 'trellis_missing' }).read(scope), { code: 'DATABASE_ERROR' });
      await assert.rejects(a.createSchema(), { code: 'DATABASE_ERROR' });
      assert.equal((await b.read(scope)).ownerEpoch, 2);
    });
    await run('throws, async callbacks, and serialization errors roll back', async () => {
      const initial = state('rollback'); await a.seed(initial);
      const sentinel = new Error('synthetic callback failure');
      await assert.rejects(a.transaction(initial.scope, draft => { draft.ownerEpoch = 2; throw sentinel; }), error => error === sentinel);
      await assert.rejects(a.transaction(initial.scope, async draft => { draft.ownerEpoch = 3; throw new Error('synthetic async rejection'); }), { code: 'ASYNC_TRANSACTION' });
      await assert.rejects(a.transaction(initial.scope, draft => { draft.ownerEpoch = 4; return { then() {} }; }), { code: 'ASYNC_TRANSACTION' });
      for (const change of [s => { s.ownerEpoch = 1n; }, s => { s.extra = s; }, s => { s.ownerEpoch = NaN; },
        s => { s.extra = undefined; }, s => { s.extra = () => {}; }, s => { s.scope.runId = 'changed'; }]) {
        await assert.rejects(a.transaction(initial.scope, draft => { draft.cancelRequested = true; change(draft); }), { code: 'INVALID_STATE' });
      }
      await assert.rejects(a.transaction(initial.scope, draft => { draft.ownerEpoch = 5; return () => {}; }), { code: 'RESULT_NOT_CLONEABLE' });
      await assert.rejects(a.transaction(initial.scope, draft => { draft.ownerEpoch = 5; return new SharedArrayBuffer(8); }), { code: 'RESULT_NOT_CLONEABLE' });
      assert.deepEqual(await b.read(initial.scope), initial);
    });
    await run('two clients serialize updates without lost writes', async () => {
      const initial = state('concurrent'); await a.seed(initial);
      await Promise.all(Array.from({ length: 40 }, (_, n) => (n % 2 ? a : b).transaction(initial.scope, draft => ++draft.ownerEpoch)));
      assert.equal((await b.read(initial.scope)).ownerEpoch, 41);
      report.concurrentIncrements = 40;
    });
    await run('row lock waits for the same scope and permits another scope', async () => {
      const initial = state('locked'); const other = state('not-locked'); await a.seed(initial); await a.seed(other);
      const holder = await poolA.connect(); const started = deferred(); let callbackCalls = 0; let waitingPid;
      const waitingStore = new PostgresBrokerStore(intercept(poolB, (client, sql, args) => {
        if (sql.startsWith('SELECT state_version')) { waitingPid = client.processID; started.resolve(); }
        return client.query(sql, args);
      }), { schema });
      let pending;
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT state FROM ${table} WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 FOR UPDATE`, values(initial.scope));
        pending = waitingStore.transaction(initial.scope, draft => { callbackCalls++; draft.ownerEpoch++; });
        await started.promise;
        let waiting = false;
        for (let n = 0; n < 50; n++) {
          const row = (await poolA.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [waitingPid])).rows[0];
          if (row?.wait_event_type === 'Lock') { waiting = true; break; }
          await pause(10);
        }
        assert.equal(waiting, true); assert.equal(callbackCalls, 0);
        await a.transaction(other.scope, draft => { draft.ownerEpoch++; });
        await holder.query('COMMIT'); await pending;
        assert.equal(callbackCalls, 1); assert.equal((await b.read(initial.scope)).ownerEpoch, 2);
      } finally { await holder.query('ROLLBACK'); holder.release(); await pending; }
    });
    await run('commit acknowledgement precedes resolution and returned state is detached', async () => {
      const initial = state('commit'); await a.seed(initial);
      const atCommit = deferred(); const permitCommit = deferred(); let resolved = false; let retained;
      const heldStore = new PostgresBrokerStore(intercept(poolA, async (client, sql, args) => {
        if (sql === 'COMMIT') { atCommit.resolve(); await permitCommit.promise; }
        return client.query(sql, args);
      }), { schema });
      const pending = heldStore.transaction(initial.scope, draft => { retained = draft; draft.ownerEpoch = 2; return draft; }).then(result => { resolved = true; return result; });
      await atCommit.promise;
      try { assert.equal(resolved, false); assert.equal((await rawState(initial.scope)).ownerEpoch, 1); retained.ownerEpoch = 123; }
      finally { permitCommit.resolve(); }
      assert.equal((await pending).ownerEpoch, 2); assert.equal((await b.read(initial.scope)).ownerEpoch, 2);
    });
    await run('unknown commit is reported once and is never replayed automatically', async () => {
      const initial = state('uncertain'); await a.seed(initial); let callbackCalls = 0; let commitCalls = 0;
      const uncertain = new PostgresBrokerStore(intercept(poolA, async (client, sql, args) => {
        const result = await client.query(sql, args);
        if (sql === 'COMMIT') { commitCalls++; throw new Error('Synthetic lost acknowledgement after real commit'); }
        return result;
      }), { schema });
      await assert.rejects(uncertain.transaction(initial.scope, draft => { callbackCalls++; draft.ownerEpoch++; }), { code: 'COMMIT_UNKNOWN' });
      assert.equal(callbackCalls, 1); assert.equal(commitCalls, 1); assert.equal((await b.read(initial.scope)).ownerEpoch, 2);
      report.uncertainCommit = { injectedAfterRealCommit: true, callbackCalls, commitCalls, durableOwnerEpoch: 2 };
    });
    await run('PostgreSQL serialization failure rolls back without retry', async () => {
      const initial = state('serialize'); await a.seed(initial); let calls = 0;
      await poolA.query(`CREATE FUNCTION "${schema}".reject_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.run_id = 'serialize' THEN RAISE EXCEPTION 'synthetic serialization rejection' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await poolA.query(`CREATE TRIGGER reject_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_update()`);
      try {
        await assert.rejects(a.transaction(initial.scope, draft => { calls++; draft.ownerEpoch = 2; }), { code: 'DATABASE_ERROR' });
        assert.equal(calls, 1); assert.deepEqual(await b.read(initial.scope), initial);
      } finally { await poolA.query(`DROP TRIGGER reject_update ON ${table}`); await poolA.query(`DROP FUNCTION "${schema}".reject_update()`); }
    });
    await run('schema and state versions, checksums, and corrupt records fail closed', async () => {
      const initial = state('corrupt'); await a.seed(initial); const args = values(initial.scope);
      await poolA.query(`UPDATE ${table} SET state_version=999 WHERE run_id='corrupt'`);
      await assert.rejects(a.read(initial.scope), { code: 'UNSUPPORTED_STATE_VERSION' });
      await poolA.query(`UPDATE ${table} SET state_version=1, checksum='bad' WHERE run_id='corrupt'`);
      await assert.rejects(a.read(initial.scope), { code: 'CORRUPT_STATE' });
      for (const corrupt of [s => { s.surprise = true; }, s => { s.cancelRequested = 'false'; },
        s => { s.scope.runId = 'other'; }, s => { s.actions['broken'] = {}; }]) {
        const changed = structuredClone(initial); corrupt(changed); const json = canonicalJson(changed);
        await poolA.query(`UPDATE ${table} SET state=$4::jsonb, checksum=$5 WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3`, [...args, json, digest(json)]);
        let callbacks = 0;
        await assert.rejects(a.transaction(initial.scope, () => { callbacks++; }), { code: 'CORRUPT_STATE' });
        assert.equal(callbacks, 0);
      }
      await poolA.query(`UPDATE ${table} SET state=$4::jsonb, checksum=$5 WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3`, [...args, canonicalJson(initial), digest(canonicalJson(initial))]);
      await poolA.query(`UPDATE "${schema}".store_metadata SET schema_version=999`);
      await assert.rejects(a.read(initial.scope), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
      await assert.rejects(a.seed(state('version-seed')), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
      await poolA.query(`DELETE FROM "${schema}".store_metadata`);
      await assert.rejects(a.read(initial.scope), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
      await poolA.query(`INSERT INTO "${schema}".store_metadata VALUES (true, 1)`);
      assert.deepEqual(await b.read(initial.scope), initial);
    });
    await run('broker approval and synthetic receipt records persist through the adapter', async () => {
      const initial = state('broker'); await a.seed(initial);
      const clock = { now: () => 1000, alarm: () => () => {} };
      const effects = new InMemoryWorkspaceEffects(clock);
      const identity = { async authenticate(subject) { return { subject, proofRef: 'synthetic-proof', expiresAtMs: 1_000_000 }; } };
      const broker = new ActionBroker({ store: a, effects, identity, clock });
      const proposal = { format: 'trellis/action/v0.7-alpha', scope: initial.scope, requestId: 'write-one', candidateRevision: plan.candidateRevision,
        ownerEpoch: 1, edit: { operation: 'workspace.write', path: 'output/job-board/index.html', expectedDigest: null, content: '<p>Synthetic</p>' } };
      const prepared = await broker.prepare(JSON.stringify(proposal), 'agent:coda');
      await broker.approve(initial.scope, 'write-one', { candidateRevision: prepared.proposal.candidateRevision,
        actionDigest: prepared.actionDigest, ownerEpoch: 1, expiresAtMs: 60_000 }, 'founder:reviewer');
      assert.equal((await broker.dispatch(initial.scope, 'write-one', 'agent:coda')).status, 'COMPLETED');
      assert.equal((await b.read(initial.scope)).actions['write-one'].receipt.afterDigest, digest(proposal.edit.content));
    });
    await run('fresh processes retain committed state and discard killed uncommitted state', async () => {
      const initial = state('restart'); await a.seed(initial);
      const start = mode => {
        const child = fork(new URL('./restart-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { PATH: process.env.PATH, HOME: process.env.HOME }, execArgv: [] });
        children.add(child);
        child.once('exit', () => children.delete(child));
        const message = Promise.race([once(child, 'message').then(([message]) => message),
          once(child, 'exit').then(() => { throw new Error('Synthetic process exited before its observation'); })]);
        child.send({ config: { ...config, database }, schema, scope: initial.scope, mode });
        return { child, message };
      };
      const committed = start('commit');
      assert.equal((await committed.message).ownerEpoch, 7);
      const committedExit = once(committed.child, 'exit'); committed.child.kill('SIGKILL'); await committedExit;
      const pending = start('uncommitted'); assert.equal((await pending.message).type, 'uncommitted');
      const pendingExit = once(pending.child, 'exit'); pending.child.kill('SIGKILL'); await pendingExit;
      const fresh = start('read'); const observed = await fresh.message;
      assert.equal(observed.ownerEpoch, 7); assert.notEqual(observed.pid, committed.child.pid);
      await once(fresh.child, 'exit');
      report.restart = { committedOwnerEpoch: 7, uncommittedOwnerEpoch: 99, recoveredOwnerEpoch: observed.ownerEpoch, distinctProcess: true };
    });
    report.databaseBytes = Number((await poolA.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
  } finally {
    for (const child of children) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await poolA.end(); await poolB.end();
    if (created) { await admin.query(`DROP DATABASE "${database}"`); report.databaseRemoved = true; }
    await admin.end();
    report.finishedAt = new Date().toISOString();
    mkdirSync('packages/broker-postgres/.trellis', { recursive: true });
    writeFileSync('packages/broker-postgres/.trellis/test-result.json', JSON.stringify(report, null, 2) + '\n');
  }
});
