/**
 * The Builder's gestures on one folder's harness, as calls of the save draft (shared/harness/save-draft.ts). Plain data only: no React, no clock, no call.
 * `save-draft.ts` stays the only reducer: this file only maps a gesture on the graph's world to one of its functions, and says in words why a gesture is
 * refused.
 *
 * A gesture names parts by the ids `definitionWorld` gives them: `agent:<id>`, `skill:<id>` and `notes:<name>`. The mapping:
 *  - link and unlink an agent and a skill: `linkSkill`, which becomes `set-agent {skills}`. Either order, so a skill dropped on an agent links them.
 *  - link and unlink an agent and a notes card, or add notes from the Notes shelf: `attachNotes`, which becomes `set-source` and `set-agent {notes}`.
 *  - remove and keep a skill: `removeSkill` (`remove-skill`; a copied skill leaves the draft). Saved notes: `stopSource` (`remove-source`). Notes the draft
 *    added: off every agent, so their source goes too. The Notes keeper the draft added: `removeKit`.
 *  - copy a skill from another folder: `copySkill` (`add-skill`). Add the Notes keeper: `keeperAdded` (`add-from-kit`). Interfaces: `setDraftEngines`.
 *
 * Refused in beta.1, in words: New harness and a harness from a scan (both open the sheet that makes a harness from a folder), a second harness in a folder,
 * Rename (the folder's name is the harness's name), a move between folders (copy the skill instead), and adding or removing an agent or a tool.
 */
import type { DefinitionView, EngineId, SourceView } from '../engine/types.js';
import {
  COPY_LIMIT, agentPart, attachNotes, copySkill, draftView, keeperAdded, keeperOf, linkSkill, partNotes, partSkill, removeKit, removeSkill, setDraftEngines, stopSource,
} from './save-draft.js';
import type { SaveDraft, SkillCopy } from './save-draft.js';

/** A gesture of the Builder. Parts are named by their ids in the graph's world. */
export type BuilderAction =
  /** Links an agent to a skill or to a notes card. `a` and `b` in either order. */
  | { readonly kind: 'link'; readonly a: string; readonly b: string }
  | { readonly kind: 'unlink'; readonly a: string; readonly b: string }
  /** Marks a skill or notes to go at Save, or takes out a Notes keeper the draft added. */
  | { readonly kind: 'remove'; readonly part: string }
  /** Keeps a skill or notes that the draft marked to go. */
  | { readonly kind: 'keep'; readonly part: string }
  | { readonly kind: 'add-notes'; readonly agent: string; readonly source: SourceView }
  | { readonly kind: 'copy-skill'; readonly copy: SkillCopy }
  /** `view`: the harness as main planned it with the kit added. */
  | { readonly kind: 'add-keeper'; readonly view: DefinitionView }
  | { readonly kind: 'set-engines'; readonly engines: readonly EngineId[] }
  // Refused in beta.1.
  | { readonly kind: 'new-harness' }
  | { readonly kind: 'harness-from-scan' }
  | { readonly kind: 'second-harness' }
  | { readonly kind: 'rename'; readonly name: string }
  | { readonly kind: 'move'; readonly part: string; readonly toFolder: string }
  | { readonly kind: 'add-part'; readonly part: 'agent' | 'tool' };

/** The gestures beta.1 refuses whatever the draft holds. Removing an agent or a tool is refused too, by the part it names. */
export const REFUSED_KINDS: ReadonlySet<BuilderAction['kind']> = new Set(['new-harness', 'harness-from-scan', 'second-harness', 'rename', 'move', 'add-part']);

/** The words of each refusal. Each is one short line for the note at the foot of the window. */
export const BUILDER_REFUSALS = Object.freeze({
  // Not in beta.1.
  'new-harness': 'Each folder holds one harness. Make a new one from a folder.',
  'harness-from-scan': 'Each folder holds one harness. Make a new one from a folder.',
  'second-harness': 'Each folder holds one harness. Open another folder for another one.',
  rename: 'The harness takes its folder\'s name. Rename the folder instead.',
  'move-between-folders': 'A part stays in its folder. Copy the skill there instead.',
  'add-agent': 'You cannot add an agent here yet.',
  'remove-agent': 'You cannot remove an agent here yet.',
  'add-tool': 'You cannot add a tool here yet.',
  'remove-tool': 'You cannot remove a tool here yet.',
  // A gesture that does not fit the harness.
  'agent-to-agent': 'An agent cannot link to another agent.',
  'no-agent': 'A link joins an agent to a skill or to notes.',
  'unknown-part': 'That part is not in this folder\'s harness.',
  'linked-already': 'That link is there already.',
  'not-linked': 'Those two are not linked.',
  'removed-skill': 'You marked that skill to go. Keep it first.',
  'stopped-notes': 'You stopped using these notes. Keep them first.',
  'keeper-here': 'The Notes keeper is here already.',
  'keeper-not-added': 'The Notes keeper was not added. Nothing changed.',
  'skill-here': 'This harness has a skill with that name already.',
  'copy-limit': `One save copies at most ${COPY_LIMIT} skills.`,
  'same-folder': 'That skill is in this folder already.',
  'last-interface': 'Keep at least one engine.',
  'no-change': 'Nothing changed.',
} as const);
export type BuilderRefusal = keyof typeof BUILDER_REFUSALS;

