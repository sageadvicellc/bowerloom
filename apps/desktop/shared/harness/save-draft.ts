/**
 * The draft of the save sheet (0.8.0-beta.1, option C): one folder's own harness, as main read it, and the person's changes kept apart from it until Save
 * (spec 6.6). Plain data only: no React, no clock, no call. The draft becomes the closed edits main takes (shared/engine/types.ts, `SaveEdit`): ids only.
 *
 * The builder's graph draws a parts world (shared/harness/types.ts). Option C has no scope, so one folder's harness maps onto that world as it is: each agent
 * and each skill is a part, each notes source is a card of its own, and the skills and notes an agent uses are its links. A link drawn on the graph maps back
 * to a set-agent edit of that agent.
 *
 * Notes (spec 6.9) and the ready-made Notes keeper (first five minutes, section 4 steps 4 and 5):
 *  - The keeper comes from the kit as one `add-from-kit` edit. The window never holds the kit's files: it asks main to plan the harness with the kit added and
 *    keeps that answer (`kit.view`), so the draft can draw the kit's agent and skills. The keeper then starts with no skill linked, so the person links the
 *    first one, "add-source", and one button links the rest.
 *  - A notes card on an agent's Notes shelf is `set-source` (when the harness does not hold the source yet) and `set-agent` with `notes`.
 * Main applies the edits in order: the kit, then each new source, then each agent, then each removal, then the interfaces.
 */
import { ENGINE_IDS } from '../engine/engines.js';
import type { DefinitionView, EngineId, KitId, NotesView, SaveEdit, SourceView } from '../engine/types.js';
import type { Harness, HarnessState, Part } from './types.js';

/** The ready-made kit of the Notes keeper, its one agent, and the skill the storyboard links first. The kit ships as kits/wiki-keeper. */
export const KEEPER_KIT: KitId = 'wiki-keeper';
export const KEEPER_AGENT = 'notes-keeper';
export const KEEPER_FIRST_SKILL = 'add-source';

/**
 * A skill the draft copies from the harness of another folder (`add-skill`): its id, the id main gave that folder, the folder's label, and the name and
 * description the editor shows. Main reads every byte of it there again when it plans.
 */
export interface SkillCopy { readonly id: string; readonly from: string; readonly fromLabel: string; readonly name: string; readonly description: string }

/**
 * The person's changes: the skills and the notes of each agent they changed, the skills they remove, the interfaces (or null when unchanged), the kit they
 * add with the harness as main planned it with the kit, the notes sources they add, the saved sources they stop using, and the skills they copy from
 * another folder.
 */
export interface SaveDraft {
  readonly agents: Readonly<Record<string, readonly string[]>>;
  readonly notes: Readonly<Record<string, readonly string[]>>;
  readonly removed: readonly string[];
  readonly engines: readonly EngineId[] | null;
  readonly kit: { readonly id: KitId; readonly view: DefinitionView } | null;
  readonly sources: readonly SourceView[];
  readonly stopped: readonly string[];
  readonly copies: readonly SkillCopy[];
}
export const EMPTY_DRAFT: SaveDraft = Object.freeze({
  agents: Object.freeze({}), notes: Object.freeze({}), removed: Object.freeze([]) as readonly string[], engines: null, kit: null, sources: Object.freeze([]) as readonly SourceView[],
  stopped: Object.freeze([]) as readonly string[], copies: Object.freeze([]) as readonly SkillCopy[],
});
/** The most skills one draft copies from other folders: main takes at most this many `add-skill` edits in one save. */
export const COPY_LIMIT = 16;

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** The harness the draft starts from: as main read it, or with the kit added when the draft adds one, with each skill the draft copies added after. */
function startOf(base: DefinitionView, draft: SaveDraft): DefinitionView {
  const start = draft.kit?.view ?? base;
  if (draft.copies.length === 0) return start;
  return { ...start, skills: [...start.skills, ...draft.copies.map(c => ({ id: c.id, name: c.name, description: c.description }))] };
}
const has = (def: DefinitionView, skill: string): boolean => def.skills.some(s => s.id === skill);
/** The same, for the editor: the skills it lists, removed ones and copies included, are this harness's. */
export const draftStart = startOf;

