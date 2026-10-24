/**
 * The skills manager's logic (prototype slice S6, spec section 7, screen 3), as pure functions: which skills a harness has, how they are
 * grouped, searched and filtered, where each one is installed and which interfaces it lands in, in words. The screen only draws the result.
 * Inheritance is the harness editor's: a row is built from the editor's graph model, so "inherited", "hidden" and "replaced" mean the same here.
 */
import { buildHarnessMap, interfaceName, NO_OWN_GROUPS } from './harnessmodel.js';
import { effectiveItems, hashesDiffer } from './common.js';
import { everyGroup, interfaceWords, joinWords, scopeLabel } from './library-install.js';
import type { InterfaceId, LibrarySource, SkillItem, World } from './types.js';

/** The scope filter value that shows the skills of every harness. */
export const EVERY_HARNESS = 'all';

/** How a skill stands in the harness being looked at. */
export type RowState = 'own' | 'inherited' | 'hidden' | 'replaced';

/** One skill as the screen lists it. `fromScope` is the harness it is inherited from, or null. `conflict` is true when its copies differ between interfaces. */
export interface SkillRow { readonly item: SkillItem; readonly state: RowState; readonly fromScope: string | null; readonly conflict: boolean }

/** What a person typed or chose. An empty query and a null interface show everything. */
export interface SkillFilter { readonly query: string; readonly interfaceId: InterfaceId | null }

const isSkill = (item: { kind: string }): item is SkillItem => item.kind === 'skill';

/**
 * The skills of one harness, or of every harness. For one harness: its own skills, the ones it inherits, the ones it hides (kept so they can be
 * brought back) and the ones it replaces. Skills the harness cannot reach are left out.
 */
export function skillRows(world: World, scopeId: string): SkillRow[] {
  if (scopeId === EVERY_HARNESS || !world.scopes.some(s => s.id === scopeId)) {
    return world.items.filter(isSkill).map(item => ({ item, state: 'own', fromScope: null, conflict: hashesDiffer(item) }));
  }
  const model = buildHarnessMap(world, { scopeId, showInherited: true, expandedGroups: everyGroup(world), groupLimits: NO_OWN_GROUPS });
  const byId = new Map(world.items.map(i => [i.id, i]));
  const rows: SkillRow[] = [];
  for (const node of model.nodes) {
    const item = node.kind === 'skill' ? byId.get(node.id) : undefined;
    if (item === undefined || !isSkill(item)) continue;
    rows.push({ item, state: node.hidden ? 'hidden' : node.replaced ? 'replaced' : node.inherited ? 'inherited' : 'own', fromScope: node.fromScope, conflict: hashesDiffer(item) });
  }
  return rows;
}

/** True when every word of the query is in the skill's name or description. Case does not matter. An empty query matches everything. */
export function matchesQuery(item: SkillItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '');
  if (words.length === 0) return true;
  const text = `${item.name} ${item.description}`.toLowerCase();
  return words.every(w => text.includes(w));
}

/** The rows that pass the search and the interface chip. The chip keeps skills that were found in that interface. */
export function filterRows(rows: readonly SkillRow[], filter: SkillFilter): SkillRow[] {
  return rows.filter(r => matchesQuery(r.item, filter.query) && (filter.interfaceId === null || r.item.foundAt.some(f => f.interface === filter.interfaceId)));
}

/** One library in the "From libraries" group. `rows` are the skills that pass the filter; `skillCount` is how many it holds in all. */
export interface LibraryGroup {
  readonly library: LibrarySource; readonly pinnedVersion: string; readonly newerVersion: string | null;
  readonly skillCount: number; readonly agentCount: number; readonly rows: readonly SkillRow[];
}

/** The three groups of the screen. `shown` is how many skills pass the filter in all. */
export interface SkillGroups { readonly yours: readonly SkillRow[]; readonly libraries: readonly LibraryGroup[]; readonly conflicts: readonly SkillRow[]; readonly shown: number; readonly total: number }

/**
 * Splits the rows in three: skills the person owns, skills of each installed library, and owned skills that were found in several interfaces with
 * different text. A skill is in exactly one group. Every installed library is listed, even one with no skills, so its version notice shows.
 */
