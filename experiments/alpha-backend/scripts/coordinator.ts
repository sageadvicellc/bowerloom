import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const credentials = JSON.parse(readFileSync(new URL('../.private/credentials.json', import.meta.url), 'utf8'));
const database = `postgresql://postgres:${credentials.POSTGRES_PASSWORD}@127.0.0.1:56582/postgres`;
const pool = new pg.Pool({ connectionString: database, max: 3 });
const lock = new pg.Client({ connectionString: database });
await lock.connect();
const admission = await lock.query('SELECT pg_try_advisory_lock(7400707) AS admitted');
if (!admission.rows[0].admitted) {
  process.send?.({ type: 'refused', reason: 'A coordinator already holds the installation lock.' });
  await lock.end();
  await pool.end();
  process.exit(23);
}
lock.on('error', () => process.exit(24));
DBOS.setConfig({
  name: 'trellis-alpha-backend-proof',
  applicationVersion: '0.7.0-alpha.0',
  systemDatabaseUrl: database,
  systemDatabasePoolSize: 5,
  executorID: 'trellis-alpha-single-coordinator',
  enableOTLP: false,
  tracingEnabled: false,
  logLevel: 'warn',
});

async function effect(id: string, stage: string, crashWindow: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO proof.attempts (workflow_id, stage) VALUES ($1, $2)', [id, stage]);
    await client.query('INSERT INTO proof.effects (workflow_id, stage) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, stage]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (crashWindow) {
    process.send?.({ type: 'uncertain', id });
    const gate = await pool.query('SELECT released FROM proof.gates WHERE workflow_id = $1', [id]);
    if (!gate.rows[0]?.released) await new Promise(() => {});
  }
  return { id, stage };
}
const workflow = DBOS.registerWorkflow(async function backendProof(id: string, uncertain: boolean) {
  await DBOS.runStep(() => effect(id, 'first', uncertain), { name: 'first-effect', retriesAllowed: false });
  process.send?.({ type: 'checkpoint', id, rssBytes: process.memoryUsage().rss });
  const release = await DBOS.recv('continue', 300);
  if (release !== 'approved-proof-release') throw new Error('The proof did not receive its release message.');
  await DBOS.runStep(() => effect(id, 'second', false), { name: 'second-effect', retriesAllowed: false });
  return { id, completed: true };
}, { name: 'backendProof' });
await DBOS.launch();
process.send?.({ type: 'ready', pid: process.pid, rssBytes: process.memoryUsage().rss });
process.on('message', async (message: {type: string; id: string; uncertain?: boolean}) => {
  try {
    if (message.type === 'start') {
      await DBOS.startWorkflow(workflow, { workflowID: message.id })(message.id, Boolean(message.uncertain));
      process.send?.({ type: 'started', id: message.id });
    } else if (message.type === 'release') {
      await DBOS.send(message.id, 'approved-proof-release', 'continue', `${message.id}-release`);
      process.send?.({ type: 'released', id: message.id });
    } else if (message.type === 'status') {
      const status = await DBOS.getWorkflowStatus(message.id);
      process.send?.({ type: 'status', id: message.id, status: status?.status });
    } else if (message.type === 'stop') {
      await DBOS.shutdown();
      await pool.end();
      await lock.end();
      process.exit(0);
    }
  } catch (error) {
    process.send?.({ type: 'failure', reason: error instanceof Error ? error.name : 'UnknownError' });
    process.exitCode = 1;
  }
});
