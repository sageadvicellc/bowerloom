/**
 * `bowerloom up --team <name> [--goal <goal>] [--name <project-name>] [--approve <revision>] [--json]`
 * (build plan 01, M6), with workers held.
 *
 * Stateless: each run looks at the project and computes the one next step.
 * 1. init, when no project holds this folder. It needs --goal; the project name defaults to the folder name, and the
 *    team name becomes the display name of first-team.
 * 2. team, when the name matches neither first-team (by id or display name) nor a created team: `team create`.
 * 3. sync, when .bowerloom/skills.json has skills of the team to install: `skills sync --team <id>`.
 * 4. apply, when skills or prompts of the team need copies for Claude Code and Codex (Hanna, answer 4): `apply`.
 * 5. held: prints `prepared, workers held`, points to .bowerloom/START-HERE.md, and exits 4 (WORKERS_HELD).
 *
 * With --approve, it applies only the step whose revision matches, then shows the next plan and exits 3. In a
 * terminal without --approve it asks before each step. It never starts claude, codex or any other process.
 */
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { checkProjectPath, discoverProject, privateStateRoot, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { LIMITS, readGuarded } from '../../../packages/project-authoring/src/files.js';
import { readAuthoringState } from '../../../packages/project-authoring/src/state.js';
import { applySync, planProjectApply, applyProjectApply, planSync, productionAcquirer } from '../../../packages/project-sync/src/index.js';
import type { Acquirer, ApplyPlan, SyncPlan } from '../../../packages/project-sync/src/index.js';
import type { Harness } from '../../../packages/managed-skills/src/v2-types.js';
import { readManifestState } from '../../../packages/skill-manifest/src/add.js';
import type { StartupPlan } from '../../../packages/startup/src/index.js';
import { renderApplyReview } from './apply.js';
import { parseApprovalFlags, runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { createChange, renderCreateReview } from './create.js';
import { exitCodeFor, newCommandJson, newCommandRefusal, plainText } from './human.js';
import { terminalIo } from './manifest.js';
import { runStartupCommand } from './startup.js';
import { harnessWords, renderSyncReview } from './sync.js';

export type UpStep = 'init' | 'team' | 'sync' | 'apply' | 'held';
export const UP_STEP_FORMAT = 'bowerloom/up-step/v1beta1' as const;
export const FIRST_TEAM = 'first-team';
const START_HERE = '.bowerloom/START-HERE.md';
const UP_USAGE = 'Use bowerloom up --team <name> [--goal <goal>] [--name <project-name>], with optional --approve <revision> and --json. A folder with no .bowerloom needs --goal.';
const usage = (message = UP_USAGE): never => { throw new DefinitionError('USAGE', message); };

export interface UpContext {
  cwd: string; home: string; env: NodeJS.ProcessEnv;
  /** The --team value: first-team's id or display name, a created team's id, or a new team's id. */
  team: string;
  goal: string | null; name: string | null;
  harnesses: Harness[]; acquirer: Acquirer;
}
export interface UpTeam { id: string; name: string }
/** What an agent sees with --json: the step, the team, and the step's own plan. Its revision is the step plan's. */
export interface UpStepPlan<P = unknown> { format: typeof UP_STEP_FORMAT; step: Exclude<UpStep, 'held'>; team: UpTeam; plan: P }
export interface UpNext { step: UpStep; team: UpTeam; change: PlannedChange<UpStepPlan> | null }

const codeOf = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, ' ');

/** A step's change, with its plan wrapped so the step and team show in --json. */
function wrap<P extends { revision: string }>(step: Exclude<UpStep, 'held'>, team: UpTeam, change: PlannedChange<P>, heading: (plan: P) => string): PlannedChange<UpStepPlan> {
  return {
    async plan() { return { format: UP_STEP_FORMAT, step, team, plan: await change.plan() }; },
    revision: wrapped => (wrapped.plan as P).revision,
    review: wrapped => `${heading(wrapped.plan as P)}\n${change.review(wrapped.plan as P)}`,
    apply: revision => change.apply(revision),
  };
}

function initStep(ctx: UpContext): UpNext {
  if (ctx.goal === null) usage('This folder has no .bowerloom yet. Run bowerloom up --team <name> --goal <goal> once to set it up.');
  let target: string; try { target = realpathSync(ctx.cwd); } catch { return usage(); }
  checkProjectPath(target, ctx.home);
  const name = ctx.name ?? basename(target), team: UpTeam = { id: FIRST_TEAM, name: ctx.team };
  const args = (mode: 'plan' | 'apply') => ['init', mode, '--mode', 'existing', '--target', target, '--name', name, '--goal', ctx.goal!, '--team', ctx.team];
  const lock = new AbortController();
  const change: PlannedChange<StartupPlan> = {
    plan: async () => await runStartupCommand(args('plan')) as StartupPlan,
    revision: plan => plan.revision,
    review: plan => [
      `  Project: ${plan.input.brief.projectName}`,
      `  Goal: ${oneLine(plan.input.brief.goal)}`,
      `  Folder: ${plan.input.targetDir} (an existing folder: adds .bowerloom only, and your files stay as they are)`,
      `  Team: ${plan.input.brief.teamName} (${FIRST_TEAM})`,
      `  Creates ${plan.files.length} setup files and a private installation receipt in .bowerloom.`,
      'Then each run shows the next step, if any: team, skills sync and apply, each with its own plan. Workers stay held.',
      'This writes setup files only. It starts no workers and runs nothing.',
    ].join('\n'),
    apply: revision => withProjectLock(target, lock.signal, async () => runStartupCommand([...args('apply'), '--approve', revision])),
  };
  return { step: 'init', team, change: wrap('init', team, change, () => `Next step: init. Set up .bowerloom in this folder for team ${ctx.team}.`) };
}

/** first-team's display name: the team name in .bowerloom/brief.json, read with the authoring guards. */
function firstTeamName(project: ProjectContext): string {
  try {
    const value = JSON.parse(readGuarded(join(project.dir, '.bowerloom', 'brief.json'), LIMITS.briefBytes).toString('utf8')) as { teamName?: unknown };
    if (typeof value.teamName === 'string') return value.teamName;
  } catch { /* Refused below. */ }
  throw new DefinitionError('PROJECT_BRIEF_INVALID', 'The project brief, .bowerloom/brief.json, cannot be read, so Bowerloom cannot tell whether the team is first-team.');
}
/** The team the --team value names, or null when it names no team of this project yet. */
function resolveTeam(project: ProjectContext, value: string): UpTeam | null {
  const display = value === FIRST_TEAM ? null : firstTeamName(project);
  if (value === FIRST_TEAM || value === display) return { id: FIRST_TEAM, name: display ?? firstTeamName(project) };
  const created = readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? [];
  return created.some(i => i.kind === 'team' && i.id === value) ? { id: value, name: value } : null;
}

/** Computes the next step. Reads only. */
export async function nextUpStep(ctx: UpContext): Promise<UpNext> {
  let project: ProjectContext;
  try { project = discoverProject(ctx.cwd, ctx.home); } catch (e) { if (codeOf(e) === 'PROJECT_NOT_FOUND') return initStep(ctx); throw e; }
  const team = resolveTeam(project, ctx.team);
  if (team === null) {
    const created: UpTeam = { id: ctx.team, name: ctx.team };
    return { step: 'team', team: created, change: wrap('team', created, createChange(project, { kind: 'team', project: project.dir, name: ctx.team }), () => `Next step: team. Create team ${ctx.team} for this project.`) };
  }
  const stateRoot = privateStateRoot(ctx.env, ctx.home);
  if (readManifestState(project.dir).file !== null) {
    const input = () => ({ project, stateRoot, team: team.id, offline: false });
    const plan = await planSync(input());
    if (plan.items.some(i => i.action === 'install' || i.action === 'update')) {
      const lock = new AbortController(), change: PlannedChange<SyncPlan> = {
        plan: () => planSync(input()), revision: p => p.revision, review: renderSyncReview,
        apply: revision => applySync(input(), revision, { acquirer: ctx.acquirer, signal: lock.signal }),
      };
      return { step: 'sync', team, change: wrap('sync', team, change, () => `Next step: sync. Install the skills of team ${team.name} on this machine.`) };
    }
  }
  const applyInput = () => ({ project, stateRoot, harnesses: ctx.harnesses, team: team.id });
  if ((await planProjectApply(applyInput())).actionable) {
    const lock = new AbortController(), change: PlannedChange<ApplyPlan> = {
      plan: () => planProjectApply(applyInput()), revision: p => p.revision, review: renderApplyReview,
      apply: revision => applyProjectApply(applyInput(), revision, lock.signal),
    };
    return { step: 'apply', team, change: wrap('apply', team, change, () => `Next step: apply. Put the skills and prompts of team ${team.name} in place for ${harnessWords(ctx.harnesses)}.`) };
  }
  return { step: 'held', team, change: null };
}

/** The end of every chain: prepared, workers held. Exit 4 through newCommandRefusal. */
function held(ctx: UpContext, team: UpTeam, json: boolean, write: (text: string) => void): never {
  write(json
    ? newCommandJson({ format: 'bowerloom/up-held/v1beta1', step: 'held', status: 'prepared, workers held', team, harnesses: ctx.harnesses, startHere: START_HERE, workersStarted: false, executionAuthorized: false })
    : plainText([
      'prepared, workers held',
      `  Team: ${team.name} (${team.id}), with skills and prompts in place for ${harnessWords(ctx.harnesses)}.`,
      `  Next: read ${START_HERE}. This beta starts no worker; worker launch comes after the startup gate.`, '',
    ].join('\n'), true));
  throw newCommandRefusal('WORKERS_HELD', `prepared, workers held. Read ${START_HERE}. No worker was started.`);
}

/** Splits the up command line. Every value flag at most once; anything else is the approval wrapper's. */
export function parseUpArgs(args: readonly string[]): { team: string; goal: string | null; name: string | null; rest: string[] } {
  const values = new Map<string, string>(), rest: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const word = args[i]!;
    if (word === '--team' || word === '--goal' || word === '--name') {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-') || values.has(word)) usage();
      values.set(word, value!);
    } else rest.push(word);
  }
  if (args[0] !== 'up' || !values.has('--team')) usage();
  return { team: values.get('--team')!, goal: values.get('--goal') ?? null, name: values.get('--name') ?? null, rest };
}