export function groupSkills(world: World, rows: readonly SkillRow[], filter: SkillFilter): SkillGroups {
  const byName = (a: SkillRow, b: SkillRow): number => (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0);
  const passing = filterRows(rows, filter).sort(byName);
  const yours = passing.filter(r => r.item.library === null && !r.conflict);
  const conflicts = passing.filter(r => r.item.library === null && r.conflict);
  const libraries = world.libraries.map((library): LibraryGroup => {
    const all = rows.filter(r => r.item.library?.library === library.id);
    const itemNewer = all.map(r => r.item.library?.newerVersion).find((v): v is string => v !== undefined);
    return {
      library, pinnedVersion: library.installedVersion, newerVersion: library.newerVersion ?? itemNewer ?? null,
      skillCount: all.length, agentCount: world.items.filter(i => i.kind === 'agent' && i.library?.library === library.id).length,
      rows: passing.filter(r => r.item.library?.library === library.id),
    };
  });
  return { yours, libraries, conflicts, shown: passing.length, total: rows.length };
}

/** The line under the title: how many skills there are, and how many pass the filter when some do not. */
export function skillsSummary(groups: SkillGroups): string {
  const noun = (n: number): string => `${n} ${n === 1 ? 'skill' : 'skills'}`;
  return groups.shown === groups.total ? noun(groups.total) : `${noun(groups.shown)} of ${groups.total} match`;
}

// ------------------------------------------------------------------------------------------------------------- where a skill is

/** Which harnesses use each item: the items a harness really has, after hide and replace choices. Built once for a world. */
export type UseIndex = ReadonlyMap<string, ReadonlySet<string>>;

export function buildIndex(world: World): UseIndex {
  const out = new Map<string, Set<string>>();
  for (const scope of world.scopes) for (const item of effectiveItems(world, scope.id)) {
    const set = out.get(item.id) ?? new Set<string>();
    set.add(scope.id); out.set(item.id, set);
  }
  return out;
}

/** The words on a card about where the skill is. */
export interface Placement {
  /** Where it is installed, such as "Studio (global) and all 3 projects". */
  readonly installed: string;
  /** Short sentences about hide and replace choices, such as "Hidden in Reedmarsh." */
  readonly notes: readonly string[];
  /** The interfaces it was found in. */
  readonly found: string;
  /** The interfaces it would be written to when the changes are applied. */
  readonly written: string;
}

/**
 * Where a skill is, in words. A library skill is a reference: it is written nowhere until a person installs an editable copy.
 * Any other skill is written to every interface that is installed on this computer, in each harness that keeps it.
 */
export function describePlacement(world: World, item: SkillItem, index: UseIndex = buildIndex(world)): Placement {
  const global = world.scopes.find(s => s.kind === 'global'), projects = world.scopes.filter(s => s.kind === 'project');
  const used = world.scopes.filter(s => index.get(item.id)?.has(s.id) === true);
  const notes: string[] = [];
  for (const mode of ['hide', 'replace'] as const) {
    const names = world.overrides.filter(o => o.itemId === item.id && o.mode === mode).map(o => world.scopes.find(s => s.id === o.scopeId)?.name).filter((n): n is string => n !== undefined);
    if (names.length > 0) notes.push(`${mode === 'hide' ? 'Hidden' : 'Replaced'} in ${joinWords(names)}.`);
  }
  const everywhere = global !== undefined && used.length === world.scopes.length && projects.length > 0;
  const installed = item.library !== null ? 'Not installed. It is a reference to a library.'
    : used.length === 0 ? 'No harness uses it.'
      : everywhere ? `${scopeLabel(global)} and ${projects.length === 1 ? 'the project' : `all ${projects.length} projects`}`
        : joinWords(used.map(s => (s.kind === 'global' ? scopeLabel(s) : s.name)));
  const found = item.foundAt.length === 0 ? 'Not a file in any interface.' : interfaceWords(item.foundAt.map(f => f.interface));
  const landing = world.interfaces.filter(i => i.installed === 'installed').map(i => i.id);
  const written = item.library !== null ? 'Nothing. A library item is a reference.' : landing.length === 0 ? 'Nothing. No interface is installed.' : interfaceWords(landing);
  return { installed, notes, found, written };
}

/** The interface chips' words, in order. */
export const INTERFACE_CHIPS: readonly { readonly id: InterfaceId; readonly name: string }[] = (['claude-code', 'codex', 'opencode'] as const).map(id => ({ id, name: interfaceName(id) }));

/** The words for a skill's state in the harness being looked at, or null when it has none worth saying. */
export function stateWords(row: SkillRow): string | null {
  switch (row.state) {
    case 'hidden': return 'Hidden in this project';
    case 'replaced': return 'Replaced in this project';
    case 'inherited': return `Inherited from ${row.fromScope ?? 'the global harness'}`;
    case 'own': return null;
  }
}
