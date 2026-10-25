/**
 * How "Choose notes" reaches the store, and how the Save bar counts it. One press of "Use these notes" is one store action (`chooseNotes`, see
 * shared/proto/store-notes.ts) and one change on the Save bar, even when it makes a new saved choice of pages, puts it in the list of items and points the
 * agent at it: those three are one thing to a person, "this agent reads these notes". `absorbedSlices` names the new choices that belong to such a change,
 * so `changeCount` and `listChanges` do not count them a second time. Pure: no React, no DOM.
 */
import type { StoreAction } from '../proto/store.js';
import type { HarnessItem, World } from '../proto/types.js';
import type { Choice } from './notes-model.js';

const NAME_WORDS = 4;

/** The name of a new set of notes for an agent: "Meeting assistant notes". At most five words, so a card shows all of it. */
export function notesName(agentName: string): string {
  return `${agentName.split(/\s+/).filter(w => w !== '').slice(0, NAME_WORDS).join(' ')} notes`;
}

/** The store action for one agent reading one choice. */
export function chooseNotesAction(agentId: string, agentName: string, choice: Choice): StoreAction {
  return { type: 'chooseNotes', agentId, name: notesName(agentName), rule: choice.rule, seeds: choice.seeds };
}

/**
 * The ids of the saved choices that are new in the draft and that an agent of the saved world now reads. Each one is part of that agent's notes change.
 * A choice that came in with a new agent (an import) is not here: that agent is a change of its own.
 */
export function absorbedSlices(committed: World, draft: World): ReadonlySet<string> {
  const known = new Set(committed.slices.map(s => s.id)), before = new Map(committed.items.map(i => [i.id, i] as const));
  const out = new Set<string>();
  for (const s of draft.slices) {
    if (known.has(s.id)) continue;
    const reader = draft.items.find(i => i.kind === 'agent' && i.definition.sliceId === s.id && before.get(i.id)?.kind === 'agent');
    if (reader !== undefined) out.add(s.id);
  }
  return out;
}

/** True for the list item of an absorbed choice: it has no change of its own either. */
export const isAbsorbedItem = (item: HarnessItem, absorbed: ReadonlySet<string>): boolean => 'sliceId' in item && absorbed.has(item.sliceId);
