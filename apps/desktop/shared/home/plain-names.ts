/**
 * The plain layer for the Add drawer and the copies dialog. Those two work from a stored name ("jaunty-keystone"), while the plain layer (plain.ts) is keyed
 * by id, so this builds the one from the other for a world: a name goes in, the plain name comes out. A name the layer does not know becomes words
 * ("study-buddy" becomes "Study Buddy"). The hint of a card comes from the same layer, by id.
 */
import type { World } from '../proto/types.js';
import { plainName } from './add-model.js';
import type { HintOf, NameOf } from './add-model.js';
import { plainOf } from './plain.js';

/** The plain hint of one thing by its id, or null when the layer does not know it. */
export const plainHintOf: HintOf = (kind, id) => plainOf(kind, id)?.hint ?? null;

/** Turns the stored name of anything in `world` (an agent, a skill, a tool, a set of notes) into the plain name. The first thing with a name decides. */
export function plainNameOf(world: World): NameOf {
  const known = new Map<string, string>();
  const note = (name: string, plain: string | undefined): void => { if (plain !== undefined && !known.has(name)) known.set(name, plain); };
  for (const item of world.items) {
    if (item.kind === 'skill' || item.kind === 'agent' || item.kind === 'tool') note(item.name, plainOf(item.kind, item.id)?.name);
  }
  for (const slice of world.slices) note(slice.name, plainOf('note', slice.id)?.name);
  return name => known.get(name) ?? plainName(name);
}
