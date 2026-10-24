/**
 * Small pure helpers that the prototype store, the plan and the bundle share. No clock, no random number, no file.
 * Everything here reads a World and returns a new value; nothing changes its input.
 */
import type { HarnessItem, Scope, World } from './types.js';

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

/**
 * The items a scope really has: what it inherits from its parent scopes (after hide and replace choices), then its own items.
 * An item that appears twice is listed once, at its first place. A loop in the scope chain stops at the first repeat.
 */
export function effectiveItems(world: World, scopeId: string): HarnessItem[] {
  const scopes = new Map(world.scopes.map(s => [s.id, s]));
  const byId = new Map(world.items.map(i => [i.id, i]));
  const choice = new Map(world.overrides.map(o => [`${o.scopeId}\u0000${o.itemId}`, o]));
  const walk = (id: string, seen: ReadonlySet<string>): HarnessItem[] => {
    const scope = scopes.get(id);
    if (scope === undefined || seen.has(id)) return [];
    const next = new Set(seen).add(id);
    const inherited = scope.parentId === null ? [] : walk(scope.parentId, next).flatMap((item): HarnessItem[] => {
      const o = choice.get(`${id}\u0000${item.id}`);
      if (o === undefined || o.mode === 'inherit') return [item];
      if (o.mode === 'hide') return [];
      const replacement = o.replacementItemId === undefined ? undefined : byId.get(o.replacementItemId);
      return [replacement ?? item];
    });
    return [...inherited, ...world.items.filter(i => i.scopeId === id)];
  };
  const seenIds = new Set<string>();
  return walk(scopeId, new Set()).filter(i => (seenIds.has(i.id) ? false : (seenIds.add(i.id), true)));
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
