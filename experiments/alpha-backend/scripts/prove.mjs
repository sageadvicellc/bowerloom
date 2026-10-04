import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const root = new URL('../', import.meta.url);
const credentials = JSON.parse(readFileSync(new URL('.private/credentials.json', root), 'utf8'));
const database = `postgresql://postgres:${credentials.POSTGRES_PASSWORD}@127.0.0.1:56582/postgres`;
const client = new pg.Client({ connectionString: database });
await client.connect();
await client.query(`CREATE SCHEMA IF NOT EXISTS proof;
CREATE TABLE IF NOT EXISTS proof.effects (workflow_id text NOT NULL, stage text NOT NULL, PRIMARY KEY (workflow_id, stage));
CREATE TABLE IF NOT EXISTS proof.attempts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workflow_id text NOT NULL, stage text NOT NULL);
CREATE TABLE IF NOT EXISTS proof.gates (workflow_id text PRIMARY KEY, released boolean NOT NULL DEFAULT false);`);
let worker;
const children = new Set();
const messages = [];
const memorySamples = [];
const waitFor = async (predicate, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Proof event timeout');
};
const start = async () => {
  const child = fork(new URL('scripts/coordinator.ts', root), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1' } });
  children.add(child);
  child.on('message', message => { messages.push({ ...message, sender: child.pid }); if (message.rssBytes) memorySamples.push({ pid: child.pid, event: message.type, rssBytes: message.rssBytes }); });
  child.on('exit', (code, signal) => { children.delete(child); messages.push({ type: 'exit', sender: child.pid, code, signal }); });
  child.stdout.on('data', () => {});
  child.stderr.on('data', data => { /* Runtime logs stay private. */ writeFileSync(new URL(`.private/last-coordinator-stderr.log`, root), data, { flag: 'a', mode: 0o600 }); });
  return child;
};
const ready = async () => {
  worker = await start();
  await waitFor(m => m.type === 'ready' && m.sender === worker.pid);
};
const restart = async () => {
  const previous = worker.pid;
  worker.kill('SIGKILL');
  await waitFor(m => m.type === 'exit' && m.sender === previous);
  const startTime = performance.now();
  await ready();
  return { oldPid: previous, newPid: worker.pid, readyMilliseconds: performance.now() - startTime };
};
const counts = async id => (await client.query('SELECT stage, COUNT(*)::int AS attempts FROM proof.attempts WHERE workflow_id=$1 GROUP BY stage ORDER BY stage', [id])).rows;
const finish = async id => {
  worker.send({type:'release',id});
  await waitFor(m => m.type === 'released' && m.id === id);
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    worker.send({type:'status',id});
    const status = await waitFor(m => m.type === 'status' && m.id === id);
    if (status.status === 'SUCCESS') return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Workflow completion timeout');
};
const report = { startedAt: new Date().toISOString(), dbosVersion:'5.2.11', tests: [], restarts: [], conductor: false, modelCalls: 0 };
try {
  await ready();
  const extra = await start();
  const refusal = await waitFor(m => m.type === 'refused' && m.sender === extra.pid);
  assert.equal(refusal.reason, 'A coordinator already holds the installation lock.');
  report.tests.push({name:'second coordinator refused before recovery',passed:true});
  const checkpointId = `checkpoint-${randomUUID()}`;
  worker.send({type:'start',id:checkpointId});
  await waitFor(m => m.type === 'started' && m.id === checkpointId);
  await waitFor(m => m.type === 'checkpoint' && m.id === checkpointId);
  report.restarts.push(await restart());
  await waitFor(m => m.type === 'checkpoint' && m.id === checkpointId);
  await finish(checkpointId);
  assert.deepEqual(await counts(checkpointId), [{stage:'first',attempts:1},{stage:'second',attempts:1}]);
  report.tests.push({name:'checkpoint recovery does not repeat completed effects',passed:true,workflowId:checkpointId,attempts:await counts(checkpointId)});
  worker.send({type:'start',id:checkpointId});
  await waitFor(m => m.type === 'started' && m.id === checkpointId);
  assert.deepEqual(await counts(checkpointId), [{stage:'first',attempts:1},{stage:'second',attempts:1}]);
  report.tests.push({name:'duplicate delivery of completed workflow is safe',passed:true});
  const uncertainId = `uncertain-${randomUUID()}`;
  await client.query('INSERT INTO proof.gates(workflow_id) VALUES ($1)',[uncertainId]);
  worker.send({type:'start',id:uncertainId,uncertain:true});
  await waitFor(m => m.type === 'started' && m.id === uncertainId);
  await waitFor(m => m.type === 'uncertain' && m.id === uncertainId);
  await client.query('UPDATE proof.gates SET released=true WHERE workflow_id=$1',[uncertainId]);
  report.restarts.push(await restart());
  await waitFor(m => m.type === 'checkpoint' && m.id === uncertainId);
  await finish(uncertainId);
  assert.deepEqual(await counts(uncertainId), [{stage:'first',attempts:2},{stage:'second',attempts:1}]);
  const effects=(await client.query('SELECT stage, COUNT(*)::int AS effects FROM proof.effects WHERE workflow_id=$1 GROUP BY stage ORDER BY stage',[uncertainId])).rows;
  assert.deepEqual(effects,[{stage:'first',effects:1},{stage:'second',effects:1}]);
  report.tests.push({name:'uncheckpointed commit replays with receipt and no duplicate effect',passed:true,workflowId:uncertainId,attempts:await counts(uncertainId),effects});
  report.databaseVersion=(await client.query('SELECT version() AS version')).rows[0].version;
  report.persistedEffects=(await client.query('SELECT count(*)::int AS n FROM proof.effects')).rows[0].n;
  report.finishedAt=new Date().toISOString();
  report.coordinatorMemory = { samples: memorySamples, largestObservedRSSBytes: Math.max(...memorySamples.map(s => s.rssBytes)), scope: 'RSS at ready and completed-step observations; not a peak measurement' };
  writeFileSync(new URL('proof-result.json',root),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  for(const child of children) child.kill('SIGKILL');
  await client.end();
}
