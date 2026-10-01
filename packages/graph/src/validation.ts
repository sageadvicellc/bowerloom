import { canonicalJson, digest, validateDefinition, graphOrder, COMPILER_VERSION, PLAN_FORMAT } from '../../contracts/src/index.js';
import type { CompiledPlan, DataType } from '../../contracts/src/index.js';
import { parseProposal } from '../../broker/src/index.js';
import { GraphError } from './types.js';
import type { Artifact, ValueBinding, GraphInput, GraphState, ExecutionRequest, ExecutionObservation, JsonValue } from './types.js';
export const GRAPH_LIMITS = Object.freeze({ tasks: 32, inputBytes: 1024 * 1024, stateBytes: 8 * 1024 * 1024, outputBytes: 65536, valueDepth: 8 });
export function fail(code: string): never { throw new GraphError(code); }
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const sha = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
}
export function copyJson<T>(value: T, limit = GRAPH_LIMITS.stateBytes): T {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 40) fail('VALUE_LIMIT');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (Buffer.byteLength(item) > limit || Buffer.from(item).toString('utf8') !== item || item.includes('\0')) fail('INVALID_VALUE'); return;
    }
    if (typeof item === 'number') { if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) fail('INVALID_VALUE'); return; }
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) fail('INVALID_VALUE');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 1025 || (Array.isArray(item) && keys.length !== item.length + 1)) fail('VALUE_LIMIT');
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || ['__proto__','prototype','constructor'].includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail('INVALID_VALUE');
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0); if (Buffer.byteLength(canonicalJson(value)) > limit) fail('VALUE_LIMIT'); return structuredClone(value);
}
function supportedType(type: DataType, depth = 0): void {
  if (depth > GRAPH_LIMITS.valueDepth || (depth > 0 && type.kind === 'artifact')) fail('UNSUPPORTED_TYPE');
  if (type.kind === 'array') supportedType(type.items, depth + 1);
  if (type.kind === 'record') for (const field of Object.values(type.fields)) supportedType(field, depth + 1);
}
function typed(type: DataType, value: JsonValue, depth = 0): void {
  if (depth > GRAPH_LIMITS.valueDepth) fail('OUTPUT_TYPE');
  if (type.kind === 'string' && typeof value === 'string') return;
  if (type.kind === 'boolean' && typeof value === 'boolean') return;
  if (type.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) return;
  if (type.kind === 'integer' && typeof value === 'number' && Number.isSafeInteger(value)) return;
  if (type.kind === 'array' && Array.isArray(value) && value.length <= 256) { for (const item of value) typed(type.items, item, depth + 1); return; }
  if (type.kind === 'record' && exact(value, Object.keys(type.fields))) {
    for (const [name, field] of Object.entries(type.fields)) typed(field, value[name] as JsonValue, depth + 1); return;
  }
  fail('OUTPUT_TYPE');
}
export function pinGraph(value: GraphInput): GraphInput {
  const input = copyJson(value, GRAPH_LIMITS.inputBytes);
  if (!exact(input, ['workspaceId','runId','plan','assets','owners']) || !identifier(input.workspaceId) || !identifier(input.runId)) fail('INVALID_INPUT');
  const plan = input.plan;
  if (!exact(plan, ['format','compilerVersion','definition','assets','taskOrder','layers','candidateRevision'])
    || plan.format !== PLAN_FORMAT || plan.compilerVersion !== COMPILER_VERSION || !sha(plan.candidateRevision)) fail('INVALID_PLAN');
  const { candidateRevision, ...body } = plan;
  if (digest(canonicalJson(body)) !== candidateRevision) fail('INVALID_PLAN');
  validateDefinition(plan.definition);
  const order = graphOrder(plan.definition);
  if (!same(plan.taskOrder, order.taskOrder) || !same(plan.layers, order.layers)) fail('INVALID_PLAN');
  const names = Object.keys(plan.definition.assets);
  if (!exact(plan.assets, names) || !exact(input.assets, names) || !exact(input.owners, plan.definition.owners.map(owner => owner.id))) fail('INVALID_INPUT');
  let totalBytes = 0;
  for (const name of names) {
    const declared = plan.definition.assets[name]!; const pinned = plan.assets[name]!; const content = input.assets[name];
    if (!exact(pinned, ['path','mediaType','bytes','digest']) || pinned.path !== declared.path || pinned.mediaType !== declared.mediaType
      || !integer(pinned.bytes) || !sha(pinned.digest) || typeof content !== 'string'
      || Buffer.byteLength(content) !== pinned.bytes || digest(content) !== pinned.digest) fail('ASSET_MISMATCH');
    totalBytes += pinned.bytes;
  }
  if (totalBytes > GRAPH_LIMITS.inputBytes / 2) fail('ASSET_LIMIT');
  for (const owner of Object.values(input.owners)) if (!exact(owner, ['subject','epoch']) || !identifier(owner.subject) || !integer(owner.epoch) || owner.epoch < 1) fail('INVALID_OWNER');
  const capabilities = ['workspace.write','approval.exact-revision'];
  if (plan.definition.tasks.length > GRAPH_LIMITS.tasks || plan.definition.requiredCapabilities.some(cap => !capabilities.includes(cap))) fail('UNSUPPORTED_GRAPH');
  for (const task of plan.definition.tasks) {
    if (task.effects.length !== 1 || task.effects[0]!.operation !== 'workspace.write' || Object.keys(task.outputs).length !== 1
      || task.approval !== 'required' || task.policy.maxAttempts !== 1 || task.policy.backoffSeconds !== 0
      || !same([...task.requires].sort(), [...capabilities].sort())) fail('UNSUPPORTED_TASK');
    for (const type of Object.values(task.outputs)) supportedType(type);
  }
  return input;
}
export const graphId = (input: GraphInput): string => digest(canonicalJson({ workspaceId: input.workspaceId, runId: input.runId }));
function sourceAsset(input: GraphInput, name: string): ValueBinding {
  const pinned = input.plan.assets[name]!;
  const artifact: Artifact = { path: pinned.path, mediaType: pinned.mediaType, content: input.assets[name]!, bytes: pinned.bytes, digest: pinned.digest };
  return { type: { kind: 'artifact', mediaType: pinned.mediaType }, value: null, valueDigest: pinned.digest, artifact };
}
export function taskRequest(state: GraphState, taskId: string): ExecutionRequest {
  const task = state.input.plan.definition.tasks.find(task => task.id === taskId) ?? fail('UNKNOWN_TASK');
  const inputs: Record<string, ValueBinding> = {};
  for (const name of Object.keys(task.inputs).sort()) {
    const port = task.inputs[name]!;
    const binding = 'asset' in port.source ? sourceAsset(state.input, port.source.asset) : state.tasks[port.source.task]?.output;
    if (!binding || !same(binding.type, port.type)) fail('DEPENDENCY_NOT_READY');
    inputs[name] = structuredClone(binding);
  }
  const completedDependencies = [...task.dependsOn].sort();
  if (completedDependencies.some(id => state.tasks[id]?.observation?.status !== 'COMPLETED')) fail('DEPENDENCY_NOT_READY');
  const owner = state.input.owners[task.owner]!;
  const body = { format: 'trellis/graph-task/v0.7-alpha' as const, graphId: state.id, workspaceId: state.input.workspaceId,
    runId: state.input.runId, taskId, ownerId: task.owner, ownerSubject: owner.subject, ownerEpoch: owner.epoch,
    candidateRevision: state.input.plan.candidateRevision, inputs, completedDependencies, plan: state.input.plan, assets: state.input.assets };
  const requestDigest = digest(canonicalJson(body));
  return copyJson({ ...body, requestDigest, executionId: digest(canonicalJson({ graphId: state.id, taskId, requestDigest })) });
}
export function observation(request: ExecutionRequest, supplied: ExecutionObservation): { observation: ExecutionObservation; output: ValueBinding | null } {
  const value = copyJson(supplied);
  if (!exact(value, ['executionId','requestDigest','status','reason','completion']) || value.executionId !== request.executionId
    || value.requestDigest !== request.requestDigest || !['QUEUED','RUNNING','WAITING_APPROVAL','HOLD','CANCELLED','ACCEPTANCE_FAILED','COMPLETED'].includes(value.status)
    || (value.reason !== null && (!identifier(value.reason)))) fail('INVALID_OBSERVATION');
  if (value.status !== 'COMPLETED') { if (value.completion !== null) fail('INVALID_OBSERVATION'); return { observation: value, output: null }; }
  const completed = value.completion;
  if (!exact(completed, ['proposal','receipt','evidenceRef']) || !identifier(completed.evidenceRef) || value.reason !== null) fail('INVALID_COMPLETION');
  const proposal = parseProposal(JSON.stringify(completed.proposal));
  const task = request.plan.definition.tasks.find(task => task.id === request.taskId)!;
  const effect = task.effects[0]!;
  if (proposal.candidateRevision !== request.candidateRevision || proposal.ownerEpoch !== request.ownerEpoch
    || !same(proposal.scope, { workspaceId: request.workspaceId, runId: request.runId, taskId: request.taskId })
    || effect.operation !== 'workspace.write' || proposal.edit.path !== effect.path || Buffer.byteLength(proposal.edit.content) > GRAPH_LIMITS.outputBytes) fail('OUTPUT_BINDING');
  const receipt = completed.receipt;
  const actionDigest = digest(canonicalJson(proposal));
  if (!exact(receipt, ['format','operationKey','actionDigest','workspaceId','path','beforeDigest','afterDigest','bytes','appliedAtMs'])
    || receipt.format !== 'trellis/effect-receipt/v0.7-alpha' || receipt.actionDigest !== actionDigest
    || receipt.operationKey !== digest(canonicalJson({ scope: proposal.scope, requestId: proposal.requestId, actionDigest }))
    || receipt.workspaceId !== request.workspaceId || receipt.path !== effect.path || receipt.beforeDigest !== proposal.edit.expectedDigest
    || receipt.afterDigest !== digest(proposal.edit.content) || receipt.bytes !== Buffer.byteLength(proposal.edit.content) || !integer(receipt.appliedAtMs)) fail('RECEIPT_BINDING');
  const type = Object.values(task.outputs)[0]!;
  const artifact = { path: effect.path, mediaType: type.kind === 'artifact' ? type.mediaType : 'application/json',
    content: proposal.edit.content, bytes: receipt.bytes, digest: receipt.afterDigest };
  let parsed: JsonValue = null;
  if (type.kind !== 'artifact') {
    try { parsed = copyJson(JSON.parse(artifact.content) as JsonValue, GRAPH_LIMITS.outputBytes); } catch { fail('OUTPUT_TYPE'); }
    typed(type, parsed);
    if (canonicalJson(parsed) !== artifact.content) fail('OUTPUT_ENCODING');
  }
  return { observation: value, output: { type, value: parsed, valueDigest: type.kind === 'artifact' ? artifact.digest : digest(canonicalJson(parsed)), artifact } };
}
export function graphState(supplied: GraphState): GraphState {
  const state = copyJson(supplied);
  if (!exact(state, ['format','id','input','inputDigest','cancelRequested','holdReason','tasks']) || state.format !== 'trellis/graph-state/v0.7-alpha'
    || typeof state.cancelRequested !== 'boolean' || (state.holdReason !== null && !identifier(state.holdReason))) fail('CORRUPT_GRAPH');
  const input = pinGraph(state.input);
  if (state.id !== graphId(input) || state.inputDigest !== digest(canonicalJson(input)) || !exact(state.tasks, input.plan.taskOrder)) fail('CORRUPT_GRAPH');
  let unfinished = false;
  for (const id of input.plan.taskOrder) {
    const task = state.tasks[id]!;
    if (!exact(task, ['claim','observation','output'])) fail('CORRUPT_GRAPH');
    if (task.claim === null) { if (task.observation !== null || task.output !== null) fail('CORRUPT_GRAPH'); unfinished = true; continue; }
    if (unfinished) fail('CORRUPT_GRAPH');
    const request = taskRequest(state, id);
    if (!exact(task.claim, ['executionId','requestDigest']) || task.claim.executionId !== request.executionId || task.claim.requestDigest !== request.requestDigest) fail('CORRUPT_GRAPH');
    const checked = task.observation === null ? null : observation(request, task.observation);
    if (!same(task.output, checked?.output ?? null)) fail('CORRUPT_GRAPH');
    unfinished = task.observation?.status !== 'COMPLETED';
  }
  return state;
}
