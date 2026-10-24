/**
 * The scan, step two and the review (spec 6.1 and 6.2): what was found in the places the person ticked, and the conflicts among it.
 * Only found files inside ticked places are counted, and only their text is used (for a conflict). Pure: no clock, no random number, no file.
 * A conflict is one item whose ticked files hold more than one text. It is told by the content hash of each file.
 */
import type { HarnessItem, SecretRef, World } from './types.js';
import { conflictCopies, defaultCopyNames, distinctTexts } from './conflicts.js';
import type { ConflictCopy } from './conflicts.js';
import { placeIdOf } from './scan-places.js';
import { INTERFACE_WORDS } from './words.js';

export { INTERFACE_WORDS };

/** One text of a conflicted item: the interfaces and paths that hold it. `index` is the first place in `item.foundAt` that holds it. */
export type ReviewVariant = ConflictCopy;

/** One item found with different text in several tools. `defaultNames` has one name per text, the first being the item's own. */
export interface ReviewConflict { readonly itemId: string; readonly name: string; readonly kind: HarnessItem['kind']; readonly variants: readonly ReviewVariant[]; readonly canKeepBoth: boolean; readonly defaultNames: readonly string[] }

export interface ReviewLine { readonly id: string; readonly name: string }
export interface ReviewSecret extends ReviewLine { readonly secretKind: SecretRef['kind']; readonly secretName: string }
export interface ReviewLibrary { readonly name: string; readonly version: string; readonly skills: number; readonly agents: number; readonly tools: number; readonly total: number }

/** What the ticked places hold. The owned counts leave out library items, which are kept as a reference and listed apart. */
export interface Review {
  readonly itemCount: number;
  readonly skills: number;
  readonly agents: number;
  readonly tools: number;
  readonly mcp: number;
  readonly prompts: number;
  readonly hooks: readonly ReviewLine[];
  readonly needsSecret: readonly ReviewSecret[];
  readonly libraryItems: readonly ReviewLibrary[];
  readonly libraryTotal: number;
  readonly conflicts: readonly ReviewConflict[];
}

function conflictOf(world: World, item: HarnessItem, ticked: ReadonlySet<string>): ReviewConflict | null {
  const variants = conflictCopies(item, found => ticked.has(placeIdOf(world, item, found)));
  if (variants.length < 2) return null;
  return { itemId: item.id, name: item.name, kind: item.kind, variants, canKeepBoth: variants.length === distinctTexts(item), defaultNames: defaultCopyNames(item, variants) };
}

/** Counts what is found in the ticked places. `tickedIds` are `ScanPlace.id` values. */
export function buildReview(world: World, tickedIds: readonly string[]): Review {
  const ticked = new Set(tickedIds);
  const found = world.items.filter(item => item.foundAt.some(f => ticked.has(placeIdOf(world, item, f))));
  const owned = found.filter(i => i.library === null), library = found.filter(i => i.library !== null);
  const tools = owned.flatMap(i => (i.kind === 'tool' ? [i] : []));
  const libraries = new Map<string, HarnessItem[]>();
  for (const item of library) { const key = `${item.library!.library}\u0000${item.library!.pinnedVersion}`; libraries.set(key, [...(libraries.get(key) ?? []), item]); }
  const conflicts: ReviewConflict[] = [];
  for (const item of owned) { const c = conflictOf(world, item, ticked); if (c !== null) conflicts.push(c); }
  return {
    itemCount: found.length,
    skills: owned.filter(i => i.kind === 'skill').length,
    agents: owned.filter(i => i.kind === 'agent').length,
    tools: tools.length,
    mcp: tools.filter(t => t.toolKind === 'mcp').length,
    prompts: tools.filter(t => t.toolKind === 'prompt').length,
    hooks: tools.filter(t => t.toolKind === 'hook').map(t => ({ id: t.id, name: t.name })),
    needsSecret: tools.flatMap(t => (t.toolKind === 'mcp' && t.secret !== null && t.secret.state === 'missing' ? [{ id: t.id, name: t.name, secretKind: t.secret.kind, secretName: t.secret.name }] : [])),
    libraryItems: [...libraries.entries()].map(([key, items]): ReviewLibrary => {
      const [id, version] = key.split('\u0000') as [string, string];
      return { name: world.libraries.find(l => l.id === id)?.name ?? id, version, skills: items.filter(i => i.kind === 'skill').length, agents: items.filter(i => i.kind === 'agent').length, tools: items.filter(i => i.kind === 'tool').length, total: items.length };
    }),
    libraryTotal: library.length,
    conflicts,
  };
}
