/**
 * The words of the prototype shell: the six route ids, their titles, and the one line a stub shows under its title.
 * The nouns are the spec's: harness, skill, agent, tool, hook. Never "helper", never "team", never a command line.
 */
import type { World } from '../../shared/proto/types.js';
import { plural } from '../../shared/words.js';

/** The six screens of the prototype, in the order the navigation shows them. */
export type RouteId = 'setup' | 'harness' | 'skills' | 'agents' | 'knowledge' | 'versions';

/** What every prototype screen is given. A later slice adds the store here. */
export interface ScreenProps { readonly world: World }

/** The title of each screen, which is also its navigation label. */
export const ROUTE_LABELS: Readonly<Record<RouteId, string>> = Object.freeze({
  setup: 'Setup', harness: 'Harness', skills: 'Skills', agents: 'Agents', knowledge: 'Knowledge', versions: 'Versions',
});

/** The number of items of the screen's own kind, in plain words: "3 interfaces", "1 version". */
export function countLine(id: RouteId, world: World): string {
  switch (id) {
    case 'setup': return plural(world.interfaces.length, 'interface');
    case 'harness': return plural(world.items.length, 'item');
    case 'skills': return plural(world.items.filter(i => i.kind === 'skill').length, 'skill');
    case 'agents': return plural(world.items.filter(i => i.kind === 'agent').length, 'agent');
    case 'knowledge': return plural(world.wikiPages.length, 'page');
    case 'versions': return plural(world.versions.length, 'version');
  }
}
