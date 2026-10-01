import { canonicalJson, digest } from '../../contracts/src/index.js';
import { copyJson, fail, graphId, graphState, identifier, observation, pinGraph, taskRequest } from './validation.js';
import type { ExecutionObservation, ExecutionRequest, GraphInput, GraphState, GraphStatus, GraphStore, GraphView, TaskExecutor } from './types.js';
export type * from './types.js';
export { GraphError } from './types.js';
export { GRAPH_LIMITS, graphState as validateGraphState, pinGraph } from './validation.js';
export function graphStatus(state: GraphState): GraphStatus {
  if (state.cancelRequested) return 'CANCELLED';
  if (state.holdReason) return 'HOLD';
  for (const id of state.input.plan.taskOrder) {
    const task = state.tasks[id]!;
    if (task.observation?.status === 'COMPLETED') continue;
    if (!task.claim) return 'READY';
    const status = task.observation?.status;
    if (status === 'HOLD' || status === 'CANCELLED' || status === 'ACCEPTANCE_FAILED' || status === 'WAITING_APPROVAL') return status;
    return 'RUNNING';
  }
  return 'COMPLETED';
}
const view = (state: GraphState): GraphView => copyJson({ status: graphStatus(state), state });
const stopped = (state: GraphState): boolean => ['HOLD','CANCELLED','ACCEPTANCE_FAILED','COMPLETED'].includes(graphStatus(state));
/** Sequential scheduling only. Existing runtime adapters retain launch, approval, and effect authority. */
export class GraphDriver {
  constructor(readonly store: GraphStore, readonly executor: TaskExecutor) {}
  async #change<T>(id: string, mutate: (state: GraphState | null) => { state: GraphState; result: T }): Promise<T> {
    if (!identifier(id)) fail('INVALID_GRAPH_ID');
    return this.store.transaction(id, current => {
      const state = current === null ? null : graphState(current);
      if (state !== null && state.id !== id) fail('CORRUPT_GRAPH');
      const changed = mutate(state); const checked = graphState(changed.state);
      if (checked.id !== id) fail('CORRUPT_GRAPH');
      return { state: checked, result: copyJson(changed.result) };
    });
  }
  submit(value: GraphInput): Promise<GraphView> {
    const input = pinGraph(value); const id = graphId(input); const inputDigest = digest(canonicalJson(input));
    return this.#change(id, current => {
      if (current && current.inputDigest !== inputDigest) fail('GRAPH_CONFLICT');
      const state: GraphState = current ?? { format: 'trellis/graph-state/v0.7-alpha', id, input, inputDigest, cancelRequested: false, holdReason: null,
        tasks: Object.fromEntries(input.plan.taskOrder.map(id => [id, { claim: null, observation: null, output: null }])) };
      return { state, result: view(state) };
    });
  }
  status(id: string): Promise<GraphView> {
    return this.#change(id, current => { const state = current ?? fail('UNKNOWN_GRAPH'); return { state, result: view(state) }; });
  }
  cancel(id: string): Promise<GraphView> {
    // The committed claim is the scheduling boundary. This never asserts that its runtime process stopped.
    return this.#change(id, current => {
      const state = current ?? fail('UNKNOWN_GRAPH'); state.cancelRequested = true;
      return { state, result: view(state) };
    });
  }
  async #hold(id: string, reason: string): Promise<GraphView> {
    return this.#change(id, current => {
      const state = current ?? fail('UNKNOWN_GRAPH');
      if (!stopped(state)) state.holdReason = reason;
      return { state, result: view(state) };
    });
  }
  /** Perform at most one task submission or one status observation; never drain or retry a graph automatically. */
  async advance(id: string): Promise<GraphView> {
    type Next = { kind: 'stop'; view: GraphView } | { kind: 'submit' | 'inspect'; request: ExecutionRequest };
    const next = await this.#change<Next>(id, current => {
      const state = current ?? fail('UNKNOWN_GRAPH');
      if (stopped(state)) return { state, result: { kind: 'stop', view: view(state) } };
      const taskId = state.input.plan.taskOrder.find(id => state.tasks[id]!.observation?.status !== 'COMPLETED')!;
      const task = state.tasks[taskId]!; const request = taskRequest(state, taskId);
      const kind = task.claim === null ? 'submit' : 'inspect';
      if (task.claim === null) task.claim = { executionId: request.executionId, requestDigest: request.requestDigest };
      return { state, result: { kind, request } };
    });
    if (next.kind === 'stop') return next.view;
    if (next.kind === 'submit') {
      // An uncertain transaction above returns no request, so it cannot reach this call.
      try { await this.executor.submit(copyJson(next.request)); }
      catch { return this.#hold(id, 'SUBMIT_UNKNOWN'); }
      return this.status(id);
    }
    let observed: ExecutionObservation | null;
    try { observed = await this.executor.inspect(copyJson(next.request)); }
    catch { return this.#hold(id, 'STATUS_UNAVAILABLE'); }
    if (observed === null) return this.#hold(id, 'CLAIM_NOT_OBSERVED');
    let checked: ReturnType<typeof observation>;
    try { checked = observation(next.request, observed); }
    catch { return this.#hold(id, 'INVALID_EXECUTION_OBSERVATION'); }
    return this.#change(id, current => {
      const state = current ?? fail('UNKNOWN_GRAPH'); const task = state.tasks[next.request.taskId]!;
      if (!task.claim || task.claim.requestDigest !== next.request.requestDigest) fail('CLAIM_CONFLICT');
      // Terminal observations are immutable. Concurrent or stale readers cannot regress them.
      if (task.observation && ['COMPLETED','HOLD','CANCELLED','ACCEPTANCE_FAILED'].includes(task.observation.status)) {
        if (checked.observation.status === 'COMPLETED' && canonicalJson(checked.observation) !== canonicalJson(task.observation)) state.holdReason = 'EXECUTION_CONFLICT';
      } else if (!stopped(state)) {
        task.observation = checked.observation; task.output = checked.output;
      }
      return { state, result: view(state) };
    });
  }
}
export { PostgresGraphStore } from './postgres.js';
