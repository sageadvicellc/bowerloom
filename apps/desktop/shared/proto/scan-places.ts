/**
 * The scan, step one (spec 6.1): the places where settings were found, with a count of skills, agents and tools in each.
 * Every place is worked out from the `foundAt` paths of the world's items. The text of a file is never looked at here, so the scan
 * shows places and counts only. Pure and deterministic: no clock, no random number, no file. The input is never changed.
 */
import type { FoundAt, HarnessItem, InterfaceId, Scope, World } from './types.js';

/** The five groups the scan shows, in this order. */
export type PlaceGroupId = 'claude-code' | 'codex' | 'opencode' | 'older' | 'projects';

export const PLACE_GROUPS: readonly { readonly id: PlaceGroupId; readonly label: string }[] = Object.freeze([
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'older', label: 'Older Bowerloom layouts' },
  { id: 'projects', label: 'Project folders' },
] as const);

/** One place: a settings folder (or the cache of a library) with the items found in it. `itemIds` holds each item once, in world order. */
export interface ScanPlace {
  readonly id: string;
  readonly group: PlaceGroupId;
  readonly groupLabel: string;
  readonly label: string;
  readonly path: string;
  readonly skills: number;
  readonly agents: number;
  readonly tools: number;
  readonly itemIds: readonly string[];
  readonly library: boolean;
}

const FOLDER: Readonly<Record<InterfaceId, string>> = { 'claude-code': '.claude', codex: '.codex', opencode: '.opencode' };
const GROUP_OF_FOLDER: Readonly<Record<string, PlaceGroupId>> = { '.claude': 'claude-code', '.codex': 'codex', '.opencode': 'opencode', '.bowerloom': 'older', '.bowerloom-store': 'older' };
const labelOfGroup = (id: PlaceGroupId): string => PLACE_GROUPS.find(g => g.id === id)!.label;

interface Where { readonly path: string; readonly group: PlaceGroupId; readonly label: string; readonly library: boolean }

/** Where one found file sits: the settings folder that holds it. A file beside the folder (`.mcp.json`, `opencode.json`) belongs to its interface's folder. */
function whereIs(item: HarnessItem, found: FoundAt, scopes: ReadonlyMap<string, Scope>, world: World): Where {
  const parts = found.path.split('/');
  const owner = scopes.get(item.scopeId);
  const ownerName = owner === undefined ? 'Unknown' : owner.name;
  const cache = parts.indexOf('.cache');
  if (cache >= 0 && parts.length > cache + 2) {
    const path = parts.slice(0, cache + 3).join('/');
    const source = world.libraries.find(l => l.id === parts[cache + 1]);
    return { path, group: found.interface, label: `Library cache: ${source === undefined ? parts[cache + 1]! : source.name} ${parts[cache + 2]!}`, library: true };
  }
  const at = parts.findIndex(p => Object.hasOwn(GROUP_OF_FOLDER, p));
  const folder = at >= 0 ? parts[at]! : FOLDER[found.interface];
  const path = at >= 0 ? parts.slice(0, at + 1).join('/') : `${parts.slice(0, -1).join('/')}/${folder}`;
  const inherent = Object.hasOwn(GROUP_OF_FOLDER, folder) ? GROUP_OF_FOLDER[folder]! : found.interface;
  const group: PlaceGroupId = inherent === 'older' ? 'older' : owner !== undefined && owner.kind === 'project' ? 'projects' : inherent;
  return { path, group, label: `${ownerName}: ${folder}`, library: false };
}

const scopeMap = (world: World): ReadonlyMap<string, Scope> => new Map(world.scopes.map(s => [s.id, s]));

/** The id of the place that holds one found file. It is the place's path, so it matches `ScanPlace.id`. */
export function placeIdOf(world: World, item: HarnessItem, found: FoundAt): string {
  return whereIs(item, found, scopeMap(world), world).path;
}

/** Finds every place and counts the skills, agents and tools in each. Settings folders come before library caches within a group. */
export function buildScan(world: World): ScanPlace[] {
  const scopes = scopeMap(world);
  const places = new Map<string, { where: Where; items: HarnessItem[] }>();
  for (const item of world.items) for (const found of item.foundAt) {
    const where = whereIs(item, found, scopes, world);
    const place = places.get(where.path) ?? { where, items: [] };
    if (!place.items.includes(item)) place.items.push(item);
    places.set(where.path, place);
  }
  const order = PLACE_GROUPS.map(g => g.id);
  return [...places.values()]
    .sort((a, b) => order.indexOf(a.where.group) - order.indexOf(b.where.group) || Number(a.where.library) - Number(b.where.library) || (a.where.path < b.where.path ? -1 : a.where.path > b.where.path ? 1 : 0))
    .map(({ where, items }): ScanPlace => ({
      id: where.path, group: where.group, groupLabel: labelOfGroup(where.group), label: where.label, path: where.path, library: where.library,
      skills: items.filter(i => i.kind === 'skill').length, agents: items.filter(i => i.kind === 'agent').length, tools: items.filter(i => i.kind === 'tool').length,
      itemIds: items.map(i => i.id),
    }));
}
