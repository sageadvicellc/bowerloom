import pg from 'pg';
import { PostgresWorkspaceEffects } from '../../../dist/packages/workspace-effects/src/index.js';
process.once('message', async ({ config, options, request, mode }) => {
  const pool = new pg.Pool({ ...config, max: 1 }); pool.on('error', () => {});
  let commits = 0;
  const intercepted = { async connect() {
    const client = await pool.connect();
    return { async query(sql, values) {
      if (mode === 'published' && sql.startsWith('UPDATE ') && sql.includes('.operations SET status=')) {
        process.send({ type: 'published' }); await new Promise(() => {});
      }
      const result = await client.query(sql, values);
      if (sql === 'COMMIT') {
        commits++;
        if (mode === 'intent' && commits === 1) { process.send({ type: 'intent' }); await new Promise(() => {}); }
        if (mode === 'lost-ack' && commits === 2) throw new Error('Synthetic lost terminal acknowledgement');
      }
      return result;
    }, release: destroy => client.release(destroy) };
  } };
  try {
    const effects = await PostgresWorkspaceEffects.open(intercepted, { ...options, now: () => 1000 });
    const result = await effects.apply(request, new AbortController().signal);
    process.send({ type: 'result', result });
  } catch (error) { process.send({ type: 'error', code: error.code ?? 'UNEXPECTED' }); }
  finally { await pool.end(); process.disconnect(); }
});