const QUIET: ApprovalIo = Object.freeze({ interactive: false, ask: async () => '' });
/**
 * Review M6 finding 4: a step was applied and the next plan then refused. The refusal keeps its code (and its port or
 * hint), and its message first says that the step was applied, so nobody takes the exit 1 for "nothing changed".
 * An approval gate (exit 3) or workers held (exit 4) passes through unchanged.
 */
function afterApplied(step: UpStep, error: unknown): unknown {
  const exit = exitCodeFor(error);
  if (exit === 3 || exit === 4) return error;
  const raw = codeOf(error), code = typeof raw === 'string' && /^[A-Z_]{1,100}$/.test(raw) ? raw : 'IO_ERROR';
  const then = error instanceof DefinitionError ? `The next step was then refused: ${error.message}` : 'The next step then failed. Review the relevant local files before another action.';
  const wrapped = new DefinitionError(code, `The ${step} step was applied. ${then}`);
  for (const key of ['port', 'hint']) if (error !== null && typeof error === 'object' && key in error) Object.defineProperty(wrapped, key, { value: (error as Record<string, unknown>)[key], enumerable: false });
  return wrapped;
}
/** `bowerloom up --team <name>`. Returns 3 when a step waits for approval; held throws WORKERS_HELD (exit 4). */
export async function runUpCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env, acquirer: Acquirer = productionAcquirer): Promise<number> {
  const parsed = parseUpArgs(args), approval = parseApprovalFlags(parsed.rest);
  if (approval.rest.length) usage();
  const ctx: UpContext = { cwd, home, env, team: parsed.team, goal: parsed.goal, name: parsed.name, harnesses: ['claude', 'codex'], acquirer };
  const json = approval.json ? ['--json'] : [];
  let next = await nextUpStep(ctx);
  if (approval.approve !== undefined) {
    if (next.change === null) return held(ctx, next.team, approval.json, write);
    await runApprovalCommand(['--approve', approval.approve, ...json], next.change, QUIET, write);
    const applied = next.step;
    try {
      next = await nextUpStep(ctx);
      if (next.change === null) return held(ctx, next.team, approval.json, write);
      if (!approval.json) write('\n');
      return await runApprovalCommand(json, next.change, QUIET, write);
    } catch (error) { throw afterApplied(applied, error); }
  }
  // In a terminal: ask before each step, until the project is prepared.
  let applied: UpStep | null = null;
  try {
    for (;;) {
      if (next.change === null) return held(ctx, next.team, approval.json, write);
      const code = await runApprovalCommand(json, next.change, io, write);
      if (code !== 0) return code;
      applied = next.step; write('\n'); next = await nextUpStep(ctx);
    }
  } catch (error) { throw applied === null ? error : afterApplied(applied, error); }
}
