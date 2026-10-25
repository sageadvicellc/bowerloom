/**
 * The Save bar of the home app, as pure logic: how many changes wait, what the bar says in each of its four modes, and the first save point that a
 * session starts with (so "Go back" always has somewhere to go back to). No React, no DOM, no clock.
 *
 * Modes: `clean` (nothing waits), `dirty` (changes wait), `saved` (the last thing that happened was a save, and "Go back" undoes it), `back`
 * (the last thing that happened was "Go back"). The bar knows which one by the number of save points, a logical clock the store already keeps.
 */
import type { AgentItem, HarnessItem, World } from '../proto/types.js';
import { snapshotOf } from '../proto/store.js';
import { CARD_WORDS } from './cards.js';

export type BarMode = 'clean' | 'dirty' | 'saved' | 'back';

/** What the person did last, remembered by the screen. `at` is the number of save points right after it, so a later change makes it stale. */
export interface BarPhase { readonly kind: 'saved' | 'back'; readonly at: number; /** The save point "Go back" returns to, or null when there is none. */ readonly backTo: string | null }

/** What the Save bar offers in its current mode. */
export interface SaveBarModel {
  readonly mode: BarMode; readonly changes: number; readonly canSave: boolean; readonly canGoBack: boolean; readonly canDiscard: boolean;
  /** What the one or two changes are, in a sentence (`barSentence`), or null when the bar says "N changes". */
  readonly said: string | null;
}

/** The words of the two modes that the bar says without a number. `renderer/home/words.ts` lists them in `WORDS`. */
export const BAR_WORDS = Object.freeze({ saved: 'Saved', back: 'Back to how it was' });

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const only = <T>(a: readonly T[], b: readonly T[]): number => a.filter(x => !b.includes(x)).length;
const apart = <T>(a: readonly T[], b: readonly T[]): number => only(a, b) + only(b, a);

/** What changed for one agent, counted the way a person counts: each skill, each tool, and the notes it reads. A change in anything else counts one. */
function agentChanges(before: AgentItem, after: AgentItem): number {
  const b = before.definition, a = after.definition;
  const skills = apart(b.skillIds, a.skillIds);
  const tools = apart(b.toolAttachments.map(t => t.toolId), a.toolAttachments.map(t => t.toolId))
    + a.toolAttachments.filter(t => b.toolAttachments.some(o => o.toolId === t.toolId && o.access !== t.access)).length;
  const notes = b.sliceId === a.sliceId ? 0 : 1;
  const links = skills + tools + notes;
  if (links > 0) return links;
  return sameJson(before, after) ? 0 : 1;
}

/**
 * How many changes wait: the difference between the saved world and the draft. A skill, tool or note taken off an agent or put on one is one change each;
 * an item added, removed or edited is one; so is a saved choice of pages or a project choice. A draft that differs always counts at least one.
 */
export function changeCount(committed: World, draft: World): number {
  if (committed === draft || snapshotOf(committed) === snapshotOf(draft)) return 0;
  const before = new Map(committed.items.map(i => [i.id, i])), after = new Map(draft.items.map(i => [i.id, i]));
  let total = 0;
  for (const [id, item] of after) {
    const old: HarnessItem | undefined = before.get(id);
    if (old === undefined) total += 1;
    else if (item.kind === 'agent' && old.kind === 'agent') total += agentChanges(old, item);
    else if (!sameJson(old, item)) total += 1;
  }
  for (const id of before.keys()) if (!after.has(id)) total += 1;
  const slices = new Map(committed.slices.map(s => [s.id, s]));
  for (const s of draft.slices) { const old = slices.get(s.id); if (old === undefined || !sameJson(old, s)) total += 1; }
  total += apart(committed.overrides.map(o => JSON.stringify(o)), draft.overrides.map(o => JSON.stringify(o)));
  return Math.max(1, total);
}

/** The mode of the bar and what its buttons may do. */
export function saveBar(changes: number, savePoints: number, phase: BarPhase | null, said: string | null = null): SaveBarModel {
  if (changes > 0) return { mode: 'dirty', changes, canSave: true, canGoBack: false, canDiscard: true, said };
  if (phase !== null && phase.at === savePoints) return { mode: phase.kind, changes: 0, canSave: false, canGoBack: phase.kind === 'saved' && phase.backTo !== null, canDiscard: false, said: null };
  return { mode: 'clean', changes: 0, canSave: false, canGoBack: false, canDiscard: false, said: null };
}

/** The first save point of a session: the world as it was found. Without it the first Save could not be gone back from. A world that has save points is left alone. */
export function withStartPoint(world: World): World {
  if (world.versions.length > 0) return world;
  return { ...world, versions: [{ id: 'v1', parentId: null, counter: 1, label: CARD_WORDS.startPoint, snapshotJson: snapshotOf(world) }] };
}
