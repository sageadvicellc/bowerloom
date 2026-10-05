import { isPromise } from 'node:util/types';
import { AdmissionError, identifier, validTime } from './validation.js';
import type { AdmissionControl, AdmissionControlBinding, AdmissionDispatchGate, AdmissionDispatchEnvelope } from './types.js';

const MAX_HR = (1n << 64n) - 1n;
const NS_MS = 1_000_000n;
const SAFE_CODES = new Set([
  'CONTROL_INPUT', 'CONTROL_CLOCK', 'CONTROL_EXPIRED', 'CONTROL_CANCELLED', 'CONTROL_FENCE',
  'CONTROL_CLOSED', 'CONTROL_TIMEOUT', 'CONTROL_OPERATION', 'CONTROL_GATE_CLOSED',
  'CONTROL_IDENTITY', 'CONTROL_REQUEST', 'CONTROL_CLAIM', 'CONTROL_OBSERVATION', 'CONTROL_CAPACITY', 'CONTROL_START',
  'DATABASE_ERROR', 'STORE_UNAVAILABLE', 'ROLLBACK_FAILED', 'COMMIT_UNKNOWN',
  'UNSUPPORTED_VERSION', 'UNKNOWN_ACCOUNT', 'CORRUPT_ACCOUNT', 'ACCOUNT_LIMIT', 'INVALID_ID', 'CLOCK_UNAVAILABLE',
]);
const failure = (code: string) => new AdmissionError(code, 'Controlled admission refused. The operation remains subject to its durable hold.');
const keys = (v: unknown, expected: string[]): Record<string, PropertyDescriptor> => {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw failure('CONTROL_INPUT');
  const d = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(v).length !== expected.length || Object.keys(d).sort().join() !== expected.sort().join()
    || Object.values(d).some(x => !Object.hasOwn(x, 'value') || !x.enumerable)) throw failure('CONTROL_INPUT');
  return d;
};
export function captureControl(value: AdmissionControl): Readonly<AdmissionControl> {
  const outer = keys(value, ['binding', 'signal', 'assert']);
  const fields = keys(outer.binding!.value, ['installationId', 'databaseName', 'admissionSchema', 'launcherId', 'accountId', 'accountAlias', 'requestDigest', 'authorizationRevision', 'expiresAtMs']);
  const binding = Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, d.value])) as unknown as AdmissionControlBinding;
  for (const name of ['installationId', 'databaseName', 'admissionSchema', 'launcherId', 'accountId', 'accountAlias'] as const) identifier(binding[name]);
  if (typeof binding.requestDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(binding.requestDigest)
    || typeof binding.authorizationRevision !== 'string' || !/^[a-f0-9]{64}$/.test(binding.authorizationRevision)) throw failure('CONTROL_INPUT');
  if (!validTime(binding.expiresAtMs) || !(outer.signal!.value instanceof AbortSignal) || typeof outer.assert!.value !== 'function') throw failure('CONTROL_INPUT');
  return Object.freeze({ binding: Object.freeze(binding), signal: outer.signal!.value, assert: outer.assert!.value });
}
export function parseHr(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw failure('CONTROL_CLOCK');
  const result = BigInt(value); if (result > MAX_HR) throw failure('CONTROL_CLOCK'); return result;
}
/** One local attempt. No renewed observation can extend its original deadline. */
export class AdmissionAttempt {
  readonly control: Readonly<AdmissionControl>;
  readonly failed: Promise<never>;
  #reject!: (error: AdmissionError) => void;
  #error: AdmissionError | null = null;
  #wall = 0; #hr = 0n; #notAfterWall: number; #notAfterHr: bigint;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #now: () => number; readonly #mono: () => bigint;
  constructor(control: AdmissionControl, now: () => number, mono: () => bigint) {
    this.control = captureControl(control); this.#now = now; this.#mono = mono;
    this.failed = new Promise((_, reject) => { this.#reject = reject; }); void this.failed.catch(() => {});
    const sample = this.#sample();
    this.#notAfterWall = this.control.binding.expiresAtMs;
    const remaining = this.#notAfterWall - sample.wall;
    if (!Number.isSafeInteger(remaining) || remaining <= 0) throw failure('CONTROL_EXPIRED');
    this.#notAfterHr = sample.hr + BigInt(remaining) * NS_MS;
    if (this.#notAfterHr > MAX_HR) throw failure('CONTROL_CLOCK');
    this.control.signal.addEventListener('abort', this.#abort, { once: true });
    try { this.check(); this.#arm(); } catch (e) { throw this.close(e); }
  }
  #abort = () => this.close(failure('CONTROL_CANCELLED'));
  #terminal(): void {
    if (this.#error) throw this.#error;
    if (this.control.signal.aborted) throw failure('CONTROL_CANCELLED');
  }
  #sample(): { wall: number; hr: bigint } {
    let hr: bigint, wall: number;
    try { hr = this.#mono(); this.#terminal(); wall = this.#now(); this.#terminal(); }
    catch (e) { this.#terminal(); throw failure('CONTROL_CLOCK'); }
    if (typeof hr !== 'bigint' || hr < 0n || hr > MAX_HR || !validTime(wall) || wall < this.#wall || hr < this.#hr) throw failure('CONTROL_CLOCK');
    this.#wall = wall; this.#hr = hr; return { wall, hr };
  }
  #arm(): void {
    clearTimeout(this.#timer);
    const ns = this.#notAfterHr - this.#hr;
    this.#timer = setTimeout(() => {
      try { this.check(); this.#arm(); } catch (e) { this.close(e); }
    }, Math.max(1, Math.min(2_147_483_647, Number(ns / NS_MS))));
  }
  check(): { wall: number; hr: bigint } {
    if (this.#error) throw this.#error;
    try {
      if (this.control.signal.aborted) throw failure('CONTROL_CANCELLED');
      const answer = this.control.assert();
      if (isPromise(answer)) void Promise.prototype.then.call(answer, undefined, () => {});
      // Trusted callbacks can synchronously close/abort this attempt. Reentrancy is not permission.
      this.#terminal();
      if (isPromise(answer)) throw failure('CONTROL_FENCE');
      if (answer !== undefined) throw failure('CONTROL_FENCE');
      const sample = this.#sample();
      if (sample.wall >= this.#notAfterWall || sample.hr >= this.#notAfterHr) throw failure('CONTROL_EXPIRED');
      this.#terminal(); return sample;
    } catch (e) { this.close(e); throw this.#error!; }
  }
  tighten(wall: number): void {
    const sample = this.check();
    if (!validTime(wall) || wall <= sample.wall) { this.close(failure('CONTROL_EXPIRED')); throw this.#error!; }
    const ns = sample.hr + BigInt(wall - sample.wall) * NS_MS;
    if (ns > MAX_HR) { this.close(failure('CONTROL_CLOCK')); throw this.#error!; }
    this.#notAfterWall = Math.min(this.#notAfterWall, wall);
    this.#notAfterHr = ns < this.#notAfterHr ? ns : this.#notAfterHr;
    this.check(); this.#arm();
  }
  close(error: unknown = failure('CONTROL_CLOSED')): AdmissionError {
    if (this.#error) return this.#error;
    // Fixed diagnostics only, including exceptions raised by the trusted host fence.
    this.#error = error instanceof AdmissionError && SAFE_CODES.has(error.code) ? failure(error.code) : failure('CONTROL_CLOSED');
    clearTimeout(this.#timer); this.control.signal.removeEventListener('abort', this.#abort); this.#reject(this.#error);
    return this.#error;
  }
  get closed(): boolean { return this.#error !== null; }
  snapshot(): { notAfterWallMs: number; notAfterHrNs: string; parentWallMs: number; parentHrNs: string } {
    const sample = this.check();
    return { notAfterWallMs: this.#notAfterWall, notAfterHrNs: this.#notAfterHr.toString(), parentWallMs: sample.wall, parentHrNs: sample.hr.toString() };
  }
  /** Bounds both acquisition and complete transactions. Late values may only be disposed. */
  wait<T>(action: (check: () => void) => Promise<T>, late?: (value: T) => void): Promise<T> {
    const sample = this.check(); const end = sample.hr + 2_000n * NS_MS;
    const deadline = end < this.#notAfterHr ? end : this.#notAfterHr;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const check = () => { const t = this.check(); if (t.hr >= deadline) { this.close(failure('CONTROL_TIMEOUT')); throw failure('CONTROL_TIMEOUT'); } };
      const finish = (error: unknown, value?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) { reject(this.close(error)); } else resolve(value as T);
      };
      const timer = setTimeout(() => { this.close(failure('CONTROL_TIMEOUT')); finish(failure('CONTROL_TIMEOUT')); }, Math.max(1, Number((deadline - sample.hr) / NS_MS)));
      void this.failed.catch(error => finish(error));
      const pending = Promise.resolve().then(() => { check(); return action(check); });
      void pending.then(value => {
        if (settled) { try { late?.(value); } catch {} return; }
        try { check(); finish(null, value); } catch (e) { try { late?.(value); } catch {} finish(e); }
      }, error => finish(error instanceof AdmissionError ? error : failure('CONTROL_OPERATION')));
    });
  }
}

export function createDispatchGate(attempt: AdmissionAttempt, facts: { reservationId: string; requestDigest: string; claimedAtMs: number },
  checkAdmission: (observation: unknown) => Promise<void>): { gate: AdmissionDispatchGate; consumed(): boolean; finish(): void } {
  let state: 'CLAIMED' | 'CHECKING' | 'ARMED' | 'CONSUMED' | 'CLOSED' = 'CLAIMED'; let generation = 0;
  const close = (e: unknown = failure('CONTROL_GATE_CLOSED')) => { state = 'CLOSED'; ++generation; attempt.close(e); };
  const gate = Object.freeze({
    async check(observation: unknown): Promise<void> {
      if (state === 'CHECKING' || state === 'CONSUMED' || state === 'CLOSED') { close(); throw failure('CONTROL_GATE_CLOSED'); }
      state = 'CHECKING'; const current = ++generation;
      try {
        attempt.check(); await checkAdmission(observation); attempt.check();
        if (state !== 'CHECKING' || generation !== current) throw failure('CONTROL_GATE_CLOSED');
        state = 'ARMED';
      } catch (e) { close(e); throw attempt.close(e); }
    },
    consume(): Readonly<AdmissionDispatchEnvelope> {
      try {
        attempt.check(); if (state !== 'ARMED') throw failure('CONTROL_GATE_CLOSED');
        const envelope = Object.freeze({ format: 'bowerloom/admission-dispatch/v1' as const, binding: attempt.control.binding, ...facts, ...attempt.snapshot() });
        state = 'CONSUMED'; return envelope;
      } catch (e) { close(e); throw attempt.close(e); }
    },
  });
  return { gate, consumed: () => state === 'CONSUMED' && !attempt.closed, finish: () => { if (state !== 'CONSUMED') close(); } };
}
