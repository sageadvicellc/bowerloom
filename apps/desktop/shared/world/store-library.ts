/**
 * The store's Library edits (the Library page of the 0.8 home app). Each one is a single draft change, so each is one step to undo, shows on the Save bar and
 * lands in the version history without a special case:
 *  - `removeFromLibrary` takes one skill, tool, agent or set of notes out of the world AND off every agent that holds it, in one step.
 *  - `addToLibrary` puts the items of a source (read before it was added) into the global harness as items of that source, on no agent. An item that is
 *    already there with the same name and the same text is skipped; one with the same name and other text becomes a second copy of the item that is there
 *    (the existing "two different copies" logic then applies: the item shows the badge and the copies dialog keeps one).
 *  - `makeOwnCopy` makes an item of the person's own from one that came from outside.
 *  - `useUpdate` puts the newer text of a library item in place of the old one and pins the item to the newer release.
 * Pure: no clock, no random number, no file. The input world is never changed, and an action that would change nothing returns the very same world.
 */
import type { AgentItem, HarnessItem, InterfaceId, LibraryRef, SecretSlot, SkillItem, ToolItem, ToolKind, World } from './types.js';
import { globalScope, uniqueId } from './common.js';
import { hashText } from './sample.js';

/** What the person read about one item of a source before adding it. Plain data: the screen builds it, the store builds the item from it. */
export interface LibraryNewItem {
  /** The item's short id inside its source ("triage-inbox"). */
  readonly key: string;
  readonly kind: 'skill' | 'agent' | 'tool';
  readonly toolKind?: ToolKind;
  readonly name: string;
  readonly description: string;
  /** The whole text of the item, the way a file would hold it. */
  readonly text: string;
  /** The release tag the item carries. */
  readonly release: string;
  /** A tool that needs a key: where the key goes. The key itself is never held. */
  readonly secret?: SecretSlot;
  readonly role?: string;
  readonly instructions?: string;
  /**
   * The item that is already in the library under this name, as the screen sees it (the sample's own names are file-style, so the screen matches by the
   * names a person reads). Without it the store matches by the exact stored name.
   */
  readonly matchItemId?: string;
}

/** The source the items come from. */
export interface LibrarySourceInfo { readonly id: string; readonly name: string; readonly release: string }

/** Every Library action. */
export type LibraryAction =
  | { readonly type: 'removeFromLibrary'; readonly itemId: string }
  | { readonly type: 'addToLibrary'; readonly source: LibrarySourceInfo; readonly items: readonly LibraryNewItem[] }
  | { readonly type: 'makeOwnCopy'; readonly itemId: string; readonly name: string; readonly description: string; readonly text: string }
  | { readonly type: 'useUpdate'; readonly itemId: string; readonly text: string; readonly description: string; readonly release: string };

/** The programs, in the order a second copy picks a free one. */
const PROGRAMS: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];

const hasSlice = (item: HarnessItem): item is Extract<HarnessItem, { sliceId: string }> => 'sliceId' in item;

/** The world without one thing and without every reference to it. A set of notes is named by its saved-choice id or by the id of its list item. */
function removeFromLibrary(world: World, itemId: string): World {
  const item = world.items.find(i => i.id === itemId);
  const sliceId = item === undefined ? (world.slices.some(s => s.id === itemId) ? itemId : undefined) : hasSlice(item) ? item.sliceId : undefined;
  if (item === undefined && sliceId === undefined) return world;

  if (sliceId !== undefined) {
    const items = world.items.filter(i => !(hasSlice(i) && i.sliceId === sliceId)).map((i): HarnessItem => {
      if (i.kind !== 'agent' || i.definition.sliceId !== sliceId) return i;
      const { sliceId: _gone, ...rest } = i.definition;
      return { ...i, definition: rest };
    });
    return { ...world, items, slices: world.slices.filter(s => s.id !== sliceId) };
  }

  const gone = itemId;
  const items = world.items.filter(i => i.id !== gone).map((i): HarnessItem => {
    if (i.kind !== 'agent') return i;
    const d = i.definition;
    if (!d.skillIds.includes(gone) && !d.toolAttachments.some(t => t.toolId === gone)) return i;
    return { ...i, definition: { ...d, skillIds: d.skillIds.filter(s => s !== gone), toolAttachments: d.toolAttachments.filter(t => t.toolId !== gone) } };
  });
  const overrides = world.overrides.filter(o => o.itemId !== gone && o.replacementItemId !== gone);
  return { ...world, items, overrides };
}

const placeOf = (key: string, source: string, face: InterfaceId, text: string) => ({ interface: face, path: `web/${source}/${face}/${key}.md`, contentHash: hashText(text), text });

function newItemOf(id: string, n: LibraryNewItem, scopeId: string, ref: LibraryRef): HarnessItem {
  const foundAt = [placeOf(n.key, ref.library, 'claude-code', n.text)];
  const base = { id, name: n.name, scopeId, library: ref, foundAt };
  if (n.kind === 'skill') return { ...base, kind: 'skill', description: n.description } satisfies SkillItem;
  if (n.kind === 'agent') {
    const agent: AgentItem = { ...base, kind: 'agent', definition: { name: n.name, role: n.role ?? 'agent', instructions: n.instructions ?? '', skillIds: [], toolAttachments: [] }, extras: [] };
    return agent;
  }
  if (n.toolKind === 'hook') return { ...base, kind: 'tool', toolKind: 'hook', runsCode: true } satisfies ToolItem;
  if (n.toolKind === 'prompt') return { ...base, kind: 'tool', toolKind: 'prompt' } satisfies ToolItem;
  return { ...base, kind: 'tool', toolKind: 'mcp', secret: n.secret === undefined ? null : { kind: n.secret.kind, name: n.secret.name, state: 'missing' } } satisfies ToolItem;
}

