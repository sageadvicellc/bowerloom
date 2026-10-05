import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { createAccount, acceptObservation, evaluateAdmission, evaluateLaunch } from './policy.js';
import { AdmissionError, identifier, requestCopy, proofCopy, stateCopy, validTime, observationCopy, policyCopy } from './validation.js';
import type { AccountState, AdmissionPolicy, ReservationRequest, Reservation, ReservationView, ReserveResult, LaunchResult, ReconciliationProof } from './types.js';
export type * from './types.js';
export { AdmissionError } from './validation.js';
export { createAccount, acceptObservation, evaluateAdmission, evaluateLaunch } from './policy.js';
export const ADMISSION_VERSION = 1;
const own = <T>(values: Record<string, T>, key: string): T | undefined => Object.hasOwn(values, key) ? values[key] : undefined;
const view = (reservation: Reservation): ReservationView => { const { permitHash: _redacted, ...result } = structuredClone(reservation); return result; };
const observationSnapshot = (value: unknown): unknown => { try { return observationCopy(value); } catch { return undefined; } };
async function query(client: Pick<PoolClient, 'query'>, sql: string, values?: unknown[]) {
  try { return await client.query(sql, values); }
  catch { throw new AdmissionError('DATABASE_ERROR', 'The admission database operation failed. No retry was attempted.'); }
}
export class PostgresAdmission {
  readonly #pool: Pick<Pool, 'connect'>;
  readonly #schema: string;
  readonly #clock: () => number;
  readonly #launcherId: string;
  constructor(pool: Pick<Pool, 'connect'>, options: { schema: string; launcherId: string; now?: () => number }) {
    if (typeof options.schema !== 'string' || !/^trellis_[a-z][a-z0-9_]{0,46}$/.test(options.schema)) throw new AdmissionError('INVALID_SCHEMA', 'Use a bounded explicit trellis_ schema.');
    this.#launcherId = identifier(options.launcherId);
    this.#pool = pool; this.#schema = `"${options.schema}"`; this.#clock = options.now ?? Date.now;
  }
  #now(): number {
    const now = this.#clock(); if (!validTime(now)) throw new AdmissionError('CLOCK_UNAVAILABLE', 'A valid controller clock is required.'); return now;
  }
  async #transaction<T>(operation: (client: Pick<PoolClient, 'query'>) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.#pool.connect(); } catch { throw new AdmissionError('STORE_UNAVAILABLE', 'The admission database is unavailable.'); }
    let committing = false, discard = false, fault = false, released = false, returning = false;
    const databaseError = () => new AdmissionError('DATABASE_ERROR', 'The admission database operation failed. No retry was attempted.');
    const commitUnknown = () => new AdmissionError('COMMIT_UNKNOWN', 'Admission commit acknowledgement failed. Lookup and trusted reconciliation are required; do not launch or retry automatically.');
    let rejectFault!: (error: AdmissionError) => void;
    const failure = new Promise<never>((_, reject) => { rejectFault = reject; });
    void failure.catch(() => {});
    // A checked-out pg client no longer has the pool's idle error listener.
    // Latch only the fault, never the driver's private message or connection details.
    const onError = () => { if (fault) return; fault = true; discard = true; rejectFault(databaseError()); };
    const check = () => { if (fault) throw databaseError(); };
    if (typeof client.on !== 'function' || typeof client.removeListener !== 'function') {
      try { client.release(true); } catch { /* No usable event boundary; do not issue queries. */ }
      throw new AdmissionError('STORE_UNAVAILABLE', 'The admission database is unavailable.');
    }
    client.on('error', onError);
    const guarded = { query: async (...args: unknown[]) => {
      check();
      const result = await Promise.race([Promise.resolve(Reflect.apply(client.query, client, args)), failure]);
      check(); return result;
    } } as unknown as Pick<PoolClient, 'query'>;
    try {
      await query(guarded, 'BEGIN ISOLATION LEVEL READ COMMITTED');
      await query(guarded, "SET LOCAL lock_timeout='5s'"); await query(guarded, "SET LOCAL statement_timeout='10s'");
      await query(guarded, "SET LOCAL idle_in_transaction_session_timeout='10s'"); await query(guarded, "SET LOCAL synchronous_commit='on'");
      const result = await Promise.race([operation(guarded), failure]);
      check(); committing = true; await query(guarded, 'COMMIT'); check();
      returning = true; return result;
    } catch (error) {
      if (committing) { discard = true; throw commitUnknown(); }
      if (fault) { discard = true; throw databaseError(); }
      // Roll back only a healthy connection; a latched fault forbids more commands.
      try { await Promise.race([client.query('ROLLBACK'), failure]); }
      catch { discard = true; throw new AdmissionError('ROLLBACK_FAILED', 'Admission rollback acknowledgement failed; the connection was discarded.'); }
      if (fault) { discard = true; throw databaseError(); }
      if (error instanceof AdmissionError) throw error;
      throw databaseError();
    } finally {
      // Retain our consuming listener until the pool synchronously regains ownership.
      // If release throws, keep it attached to the otherwise unowned client.
      try { client.release(discard || fault); released = true; }
      catch { throw committing ? commitUnknown() : databaseError(); }
      finally { if (released) client.removeListener('error', onError); }
      if (fault && returning) throw committing ? commitUnknown() : databaseError();
    }
  }
  async createSchema(registrations: { accountId: string; aliases: string[]; policy: AdmissionPolicy }[]): Promise<void> {
    if (!Array.isArray(registrations) || registrations.length < 1 || registrations.length > 16) throw new AdmissionError('INVALID_ACCOUNTS', 'Register between one and sixteen canonical accounts.');
    const states = registrations.map(value => createAccount(value.accountId, value.aliases, value.policy));
    const aliases = states.flatMap(state => state.aliases);
    if (new Set(states.map(state => state.accountId)).size !== states.length || new Set(aliases).size !== aliases.length) throw new AdmissionError('DUPLICATE_ACCOUNT', 'Canonical accounts and their aliases must be distinct.');
    await this.#transaction(async client => {
      await query(client, `CREATE SCHEMA ${this.#schema}`);
      await query(client, `CREATE TABLE ${this.#schema}.metadata (singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL)`);
      await query(client, `INSERT INTO ${this.#schema}.metadata VALUES (true,1)`);
      await query(client, `CREATE TABLE ${this.#schema}.accounts (account_id text PRIMARY KEY, version integer NOT NULL, state jsonb NOT NULL, checksum text NOT NULL)`);
      await query(client, `CREATE TABLE ${this.#schema}.aliases (alias text PRIMARY KEY, account_id text NOT NULL REFERENCES ${this.#schema}.accounts(account_id))`);
      for (const state of states) {
        const json = canonicalJson(state);
        await query(client, `INSERT INTO ${this.#schema}.accounts VALUES ($1,1,$2::jsonb,$3)`, [state.accountId, json, digest(json)]);
        for (const alias of state.aliases) await query(client, `INSERT INTO ${this.#schema}.aliases VALUES ($1,$2)`, [alias, state.accountId]);
      }
    });
  }
  async #account<T>(aliasInput: string, operation: (state: AccountState) => T): Promise<T> {
    const alias = identifier(aliasInput);
    return this.#transaction(async client => {
      const metadata = (await query(client, `SELECT singleton, version FROM ${this.#schema}.metadata FOR SHARE`)).rows;
      if (metadata.length !== 1 || metadata[0].singleton !== true || metadata[0].version !== ADMISSION_VERSION) throw new AdmissionError('UNSUPPORTED_VERSION', 'The admission schema is unsupported.');
      const rows = (await query(client, `SELECT account_id, version, state, checksum FROM ${this.#schema}.accounts
        WHERE account_id=(SELECT account_id FROM ${this.#schema}.aliases WHERE alias=$1) FOR UPDATE`, [alias])).rows;
      if (rows.length !== 1) throw new AdmissionError('UNKNOWN_ACCOUNT', 'The controller has not registered this account alias.');
      const row = rows[0];
      if (row.version !== ADMISSION_VERSION) throw new AdmissionError('UNSUPPORTED_VERSION', 'The account state version is unsupported.');
      const state = stateCopy(row.state);
      if (state.accountId !== row.account_id || !state.aliases.includes(alias) || digest(canonicalJson(state)) !== row.checksum) throw new AdmissionError('CORRUPT_ACCOUNT', 'The account binding or checksum is invalid.');
      const result = structuredClone(operation(state));
      const json = canonicalJson(stateCopy(state));
      if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new AdmissionError('ACCOUNT_LIMIT', 'The bounded account history is full.');
      await query(client, `UPDATE ${this.#schema}.accounts SET state=$2::jsonb, checksum=$3 WHERE account_id=$1`, [state.accountId, json, digest(json)]);
      return result;
    });
  }
  #observe(state: AccountState, value: unknown, now: number): { accepted: boolean; reason: string } {
    const observation = acceptObservation(state, value, now); Object.assign(state, observation.state);
    return { accepted: observation.accepted, reason: observation.reason };
  }
  observe(accountAlias: string, observation: unknown): Promise<{ accepted: boolean; reason: string }> {
    const snapshot = observationSnapshot(observation);
    return this.#account(accountAlias, state => this.#observe(state, snapshot, this.#now()));
  }
  policy(accountAlias: string): Promise<AdmissionPolicy> {
    return this.#account(accountAlias, state => structuredClone(state.policy));
  }
  // Trusted controller API. Preserve account history and claims while replacing an explicit policy.
  replacePolicy(accountAlias: string, expected: AdmissionPolicy, replacement: AdmissionPolicy): Promise<AdmissionPolicy> {
    const previous = policyCopy(expected); const next = policyCopy(replacement);
    return this.#account(accountAlias, state => {
      if (canonicalJson(state.policy) === canonicalJson(next)) return structuredClone(state.policy);
      if (canonicalJson(state.policy) !== canonicalJson(previous)) {
        throw new AdmissionError('POLICY_CONFLICT', 'The account policy changed. Read its current policy before another replacement.');
      }
      state.policy = next;
      return structuredClone(state.policy);
    });
  }
  reserve(input: ReservationRequest, observation: unknown): Promise<ReserveResult> {
    // The alias alone identifies the trusted account even if the rest of a request is refused.
    const alias = identifier(Object.getOwnPropertyDescriptor(input ?? {}, 'accountAlias')?.value);
    const snapshot = observationSnapshot(observation);
    let pinned: ReservationRequest | null = null;
    try { pinned = requestCopy(input); } catch { /* Persist a valid observation even when this request is denied. */ }
    return this.#account<ReserveResult>(alias, state => {
      const now = this.#now(); const observed = this.#observe(state, snapshot, now);
      if (!observed.accepted) return { kind: 'denied', reason: observed.reason };
      if (!pinned) return { kind: 'denied', reason: 'INVALID_REQUEST' };
      const request = pinned;
      const requestDigest = digest(canonicalJson(request)); const existing = own(state.reservations, request.jobId);
      if (existing) return existing.requestDigest === requestDigest ? { kind: 'existing', reservation: view(existing) } : { kind: 'denied', reason: 'JOB_CONFLICT' };
      const decision = evaluateAdmission(state, request, now);
      if (!decision.allowed) return { kind: 'denied', reason: decision.reason };
      if (Object.keys(state.reservations).length >= 1024) return { kind: 'denied', reason: 'ACCOUNT_HISTORY_LIMIT' };
      const launchPermit = randomBytes(32).toString('hex');
      const retained = Object.fromEntries(decision.windows.map(name => [name, { percent: request.allowancePercent[name]!,
        resetAtMs: state.observation!.windows[name]!.resetAtMs, durationMs: state.observation!.windows[name]!.durationMs }]));
      const reservation: Reservation = { request, requestDigest, reservationId: digest(canonicalJson({ accountId: state.accountId, jobId: request.jobId, requestDigest })),
        status: 'RESERVED', createdAtMs: now, claimedAtMs: null, launcherId: null, completedAtMs: null, processRef: null, permitHash: digest(launchPermit), retained, proofs: [] };
      state.reservations[request.jobId] = reservation;
      return { kind: 'accepted', reservation: view(reservation), launchPermit };
    });
  }
  lookup(accountAlias: string, jobId: string): Promise<ReservationView | null> {
    identifier(jobId);
    return this.#account(accountAlias, state => { const reservation = own(state.reservations, jobId); return reservation ? view(reservation) : null; });
  }
  async launchOnce(accountAlias: string, jobId: string, launchPermit: string, observation: unknown,
    start: (request: ReservationRequest) => Promise<{ processRef: string }>): Promise<LaunchResult> {
    type Claim = { kind: 'claimed'; request: ReservationRequest; claimedAtMs: number; validThroughMs: number } | { kind: 'denied'; reason: string };
    const snapshot = observationSnapshot(observation);
    const claim = await this.#account<Claim>(accountAlias, state => {
      const now = this.#now(); const observed = this.#observe(state, snapshot, now);
      if (!observed.accepted) return { kind: 'denied', reason: observed.reason };
      let reservation: Reservation | undefined;
      try { reservation = own(state.reservations, identifier(jobId)); } catch { return { kind: 'denied', reason: 'INVALID_JOB' }; }
      if (!reservation) return { kind: 'denied', reason: 'UNKNOWN_JOB' };
      if (reservation.status !== 'RESERVED') return { kind: 'denied', reason: 'ALREADY_CLAIMED' };
      if (typeof launchPermit !== 'string' || !/^[a-f0-9]{64}$/.test(launchPermit)
        || !timingSafeEqual(Buffer.from(digest(launchPermit)), Buffer.from(reservation.permitHash!))) return { kind: 'denied', reason: 'INVALID_PERMIT' };
      if (typeof start !== 'function') return { kind: 'denied', reason: 'INVALID_LAUNCHER' };
      const decision = evaluateLaunch(state, reservation.request, now);
      if (!decision.allowed) return { kind: 'denied', reason: decision.reason };
      reservation.status = 'LAUNCHING'; reservation.claimedAtMs = now; reservation.launcherId = this.#launcherId; reservation.permitHash = null;
      const validThroughMs = Math.min(Number.MAX_SAFE_INTEGER, state.observation!.observedAtMs + state.policy.maxObservationAgeMs,
        ...Object.entries(state.observation!.windows).flatMap(([name, window]) => window === null ? []
          : [Math.min(window.resetAtMs, state.highWater[name]!.resetAtMs) - 1]));
      return { kind: 'claimed', request: structuredClone(reservation.request), claimedAtMs: now, validThroughMs };
    });
    if (claim.kind === 'denied') return claim;
    try {
      const launchTime = this.#now();
      if (launchTime < claim.claimedAtMs || launchTime > claim.validThroughMs) {
        await this.#account(accountAlias, state => { const current = own(state.reservations, jobId); if (current?.status === 'LAUNCHING') current.status = 'UNKNOWN'; });
        return { kind: 'denied', reason: 'LAUNCH_EVIDENCE_EXPIRED' };
      }
      const result = await start(structuredClone(claim.request)); const processRef = identifier(result?.processRef);
      const reservation = await this.#account(accountAlias, state => {
        const current = own(state.reservations, jobId);
        if (!current || current.status !== 'LAUNCHING') throw new AdmissionError('LAUNCH_UNKNOWN', 'The launch claim changed before its process was recorded.');
        current.status = 'RUNNING'; current.processRef = processRef; return view(current);
      });
      return { kind: 'started', reservation };
    } catch {
      try { await this.#account(accountAlias, state => { const current = own(state.reservations, jobId); if (current?.status === 'LAUNCHING') current.status = 'UNKNOWN'; }); }
      catch { /* A durable LAUNCHING record also keeps its slot and allowance. */ }
      throw new AdmissionError('LAUNCH_UNKNOWN', 'The launch outcome is uncertain. Retained capacity requires trusted reconciliation; never launch this job again automatically.');
    }
  }
  complete(accountAlias: string, jobId: string, input: ReconciliationProof): Promise<ReservationView> {
    const proof = proofCopy(input); identifier(jobId);
    return this.#account(accountAlias, state => {
      const current = own(state.reservations, jobId);
      if (!current || !['RUNNING', 'COMPLETED'].includes(current.status) || proof.kind !== 'completed' || proof.processRef !== current.processRef) throw new AdmissionError('INVALID_COMPLETION', 'A matching running process and trusted completion proof are required.');
      this.#resolve(current, proof, this.#now()); return view(current);
    });
  }
  reconcile(input: ReservationRequest, inputProof: ReconciliationProof): Promise<ReservationView> {
    const request = requestCopy(input); const proof = proofCopy(inputProof);
    return this.#account(request.accountAlias, state => {
      const now = this.#now(); let current = own(state.reservations, request.jobId);
      const requestDigest = digest(canonicalJson(request));
      if (!current) {
        if (proof.kind !== 'not-started' || proof.processRef !== null || proof.observedAtMs > now || Object.keys(state.reservations).length >= 1024) throw new AdmissionError('INVALID_RECONCILIATION', 'A missing reservation requires a trusted not-started proof.');
        current = { request, requestDigest, reservationId: digest(canonicalJson({ accountId: state.accountId, jobId: request.jobId, requestDigest })),
          status: 'CANCELLED', createdAtMs: proof.observedAtMs, claimedAtMs: null, launcherId: null, completedAtMs: proof.observedAtMs, processRef: null, permitHash: null, retained: {}, proofs: [proof] };
        state.reservations[request.jobId] = current; return view(current);
      }
      if (current.requestDigest !== requestDigest) throw new AdmissionError('JOB_CONFLICT', 'Reconciliation must identify the original pinned request.');
      this.#resolve(current, proof, now); return view(current);
    });
  }
  #resolve(current: Reservation, proof: ReconciliationProof, now: number): void {
    if (proof.observedAtMs > now || proof.observedAtMs < (current.claimedAtMs ?? current.createdAtMs)) throw new AdmissionError('INVALID_PROOF', 'Reconciliation needs a current ordered observation.');
    if (['COMPLETED', 'CANCELLED'].includes(current.status)) {
      if (canonicalJson(current.proofs.at(-1)) !== canonicalJson(proof)) throw new AdmissionError('RECONCILIATION_CONFLICT', 'A terminal job already has a different proof.');
      return;
    }
    if (current.proofs.length >= 16) throw new AdmissionError('RECONCILIATION_LIMIT', 'The reconciliation history is full.');
    if (proof.kind === 'not-started') {
      if (['LAUNCHING', 'UNKNOWN'].includes(current.status) && proof.fencedLauncherId !== current.launcherId) throw new AdmissionError('LAUNCHER_FENCE_REQUIRED', 'A trusted supervisor must attest that the bound launcher is terminated or unable to dispatch before releasing this claim.');
      if (current.status === 'RUNNING' || proof.processRef !== null) throw new AdmissionError('INVALID_PROOF', 'A known running process cannot be reconciled as not started.');
      current.status = 'CANCELLED'; current.retained = {}; current.processRef = null;
    } else {
      if (current.status === 'RESERVED' || proof.processRef === null || (current.processRef !== null && current.processRef !== proof.processRef)) throw new AdmissionError('INVALID_PROOF', 'Completion needs an identified claimed process.');
      current.status = 'COMPLETED'; current.processRef = proof.processRef;
    }
    current.permitHash = null; current.completedAtMs = proof.observedAtMs; current.proofs.push(structuredClone(proof));
  }
}
