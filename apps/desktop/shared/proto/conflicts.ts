/**
 * Conflicts: one item found with different text in several interfaces (spec 6.1 and 6.3). The Setup review and the Harness inspector both
 * show the copies, name them, and keep one or all of them, so the rules for "which copies are there", "what are they called at first" and
 * "can these names be used" live here, once. Pure: no clock, no random number, no file.
 */
import type { FoundAt, HarnessItem, InterfaceId, World } from './types.js';
import { interfaceName, joinWords } from './words.js';

/** One distinct text of a conflicted item. `index` is the first place in `foundAt` that holds it, which is what `resolveConflict` keeps. */
export interface ConflictCopy { readonly index: number; readonly hash: string; readonly interfaces: readonly InterfaceId[]; readonly interfaceNames: string; readonly paths: readonly string[]; readonly text: string }

/** How many different texts the item holds across every place it was found. */
export const distinctTexts = (item: HarnessItem): number => new Set(item.foundAt.map(f => f.contentHash)).size;

/**
 * The distinct copies of an item, in the order they were found. Empty when fewer than two texts remain.
 * `include` limits the places that count (the Setup review counts only the places the person ticked); all places count by default.
 */
export function conflictCopies(item: HarnessItem, include: (found: FoundAt) => boolean = () => true): ConflictCopy[] {
  const places = item.foundAt.map((found, index) => ({ found, index })).filter(p => include(p.found));
  const hashes = [...new Set(places.map(p => p.found.contentHash))];
  if (hashes.length < 2) return [];
  return hashes.map((hash): ConflictCopy => {
    const group = places.filter(p => p.found.contentHash === hash);
    const interfaces = group.map(p => p.found.interface).filter((face, i, all) => all.indexOf(face) === i);
    return { index: group[0]!.index, hash, interfaces, interfaceNames: joinWords(interfaces.map(interfaceName)), paths: group.map(p => p.found.path), text: group[0]!.found.text };
  });
}

/** A first name for each copy when the person keeps all of them: the first keeps the item's own name, the others add the interfaces that hold them. */
export function defaultCopyNames(item: HarnessItem, copies: readonly ConflictCopy[] = conflictCopies(item)): string[] {
  return copies.map((c, n) => (n === 0 ? item.name : `${item.name} (${c.interfaceNames})`));
}

/**
 * Why "keep both" with these names would not work, in plain words, or null when it would. It follows the same rules as the store,
 * so a person is told before the store would quietly refuse.
 */
export function keepBothProblem(world: World, itemId: string, names: readonly string[]): string | null {
  const item = world.items.find(i => i.id === itemId);
  if (item === undefined) return 'This item is not here any more.';
  const texts = distinctTexts(item);
  if (texts < 2) return 'This item has only one text, so there is no conflict to resolve.';
  const trimmed = names.map(n => n.trim());
  if (trimmed.length !== texts) return `Give each of the ${texts} copies a name.`;
  if (trimmed.some(n => n === '')) return 'Every copy needs a name.';
  if (new Set(trimmed).size !== trimmed.length) return 'Each copy needs its own name.';
  const others = new Set(world.items.filter(i => i.id !== item.id && i.scopeId === item.scopeId && i.kind === item.kind).map(i => i.name));
  const taken = trimmed.find(n => others.has(n));
  return taken === undefined ? null : `The name "${taken}" is already used by another ${item.kind} in this harness. Pick another name.`;
}