/** The skills an agent uses in the draft, in the agent's own order with each new link at the end, without the removed ones. */
function skillsOf(base: DefinitionView, draft: SaveDraft, agent: string): string[] {
  const now = draft.agents[agent] ?? startOf(base, draft).agents.find(a => a.id === agent)?.skills ?? [];
  return now.filter(s => !draft.removed.includes(s));
}
/** The start skills of an agent, in their own order, without the removed ones: what the removal alone leaves. */
const startSkills = (base: DefinitionView, draft: SaveDraft, agent: string): string[] => (startOf(base, draft).agents.find(a => a.id === agent)?.skills ?? []).filter(s => !draft.removed.includes(s));
/** The notes an agent reads in the draft, without the sources it stops using. */
const notesOf = (base: DefinitionView, draft: SaveDraft, agent: string): readonly string[] =>
  (draft.notes[agent] ?? startOf(base, draft).agents.find(a => a.id === agent)?.notes ?? []).filter(n => !draft.stopped.includes(n));
/** The start notes of an agent, without the stopped sources: what the stop alone leaves, which is the remove-source edit's own work. */
const startNotes = (base: DefinitionView, draft: SaveDraft, agent: string): readonly string[] =>
  (startOf(base, draft).agents.find(a => a.id === agent)?.notes ?? []).filter(n => !draft.stopped.includes(n));
/** The sources of the draft: the harness's own that it keeps using, then each one the draft adds. */
const sourcesOf = (base: DefinitionView, draft: SaveDraft): SourceView[] => [...startOf(base, draft).sources.filter(s => !draft.stopped.includes(s.name)), ...draft.sources];

/**
 * Links a skill to an agent (`on`) or unlinks it. A new link goes to the end of the agent's own list, and every other skill keeps its place, so a link and its
 * unlink are no change. An unknown agent, an unknown or removed skill, changes nothing. A list back at its start drops out of the draft.
 */
export function linkSkill(base: DefinitionView, draft: SaveDraft, agent: string, skill: string, on: boolean): SaveDraft {
  const start = startOf(base, draft), known = start.agents.find(a => a.id === agent);
  if (known === undefined || !has(start, skill) || (on && draft.removed.includes(skill))) return draft;
  const now = draft.agents[agent] ?? known.skills;
  if (now.includes(skill) === on) return draft;
  // A skill the agent named that the harness does not list stays where it was: main's edit keeps it, and the package refuses it with words.
  const kept = on ? [...now, skill] : now.filter(s => s !== skill);
  const agents = { ...draft.agents };
  if (same(kept, known.skills)) delete agents[agent]; else agents[agent] = kept;
  return { ...draft, agents };
}

/** Links each of `skills` that the agent does not use yet, in the order given: the one button that adds the rest of the kit's skills. */
export function linkRest(base: DefinitionView, draft: SaveDraft, agent: string, skills: readonly string[]): SaveDraft {
  return skills.reduce((d, skill) => linkSkill(base, d, agent, skill, true), draft);
}

/** Marks a skill to be removed when the person saves (`on`), or keeps it again. A skill the draft copies is taken out of the draft instead. */
export function removeSkill(base: DefinitionView, draft: SaveDraft, skill: string, on: boolean): SaveDraft {
  const copy = draft.copies.find(c => c.id === skill);
  if (copy !== undefined) return on ? copySkill(base, draft, copy, false) : draft;
  const start = startOf(base, draft);
  if (!has(start, skill) || draft.removed.includes(skill) === on) return draft;
  const removed = on ? start.skills.map(s => s.id).filter(id => id === skill || draft.removed.includes(id)) : draft.removed.filter(s => s !== skill);
  return { ...draft, removed };
}

/** Sets the interfaces the harness lists, in engine order. The draft keeps at least one. Back at the base, it drops out of the draft. */
export function setDraftEngines(base: DefinitionView, draft: SaveDraft, engines: readonly EngineId[]): SaveDraft {
  const list = ENGINE_IDS.filter(e => engines.includes(e));
  if (list.length === 0) return draft;
  return { ...draft, engines: same(list, base.engines) ? null : list };
}

// ---- the ready-made Notes keeper

/** True when `view` is `base` with items added and nothing of `base` taken away, as a kit adds them. */
const holdsAll = (base: DefinitionView, view: DefinitionView): boolean =>
  base.skills.every(s => has(view, s.id)) && base.agents.every(a => view.agents.some(b => b.id === a.id)) && base.sources.every(s => view.sources.some(x => x.name === s.name));

