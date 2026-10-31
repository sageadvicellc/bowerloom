/**
 * Puts the result of a second read next to the result of the first ("Find more" in real mode). Pure: the two results come in, a new one goes out; neither is changed.
 *
 * The rule is merge by id. A thing with an id that both reads hold is the newer read's when it is the same file read again, a thing only one holds stays, a different file that has the same id (a crafted pair could make one) stays next to the first with an id of its own and what its read linked to follows it, and the order is the order
 * a single read would have given (skills, agents, tools, then sets of notes, each by name). What a read links to is what that read found: an agent read later does not
 * point at a skill that only an earlier read found, because the reader looks for the links inside one read. The counts are counted again from the merged world, so they
 * always agree with what the screens list. Nothing here reads a file, a clock or the network.
 */
import type { HarnessItem, InterfaceInfo, Scope, WikiPage, World } from '../world/types.js';
import type { RealCounts, RealResult } from './types.js';

const PROGRAM_RANK: Readonly<Record<string, number>> = { 'claude-code': 0, codex: 1, opencode: 2, hermes: 3, bowerloom: 4 };

const rankOf = (id: string): number => (Object.hasOwn(PROGRAM_RANK, id) ? PROGRAM_RANK[id]! : 99);

/** The things of two lists by id; a later thing replaces an earlier one with the same id and keeps its place. */
function byId<T extends { readonly id: string }>(old: readonly T[], added: readonly T[]): T[] {
  const out = new Map<string, T>(old.map(x => [x.id, x]));
  for (const x of added) out.set(x.id, x);
  return [...out.values()];
}

/**
 * Whether two items with one id are one file read twice. They are when they are in the same folder and share a path, or, for a thing that lives in no file (a set of notes), share a
 * set of notes. Anything else only has the same id.
 */
function sameItem(a: HarnessItem, b: HarnessItem): boolean {
  if (a.kind !== b.kind || a.scopeId !== b.scopeId) return false;
  if (a.kind === 'context-slice' && b.kind === 'context-slice') return a.sliceId === b.sliceId;
  if (a.foundAt.length === 0 || b.foundAt.length === 0) return a.name === b.name;
  return a.foundAt.some(x => b.foundAt.some(y => y.path === x.path));
}
const samePage = (a: WikiPage, b: WikiPage): boolean => a.folder === b.folder;

/** The new ids for the things of `added` that share an id with a different thing of `old`: the old id and a number, the first that nothing else uses. */
function clashes<T extends { readonly id: string }>(old: readonly T[], added: readonly T[], same: (a: T, b: T) => boolean): Map<string, string> {
  const taken = new Set([...old, ...added].map(x => x.id)), before = new Map(old.map(x => [x.id, x] as const)), out = new Map<string, string>();
  for (const x of added) {
    const was = before.get(x.id);
    if (was === undefined || same(was, x)) continue;
    let n = 2;
    while (taken.has(`${x.id}-${n}`)) n += 1;
    out.set(x.id, `${x.id}-${n}`); taken.add(`${x.id}-${n}`);
  }
  return out;
}

/** A result whose renamed ids are used everywhere the read used them: the item itself, the links of an agent, the pages of a set of notes, and the ages. */
function renamed(added: RealResult, items: ReadonlyMap<string, string>, pages: ReadonlyMap<string, string>): RealResult {
  if (items.size === 0 && pages.size === 0) return added;
  const item = (id: string): string => items.get(id) ?? id, page = (id: string): string => pages.get(id) ?? id;
  const world: World = {
    ...added.world,
    items: added.world.items.map((i): HarnessItem => {
      if (i.kind === 'agent') return { ...i, id: item(i.id), definition: { ...i.definition, skillIds: i.definition.skillIds.map(item), toolAttachments: i.definition.toolAttachments.map(t => ({ ...t, toolId: item(t.toolId) })) } };
      return { ...i, id: item(i.id) };
    }),
    wikiPages: added.world.wikiPages.map(p => ({ ...p, id: page(p.id), links: p.links.map(page) })),
    slices: added.world.slices.map(s => ({ ...s, seeds: s.seeds.map(page), ...(s.pinnedPageIds === undefined ? {} : { pinnedPageIds: s.pinnedPageIds.map(page) }) })),
    overrides: added.world.overrides.map(o => ({ ...o, itemId: item(o.itemId), ...(o.replacementItemId === undefined ? {} : { replacementItemId: item(o.replacementItemId) }) })),
  };
  return { ...added, world, ages: Object.fromEntries(Object.entries(added.ages).map(([id, days]) => [item(id), days])) };
}

