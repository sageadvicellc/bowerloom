import { isPromise } from 'node:util/types';
import type { Pool, PoolClient } from 'pg';
import type { Scope } from '../../broker/src/types.js';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { data, McpConnectionError, fail } from './model.js';
import { validateDiscoveryAuthorityState, validateDiscoveryAuthorityTransition } from './authority.js';
import type { DiscoveryAuthorityState, DiscoveryAuthorityStore } from './authority.js';
import { createMcpContainerRecoveryReceipt, validateMcpContainerRecoveryReceipt } from './container-recovery-receipt.js';
import type { McpContainerRecoveryReceipt } from './container-recovery-receipt.js';
import type { McpContainerRecoveryCollection } from './container-recovery-collector.js';

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
  async #transaction<T>(body: (client: PoolClient) => Promise<T>, checkActive: () => void = () => {}): Promise<T> {
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
      checkActive();
      attempted = true;
      await client.query('COMMIT');
      checkActive();
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
  /** Explicit optional schema initialization. Existing authority v1 tables and reads are unchanged. */
  async initializeRecoveryReceipts(): Promise<void> {
    await this.#transaction(async client => {
      await this.#version(client);
      await client.query(`CREATE TABLE ${this.#schema}.recovery_metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.recovery_metadata VALUES(true,1)`);
      await client.query(`CREATE TABLE ${this.#schema}.recovery_receipts(
        workspace_id text NOT NULL,run_id text NOT NULL,task_id text NOT NULL,
        revision text NOT NULL,version integer NOT NULL,receipt jsonb NOT NULL,checksum text NOT NULL,
        PRIMARY KEY(workspace_id,run_id,task_id,revision),
        FOREIGN KEY(workspace_id,run_id,task_id) REFERENCES ${this.#schema}.discoveries(workspace_id,run_id,task_id))`);
    });
  }
  async #recoveryVersion(client: PoolClient): Promise<void> {
    const rows = (await client.query(`SELECT singleton,version FROM ${this.#schema}.recovery_metadata FOR SHARE`)).rows;
    if (rows.length !== 1 || rows[0].singleton !== true || rows[0].version !== 1) fail('MCP_RECOVERY_RECEIPT_SCHEMA_VERSION');
  }
  #receiptRow(row: Record<string, unknown>, selected: Scope, revision: string): McpContainerRecoveryReceipt {
    if (row.version !== 1 || digest(canonicalJson(data(row.receipt))) !== row.checksum) fail('MCP_RECOVERY_RECEIPT_CORRUPT');
    const receipt = validateMcpContainerRecoveryReceipt(row.receipt, selected);
    if (receipt.revision !== revision) fail('MCP_RECOVERY_RECEIPT_CORRUPT');
    return receipt;
  }
  /** Trusted host-only persistence. Never clears uncertainty or verifies a supplied report's origin. */
  async recordRecoveryReceipt(expected: DiscoveryAuthorityState, collection: McpContainerRecoveryCollection, checkActive: () => void): Promise<McpContainerRecoveryReceipt> {
    if (typeof checkActive !== 'function') fail('MCP_RECOVERY_RECEIPT_INVALID');
    checkActive();
    const captured = validateDiscoveryAuthorityState(expected), s = scope(captured.scope);
    const original = canonicalJson(captured), receipt = createMcpContainerRecoveryReceipt(captured, collection), json = canonicalJson(receipt);
    return this.#transaction(async client => {
      checkActive();
      const current = await this.#read(client, s, 'UPDATE'); checkActive();
      if (canonicalJson(current) !== original) fail('MCP_RECOVERY_RECEIPT_AUTHORITY_CHANGED');
      await this.#recoveryVersion(client); checkActive();
      await client.query(`INSERT INTO ${this.#schema}.recovery_receipts VALUES($1,$2,$3,$4,1,$5::jsonb,$6)
        ON CONFLICT(workspace_id,run_id,task_id,revision) DO NOTHING`,
      [s.workspaceId, s.runId, s.taskId, receipt.revision, json, digest(json)]); checkActive();
      const rows = (await client.query(`SELECT version,receipt,checksum FROM ${this.#schema}.recovery_receipts
        WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 AND revision=$4 FOR SHARE`,
      [s.workspaceId, s.runId, s.taskId, receipt.revision])).rows; checkActive();
      if (rows.length !== 1 || canonicalJson(this.#receiptRow(rows[0], s, receipt.revision)) !== json) fail('MCP_RECOVERY_RECEIPT_CORRUPT');
      return receipt;
    }, checkActive);
  }
  /** Historical observation only. This read neither refreshes evidence nor authorizes any effect. */
  async readRecoveryReceipt(value: Scope, revision: string): Promise<McpContainerRecoveryReceipt> {
    const s = scope(value);
    if (typeof revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(revision)) fail('MCP_RECOVERY_RECEIPT_INVALID');
    return this.#transaction(async client => {
      await this.#version(client); await this.#recoveryVersion(client);
      const rows = (await client.query(`SELECT version,receipt,checksum FROM ${this.#schema}.recovery_receipts
        WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 AND revision=$4 FOR SHARE`, [s.workspaceId, s.runId, s.taskId, revision])).rows;
      if (rows.length !== 1) fail('MCP_RECOVERY_RECEIPT_MISSING');
      return this.#receiptRow(rows[0], s, revision);
    });
  }

}
