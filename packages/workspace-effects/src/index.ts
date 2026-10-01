import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { EffectRequest, EffectResult, Receipt, WorkspaceEffects } from '../../broker/src/index.js';
import { register, verifyDirectories, snapshot, publish } from './filesystem.js';
import type { WorkspaceRegistration, RegisteredWorkspace, Snapshot } from './filesystem.js';
import { WorkspaceEffectError, requestCopy, outcomeCopy, negative, appliedReceipt, timestamp } from './validation.js';
export { WorkspaceEffectError } from './validation.js';
export type { WorkspaceRegistration } from './filesystem.js';
export const WORKSPACE_EFFECTS_VERSION = 1;

async function query(client: PoolClient, sql: string, parameters?: unknown[]) {
  try { return await client.query(sql, parameters); }
  catch { throw new WorkspaceEffectError('DATABASE_ERROR', 'The operation ledger query failed. No replay was attempted.'); }
}
interface Options { schema: string; workspaces: WorkspaceRegistration[]; now?: () => number }
interface Stored { status: 'INTENT' | 'APPLIED' | 'NOT_APPLIED'; result: EffectResult | null; createdAtMs: number }

export class PostgresWorkspaceEffects implements WorkspaceEffects {
  readonly #pool: Pick<Pool, 'connect'>;
  readonly #schema: string;
  readonly #workspaces: Map<string, RegisteredWorkspace>;
  readonly #clock: () => number;
  private constructor(pool: Pick<Pool, 'connect'>, schema: string, workspaces: Map<string, RegisteredWorkspace>, now: () => number) {
    this.#pool = pool; this.#schema = `"${schema}"`; this.#workspaces = workspaces; this.#clock = now;
  }
  static async open(pool: Pick<Pool, 'connect'>, options: Options): Promise<PostgresWorkspaceEffects> {
    if (typeof options.schema !== 'string' || !/^trellis_[a-z][a-z0-9_]{0,46}$/.test(options.schema)) {
      throw new WorkspaceEffectError('INVALID_SCHEMA', 'An explicit bounded trellis_ schema name is required.');
    }
    return new PostgresWorkspaceEffects(pool, options.schema, await register(options.workspaces), options.now ?? Date.now);
  }
  #now(): number {
    const now = this.#clock();
    if (!timestamp(now)) throw new WorkspaceEffectError('CLOCK_UNAVAILABLE', 'A valid clock observation is required.');
    return now;
  }
  #active(request: EffectRequest, signal: AbortSignal): void {
    if (!(signal instanceof AbortSignal)) throw new WorkspaceEffectError('INVALID_SIGNAL', 'A controller cancellation signal is required.');
    if (signal.aborted) throw new WorkspaceEffectError('CANCELLED', 'The effect was cancelled before publication.');
    if (this.#now() >= request.deadlineMs) throw new WorkspaceEffectError('DEADLINE_EXPIRED', 'The effect deadline expired before publication.');
  }
  #workspace(request: EffectRequest): RegisteredWorkspace {
    const workspace = this.#workspaces.get(request.proposal.scope.workspaceId);
    if (!workspace) throw new WorkspaceEffectError('UNKNOWN_WORKSPACE', 'The controller has not registered this workspace.');
    if (!workspace.paths.has(request.proposal.edit.path)) throw new WorkspaceEffectError('UNREGISTERED_PATH', 'The controller has not registered this exact file path.');
    return workspace;
  }
  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.#pool.connect(); }
    catch { throw new WorkspaceEffectError('STORE_UNAVAILABLE', 'The operation ledger is unavailable.'); }
    let committing = false; let discard = false;
    try {
      await query(client, 'BEGIN ISOLATION LEVEL READ COMMITTED');
      await query(client, "SET LOCAL lock_timeout='5s'"); await query(client, "SET LOCAL statement_timeout='10s'");
      await query(client, "SET LOCAL idle_in_transaction_session_timeout='10s'"); await query(client, "SET LOCAL synchronous_commit='on'");
      const result = await operation(client);
      committing = true; await query(client, 'COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; throw new WorkspaceEffectError('COMMIT_UNKNOWN', 'Ledger commit acknowledgement failed. Inspect the operation; do not replay a file write.'); }
      try { await client.query('ROLLBACK'); }
      catch { discard = true; throw new WorkspaceEffectError('ROLLBACK_FAILED', 'Ledger rollback acknowledgement failed; the connection was discarded.'); }
      throw error;
    } finally { client.release(discard); }
  }
  async createSchema(): Promise<void> {
    await this.#transaction(async client => {
      await query(client, `CREATE SCHEMA ${this.#schema}`);
      await query(client, `CREATE TABLE ${this.#schema}.metadata (singleton boolean PRIMARY KEY CHECK(singleton), schema_version integer NOT NULL)`);
      await query(client, `INSERT INTO ${this.#schema}.metadata VALUES (true, $1)`, [WORKSPACE_EFFECTS_VERSION]);
      await query(client, `CREATE TABLE ${this.#schema}.workspaces (workspace_id text PRIMARY KEY, binding text NOT NULL)`);
      await query(client, `CREATE TABLE ${this.#schema}.files (workspace_id text REFERENCES ${this.#schema}.workspaces(workspace_id), path text,
        PRIMARY KEY(workspace_id, path))`);
      await query(client, `CREATE TABLE ${this.#schema}.operations (operation_key text PRIMARY KEY, workspace_id text NOT NULL, path text NOT NULL,
        state_version integer NOT NULL, request jsonb NOT NULL, request_hash text NOT NULL, created_at_ms bigint NOT NULL,
        status text NOT NULL CHECK(status IN ('INTENT', 'APPLIED', 'NOT_APPLIED')), outcome jsonb,
        FOREIGN KEY(workspace_id, path) REFERENCES ${this.#schema}.files(workspace_id, path))`);
      await query(client, `CREATE UNIQUE INDEX one_intent_per_file ON ${this.#schema}.operations(workspace_id, path) WHERE status='INTENT'`);
      for (const workspace of this.#workspaces.values()) {
        await verifyDirectories(workspace);
        await query(client, `INSERT INTO ${this.#schema}.workspaces VALUES ($1,$2)`, [workspace.workspaceId, workspace.binding]);
        for (const path of workspace.paths) await query(client, `INSERT INTO ${this.#schema}.files VALUES ($1,$2)`, [workspace.workspaceId, path]);
      }
    });
  }
  async #lock(client: PoolClient, workspace: RegisteredWorkspace, path: string): Promise<void> {
    const version = (await query(client, `SELECT singleton, schema_version FROM ${this.#schema}.metadata FOR SHARE`)).rows;
    if (version.length !== 1 || version[0].singleton !== true || version[0].schema_version !== WORKSPACE_EFFECTS_VERSION) {
      throw new WorkspaceEffectError('UNSUPPORTED_VERSION', 'The operation ledger schema is missing or unsupported.');
    }
    const registration = (await query(client, `SELECT binding FROM ${this.#schema}.workspaces WHERE workspace_id=$1 FOR SHARE`, [workspace.workspaceId])).rows;
    if (registration.length !== 1 || registration[0].binding !== workspace.binding) {
      throw new WorkspaceEffectError('WORKSPACE_BINDING', 'The persisted registration does not match these workspace directories and paths.');
    }
    const locked = await query(client, `SELECT path FROM ${this.#schema}.files WHERE workspace_id=$1 AND path=$2 FOR UPDATE`, [workspace.workspaceId, path]);
    if (locked.rowCount !== 1) throw new WorkspaceEffectError('UNREGISTERED_PATH', 'The ledger has no matching registered file.');
  }
  #decode(row: QueryResultRow, request: EffectRequest): Stored {
    if (row.state_version !== WORKSPACE_EFFECTS_VERSION) throw new WorkspaceEffectError('UNSUPPORTED_VERSION', 'The operation record version is unsupported.');
    let saved: EffectRequest; let created: number;
    try {
      saved = requestCopy(row.request); created = Number(row.created_at_ms);
      if (!timestamp(created) || row.request_hash !== digest(canonicalJson(saved)) || row.operation_key !== saved.operationKey
        || row.workspace_id !== saved.proposal.scope.workspaceId || row.path !== saved.proposal.edit.path) throw new Error('binding');
    } catch { throw new WorkspaceEffectError('CORRUPT_OPERATION', 'The stored operation identity is invalid.'); }
    if (canonicalJson(saved) !== canonicalJson(request)) throw new WorkspaceEffectError('OPERATION_CONFLICT', 'The operation key is already bound to a different request.');
    if (row.status === 'INTENT' && row.outcome === null) return { status: 'INTENT', result: null, createdAtMs: created };
    const result = outcomeCopy(row.outcome, saved);
    if ((row.status === 'APPLIED' && result.kind === 'applied' && result.receipt.appliedAtMs >= created)
      || (row.status === 'NOT_APPLIED' && result.kind === 'not-applied')) return { status: row.status, result, createdAtMs: created };
    throw new WorkspaceEffectError('CORRUPT_OPERATION', 'The stored operation status and outcome disagree.');
  }
  async #existing(client: PoolClient, request: EffectRequest): Promise<Stored | null> {
    const rows = (await query(client, `SELECT * FROM ${this.#schema}.operations WHERE operation_key=$1 FOR UPDATE`, [request.operationKey])).rows;
    return rows.length ? this.#decode(rows[0], request) : null;
  }
  async #insert(client: PoolClient, request: EffectRequest, status: 'INTENT' | 'NOT_APPLIED', outcome: EffectResult | null): Promise<void> {
    const json = canonicalJson(request);
    await query(client, `INSERT INTO ${this.#schema}.operations VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)`,
      [request.operationKey, request.proposal.scope.workspaceId, request.proposal.edit.path, WORKSPACE_EFFECTS_VERSION, json,
        digest(json), this.#now(), status, outcome ? canonicalJson(outcome) : null]);
  }
  async #finish(workspace: RegisteredWorkspace, request: EffectRequest, result: EffectResult): Promise<EffectResult> {
    return this.#transaction(async client => {
      await this.#lock(client, workspace, request.proposal.edit.path);
      const stored = await this.#existing(client, request);
      if (!stored || stored.status !== 'INTENT') throw new WorkspaceEffectError('OPERATION_CONFLICT', 'The admitted operation no longer has its original unfinished intent.');
      const detached = outcomeCopy(result, request);
      if (detached.kind === 'applied' && detached.receipt.appliedAtMs < stored.createdAtMs) {
        throw new WorkspaceEffectError('CLOCK_UNAVAILABLE', 'The clock moved behind the recorded intent. The file remains held for reconciliation.');
      }
      await query(client, `UPDATE ${this.#schema}.operations SET status=$2, outcome=$3::jsonb WHERE operation_key=$1`,
        [request.operationKey, result.kind === 'applied' ? 'APPLIED' : 'NOT_APPLIED', canonicalJson(detached)]);
      return detached;
    });
  }
  async apply(input: EffectRequest, signal: AbortSignal): Promise<EffectResult> {
    const request = requestCopy(input); const workspace = this.#workspace(request);
    await verifyDirectories(workspace);
    const admitted = await this.#transaction(async client => {
      await this.#lock(client, workspace, request.proposal.edit.path);
      const existing = await this.#existing(client, request);
      if (existing) {
        if (existing.status === 'INTENT') throw new WorkspaceEffectError('RECONCILIATION_REQUIRED', 'An unfinished file operation cannot be replayed.');
        return { result: existing.result! };
      }
      const held = await query(client, `SELECT operation_key FROM ${this.#schema}.operations WHERE workspace_id=$1 AND path=$2 AND status='INTENT'`,
        [workspace.workspaceId, request.proposal.edit.path]);
      if (held.rowCount) throw new WorkspaceEffectError('FILE_HELD', 'This file has an unfinished operation and needs reconciliation.');
      this.#active(request, signal); await verifyDirectories(workspace);
      const before = await snapshot(workspace, request.proposal.edit.path);
      this.#active(request, signal);
      if (before.digest !== request.proposal.edit.expectedDigest) {
        const result = negative(request); await this.#insert(client, request, 'NOT_APPLIED', result); return { result };
      }
      await this.#insert(client, request, 'INTENT', null);
      return { before };
    });
    if ('result' in admitted) return admitted.result!;
    let result: EffectResult;
    try {
      const changed = await publish(workspace, request, admitted.before as Snapshot, () => this.#active(request, signal));
      result = changed ? { kind: 'applied', receipt: appliedReceipt(request, this.#now()) } : negative(request);
    } catch (error) {
      if (error instanceof WorkspaceEffectError) throw error;
      throw new WorkspaceEffectError('EFFECT_UNCERTAIN', 'The filesystem operation did not yield a durable outcome. Its intent remains on hold.');
    }
    return this.#finish(workspace, request, result);
  }
  async lookup(input: EffectRequest): Promise<Receipt | null> {
    const request = requestCopy(input); const workspace = this.#workspace(request); await verifyDirectories(workspace);
    return this.#transaction(async client => {
      await this.#lock(client, workspace, request.proposal.edit.path);
      const stored = await this.#existing(client, request);
      return stored?.result?.kind === 'applied' ? structuredClone(stored.result.receipt) : null;
    });
  }
}
