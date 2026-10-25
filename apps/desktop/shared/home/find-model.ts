/**
 * What the Find screen shows, worked out from the world: one tile for each of the three programs with the number of agents found for it, and the places
 * the agents were found in, in plain words ("Your home folder", "Client site"). The real folders of each place are kept apart, for "Show details" only.
 * The counts are the agents the person owns (the ones the map shows), so they match the map. Ready-made agents from a library are not counted: they
 * live in the Add drawer. Pure: no clock, no random number, no file is read. The world is never changed.
 */
import type { AgentItem, InterfaceId, World } from '../proto/types.js';
import { placeIdOf } from '../proto/scan-places.js';
import { itemTitle, ownedAgents } from './cards.js';

/** The three programs, in tile order, with their names. */
export const FIND_TOOLS: readonly { readonly id: InterfaceId; readonly name: string }[] = Object.freeze([
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'opencode', name: 'OpenCode' },
]);

export interface ToolTile { readonly id: InterfaceId; readonly name: string; readonly found: boolean; readonly agents: number }

/** One tile for each program. A program that is not on the computer (or that the world does not list) is not found and has no agents. */
export function toolTiles(world: World): ToolTile[] {
  const owned = ownedAgents(world);
  return FIND_TOOLS.map(({ id, name }) => {
    const found = world.interfaces.some(i => i.id === id && i.installed === 'installed');
    return { id, name, found, agents: found ? owned.filter(a => a.foundAt.some(f => f.interface === id)).length : 0 };
  });
}

/**
 * One place: a name a person knows, how many agents were found there, which agents, and the folders behind it. `unsaved` is how many of those agents have
 * changes that wait for Save (or are new and not saved yet): a place like that cannot be skipped, because its agents would drop off the map with the changes.
 */
export interface FindPlace { readonly id: string; readonly name: string; readonly agents: number; readonly agentIds: readonly string[]; readonly paths: readonly string[]; readonly unsaved: number }

/** The ids of the agents whose draft differs from the saved world, or that are new in the draft. */
export function unsavedAgents(committed: World, draft: World): ReadonlySet<string> {
  const before = new Map(committed.items.map(i => [i.id, JSON.stringify(i)] as const));
  return new Set(ownedAgents(draft).filter(a => before.get(a.id) !== JSON.stringify(a)).map(a => a.id));
}

const HOME_NAME = 'Your home folder';
/** Plain names for the folders of the sample world, by the folder's own name. A folder the table does not know is named by its own name, as words. */
const FOLDER_NAMES: Readonly<Record<string, string>> = Object.freeze({ Reedmarsh: 'Client site', Copperfen: 'Holiday trips' });

const pathsOf = (world: World, agents: readonly AgentItem[]): string[] =>
  [...new Set(agents.flatMap(a => a.foundAt.map(f => placeIdOf(world, a, f))))].sort();

/** The places that hold at least one agent of the person: the home folder first, then the others by name. `committed` is the saved world, to tell which agents have unsaved changes. */
export function findPlaces(world: World, committed: World = world): FindPlace[] {
  const owned = ownedAgents(world), waiting = unsavedAgents(committed, world);
  const places: FindPlace[] = [];
  for (const scope of world.scopes) {
    const here = owned.filter(a => a.scopeId === scope.id);
    if (here.length === 0) continue;
    const name = scope.parentId === null ? HOME_NAME : (FOLDER_NAMES[scope.name] ?? itemTitle(scope.name));
    places.push({ id: scope.id, name, agents: here.length, agentIds: here.map(a => a.id), paths: pathsOf(world, here), unsaved: here.filter(a => waiting.has(a.id)).length });
  }
  const homeFirst = (p: FindPlace): number => (p.name === HOME_NAME ? 0 : 1);
  return places.sort((a, b) => homeFirst(a) - homeFirst(b) || a.name.localeCompare(b.name));
}

/** The agents of every place that is not ticked: the map leaves them out. */
export function skippedAgents(places: readonly FindPlace[], ticked: readonly string[]): string[] {
  return places.filter(p => !ticked.includes(p.id)).flatMap(p => [...p.agentIds]);
}
