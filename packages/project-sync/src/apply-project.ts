/**
 * `bowerloom apply [--harness claude|codex|both]` (build plan 01, M6). It puts the project's skills and prompts in
 * place for the chosen harnesses from what this machine already holds: pinned skills from the private cache, local
 * skills and prompts from `.bowerloom/`. It never fetches; a pin that is not cached refuses SKILLS_OFFLINE and names
 * `skills sync`. It adds copies for the chosen harnesses and never removes one. It never edits AGENTS.md or
 * CLAUDE.md: the plan carries a pointer a person can add there instead (Hanna, answer 5).
 *
 * The plan binds the `skills sync` plan of the same skills (computed offline, for the chosen harnesses) and every
 * prompt's inventory, surfaces, before-pins and previous receipt. Apply reuses the M5 locked run: under one held
 * project lock it plans again, refuses STALE_APPROVAL unless the revision is equal, builds every child plan
 * (phase B, no project write), then applies each child with a revision planned right before it in the same run.
 */
import { join } from 'node:path';
import { freezeSkillData, revisionOf } from '../../skill-sources/src/validation.js';
import { exists, names } from '../../managed-skills/src/observed.js';
import { MANAGED_ROOT, MARKER_V2, catalogItem, ignoreState } from '../../managed-skills/src/v2-observed.js';
import { legacyPresent } from '../../managed-skills/src/migrate.js';
import { temporary } from '../../managed-skills/src/observed.js';
import type { Harness, ManagedItemRequest } from '../../managed-skills/src/v2-types.js';
import type { Identity } from '../../managed-skills/src/observed-types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { isId } from '../../skill-manifest/src/schema.js';
import type { Entry } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { DirectoryIdentity, PinnedDirectory, ProjectContext } from '../../project-context/src/types.js';
import { DefinitionError } from '../../contracts/src/index.js';
import { applyChildren, createPrivateFolders, interrupted, prepareSkillChildren } from './apply.js';
import type { Child } from './apply.js';
import { managedPort } from './deps.js';
import type { Acquirer, ManagedPort } from './deps.js';
import { checkProjectAncestry, isActionable, observeSync, pendingRefusal, stateLayout } from './plan.js';
import type { SyncItem, SyncPlan } from './plan.js';
import { checkPromptChild, classifyPrompt, orphanPrompt, promptRequest, registeredPrompts } from './prompts.js';
import type { PromptItem } from './prompts.js';
import { managedCode, outward, syncError } from './refusal.js';

export const APPLY_PLAN_FORMAT = 'bowerloom/project-apply-plan/v1beta1' as const;
export const APPLY_RESULT_FORMAT = 'bowerloom/project-apply-result/v1beta1' as const;
/** What apply prints in place of an edit to AGENTS.md or CLAUDE.md. Fixed text: it names no path of this machine. */
export const APPLY_POINTER = [
  'Bowerloom never edits AGENTS.md or CLAUDE.md. To point your agents at these copies, add a line like this to AGENTS.md and CLAUDE.md yourself:',
  '  Project skills are in .claude/skills and .agents/skills. Prompts are Claude Code commands in .claude/commands, and Codex skills named prompt-<name>.',
].join('\n');

export interface ApplyInput {
  project: ProjectContext; stateRoot: string;
  /** Sorted, unique, not empty: the harnesses to add copies for. */
  harnesses: Harness[];
  /** Only this team's skills and prompts (`up --team`). Null or absent: every skill and prompt. */
  team?: string | null;
}
export interface ApplyPlan {
  format: typeof APPLY_PLAN_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity };
  harnesses: Harness[]; team: string | null;
  /** The offline `skills sync` plan of the same skills for these harnesses; null when there is no skills.json. */
  skills: SyncPlan | null;
  prompts: PromptItem[];
  privateState: { root: string; projectId: string; cacheRoot: string; itemsRoot: string; create: string[]; pins: { path: string; identity: Identity }[] };
  managed: { ignore: 'absent' | 'exact' };
  /** True when at least one skill or prompt is installed or updated. */
  actionable: boolean;
  pointer: string;
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface ApplyItemRef { kind: 'skill' | 'prompt'; id: string }
export interface ApplyResult {
  format: typeof APPLY_RESULT_FORMAT; planRevision: string; harnesses: Harness[];
  applied: (ApplyItemRef & { action: 'install' | 'update'; receiptRevision: string })[];
  held: (ApplyItemRef & { code: string; next: string })[];
  upToDate: ApplyItemRef[]; orphaned: ApplyItemRef[];
  pointer: string; executionAuthorized: false;
}

const usage = (): never => { throw new DefinitionError('USAGE', 'Use bowerloom apply [--harness claude|codex|both], with optional --approve <revision> and --json.'); };
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const HEX64 = /^[a-f0-9]{64}$/;
const promptActionable = (p: PromptItem): boolean => p.action === 'install' || p.action === 'update';