/**
 * Adds the kit as a draft. `view` is the harness as main planned it with the kit added (a plan of `add-from-kit` alone): the draft keeps it to draw the kit's
 * agent and skills. Each agent the kit brings starts with no skill linked. A harness that holds the kit already, a draft that adds it already, or a view that
 * is not this harness plus the kit, changes nothing.
 */
export function addKit(base: DefinitionView, draft: SaveDraft, view: DefinitionView, kit: KitId = KEEPER_KIT): SaveDraft {
  if (draft.kit !== null || base.kits.some(k => k.id === kit) || !view.kits.some(k => k.id === kit) || !holdsAll(base, view)) return draft;
  const added = view.agents.filter(a => !base.agents.some(b => b.id === a.id));
  const agents = { ...draft.agents };
  for (const a of added) agents[a.id] = [];
  return { ...draft, kit: { id: kit, view }, agents };
}

/** Takes the kit back out of the draft, with every change to its agent and its skills. */
export function removeKit(base: DefinitionView, draft: SaveDraft): SaveDraft {
  if (draft.kit === null) return draft;
  const kitAgents = draft.kit.view.agents.filter(a => !base.agents.some(b => b.id === a.id)).map(a => a.id);
  const kitSkills = draft.kit.view.skills.filter(s => !has(base, s.id)).map(s => s.id);
  const agents: Record<string, readonly string[]> = {};
  for (const [id, list] of Object.entries(draft.agents)) {
    if (kitAgents.includes(id)) continue;
    const kept = list.filter(s => !kitSkills.includes(s));
    if (!same(kept, base.agents.find(a => a.id === id)?.skills ?? [])) agents[id] = kept;
  }
  const notes = Object.fromEntries(Object.entries(draft.notes).filter(([id]) => !kitAgents.includes(id)));
  const next: SaveDraft = { ...draft, kit: null, agents, notes, removed: draft.removed.filter(s => !kitSkills.includes(s)) };
  return { ...next, sources: next.sources.filter(s => Object.values(next.notes).some(list => list.includes(s.name))) };
}

/** The draft with the kit added from a plan's view, when that view brings the Notes keeper into the draft; else null, and the draft stays as it was. */
export function keeperAdded(base: DefinitionView, draft: SaveDraft, view: DefinitionView): SaveDraft | null {
  const next = addKit(base, draft, view);
  return next.kit !== null && next !== draft && keeperOf(draftView(base, next)) !== null ? next : null;
}

/** The Notes keeper in a harness as the draft draws it, or null. */
export const keeperOf = (view: DefinitionView): DefinitionView['agents'][number] | null => view.agents.find(a => a.id === KEEPER_AGENT) ?? null;

/**
 * The skills the keeper's Skills shelf offers. When the draft adds the kit, the kit's agent's own list, in its order. For a saved keeper, the skills it uses,
 * then the rest of the skills its kit record (`sources.json`) names, so a keeper saved with fewer skills is offered the others again. A skill removed in the
 * draft, or one the harness no longer holds, is not offered.
 */
export function keeperSkills(base: DefinitionView, draft: SaveDraft): readonly string[] {
  const start = startOf(base, draft), keeper = keeperOf(start);
  if (keeper === null) return [];
  const record = draft.kit === null ? start.kits.find(k => k.id === KEEPER_KIT)?.skills ?? [] : [];
  return [...new Set([...keeper.skills, ...record])].filter(s => has(start, s) && !draft.removed.includes(s));
}

// ---- notes

/**
 * The source a chosen notes folder is attached as: the harness's own source for that folder, or a new one named by the folder's suggested name, with a number
 * added when that name is taken by another folder.
 */
export function sourceFor(view: DefinitionView, notes: Pick<NotesView, 'id' | 'label' | 'suggestedName'>): SourceView {
  const held = view.sources.find(s => s.notesId === notes.id);
  if (held !== undefined) return held;
  let name = notes.suggestedName;
  for (let n = 2; view.sources.some(s => s.name === name); n += 1) name = `${notes.suggestedName}-${n}`;
  return { name, kind: 'wiki-folder', label: notes.label, notesId: notes.id };
}

/**
 * Puts a notes card on an agent's Notes shelf (`on`) or takes it off. A source the draft does not hold yet is added with it; one the draft added goes again when
 * no agent reads it. An unknown agent changes nothing. A list back at its start drops out of the draft.
 */
