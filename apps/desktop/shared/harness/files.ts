/**
 * The list of files an install writes, for the review step of the install sheet. Nothing is written in this preview: the list only says what the full app would write.
 * The list for "Weekly report crew" in "bowerloom" with Claude Code and Codex is the one in the design (S7.3): 10 files, 7 new, 2 updates and 1 conflict.
 * Any other harness, project or interface gets a list built by one rule (see `buildInstallPlan`).
 * A folder holds one harness, in one file: `.bowerloom/harness.json`. The list names that file first.
 */
import type { ConflictChoice, FileState, HarnessState, InstallPlan, InterfaceId, PlannedFile } from './types.js';
import { slugOf } from './sample.js';
import { harnessById, installOf, partsOf } from './status.js';

/** The one file a folder's harness is kept in. */
export const HARNESS_FILE = '.bowerloom/harness.json';

const AGENT_FILE: Readonly<Record<InterfaceId, (slug: string) => string>> = {
  'claude-code': s => `.claude/agents/${s}.md`, codex: s => `.codex/agents/${s}.toml`, opencode: s => `.opencode/agents/${s}.md`,
};
const SKILL_FILE: Readonly<Record<InterfaceId, (slug: string) => string>> = {
  'claude-code': s => `.claude/skills/${s}/SKILL.md`, codex: s => `.agents/skills/${s}/SKILL.md`, opencode: s => `.opencode/skills/${s}/SKILL.md`,
};
export const agentFileOf = (interfaceId: InterfaceId, slug: string): string => AGENT_FILE[interfaceId](slug);
export const skillFileOf = (interfaceId: InterfaceId, slug: string): string => SKILL_FILE[interfaceId](slug);

type Entry = readonly ['agent' | 'skill', string, FileState];

/** The design's own list for Weekly report crew in bowerloom. It is used while that install still has something to do. */
const DESIGN_PLAN: { readonly project: string; readonly harness: string; readonly manifest: FileState; readonly files: Readonly<Partial<Record<InterfaceId, readonly Entry[]>>> } = {
  project: 'project-bowerloom', harness: 'harness-weekly-report-crew', manifest: 'new',
  files: {
    'claude-code': [['agent', 'planner', 'new'], ['agent', 'researcher', 'new'], ['agent', 'writer', 'update'], ['skill', 'draft-outline', 'new'], ['skill', 'check-facts', 'update']],
    codex: [['agent', 'planner', 'new'], ['agent', 'researcher', 'new'], ['agent', 'writer', 'conflict'], ['skill', 'draft-outline', 'new']],
  },
};

function file(interfaceId: InterfaceId, [kind, slug, state]: Entry): PlannedFile {
  return { path: kind === 'agent' ? agentFileOf(interfaceId, slug) : skillFileOf(interfaceId, slug), state };
}

/**
 * The files an install of `harnessId` into `projectId` writes for `interfaceIds`.
 * The rule: the harness file is new when the project holds nothing of the harness yet, else an update. For each interface, every agent of the harness gets a file, and so do the first two skills.
 * A file is new when the interface is not installed there, an update when it is out of date (or installed already), and the first agent's file is a conflict when the interface has a conflict.
 */
export function buildInstallPlan(state: HarnessState, projectId: string, harnessId: string, interfaceIds: readonly InterfaceId[]): InstallPlan {
  const harness = harnessById(state, harnessId);
  if (harness === undefined) return emptyPlan();
  const install = installOf(state, projectId, harnessId);
  const pending = install !== undefined && Object.values(install.states).some(s => s !== 'installed');
  const design = DESIGN_PLAN.project === projectId && DESIGN_PLAN.harness === harnessId && pending;
  const held = install !== undefined && Object.values(install.states).some(s => s !== 'not-installed');
  const manifest: PlannedFile = { path: HARNESS_FILE, state: design ? DESIGN_PLAN.manifest : held ? 'update' : 'new' };
  const parts = partsOf(state, harness);
  const agents = parts.filter(p => p.kind === 'agent'), skills = parts.filter(p => p.kind === 'skill').slice(0, 2);
  const groups = interfaceIds.map(interfaceId => {
    const designed = design ? DESIGN_PLAN.files[interfaceId] : undefined;
    if (designed !== undefined) return { interfaceId, files: designed.map(entry => file(interfaceId, entry)) };
    const current = install?.states[interfaceId] ?? 'not-installed';
    const rest: FileState = current === 'not-installed' ? 'new' : 'update';
    const entries: Entry[] = [
      ...agents.map((a, i): Entry => ['agent', slugOf(a.name), current === 'conflict' && i === 0 ? 'conflict' : rest]),
      ...skills.map((s): Entry => ['skill', slugOf(s.name), rest]),
    ];
    return { interfaceId, files: entries.map(entry => file(interfaceId, entry)) };
  });
  return planOf(manifest, groups);
}

function emptyPlan(): InstallPlan { return { manifest: { path: '', state: 'same' }, groups: [], counts: { new: 0, update: 0, conflict: 0, total: 0 }, conflicts: [] }; }

/** Adds up a plan: the counts of each state and the files that conflict. */
export function planOf(manifest: PlannedFile, groups: InstallPlan['groups']): InstallPlan {
  const all = [manifest, ...groups.flatMap(g => g.files)];
  const count = (state: FileState): number => all.filter(f => f.state === state).length;
  return { manifest, groups, counts: { new: count('new'), update: count('update'), conflict: count('conflict'), total: all.length }, conflicts: all.filter(f => f.state === 'conflict') };
}

/** Every conflict starts as "Keep mine". */
export function defaultChoices(plan: InstallPlan): Record<string, ConflictChoice> {
  const out: Record<string, ConflictChoice> = {};
  for (const f of plan.conflicts) out[f.path] = 'keep-mine';
  return out;
}

/** "7 new files, 2 updates and 1 conflict". A kind with none is left out. */
export function planSummary(plan: InstallPlan): string {
  const parts: string[] = [];
  const { new: n, update: u, conflict: c } = plan.counts;
  if (n > 0) parts.push(`${n} new ${n === 1 ? 'file' : 'files'}`);
  if (u > 0) parts.push(`${u} ${u === 1 ? 'update' : 'updates'}`);
  if (c > 0) parts.push(`${c} ${c === 1 ? 'conflict' : 'conflicts'}`);
  if (parts.length === 0) return 'No files change';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

/** The label of the install button: "Install 10 files". */
export const installButtonWords = (plan: InstallPlan): string => `Install ${plan.counts.total} ${plan.counts.total === 1 ? 'file' : 'files'}`;

/** The name a "Keep both" copy gets: `writer.toml` becomes `writer.harness.toml`. */
export function keepBothName(path: string): string {
  const slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.');
  return dot > slash ? `${path.slice(slash + 1, dot)}.harness${path.slice(dot)}` : `${path.slice(slash + 1)}.harness`;
}
