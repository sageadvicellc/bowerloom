import { createHash } from 'node:crypto';
import { isPromise } from 'node:util/types';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { copyJson, graphState, identifier } from './validation.js';
import { GraphError } from './types.js';
import type { GraphState, GraphStore } from './types.js';
export class PostgresGraphStore implements GraphStore {
  readonly #schema: string;
  constructor(readonly pool: Pick<Pool, 'connect'>, schema: string) {
    if (typeof schema !== 'string' || !/^trellis_[a-z][a-z0-9_]{0,46}$/.test(schema)) throw new GraphError('INVALID_SCHEMA');
    this.#schema = `"${schema}"`;
  }
  async #transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new GraphError('STORE_UNAVAILABLE'); }
    let committing = false; let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'"); await client.query("SET LOCAL synchronous_commit='on'");
      const result = await body(client); committing = true; await client.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; throw new GraphError('COMMIT_UNKNOWN'); }
      try { await client.query('ROLLBACK'); } catch { discard = true; throw new GraphError('ROLLBACK_FAILED'); }
      throw error instanceof GraphError ? error : new GraphError('GRAPH_DATABASE_ERROR');
    } finally { client.release(discard); }
  }
  createSchema(): Promise<void> {
    return this.#transaction(async client => {
      await client.query(`CREATE SCHEMA ${this.#schema}`);
      await client.query(`CREATE TABLE ${this.#schema}.metadata (singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.metadata VALUES (true,1)`);
      await client.query(`CREATE TABLE ${this.#schema}.graphs (id text PRIMARY KEY, version integer NOT NULL, state jsonb NOT NULL, checksum text NOT NULL)`);
    });
  }
  transaction<T>(id: string, change: (current: GraphState | null) => { state: GraphState; result: T }): Promise<T> {
    if (!identifier(id)) throw new GraphError('INVALID_GRAPH_ID');
    return this.#transaction(async client => {
      const metadata = (await client.query(`SELECT singleton,version FROM ${this.#schema}.metadata FOR SHARE`)).rows;
      if (metadata.length !== 1 || metadata[0].singleton !== true || metadata[0].version !== 1) throw new GraphError('UNSUPPORTED_VERSION');
      // A transaction lock also covers an absent row during competing initial submissions.
      const key = createHash('sha256').update(`trellis-graph:${this.#schema}:${id}`).digest();
      await client.query('SELECT pg_advisory_xact_lock($1,$2)', [key.readInt32BE(0), key.readInt32BE(4)]);
      const rows = (await client.query(`SELECT version,state,checksum FROM ${this.#schema}.graphs WHERE id=$1 FOR UPDATE`, [id])).rows;
      let current: GraphState | null = null;
      if (rows.length) {
        const row = rows[0];
        if (row.version !== 1) throw new GraphError('UNSUPPORTED_VERSION');
        if (digest(canonicalJson(row.state)) !== row.checksum) throw new GraphError('CORRUPT_GRAPH');
        current = graphState(row.state); if (current.id !== id) throw new GraphError('CORRUPT_GRAPH');
      }
      const changed = change(current);
      if (isPromise(changed)) {
        // Reject asynchronous mutation immediately, but observe any later rejection.
        // Use the native method without invoking a user-defined `then` property.
        void Promise.prototype.then.call(changed, undefined, () => {});
        throw new GraphError('INVALID_MUTATOR');
      }
      if (!changed || Object.getPrototypeOf(changed) !== Object.prototype) throw new GraphError('INVALID_MUTATOR');
      const descriptors = Object.getOwnPropertyDescriptors(changed);
      if (Reflect.ownKeys(changed).length !== 2 || Object.keys(descriptors).sort().join() !== 'result,state' || !Object.values(descriptors).every(value => value.enumerable && 'value' in value)) throw new GraphError('INVALID_MUTATOR');
      const state = graphState(changed.state); if (state.id !== id) throw new GraphError('CORRUPT_GRAPH');
      const result = changed.result === undefined ? undefined : copyJson(changed.result);
      const json = canonicalJson(state);
      await client.query(`INSERT INTO ${this.#schema}.graphs VALUES ($1,1,$2::jsonb,$3)
        ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,checksum=EXCLUDED.checksum`, [id, json, digest(json)]);
      return result as T;
    });
  }
}
