/**
 * What the Find screen shows, worked out from the world: ONE list of the agents the person owns (the ones the map shows), each with a flat tag for every app it works
 * with, and the places the agents were found in, in plain words ("Your home folder", "Client site"), whose real folders are kept apart for "Show details" only. The old
 * tile for each of the three programs (`toolTiles`, `multiProgramAgents`) is no longer drawn: the first scan shows agents, not apps. Ready-made agents from a library are not
 * listed: they live in the Add drawer. Pure: no clock, no random number, no file is read. The world is never changed.
 */
import type { AgentItem, InterfaceId, World } from '../world/types.js';
import { placeIdOf } from '../world/scan-places.js';
import { agentCard, itemTitle, ownedAgents } from './cards.js';
import { PROGRAM_NAMES } from './plain-details.js';

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
 * How many of the agents work in more than one program: the agents found in two or more of the programs that are on the computer. The tiles count an agent once for
 * each program it works in, so their numbers add up to more than the agents found; this is the number that explains the difference.
 */
export function multiProgramAgents(world: World): number {
  const on = new Set(world.interfaces.filter(i => i.installed === 'installed').map(i => i.id));
  return ownedAgents(world).filter(a => new Set(a.foundAt.map(f => f.interface).filter(id => on.has(id))).size > 1).length;
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
/** Plain names for the folders of the sample world, by the folder's own name. A folder the table does not know is named by its own name, as words. A Map, because a person's folder can be called constructor or __proto__. */
const FOLDER_NAMES: ReadonlyMap<string, string> = new Map([['Reedmarsh', 'Client site'], ['Copperfen', 'Holiday trips']]);

const pathsOf = (world: World, agents: readonly AgentItem[]): string[] =>
  [...new Set(agents.flatMap(a => a.foundAt.map(f => placeIdOf(world, a, f))))].sort();

/** The places that hold at least one agent of the person: the home folder first, then the others by name. `committed` is the saved world, to tell which agents have unsaved changes. */
export function findPlaces(world: World, committed: World = world): FindPlace[] {
  const owned = ownedAgents(world), waiting = unsavedAgents(committed, world);
  const places: FindPlace[] = [];
  for (const scope of world.scopes) {
    const here = owned.filter(a => a.scopeId === scope.id);
    if (here.length === 0) continue;
    const name = scope.parentId === null ? HOME_NAME : (FOLDER_NAMES.get(scope.name) ?? itemTitle(scope.name));
    places.push({ id: scope.id, name, agents: here.length, agentIds: here.map(a => a.id), paths: pathsOf(world, here), unsaved: here.filter(a => waiting.has(a.id)).length });
  }
  const homeFirst = (p: FindPlace): number => (p.name === HOME_NAME ? 0 : 1);
  return places.sort((a, b) => homeFirst(a) - homeFirst(b) || a.name.localeCompare(b.name));
}

/** The agents of every place that is not ticked: the map leaves them out. */
export function skippedAgents(places: readonly FindPlace[], ticked: readonly string[]): string[] {
  return places.filter(p => !ticked.includes(p.id)).flatMap(p => [...p.agentIds]);
}

/** The names of the apps a person knows (the program table of the details). An app the table does not know is named by its own id as words ("some-app" is "Some App"). */
export const appLabel = (id: string): string => (Object.hasOwn(PROGRAM_NAMES, id) ? PROGRAM_NAMES[id as keyof typeof PROGRAM_NAMES] : itemTitle(id));

/** One row of the list: an agent as the map names it, its job in one line, the apps it works with (in the order Claude Code, Codex, OpenCode, then any other by name), and whether its changes wait for Save. */
export interface FindAgent { readonly id: string; readonly name: string; readonly hint: string; readonly apps: readonly string[]; readonly unsaved: boolean }

/**
 * The agents of the list, in name order. An app is listed for an agent when one of its files is in that app and the app is on the computer. `committed` is the saved world, to tell which agents
 * have changes that wait: such an agent cannot be skipped, because it would drop off the map with its changes.
 */
export function findAgents(world: World, committed: World = world): FindAgent[] {
  const waiting = unsavedAgents(committed, world);
  const on = new Set<string>(world.interfaces.filter(i => i.installed === 'installed').map(i => i.id));
  const order = (id: string): number => { const at = FIND_TOOLS.findIndex(t => t.id === id); return at < 0 ? FIND_TOOLS.length : at; };
  return ownedAgents(world).map(a => {
    const apps = [...new Set(a.foundAt.map(f => f.interface as string).filter(id => on.has(id)))].sort((x, y) => order(x) - order(y) || x.localeCompare(y));
    const card = agentCard(a);
    return { id: a.id, name: card.name, hint: card.hint, apps: apps.map(appLabel), unsaved: waiting.has(a.id) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The ids of the agents that cannot be unticked, because their changes wait for Save. */
export const lockedAgents = (list: readonly FindAgent[]): string[] => list.filter(a => a.unsaved).map(a => a.id);
