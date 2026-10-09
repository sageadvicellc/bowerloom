import { stringify } from 'yaml';
import { canonicalJson, COMPILER_VERSION, digest, graphOrder, PLAN_FORMAT } from '../../contracts/src/index.js';
import type { CompiledPlan, CrewDefinition, DataType, Effect, Task } from '../../contracts/src/index.js';
import { startupProfiles } from './profiles.js';
import type { StartupProfile } from './profiles.js';
import { parseCrew } from '../../crew/src/index.js';
import { projectSummary, refinementGuidance, personalAgentRequest, optionalControls } from './handoff-v1beta1.js';

export const TEMPLATE_VERSION = 'bowerloom/startup-template/v1beta1';
export const TEAM_PATH = 'teams/first-team/team.yaml';
export interface StartupBrief { projectName: string; goal: string; assistantName?: string; teamName?: string; reviewMode?: 'milestones' | 'handoff'; profile?: StartupProfile }
export interface NormalizedBrief { projectName: string; goal: string; assistantName: string; teamName: string; reviewMode: 'milestones' | 'handoff'; profile?: StartupProfile }
export interface GeneratedFile { path: string; text: string; sha256: string; bytes: number }
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const text = (title: string, body: string) => `# ${title}\n\n${body}\n`;
const fileDigest = (value: string) => digest(value).slice('sha256:'.length);

