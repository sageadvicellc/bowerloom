/**
 * Small pure helpers that the prototype store, the plan and the bundle share. No clock, no random number, no file.
 * Everything here reads a World and returns a new value; nothing changes its input.
 */
import type { FoundAt, HarnessItem, Scope, World } from './types.js';

/** The one global scope of a world, or undefined when the world has none. */
export function globalScope(world: World): Scope | undefined {
  return world.scopes.find(s => s.kind === 'global');
}

/** `base` when no taken id equals it, else `base-2`, `base-3` and so on: the first free one. Deterministic. */
export function uniqueId(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** A name made safe for a file path: letters, digits, dot, space, dash, underscore and round brackets stay; anything else becomes a dash. No `..`, no slash. */
export function fileSlug(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._ ()-]+/gu, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '');
  return cleaned === '' ? 'unnamed' : cleaned;
}

interface Reached { readonly item: HarnessItem; readonly ids: readonly string[] }

/** The items of a scope with, for each, the ids that lead to it: its own id, and the id of every item it replaced on the way. */
function reachedItems(world: World, scopeId: string): Reached[] {
  const scopes = new Map(world.scopes.map(s => [s.id, s]));
  const byId = new Map(world.items.map(i => [i.id, i]));
  const choice = new Map(world.overrides.map(o => [`${o.scopeId}\u0000${o.itemId}`, o]));
  const walk = (id: string, seen: ReadonlySet<string>): Reached[] => {
    const scope = scopes.get(id);
    if (scope === undefined || seen.has(id)) return [];
    const next = new Set(seen).add(id);
    const inherited = scope.parentId === null ? [] : walk(scope.parentId, next).flatMap((entry): Reached[] => {
      const o = choice.get(`${id}\u0000${entry.item.id}`);
      if (o === undefined || o.mode === 'inherit') return [entry];
      if (o.mode === 'hide') return [];
      const replacement = o.replacementItemId === undefined ? undefined : byId.get(o.replacementItemId);
      return [replacement === undefined ? entry : { item: replacement, ids: [...entry.ids, replacement.id] }];
    });
    return [...inherited, ...world.items.filter(i => i.scopeId === id).map((item): Reached => ({ item, ids: [item.id] }))];
  };
  const first = new Map<string, { item: HarnessItem; ids: Set<string> }>();
  for (const entry of walk(scopeId, new Set())) {
    const known = first.get(entry.item.id);
    if (known === undefined) first.set(entry.item.id, { item: entry.item, ids: new Set(entry.ids) });
    else for (const id of entry.ids) known.ids.add(id);
  }
  return [...first.values()].map(e => ({ item: e.item, ids: [...e.ids] }));
}

/**
 * The items a scope really has: what it inherits from its parent scopes (after hide and replace choices), then its own items.
 * An item that appears twice is listed once, at its first place. A loop in the scope chain stops at the first repeat.
 */
export function effectiveItems(world: World, scopeId: string): HarnessItem[] {
  return reachedItems(world, scopeId).map(e => e.item);
}

/**
 * What an id stands for in one scope: the item itself, the item that replaces it there, or nothing when the scope hides it or cannot reach it.
 * This is how an agent's skill and tool ids are read, so a written file and the harness graph agree.
 */
export function effectiveResolver(world: World, scopeId: string): (itemId: string) => HarnessItem | undefined {
  const byId = new Map<string, HarnessItem>();
  for (const e of reachedItems(world, scopeId)) for (const id of e.ids) if (!byId.has(id)) byId.set(id, e.item);
  return id => byId.get(id);
}

/** True when two or more of the item's found files hold different text. */
export function hashesDiffer(item: { readonly foundAt: readonly FoundAt[] }): boolean {
  return new Set(item.foundAt.map(f => f.contentHash)).size > 1;
}

/** True when `itemScopeId` is `scopeId` or one of its parents: the agent of that scope can reach the item. */
export function reachesScope(world: World, scopeId: string, itemScopeId: string): boolean {
  const seen = new Set<string>();
  for (let at = world.scopes.find(s => s.id === scopeId); at !== undefined && !seen.has(at.id); at = at.parentId === null ? undefined : world.scopes.find(s => s.id === at!.parentId)) {
    if (at.id === itemScopeId) return true;
    seen.add(at.id);
  }
  return false;
}

/** The text that makes an item what it is, as one string, to tell "same name, same text" from "same name, different text". */
export function contentOf(item: HarnessItem): string {
  switch (item.kind) {
    case 'skill': return JSON.stringify([item.description, item.foundAt.map(f => f.text)]);
    case 'agent': return JSON.stringify([item.definition, item.extras]);
    case 'tool': return JSON.stringify([item.toolKind, item.foundAt.map(f => f.text), item.toolKind === 'mcp' ? item.secret === null ? null : [item.secret.kind, item.secret.name] : null]);
    case 'context-slice': return JSON.stringify([item.sliceId]);
  }
}
