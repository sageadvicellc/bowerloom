import pg from 'pg';
import { PostgresAdmission } from '../../../dist/packages/admission/src/index.js';
import { intercept } from './fixtures.mjs';
process.once('message', async ({ config, schema, request, observation, permit, mode, launcherId }) => {
  const pool = new pg.Pool({ ...config, max: 1 }); pool.on('error', () => {});
  let starts = 0;
  const connection = intercept(pool, async (client, sql, values) => {
    const result = await client.query(sql, values);
    if (mode === 'claim' && sql === 'COMMIT') { process.send({ type: 'claim', starts }); await new Promise(() => {}); }
    return result;
  });
  try {
    const admission = new PostgresAdmission(connection, { schema, launcherId, now: () => 10000 });
    const result = mode === 'reserve' ? await admission.reserve(request, observation) : await admission.launchOnce(request.accountAlias, request.jobId, permit, observation, async () => {
      starts++;
      if (mode === 'started') { process.send({ type: 'started', starts }); await new Promise(() => {}); }
      return { processRef: 'synthetic-child-process' };
    });
    process.send({ type: 'result', result, starts });
  } catch (error) { process.send({ type: 'error', code: error.code ?? 'UNEXPECTED', starts }); }
  finally { await pool.end(); process.disconnect(); }
});