export function attachNotes(base: DefinitionView, draft: SaveDraft, agent: string, source: SourceView, on: boolean): SaveDraft {
  const start = startOf(base, draft);
  if (!start.agents.some(a => a.id === agent) || draft.stopped.includes(source.name)) return draft;
  const held = sourcesOf(base, draft).find(s => s.notesId === source.notesId);
  const name = held?.name ?? source.name;
  const now = notesOf(base, draft, agent);
  if (now.includes(name) === on) return draft;
  const kept = on ? [...now, name] : now.filter(n => n !== name);
  const notes = { ...draft.notes };
  if (same(kept, startNotes(base, draft, agent))) delete notes[agent]; else notes[agent] = kept;
  let sources = held === undefined ? [...draft.sources, source] : draft.sources;
  // A source the draft added stays only while an agent reads it.
  const reads = (n: string): boolean => start.agents.some(a => (notes[a.id] ?? a.notes).includes(n));
  sources = sources.filter(s => reads(s.name));
  return { ...draft, notes, sources };
}

/**
 * Stops using a saved notes source when the person saves (`on`), or keeps using it again: one `remove-source` edit, which also takes the source off every
 * agent's Notes shelf. A tick on it made in this draft goes with it. A source the harness does not hold (one the draft only adds goes when no agent reads it)
 * changes nothing. Nothing in the notes folder changes.
 */
export function stopSource(base: DefinitionView, draft: SaveDraft, name: string, on: boolean): SaveDraft {
  if (!base.sources.some(s => s.name === name) || draft.stopped.includes(name) === on) return draft;
  if (!on) return { ...draft, stopped: draft.stopped.filter(n => n !== name) };
  const next: SaveDraft = { ...draft, stopped: [...draft.stopped, name] };
  const notes: Record<string, readonly string[]> = {};
  for (const [id, list] of Object.entries(draft.notes)) {
    const kept = list.filter(n => n !== name);
    if (!same(kept, startNotes(base, next, id))) notes[id] = kept;
  }
  return { ...next, notes };
}
/** Each saved source the draft stops using, with the names of the agents that read it now and lose it. */
export function stoppedSources(base: DefinitionView, draft: SaveDraft): { readonly source: SourceView; readonly agents: readonly string[] }[] {
  return base.sources.filter(s => draft.stopped.includes(s.name)).map(source => ({ source, agents: base.agents.filter(a => a.notes.includes(source.name)).map(a => a.name) }));
}

// ---- skills copied from another folder

/** True when the draft may copy a skill of this id: the harness (with the kit and the copies of the draft) does not hold it, and the draft copies fewer than 16. */
export const canCopy = (base: DefinitionView, draft: SaveDraft, id: string): boolean => !has(startOf(base, draft), id) && draft.copies.length < COPY_LIMIT;
/**
 * Copies a skill from another folder's harness (`on`), or takes the copy out again with every link to it. An id the harness holds, or one copied already,
 * is not copied over it. The window sends the id and the folder's id only: main reads the skill there again.
 */
export function copySkill(base: DefinitionView, draft: SaveDraft, copy: SkillCopy, on: boolean): SaveDraft {
  if (on) return canCopy(base, draft, copy.id) ? { ...draft, copies: [...draft.copies, copy] } : draft;
  if (!draft.copies.some(c => c.id === copy.id)) return draft;
  const next: SaveDraft = { ...draft, copies: draft.copies.filter(c => c.id !== copy.id) };
  const agents: Record<string, readonly string[]> = {};
  for (const [id, list] of Object.entries(draft.agents)) {
    const kept = list.filter(s => s !== copy.id);
    if (!same(kept, startOf(base, next).agents.find(a => a.id === id)?.skills ?? [])) agents[id] = kept;
  }
  return { ...next, agents };
}

// ---- the edits

/**
 * The closed edits of the draft, in the order main applies them: the kit, each new source, each copied skill, each changed agent, each removal of a skill,
 * each source it stops using, then the interfaces. A copy comes before the agents that link it, and a stop after the agents, so no edit names a skill that is
 * not there yet or a source that is gone.
 */
