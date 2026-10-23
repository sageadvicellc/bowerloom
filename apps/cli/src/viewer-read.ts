/**
 * Read-only views for the desktop viewer (apps/desktop). Nothing here writes a file, takes a lock, or reaches the network.
 * `readProjectPlan` is the part of `bowerloom status` that plans the project's agents, prompts, skills, and slices, and
 * returns the plan instead of printing it. No existing command calls this file, so no command output changes.
 */
import { privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { planProjectApply } from '../../../packages/project-sync/src/index.js';
import type { AgentItem, PromptItem, SliceItem, SyncItem } from '../../../packages/project-sync/src/index.js';
import { missingItems, planHolds, uniqueHolds } from './held.js';
import type { HeldItem } from './held.js';

export interface ProjectPlanView {
  /** The agents of the project's teams (`planProjectApply().agents`). */
  agents: readonly AgentItem[];
  prompts: readonly PromptItem[];
  skills: readonly SyncItem[];
  slices: readonly SliceItem[];
  /** Everything held, with the code and the next step, once each. */
  held: readonly HeldItem[];
  /** The code of the refusal that made the full plan unavailable, or null. The agents are planned alone then. */
  unavailable: string | null;
}

/** Plans a project the way `status` does and returns the plan. A refusal gives `unavailable`, never a throw. */
export async function readProjectPlan(project: ProjectContext, env: NodeJS.ProcessEnv, home: string): Promise<ProjectPlanView> {
  const empty: ProjectPlanView = { agents: [], prompts: [], skills: [], slices: [], held: [], unavailable: null };
  if (project.bowerloomIdentity === null) return empty;
  let held: HeldItem[] = [];
  try { held = missingItems(project, null); } catch { held = []; }
  const base = { project, stateRoot: privateStateRoot(env, home), home, harnesses: ['claude' as const, 'codex' as const], team: null };
  try {
    const plan = await planProjectApply(base);
    return { agents: plan.agents, prompts: plan.prompts, skills: plan.skills?.items ?? [], slices: plan.slices, held: uniqueHolds([...held, ...planHolds(plan.skills?.items ?? [], plan.prompts, plan.agents, plan.slices)]), unavailable: null };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const unavailable = typeof code === 'string' && /^[A-Z_]{1,100}$/.test(code) ? code : 'IO_ERROR';
    try {
      const only = await planProjectApply({ ...base, agentsOnly: true });
      return { ...empty, agents: only.agents, slices: only.slices, held: uniqueHolds([...held, ...planHolds([], [], only.agents, only.slices)]), unavailable };
    } catch { return { ...empty, held, unavailable }; }
  }
}
