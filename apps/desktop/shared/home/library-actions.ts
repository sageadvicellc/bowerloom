/**
 * How the Library page reaches the store. Every press is one store action (shared/proto/store-library.ts for the four Library actions, the existing
 * `attachSkill`, `attachTool` and `assignSlice` for "Add to an agent"), so each is one draft change, one line on the Save bar, one row of the version
 * history and one step to undo. This file also plans an "Add from the web": which of the ticked items are new, which are already here (skipped), and which
 * meet an item of the same name with other text (they become a second copy and show the "different copies" badge). Pure: no React, no DOM.
 */
import type { StoreAction } from '../proto/store.js';
import type { World } from '../proto/types.js';
import { addAction } from './add-model.js';
import type { AddEntry } from './add-model.js';
import { allLinesOf, copyDraft, entriesOf, entryOf, lookOf } from './library-model.js';
import type { LibraryKind } from './library-model.js';
import { infoOf, newItemOf } from './library-sources.js';
import type { SampleSource, SourceItem } from './library-sources.js';

/** Takes a thing out of the library and off every agent that holds it. */
export const removeFromLibraryAction = (id: string): StoreAction => ({ type: 'removeFromLibrary', itemId: id });

/** Puts a thing on one agent: a skill, a tool (it can only read to begin with) or a set of notes. Null for an agent, which is never put on another agent. */
export function addToAgentAction(world: World, kind: LibraryKind, id: string, agentId: string): StoreAction | null {
  if (kind === 'agent') return null;
  const entry = entryOf(world, kind, id);
  if (entry === undefined) return null;
  const look = lookOf(world, entry);
  const asEntry: AddEntry = { id, kind, name: look.name, hint: look.hint, ready: false };
  return addAction(agentId, asEntry);
}

/** Makes an own copy of an item that came from outside. */
export function makeOwnCopyAction(world: World, kind: LibraryKind, id: string): StoreAction | null {
  const draft = copyDraft(world, kind, id);
  return draft === null ? null : { type: 'makeOwnCopy', itemId: id, name: draft.name, description: draft.description, text: draft.text };
}

/** Puts the waiting update in place. Null when none is waiting. */
export function useUpdateAction(world: World, kind: LibraryKind, id: string, info: { readonly to: string; readonly text: string; readonly description: string }): StoreAction | null {
  const entry = entryOf(world, kind, id);
  return entry === undefined || entry.kind === 'note' ? null : { type: 'useUpdate', itemId: id, text: info.text, description: info.description, release: info.to };
}

// ---------------------------------------------------------------------------------------------------- planning an "Add from the web"

/** What adding the ticked items of a source would do. */
export interface AddPlan {
  /** The ticked items that will be staged: new ones and second copies. */
  readonly adds: readonly SourceItem[];
  /** The ticked items that are already here with the same name and the same text: skipped. */
  readonly same: readonly SourceItem[];
  /** The slugs of the adds that become a second copy of an item that is here. */
  readonly copies: readonly string[];
  /** The store action, or null when there is nothing to add. */
  readonly action: StoreAction | null;
}

const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();
const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((line, i) => norm(line) === norm(b[i]!));

/**
 * Plans the add of the items of `source` whose slugs are in `ticked`. An item matches one that is here when both have the same kind and the same name as a
 * person reads it (letter case aside). The same lines as any copy that is here mean it is already here; other lines make it a second copy of the one that is here.
 */
export function planAdd(world: World, source: SampleSource, ticked: readonly string[]): AddPlan {
  const picked = source.items.filter(i => ticked.includes(i.slug));
  const adds: SourceItem[] = [], same: SourceItem[] = [], copies: string[] = [];
  const news = [];
  for (const item of picked) {
    const here = entriesOf(world, item.kind).find(e => norm(lookOf(world, e).name) === norm(item.name));
    if (here !== undefined && allLinesOf(here).some(lines => sameLines(lines, item.lines))) { same.push(item); continue; }
    adds.push(item);
    if (here !== undefined) copies.push(item.slug);
    news.push(newItemOf(item, here?.id));
  }
  const action: StoreAction | null = news.length === 0 ? null : { type: 'addToLibrary', source: infoOf(source), items: news };
  return { adds, same, copies, action };
}
