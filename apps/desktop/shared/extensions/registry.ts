/**
 * The registry is the only route table. A route has one owner. resolve answers with the owner's mount or with a named not-found result.
 * An extension that is protected cannot be uninstalled. Pure code: the mount is whatever the caller registers (a screen, later).
 */

import { checkManifest, refuse } from './manifest.js';
import type { Answer, ExtensionManifest, RouteResolution } from './types.js';

export interface Registry<M = unknown> {
  /** Checks the manifest, then registers it with its mount. Refuses BAD_MANIFEST, EXTENSION_EXISTS or ROUTE_TAKEN, and then registers nothing. */
  register(manifest: unknown, mount: M): Answer<ExtensionManifest>;
  /** Removes an extension and frees its routes. Refuses PROTECTED (the extension stays) or UNKNOWN_EXTENSION. */
  uninstall(id: string): Answer<ExtensionManifest>;
  /** The mount for a route, or ROUTE_NOT_FOUND. Never throws. */
  resolve(route: string): RouteResolution<M>;
  /** Every registered manifest, in the order registered. */
  list(): readonly ExtensionManifest[];
}

export function createRegistry<M = unknown>(): Registry<M> {
  // Maps hold the data, so a name such as "__proto__" is only a key.
  const entries = new Map<string, { readonly manifest: ExtensionManifest; readonly mount: M }>();
  const owners = new Map<string, string>();

  return {
    register(manifest, mount) {
      const checked = checkManifest(manifest);
      if (!checked.ok) return checked;
      const m = checked.value;
      if (entries.has(m.id)) return refuse('EXTENSION_EXISTS', `An extension with the id "${m.id}" is already registered.`);
      for (const route of m.routes) {
        const owner = owners.get(route);
        if (owner !== undefined) return refuse('ROUTE_TAKEN', `The route "${route}" already belongs to the extension "${owner}".`);
      }
      entries.set(m.id, { manifest: m, mount });
      for (const route of m.routes) owners.set(route, m.id);
      return { ok: true, value: m };
    },
    uninstall(id) {
      const entry = typeof id === 'string' ? entries.get(id) : undefined;
      if (entry === undefined) return refuse('UNKNOWN_EXTENSION', `No extension has the id "${String(id)}".`);
      if (entry.manifest.protected) return refuse('PROTECTED', `The extension "${entry.manifest.id}" is part of the app and cannot be uninstalled.`);
      entries.delete(entry.manifest.id);
      for (const route of entry.manifest.routes) owners.delete(route);
      return { ok: true, value: entry.manifest };
    },
    resolve(route) {
      const id = typeof route === 'string' ? owners.get(route) : undefined;
      const entry = id === undefined ? undefined : entries.get(id);
      if (id === undefined || entry === undefined) return { found: false, code: 'ROUTE_NOT_FOUND', route: typeof route === 'string' ? route : String(route) };
      return { found: true, id, mount: entry.mount };
    },
    list() { return [...entries.values()].map(e => e.manifest); },
  };
}
