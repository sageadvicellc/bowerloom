import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authoredGraph, compileAuthoring } from '../packages/authoring/src/index.js';
import { canonicalJson, digest } from '../packages/contracts/src/index.js';
import { serializeTestManifest } from '../packages/controlled-tests/src/index.js';
import { graphStatus } from '../packages/graph/src/index.js';
import type { GraphState, GraphView, GraphInput, ExecutionObservation } from '../packages/graph/src/index.js';
import { graphId, observation, taskRequest } from '../packages/graph/src/validation.js';
import type { Proposal, Receipt } from '../packages/broker/src/index.js';
import type { RunState, RunInput } from '../packages/runtime/src/index.js';
import type { SessionPort } from '../apps/cli/src/session.js';
import { createWorkbenchRunner, serializeWorkbenchEvidence, CRAFT_SHOP_R1_DIGEST } from '../packages/workbench/src/index.js';
import type { WorkbenchInput, WorkbenchCommand } from '../packages/workbench/src/index.js';

let temporary: string, input: WorkbenchInput;
before(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), 'trellis-workbench-runner-')));
  const project = join(temporary, 'reference');
  await cp(resolve('packages/workbench/reference-crews/craft-shop-control'), project, { recursive: true });
  const registeredManifest = serializeTestManifest({ format: 'trellis/registered-test/v0.7-alpha', testId: 'craft-shop-ui-v1',
    testerDigest: digest('synthetic offline tester'), environmentDigest: digest('synthetic offline environment'),
    criteria: ['add-job','change-stage','reload','export'], limits: { timeoutMs: 25000, outputBytes: 16384, artifactBytes: 65536 } });
  await writeFile(join(project, 'assets/test-manifest.json'), registeredManifest);
  const scenarioFile = resolve('packages/workbench/scenarios/craft-shop-v1/scenario.json');
  const bundle = await compileAuthoring(join(project, 'authoring.json'), { scenarioFile });
  const frozenScenario = await readFile(scenarioFile, 'utf8');
  input = { bundle, frozenScenario, registeredManifest, softwareRevision: 'a'.repeat(40), installationId: 'synthetic-installed', designation: 'reference',
    installedGraph: authoredGraph(bundle, frozenScenario, { workspaceId: 'synthetic-workspace', runId: 'synthetic-run',
      owners: { emery: { subject: 'trusted:emery', epoch: 3 }, coda: { subject: 'trusted:coda', epoch: 5 } } }) };
});
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
const empty = (graph: GraphInput): GraphState => ({ format: 'trellis/graph-state/v0.7-alpha', id: graphId(graph), input: structuredClone(graph),
  inputDigest: digest(canonicalJson(graph)), cancelRequested: false, holdReason: null,
  tasks: Object.fromEntries(graph.plan.taskOrder.map(id => [id, { claim: null, observation: null, output: null }])) });
