/**
 * Puts the result of a second read next to the result of the first ("Find more" in real mode). Pure: the two results come in, a new one goes out; neither is changed.
 *
 * The rule is merge by id. A thing with an id that both reads hold is the newer read's (the same file read again), a thing only one holds stays, and the order is the order
 * a single read would have given (skills, agents, tools, then sets of notes, each by name). What a read links to is what that read found: an agent read later does not
 * point at a skill that only an earlier read found, because the reader looks for the links inside one read. The counts are counted again from the merged world, so they
 * always agree with what the screens list. Nothing here reads a file, a clock or the network.
 */
import type { HarnessItem, InterfaceInfo, Scope, World } from '../proto/types.js';
import type { RealCounts, RealResult } from './types.js';

const PROGRAM_RANK: Readonly<Record<string, number>> = { 'claude-code': 0, codex: 1, opencode: 2, hermes: 3, bowerloom: 4 };

/** The things of two lists by id; a later thing replaces an earlier one with the same id and keeps its place. */
function byId<T extends { readonly id: string }>(old: readonly T[], added: readonly T[]): T[] {
  const out = new Map<string, T>(old.map(x => [x.id, x]));
  for (const x of added) out.set(x.id, x);
  return [...out.values()];
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
  return [...out.values()].sort((a, b) => (PROGRAM_RANK[a.id] ?? 99) - (PROGRAM_RANK[b.id] ?? 99));
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
export function mergeResults(base: RealResult | null, added: RealResult): RealResult {
  if (base === null) return added;
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
