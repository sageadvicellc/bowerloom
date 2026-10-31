/**
 * The draft of the save sheet (0.8.0-beta.1, option C): one folder's own harness, as main read it, and the person's changes kept apart from it until Save
 * (spec 6.6). Plain data only: no React, no clock, no call. The draft becomes the closed edits main takes (shared/engine/types.ts, `SaveEdit`): ids only.
 *
 * The builder's graph draws a parts world (shared/harness/types.ts). Option C has no scope, so one folder's harness maps onto that world as it is: each agent
 * and each skill is a part, and the skills an agent uses are its links. A link drawn on the graph maps back to a set-agent edit of that agent.
 */
import { ENGINE_IDS } from '../engine/engines.js';
import type { DefinitionView, EngineId, SaveEdit } from '../engine/types.js';
import type { Harness, HarnessState, Part } from './types.js';

/** The person's changes: the skills of each agent they changed, the skills they remove, and the interfaces, or null when unchanged. */
export interface SaveDraft {
  readonly agents: Readonly<Record<string, readonly string[]>>;
  readonly removed: readonly string[];
  readonly engines: readonly EngineId[] | null;
}
export const EMPTY_DRAFT: SaveDraft = Object.freeze({ agents: Object.freeze({}), removed: Object.freeze([]) as readonly string[], engines: null });

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const has = (def: DefinitionView, skill: string): boolean => def.skills.some(s => s.id === skill);

/** The skills an agent uses in the draft, in the agent's own order with each new link at the end, without the removed ones. */
function skillsOf(base: DefinitionView, draft: SaveDraft, agent: string): string[] {
  const now = draft.agents[agent] ?? base.agents.find(a => a.id === agent)?.skills ?? [];
  return now.filter(s => !draft.removed.includes(s));
}
/** The base skills of an agent, in their own order, without the removed ones: what the removal alone leaves. */
const baseSkills = (base: DefinitionView, draft: SaveDraft, agent: string): string[] => (base.agents.find(a => a.id === agent)?.skills ?? []).filter(s => !draft.removed.includes(s));

/**
 * Links a skill to an agent (`on`) or unlinks it. A new link goes to the end of the agent's own list, and every other skill keeps its place, so a link and its
 * unlink are no change. An unknown agent, an unknown or removed skill, changes nothing. A list back at its base drops out of the draft.
 */
export function linkSkill(base: DefinitionView, draft: SaveDraft, agent: string, skill: string, on: boolean): SaveDraft {
  const known = base.agents.find(a => a.id === agent);
  if (known === undefined || !has(base, skill) || (on && draft.removed.includes(skill))) return draft;
  const now = draft.agents[agent] ?? known.skills;
  if (now.includes(skill) === on) return draft;
  // A skill the agent named that the harness does not list stays where it was: main's edit keeps it, and the package refuses it with words.
  const kept = on ? [...now, skill] : now.filter(s => s !== skill);
  const agents = { ...draft.agents };
  if (same(kept, known.skills)) delete agents[agent]; else agents[agent] = kept;
  return { ...draft, agents };
}

/** Marks a skill to be removed when the person saves (`on`), or keeps it again. */
export function removeSkill(base: DefinitionView, draft: SaveDraft, skill: string, on: boolean): SaveDraft {
  if (!has(base, skill) || draft.removed.includes(skill) === on) return draft;
  const removed = on ? base.skills.map(s => s.id).filter(id => id === skill || draft.removed.includes(id)) : draft.removed.filter(s => s !== skill);
  return { ...draft, removed };
}

/** Sets the interfaces the harness lists, in engine order. The draft keeps at least one. Back at the base, it drops out of the draft. */
export function setDraftEngines(base: DefinitionView, draft: SaveDraft, engines: readonly EngineId[]): SaveDraft {
  const list = ENGINE_IDS.filter(e => engines.includes(e));
  if (list.length === 0) return draft;
  return { ...draft, engines: same(list, base.engines) ? null : list };
}

/** The closed edits of the draft, in the order main applies them: each changed agent, then each removal, then the interfaces. */
export function draftEdits(base: DefinitionView, draft: SaveDraft): SaveEdit[] {
  const out: SaveEdit[] = [];
  for (const a of base.agents) {
    const now = skillsOf(base, draft, a.id);
    if (!same(now, baseSkills(base, draft, a.id))) out.push({ kind: 'set-agent', id: a.id, skills: now });
  }
  for (const id of draft.removed) out.push({ kind: 'remove-skill', id });
  if (draft.engines !== null && !same(draft.engines, base.engines)) out.push({ kind: 'set-engines', engines: [...draft.engines] });
  return out;
}
/** How many edits the draft holds. */
export const draftCount = (base: DefinitionView, draft: SaveDraft): number => draftEdits(base, draft).length;

/** The harness as the draft would make it, for the editor to draw. */
export function draftView(base: DefinitionView, draft: SaveDraft): DefinitionView {
  if (draftCount(base, draft) === 0) return base;
  return {
    ...base,
    engines: draft.engines ?? base.engines,
    skills: base.skills.filter(s => !draft.removed.includes(s.id)),
    agents: base.agents.map(a => ({ ...a, skills: skillsOf(base, draft, a.id) })),
  };
}

const AGENT = 'agent:', SKILL = 'skill:';
/** The agent id of a part id of the world, or null. */
export const agentPart = (partId: string): string | null => (partId.startsWith(AGENT) ? partId.slice(AGENT.length) : null);
/** The skill id of a part id of the world, or null. */
export const partSkill = (partId: string): string | null => (partId.startsWith(SKILL) ? partId.slice(SKILL.length) : null);

/** One folder's harness as the parts world the builder's graph draws. No file text: the window never gets it. */
export function definitionWorld(def: DefinitionView): { state: HarnessState; harness: Harness } {
  const part = (kind: 'agent' | 'skill', id: string, description: string): Part => ({
    id: `${kind === 'agent' ? AGENT : SKILL}${id}`, kind, name: id, summary: description, description, path: kind === 'agent' ? `agents/${id}.md` : `skills/${id}/SKILL.md`,
    source: 'This folder', origin: 'folder', fileText: '', cannotUse: [], inLibrary: false,
  });
  const parts = [...def.agents.map(a => part('agent', a.id, a.description)), ...def.skills.map(s => part('skill', s.id, s.description))];
  const harness: Harness = {
    id: `folder:${def.id}`, name: def.id, summary: def.description, partIds: parts.map(p => p.id),
    links: def.agents.flatMap(a => a.skills.filter(s => has(def, s)).map(s => ({ from: `${AGENT}${a.id}`, to: `${SKILL}${s}` }))),
    positions: {}, missing: [], newPartIds: [],
  };
  const state: HarnessState = { parts, harnesses: [harness], projects: [], installs: [], interfaces: [], runs: [], history: [], sources: [], chosenSourceIds: [], nextId: 1 };
  return { state, harness };
}
