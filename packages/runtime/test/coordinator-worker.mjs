import pg from 'pg';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import {join} from 'node:path';
import { fileURLToPath } from 'node:url';
import {parseCrew} from '../../../dist/packages/crew/src/index.js';
import {planControl,registerControl,openControlOwner} from '../../../dist/packages/local-control/src/index.js';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { SupervisedRuntime, SyntheticProcessAdapter, RuntimeLedger } from '../../../dist/packages/runtime/src/index.js';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { PostgresWorkspaceEffects } from '../../../dist/packages/workspace-effects/src/index.js';
let runtime; let pool; let controlOwner; let controlRegistry; const controlledRuns=new Set(); let fired = false; let resumeAcceptance; let acceptanceCleanup = Promise.resolve();
process.once('message', async ({ config, options, root, schemas, resetAtMs, accountId, usedPercent, mode, ownerMode = 'fallback' }) => {
  pool = new pg.Pool({ ...config, max: 6 }); pool.on('error', () => {});
  const ownerInputs = []; const authenticatedSubjects = []; let authenticationAttempts = 0;
  const mutateInput = input => {
    input.task.ownerSubject = 'agent:mutated'; input.task.approverSubjects.push('agent:mutated');
    input.plan.definition.tasks[0].owner = 'mutated'; input.reservation.allowancePercent.primary = 99;
    input.reservation.jobId = 'mutated-job'; input.taskInput = 'mutated input';
  };
  const ownerCredentialFor = ownerMode === 'fallback' ? undefined : input => {
    const original = structuredClone(input); ownerInputs.push(original);
    // Only the build task has the broken resolver; a later design task must remain usable.
    if (original.task.taskId === 'build' && ownerMode.startsWith('promise-')) {
      if (ownerMode === 'promise-reject-delayed') return new Promise((_,reject) => {
        setTimeout(() => {
          reject(new Error('Synthetic delayed owner resolver failure'));
          process.send({ type: 'owner-promise-settled', mode: ownerMode });
        },20);
      });
      process.send({ type: 'owner-promise-settled', mode: ownerMode });
      if (ownerMode === 'promise-reject-immediate') return Promise.reject(new Error('Synthetic immediate owner resolver failure'));
      if (ownerMode === 'promise-resolved') return Promise.resolve('owner');
      throw new Error('Unknown synthetic Promise resolver mode');
    }
    if (ownerMode === 'mutate') mutateInput(input);
    if (ownerMode === 'wrong') return 'wrong-owner';
    return { 'agent:coda': 'owner', 'agent:emery': 'owner-emery' }[original.task.ownerSubject] ?? 'unknown-owner';
  };
  const intercepted = { async connect() {
    const client = await pool.connect(); let checkpoint = null;
    return { async query(sql, values) {
      if (sql.startsWith('UPDATE ') && sql.includes(`"${schemas.runtime}".runs`) && values?.[1]) {
        const state = JSON.parse(values[1]);
        if(mode==='cancel-storage-fail'&&state.cancelled)throw Object.assign(new Error('Synthetic cancellation persistence failure'),{code:'STOP_STORAGE_SYNTHETIC'});
        if (state.proposal && state.modelOutcome && state.status === 'QUEUED') checkpoint = 'proposal';
        if (state.receipt && state.status === 'WAITING_APPROVAL') checkpoint = 'receipt';
      }
      if (sql.startsWith('UPDATE ') && sql.includes(`"${schemas.admission}".accounts`) && values?.[1]) {
        const state = JSON.parse(values[1]);
        if (Object.values(state.reservations).some(value => value.status === 'LAUNCHING')) checkpoint = 'claim';
      }
      const result = await client.query(sql, values);
      if (!fired && sql === 'COMMIT' && checkpoint && mode === `crash-${checkpoint}`) {
        fired = true; process.send({ type: 'checkpoint', checkpoint }); await new Promise(() => {});
      }
      if (!fired && sql === 'COMMIT' && checkpoint === 'receipt' && mode === 'lost-receipt-ack') { fired = true; throw new Error('Synthetic lost acknowledgement'); }
      return result;
    }, release: destroy => client.release(destroy), on: (...args) => { client.on(...args); }, removeListener: (...args) => { client.removeListener(...args); } };
  } };
  try {
    const effectConnection = { async connect() {
      const client = await pool.connect(); let intent = false;
      return { async query(sql, values) {
        if (sql.startsWith('INSERT INTO ') && sql.includes('.operations')) intent = true;
        const result = await client.query(sql, values);
        if (mode === 'uncertain-effect' && intent && sql === 'COMMIT' && !fired) { fired = true; throw new Error('Synthetic lost intent acknowledgement'); }
        return result;
      }, release: destroy => client.release(destroy) };
    } };
    const effects = await PostgresWorkspaceEffects.open(effectConnection, { schema: schemas.effects,
      workspaces: [{ workspaceId: 'synthetic-workspace', root, writablePaths: ['output/job-board/index.html','output/design/brief.md'] }] });
    const adapter = new SyntheticProcessAdapter({ command: [process.execPath, fileURLToPath(new URL('./synthetic-child.mjs', import.meta.url))], cwd: root, timeoutMs: 15000, outputBytes: 65536 });
    if(mode==='registered-control'){
      const bytes=readFileSync('examples/endor/crew.yaml','utf8'),definition=parseCrew(bytes),spec=`teams/${definition.id}/team.yaml`;
      mkdirSync(join(root,'.bowerloom','teams',definition.id),{recursive:true,mode:0o700});writeFileSync(join(root,'.bowerloom',spec),bytes,{mode:0o600});
      const installation=join(root,'control-installation.json');writeFileSync(installation,JSON.stringify({format:'trellis/local-installation/v0.7-alpha',workspaceRoot:root,graph:{plan:{definition}}}),{mode:0o600});
      controlRegistry=join(root,'control-registry');const enrollment={root,team:definition.id,spec,installation,adapter:'graph',registry:controlRegistry};
      registerControl(enrollment,planControl(enrollment).revision);controlOwner=openControlOwner(installation,'graph',controlRegistry);
    }
    runtime = await SupervisedRuntime.open({ ...(controlOwner?{control:controlOwner}:{}), pool: intercepted, brokerStore: new PostgresBrokerStore(pool, { schema: schemas.broker }), effects: {
      async apply(request, signal) {
        const result = await effects.apply(request, signal);
        if (mode === 'crash-effect' && !fired) { fired = true; process.send({ type: 'checkpoint', checkpoint: 'effect' }); await new Promise(() => {}); }
        return result;
      }, lookup: request => effects.lookup(request),
    },
      ownerCredential: ownerMode === 'fallback' ? 'owner' : 'invalid-fallback',
      ...(ownerCredentialFor ? { ownerCredentialFor } : {}), recoveryCredential: 'recovery', identity: { async authenticate(credential) {
        authenticationAttempts++;
        const subject = { owner: 'agent:coda', 'owner-emery': 'agent:emery', 'wrong-owner': 'agent:outsider', founder: 'founder:reviewer', recovery: 'founder:reviewer' }[credential];
        if (!subject) throw new Error('Refused'); authenticatedSubjects.push(subject);
        return { subject, proofRef: `synthetic-${credential}`, expiresAtMs: Date.now() + 120000 };
      } },
      observations: { async read() { const now = Date.now(); return { observationId: `sample-${now}`, accountId, observedAtMs: now,
        authentication: 'subscription', ordinaryUsageAllowed: true,
        windows: { primary: { usedPercent, resetAtMs, durationMs: 1000000, accountedThroughMs: null }, secondary: null },
        routes: { 'codex-test': { requiredWindows: ['primary'], optionalWindows: ['secondary'] } } }; } },
      models: { async start(input, signal) {
        const worker = await adapter.start(input, signal);
        process.send({ type: 'model-start', identity: worker.identity });
        await pool.query('INSERT INTO runtime_test_starts VALUES ($1)', [worker.identity.processRef]);
        return worker;
      } },
      acceptance: { ...(mode === 'acceptance-owned' ? {
        async cancel() { await acceptanceCleanup; process.send({type:'acceptance-cleanup-hook',hook:'cancel'}); },
        async close() { await acceptanceCleanup; process.send({type:'acceptance-cleanup-hook',hook:'close'}); },
      } : {}), async read(input,receipt,context) {
        if (mode === 'acceptance-owned') {
          let finish; acceptanceCleanup = new Promise(resolve => { finish=resolve; });
          try {
            await context.guard();
            process.send({type:'checkpoint',checkpoint:'acceptance',ownerCredential:context.ownerCredential,launcherId:context.launcherId,receipt:receipt.operationKey});
            await new Promise((_,reject) => {
              const abort=()=>{const error=new Error('Synthetic acceptance stopped');error.code='CANCELLED';reject(error);};
              context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted)abort();
            });
          } finally {
            await new Promise(resolve=>setTimeout(resolve,20));
            process.send({type:'acceptance-reaped'});finish();
          }
        }
        if (mode === 'acceptance-gate') {
          const accepted = await new Promise(resolve => { resumeAcceptance = resolve; process.send({ type:'checkpoint', checkpoint:'acceptance' }); });
          return { accepted, evidenceRef:'synthetic-delayed-acceptance' };
        }
        return { accepted: true, evidenceRef: 'synthetic-receipt-check' };
      } },
    }, options);
    if(controlOwner)controlOwner.onStop(async()=>{
      const results=await Promise.all([...controlledRuns].map(id=>runtime.cancel(id)));await runtime.close();
      await controlOwner.finish({adapter:'graph',tasks:results},results.every(r=>r.confirmed));
      process.send({type:'control-stopped'});
    });
    process.send({ type: 'ready', controlRegistry, launcherId: runtime.launcherId, rssBytes: process.memoryUsage().rss });
    process.on('message', async message => {
      try {
        let result;
        if (message.type === 'release-acceptance') { resumeAcceptance(message.accepted); result = 'released'; }
        else if (message.type === 'owner-audit') result = { inputs: ownerInputs, authenticatedSubjects, authenticationAttempts };
        else if (message.type === 'admission-policy') result = await runtime.admissionPolicy(message.accountAlias);
        else if (message.type === 'mutate-policy-result') {
          const policy = await runtime.admissionPolicy(message.accountAlias); const before = structuredClone(policy);
          // Mutate inside the caller process: IPC serialization must not be what protects the ledger.
          policy.thresholdPercent = 100; policy.maxWorkers = 999; policy.admittedRoutes.push('unregistered-route');
          result = { before, after: await runtime.admissionPolicy(message.accountAlias) };
        }
        else if (message.type === 'mutate-status-input') {
          const status = await runtime.status(message.id); mutateInput(status.run.input);
          result = await runtime.status(message.id);
        }
        else if (message.type === 'workflow-result') result = await DBOS.getResult(message.id, { timeoutSeconds: 3 });
        else if (message.type === 'submit') { result = await runtime.submit(message.input); controlledRuns.add(result); if (message.mutateAfterSubmit) mutateInput(message.input); }
        else if (message.type === 'status') result = await runtime.status(message.id);
        else if (message.type === 'approve') result = await runtime.approve(message.id, message.approval, message.credential);
        else if (message.type === 'cancel') result = await runtime.cancel(message.id);
        else if (message.type === 'stop') { if(!controlOwner?.signal.aborted)await runtime.close();await controlOwner?.finish({closed:true}); await pool.end(); process.send({ type: 'reply', call: message.call, result: 'closed' }); process.disconnect(); return; }
        process.send({ type: 'reply', call: message.call, result });
      } catch (error) { process.send({ type: 'reply', call: message.call, error: error.code ?? error.name }); }
    });
  } catch (error) {
    process.send({ type: 'startup-error', code: error.code ?? error.name });
    await pool.end(); process.disconnect();
  }
});
