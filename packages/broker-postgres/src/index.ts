import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { BrokerStore, Scope, TaskState } from '../../broker/src/index.js';
import { BrokerStoreError, copyScope, decodeState, detachResult, encodeState, STATE_VERSION } from './state.js';
export { BrokerStoreError, STATE_VERSION, STATE_BYTES_LIMIT } from './state.js';

function namespace(schema: string): string {
  if (typeof schema !== 'string' || !/^trellis_[a-z][a-z0-9_]{0,46}$/.test(schema)) {
    throw new BrokerStoreError('INVALID_SCHEMA', 'Use an explicit trellis_ schema name with lowercase letters, digits, and underscores.');
  }
  return `"${schema}"`;
}
async function query<R extends QueryResultRow = QueryResultRow>(client: PoolClient, sql: string, parameters?: unknown[]): Promise<QueryResult<R>> {
  try { return await client.query<R>(sql, parameters); }
  catch { throw new BrokerStoreError('DATABASE_ERROR', 'The database operation failed. No retry was attempted.'); }
}

export class PostgresBrokerStore implements BrokerStore {
  readonly #pool: Pick<Pool, 'connect'>;
  readonly #schema: string;
  // Pool ownership stays with the caller. Supply a bounded, authenticated pool; no ambient connection defaults are added here.
  constructor(pool: Pick<Pool, 'connect'>, options: { schema: string }) {
    this.#pool = pool;
    this.#schema = namespace(options.schema);
  }
  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.#pool.connect(); }
    catch { throw new BrokerStoreError('STORE_UNAVAILABLE', 'A database connection is unavailable.'); }
    let commitAttempted = false;
    let discard = false;
    try {
      await query(client, 'BEGIN ISOLATION LEVEL READ COMMITTED');
      await query(client, "SET LOCAL lock_timeout = '5s'");
      await query(client, "SET LOCAL statement_timeout = '10s'");
      await query(client, "SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await query(client, "SET LOCAL synchronous_commit = 'on'");
      const result = await operation(client);
      commitAttempted = true;
      await query(client, 'COMMIT');
      return result;
    } catch (error) {
      if (commitAttempted) {
        discard = true;
        throw new BrokerStoreError('COMMIT_UNKNOWN', 'Commit acknowledgement failed. Inspect durable state before deciding whether to continue; do not replay automatically.');
      }
      try { await client.query('ROLLBACK'); }
      catch {
        discard = true;
        throw new BrokerStoreError('ROLLBACK_FAILED', 'Rollback acknowledgement failed. The connection was discarded.');
      }
      throw error;
    } finally { client.release(discard); }
  }

  /** Provision a new namespace explicitly. Existing schemas are never adopted or migrated. */
  async createSchema(): Promise<void> {
    await this.#transaction(async client => {
      await query(client, `CREATE SCHEMA ${this.#schema}`);
      await query(client, `CREATE TABLE ${this.#schema}.store_metadata (singleton boolean PRIMARY KEY CHECK (singleton), schema_version integer NOT NULL)`);
      await query(client, `INSERT INTO ${this.#schema}.store_metadata VALUES (true, $1)`, [STATE_VERSION]);
      await query(client, `CREATE TABLE ${this.#schema}.task_states (
        workspace_id text NOT NULL, run_id text NOT NULL, task_id text NOT NULL,
        state_version integer NOT NULL, state jsonb NOT NULL, checksum text NOT NULL,
        PRIMARY KEY (workspace_id, run_id, task_id))`);
    });
  }
  async #version(client: PoolClient): Promise<void> {
    const metadata = await query(client, `SELECT singleton, schema_version FROM ${this.#schema}.store_metadata FOR SHARE`);
    if (metadata.rows.length !== 1 || metadata.rows[0]!.singleton !== true || metadata.rows[0]!.schema_version !== STATE_VERSION) {
      throw new BrokerStoreError('UNSUPPORTED_SCHEMA_VERSION', 'The database schema marker is missing or unsupported.');
    }
  }
  async seed(value: TaskState): Promise<void> {
    const encoded = encodeState(value);
    const { workspaceId, runId, taskId } = encoded.state.scope;
    await this.#transaction(async client => {
      await this.#version(client);
      const inserted = await query(client, `INSERT INTO ${this.#schema}.task_states
        (workspace_id, run_id, task_id, state_version, state, checksum) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (workspace_id, run_id, task_id) DO NOTHING RETURNING task_id`,
      [workspaceId, runId, taskId, STATE_VERSION, encoded.json, encoded.checksum]);
      if (inserted.rowCount !== 1) throw new BrokerStoreError('SCOPE_EXISTS', 'The scoped task already exists.');
    });
  }
  async #state(client: PoolClient, scope: Scope, lock: 'UPDATE' | 'SHARE'): Promise<TaskState> {
    await this.#version(client);
    const selected = await query(client, `SELECT state_version, state, checksum FROM ${this.#schema}.task_states
      WHERE workspace_id = $1 AND run_id = $2 AND task_id = $3 FOR ${lock}`, [scope.workspaceId, scope.runId, scope.taskId]);
    if (selected.rows.length !== 1) throw new BrokerStoreError('SCOPE_NOT_FOUND', 'The scoped task does not exist.');
    return decodeState(selected.rows[0] as { state_version: unknown; state: unknown; checksum: unknown }, scope);
  }
  async read(scopeInput: Scope): Promise<TaskState> {
    const scope = copyScope(scopeInput);
    return this.#transaction(client => this.#state(client, scope, 'SHARE'));
  }
  async transaction<T>(scopeInput: Scope, mutate: (state: TaskState) => T): Promise<T> {
    const scope = copyScope(scopeInput);
    if (typeof mutate !== 'function') throw new BrokerStoreError('INVALID_CALLBACK', 'A synchronous state callback is required.');
    return this.#transaction(async client => {
      const draft = await this.#state(client, scope, 'UPDATE');
      const result = mutate(draft);
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
        if (result instanceof Promise) void Promise.prototype.then.call(result, undefined, () => {});
        throw new BrokerStoreError('ASYNC_TRANSACTION', 'The state callback must be synchronous and cannot return a thenable.');
      }
      const detached = detachResult(result);
      const encoded = encodeState(draft, scope);
      const updated = await query(client, `UPDATE ${this.#schema}.task_states SET state = $4::jsonb, checksum = $5
        WHERE workspace_id = $1 AND run_id = $2 AND task_id = $3`,
      [scope.workspaceId, scope.runId, scope.taskId, encoded.json, encoded.checksum]);
      if (updated.rowCount !== 1) throw new BrokerStoreError('SCOPE_NOT_FOUND', 'The scoped task disappeared during its locked transaction.');
      return detached;
    });
  }
}