export function draftEdits(base: DefinitionView, draft: SaveDraft): SaveEdit[] {
  const out: SaveEdit[] = [];
  if (draft.kit !== null) out.push({ kind: 'add-from-kit', kit: draft.kit.id });
  for (const s of draft.sources) out.push({ kind: 'set-source', name: s.name, notesId: s.notesId });
  for (const c of draft.copies) out.push({ kind: 'add-skill', id: c.id, from: c.from });
  for (const a of startOf(base, draft).agents) {
    const skills = skillsOf(base, draft, a.id), notes = notesOf(base, draft, a.id);
    const skillsChanged = !same(skills, startSkills(base, draft, a.id)), notesChanged = !same(notes, startNotes(base, draft, a.id));
    // An agent the kit brings starts with no skill: its set-agent is there whenever its skills are not the kit's.
    if (skillsChanged || notesChanged) out.push({ kind: 'set-agent', id: a.id, ...(skillsChanged ? { skills } : {}), ...(notesChanged ? { notes: [...notes] } : {}) });
  }
  for (const id of draft.removed) out.push({ kind: 'remove-skill', id });
  for (const name of draft.stopped) out.push({ kind: 'remove-source', name });
  if (draft.engines !== null && !same(draft.engines, base.engines)) out.push({ kind: 'set-engines', engines: [...draft.engines] });
  return out;
}
/** How many edits the draft holds. */
export const draftCount = (base: DefinitionView, draft: SaveDraft): number => draftEdits(base, draft).length;

/** The harness as the draft would make it, for the editor to draw. */
export function draftView(base: DefinitionView, draft: SaveDraft): DefinitionView {
  if (draftCount(base, draft) === 0) return base;
  const start = startOf(base, draft);
  return {
    ...start,
    engines: draft.engines ?? base.engines,
    skills: start.skills.filter(s => !draft.removed.includes(s.id)),
    agents: start.agents.map(a => ({ ...a, skills: skillsOf(base, draft, a.id), notes: [...notesOf(base, draft, a.id)] })),
    sources: sourcesOf(base, draft),
  };
}

// ---- the parts world of the graph

const AGENT = 'agent:', SKILL = 'skill:', NOTES = 'notes:';
/** The agent id of a part id of the world, or null. */
export const agentPart = (partId: string): string | null => (partId.startsWith(AGENT) ? partId.slice(AGENT.length) : null);
/** The skill id of a part id of the world, or null. */
export const partSkill = (partId: string): string | null => (partId.startsWith(SKILL) ? partId.slice(SKILL.length) : null);
/** The source name of a notes card of the world, or null. */
export const partNotes = (partId: string): string | null => (partId.startsWith(NOTES) ? partId.slice(NOTES.length) : null);
/** The part id of a notes card. */
export const notesPartId = (name: string): string => `${NOTES}${name}`;

/**
 * One folder's harness as the parts world the builder's graph draws. No file text: the window never gets it. Each source is a notes card, and so is each
 * folder in `pending` (chosen, not attached yet), so the notes sit on the map beside the agents. A card's words are the source's name: a path is never a label.
 */
export function definitionWorld(def: DefinitionView, pending: readonly SourceView[] = []): { state: HarnessState; harness: Harness } {
  const part = (kind: 'agent' | 'skill', id: string, description: string): Part => ({
    id: `${kind === 'agent' ? AGENT : SKILL}${id}`, kind, name: id, summary: description, description, path: kind === 'agent' ? `agents/${id}.md` : `skills/${id}/SKILL.md`,
    source: 'This folder', origin: 'folder', fileText: '', cannotUse: [], inLibrary: false,
  });
  const notesPart = (s: SourceView): Part => ({
    id: notesPartId(s.name), kind: 'context', name: s.name, summary: 'Notes', description: 'Notes', path: 'knowledge.json', source: 'This folder', origin: 'folder', fileText: '', cannotUse: [], inLibrary: false,
  });
  const cards = [...def.sources, ...pending.filter(p => !def.sources.some(s => s.notesId === p.notesId || s.name === p.name))];
  const parts = [...def.agents.map(a => part('agent', a.id, a.description)), ...def.skills.map(s => part('skill', s.id, s.description)), ...cards.map(notesPart)];
  const harness: Harness = {
    id: `folder:${def.id}`, name: def.id, summary: def.description, partIds: parts.map(p => p.id),
    links: def.agents.flatMap(a => [
      ...a.skills.filter(s => has(def, s)).map(s => ({ from: `${AGENT}${a.id}`, to: `${SKILL}${s}` })),
      ...a.notes.filter(n => def.sources.some(s => s.name === n)).map(n => ({ from: `${AGENT}${a.id}`, to: notesPartId(n) })),
    ]),
    positions: {}, missing: [], newPartIds: [],
  };
  const state: HarnessState = { parts, harnesses: [harness], projects: [], installs: [], interfaces: [], runs: [], history: [], sources: [], chosenSourceIds: [], nextId: 1 };
  return { state, harness };
}
