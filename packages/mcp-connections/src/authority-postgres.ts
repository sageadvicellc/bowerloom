import { isPromise } from 'node:util/types';
import type { Pool, PoolClient } from 'pg';
import type { Scope } from '../../broker/src/types.js';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { data, McpConnectionError, fail } from './model.js';
import { validateDiscoveryAuthorityState, validateDiscoveryAuthorityTransition } from './authority.js';
import type { DiscoveryAuthorityState, DiscoveryAuthorityStore } from './authority.js';

const VERSION = 1;
const SAFE_TRANSACTION_CODES = new Set(['MCP_AUTHORITY_SCHEMA_VERSION', 'MCP_AUTHORITY_SCOPE_EXISTS',
  'MCP_AUTHORITY_SCOPE_MISSING', 'MCP_AUTHORITY_STATE_CORRUPT', 'MCP_AUTHORITY_ASYNC_MUTATOR']);
function scope(value: Scope): Scope {
  const v = data(value) as Scope;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== 'runId,taskId,workspaceId'
    || !Object.values(v).every(x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(x))) fail('MCP_AUTHORITY_SCOPE');
  return v;
}
function schema(value: string): string {
  if (typeof value !== 'string' || !/^bowerloom_mcp_[a-z][a-z0-9_]{0,32}$/.test(value)) fail('MCP_AUTHORITY_SCHEMA');
  return `"${value}"`;
}

/** The caller supplies a bounded authenticated pool. No ambient database defaults are used. */
export class PostgresDiscoveryAuthorityStore implements DiscoveryAuthorityStore {
  readonly #pool: Pick<Pool, 'connect'>;
  readonly #schema: string;
  constructor(pool: Pick<Pool, 'connect'>, options: { schema: string }) {
    this.#pool = pool;
    this.#schema = schema(options.schema);
  }
  async #transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.#pool.connect(); } catch { fail('MCP_AUTHORITY_STORE_UNAVAILABLE'); }
    let attempted = false, discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
      await client.query("SET LOCAL synchronous_commit='on'");
      const result = await body(client);
      attempted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (attempted) { discard = true; fail('MCP_AUTHORITY_COMMIT_UNKNOWN'); }
      try { await client.query('ROLLBACK'); } catch { discard = true; fail('MCP_AUTHORITY_ROLLBACK_FAILED'); }
      if (error instanceof McpConnectionError) throw new McpConnectionError(SAFE_TRANSACTION_CODES.has(error.code) ? error.code : 'MCP_AUTHORITY_STATE_REFUSED');
      fail('MCP_AUTHORITY_DATABASE_ERROR');
    } finally { client.release(discard); }
  }
  async #version(client: PoolClient): Promise<void> {
    const rows = (await client.query(`SELECT singleton,version FROM ${this.#schema}.metadata FOR SHARE`)).rows;
    if (rows.length !== 1 || rows[0].singleton !== true || rows[0].version !== VERSION) fail('MCP_AUTHORITY_SCHEMA_VERSION');
  }
  async createSchema(): Promise<void> {
    await this.#transaction(async client => {
      await client.query(`CREATE SCHEMA ${this.#schema}`);
      await client.query(`CREATE TABLE ${this.#schema}.metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.metadata VALUES(true,$1)`, [VERSION]);
      await client.query(`CREATE TABLE ${this.#schema}.discoveries(
        workspace_id text NOT NULL,run_id text NOT NULL,task_id text NOT NULL,
        version integer NOT NULL,state jsonb NOT NULL,checksum text NOT NULL,
        PRIMARY KEY(workspace_id,run_id,task_id))`);
    });
  }
  async seed(value: DiscoveryAuthorityState): Promise<void> {
    const captured = validateDiscoveryAuthorityState(value), json = canonicalJson(captured);
    if (captured.status !== 'PREPARED' || captured.approval !== null || captured.intent !== null || captured.result !== null || captured.stopRequested) fail('MCP_AUTHORITY_INITIAL_STATE');
    const s = scope(captured.scope);
    await this.#transaction(async client => {
      await this.#version(client);
      const inserted = await client.query(`INSERT INTO ${this.#schema}.discoveries VALUES($1,$2,$3,$4,$5::jsonb,$6)
        ON CONFLICT(workspace_id,run_id,task_id) DO NOTHING RETURNING task_id`,
      [s.workspaceId, s.runId, s.taskId, VERSION, json, digest(json)]);
      if (inserted.rowCount !== 1) fail('MCP_AUTHORITY_SCOPE_EXISTS');
    });
  }
  async #read(client: PoolClient, s: Scope, lock: 'UPDATE' | 'SHARE'): Promise<DiscoveryAuthorityState> {
    await this.#version(client);
    const rows = (await client.query(`SELECT version,state,checksum FROM ${this.#schema}.discoveries
      WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 FOR ${lock}`, [s.workspaceId, s.runId, s.taskId])).rows;
    if (rows.length !== 1) fail('MCP_AUTHORITY_SCOPE_MISSING');
    const row = rows[0];
    if (row.version !== VERSION || digest(canonicalJson(data(row.state))) !== row.checksum) fail('MCP_AUTHORITY_STATE_CORRUPT');
    return validateDiscoveryAuthorityState(row.state, s);
  }
  async read(value: Scope): Promise<DiscoveryAuthorityState> {
    const s = scope(value);
    return this.#transaction(client => this.#read(client, s, 'SHARE'));
  }
  async transaction<T>(value: Scope, mutate: (state: DiscoveryAuthorityState) => T): Promise<T> {
    const s = scope(value);
    if (typeof mutate !== 'function') fail('MCP_AUTHORITY_MUTATOR');
    return this.#transaction(async client => {
      const before = await this.#read(client, s, 'UPDATE');
      const draft = validateDiscoveryAuthorityState(before, s);
      const returned = mutate(draft);
      if (isPromise(returned)) { void Promise.prototype.then.call(returned, undefined, () => {}); fail('MCP_AUTHORITY_ASYNC_MUTATOR'); }
      const result = returned === undefined ? undefined : data(returned);
      const after = validateDiscoveryAuthorityState(draft, s);
      validateDiscoveryAuthorityTransition(before, after);
      const json = canonicalJson(after);
      const updated = await client.query(`UPDATE ${this.#schema}.discoveries SET state=$4::jsonb,checksum=$5
        WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3`, [s.workspaceId, s.runId, s.taskId, json, digest(json)]);
      if (updated.rowCount !== 1) fail('MCP_AUTHORITY_SCOPE_MISSING');
      return result as T;
    });
  }
}