function addToLibrary(world: World, a: Extract<LibraryAction, { type: 'addToLibrary' }>): World {
  const home = globalScope(world);
  if (home === undefined || a.items.length === 0 || a.source.id.trim() === '') return world;
  const taken = new Set(world.items.map(i => i.id));
  let items: HarnessItem[] = [...world.items];
  let changed = false;
  for (const n of a.items) {
    if (n.name.trim() === '' || n.text === '') continue;
    const hash = hashText(n.text);
    const match = n.matchItemId === undefined
      ? items.find(i => i.kind === n.kind && i.scopeId === home.id && i.name === n.name)
      : items.find(i => i.id === n.matchItemId && i.kind === n.kind);
    if (match !== undefined) {
      // The same text is already here: nothing to add. Another text becomes a second copy of the item that is there.
      if (match.foundAt.some(f => f.contentHash === hash)) continue;
      const used = new Set(match.foundAt.map(f => f.interface));
      const face = PROGRAMS.find(p => !used.has(p)) ?? 'claude-code';
      const second = { ...match, foundAt: [...match.foundAt, placeOf(n.key, a.source.id, face, n.text)] } as HarnessItem;
      items = items.map(i => (i === match ? second : i));
      changed = true;
      continue;
    }
    const id = uniqueId(taken, `web-${a.source.id}-${n.key}`);
    taken.add(id);
    items.push(newItemOf(id, n, home.id, { library: a.source.id, pinnedVersion: n.release }));
    changed = true;
  }
  if (!changed) return world;
  const libraries = world.libraries.some(l => l.id === a.source.id) ? world.libraries : [...world.libraries, { id: a.source.id, name: a.source.name, installedVersion: a.source.release }];
  return { ...world, items, libraries };
}

/** The name when it is free for that kind of item in that harness, else "name 2", "name 3" and so on after the first "(mine)" mark. */
function freeCopyName(world: World, item: HarnessItem, wanted: string): string {
  const taken = new Set(world.items.filter(i => i.scopeId === item.scopeId && i.kind === item.kind).map(i => i.name));
  if (!taken.has(wanted)) return wanted;
  const stem = wanted.endsWith('(mine)') ? wanted.slice(0, -')'.length) : wanted;
  for (let n = 2; ; n += 1) {
    const next = wanted.endsWith('(mine)') ? `${stem} ${n})` : `${stem} ${n}`;
    if (!taken.has(next)) return next;
  }
}

function makeOwnCopy(world: World, a: Extract<LibraryAction, { type: 'makeOwnCopy' }>): World {
  const item = world.items.find(i => i.id === a.itemId);
  const wanted = a.name.trim();
  if (item === undefined || item.kind === 'context-slice' || wanted === '' || a.text === '') return world;
  const name = freeCopyName(world, item, wanted);
  const hash = hashText(a.text);
  // One place for each program the original was found in, all holding the new text.
  const faces = [...new Set(item.foundAt.map(f => f.interface))];
  const foundAt = (faces.length === 0 ? ['claude-code' as InterfaceId] : faces).map(face => ({ interface: face, path: `copies/${face}/${item.id}.md`, contentHash: hash, text: a.text }));
  const id = uniqueId(world.items.map(i => i.id), `${item.id}-mine`);
  let copy: HarnessItem;
  if (item.kind === 'skill') copy = { ...item, id, name, library: null, foundAt, description: a.description };
  else if (item.kind === 'agent') copy = { ...item, id, name, library: null, foundAt, definition: { ...item.definition, name } };
  else copy = { ...item, id, name, library: null, foundAt };
  return { ...world, items: [...world.items, copy] };
}

function useUpdate(world: World, a: Extract<LibraryAction, { type: 'useUpdate' }>): World {
  const item = world.items.find(i => i.id === a.itemId);
  if (item === undefined || item.kind === 'context-slice' || item.library === null || item.library.newerVersion === undefined || a.text === '') return world;
  const hash = hashText(a.text);
  const library: LibraryRef = { library: item.library.library, pinnedVersion: a.release };
  const places = [...new Map(item.foundAt.map(f => [f.interface, f] as const)).values()];
  const foundAt = (places.length === 0 ? [placeOf(item.id, library.library, 'claude-code', a.text)] : places.map(f => ({ ...f, contentHash: hash, text: a.text })));
  const next: HarnessItem = item.kind === 'skill' ? { ...item, library, foundAt, description: a.description } : { ...item, library, foundAt };
  const items = world.items.map(i => (i.id === item.id ? next : i));
  // When no item of the source is waiting for a newer release any more, the source itself is up to date.
  const waiting = items.some(i => i.library !== null && i.library.library === library.library && i.library.newerVersion !== undefined);
  const libraries = world.libraries.map(l => {
    if (l.id !== library.library || waiting || l.newerVersion === undefined) return l;
    const { newerVersion, ...rest } = l;
    return { ...rest, installedVersion: newerVersion };
  });
  return { ...world, items, libraries };
}

/** Applies one Library action to a draft world. */
export function editLibrary(world: World, action: LibraryAction): World {
  switch (action.type) {
    case 'removeFromLibrary': return removeFromLibrary(world, action.itemId);
    case 'addToLibrary': return addToLibrary(world, action);
    case 'makeOwnCopy': return makeOwnCopy(world, action);
    case 'useUpdate': return useUpdate(world, action);
  }
}
