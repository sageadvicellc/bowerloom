/**
 * Conflicts: one item found with different text in several interfaces (spec 6.1 and 6.3). The rule for "which copies are there"
 * lives here, once. Pure: no clock, no random number, no file.
 */
import type { FoundAt, HarnessItem, InterfaceId } from './types.js';
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
