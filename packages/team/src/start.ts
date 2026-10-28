/**
 * The start plan (section 8, rule 3). For each member it lists the folder, the engine and version, the command, the
 * environment names, and the delivery mode, and the loss report gives each delivery mode its result word.
 *
 * It builds the plan only. It starts no engine, opens no socket, and writes nothing. A person approves the plan's
 * revision before any instance starts; `startsAuthorized` is always false here.
 *
 * Refusals (decision 9): an unattended member that needs an approval its engine cannot bring to a person, or that
 * relies on undocumented behavior. In 0.8 nothing brings an approval to a person in an unattended run, so:
 * - an `ask` rule that the engine carries, from the team or the member harness, refuses the start;
 * - OpenCode, whose projected default is `ask`, does not start unattended;
 * - Codex `exec` with an MCP server does not start: its MCP calls cancel under `approval_policy = "never"` (open issue
 *   24135);
 * - a start whose model flag no record names, and DeepSeek Harness headless, are undocumented.
 * A `manual` member is started by a person, who sees each approval.
 */
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { translateGuardrails, projectGuardrails } from '../../fidelity/src/index.js';
import {
  appliesTo, safeName, type EngineId, type EngineTarget, type GuardrailRule, type HookEntry, type LossLine, type McpServer,
  type PartEntries, type Problem, type Result,
} from '../../harness-definition/src/index.js';
import { sha } from '../../project-sync/src/portable-files.js';
import { DELIVERY_TABLE, START_TABLE, atLeast, billingOf, isVersion, type Billing } from './engines.js';
import { confineFolder } from './folders.js';
import { finish } from './messages.js';
import type { Team, TeamLimits, TeamMember } from './types.js';
import { RELAY_MAP_PATH, START_PLAN_FORMAT, type DeliveryMode, type InboxMode, type StartMode } from './words.js';

/** What the plan needs of a member's harness. A loaded harness `Definition` fits. */
export interface StartHarness {
  readonly revision: string;
  readonly harness: { readonly id: string; readonly engines: readonly (EngineTarget | EngineId)[] };
  readonly entries: Pick<PartEntries, 'rules' | 'sandbox' | 'mcp' | 'hooks'>;
}
export interface StartInput {
  /** The absolute path of the project. Member folders are relative to it. */
  readonly projectDir: string;
  /** The recorded version of each engine. This lane runs no engine to read one. */
  readonly versions: Readonly<Partial<Record<EngineId, string>>>;
  /** The loaded harnesses, by id. */
  readonly harnesses: Readonly<Record<string, StartHarness>>;
  /** Recorded fidelity approvals for team guardrails. */
  readonly approvals?: readonly unknown[];
  readonly now?: Date;
  /** The members to start. Default: every member. An empty list is refused. */
  readonly members?: readonly string[];
  /** The home folder, for folder confinement (ruling T1). Default: the user's home folder. */
  readonly home?: string;
}

