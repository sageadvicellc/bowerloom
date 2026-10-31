/**
 * What the Save bar says about changes made on the Library page. The shared lists (changes.ts, savebar.ts) count a removal once for the item and once for every
 * agent it came off, and name a new item the way a file name is spelled ("Triage My Inbox"). On the Library page one press is one change that a person can
 * name, so these three helpers read the same lists and tidy them: the same change is counted once, a name is the name the row showed, and a long run of
 * additions or removals is one sentence ("Added 7 items"). They are drop-in replacements for `listChanges`, `changeCount` and `barSentence` on a screen that
 * shows the Library. Pure: no React, no DOM.
 */
import type { World } from '../world/types.js';
import { agentCard, itemTitle, noteWords } from './cards.js';
import { barSentence, listChanges } from './changes.js';
import type { Change } from './changes.js';
import { entryOf, lookOf } from './library-model.js';
import type { LibraryKind } from './library-model.js';
import { plainOf } from './plain.js';
import { changeCount } from './savebar.js';

/** The name the shared lists give an item, and the name the Library row shows, for every item whose two names differ. */
function renames(...worlds: readonly World[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const world of worlds) {
    for (const item of world.items) {
      if ('sliceId' in item) {
        const slice = world.slices.find(sl => sl.id === item.sliceId);
        if (slice !== undefined) out.set(itemTitle(item.name), noteWords(slice, world.wikiPages).name);
        continue;
      }
      const entry = entryOf(world, item.kind as LibraryKind, item.id);
      if (entry === undefined) continue;
      const shared = item.kind === 'agent' ? agentCard(item).name : plainOf(item.kind, item.id)?.name ?? itemTitle(item.name), mine = lookOf(world, entry).name;
      if (shared !== mine) out.set(shared, mine);
    }
  }
  return out;
}

/** The changes between the saved world and the draft, one entry for each thing a person did: the same change is listed once. */
export function libraryChangeList(committed: World, draft: World): Change[] {
  const names = renames(committed, draft), seen = new Set<string>(), out: Change[] = [];
  for (const change of listChanges(committed, draft)) {
    const what = names.get(change.what) ?? change.what;
    const key = `${change.verb}|${what}|${change.to ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...change, what });
  }
  return out;
}

/** How many changes wait, counted the way `libraryChangeList` lists them. Zero when nothing differs; a draft that differs counts at least one. */
export function libraryChangeCount(committed: World, draft: World): number {
  if (changeCount(committed, draft) === 0) return 0;
  return Math.max(1, libraryChangeList(committed, draft).length);
}

const RUN_VERB: Readonly<Record<string, string>> = Object.freeze({ added: 'Added', removed: 'Removed' });

/** The sentence for the bar: the shared one for one or two changes, "Added 7 items" for a run of the same kind of change, else null (the bar says "N changes"). */
export function librarySentence(changes: readonly Change[], count: number): string | null {
  const shared = barSentence(changes, count);
  if (shared !== null || count <= 2 || changes.length !== count) return shared;
  const verb = changes[0]?.verb;
  if (verb === undefined || RUN_VERB[verb] === undefined || !changes.every(c => c.verb === verb && c.to === undefined)) return null;
  return `${RUN_VERB[verb]} ${count} items`;
}
