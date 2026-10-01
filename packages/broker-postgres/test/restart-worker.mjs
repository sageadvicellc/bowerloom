import pg from 'pg';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { ActionBroker } from '../../../dist/packages/broker/src/index.js';

process.once('message', async ({ config, schema, scope, mode }) => {
  const pool = new pg.Pool({ ...config, max: 1 });
  pool.on('error', () => {});
  try {
    const wrapped = mode === 'uncommitted' ? { async connect() {
      const client = await pool.connect();
      return { query: async (sql, values) => {
        if (sql === 'COMMIT') {
          process.send({ type: 'uncommitted' });
          await new Promise(() => {});
        }
        return client.query(sql, values);
      }, release: destroy => client.release(destroy) };
    } } : pool;
    const store = new PostgresBrokerStore(wrapped, { schema });
    if (mode === 'commit' || mode === 'uncommitted') await store.transaction(scope, draft => { draft.ownerEpoch = mode === 'uncommitted' ? 99 : 7; });
    const result = await store.read(scope);
    if (mode === 'revocation') {
      let effectCalls = 0;
      const broker = new ActionBroker({ store, clock: { now: () => 1000, alarm: () => () => {} },
        identity: { async authenticate(subject) { return { subject, proofRef: 'synthetic-proof', expiresAtMs: 1_000_000 }; } },
        effects: { async apply() { effectCalls++; throw new Error('Denied action reached effects'); }, async lookup() { return null; } } });
      let dispatchError = null;
      try { await broker.dispatch(scope, 'write-one', 'agent:coda'); }
      catch (error) { dispatchError = error.code; }
      const after = await store.read(scope);
      await pool.end();
      process.send({ type: 'revocation', approverSubjects: result.approverSubjects, approvalRetained: result.actions['write-one'].approval !== null,
        dispatchError, effectCalls, status: after.actions['write-one'].status, pid: process.pid });
      process.disconnect();
      return;
    }
    await pool.end();
    process.send({ type: 'observed', ownerEpoch: result.ownerEpoch, pid: process.pid });
    if (mode === 'read') process.disconnect();
  } catch { process.send({ type: 'failed' }); await pool.end(); process.disconnect(); }
});