export interface StartCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin: 'message' | 'none';
  /** Where the command and its flags come from. */
  readonly source: string;
  /** How the command pins the sandbox and the approval behaviour (ruling T5). */
  readonly pinned: { readonly sandbox: string; readonly approval: string };
  /** What ambient engine config still loads, which the plan does not read. */
  readonly ambient: string;
}
export interface Delivery {
  readonly mode: DeliveryMode;
  readonly result: Result;
  readonly reason: string;
}
export interface StartMember {
  readonly id: string;
  readonly purpose: string;
  readonly engine: EngineId;
  readonly version: string;
  readonly model: string;
  readonly harness: { readonly id: string; readonly revision: string; readonly from: 'team' | 'member' };
  /** The absolute path of the member folder. */
  readonly folder: string;
  readonly start: StartMode;
  readonly inbox: InboxMode;
  readonly reports_to: string;
  /** The unattended command, or null for a manual member, whom a person starts. */
  readonly command: StartCommand | null;
  /** Environment names only, never values. */
  readonly environment: readonly string[];
  readonly delivery: Delivery;
  readonly billing: Billing;
  /** How the member's engine carries each team guardrail. */
  readonly guardrails: readonly LossLine[];
}
/** One line of the loss report of a start plan: how a member's delivery mode is carried (check 14). */
export interface DeliveryLine {
  readonly member: string;
  readonly engine: EngineId;
  readonly subject: 'delivery';
  readonly mode: DeliveryMode;
  /** True for the mode Bowerloom picks: the strongest the engine offers. */
  readonly chosen: boolean;
  readonly result: Result;
  readonly reason: string;
}
export interface RelaySummary {
  readonly map: typeof RELAY_MAP_PATH | null;
  readonly bus: 'absent';
  readonly sockets: 0;
  readonly processes: 0;
  readonly reason: string;
  readonly routes: readonly { readonly from: string; readonly to: string; readonly what: string; readonly delivery: string; readonly movedBy: 'a person' }[];
}
export interface StartPlan {
  readonly format: typeof START_PLAN_FORMAT;
  readonly team: { readonly id: string; readonly revision: string };
  readonly relay: RelaySummary;
  readonly limits: TeamLimits;
  readonly members: readonly StartMember[];
  /** The members of the team that this plan does not start. */
  readonly omitted: readonly string[];
  /** One line per member per delivery mode its engine offers (ruling T20). */
  readonly report: readonly DeliveryLine[];
  readonly startsAuthorized: false;
  readonly revision: string;
}
export type StartPlanResult = { readonly ok: true; readonly plan: StartPlan } | { readonly ok: false; readonly problems: readonly Problem[] };

const NO_BUS = 'Bowerloom 0.8 ships no relay bus (decision 7). The relay map is a statement of intent only: it opens no socket, starts no process, and grants no authority. A person moves the files of each route.';
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** Names that look like references and are placeholders the projection rewrites. */
const PLACEHOLDERS = new Set(['PROJECT_DIR']);

/** Builds the start plan of a loaded team. It refuses rather than start what decision 9 forbids. */
export function planTeamStart(team: Team, input: StartInput): StartPlanResult {
  const problems: Problem[] = [];
  const add = (code: string, message: string, path = 'team.json') => { problems.push({ code, path, message }); };
  if (typeof input?.projectDir !== 'string' || !isAbsolute(input.projectDir)) {
    add('TEAM_START_USAGE', 'projectDir must be the absolute path of the project.', '.');
    return { ok: false, problems: finish(problems) };
  }
  const projectDir = resolve(input.projectDir);
  const ids = new Set(team.members.map(m => m.id));
  const wanted = input.members ?? team.members.map(m => m.id);
  if (!Array.isArray(wanted) || wanted.length === 0 || new Set(wanted).size !== wanted.length || wanted.some(id => !ids.has(id))) {
    add('TEAM_START_USAGE', 'members must list one or more distinct member ids of this team.', '.');
    return { ok: false, problems: finish(problems) };
  }
  const selected = team.members.filter(m => wanted.includes(m.id));
  if (selected.length > team.file.limits.activeMembers) {
    add('TEAM_START_LIMIT', `The plan starts ${selected.length} members, and limits.activeMembers is ${team.file.limits.activeMembers}. Start fewer members, or raise the cap.`);
  }

  const members: StartMember[] = [];
  for (const m of selected) {
    const member = planMember(team, m, input, projectDir, add);
    if (member) members.push(member);
  }
  if (problems.length) return { ok: false, problems: finish(problems) };

  const report: DeliveryLine[] = members.flatMap(m => DELIVERY_TABLE[m.engine].modes.map(mode => ({
    member: m.id, engine: m.engine, subject: 'delivery' as const, mode, chosen: mode === m.delivery.mode, result: 'absent' as const,
    reason: deliveryReason(m.engine, mode, m.inbox),
  })));
  const relay: RelaySummary = {
    map: team.relay ? RELAY_MAP_PATH : null, bus: 'absent', sockets: 0, processes: 0, reason: NO_BUS,
    routes: (team.relay?.routes ?? []).map(r => ({
      from: r.fromOwner, to: r.toOwner, delivery: r.delivery, movedBy: 'a person' as const,
      what: r.bindings.length ? r.bindings.map(b => `${r.fromTask}.${b.output} to ${r.toTask}.${b.input}`).join(', ') : `${r.fromTask} to ${r.toTask}`,
    })),
  };
  const body = {
    format: START_PLAN_FORMAT, team: { id: team.file.id, revision: team.revision }, relay, limits: team.file.limits, members,
    omitted: team.members.filter(m => !wanted.includes(m.id)).map(m => m.id), report,
    startsAuthorized: false as const,
  };
  return { ok: true, plan: { ...body, revision: `sha256:${sha(canonicalJson(body))}` } };
}

