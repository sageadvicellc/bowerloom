import pg from 'pg';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';

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
    if (mode !== 'read') await store.transaction(scope, draft => { draft.ownerEpoch = mode === 'uncommitted' ? 99 : 7; });
    const result = await store.read(scope);
    await pool.end();
    process.send({ type: 'observed', ownerEpoch: result.ownerEpoch, pid: process.pid });
    if (mode === 'read') process.disconnect();
  } catch { process.send({ type: 'failed' }); await pool.end(); process.disconnect(); }
});
