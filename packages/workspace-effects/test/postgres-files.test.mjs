import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, realpath, readFile, writeFile, lstat, readdir, rm, link, symlink, unlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { PostgresWorkspaceEffects } from '../../../dist/packages/workspace-effects/src/index.js';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { ActionBroker, createTaskState } from '../../../dist/packages/broker/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { digest } from '../../../dist/packages/contracts/src/index.js';
import { request, signal } from './fixtures.mjs';

const enabled = process.env.TRELLIS_WORKSPACE_PROOF === 'trellis-alpha-proof@127.0.0.1:56582';
const intercept = (pool, handler) => ({ async connect() {
  const client = await pool.connect();
  return { query: (sql, values) => handler(client, sql, values), release: destroy => client.release(destroy) };
} });
const stableFile = async path => {
  const stat = await lstat(path, { bigint: true });
  return { inode: String(stat.ino), modified: String(stat.mtimeNs), content: await readFile(path, 'utf8') };
};
test('real synthetic workspace effects with an isolated PostgreSQL ledger', { skip: !enabled, timeout: 60_000 }, async t => {
  if (!process.env.TRELLIS_WORKSPACE_CREDENTIALS_FILE) throw new Error('Supply the private proof credentials file path.');
  const credentials = JSON.parse(readFileSync(process.env.TRELLIS_WORKSPACE_CREDENTIALS_FILE, 'utf8'));
  if (typeof credentials.POSTGRES_PASSWORD !== 'string' || !credentials.POSTGRES_PASSWORD) throw new Error('Missing proof PostgreSQL credential.');
  const config = { host: '127.0.0.1', port: 56582, user: 'postgres', password: credentials.POSTGRES_PASSWORD,
    ssl: false, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, application_name: 'trellis_workspace_effect_tests' };
  const database = `trellis_effects_test_${randomBytes(8).toString('hex')}`;
  const schema = 'trellis_workspace_test'; const operations = `"${schema}".operations`;
  const admin = new pg.Client({ ...config, database: 'postgres' });
  const pool = new pg.Pool({ ...config, database, max: 3 }); pool.on('error', () => {});
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'trellis-workspace-effects-')));
  const root = join(scratch, 'workspace'); const outside = join(scratch, 'outside');
  await mkdir(root, { mode: 0o700 }); await mkdir(outside, { mode: 0o700 });
  await mkdir(join(root, 'output'), { mode: 0o700 }); await mkdir(join(root, 'output/job-board'), { mode: 0o700 });
  const canary = join(outside, 'canary.txt'); await writeFile(canary, 'outside synthetic canary', { mode: 0o600 });
  const canaryBefore = await stableFile(canary);
  const names = ['result', 'replace', 'negative', 'target-link', 'hard-link', 'abort', 'deadline', 'late-abort', 'late-deadline',
    'concurrent', 'intent', 'published', 'lost-ack', 'corrupt', 'unavailable', 'stale-before', 'backward-clock'];
  const options = { schema, workspaces: [{ workspaceId: 'synthetic-workspace', root,
    writablePaths: [...names.map(name => `output/${name}.txt`), 'output/job-board/index.html'] }] };
  const open = (connection = pool, now = () => 1000) => PostgresWorkspaceEffects.open(connection, { ...options, now });
  const children = new Set(); let created = false;
  const report = { observedAt: new Date().toISOString(), database, schema, tests: [], modelCalls: 0, dockerOperations: 0,
    scope: 'Controller-owned synthetic files only; no hostile same-user directory-swap boundary or atomic database/filesystem transaction.' };
  const run = async (name, check) => t.test(name, async () => {
    const started = performance.now();
    try { await check(); report.tests.push({ name, passed: true, milliseconds: performance.now() - started }); }
    catch (error) { report.tests.push({ name, passed: false, milliseconds: performance.now() - started }); throw error; }
  });
  const child = (mode, value) => {
    const process = fork(new URL('./process-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: globalThis.process.env.PATH, HOME: globalThis.process.env.HOME }, execArgv: [] });
    children.add(process); process.once('exit', () => children.delete(process));
    const exited = once(process, 'exit');
    const message = Promise.race([once(process, 'message').then(([message]) => message),
      exited.then(() => { throw new Error('Synthetic worker exited without an observation'); })]);
    process.send({ config: { ...config, database }, options, request: value, mode });
    return { process, message, exited };
  };
  const absent = path => assert.rejects(lstat(join(root, path)), { code: 'ENOENT' });
  try {
    await admin.connect(); report.serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    const effects = await open(); await effects.createSchema();
    await run('real create, replacement, bound receipts, and completed replay without another write', async () => {
      const value = request('create', 'output/result.txt', 'first synthetic result');
      const applied = await effects.apply(value, signal()); assert.equal(applied.kind, 'applied');
      assert.equal(await readFile(join(root, value.proposal.edit.path), 'utf8'), value.proposal.edit.content);
      assert.deepEqual(await effects.lookup(value), applied.receipt);
      const file = await stableFile(join(root, value.proposal.edit.path));
      const replay = child('apply', value); const observed = await replay.message; await replay.exited;
      assert.deepEqual(observed.result, applied); assert.deepEqual(await stableFile(join(root, value.proposal.edit.path)), file);
      const stopped = new AbortController(); stopped.abort();
      assert.deepEqual(await effects.apply(value, stopped.signal), applied);
      await writeFile(join(root, 'output/replace.txt'), 'old', { mode: 0o600 });
      const replacement = request('replace', 'output/replace.txt', 'new', digest('old'));
      const replaced = await effects.apply(replacement, signal()); assert.equal(replaced.receipt.beforeDigest, digest('old'));
      assert.equal(await readFile(join(root, 'output/replace.txt'), 'utf8'), 'new');
      await writeFile(join(root, 'output/replace.txt'), 'later controller edit');
      const later = await stableFile(join(root, 'output/replace.txt'));
      assert.deepEqual(await (await open()).apply(replacement, signal()), replaced);
      assert.deepEqual(await stableFile(join(root, 'output/replace.txt')), later);
      const changedDeadline = { ...value, deadlineMs: 2500 };
      await assert.rejects(effects.apply(changedDeadline, signal()), { code: 'OPERATION_CONFLICT' });
      const changedContent = structuredClone(value); changedContent.proposal.edit.content = 'forged';
      await assert.rejects(effects.apply(changedContent, signal()), { code: 'INVALID_REQUEST' });
      report.completedReplay = { freshProcess: true, unchangedInodeAndMtime: true, laterControllerEditPreserved: true };
    });
    await run('failed preconditions persist across restart and never turn into a later write', async () => {
      await writeFile(join(root, 'output/negative.txt'), 'not expected', { mode: 0o600 });
      const value = request('negative', 'output/negative.txt', 'must not write', digest('expected'));
      const failed = await effects.apply(value, signal()); assert.equal(failed.kind, 'not-applied');
      await writeFile(join(root, 'output/negative.txt'), 'expected'); const before = await stableFile(join(root, 'output/negative.txt'));
      const replay = child('apply', value); assert.deepEqual((await replay.message).result, failed); await replay.exited;
      assert.deepEqual(await stableFile(join(root, 'output/negative.txt')), before); assert.equal(await effects.lookup(value), null);
    });
    await run('target symlinks and hard links are rejected without changing the outside canary', async () => {
      await symlink(canary, join(root, 'output/target-link.txt'));
      await assert.rejects(effects.apply(request('target-link', 'output/target-link.txt'), signal()), { code: 'UNSAFE_TARGET' });
      await unlink(join(root, 'output/target-link.txt'));
      await link(canary, join(root, 'output/hard-link.txt'));
      await assert.rejects(effects.apply(request('hard-link', 'output/hard-link.txt', 'bad', digest('outside synthetic canary')), signal()), { code: 'UNSAFE_TARGET' });
      await unlink(join(root, 'output/hard-link.txt'));
      assert.deepEqual(await stableFile(canary), canaryBefore);
    });
    await run('parent symlinks and changed directory identity fail before a file write', async () => {
      await rename(join(root, 'output'), join(root, 'saved-output'));
      try {
        await symlink(outside, join(root, 'output'));
        await assert.rejects(effects.apply(request('parent-link', 'output/target-link.txt'), signal()), { code: 'DIRECTORY_CHANGED' });
        await unlink(join(root, 'output'));
        await mkdir(join(root, 'output'), { mode: 0o700 }); await mkdir(join(root, 'output/job-board'), { mode: 0o700 });
        await assert.rejects(effects.apply(request('changed-dir', 'output/target-link.txt'), signal()), { code: 'DIRECTORY_CHANGED' });
        const rebound = await open();
        await assert.rejects(rebound.apply(request('rebound', 'output/target-link.txt'), signal()), { code: 'WORKSPACE_BINDING' });
        assert.deepEqual(await readdir(join(root, 'output')), ['job-board']);
      } finally { await rm(join(root, 'output'), { recursive: true, force: true }); await rename(join(root, 'saved-output'), join(root, 'output')); }
      assert.deepEqual(await stableFile(canary), canaryBefore);
    });
    await run('absolute, escaping, unregistered, and unknown workspace requests do not write', async () => {
      for (const path of [canary, '../outside/canary.txt', 'output/../../outside/canary.txt']) {
        await assert.rejects(effects.apply(request('escape', path), signal()), { code: 'INVALID_REQUEST' });
      }
      await assert.rejects(effects.apply(request('unregistered', 'output/unregistered.txt'), signal()), { code: 'UNREGISTERED_PATH' });
      await assert.rejects(effects.apply(request('unknown', 'output/result.txt', 'bad', null, 'unknown'), signal()), { code: 'UNKNOWN_WORKSPACE' });
      await absent('output/unregistered.txt'); assert.deepEqual(await stableFile(canary), canaryBefore);
    });
    await run('cancellation and deadlines reject before intent or filesystem effects', async () => {
      const stopped = new AbortController(); stopped.abort(); const value = request('abort', 'output/abort.txt');
      await assert.rejects(effects.apply(value, stopped.signal), { code: 'CANCELLED' });
      const deadline = request('deadline', 'output/deadline.txt'); deadline.deadlineMs = 1000;
      await assert.rejects(effects.apply(deadline, signal()), { code: 'DEADLINE_EXPIRED' });
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${operations} WHERE operation_key = ANY($1)`, [[value.operationKey, deadline.operationKey]])).rows[0].n, 0);
      await absent('output/abort.txt'); await absent('output/deadline.txt');
    });
    await run('cancellation after intent leaves a hold without publishing a target', async () => {
      const stopped = new AbortController();
      const late = await open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values); if (sql === 'COMMIT') stopped.abort(); return result;
      }));
      const value = request('late-abort', 'output/late-abort.txt');
      await assert.rejects(late.apply(value, stopped.signal), { code: 'CANCELLED' });
      await absent('output/late-abort.txt'); await assert.rejects(effects.apply(value, signal()), { code: 'RECONCILIATION_REQUIRED' });
      assert.equal(await effects.lookup(value), null);
    });
    await run('deadline after staging prevents publication and removes its own temporary file', async () => {
      let observations = 0; const late = await open(pool, () => ++observations >= 6 ? 2000 : 1000);
      const value = request('late-deadline', 'output/late-deadline.txt');
      await assert.rejects(late.apply(value, signal()), { code: 'DEADLINE_EXPIRED' });
      await absent('output/late-deadline.txt'); assert.equal((await readdir(join(root, 'output'))).some(name => name.startsWith('.trellis-')), false);
      await assert.rejects(effects.apply(value, signal()), { code: 'RECONCILIATION_REQUIRED' });
    });
    await run('changed preconditions after admitted intent cannot overwrite the changed file', async () => {
      await writeFile(join(root, 'output/stale-before.txt'), 'before', { mode: 0o600 }); let commits = 0;
      const changing = await open(intercept(pool, async (client, sql, values) => {
        const result = await client.query(sql, values);
        if (sql === 'COMMIT' && ++commits === 1) await writeFile(join(root, 'output/stale-before.txt'), 'changed by controller');
        return result;
      }));
      const value = request('changed', 'output/stale-before.txt', 'must not write', digest('before'));
      assert.equal((await changing.apply(value, signal())).kind, 'not-applied');
      assert.equal(await readFile(join(root, 'output/stale-before.txt'), 'utf8'), 'changed by controller');
      assert.equal((await effects.apply(value, signal())).kind, 'not-applied');
    });
    await run('a backward completion clock holds the published file instead of storing an invalid receipt', async () => {
      let observations = 0; const backward = await open(pool, () => ++observations >= 7 ? 500 : 1000);
      const value = request('backward-clock', 'output/backward-clock.txt');
      await assert.rejects(backward.apply(value, signal()), { code: 'CLOCK_UNAVAILABLE' });
      assert.equal(await readFile(join(root, value.proposal.edit.path), 'utf8'), value.proposal.edit.content);
      assert.equal(await effects.lookup(value), null);
      await assert.rejects(effects.apply(value, signal()), { code: 'RECONCILIATION_REQUIRED' });
    });
    await run('competing requests admit only one create for a registered file', async () => {
      const first = request('competing-one', 'output/concurrent.txt', 'one'); const second = request('competing-two', 'output/concurrent.txt', 'two');
      const results = await Promise.allSettled([effects.apply(first, signal()), (await open()).apply(second, signal())]);
      assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.kind === 'applied').length, 1);
      for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'FILE_HELD');
      assert.ok(['one', 'two'].includes(await readFile(join(root, 'output/concurrent.txt'), 'utf8')));
    });
    for (const mode of ['intent', 'published']) await run(`process death after ${mode} leaves an unreplayable operation and file hold`, async () => {
      const value = request(`crash-${mode}`, `output/${mode}.txt`, `synthetic ${mode}`);
      const worker = child(mode, value); assert.equal((await worker.message).type, mode);
      worker.process.kill('SIGKILL'); await worker.exited;
      const before = mode === 'published' ? await stableFile(join(root, value.proposal.edit.path)) : null;
      if (mode === 'intent') await absent(value.proposal.edit.path);
      const fresh = child('apply', value); assert.equal((await fresh.message).code, 'RECONCILIATION_REQUIRED'); await fresh.exited;
      assert.equal(await (await open()).lookup(value), null);
      await assert.rejects(effects.apply(request(`different-${mode}`, value.proposal.edit.path), signal()), { code: 'FILE_HELD' });
      if (before) assert.deepEqual(await stableFile(join(root, value.proposal.edit.path)), before);
      else await absent(value.proposal.edit.path);
      report[`${mode}Crash`] = { freshProcessReplayRefused: true, otherOperationHeld: true, targetPresent: before !== null };
    });
    await run('lost terminal commit acknowledgement recovers its persisted receipt without rewriting', async () => {
      const value = request('lost-ack', 'output/lost-ack.txt');
      const failed = child('lost-ack', value); assert.equal((await failed.message).code, 'COMMIT_UNKNOWN'); await failed.exited;
      const before = await stableFile(join(root, value.proposal.edit.path)); const receipt = await effects.lookup(value); assert.ok(receipt);
      const fresh = child('apply', value); assert.deepEqual((await fresh.message).result, { kind: 'applied', receipt }); await fresh.exited;
      assert.deepEqual(await stableFile(join(root, value.proposal.edit.path)), before);
    });
    await run('unavailable ledger, unsupported versions, and corrupt outcomes cannot write', async () => {
      const unavailable = await open({ connect() { throw new Error('Synthetic unavailable ledger'); } });
      await assert.rejects(unavailable.apply(request('unavailable', 'output/unavailable.txt'), signal()), { code: 'STORE_UNAVAILABLE' });
      await absent('output/unavailable.txt');
      const value = request('corrupt', 'output/corrupt.txt'); await effects.apply(value, signal());
      const before = await stableFile(join(root, value.proposal.edit.path));
      const row = (await pool.query(`SELECT * FROM ${operations} WHERE operation_key=$1`, [value.operationKey])).rows[0];
      await pool.query(`UPDATE ${operations} SET state_version=2 WHERE operation_key=$1`, [value.operationKey]);
      await assert.rejects(effects.apply(value, signal()), { code: 'UNSUPPORTED_VERSION' });
      await pool.query(`UPDATE ${operations} SET state_version=1, request_hash='corrupt' WHERE operation_key=$1`, [value.operationKey]);
      await assert.rejects(effects.lookup(value), { code: 'CORRUPT_OPERATION' });
      await pool.query(`UPDATE ${operations} SET request_hash=$2, outcome='{"kind":"applied","receipt":{}}'::jsonb WHERE operation_key=$1`, [value.operationKey, row.request_hash]);
      await assert.rejects(effects.lookup(value), { code: 'CORRUPT_OPERATION' });
      await pool.query(`UPDATE ${operations} SET outcome=$2::jsonb WHERE operation_key=$1`, [value.operationKey, JSON.stringify(row.outcome)]);
      await pool.query(`UPDATE "${schema}".metadata SET schema_version=2`);
      await assert.rejects(effects.apply(value, signal()), { code: 'UNSUPPORTED_VERSION' });
      await pool.query(`UPDATE "${schema}".metadata SET schema_version=1`);
      assert.deepEqual(await stableFile(join(root, value.proposal.edit.path)), before);
    });
    await run('existing broker and PostgreSQL store complete one approved real synthetic write', async () => {
      const store = new PostgresBrokerStore(pool, { schema: 'trellis_effects_broker' }); await store.createSchema();
      const plan = await compileCrew(resolve('examples/endor/crew.yaml'));
      const state = createTaskState(plan, { workspaceId: 'synthetic-workspace', runId: 'broker-run', taskId: 'build', ownerSubject: 'agent:coda', ownerEpoch: 1,
        approverSubjects: ['founder:reviewer'], readyAtMs: 1000, leaseExpiresAtMs: 1_000_000, completedDependencies: ['design'] });
      await store.seed(state);
      const broker = new ActionBroker({ store, effects, clock: { now: () => 1000, alarm: () => () => {} },
        identity: { async authenticate(subject) { return { subject, proofRef: 'synthetic-proof', expiresAtMs: 1_000_000 }; } } });
      const value = request('broker-write', 'output/job-board/index.html', '<p>Real synthetic job board</p>');
      value.proposal.scope = state.scope; value.proposal.candidateRevision = plan.candidateRevision;
      const prepared = await broker.prepare(JSON.stringify(value.proposal), 'agent:coda');
      await broker.approve(state.scope, 'broker-write', { candidateRevision: plan.candidateRevision, actionDigest: prepared.actionDigest, ownerEpoch: 1, expiresAtMs: 60_000 }, 'founder:reviewer');
      const completed = await broker.dispatch(state.scope, 'broker-write', 'agent:coda'); assert.equal(completed.status, 'COMPLETED');
      const before = await stableFile(join(root, 'output/job-board/index.html'));
      assert.equal(before.content, value.proposal.edit.content);
      assert.deepEqual(await broker.dispatch(state.scope, 'broker-write', 'agent:coda'), completed);
      assert.deepEqual(await stableFile(join(root, 'output/job-board/index.html')), before);
    });
    assert.deepEqual(await stableFile(canary), canaryBefore); assert.deepEqual(await readdir(outside), ['canary.txt']);
    report.outsideCanaryUnchanged = true;
    report.terminalCounts = (await pool.query(`SELECT status, count(*)::int AS n FROM ${operations} GROUP BY status ORDER BY status`)).rows;
    report.databaseBytes = Number((await pool.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
  } finally {
    for (const process of children) { const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited; }
    await pool.end();
    if (created) { await admin.query(`DROP DATABASE "${database}"`); report.databaseRemoved = true; }
    await admin.end(); await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true;
    report.finishedAt = new Date().toISOString();
    mkdirSync('packages/workspace-effects/.trellis', { recursive: true });
    writeFileSync('packages/workspace-effects/.trellis/test-result.json', JSON.stringify(report, null, 2) + '\n');
  }
});
