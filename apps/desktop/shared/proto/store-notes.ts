/**
 * The store's "choose notes" edit (the home app's "Choose notes", spec 6.9): one agent gets one saved choice of pages, in ONE step. The choice is a rule and
 * a list of seed pages, exactly as the store already keeps them.
 *  - When the agent already reads a choice that nobody else reads, that choice changes in place (same id, same name).
 *  - Otherwise a new choice is made and the agent reads it. Another agent that read the old one keeps reading it.
 * An empty choice changes nothing: taking the notes away from an agent is the store's `assignSlice` with null, which "Remove" on the shelf already sends.
 * Pure: no clock, no random number. The input world is never changed.
 */
import type { AgentItem, HarnessItem, Slice, SliceRule, World } from './types.js';
import { globalScope } from './common.js';

/** The action. `name` is only used when a new choice is made. */
export interface ChooseNotesAction { readonly type: 'chooseNotes'; readonly agentId: string; readonly name: string; readonly rule: SliceRule; readonly seeds: readonly string[] }

const isOwnedAgent = (item: HarnessItem | undefined): item is AgentItem => item !== undefined && item.kind === 'agent' && item.library === null;
const emptyRule = (rule: SliceRule): boolean => rule.folders.every(f => f.replace(/\/+$/, '') === '') && rule.pageTypesAndTags.types.length === 0 && rule.pageTypesAndTags.tags.length === 0 && rule.linksFromSeeds === null;

/** The world after the agent reads the chosen pages. The very same world comes back when nothing would change. */
export function chooseNotes(world: World, a: ChooseNotesAction): World {
  const agent = world.items.find(i => i.id === a.agentId);
  if (!isOwnedAgent(agent)) return world;
  const known = new Set(world.wikiPages.map(p => p.id));
  const seeds = [...new Set(a.seeds)].filter(id => known.has(id));
  if (emptyRule(a.rule) && seeds.length === 0) return world;
  const rule = structuredClone(a.rule) as SliceRule;

  const current = agent.definition.sliceId === undefined ? undefined : world.slices.find(s => s.id === agent.definition.sliceId);
  const sharedWith = current === undefined ? true : world.items.some(i => i.kind === 'agent' && i.id !== agent.id && i.definition.sliceId === current.id);
  if (current !== undefined && !sharedWith) {
    if (JSON.stringify([current.rule, current.seeds]) === JSON.stringify([rule, seeds]) && !current.pinned) return world;
    const { pinnedPageIds: _frozen, ...live } = current;
    const next: Slice = { ...live, seeds, rule, pinned: false };
    return { ...world, slices: world.slices.map(s => (s.id === current.id ? next : s)) };
  }

  const name = a.name.trim(), scope = globalScope(world);
  if (name === '' || scope === undefined) return world;
  const taken = new Set([...world.slices.map(s => s.id), ...world.items.map(i => i.id)]);
  let n = 1;
  while (taken.has(`slice-${n}`) || taken.has(`slice-${n}-item`)) n += 1;
  const id = `slice-${n}`;
  const slice: Slice = { id, name, seeds, rule, pinned: false };
  const shown: HarnessItem = { id: `${id}-item`, kind: 'context-slice', name, scopeId: scope.id, foundAt: [], library: null, sliceId: id };
  const items = world.items.map(i => (i.id === agent.id && isOwnedAgent(i) ? { ...i, definition: { ...i.definition, sliceId: id } } : i));
  return { ...world, slices: [...world.slices, slice], items: [...items, shown] };
}