function planMember(team: Team, m: TeamMember, input: StartInput, projectDir: string, add: (code: string, message: string, path?: string) => void): StartMember | undefined {
  const who = safeName(m.id);
  let failed = false;
  const fail = (code: string, message: string) => { failed = true; add(code, message); };

  const harness = Object.hasOwn(input.harnesses ?? {}, m.harness) ? input.harnesses[m.harness] : undefined;
  if (!harness || harness.harness?.id !== m.harness) {
    fail('TEAM_START_HARNESS_MISSING', `The harness ${safeName(m.harness)} of the member ${who} was not given to the plan.`);
  } else if (!harness.harness.engines.some(e => (typeof e === 'string' ? e : e.id) === m.engine)) {
    fail('TEAM_START_HARNESS_ENGINE', `The harness ${safeName(m.harness)} does not list ${m.engine}, the engine of the member ${who}, so it cannot project into that engine.`);
  }

  const version = Object.hasOwn(input.versions ?? {}, m.engine) ? input.versions[m.engine] : undefined;
  if (!isVersion(version)) fail('TEAM_START_ENGINE_VERSION', `No version of ${m.engine} is recorded for the member ${who}. The plan names the version of each engine.`);

  const place = confineFolder(projectDir, m.folder, { mustExist: true, ...(input.home !== undefined ? { home: input.home } : {}) });
  if (!place.ok) fail(place.code, `The folder of the member ${who} ${place.message}.`);
  const folder = place.ok ? place.abs : resolve(projectDir, m.folder);

  // Check 6 again, with the plan's approvals.
  const { rules, sandbox } = team.file.guardrails;
  let guardrailLines: readonly LossLine[] = [];
  if (rules.length || sandbox.length) {
    const projection = projectGuardrails({ rules, sandbox, engines: [m.engine] }, input.approvals ?? [], input.now ? { now: input.now } : {});
    guardrailLines = projection.report;
    for (const line of projection.verdict.refused) {
      fail('TEAM_GUARDRAIL_NOT_CARRIED', `The member ${who} uses ${m.engine}, which carries the enforced team guardrail ${safeName(line.entry)} as ${line.result}, and no recorded approval covers it.`);
    }
    if (projection.verdict.problems.some(p => p.code === 'APPROVAL_INVALID')) fail('TEAM_APPROVAL_INVALID', 'An approval record given to the plan is not valid.');
  }

  let command: StartCommand | null = null;
  const harnessEntries = harness?.entries;
  const environment = new Set<string>();
  if (harnessEntries) for (const name of referencedNames(harnessEntries, m.engine)) environment.add(name);
  if (m.start !== 'manual') {
    const row = START_TABLE[m.engine][m.start];
    if (!row.supported) fail(row.code, `The member ${who} cannot start ${m.start} on ${m.engine}. ${row.reason}`);
    else {
      if (row.model === null) fail('TEAM_START_UNDOCUMENTED', `No record names the flag that sets the model of ${m.engine} in ${m.start} mode, so the member ${who} would run another model than the team names. Start it manual (decision 9).`);
      if (row.minVersion && isVersion(version) && !atLeast(version, row.minVersion)) {
        fail('TEAM_START_ENGINE_VERSION', `The command for the member ${who} uses flags of ${m.engine} ${row.minVersion} or later, and the recorded version is older.`);
      }
      if (row.pinned === null) fail('TEAM_START_UNPINNED', `The command for the member ${who} cannot pin the sandbox and approval behaviour of ${m.engine} with a recorded flag: ${row.ambient}. Start it manual (ruling T5).`);
      for (const name of row.environment) environment.add(name);
      if (row.model !== null && row.pinned !== null) command = { argv: [...row.argv, ...row.model(m.model, m.inbox)], cwd: folder, stdin: row.stdin, source: row.source, pinned: row.pinned, ambient: row.ambient };
    }
    const asks = approvalNeeds(m.engine, rules, harnessEntries?.rules ?? []);
    if (asks.length) {
      fail('TEAM_START_APPROVAL_UNREACHABLE', `The member ${who} runs unattended on ${m.engine} and needs approvals that no person can give there: ${asks.join('; ')}. An unattended run brings no approval to a person in 0.8 (decision 9). Start the member manual, or remove the ask.`);
    }
    if (m.engine === 'codex' && m.start === 'headless' && (harnessEntries?.mcp ?? []).some(s => appliesTo(s, 'codex'))) {
      fail('TEAM_START_APPROVAL_UNREACHABLE', `The member ${who} runs codex exec with MCP servers. Codex cancels MCP calls under codex exec even with approval_policy "never", and only a bypass worked (open issue 24135). Start the member manual, or give its harness no MCP server for Codex.`);
    }
  }
  if (failed || !harness || !isVersion(version)) return undefined;

  const mode = DELIVERY_TABLE[m.engine].modes[0]!;
  return {
    id: m.id, purpose: m.purpose, engine: m.engine, version, model: m.model,
    harness: { id: m.harness, revision: harness.revision, from: m.harnessFrom },
    folder, start: m.start, inbox: m.inbox, reports_to: m.reports_to, command,
    environment: [...environment].sort(),
    delivery: { mode, result: 'absent', reason: deliveryReason(m.engine, mode, m.inbox) },
    billing: billingOf(m.engine), guardrails: guardrailLines,
  };
}