/** The sheet a refusal opens: "From a folder", which makes a harness from a folder (`ui.openAdopt`), or none. */
export type BuilderOpens = 'from-folder' | null;
/** An allowed gesture gives the next draft. A refused one gives its code, its words, and the sheet it opens, and no draft. */
export type BuilderResult =
  | { readonly ok: true; readonly draft: SaveDraft }
  | { readonly ok: false; readonly refusal: BuilderRefusal; readonly words: string; readonly opens: BuilderOpens };

const OPENS_FROM_FOLDER: readonly BuilderRefusal[] = ['new-harness', 'harness-from-scan'];
const TOOL = 'tool:';

function refuse(refusal: BuilderRefusal): BuilderResult {
  return { ok: false, refusal, words: BUILDER_REFUSALS[refusal], opens: OPENS_FROM_FOLDER.includes(refusal) ? 'from-folder' : null };
}
/** The next draft, or a no-change refusal when the reducer handed the same draft back. */
const changed = (before: SaveDraft, after: SaveDraft): BuilderResult => (after === before ? refuse('no-change') : { ok: true, draft: after });

/** One end of a link: an agent, a skill, a notes card, or something the world does not hold. */
type Held = { readonly kind: 'agent' | 'skill' | 'notes'; readonly id: string };
type End = Held | { readonly kind: 'other' };
const isAgent = (end: End): end is Held => end.kind === 'agent';
function endOf(partId: string): End {
  const agent = agentPart(partId), skill = partSkill(partId), notes = partNotes(partId);
  if (agent !== null) return { kind: 'agent', id: agent };
  if (skill !== null) return { kind: 'skill', id: skill };
  if (notes !== null) return { kind: 'notes', id: notes };
  return { kind: 'other' };
}

/**
 * Runs one Builder gesture on the draft of one folder's harness. `base` is the harness as main read it; `pending` holds the notes folders the person chose
 * that the draft does not hold yet, which the graph draws as cards. `folderId` is the folder being edited (a copy from it is refused). The base and the draft are never changed.
 */
export function builderAction(base: DefinitionView, draft: SaveDraft, action: BuilderAction, pending: readonly SourceView[] = [], folderId?: string): BuilderResult {
  switch (action.kind) {
    case 'link': case 'unlink': return link(base, draft, action.a, action.b, action.kind === 'link', pending);
    case 'remove': return remove(base, draft, action.part);
    case 'keep': return keep(base, draft, action.part);
    case 'add-notes': return addNotes(base, draft, action.agent, action.source);
    case 'copy-skill': return copy(base, draft, action.copy, folderId);
    case 'add-keeper': return addKeeper(base, draft, action.view);
    case 'set-engines': return engines(base, draft, action.engines);
    case 'new-harness': return refuse('new-harness');
    case 'harness-from-scan': return refuse('harness-from-scan');
    case 'second-harness': return refuse('second-harness');
    case 'rename': return refuse('rename');
    case 'move': return refuse('move-between-folders');
    case 'add-part': return refuse(action.part === 'agent' ? 'add-agent' : 'add-tool');
  }
}

function link(base: DefinitionView, draft: SaveDraft, a: string, b: string, on: boolean, pending: readonly SourceView[]): BuilderResult {
  const ends = [endOf(a), endOf(b)];
  const agents = ends.filter(isAgent);
  if (agents.length === 2) return refuse('agent-to-agent');
  if (agents.length === 0) return ends.some(e => e.kind === 'other') ? refuse('unknown-part') : refuse('no-agent');
  const agent = agents[0]!, other = ends.find(e => e.kind !== 'agent')!;
  const view = draftView(base, draft), held = view.agents.find(x => x.id === agent.id);
  if (held === undefined || other.kind === 'other') return refuse('unknown-part');
  if (other.kind === 'skill') {
    if (draft.removed.includes(other.id)) return refuse(on ? 'removed-skill' : 'not-linked');
    if (!view.skills.some(s => s.id === other.id)) return refuse('unknown-part');
    if (held.skills.includes(other.id) === on) return refuse(on ? 'linked-already' : 'not-linked');
    return changed(draft, linkSkill(base, draft, agent.id, other.id, on));
  }
  if (draft.stopped.includes(other.id)) return on ? refuse('stopped-notes') : refuse('not-linked');
  const source = view.sources.find(s => s.name === other.id) ?? (on ? pending.find(s => s.name === other.id) : undefined);
  if (source === undefined) return refuse('unknown-part');
  if (held.notes.includes(source.name) === on) return refuse(on ? 'linked-already' : 'not-linked');
  return changed(draft, attachNotes(base, draft, agent.id, source, on));
}