function harnessSet(value: unknown): Harness[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 || !value.every((h, i) => (h === 'claude' || h === 'codex') && (i === 0 || value[i - 1] < h))) return usage();
  return [...value] as Harness[];
}

/** No item may take a place another item takes, and no new copy may land on something Bowerloom did not install. */
function checkNames(skills: SyncItem[], prompts: PromptItem[]): void {
  for (const item of skills) if (item.hold?.code === 'MANAGED_SKILL_PATH_OCCUPIED') {
    throw syncError('APPLY_NAME_COLLISION', `Skill ${item.id} goes to ${item.expected.surfaces.map(s => s.path).join(', ')}, and Bowerloom did not install what is there. ${item.hold.next.replace('bowerloom skills sync', 'bowerloom apply')}`);
  }
  const owner = new Map<string, string>();
  const rows = [...skills.filter(i => i.state !== 'orphaned').map(i => ({ name: `skill ${i.id}`, surfaces: i.expected.surfaces })), ...prompts.filter(p => p.state !== 'orphaned').map(p => ({ name: `prompt ${p.id}`, surfaces: p.expected.surfaces }))];
  for (const row of rows) for (const s of row.surfaces) {
    const key = s.path.normalize('NFC').toLowerCase(), was = owner.get(key);
    if (was !== undefined && was !== row.name) throw syncError('APPLY_NAME_COLLISION', `Both ${was} and ${row.name} would go to ${s.path}. Give one of them another name, then run bowerloom apply.`);
    owner.set(key, row.name);
  }
}

