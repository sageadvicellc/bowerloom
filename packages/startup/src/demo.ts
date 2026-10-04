import { join } from 'node:path';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { parseScenario } from '../../authoring/src/index.js';
import { copyJson } from '../../graph/src/validation.js';
import { inspectStartup, StartupError, startupInternals as io } from './index.js';
import { DEMO_SCENARIO_DIGEST, DEMO_SOURCE_BYTES } from './demo-scenario.js';
import type { StartupProfile } from './profiles.js';

export interface StartupDemoInput { targetDir: string; expectedRevision: string }
export interface StartupDemoHandoff {
  format: 'bowerloom/startup-demo-handoff/v1beta1'; generation: 'deterministic-proposal'; modelAuthored: false;
  profile: StartupProfile; project: { name: string; goal: string; use: 'discussion-context-only' };
  scenario: { id: 'craft-shop-v1'; revision: 'r1'; classification: 'synthetic'; digest: string; text: string;
    inputs: { asset: string; text: string; bytes: number; digest: string }[] };
  lens: { intent: string; reviewFocus: string; comparison: 'not-evaluated'; measuredGain: null };
  roles: { id: string; label: string; participation: 'planning-only' | 'proposed-demo-owner'; responsibility: string }[];
  tasks: { id: string; owner: string; description: string; dependsOn: string[]; inputs: string[];
    output: { path: string; mediaType: 'text/html' }; requestedEffects: ({ operation: 'workspace.write'; path: string } | { operation: 'command.test'; command: 'craft-shop-ui-v1' })[];
    approval: 'required'; maxAttempts: 1 }[];
  milestones: { id: string; decision: string; requiredEvidence: string[] }[];
  requirements: { maxActiveWorkers: 2; scheduling: 'sequential'; reservePercent: number; paidFallback: false;
    freshCapacityObservation: true; missingCapacity: 'stop'; heldAllowancesPreserved: true; grants: never[];
    registeredTester: 'craft-shop-ui-v1'; authenticatedController: true; exactWriteApprovalPerTask: true };
  nextSteps: { phase: string; interface: string; prerequisites: string[]; effect: string }[];
  personalAgentPrompt: string;
  installedCrewIsDemoCrew: false; authoringComplete: false; runtimeReady: false; executionAuthorized: false; liveAcceptance: 'pending';
}
export interface StartupDemoPlan {
  format: 'bowerloom/startup-demo-plan/v1beta1';
  binding: { targetDir: string; installedRevision: string; receiptSha256: string; compiledCandidate: string };
  profile: StartupProfile; handoff: StartupDemoHandoff; handoffRevision: string; revision: string;
  readOnly: true; runtimeReady: false; executionAuthorized: false;
}
const lenses = {
  engineer: { intent: 'Plan a small, self-contained craft-shop job board and review its implementation boundaries.', reviewFocus: 'Correct job transitions, persistence, export behavior, accessibility, and the four registered browser criteria.' },
  founder: { intent: 'Explore how a fictional craft shop can track its work in a small job board.', reviewFocus: 'Readable stages, a clear daily operating flow, and evidence that the four browser criteria work. No real launch, customer evidence, sales connection, or revenue claim.' },
  research: { intent: 'Propose a repeatable comparison of an authored crew with the Workbench reference using the same craft-shop scenario.', reviewFocus: 'Specify a hypothesis, frozen inputs, baseline, repeated independent trials, measures, uncertainty, stopping rule and confounders before any comparison. This two-task example alone is not an A/B result.' },
} as const;
function fail(code: string): never { throw new StartupError(code); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function assertInput(value: unknown): asserts value is StartupDemoInput {
  (io.record as (value: unknown, required: string[]) => void)(value, ['targetDir', 'expectedRevision']);
  const input = value as StartupDemoInput;
  if (typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) fail('DEMO_EXACT_REVISION_REQUIRED');
}
function frozenScenario(): StartupDemoHandoff['scenario'] {
  const text = DEMO_SOURCE_BYTES.scenario;
  if (digest(text) !== DEMO_SCENARIO_DIGEST) fail('DEMO_SCENARIO_CHANGED');
  const scenario = parseScenario(text);
  if (scenario.id !== 'craft-shop-v1' || scenario.revision !== 'r1') fail('DEMO_SCENARIO_CHANGED');
  const inputs = [scenario.brief, ...scenario.inputs].map(pin => {
    const value = DEMO_SOURCE_BYTES[pin.asset as keyof typeof DEMO_SOURCE_BYTES];
    if (typeof value !== 'string' || digest(value) !== pin.digest || Buffer.byteLength(value) !== pin.bytes) fail('DEMO_SCENARIO_CHANGED');
    return { ...pin, text: value };
  });
  return { id: 'craft-shop-v1', revision: 'r1', classification: 'synthetic', digest: DEMO_SCENARIO_DIGEST, text, inputs };
}
export async function planStartupDemo(input: StartupDemoInput): Promise<StartupDemoPlan> {
  assertInput(input); const targetDir = io.canonicalTarget(input.targetDir);
  const inspected = await inspectStartup(targetDir);
  if (!inspected.specReady || inspected.status !== 'ready-for-review') fail('DEMO_SETUP_NOT_READY');
  if (inspected.revision !== input.expectedRevision) fail('DEMO_STALE_REVISION');
  const receiptPath = join(targetDir, '.bowerloom', 'installation-receipt.json');
  const bytes = io.readManaged(receiptPath, 1024 * 1024), receipt = io.receiptValue(bytes);
  if (receipt.plan.revision !== input.expectedRevision || receipt.plan.compiled.candidateRevision !== inspected.compiledCandidate) fail('DEMO_SETUP_CHANGED');
  const profile = receipt.plan.input.brief.profile ?? 'engineer';
  if (!Object.hasOwn(lenses, profile)) fail('DEMO_PROFILE');
  const sourceOwners = receipt.plan.compiled.definition.owners;
  const lead = sourceOwners.find(owner => owner.id === 'lead'), maker = sourceOwners.find(owner => owner.id === 'maker'), reviewer = sourceOwners.find(owner => owner.id === 'reviewer');
  if (!lead || !maker || !reviewer) fail('DEMO_PROFILE');
  const scenario = frozenScenario();
  const handoff: StartupDemoHandoff = {
    format: 'bowerloom/startup-demo-handoff/v1beta1', generation: 'deterministic-proposal', modelAuthored: false, profile,
    project: { name: receipt.plan.input.brief.projectName, goal: receipt.plan.input.brief.goal, use: 'discussion-context-only' }, scenario,
    lens: { ...lenses[profile], comparison: 'not-evaluated', measuredGain: null },
    roles: [
      { id: 'lead', label: lead.role, participation: 'planning-only', responsibility: 'Help the user review the optional scenario, constraints and milestones through their existing personal agent. This is outside the two-task runtime crew.' },
      { id: 'builder', label: `${maker.role} — demo builder`, participation: 'proposed-demo-owner', responsibility: 'Propose the first functional HTML board from the fixed synthetic inputs.' },
      { id: 'refiner', label: `${reviewer.role} — demo refiner`, participation: 'proposed-demo-owner', responsibility: 'Review the accepted first HTML and propose a clearer, accessible second HTML version. This role writes a refinement; it does not grant independent acceptance or approve its own effect.' },
    ],
    tasks: [
      { id: 'compose', owner: 'builder', description: 'Produce a functional craft-shop job board that follows the frozen browser contract.', dependsOn: [], inputs: ['project-brief', 'contract', 'orders'], output: { path: 'output/design/index.html', mediaType: 'text/html' }, requestedEffects: [{ operation: 'workspace.write', path: 'output/design/index.html' }, { operation: 'command.test', command: 'craft-shop-ui-v1' }], approval: 'required', maxAttempts: 1 },
      { id: 'refine', owner: 'refiner', description: 'Refine clarity and accessibility using the first task’s accepted HTML without changing the frozen behavior.', dependsOn: ['compose'], inputs: ['project-brief', 'contract', 'orders', 'accepted:compose:html'], output: { path: 'output/job-board/index.html', mediaType: 'text/html' }, requestedEffects: [{ operation: 'workspace.write', path: 'output/job-board/index.html' }, { operation: 'command.test', command: 'craft-shop-ui-v1' }], approval: 'required', maxAttempts: 1 },
    ],
    milestones: [
      { id: 'choose', decision: 'Choose whether to pursue this optional synthetic example; declining changes nothing.', requiredEvidence: ['Exact installed revision', 'Frozen scenario and disclosed synthetic inputs', 'No execution authority from setup or this plan'] },
      { id: 'author', decision: 'Review a separate authored demo crew before preparation.', requiredEvidence: ['Personal-agent-authored prompts and skills, relay and Vines maps', 'Two sequential HTML tasks with two proposed owners', 'Unchanged independently selected scenario', 'Trusted registered tester manifest; never invented or copied from a fixture'] },
      { id: 'prepare', decision: 'Separately authorize controller preparation and provisioned execution bindings.', requiredEvidence: ['Validated authored export', 'Authenticated owner identities and exact grants', 'Existing admission account, fresh capacity and held allowances', 'Verified Supabase/PostgreSQL, DBOS and registered browser tester', 'Private installation and approved local control registration'] },
      { id: 'compose-review', decision: 'Review the first exact proposed write before a controller applies it.', requiredEvidence: ['Candidate and action digests', 'Authorized write receipt', 'Registered browser acceptance before the HTML handoff'] },
      { id: 'refinement-review', decision: 'Review the second exact write and actual results; keep unsupported claims pending.', requiredEvidence: ['Accepted predecessor HTML', 'Separate exact write approval and durable receipt', 'Four browser criteria with real evidence', 'No A/B gain or live acceptance claim from this plan'] },
    ],
    requirements: { maxActiveWorkers: 2, scheduling: 'sequential', reservePercent: Math.max(25, receipt.plan.compiled.definition.budget.reservePercent), paidFallback: false,
      freshCapacityObservation: true, missingCapacity: 'stop', heldAllowancesPreserved: true, grants: [], registeredTester: 'craft-shop-ui-v1', authenticatedController: true, exactWriteApprovalPerTask: true },
    nextSteps: [
      { phase: 'personal-agent-authoring', interface: 'packages/workbench/reference-crews/craft-shop-control/authoring.json (reference structure); packages/authoring/src/index.ts: compileAuthoring', prerequisites: ['User elects the optional demo', 'Separate scope before writing a new private authoring project', 'Use the frozen synthetic inputs in this handoff, not the real project goal as scenario input', 'Obtain actual registered tester bytes from the trusted controller before full validation'], effect: 'Author and review a separate crew. This deterministic handoff has not created or authored it. The installed three-task Markdown scaffold is not the two-task Workbench crew.' },
      { phase: 'offline-validation', interface: 'bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json> [--root <directory>]', prerequisites: ['Actual authored files', 'Exact scenario bytes independently selected from Workbench', 'Canonical actual registered tester manifest bound as an asset'], effect: 'Existing commands validate/export bytes only. They start no runtime and grant no execution authority.' },
      { phase: 'trusted-controller-preparation', interface: 'apps/cli/src/provision.ts: prepareAuthoredCraftShop; provisionAuthoredInstallation', prerequisites: ['Validated bundle', 'Reviewed private destination', 'Authenticated owner subjects and epochs', 'Exact task grants and actual registered tester', 'Existing reviewed backend and admission account'], effect: 'Existing controller APIs prepare a private snapshot and provision storage under separate authority. This plan does not invoke them or supply credentials or runtime identity.' },
      { phase: 'separately-authorized-execution', interface: 'packages/workbench/src/index.ts: createWorkbenchRunner', prerequisites: ['Already provisioned installed graph', 'Trusted installed session factory', 'Exact source revision, installation identity and registered manifest', 'Approved local enrollment', 'Fresh capacity admission and exact write approvals'], effect: 'Only a separately authorized controller can drive the installed runner. No demo apply/run command is implied. Live demonstration acceptance remains pending.' },
    ],
    personalAgentPrompt: 'Discuss this optional frozen craft-shop example with me using my installed profile as a lens. Explain that the three-role startup scaffold is not the runnable demo crew. Use this handoff to propose a separate two-owner, two-task authoring project, with prompts, skills, accepted-output relay and Vines logging maps. Keep the fixed synthetic scenario unchanged; my real project goal is context only. The refiner produces a second HTML draft and does not approve its own write. Show inputs, milestones, exact requested effects and capacity controls. Do not write files, provision, start models, run a backend or claim completed work from this plan. After I elect to continue, obtain a separate scope for authoring and the actual tester manifest from a trusted controller before offline validation. Stop at missing authority or unavailable capacity. Research comparisons remain proposed until repeated, separately accepted runs provide evidence.',
    installedCrewIsDemoCrew: false, authoringComplete: false, runtimeReady: false, executionAuthorized: false, liveAcceptance: 'pending',
  };
  const binding = { targetDir, installedRevision: receipt.plan.revision, receiptSha256: io.hash(bytes), compiledCandidate: receipt.plan.compiled.candidateRevision };
  const body = { format: 'bowerloom/startup-demo-plan/v1beta1' as const, binding, profile, handoff, handoffRevision: digest(canonicalJson(handoff)), readOnly: true as const, runtimeReady: false as const, executionAuthorized: false as const };
  const again = await inspectStartup(targetDir);
  if (!again.specReady || again.revision !== input.expectedRevision || again.compiledCandidate !== binding.compiledCandidate || io.hash(io.readManaged(receiptPath, 1024 * 1024)) !== binding.receiptSha256) fail('DEMO_SETUP_CHANGED');
  return freeze({ ...body, revision: digest(canonicalJson(body)) });
}
export async function verifyStartupDemoPlan(value: unknown): Promise<StartupDemoPlan> {
  let plan: StartupDemoPlan | undefined;
  try { plan = copyJson(value, 256 * 1024) as StartupDemoPlan; } catch { fail('DEMO_PLAN_INVALID'); }
  if (!plan || typeof plan.binding?.targetDir !== 'string' || typeof plan.binding?.installedRevision !== 'string') fail('DEMO_PLAN_INVALID');
  const expected = await planStartupDemo({ targetDir: plan.binding.targetDir, expectedRevision: plan.binding.installedRevision });
  if (canonicalJson(plan) !== canonicalJson(expected)) fail('DEMO_PLAN_CHANGED');
  return expected;
}
export function renderStartupDemoReview(plan: StartupDemoPlan): string {
  const safe = (value: string) => value.replace(/\r(?!\n)/g, '\\r');
  return [ 'Optional Bowerloom demo — proposal only', `Project: ${safe(plan.handoff.project.name)}`, `Installed goal (context only): ${safe(plan.handoff.project.goal)}`,
    `Profile: ${plan.profile}`, `Installed revision: ${plan.binding.installedRevision}`, '',
    'Plan a fictional craft-shop job board, or skip this step. The example uses fixed test data. Your real project goal does not replace those inputs.',
    plan.handoff.lens.intent, plan.handoff.lens.reviewFocus, '',
    'A lead helps plan; a builder proposes the first HTML board; a refiner proposes a second version. Review the separate crew, its preparation, and each exact write before proceeding.',
    'This is a deterministic proposal, not model-authored work. The installed three-task team is not the runnable demo crew.',
    `Sequential work; at most 2 active workers; retain ${plan.handoff.requirements.reservePercent}% capacity; no paid fallback. Missing capacity stops admission.`,
    '', 'Neither setup nor this plan authorizes execution. Your personal agent needs a separate authoring scope and the actual registered tester. Controller preparation and execution need separate bindings and approvals.',
    'No measured comparison, improvement, or live acceptance is claimed.',
    'Use --json for the complete agent handoff, fixed test inputs, milestones, and controller interfaces. It includes your saved project name and goal. Keep that text private unless you choose to share it.',
    `Demo plan revision: ${plan.revision}`,
  ].join('\n');
}
