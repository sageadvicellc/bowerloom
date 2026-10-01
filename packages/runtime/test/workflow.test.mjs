import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, realpath, rm, readFile, stat } from 'node:fs/promises';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { RuntimeLedger } from '../../../dist/packages/runtime/src/index.js';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { PostgresWorkspaceEffects } from '../../../dist/packages/workspace-effects/src/index.js';
import { PostgresAdmission } from '../../../dist/packages/admission/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
const enabled = process.env.TRELLIS_RUNTIME_PROOF === 'trellis-alpha-proof@127.0.0.1:56582';
const enabledOptions = { skip: !enabled, timeout: 120000 };
test('synthetic supervised workflows with real DBOS and isolated PostgreSQL databases', enabledOptions, async t => {
  if (!process.env.TRELLIS_RUNTIME_CREDENTIALS_FILE) throw new Error('Supply the private proof credentials path.');
  const { POSTGRES_PASSWORD: password } = JSON.parse(readFileSync(process.env.TRELLIS_RUNTIME_CREDENTIALS_FILE, 'utf8'));
  if (!password) throw new Error('Missing local proof credential.');
  const config = { host: '127.0.0.1', port: 56582, user: 'postgres', password, ssl: false, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 500, application_name: 'trellis_runtime_test' };
  const plan = await compileCrew(resolve('examples/endor/crew.yaml'));
  const report = { observedAt: new Date().toISOString(), dbosVersion: '5.2.11', modelCalls: 0, dockerOperations: 0, cases: [],
    limits: ['Synthetic process protocol only; not live Codex containment.', 'Foreign launchers remain held; no PID-based takeover or OS fencing.', 'Provider accounting coverage remains unknown.'] };
  const run = async (name, check) => t.test(name, async () => {
    const started = performance.now(); const database = `trellis_runtime_test_${randomBytes(8).toString('hex')}`;
    const admin = new pg.Client({ ...config, database: 'postgres' }); const pool = new pg.Pool({ ...config, database, max: 5 }); pool.on('error', () => {});
    const root = await realpath(await mkdtemp(join(tmpdir(), 'trellis-runtime-')));
    await mkdir(join(root,'output'), { mode: 0o700 }); await mkdir(join(root,'output/job-board'), { mode: 0o700 });
    const schemas = { runtime: 'trellis_runtime', admission: 'trellis_admission', broker: 'trellis_broker', effects: 'trellis_effects' };
    const accountId = 'synthetic-account'; const resetAtMs = Date.now() + 999000;
    const uri = new URL('postgresql://127.0.0.1:56582'); uri.username = 'postgres'; uri.password = password; uri.pathname = `/${database}`;
    const options = { installationId: 'synthetic-installation', schema: schemas.runtime, admissionSchema: schemas.admission, systemDatabaseUrl: uri.href };
    const children = new Set(); const shutdown = new Map(); const caseResult = { name, database, passed: false }; let created = false;
    const spawnCoordinator = (mode = 'normal', usedPercent = 20) => {
      const child = fork(new URL('./coordinator-worker.mjs', import.meta.url), [], { stdio: ['ignore','ignore','ignore','ipc'], env: { PATH: process.env.PATH }, execArgv: [] });
      children.add(child); child.once('exit', () => children.delete(child)); const exited = once(child,'exit');
      const messages = []; const pending = new Map(); let calls = 0;
      child.on('message', message => {
        messages.push(message); if (message.type === 'reply') { const handler = pending.get(message.call); if (handler) { pending.delete(message.call); handler(message); } }
      });
      child.send({ config: { ...config, database, application_name: 'trellis_runtime_coordinator' }, options, root, schemas, resetAtMs, accountId, usedPercent, mode });
      const next = async (type, match = () => true) => {
        for (let attempt = 0; attempt < 500; attempt++) {
          const found = messages.find(value => value.type === type && match(value)); if (found) return found;
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Coordinator exited before ${type}`);
          await delay(10);
        }
        throw new Error(`Coordinator did not report ${type}`);
      };
      const rpc = async (type, args = {}) => {
        const call = ++calls; let timer;
        const result = await new Promise((resolve, reject) => {
          pending.set(call, reply => { clearTimeout(timer); resolve(reply); });
          timer = setTimeout(() => { pending.delete(call); reject(new Error(`Timed out waiting for ${type}`)); }, 10000);
          child.send({ type, call, ...args });
        });
        if (result.error) { const error = new Error(result.error); error.code = result.error; throw error; } return result.result;
      };
      shutdown.set(child, async () => { await rpc('stop'); await exited; });
      return { child, exited, next, rpc, messages, async stop() { await rpc('stop'); await exited; }, async kill() { child.kill('SIGKILL'); await exited; } };
    };
    const input = (mode = 'normal') => {
      const now = Date.now(); const task = { workspaceId: 'synthetic-workspace', runId: 'run', taskId: 'build', ownerSubject: 'agent:coda',
        ownerEpoch: 1, approverSubjects: ['founder:reviewer'], readyAtMs: now, leaseExpiresAtMs: now + 120000, completedDependencies: ['design'] };
      const proposal = { format: 'trellis/action/v0.7-alpha', scope: { workspaceId: task.workspaceId, runId: task.runId, taskId: task.taskId }, requestId: 'write',
        candidateRevision: plan.candidateRevision, ownerEpoch: 1, edit: { operation: 'workspace.write', path: 'output/job-board/index.html', expectedDigest: null, content: '<p>Synthetic supervised job board</p>' } };
      return { plan, task, taskInput: JSON.stringify({ mode, proposal }), reservation: { accountAlias: 'synthetic-alias', jobId: 'model-job',
        candidateRevision: plan.candidateRevision, modelRoute: 'codex-test', role: 'worker', attempt: 'initial', allowancePercent: { primary: 5 }, paidFallback: false } };
    };
    const waitState = async (coordinator, id, predicate) => {
      let value;
      for (let attempt = 0; attempt < 500; attempt++) { value = await coordinator.rpc('status',{ id }); if (predicate(value)) return value; await delay(10); }
      throw new Error(`Unexpected run state ${value?.run.status}: ${value?.run.reason}`);
    };
    const approval = state => ({ candidateRevision: state.run.proposal.candidateRevision, actionDigest: digest(canonicalJson(state.run.proposal)), ownerEpoch: 1, expiresAtMs: Date.now() + 30000 });
    const file = join(root,'output/job-board/index.html');
    const snapshot = async () => { const value = await stat(file, { bigint: true }); return { inode: String(value.ino), modified: String(value.mtimeNs), content: await readFile(file,'utf8') }; };
    try {
      await admin.connect(); await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
      await new RuntimeLedger(pool, schemas.runtime).createSchema(); await new PostgresBrokerStore(pool, { schema: schemas.broker }).createSchema();
      await (await PostgresWorkspaceEffects.open(pool, { schema: schemas.effects, workspaces: [{ workspaceId: 'synthetic-workspace', root, writablePaths: ['output/job-board/index.html'] }] })).createSchema();
      await new PostgresAdmission(pool, { schema: schemas.admission, launcherId: 'provision-only' }).createSchema([{ accountId, aliases: ['synthetic-alias'],
        policy: { thresholdPercent: 75, maxWorkers: 2, headroomPercent: 5, maxObservationAgeMs: 5000, admittedRoutes: ['codex-test'], completedResetPolicy: 'hold' } }]);
      await pool.query('CREATE TABLE runtime_test_starts (process_ref text PRIMARY KEY)');
      await check({ spawnCoordinator, input, waitState, approval, snapshot, file, pool, root, caseResult });
      caseResult.starts = (await pool.query('SELECT count(*)::int AS n FROM runtime_test_starts')).rows[0].n;
      assert.equal(caseResult.starts, caseResult.expectedStarts ?? 1);
      caseResult.databaseBytes = Number((await pool.query('SELECT pg_database_size(current_database()) AS n')).rows[0].n); caseResult.passed = true;
    } finally {
      const errors = [];
      for (const child of [...children]) {
        try { await shutdown.get(child)(); }
        catch {
          try { const exited = once(child,'exit'); child.kill('SIGKILL'); await exited; } catch { errors.push('coordinator'); }
        }
      }
      try { await pool.end(); } catch { errors.push('pool'); }
      if (created) try { await admin.query(`DROP DATABASE "${database}"`); caseResult.databaseRemoved = true; } catch { errors.push('database'); }
      try { await admin.end(); } catch { errors.push('admin'); }
      try { await rm(root, { recursive: true, force: true }); caseResult.scratchRemoved = true; } catch { errors.push('scratch'); }
      caseResult.childrenReaped = children.size === 0; caseResult.cleanupErrors = errors; caseResult.milliseconds = performance.now() - started;
      report.cases.push(caseResult); mkdirSync('packages/runtime/.trellis',{ recursive:true });
      report.passed = report.cases.length === 11 && report.cases.every(value => value.passed && value.databaseRemoved && value.scratchRemoved && value.childrenReaped && !value.cleanupErrors.length);
      writeFileSync('packages/runtime/.trellis/test-result.json',JSON.stringify(report,null,2)+'\n');
      if (errors.length) throw new Error('Synthetic runtime cleanup failed.');
    }
  });
  await run('one coordinator; pending approval and completed receipt survive real DBOS restart', async ({ spawnCoordinator, input, waitState, approval, snapshot, file, caseResult }) => {
    const first = spawnCoordinator(); const ready = await first.next('ready'); const value = input(); const id = await first.rpc('submit',{ input:value });
    const pending = await waitState(first,id,value => value.run.status === 'WAITING_APPROVAL');
    assert.equal(pending.reservation.status,'COMPLETED'); assert.equal(pending.allowanceHeld,true);
    await assert.rejects(stat(file),{code:'ENOENT'});
    const second = spawnCoordinator(); assert.equal((await second.next('startup-error')).code,'COORDINATOR_EXISTS'); await second.exited;
    const changed = structuredClone(value); changed.taskInput += ' '; await assert.rejects(first.rpc('submit',{input:changed}),{code:'RUN_CONFLICT'});
    await assert.rejects(first.rpc('approve',{id,approval:{...approval(pending),candidateRevision:digest('stale')},credential:'founder'}),{code:'STALE_APPROVAL'});
    await assert.rejects(first.rpc('approve',{id,approval:approval(pending),credential:'worker'}),{code:'UNAUTHENTICATED'});
    await first.kill(); const restarted = spawnCoordinator(); const nextReady = await restarted.next('ready'); assert.notEqual(nextReady.launcherId,ready.launcherId);
    const recovered = await waitState(restarted,id,value => value.run.status === 'WAITING_APPROVAL'); assert.deepEqual(recovered.run.proposal,pending.run.proposal);
    await restarted.rpc('approve',{id,approval:approval(recovered),credential:'founder'});
    const completed = await waitState(restarted,id,value => value.run.status === 'COMPLETED'); const before = await snapshot();
    assert.equal(completed.allowanceHeld,true); await restarted.kill();
    const third = spawnCoordinator(); await third.next('ready'); assert.equal(await third.rpc('submit',{input:value}),id);
    assert.deepEqual((await third.rpc('status',{id})).run.receipt,completed.run.receipt); assert.deepEqual(await snapshot(),before);
    await third.stop(); caseResult.uniqueLifetime = true; caseResult.pendingRecovered = true; caseResult.receiptReplayedWithoutWrite = true;
  });
  for (const checkpoint of ['proposal','effect','receipt']) await run(`DBOS recovery after committed ${checkpoint} but before step acknowledgement`, async ({ spawnCoordinator, input, waitState, approval, snapshot, caseResult }) => {
    const first = spawnCoordinator(`crash-${checkpoint}`); await first.next('ready'); const id = await first.rpc('submit',{input:input()});
    if (checkpoint !== 'proposal') { const pending = await waitState(first,id,value => value.run.status === 'WAITING_APPROVAL'); await first.rpc('approve',{id,approval:approval(pending),credential:'founder'}); }
    await first.next('checkpoint',value => value.checkpoint === checkpoint); const before = checkpoint === 'proposal' ? null : await snapshot(); await first.kill();
    const restarted = spawnCoordinator(); await restarted.next('ready');
    if (checkpoint === 'proposal') { const pending = await waitState(restarted,id,value => value.run.status === 'WAITING_APPROVAL'); await restarted.rpc('approve',{id,approval:approval(pending),credential:'founder'}); }
    const completed = await waitState(restarted,id,value => value.run.status === 'COMPLETED'); assert.ok(completed.run.receipt);
    if (before) assert.deepEqual(await snapshot(),before); await restarted.stop(); caseResult.recoveredWithoutRepeatedProcess = true;
  });
  await run('uncertain foreign launch is held through restart without a child or refund', async ({spawnCoordinator,input,waitState,caseResult}) => {
    const first=spawnCoordinator('crash-claim'); await first.next('ready'); const id=await first.rpc('submit',{input:input()});
    await first.next('checkpoint',value=>value.checkpoint==='claim'); await first.kill();
    const next=spawnCoordinator(); await next.next('ready'); const held=await waitState(next,id,value=>value.run.status==='HOLD');
    assert.equal(held.run.reason,'FOREIGN_LAUNCHER_RECONCILIATION_REQUIRED'); assert.equal(held.reservation.status,'LAUNCHING'); assert.equal(held.allowanceHeld,true);
    await next.stop(); caseResult.foreignClaimHeld=true; caseResult.expectedStarts=0;
  });
  await run('cancellation kills and reaps an owned synthetic process group while retaining used allowance', async ({spawnCoordinator,input,waitState,file,caseResult}) => {
    const worker=spawnCoordinator(); await worker.next('ready'); const id=await worker.rpc('submit',{input:input('group')});
    const running=await waitState(worker,id,value=>value.reservation?.status==='RUNNING');
    let members=[];
    for(let attempt=0;attempt<100;attempt++) {
      members=execFileSync('/bin/ps',['-o','pid=','-g',String(running.run.process.groupId)],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
      if(members.length>=2) break;
      await delay(10);
    }
    assert.equal(members.length,2); caseResult.observedGroupMembers=members.length;
    await worker.rpc('cancel',{id});
    const cancelled=await waitState(worker,id,value=>value.run.status==='CANCELLED' && value.reservation?.status==='COMPLETED');
    assert.equal(cancelled.allowanceHeld,true); assert.throws(()=>process.kill(-running.run.process.groupId,0),{code:'ESRCH'});
    await assert.rejects(stat(file),{code:'ENOENT'}); await worker.stop(); caseResult.ownedGroupAbsent=true;
  });
  await run('lock connection loss refuses launches and terminates an owned child', async ({spawnCoordinator,input,waitState,pool,file,caseResult}) => {
    const worker=spawnCoordinator(); await worker.next('ready'); const value=input('hang'); const id=await worker.rpc('submit',{input:value});
    const running=await waitState(worker,id,value=>value.reservation?.status==='RUNNING');
    const locks=(await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objsubid=2 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rows;
    assert.equal(locks.length,1); await pool.query('SELECT pg_terminate_backend($1)',[locks[0].pid]);
    await waitState(worker,id,value=>value.run.status==='HOLD');
    await assert.rejects(worker.rpc('submit',{input:value}),{code:'COORDINATOR_FENCED'});
    assert.throws(()=>process.kill(-running.run.process.groupId,0),{code:'ESRCH'}); await assert.rejects(stat(file),{code:'ENOENT'});
    await worker.stop(); caseResult.lockLossFenced=true;
  });
  await run('refused subscription admission never creates a process', async ({spawnCoordinator,input,waitState,file,caseResult}) => {
    caseResult.expectedStarts=0;
    const worker=spawnCoordinator('normal',75); await worker.next('ready'); const id=await worker.rpc('submit',{input:input()});
    const held=await waitState(worker,id,value=>value.run.status==='HOLD'); assert.equal(held.run.reason,'ADMISSION_CAPACITY_LIMIT'); assert.equal(held.reservation,null);
    await assert.rejects(stat(file),{code:'ENOENT'}); await worker.stop();
  });
  await run('pending approval cancellation persists and cannot dispatch after restart', async ({spawnCoordinator,input,waitState,approval,file}) => {
    const worker=spawnCoordinator(); await worker.next('ready'); const value=input(); const id=await worker.rpc('submit',{input:value});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL'); await worker.rpc('cancel',{id});
    await assert.rejects(worker.rpc('approve',{id,approval:approval(pending),credential:'founder'}),{code:'CANCELLED'});
    await worker.kill(); const next=spawnCoordinator(); await next.next('ready');
    const cancelled=await waitState(next,id,value=>value.run.status==='CANCELLED'); assert.equal(cancelled.allowanceHeld,true);
    assert.equal(await next.rpc('submit',{input:value}),id); await assert.rejects(stat(file),{code:'ENOENT'}); await next.stop();
  });
  await run('uncertain filesystem intent stays held and never becomes a replayed write', async ({spawnCoordinator,input,waitState,approval,file,pool}) => {
    const worker=spawnCoordinator('uncertain-effect'); await worker.next('ready'); const value=input(); const id=await worker.rpc('submit',{input:value});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL'); await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const held=await waitState(worker,id,value=>value.run.status==='HOLD'); assert.equal(held.run.reason,'EFFECT_RECONCILIATION_REQUIRED'); assert.equal(held.run.receipt,null);
    assert.equal((await pool.query('SELECT status FROM trellis_effects.operations')).rows[0].status,'INTENT');
    await assert.rejects(stat(file),{code:'ENOENT'}); await worker.kill();
    const next=spawnCoordinator(); await next.next('ready'); await next.rpc('submit',{input:value});
    assert.equal((await next.rpc('status',{id})).run.status,'HOLD'); await assert.rejects(stat(file),{code:'ENOENT'}); await next.stop();
  });
  await run('lost receipt acknowledgement keeps the durable receipt and does not repeat the write', async ({spawnCoordinator,input,waitState,approval,snapshot}) => {
    const worker=spawnCoordinator('lost-receipt-ack'); await worker.next('ready'); const id=await worker.rpc('submit',{input:input()});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL'); await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const held=await waitState(worker,id,value=>value.run.status==='HOLD'); assert.ok(held.run.receipt); assert.equal(held.run.reason,'COMMIT_UNKNOWN');
    const before=await snapshot(); await worker.kill(); const next=spawnCoordinator(); await next.next('ready');
    assert.deepEqual((await next.rpc('status',{id})).run.receipt,held.run.receipt); assert.deepEqual(await snapshot(),before); await next.stop();
  });
});
