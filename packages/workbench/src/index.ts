import { canonicalJson, digest, DefinitionError } from '../../contracts/src/index.js';
import { authoredGraph, parseScenario, validateAuthoredCrew } from '../../authoring/src/index.js';
import { validateRegisteredManifest, validateTestManifestPlan } from '../../controlled-tests/src/index.js';
import { graphStatus, pinGraph, validateGraphState } from '../../graph/src/index.js';
import type { GraphView } from '../../graph/src/index.js';
import { copyJson, graphId, identifier } from '../../graph/src/validation.js';
import { parseProposal } from '../../broker/src/index.js';
import type { RunState } from '../../runtime/src/index.js';
import { pin as pinRunInput } from '../../runtime/src/ledger.js';
import { executeSession } from '../../../apps/cli/src/session.js';
import type { SessionCommand, SessionPort } from '../../../apps/cli/src/session.js';
import type { WorkbenchBindings, WorkbenchCommand, WorkbenchDependencies, WorkbenchEvidence, WorkbenchInput, WorkbenchOutcome } from './types.js';
export type * from './types.js';

/** Independent Workbench trust anchor; authored bundles cannot select or repin the scenario. */
export const CRAFT_SHOP_R1_DIGEST = 'sha256:bc620b68e6c6a147f0e121327d5175a50c0b89ea23514e3202b8464ccb6827b8';
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const sha = (v: unknown): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
const fail = (code: string): never => { throw new DefinitionError(code, 'The Workbench session was refused. Inspect the bound installation and recorded evidence.'); };
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
}
function inputCopy(value: unknown): WorkbenchInput {
  const valueCopy = copyJson(value, 3 * 1024 * 1024);
  if (!exact(valueCopy, ['bundle','frozenScenario','installedGraph','registeredManifest','softwareRevision','installationId','designation'])) fail('WORKBENCH_INPUT');
  const input = valueCopy as unknown as WorkbenchInput;
  if (typeof input.frozenScenario !== 'string' || digest(input.frozenScenario) !== CRAFT_SHOP_R1_DIGEST) fail('WORKBENCH_SCENARIO');
  if (!identifier(input.installationId) || !/^[a-f0-9]{40}$/.test(input.softwareRevision)
    || !['authored','reference'].includes(input.designation)) fail('WORKBENCH_SOURCE');
  const bundle = validateAuthoredCrew(input.bundle, input.frozenScenario), graph = pinGraph(input.installedGraph);
  if (!same(graph, authoredGraph(bundle, input.frozenScenario, { workspaceId: graph.workspaceId, runId: graph.runId, owners: graph.owners }))) fail('WORKBENCH_GRAPH');
  if (input.registeredManifest !== bundle.assets['test-manifest']) fail('WORKBENCH_TESTER');
  validateTestManifestPlan(graph.plan, input.registeredManifest);
  return { ...input, bundle, installedGraph: graph };
}
function commandCopy(value: unknown): WorkbenchCommand {
  const c = copyJson(value, 2048);
  if (exact(c, ['command','tier']) && ['up','start'].includes(String(c.command)) && ['pro','5x','20x'].includes(String(c.tier))) return c as unknown as WorkbenchCommand;
  if (exact(c, ['command']) && ['read','review','cancel'].includes(String(c.command))) return c as unknown as WorkbenchCommand;
  if (exact(c, ['command','candidate','action']) && c.command === 'approve' && sha(c.candidate) && sha(c.action)) return c as unknown as WorkbenchCommand;
  return fail('WORKBENCH_COMMAND');
}
function bindings(input: WorkbenchInput): WorkbenchBindings {
  const scenario = parseScenario(input.frozenScenario), manifest = validateRegisteredManifest(input.registeredManifest);
  if (scenario.id !== 'craft-shop-v1' || scenario.revision !== 'r1') fail('WORKBENCH_SCENARIO');
  return { softwareRevision: input.softwareRevision, installationId: input.installationId, designation: input.designation,
    bundleDigest: digest(canonicalJson(input.bundle)), candidateRevision: input.bundle.plan.candidateRevision,
    authoringRevision: input.bundle.authoringRevision, graphId: graphId(input.installedGraph), graphDigest: digest(canonicalJson(input.installedGraph)),
    scenario: { id: 'craft-shop-v1', revision: 'r1', digest: digest(input.frozenScenario), inputs: [scenario.brief, ...scenario.inputs] },
    tester: { manifestDigest: digest(input.registeredManifest), testerDigest: manifest.testerDigest, environmentDigest: manifest.environmentDigest } };
}
const errorCode = (error: unknown): string => {
  const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : null;
  return typeof code === 'string' && /^[A-Z_]{1,100}$/.test(code) ? code : 'WORKBENCH_SESSION_FAILED';
};