function fixture() {
  const runs = new Map<string, RunState>();
  let state = empty(input.installedGraph);
  const counts = { opens: [] as string[], advances: 0, approvals: [] as unknown[][], cancels: 0, closes: 0, statuses: 0 };
  const view = (): GraphView => ({ state: structuredClone(state), status: graphStatus(state) });
  const setTask = (taskId: string, status: 'WAITING_APPROVAL' | 'COMPLETED' | 'HOLD' | 'ACCEPTANCE_FAILED') => {
    const request = taskRequest(state, taskId), task = state.input.plan.definition.tasks.find(t => t.id === taskId)!;
    const scope = { workspaceId: request.workspaceId, runId: request.runId, taskId };
    const proposal: Proposal = { format: 'trellis/action/v0.7-alpha', scope, requestId: `write-${taskId}`, candidateRevision: request.candidateRevision,
      ownerEpoch: request.ownerEpoch, edit: { operation: 'workspace.write', path: (task.effects.find(e => e.operation === 'workspace.write') as { path: string }).path,
        expectedDigest: null, content: `<p>synthetic ${taskId}</p>` } };
    const actionDigest = digest(canonicalJson(proposal));
    const receipt: Receipt = { format: 'trellis/effect-receipt/v0.7-alpha', operationKey: digest(canonicalJson({ scope, requestId: proposal.requestId, actionDigest })),
      actionDigest, workspaceId: request.workspaceId, path: proposal.edit.path, beforeDigest: null, afterDigest: digest(proposal.edit.content),
      bytes: Buffer.byteLength(proposal.edit.content), appliedAtMs: 1000 };
    const evidenceRef = `synthetic-acceptance-${taskId}`;
    const supplied: ExecutionObservation = { executionId: request.executionId, requestDigest: request.requestDigest, status,
      reason: status === 'HOLD' ? 'SYNTHETIC_HOLD' : status === 'ACCEPTANCE_FAILED' ? 'SYNTHETIC_FAILED' : null,
      completion: status === 'COMPLETED' ? { proposal, receipt, evidenceRef } : null };
    const checked = observation(request, supplied);
    state.tasks[taskId] = { claim: { executionId: request.executionId, requestDigest: request.requestDigest }, observation: checked.observation, output: checked.output };
    const runInput: RunInput = { plan: state.input.plan, task: { ...scope, ownerSubject: request.ownerSubject, ownerEpoch: request.ownerEpoch,
      approverSubjects: ['trusted:reviewer'], readyAtMs: 1000, leaseExpiresAtMs: 999999, completedDependencies: [...task.dependsOn] },
      reservation: { accountAlias: 'synthetic', jobId: `job-${taskId}`, candidateRevision: request.candidateRevision, modelRoute: 'synthetic', role: 'worker',
        attempt: 'initial', allowancePercent: { primary: 2 }, paidFallback: false }, taskInput: 'synthetic' };
    runs.set(taskId, { version: 1, id: digest(canonicalJson(scope)), input: structuredClone(runInput), inputDigest: digest(canonicalJson(runInput)),
      cancelled: false, status, reason: supplied.reason, process: null, modelOutcome: null, proposal,
      receipt: status === 'COMPLETED' ? receipt : null, acceptance: status === 'COMPLETED' ? { accepted: true, evidenceRef } : null });
  };
  const port: SessionPort = {
    async status() { counts.statuses++; return view(); },
    async advance() { counts.advances++; if (graphStatus(state) === 'READY') setTask(state.input.plan.taskOrder.find(id => !state.tasks[id]!.claim)!, 'WAITING_APPROVAL'); return view(); },
    async run(id) { return structuredClone(runs.get(id) ?? null); },
    async approve(...args) { counts.approvals.push(args); setTask(args[0], 'COMPLETED'); },
    async cancel() { counts.cancels++; state.cancelRequested = true; },
    async close() { counts.closes++; },
  };
  const sessions = { installationId: input.installationId, async open(mode: 'start' | 'read' | 'cancel') { counts.opens.push(mode); return port; } };
  const runner = () => createWorkbenchRunner(input, { sessions, now: () => 1000, sleep: async () => {} });
  const execute = (command: WorkbenchCommand, signal = new AbortController().signal) => runner().execute(command, signal);
  return { port, counts, runs, setTask, runner, execute, sessions, replaceGraph(graph: GraphInput) { state = empty(graph); } };
}
test('bindings pin authored/reference source, frozen scenario, installed tester and graph without opening', () => {
  const f = fixture(), runner = f.runner();
  assert.equal(runner.bindings.scenario.digest, CRAFT_SHOP_R1_DIGEST);
  assert.equal(runner.bindings.authoringRevision, input.bundle.authoringRevision);
  assert.equal(runner.bindings.candidateRevision, input.bundle.plan.candidateRevision);
  assert.equal(runner.bindings.tester.manifestDigest, digest(input.registeredManifest));
  assert.equal(runner.bindings.designation, 'reference'); assert.deepEqual(f.counts.opens, []);
  const copy = runner.bindings; copy.installationId = 'changed'; assert.equal(runner.bindings.installationId, input.installationId);
  assert.equal(createWorkbenchRunner({ ...input, designation: 'authored' }, { sessions: f.sessions }).bindings.designation, 'authored');
});
for (const [name, mutate] of [
  ['bundle bytes', (v: WorkbenchInput) => { v.bundle.assets.orders += ' '; }],
  ['scenario bytes', (v: WorkbenchInput) => { v.frozenScenario += '\n'; }],
  ['tester bytes', (v: WorkbenchInput) => { v.registeredManifest = v.registeredManifest.replace('synthetic', 'changed') + ' '; }],
  ['graph plan', (v: WorkbenchInput) => { v.installedGraph.plan.candidateRevision = digest('changed'); }],
  ['graph assets', (v: WorkbenchInput) => { v.installedGraph.assets.orders += ' '; }],
  ['installation identity', (v: WorkbenchInput) => { v.installationId = 'other-installation'; }],
  ['software revision', (v: WorkbenchInput) => { v.softwareRevision = 'latest'; }],
] as [string, (value: WorkbenchInput) => void][]) test(`rejects ${name} before opening`, () => {
  const f = fixture(), changed = structuredClone(input); mutate(changed);
  assert.throws(() => createWorkbenchRunner(changed, { sessions: f.sessions })); assert.deepEqual(f.counts.opens, []);
});
test('up/start advances only to pending approval; missing usage and launch counters remain unavailable', async () => {
  for (const command of ['up','start'] as const) {
    const f = fixture(), report = await f.execute({ command, tier: 'pro' });
    assert.equal(report.outcome, 'pending'); assert.equal(report.cleanup, 'closed'); assert.equal(report.commandStatus, 'completed');
    assert.equal(f.counts.advances, 1); assert.deepEqual(f.counts.approvals, []); assert.equal(f.counts.closes, 1);
    assert.equal(report.observed.proposals, 1); assert.equal(report.observed.acceptedTests, 0);
    assert.deepEqual(report.executionCounts, { modelStarts: null, effectWrites: null, browserStarts: null });
    assert.equal(report.usage.status, 'unavailable'); assert.equal(report.usage.providerTokens, null);
    assert.equal(report.capacityTierCalibration, 'unmeasured'); assert.equal(report.comparison, 'not-evaluated');
    assert.deepEqual(JSON.parse(serializeWorkbenchEvidence(report)), report);
  }
});
test('read and review after restart do not dispatch, approve or cancel', async () => {
  const f = fixture(); f.setTask('design', 'COMPLETED'); f.setTask('build', 'COMPLETED');
  for (const command of ['read','review'] as const) {
    const report = await f.execute({ command }); assert.equal(report.outcome, 'accepted'); assert.equal(report.observed.writeReceipts, 2);
    assert.equal(report.observed.acceptedTests, 2); assert.equal(report.calls.advance, 0);
    assert.equal('proposal' in (report.summary as { tasks: object[] }).tasks[0]!, command === 'review');
  }
  assert.deepEqual(f.counts.opens, ['read','read']); assert.equal(f.counts.advances, 0); assert.equal(f.counts.cancels, 0); assert.deepEqual(f.counts.approvals, []);
});
test('wrong stored graph closes before any dispatch', async () => {
  const f = fixture(); f.replaceGraph({ ...input.installedGraph, runId: 'wrong-run' });
  const report = await f.execute({ command: 'up', tier: '5x' });
  assert.equal(report.commandStatus, 'failed'); assert.equal(report.errorCode, 'WORKBENCH_STORED_GRAPH');
  assert.equal(report.outcome, 'unavailable'); assert.equal(f.counts.advances, 0); assert.equal(f.counts.closes, 1);
});
test('graph is rechecked inside advance and exact approve boundaries', async () => {
  for (const approving of [false,true]) {
    const f = fixture(); if (approving) f.setTask('design', 'WAITING_APPROVAL');
    const original = f.port.status; let reads = 0;
    f.port.status = async () => { if (++reads === 2) f.replaceGraph({ ...input.installedGraph, runId: 'changed-after-open' }); return original(); };
    const command: WorkbenchCommand = approving ? { command: 'approve', candidate: input.bundle.plan.candidateRevision,
      action: digest(canonicalJson(f.runs.get('design')!.proposal)) } : { command: 'up', tier: 'pro' };
    const report = await f.execute(command); assert.equal(report.errorCode, 'WORKBENCH_STORED_GRAPH');
    assert.equal(f.counts.advances, 0); assert.deepEqual(f.counts.approvals, []); assert.equal(f.counts.closes, 1);
  }
});
test('only explicit exact approval is forwarded and the next task still waits for separate approval', async () => {
  const f = fixture(); f.setTask('design', 'WAITING_APPROVAL');
  const action = digest(canonicalJson(f.runs.get('design')!.proposal)), candidate = input.bundle.plan.candidateRevision;
  const approved = await f.execute({ command: 'approve', candidate, action });
  assert.deepEqual(f.counts.approvals, [['design',candidate,action]]); assert.equal(approved.outcome, 'pending');
  assert.equal(approved.observed.acceptedTests, 1); assert.equal(approved.observed.proposals, 2);
  const wrong = fixture(); wrong.setTask('design', 'WAITING_APPROVAL');
  const refused = await wrong.execute({ command: 'approve', candidate, action: digest('wrong') });
  assert.equal(refused.errorCode, 'STALE_APPROVAL'); assert.equal(wrong.counts.advances, 0); assert.deepEqual(wrong.counts.approvals, []);
  await assert.rejects(wrong.execute({ command: 'approve', candidate: digest('wrong'), action }), { code: 'STALE_APPROVAL' });
});
test('cancel and interrupted write sessions cancel explicitly; interrupted reads never cancel', async () => {
  const f = fixture(); const report = await f.execute({ command: 'cancel' });
  assert.equal(report.outcome, 'cancelled'); assert.equal(f.counts.cancels, 1); assert.equal(f.counts.advances, 0);
  for (const command of [{ command: 'up', tier: 'pro' }, { command: 'review' }] as WorkbenchCommand[]) {
    const f = fixture(), abort = new AbortController(); abort.abort(); const r = await f.execute(command, abort.signal);
    assert.equal(f.counts.cancels, command.command === 'review' ? 0 : 1); assert.equal(f.counts.closes, 1);
    if (command.command === 'review') assert.equal(r.errorCode, 'WORKBENCH_READ_ONLY_INTERRUPTED');
  }
});
test('cancellation arriving during the added graph recheck prevents advance and approval', async () => {
  for (const approving of [false,true]) {
    const f = fixture(), abort = new AbortController(); if (approving) f.setTask('design', 'WAITING_APPROVAL');
    const original = f.port.status; let statuses = 0;
    f.port.status = async () => { const value = await original(); if (++statuses === 2) abort.abort(); return value; };
    const command: WorkbenchCommand = approving ? { command: 'approve', candidate: input.bundle.plan.candidateRevision,
      action: digest(canonicalJson(f.runs.get('design')!.proposal)) } : { command: 'up', tier: 'pro' };
    const report = await f.execute(command, abort.signal);
    assert.equal(report.outcome, 'cancelled'); assert.equal(f.counts.cancels, 1); assert.equal(f.counts.advances, 0);
    assert.deepEqual(f.counts.approvals, []); assert.equal(f.counts.closes, 1);
  }
});
test('open and cleanup ambiguity yield unavailable outcome and bounded codes', async () => {
  const f = fixture(); f.sessions.open = async () => { throw Error('credential=PRIVATE'); };
  const open = await f.execute({ command: 'read' }); assert.equal(open.cleanup, 'unknown'); assert.equal(open.outcome, 'unavailable');
  assert.equal(open.errorCode, 'WORKBENCH_SESSION_FAILED'); assert.ok(!JSON.stringify(open).includes('PRIVATE'));
  const g = fixture(); g.setTask('design', 'COMPLETED'); g.setTask('build', 'COMPLETED'); g.port.close = async () => { throw Error('provider PRIVATE'); };
  const closed = await g.execute({ command: 'read' }); assert.equal(closed.outcome, 'unavailable'); assert.equal(closed.cleanup, 'unknown');
  assert.equal(closed.commandStatus, 'failed'); assert.equal(closed.summary, null); assert.ok(!JSON.stringify(closed).includes('PRIVATE'));
});
test('completed labels without receipt or acceptance do not become success', async () => {
  for (const missing of ['receipt','acceptance'] as const) {
    const f = fixture(); f.setTask('design', 'COMPLETED'); f.setTask('build', 'COMPLETED'); f.runs.get('build')![missing] = null;
    const report = await f.execute({ command: 'read' }); assert.equal(report.outcome, 'incomplete');
  }
  const f = fixture(); f.setTask('design', 'ACCEPTANCE_FAILED');
  assert.equal((await f.execute({ command: 'read' })).outcome, 'acceptance-failed');
  const held = fixture(); held.setTask('design', 'HOLD'); assert.equal((await held.execute({ command: 'read' })).outcome, 'held');
});
test('completed runtime evidence must match the graph completion evidence', async () => {
  for (const mismatch of ['receipt','acceptance'] as const) {
    const f = fixture(); f.setTask('design', 'COMPLETED'); f.setTask('build', 'COMPLETED');
    if (mismatch === 'receipt') f.runs.get('build')!.receipt!.appliedAtMs++;
    else f.runs.get('build')!.acceptance!.evidenceRef = 'other-acceptance';
    assert.equal((await f.execute({ command: 'read' })).outcome, 'incomplete');
  }
});
test('malformed receipts and arbitrary failure text cannot enter evidence summaries', async () => {
  for (const malformed of ['receipt','reason'] as const) {
    const f = fixture(); f.setTask('design', 'COMPLETED'); f.setTask('build', 'COMPLETED');
    if (malformed === 'receipt') f.runs.get('build')!.receipt!.operationKey = digest('wrong-operation');
    else f.runs.get('build')!.reason = 'provider credential=PRIVATE';
    const report = await f.execute({ command: 'review' });
    assert.equal(report.errorCode, 'WORKBENCH_STORED_RUN'); assert.equal(report.outcome, 'unavailable');
    assert.equal(report.summary, null); assert.ok(!JSON.stringify(report).includes('PRIVATE')); assert.equal(f.counts.closes, 1);
  }
});
test('command timestamps are measured and invalid end clocks do not yield success', async () => {
  const f = fixture(); let time = 1000;
  const runner = createWorkbenchRunner(input, { sessions: f.sessions, now: () => time++ });
  const report = await runner.execute({ command: 'read' }, new AbortController().signal);
  assert.equal(report.startedAtMs, 1000); assert.equal(report.endedAtMs, 1001); assert.equal(report.durationMs, 1);
  const g = fixture(); let calls = 0;
  const badClock = createWorkbenchRunner(input, { sessions: g.sessions, now: () => ++calls === 1 ? 1000 : 999 });
  const failed = await badClock.execute({ command: 'read' }, new AbortController().signal);
  assert.equal(failed.errorCode, 'WORKBENCH_CLOCK'); assert.equal(failed.outcome, 'unavailable');
  assert.equal(failed.endedAtMs, null); assert.equal(failed.durationMs, null); assert.equal(g.counts.closes, 1);
});
test('snapshots remain detached across caller and returned evidence mutations', async () => {
  const f = fixture(), supplied = structuredClone(input), runner = createWorkbenchRunner(supplied, { sessions: f.sessions, now: () => 1000 });
  supplied.bundle.assets.orders = 'modified after validation'; supplied.installedGraph.runId = 'modified';
  f.setTask('design', 'WAITING_APPROVAL'); const first = await runner.execute({ command: 'review' }, new AbortController().signal);
  (first.summary as { tasks: { proposal: Proposal }[] }).tasks[0]!.proposal.edit.content = 'mutated returned evidence';
  first.bindings.designation = 'authored'; const second = await runner.execute({ command: 'review' }, new AbortController().signal);
  assert.equal(second.bindings.designation, 'reference'); assert.ok(!JSON.stringify(second.summary).includes('mutated returned evidence'));
});
test('invalid commands and overlapping execution are refused before another session opens', async () => {
  const f = fixture(), runner = f.runner();
  for (const command of [{ command: 'approve', candidate: 'latest', action: 'any' }, { command: 'up', tier: 'unlimited' }, { command: 'read', approve: true }])
    await assert.rejects(runner.execute(command, new AbortController().signal));
  assert.equal(f.counts.opens.length, 0);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const original = f.port.status;
  f.port.status = async () => { await gate; return original(); };
  const first = runner.execute({ command: 'read' }, new AbortController().signal);
  await assert.rejects(runner.execute({ command: 'read' }, new AbortController().signal), { code: 'WORKBENCH_BUSY' });
  release(); await first; assert.equal(f.counts.opens.length, 1);
});