/** Why a delivery mode is absent in 0.8, and the word the section 6 table gives it with a bus. */
function deliveryReason(engine: EngineId, mode: DeliveryMode, inbox: InboxMode): string {
  const row = DELIVERY_TABLE[engine];
  const refuses = inbox === 'refuse' ? 'The member refuses messages. ' : '';
  return `${refuses}Bowerloom 0.8 has no relay bus (decision 7), so no message reaches the member. With the bus, ${mode} would be ${row.result} for ${engine}: ${row.note}. A person moves the files of each route by hand.`;
}

/**
 * What would ask a person in an unattended run: each `ask` rule the engine carries (a rule it reports `absent` never
 * asks), from the team and from the member harness, and an engine default of `ask`.
 */
function approvalNeeds(engine: EngineId, teamRules: readonly GuardrailRule[], harnessRules: readonly GuardrailRule[]): string[] {
  const out: string[] = [];
  for (const [from, rules] of [['team', teamRules], ['harness', harnessRules]] as const) {
    const t = translateGuardrails(engine, { rules, sandbox: [] });
    const carried = new Set(t.lines.filter(l => l.result !== 'absent').map(l => l.entry));
    const asks = rules.filter(r => r.effect === 'ask' && appliesTo(r, engine) && carried.has(r.id)).map(r => safeName(r.id));
    if (asks.length) out.push(`the ${from} ask rules ${asks.join(', ')}`);
    if (from === 'team' && t.form.defaults.decision === 'ask') out.push(`${engine} asks for any request that no rule matches (${t.form.defaults.reason})`);
  }
  return out;
}

/** The `${NAME}` references in the member harness's MCP servers and hooks that apply to the engine. */
function referencedNames(entries: Pick<PartEntries, 'mcp' | 'hooks'>, engine: EngineId): string[] {
  const texts: string[] = [];
  for (const s of entries.mcp as readonly McpServer[]) {
    if (!appliesTo(s, engine)) continue;
    texts.push(s.command ?? '', ...(s.args ?? []), s.url ?? '');
    for (const v of [...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})]) if (typeof v === 'string') texts.push(v);
  }
  for (const h of entries.hooks as readonly HookEntry[]) if (appliesTo(h, engine)) texts.push(h.command);
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(REFERENCE)) if (!PLACEHOLDERS.has(match[1]!)) names.add(match[1]!);
  return [...names];
}
