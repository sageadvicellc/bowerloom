import { canonicalJson, digest } from '../../contracts/src/index.js';
import { validateTestManifestPlan } from '../../controlled-tests/src/index.js';
import { MODEL_ROUTE, proposalPrompt } from '../../codex-adapter/src/index.js';
import type { AdmissionPolicy } from '../../admission/src/index.js';
import type { SupervisedRuntime, RunInput } from '../../runtime/src/index.js';
import { pinGraph, validateGraphState } from '../../graph/src/index.js';
import { taskRequest } from '../../graph/src/validation.js';
import type { GraphInput, GraphStore, ExecutionRequest, ExecutionObservation, TaskExecutor } from '../../graph/src/index.js';

export interface BridgePolicy {
  accountAlias: string;
  modelRoute: typeof MODEL_ROUTE;
  allowancePercent: Record<string, number>;
  approverSubjects: string[];
  // Persist these controller values with the run. They never change on restart.
  readyAtMs: number;
  leaseExpiresAtMs: number;
}
type RuntimePort = Pick<SupervisedRuntime, 'submit' | 'status' | 'admissionPolicy'>;
export class BridgeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BridgeError'; }
}
function fail(code: string): never { throw new BridgeError(code); }
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(v)
  && !['constructor', 'prototype', '__proto__'].includes(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function renderTask(request: ExecutionRequest): string {
  const task = request.plan.definition.tasks.find(task => task.id === request.taskId) ?? fail('UNKNOWN_TASK');
  const owner = request.plan.definition.owners.find(owner => owner.id === task.owner) ?? fail('UNKNOWN_OWNER');
  const effect = task.effects.find(effect => effect.operation === 'workspace.write');
  if (!effect || effect.operation !== 'workspace.write') fail('UNSUPPORTED_EFFECT');
  const prompt = canonicalJson({
    instruction: 'Produce the requested file content in edit.content. Copy all supplied proposal fields exactly. Do not execute effects. For a non-artifact output, encode the value as canonical JSON in edit.content.',
    role: { id: owner.id, instructions: request.assets[owner.prompt], skills: owner.skills.map(id => request.assets[id]) },
    task: task.description, acceptance: task.acceptance, output: Object.values(task.outputs)[0],
    inputs: Object.fromEntries(Object.entries(request.inputs).map(([name, input]) => [name,
      { type: input.type, digest: input.valueDigest, value: input.type.kind === 'artifact' ? input.artifact.content : input.value }])),
    proposal: { format: 'trellis/action/v0.7-alpha',
      scope: { workspaceId: request.workspaceId, runId: request.runId, taskId: request.taskId },
      requestId: `write-${request.executionId.slice(7)}`, candidateRevision: request.candidateRevision,
      ownerEpoch: request.ownerEpoch,
      edit: { operation: 'workspace.write', path: effect.path, expectedDigest: null } },
  });
  proposalPrompt(prompt); // One input bound, shared with the actual native adapter. Never truncate.
  return prompt;
}

export class RuntimeTaskBridge implements TaskExecutor {
  readonly #input: GraphInput;
  readonly #policy: BridgePolicy;
  readonly #store: GraphStore;
  readonly #runtime: RuntimePort;
  constructor(input: GraphInput, policy: BridgePolicy, store: GraphStore, runtime: RuntimePort, testManifest?: string) {
    this.#input = pinGraph(input); this.#policy = structuredClone(policy); this.#store = store; this.#runtime = runtime;
    if (this.#input.plan.definition.tasks.some(task => task.effects.some(effect => effect.operation === 'command.test'))) {
      if (testManifest === undefined) fail('TEST_MANIFEST_REQUIRED');
      validateTestManifestPlan(this.#input.plan, testManifest);
    }
    const p = this.#policy;
    if (Object.keys(p).sort().join() !== 'accountAlias,allowancePercent,approverSubjects,leaseExpiresAtMs,modelRoute,readyAtMs'
      || !id(p.accountAlias) || p.modelRoute !== MODEL_ROUTE || !integer(p.readyAtMs) || !integer(p.leaseExpiresAtMs)
      || p.leaseExpiresAtMs <= p.readyAtMs || !Array.isArray(p.approverSubjects) || !p.approverSubjects.length
      || p.approverSubjects.length > 32 || !p.approverSubjects.every(id) || new Set(p.approverSubjects).size !== p.approverSubjects.length
      || !p.allowancePercent || Object.keys(p.allowancePercent).length < 1 || Object.keys(p.allowancePercent).length > 2
      || Object.entries(p.allowancePercent).some(([name, percent]) => !['primary', 'secondary'].includes(name)
        || !Number.isFinite(percent) || percent <= 0 || percent >= 75)) fail('INVALID_POLICY');
  }
  async #request(supplied: ExecutionRequest, dispatch: boolean): Promise<ExecutionRequest> {
    // Only the store's committed claim supplies authority and predecessor evidence.
    if (!supplied || !id(supplied.graphId) || !id(supplied.taskId)) fail('INVALID_REQUEST');
    return this.#store.transaction(supplied.graphId, current => {
      if (!current) fail('UNKNOWN_GRAPH');
      const state = validateGraphState(current);
      if (!same(state.input, this.#input)) fail('GRAPH_BINDING');
      if (dispatch && (state.cancelRequested || state.holdReason !== null)) fail('GRAPH_STOPPED');
      const expected = taskRequest(state, supplied.taskId);
      const claim = state.tasks[supplied.taskId]?.claim;
      if (!claim || claim.executionId !== expected.executionId || claim.requestDigest !== expected.requestDigest
        || !same(supplied, expected)) fail('CLAIM_BINDING');
      return { state, result: expected };
    });
  }
  #runInput(request: ExecutionRequest): RunInput {
    const p = this.#policy;
    return { plan: request.plan,
      task: { workspaceId: request.workspaceId, runId: request.runId, taskId: request.taskId,
        ownerSubject: request.ownerSubject, ownerEpoch: request.ownerEpoch, approverSubjects: p.approverSubjects,
        readyAtMs: p.readyAtMs, leaseExpiresAtMs: p.leaseExpiresAtMs, completedDependencies: request.completedDependencies },
      taskInput: renderTask(request),
      reservation: { accountAlias: p.accountAlias, jobId: request.executionId, candidateRevision: request.candidateRevision,
        modelRoute: p.modelRoute, role: 'worker', attempt: 'initial', allowancePercent: p.allowancePercent, paidFallback: false } };
  }
  #runId(request: ExecutionRequest): string {
    return digest(canonicalJson({ workspaceId: request.workspaceId, runId: request.runId, taskId: request.taskId }));
  }
  #budget(policy: AdmissionPolicy): void {
    const budget = this.#input.plan.definition.budget;
    if (!policy || !Number.isFinite(policy.thresholdPercent) || policy.thresholdPercent <= 0
      || policy.thresholdPercent > 100 - budget.reservePercent || !Number.isSafeInteger(policy.maxWorkers)
      || policy.maxWorkers < 1 || policy.maxWorkers > budget.maxActiveWorkers
      || !Array.isArray(policy.admittedRoutes) || !policy.admittedRoutes.includes(this.#policy.modelRoute)) fail('CREW_BUDGET_NOT_ENFORCED');
  }
  async submit(supplied: ExecutionRequest): Promise<void> {
    const request = await this.#request(supplied, true);
    const input = this.#runInput(request);
    this.#budget(await this.#runtime.admissionPolicy(this.#policy.accountAlias));
    await this.#request(request, true); // Recheck the graph after awaiting the actual runtime policy.
    if (await this.#runtime.submit(input) !== this.#runId(request)) fail('RUNTIME_IDENTITY');
  }
  async inspect(supplied: ExecutionRequest): Promise<ExecutionObservation | null> {
    const request = await this.#request(supplied, false);
    const input = this.#runInput(request);
    let status;
    try { status = await this.#runtime.status(this.#runId(request)); }
    catch (error) { if ((error as { code?: string }).code === 'UNKNOWN_RUN') return null; throw error; }
    const run = status.run;
    if (!same(run.input, input) || run.id !== this.#runId(request)
      || run.inputDigest !== digest(canonicalJson(input))) fail('RUNTIME_BINDING');
    if (run.cancelled && run.status !== 'CANCELLED') fail('RUNTIME_BINDING');
    let completion = null;
    if (run.status === 'COMPLETED') {
      if (!run.proposal || !run.receipt || run.acceptance?.accepted !== true) fail('MISSING_ACCEPTANCE');
      completion = structuredClone({ proposal: run.proposal, receipt: run.receipt, evidenceRef: run.acceptance.evidenceRef });
    }
    return { executionId: request.executionId, requestDigest: request.requestDigest,
      status: run.status, reason: run.reason, completion };
  }
}
