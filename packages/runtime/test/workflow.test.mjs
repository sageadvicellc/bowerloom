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
    await mkdir(join(root,'output/design'), { mode: 0o700 });
    const schemas = { runtime: 'trellis_runtime', admission: 'trellis_admission', broker: 'trellis_broker', effects: 'trellis_effects' };
    const accountId = 'synthetic-account'; const resetAtMs = Date.now() + 999000;
    const uri = new URL('postgresql://127.0.0.1:56582'); uri.username = 'postgres'; uri.password = password; uri.pathname = `/${database}`;
    const options = { installationId: 'synthetic-installation', schema: schemas.runtime, admissionSchema: schemas.admission, systemDatabaseUrl: uri.href };
    const children = new Set(); const shutdown = new Map(); const caseResult = { name, database, passed: false }; let created = false;
    const spawnCoordinator = (mode = 'normal', usedPercent = 20, ownerMode = 'fallback') => {
      const child = fork(new URL('./coordinator-worker.mjs', import.meta.url), [], { stdio: ['ignore','ignore','ignore','ipc'], env: { PATH: process.env.PATH }, execArgv: [] });
      children.add(child); child.once('exit', () => children.delete(child)); const exited = once(child,'exit');
      const messages = []; const pending = new Map(); let calls = 0;
      child.on('message', message => {
        messages.push(message); if (message.type === 'reply') { const handler = pending.get(message.call); if (handler) { pending.delete(message.call); handler(message); } }
      });
      child.send({ config: { ...config, database, application_name: 'trellis_runtime_coordinator' }, options, root, schemas, resetAtMs, accountId, usedPercent, mode, ownerMode });
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
    const input = (mode = 'normal', taskId = 'build') => {
      const definition = plan.definition.tasks.find(task => task.id === taskId);
      const now = Date.now(); const task = { workspaceId: 'synthetic-workspace', runId: 'run', taskId, ownerSubject: `agent:${definition.owner}`,
        ownerEpoch: 1, approverSubjects: ['founder:reviewer'], readyAtMs: now, leaseExpiresAtMs: now + 120000, completedDependencies: [...definition.dependsOn] };
      const proposal = { format: 'trellis/action/v0.7-alpha', scope: { workspaceId: task.workspaceId, runId: task.runId, taskId: task.taskId }, requestId: 'write',
        candidateRevision: plan.candidateRevision, ownerEpoch: 1, edit: { operation: 'workspace.write', path: taskId === 'design' ? 'output/design/brief.md' : 'output/job-board/index.html', expectedDigest: null,
          content: taskId === 'design' ? 'Synthetic craft-shop design brief.' : '<p>Synthetic supervised job board</p>' } };
      return { plan, task, taskInput: JSON.stringify({ mode, proposal }), reservation: { accountAlias: 'synthetic-alias', jobId: 'model-job',
        candidateRevision: plan.candidateRevision, modelRoute: 'codex-test', role: 'worker', attempt: 'initial', allowancePercent: { primary: 5 }, paidFallback: false,
        ...(taskId === 'build' ? {} : { jobId: `model-job-${taskId}` }) } };
    };
    const waitState = async (coordinator, id, predicate) => {
      let value;
      for (let attempt = 0; attempt < 500; attempt++) { value = await coordinator.rpc('status',{ id }); if (predicate(value)) return value; await delay(10); }
      throw new Error(`Unexpected run state ${value?.run.status}: ${value?.run.reason}`);
    };
    const approval = state => ({ candidateRevision: state.run.proposal.candidateRevision, actionDigest: digest(canonicalJson(state.run.proposal)), ownerEpoch: 1, expiresAtMs: Date.now() + 30000 });
    const file = join(root,'output/job-board/index.html');
    const designFile = join(root,'output/design/brief.md');
    const snapshot = async (path = file) => { const value = await stat(path, { bigint: true }); return { inode: String(value.ino), modified: String(value.mtimeNs), content: await readFile(path,'utf8') }; };
    try {
      await admin.connect(); await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
      await new RuntimeLedger(pool, schemas.runtime).createSchema(); await new PostgresBrokerStore(pool, { schema: schemas.broker }).createSchema();
      await (await PostgresWorkspaceEffects.open(pool, { schema: schemas.effects, workspaces: [{ workspaceId: 'synthetic-workspace', root, writablePaths: ['output/job-board/index.html','output/design/brief.md'] }] })).createSchema();
      await new PostgresAdmission(pool, { schema: schemas.admission, launcherId: 'provision-only' }).createSchema([{ accountId, aliases: ['synthetic-alias'],
        policy: { thresholdPercent: 75, maxWorkers: 2, headroomPercent: 5, maxObservationAgeMs: 5000, admittedRoutes: ['codex-test'], completedResetPolicy: 'hold' } }]);
      await pool.query('CREATE TABLE runtime_test_starts (process_ref text PRIMARY KEY)');
      await check({ spawnCoordinator, input, waitState, approval, snapshot, file, designFile, pool, root, caseResult });
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
      report.passed = report.cases.length === 23 && report.cases.every(value => value.passed && value.databaseRemoved && value.scratchRemoved && value.childrenReaped && !value.cleanupErrors.length);
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
    const fallback = await restarted.rpc('owner-audit'); assert.deepEqual(fallback.inputs,[]);
    assert.ok(fallback.authenticatedSubjects.includes('agent:coda')); assert.ok(fallback.authenticatedSubjects.includes('founder:reviewer'));
    assert.equal(completed.allowanceHeld,true); await restarted.kill();
    const third = spawnCoordinator(); await third.next('ready'); assert.equal(await third.rpc('submit',{input:value}),id);
    assert.deepEqual((await third.rpc('status',{id})).run.receipt,completed.run.receipt); assert.deepEqual(await snapshot(),before);
    await third.stop(); caseResult.uniqueLifetime = true; caseResult.pendingRecovered = true; caseResult.receiptReplayedWithoutWrite = true; caseResult.fallbackOwnerCompatible = true;
  });
  await run('per-task owner credentials prepare both owners and dispatch after DBOS restart', async ({spawnCoordinator,input,waitState,approval,snapshot,file,designFile,pool,caseResult}) => {
    caseResult.expectedStarts = 2;
    const first = spawnCoordinator('normal',20,'per-task'); await first.next('ready');
    const inputs = [input('normal','design'),input()]; const ids = [];
    for (const value of inputs) {
      const id = await first.rpc('submit',{input:value}); ids.push(id);
      const pending = await waitState(first,id,state=>state.run.status==='WAITING_APPROVAL');
      assert.deepEqual(pending.run.input,value); assert.equal(pending.reservation.status,'COMPLETED');
      await assert.rejects(first.rpc('approve',{id,approval:approval(pending),credential:value.task.ownerSubject==='agent:emery'?'owner-emery':'owner'}),{code:'FORBIDDEN'});
    }
    const beforeAudit = await first.rpc('owner-audit');
    assert.deepEqual(beforeAudit.inputs.map(value=>value.task.ownerSubject),['agent:emery','agent:coda']);
    await assert.rejects(stat(file),{code:'ENOENT'}); await assert.rejects(stat(designFile),{code:'ENOENT'});
    await first.kill();
    const restarted = spawnCoordinator('normal',20,'per-task'); await restarted.next('ready');
    for (let i=0;i<ids.length;i++) {
      const pending = await waitState(restarted,ids[i],state=>state.run.status==='WAITING_APPROVAL');
      await restarted.rpc('approve',{id:ids[i],approval:approval(pending),credential:'founder'});
      const completed = await waitState(restarted,ids[i],state=>state.run.status==='COMPLETED');
      assert.deepEqual(completed.run.input,inputs[i]); assert.equal(completed.run.receipt.path,JSON.parse(inputs[i].taskInput).proposal.edit.path);
      const grant = await new PostgresBrokerStore(pool,{schema:'trellis_broker'}).read(completed.run.proposal.scope);
      assert.equal(grant.ownerSubject,inputs[i].task.ownerSubject); assert.equal(grant.actions.write.status,'COMPLETED');
      assert.equal(grant.actions.write.approval.subject,'founder:reviewer');
    }
    const audit = await restarted.rpc('owner-audit');
    for (const value of inputs) {
      assert.equal(audit.inputs.filter(entry=>entry.task.ownerSubject===value.task.ownerSubject).length,3);
      assert.equal(audit.authenticatedSubjects.filter(subject=>subject===value.task.ownerSubject).length,2);
    }
    const filesBefore = [await snapshot(designFile),await snapshot()]; await restarted.kill();
    const final = spawnCoordinator('normal',20,'per-task'); await final.next('ready');
    for (let i=0;i<ids.length;i++) assert.equal(await final.rpc('submit',{input:inputs[i]}),ids[i]);
    assert.deepEqual([await snapshot(designFile),await snapshot()],filesBefore);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,2);
    await final.stop(); caseResult.distinctOwnersRecovered = true; caseResult.approverSeparated = true; caseResult.noRepeatedEffects = true;
  });
  await run('ledger policy and durable input resist caller and resolver mutation', async ({spawnCoordinator,input,waitState,approval,pool,caseResult}) => {
    const worker = spawnCoordinator('normal',20,'mutate'); await worker.next('ready');
    const account = (await pool.query('SELECT state,checksum FROM trellis_admission.accounts')).rows[0];
    const policies = await worker.rpc('mutate-policy-result',{accountAlias:'synthetic-alias'});
    assert.deepEqual(policies.before,account.state.policy); assert.deepEqual(policies.after,account.state.policy);
    assert.deepEqual((await pool.query('SELECT state,checksum FROM trellis_admission.accounts')).rows[0],account);
    await assert.rejects(worker.rpc('admission-policy',{accountAlias:'not-registered'}),{code:'UNKNOWN_ACCOUNT'});
    // A controller update in this isolated database must be observed, rather than a hard-coded default or cache.
    const changed = structuredClone(account.state); changed.policy.thresholdPercent = 68; changed.policy.headroomPercent = 7;
    await pool.query('UPDATE trellis_admission.accounts SET state=$1::jsonb,checksum=$2',[canonicalJson(changed),digest(canonicalJson(changed))]);
    assert.deepEqual(await worker.rpc('admission-policy',{accountAlias:'synthetic-alias'}),changed.policy);
    const value = input(); const original = structuredClone(value);
    const id = await worker.rpc('submit',{input:value,mutateAfterSubmit:true});
    const pending = await waitState(worker,id,state=>state.run.status==='WAITING_APPROVAL');
    assert.deepEqual(pending.run.input,original); assert.equal(pending.run.inputDigest,digest(canonicalJson(original)));
    assert.deepEqual((await worker.rpc('mutate-status-input',{id})).run.input,original);
    const stored = (await pool.query('SELECT state FROM trellis_runtime.runs WHERE id=$1',[id])).rows[0].state;
    assert.deepEqual(stored.input,original); assert.equal(stored.inputDigest,digest(canonicalJson(original)));
    await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const completed = await waitState(worker,id,state=>state.run.status==='COMPLETED'); assert.deepEqual(completed.run.input,original);
    const audit = await worker.rpc('owner-audit'); assert.equal(audit.inputs.length,4);
    for (const observed of audit.inputs) assert.deepEqual(observed,original);
    assert.equal(await worker.rpc('submit',{input:original}),id); await worker.stop();
    caseResult.policyReadFromLedger = true; caseResult.sameProcessMutationIsolated = true;
  });
  await run('wrong per-task resolver identity cannot prepare an action', async ({spawnCoordinator,input,waitState,file,pool,caseResult}) => {
    const worker = spawnCoordinator('normal',20,'wrong'); await worker.next('ready'); const value = input();
    const id = await worker.rpc('submit',{input:value}); const held = await waitState(worker,id,state=>state.run.status==='HOLD');
    assert.equal(held.run.reason,'FORBIDDEN'); assert.equal(held.run.receipt,null); assert.equal(held.reservation.status,'COMPLETED');
    const audit = await worker.rpc('owner-audit'); assert.deepEqual(audit.authenticatedSubjects,['agent:outsider']);
    const grant = await new PostgresBrokerStore(pool,{schema:'trellis_broker'}).read(held.run.proposal.scope);
    assert.equal(grant.ownerSubject,value.task.ownerSubject); assert.deepEqual(grant.actions,{});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,0);
    await assert.rejects(stat(file),{code:'ENOENT'}); await worker.stop(); caseResult.wrongOwnerPrepareDenied = true;
  });
  await run('wrong resolver after restart cannot dispatch a founder-approved action', async ({spawnCoordinator,input,waitState,approval,file,pool,caseResult}) => {
    const first = spawnCoordinator('normal',20,'per-task'); await first.next('ready'); const value = input();
    const id = await first.rpc('submit',{input:value}); await waitState(first,id,state=>state.run.status==='WAITING_APPROVAL'); await first.kill();
    const next = spawnCoordinator('normal',20,'wrong'); await next.next('ready');
    const pending = await waitState(next,id,state=>state.run.status==='WAITING_APPROVAL');
    await next.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const held = await waitState(next,id,state=>state.run.status==='HOLD');
    assert.equal(held.run.reason,'FOREIGN_LAUNCHER_RECONCILIATION_REQUIRED'); assert.equal(held.run.receipt,null);
    const audit = await next.rpc('owner-audit'); assert.deepEqual(audit.authenticatedSubjects,['founder:reviewer','agent:outsider']);
    const grant = await new PostgresBrokerStore(pool,{schema:'trellis_broker'}).read(pending.run.proposal.scope);
    assert.equal(grant.actions.write.status,'PREPARED'); assert.equal(grant.actions.write.approval.subject,'founder:reviewer');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,0);
    await assert.rejects(stat(file),{code:'ENOENT'}); await next.stop(); caseResult.wrongOwnerDispatchDenied = true;
  });
  for (const resolver of ['promise-reject-immediate','promise-reject-delayed','promise-resolved']) {
    await run(`${resolver} is refused before authentication and the same coordinator completes another task`, async ({spawnCoordinator,input,waitState,approval,file,designFile,pool,caseResult}) => {
      caseResult.expectedStarts = 2;
      const worker = spawnCoordinator('normal',20,resolver); const ready = await worker.next('ready');
      const failedInput = input(); const id = await worker.rpc('submit',{input:failedInput});
      await worker.next('owner-promise-settled',value=>value.mode===resolver);
      // Give the delayed rejection and Node's unhandled-rejection turn time to occur.
      await delay(100);
      assert.equal(worker.child.exitCode,null); assert.equal(worker.child.signalCode,null);
      const held = await waitState(worker,id,state=>state.run.status==='HOLD');
      assert.equal(held.run.reason,'ASYNC_OWNER_RESOLVER_UNSUPPORTED'); assert.equal(held.run.receipt,null);
      assert.equal(held.run.acceptance,null); assert.equal(held.reservation.status,'COMPLETED'); assert.equal(held.allowanceHeld,true);
      assert.equal(held.reservation.retained.primary.percent,5);
      assert.equal((await worker.rpc('workflow-result',{id})).reason,'ASYNC_OWNER_RESOLVER_UNSUPPORTED');
      const failedAudit = await worker.rpc('owner-audit'); assert.equal(failedAudit.inputs.length,1);
      assert.equal(failedAudit.authenticationAttempts,0); assert.deepEqual(failedAudit.authenticatedSubjects,[]);
      const store = new PostgresBrokerStore(pool,{schema:'trellis_broker'});
      const failedGrant = await store.read(held.run.proposal.scope); assert.deepEqual(failedGrant.actions,{});
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,0);
      await assert.rejects(stat(file),{code:'ENOENT'}); await assert.rejects(stat(designFile),{code:'ENOENT'});

      const healthyInput = input('normal','design'); const healthyId = await worker.rpc('submit',{input:healthyInput}); assert.notEqual(healthyId,id);
      const pending = await waitState(worker,healthyId,state=>state.run.status==='WAITING_APPROVAL');
      await worker.rpc('approve',{id:healthyId,approval:approval(pending),credential:'founder'});
      const completed = await waitState(worker,healthyId,state=>state.run.status==='COMPLETED');
      assert.equal(completed.run.process.launcherId,ready.launcherId); assert.deepEqual(completed.run.input,healthyInput);
      assert.equal(await readFile(designFile,'utf8'),JSON.parse(healthyInput.taskInput).proposal.edit.content);
      const unchanged = await worker.rpc('status',{id}); assert.equal(unchanged.run.status,'HOLD');
      assert.equal(unchanged.run.reason,'ASYNC_OWNER_RESOLVER_UNSUPPORTED'); assert.equal(unchanged.allowanceHeld,true);
      assert.deepEqual(unchanged.reservation.retained,held.reservation.retained); assert.equal(unchanged.run.receipt,null);
      assert.deepEqual((await store.read(held.run.proposal.scope)).actions,{}); await assert.rejects(stat(file),{code:'ENOENT'});
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,1);
      const healthyAudit = await worker.rpc('owner-audit'); assert.equal(healthyAudit.authenticationAttempts,4);
      assert.deepEqual(healthyAudit.authenticatedSubjects,['agent:emery','founder:reviewer','agent:emery','agent:emery']);
      assert.equal(worker.child.exitCode,null); await worker.stop();
      caseResult.asyncOwnerRefusedBeforeAuthentication = true; caseResult.coordinatorSurvivedPromiseSettlement = true;
      caseResult.failedAllowanceHeld = true; caseResult.distinctHealthyWorkflowCompleted = true;
    });
  }
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
    await assert.rejects(worker.rpc('admission-policy',{accountAlias:'synthetic-alias'}),{code:'COORDINATOR_FENCED'});
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
  for (const accepted of [true,false]) await run(`cancellation committed during awaited acceptance survives ${accepted?'accepted':'rejected'} evidence`, async ({spawnCoordinator,input,waitState,approval,snapshot,caseResult}) => {
    const worker=spawnCoordinator('acceptance-gate'); await worker.next('ready'); const id=await worker.rpc('submit',{input:input()});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL'); await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    await worker.next('checkpoint',value=>value.checkpoint==='acceptance');
    const before=await worker.rpc('status',{id}); assert.ok(before.run.receipt); const fileBefore=await snapshot();
    await worker.rpc('cancel',{id}); const cancelled=await worker.rpc('status',{id}); assert.equal(cancelled.run.status,'CANCELLED');
    await worker.rpc('release-acceptance',{accepted}); const workflowResult=await worker.rpc('workflow-result',{id});
    assert.equal(workflowResult.status,'CANCELLED'); assert.equal(workflowResult.cancelled,true); assert.equal(workflowResult.acceptance,null);
    const after=await worker.rpc('status',{id}); assert.equal(after.run.status,'CANCELLED'); assert.equal(after.run.reason,'CANCELLED');
    assert.equal(after.run.cancelled,true); assert.equal(after.run.acceptance,null); assert.deepEqual(after.run.receipt,before.run.receipt);
    assert.deepEqual(await snapshot(),fileBefore); await worker.stop();
    caseResult.cancelledWhileReaderAwaited=true; caseResult.readerReturnedAccepted=accepted; caseResult.receiptPreserved=true;
  });
  for (const stop of ['cancel','close','lock-loss']) await run(`owned acceptance observes runtime ${stop} and cleanup before completion`,async({spawnCoordinator,input,waitState,approval,snapshot,pool,caseResult})=>{
    const worker=spawnCoordinator('acceptance-owned');const ready=await worker.next('ready');const id=await worker.rpc('submit',{input:input()});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL');await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const checkpoint=await worker.next('checkpoint',value=>value.checkpoint==='acceptance');assert.equal(checkpoint.ownerCredential,'owner');assert.equal(checkpoint.launcherId,ready.launcherId);
    const before=await worker.rpc('status',{id}),fileBefore=await snapshot();assert.equal(checkpoint.receipt,before.run.receipt.operationKey);
    if(stop==='cancel'){
      await worker.rpc('cancel',{id});assert.ok(worker.messages.some(m=>m.type==='acceptance-reaped'));assert.ok(worker.messages.some(m=>m.type==='acceptance-cleanup-hook'&&m.hook==='cancel'));
      const after=await worker.rpc('status',{id});assert.equal(after.run.status,'CANCELLED');assert.equal(after.run.acceptance,null);assert.deepEqual(after.run.receipt,before.run.receipt);await worker.stop();
    }else if(stop==='close'){
      await worker.stop();assert.ok(worker.messages.some(m=>m.type==='acceptance-reaped'));assert.ok(worker.messages.some(m=>m.type==='acceptance-cleanup-hook'&&m.hook==='close'));
    }else{
      const locks=(await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objsubid=2 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rows;assert.equal(locks.length,1);
      await pool.query('SELECT pg_terminate_backend($1)',[locks[0].pid]);await worker.next('acceptance-reaped');
      const after=await waitState(worker,id,value=>value.run.status==='HOLD');assert.equal(after.run.acceptance,null);assert.deepEqual(after.run.receipt,before.run.receipt);await worker.stop();
    }
    assert.deepEqual(await snapshot(),fileBefore);caseResult.ownedAcceptanceReaped=true;caseResult.writeReceiptPreserved=true;
  });
  await run('lost receipt acknowledgement keeps the durable receipt and does not repeat the write', async ({spawnCoordinator,input,waitState,approval,snapshot}) => {
    const worker=spawnCoordinator('lost-receipt-ack'); await worker.next('ready'); const id=await worker.rpc('submit',{input:input()});
    const pending=await waitState(worker,id,value=>value.run.status==='WAITING_APPROVAL'); await worker.rpc('approve',{id,approval:approval(pending),credential:'founder'});
    const held=await waitState(worker,id,value=>value.run.status==='HOLD'); assert.ok(held.run.receipt); assert.equal(held.run.reason,'COMMIT_UNKNOWN');
    const before=await snapshot(); await worker.kill(); const next=spawnCoordinator(); await next.next('ready');
    assert.deepEqual((await next.rpc('status',{id})).run.receipt,held.run.receipt); assert.deepEqual(await snapshot(),before); await next.stop();
  });
});
