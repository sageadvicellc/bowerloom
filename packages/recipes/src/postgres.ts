import { createHash } from 'node:crypto';
import { isPromise } from 'node:util/types';
import type { Pool, PoolClient } from 'pg';
import { RecipeError } from './types.js';
import type { Job, RecipeSpec, RecipeStore } from './types.js';
import { canonicalJson, clone, digest, exact, fail, hash, id, same, specCopy, validateJob } from './validation.js';
export const schemaName = (value: string): string => { if (!/^trellis_[a-z][a-z0-9_]{0,45}$/.test(value)) fail('INVALID_SCHEMA'); return value; };
const lockKey = (v: string): [number,number] => { const b = createHash('sha256').update(v).digest(); return [b.readInt32BE(0),b.readInt32BE(4)]; };
/** Separate control records; LangGraph owns orchestration checkpoints, never effect permission. */
export class PostgresRecipeStore implements RecipeStore {
  readonly schema: string;
  constructor(readonly pool: Pool, schema: string) { this.schema = schemaName(schema); }
  async #tx<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient; try { client = await this.pool.connect(); } catch { return fail('STORE_UNAVAILABLE'); }
    let committing = false, discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL synchronous_commit='on'");
      const result = await body(client); committing = true; await client.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; return fail('COMMIT_UNKNOWN'); }
      try { await client.query('ROLLBACK'); } catch { discard = true; return fail('ROLLBACK_UNKNOWN'); }
      throw error instanceof RecipeError ? error : new RecipeError('DATABASE_ERROR');
    } finally { client.release(discard); }
  }
  /** Explicit operator bootstrap only. Never called by an untrusted recipe setup. */
  async createSchema(): Promise<void> {
    await this.#tx(async c => {
      await c.query(`CREATE SCHEMA "${this.schema}"`);
      await c.query(`CREATE TABLE "${this.schema}".metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL); INSERT INTO "${this.schema}".metadata VALUES(true,1)`);
      await c.query(`CREATE TABLE "${this.schema}".records(kind text NOT NULL,id text NOT NULL,state jsonb NOT NULL,checksum text NOT NULL,PRIMARY KEY(kind,id))`);
    });
  }
  async #locked<T>(kind: 'recipe' | 'job', key: string, body: (c: PoolClient, value: unknown | null) => Promise<T>): Promise<T> {
    return this.#tx(async c => {
      const meta = (await c.query(`SELECT * FROM "${this.schema}".metadata FOR SHARE`)).rows;
      if (meta.length !== 1 || meta[0].singleton !== true || meta[0].version !== 1) fail('UNSUPPORTED_SCHEMA');
      await c.query('SELECT pg_advisory_xact_lock($1,$2)', lockKey(`${this.schema}:${kind}:${key}`));
      const rows = (await c.query(`SELECT state,checksum FROM "${this.schema}".records WHERE kind=$1 AND id=$2 FOR UPDATE`, [kind,key])).rows;
      if (rows.length > 1 || (rows[0] && digest(canonicalJson(rows[0].state)) !== rows[0].checksum)) fail('CORRUPT_RECORD');
      return body(c, rows[0]?.state ?? null);
    });
  }
  async #save(c: PoolClient, kind: string, key: string, value: unknown): Promise<void> {
    const json = canonicalJson(clone(value));
    await c.query(`INSERT INTO "${this.schema}".records VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(kind,id) DO UPDATE SET state=EXCLUDED.state,checksum=EXCLUDED.checksum`,[kind,key,json,digest(json)]);
  }
  setup(value: RecipeSpec): Promise<RecipeSpec> {
    const spec = specCopy(value);
    return this.#locked('recipe',spec.id,async(c,current) => {
      if (current && !same(specCopy(current),spec)) fail('SETUP_CONFLICT');
      if (!current) await this.#save(c,'recipe',spec.id,spec);
      return clone(spec);
    });
  }
  spec(key: string): Promise<RecipeSpec> {
    if (!id(key)) fail('INVALID_RECIPE_ID');
    return this.#locked('recipe',key,async(_c,current) => { if (!current) fail('UNKNOWN_RECIPE'); const result = specCopy(current); if (result.id !== key) fail('CORRUPT_RECORD'); return result; });
  }
  read(key: string): Promise<Job | null> {
    if (!hash(key)) fail('INVALID_JOB_ID');
    return this.#locked('job',key,async(_c,current) => { const result = current ? validateJob(current) : null; if (result && result.id !== key) fail('CORRUPT_RECORD'); return result; });
  }
  change<T>(key: string, mutate: (current: Job | null) => { job: Job; result: T }): Promise<T> {
    if (!hash(key)) fail('INVALID_JOB_ID');
    return this.#locked('job',key,async(c,current) => {
      const previous = current ? validateJob(current) : null; if (previous && previous.id !== key) fail('CORRUPT_RECORD');
      const out = mutate(previous);
      if (isPromise(out)) { void Promise.prototype.then.call(out,undefined,()=>{}); fail('ASYNC_MUTATOR'); }
      if (!exact(out,['job','result'])) fail('INVALID_MUTATOR');
      const job = validateJob(out.job); if (job.id !== key) fail('CORRUPT_RECORD'); const result = clone(out.result);
      await this.#save(c,'job',key,job); return result;
    });
  }
  async exclusive<T>(key: string, body: (guard: () => Promise<void>) => Promise<T>): Promise<T> {
    if (!hash(key)) fail('INVALID_JOB_ID');
    const client = await this.pool.connect(), lock = lockKey(`${this.schema}:orchestration:${key}`); let held = false, lost = false;
    const onError = () => { lost = true; }; client.on('error',onError);
    try {
      held = (await client.query('SELECT pg_try_advisory_lock($1,$2) AS held',lock)).rows[0]?.held === true;
      if (!held) fail('RECIPE_BUSY');
      return await body(async() => { if (lost) fail('LOCK_LOST'); try { await client.query('SELECT 1'); } catch { lost = true; fail('LOCK_LOST'); } });
    } finally {
      if (held && !lost) try { await client.query('SELECT pg_advisory_unlock($1,$2)',lock); } catch { lost = true; }
      client.removeListener('error',onError); client.release(lost);
    }
  }
}
