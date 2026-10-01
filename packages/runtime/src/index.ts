import { DBOS } from '@dbos-inc/dbos-sdk';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { ActionBroker, createTaskState, parseProposal, systemClock } from '../../broker/src/index.js';
import type { IdentityProvider, WorkspaceEffects, ApprovalRequest } from '../../broker/src/index.js';
import { PostgresBrokerStore } from '../../broker-postgres/src/index.js';
import { PostgresAdmission } from '../../admission/src/index.js';
import type { ObservationReader, ReserveResult } from '../../admission/src/index.js';
import { Coordinator } from './coordinator.js';
import { RuntimeLedger, pin, runId } from './ledger.js';
import { RuntimeError, identifier } from './types.js';
import type { RunInput, RunState, ModelAdapter, ModelProcess, AcceptanceReader } from './types.js';
export type * from './types.js';
export { RuntimeError, RuntimeLedger, SyntheticProcessAdapter };
import { SyntheticProcessAdapter } from './process.js';
interface Dependencies {
  pool: Pick<Pool, 'connect'>;
  brokerStore: PostgresBrokerStore;
  effects: WorkspaceEffects;
  identity: IdentityProvider;
  ownerCredential: unknown;
  recoveryCredential: unknown;
  observations: ObservationReader;
  models: ModelAdapter;
  acceptance: AcceptanceReader;
}
interface Options { installationId: string; schema: string; admissionSchema: string; systemDatabaseUrl: string }
export class SupervisedRuntime {
  readonly #deps: Dependencies; readonly #options: Options; readonly #coordinator: Coordinator;
  readonly #ledger: RuntimeLedger; readonly #admission: PostgresAdmission; readonly #broker: ActionBroker;
  readonly #active = new Map<string, { worker: ModelProcess; abort: AbortController }>();
  readonly #cancelled = new Set<string>();
  readonly #inflight = new Map<string, { abort: AbortController; done: Promise<void> }>();
  readonly #workflow: (id: string) => Promise<RunState>;
  #closing = false;
  get launcherId(): string { return this.#coordinator.launcherId; }
  private constructor(deps: Dependencies, options: Options, coordinator: Coordinator) {
    this.#deps = deps; this.#options = options; this.#coordinator = coordinator;
    this.#ledger = new RuntimeLedger(deps.pool, options.schema);
    this.#admission = new PostgresAdmission(deps.pool, { schema: options.admissionSchema, launcherId: coordinator.launcherId });
    this.#broker = new ActionBroker({ store: deps.brokerStore, identity: deps.identity, clock: systemClock, effects: {
      apply: async (request, signal) => { await coordinator.guard(); return deps.effects.apply(request, AbortSignal.any([signal,coordinator.signal])); },
      lookup: request => deps.effects.lookup(request),
    } });
    this.#workflow = DBOS.registerWorkflow(async (id: string) => this.#execute(id), { name: 'trellisSyntheticSupervisedV1' });
  }
  static async open(deps: Dependencies, options: Options): Promise<SupervisedRuntime> {
    identifier(options.installationId);
    if (DBOS.isInitialized() || Object.keys(process.env).some(key => key.startsWith('DBOS__') || key === 'DBOS_CONDUCTOR_KEY')) throw new RuntimeError('DBOS_ENVIRONMENT_REFUSED');
    let url; try { url = new URL(options.systemDatabaseUrl); } catch { throw new RuntimeError('INVALID_DATABASE'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      || url.search || url.hash || url.pathname.length < 2) throw new RuntimeError('LOCAL_DATABASE_REQUIRED');
    const coordinator = await Coordinator.acquire(deps.pool, options.installationId, decodeURIComponent(url.pathname.slice(1)));
    try {
      const runtime = new SupervisedRuntime(deps, options, coordinator);
      DBOS.setConfig({ name: 'trellis-synthetic-runtime', applicationVersion: '0.7-alpha-runtime-v1', systemDatabaseUrl: options.systemDatabaseUrl,
        executorID: `trellis-${options.installationId}`, systemDatabasePoolSize: 4, enableOTLP: false, tracingEnabled: false,
        runAdminServer: false, logLevel: 'error' });
      await DBOS.launch(); return runtime;
    } catch { await coordinator.close(); throw new RuntimeError('RUNTIME_START_FAILED'); }
  }
  async #check(id: string): Promise<RunState> {
    await this.#coordinator.guard();
    if (this.#closing) throw new RuntimeError('RUNTIME_CLOSING');
    const state = await this.#ledger.read(id);
    if (state.cancelled || this.#cancelled.has(id)) throw new RuntimeError('CANCELLED');
    return state;
  }
  async submit(input: RunInput): Promise<string> {
    await this.#coordinator.guard(); const pinned = pin(input); const state = await this.#ledger.create(pinned);
    const task = createTaskState(pinned.plan, pinned.task);
    try { await this.#deps.brokerStore.seed(task); }
    catch (error) {
      if ((error as { code?: string }).code !== 'SCOPE_EXISTS') throw error;
      const current = await this.#deps.brokerStore.read(task.scope);
      for (const key of ['candidateRevision','task','ownerSubject','ownerEpoch','approverSubjects','readyAtMs','leaseExpiresAtMs','completedDependencies'] as const) {
        if (canonicalJson(current[key]) !== canonicalJson(task[key])) throw new RuntimeError('TASK_BINDING');
      }
    }
    if (!state.cancelled) await DBOS.startWorkflow(this.#workflow, { workflowID: state.id })(state.id);
    return state.id;
  }
  async status(id: string): Promise<{ run: RunState; reservation: Awaited<ReturnType<PostgresAdmission['lookup']>>; allowanceHeld: boolean }> {
    const run = await this.#ledger.read(id); const request = run.input.reservation;
    const reservation = await this.#admission.lookup(request.accountAlias, request.jobId);
    return { run, reservation, allowanceHeld: Boolean(reservation && Object.keys(reservation.retained).length) };
  }
  async #outcome(id: string, worker: ModelProcess): Promise<void> {
    await this.#ledger.change(id, state => {
      if (!state.modelOutcome) state.modelOutcome = { processRef: worker.identity.processRef, completedAtMs: Date.now(), proofRef: `reaped-${randomUUID()}` };
    });
    await this.#completeReservation(id);
  }
  async #completeReservation(id: string): Promise<void> {
    const state = await this.#ledger.read(id); if (!state.modelOutcome) return;
    const request = state.input.reservation; const reservation = await this.#admission.lookup(request.accountAlias, request.jobId);
    if (!reservation) throw new RuntimeError('MISSING_RESERVATION');
    const proof = { kind: 'completed' as const, observedAtMs: state.modelOutcome.completedAtMs, processRef: state.modelOutcome.processRef,
      proofRef: state.modelOutcome.proofRef, fencedLauncherId: null };
    if (['RUNNING','COMPLETED'].includes(reservation.status)) await this.#admission.complete(request.accountAlias, request.jobId, proof);
    else if (['LAUNCHING','UNKNOWN'].includes(reservation.status)) await this.#admission.reconcile(request, proof);
  }
  async #capture(id: string, admission: ReserveResult | null): Promise<void> {
    if (this.#inflight.has(id) || new Set([...this.#inflight.keys(), ...this.#active.keys()]).size >= 2) throw new RuntimeError('OWNED_PROCESS_LIMIT');
    const abort = new AbortController(); let finished!: () => void;
    const done = new Promise<void>(resolve => { finished = resolve; }); this.#inflight.set(id, { abort, done });
    let worker: ModelProcess | undefined; let reaped = false;
    try {
      const state = await this.#check(id);
      if (state.proposal) { await this.#completeReservation(id); return; }
      if (admission?.kind !== 'accepted') throw new RuntimeError(admission?.kind === 'denied' ? `ADMISSION_${admission.reason}` : 'LAUNCH_RECONCILIATION_REQUIRED');
      const request = state.input.reservation;
      const launched = await this.#admission.launchOnce(request.accountAlias, request.jobId, admission.launchPermit,
        await this.#deps.observations.read(request.accountAlias), async () => {
          await this.#check(id); // Recheck the lock inside the consumed claim, immediately before creating a child.
          this.#coordinator.assert();
          worker = await this.#deps.models.start({ launcherId: this.launcherId, taskInput: state.input.taskInput, modelRoute: request.modelRoute },
            AbortSignal.any([abort.signal, this.#coordinator.signal]));
          this.#active.set(id, { worker, abort });
          await this.#ledger.change(id, current => { current.process = { ...worker!.identity, reservationId: admission.reservation.reservationId,
            candidateRevision: current.input.plan.candidateRevision }; });
          return { processRef: worker.identity.processRef };
        });
      if (launched.kind !== 'started' || !worker) {
        const held = await this.#admission.lookup(request.accountAlias, request.jobId);
        if (held?.launcherId && held.launcherId !== this.launcherId) throw new RuntimeError('FOREIGN_LAUNCHER_RECONCILIATION_REQUIRED');
        throw new RuntimeError(launched.kind === 'denied' ? launched.reason : 'LAUNCH_UNKNOWN');
      }
      const output = await worker.result; reaped = true;
      const proposal = parseProposal(output); await this.#check(id);
      await this.#ledger.change(id, current => { current.proposal = proposal; });
      await this.#outcome(id, worker);
    } catch (error) {
      if (worker) {
        try { await worker.terminate(); reaped = true; await this.#outcome(id, worker); }
        catch { /* Uncertain termination or acknowledgement retains the account hold. */ }
      }
      throw error;
    } finally {
      if (!worker || reaped) this.#active.delete(id); // Retain uncertain owned handles for close() cleanup.
      this.#inflight.delete(id); finished();
    }
  }
  async #execute(id: string): Promise<RunState> {
    const step = <T>(name: string, action: () => Promise<T>) => DBOS.runStep(action, { name, retriesAllowed: false });
    try {
      const admission = await step('admission', async () => {
        const state = await this.#check(id); if (state.proposal) return null;
        return this.#admission.reserve(state.input.reservation, await this.#deps.observations.read(state.input.reservation.accountAlias));
      });
      await step('proposal-capture', () => this.#capture(id, admission));
      const prepared = await step('broker-prepare', async () => {
        const state = await this.#check(id); if (!state.proposal) throw new RuntimeError('MISSING_PROPOSAL');
        const action = await this.#broker.prepare(JSON.stringify(state.proposal), this.#deps.ownerCredential);
        await this.#ledger.change(id, current => { current.status = 'WAITING_APPROVAL'; }); return action;
      });
      // The wakeup is not approval authority. The broker validates the durable approval at dispatch.
      await DBOS.recv('approval-or-cancel', 86400);
      await step('effect-dispatch', async () => {
        const state = await this.#check(id); const scope = prepared.proposal.scope;
        let action = await this.#broker.inspect(scope, prepared.proposal.requestId, this.#deps.ownerCredential);
        if (action.status === 'IN_FLIGHT') { await this.#broker.recover(scope, this.#deps.recoveryCredential); action = await this.#broker.inspect(scope, prepared.proposal.requestId, this.#deps.ownerCredential); }
        if (action.status === 'NEEDS_RECONCILIATION') action = await this.#broker.reconcile(scope, prepared.proposal.requestId, this.#deps.recoveryCredential);
        else if (action.status === 'PREPARED') action = await this.#broker.dispatch(scope, prepared.proposal.requestId, this.#deps.ownerCredential);
        if (action.status !== 'COMPLETED' || !action.receipt) throw new RuntimeError('EFFECT_RECONCILIATION_REQUIRED');
        await this.#ledger.change(id, current => { current.receipt = action.receipt; });
        void state;
      });
      return await step('acceptance', async () => {
        const state = await this.#check(id); if (!state.receipt) throw new RuntimeError('MISSING_RECEIPT');
        const accepted = state.acceptance ?? await this.#deps.acceptance.read(state.input, state.receipt);
        if (typeof accepted?.accepted !== 'boolean') throw new RuntimeError('INVALID_ACCEPTANCE'); identifier(accepted.evidenceRef);
        return this.#ledger.change(id, current => {
          // The read can await while cancellation commits. Decide terminal state under this row lock.
          if (current.cancelled || this.#cancelled.has(id)) {
            current.cancelled = true; current.status = 'CANCELLED'; current.reason = 'CANCELLED'; return;
          }
          current.acceptance = structuredClone(accepted); current.status = accepted.accepted ? 'COMPLETED' : 'ACCEPTANCE_FAILED';
        });
      });
    } catch (error) {
      return step('durable-stop', async () => this.#ledger.change(id, current => {
        const cancelled = current.cancelled || this.#cancelled.has(id);
        current.status = cancelled ? 'CANCELLED' : 'HOLD';
        current.reason = cancelled ? 'CANCELLED' : current.process && current.process.launcherId !== this.launcherId
          ? 'FOREIGN_LAUNCHER_RECONCILIATION_REQUIRED' : /^[A-Z_]{1,100}$/.test(String((error as { code?: string }).code)) ? (error as { code: string }).code : 'UNRESOLVED_OUTCOME';
      }));
    }
  }
  async approve(id: string, approval: ApprovalRequest, credential: unknown): Promise<void> {
    const state = await this.#check(id); if (!state.proposal) throw new RuntimeError('MISSING_PROPOSAL');
    await this.#broker.approve(state.proposal.scope, state.proposal.requestId, approval, credential);
    await DBOS.send(id, 'approved', 'approval-or-cancel', `approval-${state.inputDigest}`);
  }
  async cancel(id: string): Promise<void> {
    await this.#coordinator.guard();
    this.#cancelled.add(id); const inflight = this.#inflight.get(id); inflight?.abort.abort();
    const state = await this.#ledger.change(id, current => { current.cancelled = true; current.status = 'CANCELLED'; current.reason = 'CANCELLED'; });
    await this.#broker.cancel({ workspaceId: state.input.task.workspaceId, runId: state.input.task.runId, taskId: state.input.task.taskId }, this.#deps.ownerCredential);
    if (inflight) await inflight.done;
    const reservation = await this.#admission.lookup(state.input.reservation.accountAlias, state.input.reservation.jobId);
    if (reservation?.status === 'RESERVED') await this.#admission.reconcile(state.input.reservation, {
      kind: 'not-started', proofRef: `unused-${randomUUID()}`, observedAtMs: Date.now(), processRef: null, fencedLauncherId: null,
    });
    await DBOS.send(id, 'cancelled', 'approval-or-cancel', `cancel-${state.inputDigest}`);
  }
  async close(): Promise<void> {
    this.#closing = true;
    for (const { abort } of this.#inflight.values()) abort.abort();
    const stopped = await Promise.allSettled([...this.#active.values()].map(({ worker }) => worker.terminate()));
    await Promise.all([...this.#inflight.values()].map(({ done }) => done));
    try { await DBOS.shutdown({ deregister: true, workflowCompletionTimeoutMS: 1000 }); }
    finally { await this.#coordinator.close(); }
    if (stopped.some(result => result.status === 'rejected')) throw new RuntimeError('TERMINATION_UNKNOWN');
  }
}