interface Observed { plan: ApplyPlan; entries: ReadonlyMap<string, Entry> }
/** Plans the apply. Reads only, and never the network. Every refusal here comes before any write anywhere. */
export async function observeApply(input: ApplyInput): Promise<Observed> {
  try {
    const harnesses = harnessSet(input?.harnesses), team = input.team ?? null, project = input.project, dir = project.dir;
    if (team !== null && !isId(team)) throw manifestRefusal('TEAM_NOT_FOUND');
    checkProjectAncestry(project);
    if (legacyPresent(dir)) throw syncError('MANAGED_SKILL_LEGACY_PRESENT');
    if (exists(join(dir, MARKER_V2)) || exists(temporary(join(dir, MARKER_V2)))) throw pendingRefusal(dir);
    if (exists(join(dir, '.bowerloom-revision.json'))) throw syncError('REVISION_PENDING');
    let ignore: 'absent' | 'exact';
    try { ignore = ignoreState(dir); } catch (e) { throw syncError(managedCode(e), 'The file .bowerloom/managed/.gitignore must hold exactly one line, a single *.'); }
    const layout = stateLayout(input);
    // Skills: the sync planner, offline, for the chosen harnesses.
    let skills: SyncPlan | null = null, entries: ReadonlyMap<string, Entry> = new Map();
    if (readManifestState(dir).file !== null) {
      const observed = await observeSync({ project, stateRoot: input.stateRoot, team, offline: true, apply: { harnesses } });
      skills = observed.plan; entries = observed.entries;
    }
    // Prompts: every registered prompt of the team, then catalogs of prompts that are no longer registered.
    const registered = registeredPrompts(dir), prompts: PromptItem[] = registered
      .filter(p => team === null || p.teams.length === 0 || p.teams.includes(team))
      .map(p => classifyPrompt(dir, layout.itemsRoot, p.id, p.teams, harnesses));
    const catalogs = join(dir, MANAGED_ROOT, 'catalog');
    if (exists(catalogs)) for (const n of names(catalogs)) {
      const ref = catalogItem(n);
      if (ref.kind === 'prompt' && !registered.some(p => p.id === ref.id)) prompts.push(orphanPrompt(dir, layout.itemsRoot, ref.id));
    }
    checkNames(skills?.items ?? [], prompts);
    const skillWork = (skills?.items ?? []).filter(isActionable);
    // An apply that changes nothing else still puts back a missing shared ignore file, through one installed prompt.
    if (ignore === 'absent' && !skillWork.length && !prompts.some(promptActionable)) { const first = prompts.find(p => p.state === 'up-to-date'); if (first) first.action = 'update'; }
    const promptWork = prompts.filter(promptActionable), create: string[] = [];
    if (skillWork.length || promptWork.length) {
      create.push(...layout.missing.filter(p => p !== layout.cacheRoot));
      for (const id of [...skillWork.map(i => i.id), ...promptWork.map(p => p.itemId)]) { const p = join(layout.itemsRoot, id); if (!exists(p)) create.push(p); }
    }
    const body = {
      format: APPLY_PLAN_FORMAT,
      project: { dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
      harnesses, team, skills, prompts,
      privateState: { root: layout.root, projectId: project.projectId, cacheRoot: layout.cacheRoot, itemsRoot: layout.itemsRoot, create, pins: layout.pins },
      managed: { ignore }, actionable: skillWork.length + promptWork.length > 0, pointer: APPLY_POINTER,
      writesAuthorized: false as const, executionAuthorized: false as const,
    };
    return { plan: freezeSkillData({ ...body, revision: revisionOf(body) }) as ApplyPlan, entries };
  } catch (e) { throw outward(e); }
}

/** `bowerloom apply` plan. Reads only. */
export async function planProjectApply(input: ApplyInput): Promise<ApplyPlan> { return (await observeApply(input)).plan; }

/** Apply never fetches: phase A only reads the cache. This acquirer is never reached, and refuses if it were. */
const NO_FETCH: Acquirer = Object.freeze({
  npm: async () => { throw syncError('SKILLS_OFFLINE', 'bowerloom apply never fetches. Run bowerloom skills sync first.'); },
  git: async () => { throw syncError('SKILLS_OFFLINE', 'bowerloom apply never fetches. Run bowerloom skills sync first.'); },
});

/**
 * Applies an approved apply plan. `revision` must equal the revision this run computes again under the lock.
 * `signal` is the person's interrupt: it is read between children, never inside one. `deps.managed` is for tests.
 */
export async function applyProjectApply(input: ApplyInput, revision: string, signal: AbortSignal, deps: { managed?: ManagedPort } = {}): Promise<ApplyResult> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw stale();
  if (!(signal instanceof AbortSignal)) throw new TypeError('applyProjectApply needs a signal.');
  const managed = deps.managed ?? managedPort, lock = new AbortController();
  try {
    return await withProjectLock(input.project.dir, lock.signal, async held => {
      const { plan, entries } = await observeApply(input);
      if (plan.revision !== revision) throw stale();
      const dir = plan.project.dir, prompts = plan.prompts.filter(promptActionable), skillWork = (plan.skills?.items ?? []).filter(isActionable);
      if (signal.aborted) throw interrupted([], [...skillWork.map(i => i.id), ...prompts.map(p => p.itemId)], 'bowerloom apply');
      createPrivateFolders(plan, held, dir);
      // Phases A (cache reads only) and B for the skills, then phase B for the prompts. No project write.
      const children: Child[] = plan.skills ? (await prepareSkillChildren(plan.skills, entries, held, { acquirer: NO_FETCH, signal }, managed, 'bowerloom apply')).children : [];
      for (const item of prompts) {
        if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...prompts.map(p => p.itemId)], 'bowerloom apply');
        const req: ManagedItemRequest = promptRequest(dir, plan.privateState.itemsRoot, item);
        let child; try { child = await managed.plan(req, { signal }); } catch (e) { throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to prompt ${item.id}; nothing was changed.`); }
        children.push({ item: { id: item.itemId, action: item.action }, req, plan: checkPromptChild(dir, item, req, child) });
      }
      // Phase C: every child, in order, with a revision planned right before it in this run.
      const applied = await applyChildren(children, held, dir, plan.managed.ignore === 'exact', managed, signal, 'bowerloom apply');
      const refOf = (id: string): ApplyItemRef => { const p = plan.prompts.find(x => x.itemId === id); return p ? { kind: 'prompt', id: p.id } : { kind: 'skill', id }; };
      const skills = plan.skills?.items ?? [];
      return {
        format: APPLY_RESULT_FORMAT, planRevision: plan.revision, harnesses: plan.harnesses,
        applied: applied.map(a => ({ ...refOf(a.id), action: a.action, receiptRevision: a.receiptRevision })),
        held: [...skills.filter(i => i.action === 'hold').map(i => ({ kind: 'skill' as const, id: i.id, code: i.hold!.code, next: i.hold!.next })), ...plan.prompts.filter(p => p.action === 'hold').map(p => ({ kind: 'prompt' as const, id: p.id, code: p.hold!.code, next: p.hold!.next }))],
        upToDate: [...skills.filter(i => i.state === 'up-to-date' && i.action === 'none').map(i => ({ kind: 'skill' as const, id: i.id })), ...plan.prompts.filter(p => p.state === 'up-to-date' && p.action === 'none').map(p => ({ kind: 'prompt' as const, id: p.id }))],
        orphaned: [...skills.filter(i => i.state === 'orphaned').map(i => ({ kind: 'skill' as const, id: i.id })), ...plan.prompts.filter(p => p.state === 'orphaned').map(p => ({ kind: 'prompt' as const, id: p.id }))],
        pointer: APPLY_POINTER, executionAuthorized: false,
      };
    });
  } catch (e) { throw outward(e); }
}