/** The counts of a world, the way `buildRealResult` counts them. */
export function countsOf(world: World): RealCounts {
  const tools = world.items.filter(i => i.kind === 'tool');
  return {
    agents: world.items.filter(i => i.kind === 'agent').length,
    skills: world.items.filter(i => i.kind === 'skill').length,
    tools: tools.filter(t => t.toolKind !== 'hook').length,
    hooks: tools.filter(t => t.toolKind === 'hook').length,
    notes: world.wikiPages.length,
  };
}

function mergeInterfaces(old: readonly InterfaceInfo[], added: readonly InterfaceInfo[]): InterfaceInfo[] {
  const out = new Map<string, InterfaceInfo>(old.map(i => [i.id, i]));
  for (const i of added) {
    const before = out.get(i.id);
    // A program found in either read is found.
    out.set(i.id, before !== undefined && before.installed === 'installed' ? before : i);
  }
  return [...out.values()].sort((a, b) => rankOf(a.id) - rankOf(b.id));
}

/** The scopes of both reads, the home folder first (it is the same one in both). */
function mergeScopes(old: readonly Scope[], added: readonly Scope[]): Scope[] {
  const all = byId(old, added);
  return [...all.filter(s => s.kind === 'global'), ...all.filter(s => s.kind !== 'global')];
}

const byName = (a: HarnessItem, b: HarnessItem): number => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The two worlds as one. */
export function mergeWorlds(base: World, added: World): World {
  const items = byId(base.items, added.items);
  const ranked = (kind: HarnessItem['kind']): HarnessItem[] => items.filter(i => i.kind === kind);
  const ordered = [...ranked('skill').sort(byName), ...ranked('agent').sort(byName), ...ranked('tool').sort(byName), ...ranked('context-slice')];
  return {
    interfaces: mergeInterfaces(base.interfaces, added.interfaces),
    items: ordered,
    scopes: mergeScopes(base.scopes, added.scopes),
    overrides: [...base.overrides, ...added.overrides.filter(o => !base.overrides.some(x => JSON.stringify(x) === JSON.stringify(o)))],
    wikiPages: byId(base.wikiPages, added.wikiPages),
    slices: byId(base.slices, added.slices),
    versions: base.versions,
    libraries: base.libraries,
  };
}

/** The results of two reads as one result. `base` is null for the first read, which comes back as it is. */
export function mergeResults(base: RealResult | null, read: RealResult): RealResult {
  if (base === null) return read;
  const added = renamed(read, clashes(base.world.items, read.world.items, sameItem), clashes(base.world.wikiPages, read.world.wikiPages, samePage));
  const world = mergeWorlds(base.world, added.world);
  const others = [...base.others];
  for (const o of added.others) if (!others.some(x => x.app === o.app && x.kind === o.kind && x.name === o.name && x.place === o.place)) others.push(o);
  return {
    world, others, counts: countsOf(world), ages: { ...base.ages, ...added.ages },
    stoppedEarly: base.stoppedEarly || added.stoppedEarly, couldNotRead: base.couldNotRead + added.couldNotRead,
    partlyRead: base.partlyRead + added.partlyRead, textsCut: base.textsCut + added.textsCut,
    notes: [...new Set([...base.notes, ...added.notes])], readOnly: true,
  };
}
