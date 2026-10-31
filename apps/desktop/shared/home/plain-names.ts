/**
 * The plain layer for the Add drawer and the copies dialog. Those two work from a stored name ("jaunty-keystone"), while the plain layer (plain.ts) is keyed
 * by id, so this builds the one from the other for a world: a name goes in, the plain name comes out. A name the layer does not know becomes words
 * ("study-buddy" becomes "Study Buddy"). The hint of a card comes from the same layer, by id.
 */
import type { HarnessItem, Slice, World } from '../world/types.js';
import { plainName } from './add-model.js';
import type { HintOf, NameOf } from './add-model.js';
import { plainOf } from './plain.js';

/** The plain hint of one thing by its id, or null when the layer does not know it. */
export const plainHintOf: HintOf = (kind, id) => plainOf(kind, id)?.hint ?? null;

/** The part of a world that names things: its items and its saved choices of pages. */
type Naming = { readonly items: readonly HarnessItem[]; readonly slices: readonly Slice[] };

function namesFrom(parts: readonly Naming[]): NameOf {
  const known = new Map<string, string>();
  const note = (name: string, plain: string | undefined): void => { if (plain !== undefined && !known.has(name)) known.set(name, plain); };
  for (const part of parts) {
    for (const item of part.items) {
      if (item.kind === 'skill' || item.kind === 'agent' || item.kind === 'tool') note(item.name, plainOf(item.kind, item.id)?.name);
    }
    for (const slice of part.slices) note(slice.name, plainOf('note', slice.id)?.name);
  }
  return name => known.get(name) ?? plainName(name);
}

/** Turns the stored name of anything in `world` (an agent, a skill, a tool, a set of notes) into the plain name. The first thing with a name decides. */
export function plainNameOf(world: World): NameOf {
  return namesFrom([world]);
}

/**
 * Like `plainNameOf`, and it also knows the things that were in the world at each save point, so the history still calls a thing that was taken out since by its
 * plain name ("Removed Translate a text") and not by the name it is stored under.
 */
export function plainNameOfSaved(world: World): NameOf {
  const parts: Naming[] = [world];
  for (const version of world.versions) {
    try {
      const saved: unknown = JSON.parse(version.snapshotJson);
      if (typeof saved === 'object' && saved !== null && Array.isArray((saved as Naming).items) && Array.isArray((saved as Naming).slices)) parts.push(saved as Naming);
    } catch { /* A save point that cannot be read names nothing. */ }
  }
  return namesFrom(parts);
}