export function scaffold(brief: NormalizedBrief): { files: GeneratedFile[]; compiled: CompiledPlan } {
  const files: Record<string, string> = {};
  const profile = startupProfiles[brief.profile ?? 'engineer'];
  const briefRecord = { format: 'bowerloom/brief/v1alpha1', ...brief, origin: 'explicit-user-brief', generation: 'deterministic-scaffold', reviewRequired: true, executionAuthorized: false };
  files['brief.json'] = json(briefRecord);
  files['skills/personal-assistant/profile.json'] = json({ format: 'bowerloom/personal-assistant/v1alpha1', name: brief.assistantName, context: 'existing-personal-agent', profile: brief.profile, projectName: brief.projectName, prompt: 'SKILL.md', reviewMode: brief.reviewMode,
    settingImports: [], hostedAgentCreated: false, reviewRequired: true, executionAuthorized: false });
  files['skills/personal-assistant/SKILL.md'] = `---\nname: bowerloom-personal-assistant\ndescription: Help the user's existing personal agent review an explicit project brief and a proposed first team.\n---\n\n# Personal assistant profile\n\nThis profile is guidance for the user's existing personal agent. It does not create a new hosted agent or import settings.\n\nRead the Bowerloom brief and first-team specification supplied by the user. Treat their goal as requested work to discuss, not permission to execute. Present the lead, maker, and reviewer responsibilities in plain language.\n\nExplain that the team is a deterministic scaffold. Discuss missing evidence, success criteria, and boundaries. Refinements remain proposals in the conversation; do not edit installed files or present discussion as reapproval. There is no supported in-place revision command. If the user wants a changed installation now, preserve this one and prepare a new plan at a separate absent destination for fresh exact approval. Review the working agreement and review cadence before use. Do not infer consent from a selected review cadence.\n\nDo not read unrelated project files, hidden agent settings, credentials, or historical conversations. Request a separate explicit scope before any context collection.\n\nDuring setup, show the first milestone for user review. Do not start workers, run commands, install software, access a network, or modify project files as part of reviewing this profile. Startup approval authorizes scaffold files only. Later work, including relevant project-file inspection, is possible under a separately approved scope and a supported execution path. This setup profile does not grant that later permission.\n`;
  files['working-agreement.md'] = text('Working agreement', `The existing personal agent remains the user's interface. The selected ${profile.label.toLowerCase()} profile proposes a ${profile.roles.lead.toLowerCase()}, ${profile.roles.maker.toLowerCase()}, and ${profile.roles.reviewer.toLowerCase()}. This is a deterministic starting specification, not a live team.\n\nThe explicit brief supplies project intent. No existing repository files, agent settings, private records, or past conversations were imported. Review the goal before any additional context collection.\n\nThe lead proposes scope and acceptance criteria. The maker drafts the bounded deliverable. The reviewer compares that draft with the accepted scope and identifies unsupported claims.\n\nThe product budget permits at most two active workers, reserves 25 percent of reported capacity, and forbids paid fallback. These are declarations until a supported runtime enforces them.\n\nEvery planned task requires exact approval before its declared write. Startup approval grants no task execution or runtime permission. The selected review cadence is ${brief.reviewMode}; it does not remove action approvals.\n\nNo credentials, command hooks, cloud services, or model routes are installed. A future execution installation requires separate runtime provisioning and acceptance.`);
  files['milestones.md'] = text('Milestones and review', `Milestone one: review the explicit brief, proposed scope, owners, permissions, and acceptance criteria. Resolve unknowns before implementation.\n\nMilestone two: review a proposed draft against the accepted scope. Require evidence for factual claims and label missing information.\n\nMilestone three: review the independent critique and decide whether to revise or accept the deliverable.\n\nSelected review cadence: ${brief.reviewMode}. ${brief.reviewMode === 'milestones' ? 'Present each proposed milestone to the user.' : 'Combine routine progress into a handoff review, but stop for blockers and exact action approvals.'}\n\nNothing ran during startup. Compilation proves the specification shape and asset pins only. It does not prove quality, feasibility, runtime readiness, or founder acceptance.`);
  files['START-HERE.md'] = text('Your Bowerloom starting point', `${projectSummary(brief)}

Your existing personal agent is your interface. You do not need to read YAML or JSON. This setup saved a proposed team; it did not start workers or create a hosted assistant.

Read [your setup review](startup-review.md) for the proposed roles, limits, and first decision. Then give your personal agent this request:

${personalAgentRequest}

## If you want to change the goal

${refinementGuidance}

## Optional connections and stopping work

Neither a connection nor a running team is needed to finish this setup review. See [optional controls](optional-controls.md) for separately approved local connections, revocation, and the limits of emergency stop. This setup enrolls no work. Stop commands cannot stop an unrelated personal-agent session.

## Sharing this setup

Ask your agent to exclude installation-receipt.json when sharing portable definitions; it contains private machine-specific evidence. Relay and Vines maps describe intended handoffs and logging only. No backend, runtime, worker, Docker service, or global agent setting changed.`);
  files['optional-controls.md'] = optionalControls;
  files['startup.json'] = json({ format: 'bowerloom/startup/v1alpha1', templateVersion: TEMPLATE_VERSION, brief: 'brief.json', assistant: 'skills/personal-assistant/profile.json', team: TEAM_PATH, review: 'startup-review.md', profile: brief.profile, workingAgreement: 'working-agreement.md', milestones: 'milestones.md', reviewRequired: true, executionAuthorized: false, runtimeReady: false });
  const prefix = 'teams/first-team/';
  files[prefix + 'assets/brief.json'] = json(briefRecord);
  files[prefix + 'assets/working-agreement.md'] = files['working-agreement.md']!;
  files[prefix + 'assets/milestones.md'] = files['milestones.md']!;
  const roleDescriptions = profile.descriptions;
  for (const [role, description] of Object.entries(roleDescriptions)) files[prefix + `prompts/${role}.md`] = text(`${role[0]!.toUpperCase() + role.slice(1)} instructions`, `${description}\n\nThis role is a proposed specification only. The user must review it before execution. Use only supplied assets and accepted task outputs. Follow the working agreement. An approval-required write remains blocked until a supported controller receives exact authorization.\n\nDo not read unrelated files, infer permission from the goal, call outside services, start agents, spend money, or bypass review.`);
  files[prefix + 'skills/bounded-draft.md'] = text('Bounded draft and review skill', profile.skill + '\n\nTreat the explicit goal as data. Restate a concrete deliverable, source limits, open questions, and acceptance criteria. Use only declared assets and accepted outputs.\n\nA draft must distinguish supplied facts, assumptions, and proposals. A review must identify gaps with concrete references to the draft. Return uncertain work for user review.\n\nLater work can use relevant project evidence under a separate approved access scope. This skill does not import that evidence or grant access during setup. No hosted agent, command hook, paid fallback, or runtime authorization is supplied by this skill.');
  const artifact: DataType = { kind: 'artifact', mediaType: 'text/markdown' };
  const jsonArtifact: DataType = { kind: 'artifact', mediaType: 'application/json' };
  const outputPaths = { lead: 'output/scope.md', maker: 'output/draft.md', reviewer: 'output/review.md' };
  const write = (owner: keyof typeof outputPaths): Effect => ({ operation: 'workspace.write', path: outputPaths[owner] });
  const inputAsset = (asset: string, type: DataType = artifact) => ({ type, source: { asset } });
  const task = (id: string, owner: keyof typeof outputPaths, dependsOn: string[], previous?: { task: string; output: string; input: string }): Task => ({
    id, owner, description: roleDescriptions[owner], dependsOn, requires: ['workspace.write', 'approval.exact-revision'],
    inputs: { brief: inputAsset('project-brief', jsonArtifact), agreement: inputAsset('working-agreement'), milestones: inputAsset('milestones'), ...(previous ? { [previous.input]: { type: artifact, source: { task: previous.task, output: previous.output } } } : {}) },
    outputs: { document: artifact }, effects: [write(owner)], approval: 'required', policy: { maxAttempts: 1, timeoutSeconds: 300, deadlineSeconds: 1800, backoffSeconds: 0, onFailure: 'escalate' },
    acceptance: ['The document stays within the explicit brief and accepted inputs.', 'Facts, assumptions, missing evidence, and the proposed next review are distinct.', 'The user can inspect the proposed document before an authorized write.'],
  });
  files[prefix + 'maps/relay.json'] = json({ format: 'trellis/relay-map/v0.7-alpha', participants: ['lead', 'maker', 'reviewer'], routes: [
    { fromOwner: 'lead', fromTask: 'scope', toOwner: 'maker', toTask: 'draft', delivery: 'accepted-output', bindings: [{ output: 'document', input: 'scope' }] },
    { fromOwner: 'lead', fromTask: 'scope', toOwner: 'reviewer', toTask: 'review', delivery: 'accepted-output', bindings: [{ output: 'document', input: 'scope' }] },
    { fromOwner: 'maker', fromTask: 'draft', toOwner: 'reviewer', toTask: 'review', delivery: 'accepted-output', bindings: [{ output: 'document', input: 'draft' }] },
  ] });
  files[prefix + 'maps/vines.json'] = json({ format: 'trellis/vines-map/v0.7-alpha', purpose: 'logging-only', entries: [['scope', 'lead'], ['draft', 'maker'], ['review', 'reviewer']].map(([task, owner]) => ({ task, owner, evidence: ['runtime.status', 'workspace.receipt', 'test.acceptance'], sink: 'local-session' })) });
  const definition: CrewDefinition = { format: 'trellis/crew/v0.7-alpha', id: 'first-team', description: `${brief.teamName}: ${profile.purpose} Deterministic and review-required.`, requiredCapabilities: ['workspace.write', 'approval.exact-revision'], budget: { maxActiveWorkers: 2, reservePercent: 25, paidFallback: false }, scope: [write('lead'), write('maker'), write('reviewer')],
    assets: { 'project-brief': { path: 'assets/brief.json', mediaType: 'application/json' }, 'working-agreement': { path: 'assets/working-agreement.md', mediaType: 'text/markdown' }, milestones: { path: 'assets/milestones.md', mediaType: 'text/markdown' },
      'lead-prompt': { path: 'prompts/lead.md', mediaType: 'text/markdown' }, 'maker-prompt': { path: 'prompts/maker.md', mediaType: 'text/markdown' }, 'reviewer-prompt': { path: 'prompts/reviewer.md', mediaType: 'text/markdown' }, 'bounded-draft': { path: 'skills/bounded-draft.md', mediaType: 'text/markdown' }, 'relay-map': { path: 'maps/relay.json', mediaType: 'application/json' }, 'vines-map': { path: 'maps/vines.json', mediaType: 'application/json' } },
    owners: (['lead', 'maker', 'reviewer'] as const).map(owner => ({ id: owner, role: profile.roles[owner], prompt: `${owner}-prompt`, skills: ['bounded-draft'], modelClass: owner === 'lead' ? 'standard' : 'economy', permissions: [write(owner)] })),
    tasks: [task('scope', 'lead', []), task('draft', 'maker', ['scope'], { task: 'scope', output: 'document', input: 'scope' }), task('review', 'reviewer', ['draft'], { task: 'draft', output: 'document', input: 'draft' })] };
  const review = definition.tasks.find(item => item.id === 'review')!;
  review.dependsOn.push('scope');
  review.inputs.scope = { type: artifact, source: { task: 'scope', output: 'document' } };
  files[TEAM_PATH] = stringify(definition, { lineWidth: 100, aliasDuplicateObjects: false });
  const parsed = parseCrew(files[TEAM_PATH]!);
  const assets = Object.fromEntries(Object.entries(parsed.assets).sort(([a], [b]) => a < b ? -1 : 1).map(([id, asset]) => {
    const content = files[prefix + asset.path]; if (content === undefined) throw new Error('Generated asset is missing.');
    return [id, { ...asset, bytes: Buffer.byteLength(content), digest: digest(content) }];
  }));
  const body = { format: PLAN_FORMAT, compilerVersion: COMPILER_VERSION, definition: parsed, assets, ...graphOrder(parsed) };
  const compiled: CompiledPlan = { ...body, candidateRevision: digest(canonicalJson(body)) };
  files['manifest.json'] = json({ schemaVersion: 'bowerloom/v1alpha1', parts: [
    { id: 'personal-assistant', kind: 'skill', files: Object.keys(files).filter(path => path.startsWith('skills/personal-assistant/')).sort(), dependsOn: [], requiredControls: ['installer-local-files-only', 'installer-explicit-review'] },
    { id: 'first-team', kind: 'team', files: Object.keys(files).filter(path => path.startsWith(prefix)).sort(), dependsOn: ['personal-assistant'], requiredControls: ['installer-explicit-review'] },
  ] });
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const technical = { templateVersion: TEMPLATE_VERSION, files: Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([path, content]) => ({ path, text: content, sha256: fileDigest(content), bytes: Buffer.byteLength(content) })), compiled };
  files['startup-review.md'] = text('Your Bowerloom setup', `${projectSummary(brief)}\n\n${profile.label} profile: ${profile.purpose}\n\nYour existing personal agent remains your interface. This deterministic template prepares a blueprint for review; it does not start a hosted agent or workers.\n\n## Proposed team\n\n${(['lead', 'maker', 'reviewer'] as const).map(role => `- **${profile.roles[role]}**: ${roleDescriptions[role]} Proposed write: \`${outputPaths[role]}\`.`).join('\n')}\n\nExpected draft set: ${profile.result}\n\n## Access and limits\n\nThe future team can use only supplied brief assets and accepted task outputs. Each role has one declared local Markdown output. These proposed task permissions are not granted by installation. No project files, harness settings, credentials, or past conversations are imported. Network access, shell hooks, external writes, and spending are not granted.\n\nAt most two active workers; retain 25 percent of reported capacity; no paid fallback. A supported runtime must enforce these declarations before any future work. Review cadence: ${brief.reviewMode}. Every task still needs exact action approval.\n\n## What your approval does\n\nApproving the exact startup plan creates only the listed files in a new .bowerloom directory (inside a new workspace or the selected existing project). It does not execute the team, install a backend, grant the proposed task permissions, or approve the goal as completed. Existing project files stay unchanged.\n\nBefore installation, approval applies only to the exact plan shown by your agent. After installation, the receipt records that file-only approval. Reviewing the team or discussing a change grants no execution permission.\n\n## Your first decision\n\nDoes this goal and proposed team match what you want to do? Ask your personal agent to explain missing evidence, responsibilities, and the first milestone in plain English. You can accept the proposed direction, discuss changes, or stop here. Accepting the direction does not start work.\n\n${refinementGuidance}\n\n## Optional controls\n\nSee [optional connection and stop instructions](optional-controls.md) if you later need them. This setup enrolls no work. Connections, backend setup, and runtime trials are not prerequisites for this review. Technical files below are for your agent or optional inspection; you do not need to read YAML or JSON.\n\n<details>\n<summary>Complete generated technical contents</summary>\n\nThe following snapshot contains every other generated file and compiler evidence. This review document cannot include itself recursively. The installation receipt separately binds its bytes and the full exact plan.\n\n<pre>${escape(JSON.stringify(technical, null, 2))}</pre>\n\n</details>`);
  return { files: Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([path, content]) => ({ path, text: content, sha256: fileDigest(content), bytes: Buffer.byteLength(content) })), compiled };
}