function remove(base: DefinitionView, draft: SaveDraft, part: string): BuilderResult {
  if (part.startsWith(TOOL)) return refuse('remove-tool');
  const end = endOf(part), view = draftView(base, draft);
  switch (end.kind) {
    case 'agent': {
      if (!view.agents.some(a => a.id === end.id)) return refuse('unknown-part');
      // The agent of a kit this draft adds is taken out with its kit; a saved agent stays (no removing an agent in beta.1).
      const fromKit = draft.kit !== null && !base.agents.some(a => a.id === end.id);
      return fromKit ? changed(draft, removeKit(base, draft)) : refuse('remove-agent');
    }
    case 'skill': {
      if (draft.removed.includes(end.id)) return refuse('no-change');
      if (!view.skills.some(s => s.id === end.id)) return refuse('unknown-part');
      return changed(draft, removeSkill(base, draft, end.id, true));
    }
    case 'notes': {
      if (draft.stopped.includes(end.id)) return refuse('no-change');
      if (base.sources.some(s => s.name === end.id)) return changed(draft, stopSource(base, draft, end.id, true));
      const added = draft.sources.find(s => s.name === end.id);
      if (added === undefined) return refuse('unknown-part');
      // Notes the draft added: off every agent that reads them, and the source goes when none does.
      const readers = view.agents.filter(a => a.notes.includes(added.name));
      return changed(draft, readers.reduce((d, a) => attachNotes(base, d, a.id, added, false), draft));
    }
    case 'other': return refuse('unknown-part');
  }
}

function keep(base: DefinitionView, draft: SaveDraft, part: string): BuilderResult {
  const end = endOf(part);
  if (end.kind === 'skill' && draft.removed.includes(end.id)) return changed(draft, removeSkill(base, draft, end.id, false));
  if (end.kind === 'notes' && draft.stopped.includes(end.id)) return changed(draft, stopSource(base, draft, end.id, false));
  return refuse('no-change');
}

function addNotes(base: DefinitionView, draft: SaveDraft, agentId: string, source: SourceView): BuilderResult {
  const end = endOf(agentId);
  if (end.kind !== 'agent') return refuse(end.kind === 'other' ? 'unknown-part' : 'no-agent');
  const held = draftView(base, draft).agents.find(a => a.id === end.id);
  if (held === undefined) return refuse('unknown-part');
  if (draft.stopped.includes(source.name)) return refuse('stopped-notes');
  // A folder the harness holds already is named by the harness's own source for it.
  const name = draftView(base, draft).sources.find(s => s.notesId === source.notesId)?.name ?? source.name;
  if (held.notes.includes(name)) return refuse('linked-already');
  return changed(draft, attachNotes(base, draft, end.id, source, true));
}

function copy(base: DefinitionView, draft: SaveDraft, skill: SkillCopy, folderId: string | undefined): BuilderResult {
  // `from` is a folder id, so it is compared with the id of the folder being edited. The harness's own id is another thing.
  if (folderId !== undefined && skill.from === folderId) return refuse('same-folder');
  const view = draftView(base, draft);
  if (view.skills.some(s => s.id === skill.id) || draft.removed.includes(skill.id) || draft.copies.some(c => c.id === skill.id)) return refuse('skill-here');
  if (draft.copies.length >= COPY_LIMIT) return refuse('copy-limit');
  return changed(draft, copySkill(base, draft, skill, true));
}

function addKeeper(base: DefinitionView, draft: SaveDraft, view: DefinitionView): BuilderResult {
  if (keeperOf(draftView(base, draft)) !== null) return refuse('keeper-here');
  const next = keeperAdded(base, draft, view);
  return next === null ? refuse('keeper-not-added') : { ok: true, draft: next };
}

function engines(base: DefinitionView, draft: SaveDraft, list: readonly EngineId[]): BuilderResult {
  if (list.length === 0) return refuse('last-interface');
  const next = setDraftEngines(base, draft, list), was = draft.engines, now = next.engines;
  // The reducer hands back a new draft even when the interfaces are the ones the draft holds already.
  const same = was === now || (was !== null && now !== null && was.length === now.length && was.every((e, i) => e === now[i]));
  return same ? refuse('no-change') : { ok: true, draft: next };
}