/** Authoring/preparation are separate. This runner accepts only an already installed controller capability. */
export function createWorkbenchRunner(value: unknown, dependencies: WorkbenchDependencies): WorkbenchRunner {
  return new WorkbenchRunner(value, dependencies);
}
export class WorkbenchRunner {
  readonly #input: WorkbenchInput;
  readonly #bindings: WorkbenchBindings;
  readonly #open: WorkbenchDependencies['sessions']['open'];
  readonly #clock: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #busy = false;
  #lastTime = 0;
  constructor(value: unknown, dependencies: WorkbenchDependencies) {
    this.#input = inputCopy(value);
    if (!dependencies?.sessions || dependencies.sessions.installationId !== this.#input.installationId
      || typeof dependencies.sessions.open !== 'function') fail('WORKBENCH_INSTALLATION');
    this.#bindings = bindings(this.#input);
    this.#open = dependencies.sessions.open.bind(dependencies.sessions);
    this.#clock = dependencies.now ?? Date.now;
    this.#sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  get bindings(): WorkbenchBindings { return copyJson(this.#bindings); }
  #now(): number {
    let time: unknown;
    try { time = this.#clock(); } catch { fail('WORKBENCH_CLOCK'); }
    if (!Number.isSafeInteger(time) || (time as number) < this.#lastTime) fail('WORKBENCH_CLOCK');
    this.#lastTime = time as number; return time as number;
  }
  #view(value: GraphView): GraphView {
    const copy = copyJson(value);
    if (!exact(copy, ['state','status'])) fail('WORKBENCH_STORED_GRAPH');
    const state = validateGraphState(copy.state);
    if (!same(state.input, this.#input.installedGraph) || state.id !== this.#bindings.graphId
      || state.inputDigest !== this.#bindings.graphDigest || copy.status !== graphStatus(state)) fail('WORKBENCH_STORED_GRAPH');
    return { state, status: copy.status };
  }
  #run(taskId: string, value: RunState | null): RunState | null {
    if (!this.#input.installedGraph.plan.taskOrder.includes(taskId)) fail('WORKBENCH_TASK');
    if (value === null) return null;
    const copy = copyJson(value), task = this.#input.installedGraph.plan.definition.tasks.find(t => t.id === taskId)!;
    if (!exact(copy, ['version','id','input','inputDigest','cancelled','status','reason','process','modelOutcome','proposal','receipt','acceptance'])
      || copy.version !== 1 || typeof copy.cancelled !== 'boolean' || (copy.cancelled && copy.status !== 'CANCELLED')) fail('WORKBENCH_STORED_RUN');
    const checkedInput = pinRunInput(copy.input);
    if (copy.inputDigest !== digest(canonicalJson(checkedInput))) fail('WORKBENCH_STORED_RUN');
    const scope = { workspaceId: this.#input.installedGraph.workspaceId, runId: this.#input.installedGraph.runId, taskId };
    const owner = this.#input.installedGraph.owners[task.owner]!;
    if (!copy.input || !same(copy.input.plan, this.#input.installedGraph.plan) || !copy.input.task
      || !same({ workspaceId: copy.input.task.workspaceId, runId: copy.input.task.runId, taskId: copy.input.task.taskId }, scope)
      || copy.input.task.ownerSubject !== owner.subject || copy.input.task.ownerEpoch !== owner.epoch
      || copy.id !== digest(canonicalJson(scope))) fail('WORKBENCH_STORED_RUN');
    if (!['QUEUED','WAITING_APPROVAL','HOLD','CANCELLED','COMPLETED','ACCEPTANCE_FAILED'].includes(copy.status)
      || (copy.reason !== null && (typeof copy.reason !== 'string' || !/^[A-Z_]{1,100}$/.test(copy.reason)))) fail('WORKBENCH_STORED_RUN');
    if (copy.proposal) {
      const proposal = parseProposal(JSON.stringify(copy.proposal));
      if (!same(proposal.scope, scope) || proposal.candidateRevision !== this.#bindings.candidateRevision || proposal.ownerEpoch !== owner.epoch) fail('WORKBENCH_STORED_RUN');
    }
    if (copy.receipt && (!exact(copy.receipt, ['format','operationKey','actionDigest','workspaceId','path','beforeDigest','afterDigest','bytes','appliedAtMs'])
      || !copy.proposal || copy.receipt.format !== 'trellis/effect-receipt/v0.7-alpha' || copy.receipt.actionDigest !== digest(canonicalJson(copy.proposal))
      || copy.receipt.operationKey !== digest(canonicalJson({ scope, requestId: copy.proposal.requestId, actionDigest: copy.receipt.actionDigest }))
      || copy.receipt.workspaceId !== scope.workspaceId || copy.receipt.beforeDigest !== copy.proposal.edit.expectedDigest
      || copy.receipt.afterDigest !== digest(copy.proposal.edit.content) || copy.receipt.path !== copy.proposal.edit.path
      || copy.receipt.bytes !== Buffer.byteLength(copy.proposal.edit.content) || !Number.isSafeInteger(copy.receipt.appliedAtMs)
      || copy.receipt.appliedAtMs < 0)) fail('WORKBENCH_STORED_RUN');
    if (copy.acceptance && (!exact(copy.acceptance, ['accepted','evidenceRef']) || typeof copy.acceptance.accepted !== 'boolean'
      || !identifier(copy.acceptance.evidenceRef))) fail('WORKBENCH_STORED_RUN');
    if (copy.modelOutcome && (!identifier(copy.modelOutcome.processRef) || !identifier(copy.modelOutcome.proofRef)
      || !Number.isSafeInteger(copy.modelOutcome.completedAtMs) || copy.modelOutcome.completedAtMs < 0)) fail('WORKBENCH_STORED_RUN');
    return copy;
  }
  async execute(value: unknown, signal: AbortSignal): Promise<WorkbenchEvidence> {
    const command = commandCopy(value);
    if (command.command === 'approve' && command.candidate !== this.#bindings.candidateRevision) fail('STALE_APPROVAL');
    if (this.#busy) fail('WORKBENCH_BUSY');
    const startedAtMs = this.#now(); this.#busy = true;
    const calls = { open: 0, status: 0, run: 0, advance: 0, approve: 0, cancel: 0, close: 0 };
    const runs = new Map<string, RunState | null>(); let view: GraphView | null = null, summary: object | null = null;
    let cleanup: WorkbenchEvidence['cleanup'] = 'not-opened', failure: string | null = null, endedAtMs: number | null = null;
    const readOnly = command.command === 'read' || command.command === 'review';
    try {
      calls.open++; cleanup = 'unknown';
      const raw = await this.#open(readOnly ? 'read' : command.command === 'cancel' ? 'cancel' : 'start');
      const status = async (): Promise<GraphView> => { calls.status++; view = this.#view(await raw.status()); return copyJson(view); };
      let cancelled = false;
      const cancel = async (): Promise<void> => {
        if (readOnly) fail('WORKBENCH_READ_ONLY_INTERRUPTED');
        if (cancelled) return;
        await status(); calls.cancel++; await raw.cancel(); cancelled = true;
      };
      const port: SessionPort = {
        status,
        advance: async () => {
          if (readOnly) fail('WORKBENCH_READ_ONLY'); await status();
          if (signal.aborted) { await cancel(); return status(); }
          calls.advance++; view = this.#view(await raw.advance()); return copyJson(view);
        },
        run: async taskId => { calls.run++; const state = this.#run(taskId, await raw.run(taskId)); runs.set(taskId, state); return copyJson(state); },
        approve: async (taskId, candidate, action) => {
          if (command.command !== 'approve' || candidate !== command.candidate || action !== command.action) fail('WORKBENCH_EXACT_APPROVAL');
          await status(); if (signal.aborted) { await cancel(); return; }
          calls.approve++; await raw.approve(taskId, candidate, action);
        },
        cancel,
        close: async () => { calls.close++; await raw.close(); cleanup = 'closed'; },
      };
      const base = { installation: this.#input.installationId };
      let session: SessionCommand;
      switch (command.command) {
        case 'up': case 'start': session = { ...base, command: 'up', tier: command.tier }; break;
        case 'read': session = { ...base, command: 'status' }; break;
        case 'review': case 'cancel': session = { ...base, command: command.command }; break;
        case 'approve': session = { ...base, command: 'approve', candidate: command.candidate, action: command.action }; break;
      }
      await executeSession(session, port, output => { summary = copyJson(output); }, signal, this.#sleep, () => this.#now());
    } catch (error) { failure = errorCode(error); }
    finally {
      try { endedAtMs = this.#now(); } catch { failure ??= 'WORKBENCH_CLOCK'; }
      this.#busy = false;
    }
    const observedRuns = [...runs.values()].filter((r): r is RunState => r !== null);
    const observed = { proposals: observedRuns.filter(r => r.proposal !== null).length, writeReceipts: observedRuns.filter(r => r.receipt !== null).length,
      acceptedTests: observedRuns.filter(r => r.acceptance?.accepted === true).length, completedTasks: observedRuns.filter(r => r.status === 'COMPLETED').length,
      completedModelOutcomes: observedRuns.filter(r => r.modelOutcome !== null).length };
    // A graph completion label alone cannot establish accepted output without both durable receipts and acceptance.
    const lastView = view as GraphView | null;
    let outcome: WorkbenchOutcome = 'unavailable';
    const cleanupOutcome = cleanup as WorkbenchEvidence['cleanup']; // Assigned by the awaited port.close callback.
    if (!failure && cleanupOutcome === 'closed' && lastView) {
      const graph = lastView.status;
      outcome = graph === 'HOLD' ? 'held' : graph === 'CANCELLED' ? 'cancelled' : graph === 'ACCEPTANCE_FAILED' ? 'acceptance-failed'
        : graph === 'COMPLETED' ? observedRuns.length === this.#input.installedGraph.plan.taskOrder.length
          && observedRuns.every(r => {
            const completion = lastView.state.tasks[r.input.task.taskId]?.observation?.completion;
            return r.status === 'COMPLETED' && r.receipt && r.acceptance?.accepted === true && completion
              && same(r.proposal, completion.proposal) && same(r.receipt, completion.receipt) && r.acceptance.evidenceRef === completion.evidenceRef;
          }) ? 'accepted' : 'incomplete' : 'pending';
    }
    return copyJson({ format: 'trellis/workbench-session/v0.7-alpha', bindings: this.#bindings, bindingsDigest: digest(canonicalJson(this.#bindings)),
      command, startedAtMs, endedAtMs, durationMs: endedAtMs === null ? null : endedAtMs - startedAtMs, commandStatus: failure ? 'failed' : 'completed',
      outcome, errorCode: failure, cleanup: cleanupOutcome, graphStatus: lastView?.status ?? null, summary, calls, observed,
      executionCounts: { modelStarts: null, effectWrites: null, browserStarts: null }, usage: { status: 'unavailable', providerTokens: null, retainedAllowanceChange: null },
      capacityTierCalibration: 'unmeasured', comparison: 'not-evaluated' });
  }
}
export const serializeWorkbenchEvidence = (evidence: WorkbenchEvidence): string => canonicalJson(copyJson(evidence));
