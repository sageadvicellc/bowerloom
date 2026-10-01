import type { Pool, PoolClient } from 'pg';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { createTaskState, parseProposal } from '../../broker/src/index.js';
import { requestCopy } from '../../admission/src/validation.js';
import { RuntimeError, identifier, schemaName } from './types.js';
import type { RunState, RunInput } from './types.js';
export function pin(input: RunInput): RunInput {
  let copy: RunInput;
  try { copy = structuredClone(input); } catch { throw new RuntimeError('INVALID_INPUT'); }
  if (Object.keys(copy).sort().join() !== 'plan,reservation,task,taskInput' || typeof copy.taskInput !== 'string'
    || Buffer.byteLength(copy.taskInput) > 65536) throw new RuntimeError('INVALID_INPUT');
  const state = createTaskState(copy.plan, copy.task); const reservation = requestCopy(copy.reservation);
  if (reservation.candidateRevision !== state.candidateRevision) throw new RuntimeError('CANDIDATE_MISMATCH');
  if (Buffer.byteLength(canonicalJson(copy)) > 1024 * 1024) throw new RuntimeError('INPUT_LIMIT');
  return copy;
}
export const runId = (input: RunInput): string => digest(canonicalJson({ workspaceId: input.task.workspaceId, runId: input.task.runId, taskId: input.task.taskId }));
function decode(value: RunState): RunState {
  if (!value || value.version !== 1 || Object.keys(value).sort().join() !== 'acceptance,cancelled,id,input,inputDigest,modelOutcome,process,proposal,reason,receipt,status,version'
    || !['QUEUED','WAITING_APPROVAL','HOLD','CANCELLED','COMPLETED','ACCEPTANCE_FAILED'].includes(value.status)
    || typeof value.cancelled !== 'boolean') throw new RuntimeError('CORRUPT_RUN');
  const input = pin(value.input);
  if (value.id !== runId(input) || value.inputDigest !== digest(canonicalJson(input))) throw new RuntimeError('CORRUPT_RUN');
  if (value.proposal) {
    const proposal = parseProposal(JSON.stringify(value.proposal));
    if (proposal.candidateRevision !== input.plan.candidateRevision || proposal.ownerEpoch !== input.task.ownerEpoch
      || canonicalJson(proposal.scope) !== canonicalJson({ workspaceId: input.task.workspaceId, runId: input.task.runId, taskId: input.task.taskId })) throw new RuntimeError('PROPOSAL_BINDING');
  }
  if (value.process && (value.process.candidateRevision !== input.plan.candidateRevision || !value.process.reservationId
    || !Number.isSafeInteger(value.process.pid) || value.process.pid < 1 || value.process.groupId !== value.process.pid)) throw new RuntimeError('CORRUPT_PROCESS');
  if (value.receipt && (!value.proposal || value.receipt.actionDigest !== digest(canonicalJson(value.proposal))
    || value.receipt.afterDigest !== digest(value.proposal.edit.content))) throw new RuntimeError('RECEIPT_BINDING');
  if (value.status === 'COMPLETED' && (!value.receipt || value.acceptance?.accepted !== true)) throw new RuntimeError('CORRUPT_RUN');
  return structuredClone(value);
}
export class RuntimeLedger {
  readonly #pool: Pick<Pool, 'connect'>; readonly #schema: string;
  constructor(pool: Pick<Pool, 'connect'>, schema: string) { this.#pool = pool; this.#schema = schemaName(schema); }
  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    let client; try { client = await this.#pool.connect(); } catch { throw new RuntimeError('STORE_UNAVAILABLE'); }
    let committing = false; let discard = false;
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL synchronous_commit='on'");
      const result = await operation(client); committing = true; await client.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; throw new RuntimeError('COMMIT_UNKNOWN'); }
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error instanceof RuntimeError ? error : new RuntimeError('DATABASE_ERROR');
    } finally { client.release(discard); }
  }
  async createSchema(): Promise<void> {
    await this.#transaction(async client => {
      await client.query(`CREATE SCHEMA ${this.#schema}`);
      await client.query(`CREATE TABLE ${this.#schema}.metadata (singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL)`);
      await client.query(`INSERT INTO ${this.#schema}.metadata VALUES (true,1)`);
      await client.query(`CREATE TABLE ${this.#schema}.runs (id text PRIMARY KEY, state jsonb NOT NULL, checksum text NOT NULL)`);
    });
  }
  async change(id: string, update: (state: RunState) => void, initial?: RunState): Promise<RunState> {
    identifier(id);
    return this.#transaction(async client => {
      const metadata = (await client.query(`SELECT * FROM ${this.#schema}.metadata FOR SHARE`)).rows;
      if (metadata.length !== 1 || metadata[0].version !== 1) throw new RuntimeError('UNSUPPORTED_VERSION');
      if (initial) await client.query(`INSERT INTO ${this.#schema}.runs VALUES ($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`, [id, canonicalJson(initial), digest(canonicalJson(initial))]);
      const rows = (await client.query(`SELECT state,checksum FROM ${this.#schema}.runs WHERE id=$1 FOR UPDATE`, [id])).rows;
      if (rows.length !== 1) throw new RuntimeError('UNKNOWN_RUN');
      if (digest(canonicalJson(rows[0].state)) !== rows[0].checksum) throw new RuntimeError('CORRUPT_RUN');
      const state = decode(rows[0].state); if (state.id !== id) throw new RuntimeError('CORRUPT_RUN');
      const result = update(state) as unknown;
      if (result !== undefined) throw new RuntimeError('INVALID_MUTATOR');
      const output = decode(state); const json = canonicalJson(output);
      if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw new RuntimeError('STATE_LIMIT');
      await client.query(`UPDATE ${this.#schema}.runs SET state=$2::jsonb,checksum=$3 WHERE id=$1`, [id,json,digest(json)]);
      return output;
    });
  }
  async create(value: RunInput): Promise<RunState> {
    const input = pin(value); const id = runId(input); const inputDigest = digest(canonicalJson(input));
    const initial: RunState = { version: 1, id, input, inputDigest, cancelled: false, status: 'QUEUED', reason: null,
      process: null, modelOutcome: null, proposal: null, receipt: null, acceptance: null };
    return this.change(id, state => { if (state.inputDigest !== inputDigest) throw new RuntimeError('RUN_CONFLICT'); }, initial);
  }
  read(id: string): Promise<RunState> { return this.change(id, () => {}); }
}
