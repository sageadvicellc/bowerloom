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

import { createGuardianBinding, validateGuardianBinding } from './container-guardian-provenance.js';
import type { GuardianBinding, GuardianDescriptor, GuardianEvidence } from './container-guardian-provenance.js';

import { advanceGuardianCheckpoint, validateGuardianCheckpointRecords } from './container-guardian-checkpoint.js';
import type { GuardianCheckpoint, GuardianClosure, GuardianCloseWitness, GuardianCheckpointEvidence } from './container-guardian-checkpoint.js';
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
  async #transaction<T>(body: (client: Pick<PoolClient, 'query'>) => Promise<T>, checkActive: () => void = () => {}): Promise<T> {
    let client: PoolClient;
    try { client = await this.#pool.connect(); } catch { fail('MCP_AUTHORITY_STORE_UNAVAILABLE'); }
    let attempted = false, discard = false, fault = false, released = false, returning = false;
    let rejectFault!: (error: McpConnectionError) => void;
    const failure = new Promise<never>((_, reject) => { rejectFault = reject; });
    void failure.catch(() => {});
    // pg-pool removes its idle error listener while a client is checked out.
    // Consume errors here without retaining driver messages or allowing later queries.
    const onError = () => { if (fault) return; fault = true; discard = true; rejectFault(new McpConnectionError('MCP_AUTHORITY_DATABASE_ERROR')); };
    const check = () => { if (fault) fail('MCP_AUTHORITY_DATABASE_ERROR'); checkActive(); if (fault) fail('MCP_AUTHORITY_DATABASE_ERROR'); };
    if (typeof client.on !== 'function' || typeof client.removeListener !== 'function') {
      try { client.release(true); } catch {} fail('MCP_AUTHORITY_STORE_UNAVAILABLE');
    }
    client.on('error', onError);
    const guarded = { query: async (...args: unknown[]) => {
      check();
      const result = await Promise.race([Promise.resolve(Reflect.apply(client.query, client, args)), failure]);
      check(); return result;
    } } as unknown as Pick<PoolClient, 'query'>;
    try {
      await guarded.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await guarded.query("SET LOCAL lock_timeout='5s'");
      await guarded.query("SET LOCAL statement_timeout='10s'");
      await guarded.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
      await guarded.query("SET LOCAL synchronous_commit='on'");
      const result = await Promise.race([body(guarded), failure]);
      check();
      attempted = true;
      await guarded.query('COMMIT');
      check();
      returning = true; return result;
    } catch (error) {
      if (attempted) { discard = true; fail('MCP_AUTHORITY_COMMIT_UNKNOWN'); }
      if (fault) { discard = true; fail('MCP_AUTHORITY_DATABASE_ERROR'); }
      // An expired caller can still roll back a healthy connection. A failed
      // connection is discarded, never used for another command.
      try { await Promise.race([client.query('ROLLBACK'), failure]); }
      catch { discard = true; fail('MCP_AUTHORITY_ROLLBACK_FAILED'); }
      if (fault) { discard = true; fail('MCP_AUTHORITY_DATABASE_ERROR'); }
      if (error instanceof McpConnectionError) throw new McpConnectionError(SAFE_TRANSACTION_CODES.has(error.code) ? error.code : 'MCP_AUTHORITY_STATE_REFUSED');
      fail('MCP_AUTHORITY_DATABASE_ERROR');
    } finally {
      // Keep our listener through release; pg-pool reinstalls its idle listener
      // synchronously there. Remove only our own handler after that handoff.
      try { client.release(discard || fault); released = true; }
      catch { fail(attempted ? 'MCP_AUTHORITY_COMMIT_UNKNOWN' : 'MCP_AUTHORITY_DATABASE_ERROR'); }
      finally { if (released) client.removeListener('error', onError); }
      if (fault && returning) fail(attempted ? 'MCP_AUTHORITY_COMMIT_UNKNOWN' : 'MCP_AUTHORITY_DATABASE_ERROR');
    }
    return fail('MCP_AUTHORITY_DATABASE_ERROR');
  }
  async #version(client: Pick<PoolClient, 'query'>): Promise<void> {
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
  async #read(client: Pick<PoolClient, 'query'>, s: Scope, lock: 'UPDATE' | 'SHARE'): Promise<DiscoveryAuthorityState> {
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
  async #recoveryVersion(client: Pick<PoolClient, 'query'>): Promise<void> {
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

  async initializeGuardianBindings(): Promise<void> {
    await this.#transaction(async client => {
      await this.#version(client);
      await client.query(`CREATE TABLE ${this.#schema}.guardian_metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.guardian_metadata VALUES(true,1)`);
      await client.query(`CREATE TABLE ${this.#schema}.guardian_bindings(
        workspace_id text NOT NULL,run_id text NOT NULL,task_id text NOT NULL,
        version integer NOT NULL,binding jsonb NOT NULL,checksum text NOT NULL,
        PRIMARY KEY(workspace_id,run_id,task_id),
        FOREIGN KEY(workspace_id,run_id,task_id) REFERENCES ${this.#schema}.discoveries(workspace_id,run_id,task_id))`);
    });
  }
  async #guardianVersion(client: Pick<PoolClient, 'query'>): Promise<void> {
    const rows = (await client.query(`SELECT singleton,version FROM ${this.#schema}.guardian_metadata FOR SHARE`)).rows;
    if (rows.length !== 1 || rows[0].singleton !== true || rows[0].version !== 1) fail('MCP_GUARDIAN_BINDING_SCHEMA');
  }
  async #guardianBinding(client: Pick<PoolClient, 'query'>, authority: DiscoveryAuthorityState): Promise<GuardianBinding | null> {
    await this.#guardianVersion(client);
    const s = authority.scope;
    const rows = (await client.query(`SELECT version,binding,checksum FROM ${this.#schema}.guardian_bindings
      WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 FOR SHARE`, [s.workspaceId, s.runId, s.taskId])).rows;
    if (!rows.length) return null;
    if (rows.length !== 1 || rows[0].version !== 1 || digest(canonicalJson(data(rows[0].binding))) !== rows[0].checksum) fail('MCP_GUARDIAN_BINDING_CORRUPT');
    return validateGuardianBinding(rows[0].binding, authority);
  }
  /** Callback executes synchronously under the authority row lock. No binding grants effect authority. */
  async bindContainerGuardian(expected: DiscoveryAuthorityState, descriptor: GuardianDescriptor, assertLive: (state: DiscoveryAuthorityState) => void): Promise<GuardianBinding> {
    if (typeof assertLive !== 'function') fail('MCP_GUARDIAN_BINDING_INVALID');
    const captured = validateDiscoveryAuthorityState(expected), binding = createGuardianBinding(captured, descriptor), s = scope(captured.scope);
    const check = (state = captured) => {
      if (state.status !== 'IN_FLIGHT') fail('MCP_GUARDIAN_BINDING_REFUSED');
      const before = canonicalJson(state), returned: unknown = assertLive(state);
      if (isPromise(returned)) { void returned.catch(() => {}); fail('MCP_GUARDIAN_BINDING_REFUSED'); }
      if (before !== canonicalJson(state)) fail('MCP_GUARDIAN_BINDING_REFUSED');
    };
    check();
    return this.#transaction(async client => {
      const current = await this.#read(client, s, 'UPDATE');
      if (canonicalJson(current) !== canonicalJson(captured)) fail('MCP_GUARDIAN_BINDING_AUTHORITY_CHANGED'); check(current);
      await this.#guardianVersion(client); await this.#checkpointRecords(client, captured, await this.#guardianBinding(client, captured)); check();
      const json = canonicalJson(binding);
      await client.query(`INSERT INTO ${this.#schema}.guardian_bindings VALUES($1,$2,$3,1,$4::jsonb,$5)
        ON CONFLICT(workspace_id,run_id,task_id) DO NOTHING`, [s.workspaceId, s.runId, s.taskId, json, digest(json)]); check();
      const stored = await this.#guardianBinding(client, captured);
      if (canonicalJson(stored) !== json) fail('MCP_GUARDIAN_BINDING_CONFLICT');
      return binding;
    }, () => check());
  }
  async readGuardianEvidence(value: Scope): Promise<GuardianEvidence> {
    const s = scope(value);
    return this.#transaction(async client => {
      const authority = await this.#read(client, s, 'SHARE');
      return { authority, binding: await this.#guardianBinding(client, authority) };
    });
  }

  /** Explicit migration only. Reads never create checkpoint tables. */
  async initializeGuardianCheckpoints(): Promise<void> {
    await this.#transaction(async client => {
      await this.#version(client); await this.#guardianVersion(client);
      await client.query(`CREATE TABLE ${this.#schema}.guardian_checkpoint_metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.guardian_checkpoint_metadata VALUES(true,1)`);
      await client.query(`CREATE TABLE ${this.#schema}.guardian_checkpoints(
        workspace_id text NOT NULL,run_id text NOT NULL,task_id text NOT NULL,
        version integer NOT NULL,evidence jsonb NOT NULL,checksum text NOT NULL,
        PRIMARY KEY(workspace_id,run_id,task_id),
        FOREIGN KEY(workspace_id,run_id,task_id) REFERENCES ${this.#schema}.discoveries(workspace_id,run_id,task_id))`);
    });
  }
  async #checkpointRecords(client: Pick<PoolClient, 'query'>, authority: DiscoveryAuthorityState, binding: GuardianBinding | null) {
    const metadata = (await client.query(`SELECT singleton,version FROM ${this.#schema}.guardian_checkpoint_metadata FOR SHARE`)).rows;
    if (metadata.length !== 1 || metadata[0].singleton !== true || metadata[0].version !== 1) fail('MCP_GUARDIAN_CHECKPOINT_SCHEMA');
    const s = authority.scope;
    const rows = (await client.query(`SELECT version,evidence,checksum FROM ${this.#schema}.guardian_checkpoints
      WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 FOR SHARE`, [s.workspaceId,s.runId,s.taskId])).rows;
    if (!rows.length) return {checkpoints:[],closure:null};
    if (rows.length !== 1 || rows[0].version !== 1 || digest(canonicalJson(data(rows[0].evidence))) !== rows[0].checksum) fail('MCP_GUARDIAN_CHECKPOINT_CORRUPT');
    const value = data(rows[0].evidence) as {checkpoints:GuardianCheckpoint[];closure:GuardianClosure|null};
    if (Object.keys(value).sort().join() !== 'checkpoints,closure') fail('MCP_GUARDIAN_CHECKPOINT_CORRUPT');
    return validateGuardianCheckpointRecords(binding,value.checkpoints,value.closure);
  }
  async readGuardianCheckpointEvidence(value: Scope): Promise<GuardianCheckpointEvidence> {
    const s = scope(value);
    return this.#transaction(async client => {
      const authority = await this.#read(client,s,'SHARE'), binding = await this.#guardianBinding(client,authority);
      return {authority,binding,...await this.#checkpointRecords(client,authority,binding)};
    });
  }
  async #recordCheckpoint(expected: DiscoveryAuthorityState, head: string|null, envelope: string,
    check: (state: DiscoveryAuthorityState) => void, terminal?: {seal:string;witness:GuardianCloseWitness}) {
    const captured = validateDiscoveryAuthorityState(expected), s = scope(captured.scope), original = canonicalJson(captured);
    if (terminal) terminal = data(terminal) as {seal:string;witness:GuardianCloseWitness};
    if (typeof check !== 'function') fail('MCP_GUARDIAN_CHECKPOINT_INVALID');
    const checked = (state = captured) => {
      const before = canonicalJson(state), returned:unknown = check(state);
      if (isPromise(returned)) {void returned.catch(()=>{});fail('MCP_GUARDIAN_CHECKPOINT_INVALID');}
      if (before !== canonicalJson(state) || (!terminal && state.status !== 'IN_FLIGHT')) fail('MCP_GUARDIAN_CHECKPOINT_INVALID');
    };
    checked();
    return this.#transaction(async client => {
      const current = await this.#read(client,s,'UPDATE');
      if (canonicalJson(current) !== original) fail('MCP_GUARDIAN_CHECKPOINT_AUTHORITY_CHANGED'); checked(current);
      const binding = await this.#guardianBinding(client,current); if (!binding) fail('MCP_GUARDIAN_CHECKPOINT_INVALID');
      const before = await this.#checkpointRecords(client,current,binding); checked(current);
      const after = advanceGuardianCheckpoint(binding,before,head,envelope,terminal), json = canonicalJson(after);
      await client.query(`INSERT INTO ${this.#schema}.guardian_checkpoints VALUES($1,$2,$3,1,$4::jsonb,$5)
        ON CONFLICT(workspace_id,run_id,task_id) DO UPDATE SET evidence=EXCLUDED.evidence,checksum=EXCLUDED.checksum`,
        [s.workspaceId,s.runId,s.taskId,json,digest(json)]); checked(current);
      return after;
    },()=>checked());
  }
  /** Trusted host callback: live authorization runs under the same authority lock. */
  async recordGuardianCheckpoint(expected:DiscoveryAuthorityState,head:string|null,envelope:string,assertLive:(state:DiscoveryAuthorityState)=>void):Promise<GuardianCheckpoint> {
    return (await this.#recordCheckpoint(expected,head,envelope,assertLive)).checkpoints.find(record => record.envelope === envelope)!;
  }
  /** Historical audit only. Caller is trusted host code, not a cryptographically attested observer. */
  async recordGuardianClosed(expected:DiscoveryAuthorityState,head:string|null,envelope:string,seal:string,witness:GuardianCloseWitness,checkActive:()=>void):Promise<GuardianClosure> {
    return (await this.#recordCheckpoint(expected,head,envelope,checkActive,{seal,witness})).closure!;
  }

}
