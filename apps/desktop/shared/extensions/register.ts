/**
 * The two ways to put extensions in a registry. registerDefaults registers the six defaults and throws on any refusal, because a failed default is a bug in the app.
 * registerLoaded registers extensions that came from outside the code (the bundle loader) and never lets one take a name the defaults own.
 * The order does not matter: a loaded extension is refused RESERVED for a default id or route whether or not the defaults are registered yet. Pure code.
 */

import { DEFAULT_EXTENSIONS, BASE_ROUTES, DEFAULT_IDS } from './defaults.js';
import type { DefaultId } from './defaults.js';
import { checkManifest, refuse } from './manifest.js';
import type { Registry } from './registry.js';
import type { Answer, ExtensionManifest } from './types.js';

const RESERVED_NAMES: ReadonlySet<string> = new Set<string>([...DEFAULT_IDS, ...BASE_ROUTES]);

/**
 * Registers the six default extensions. Throws a plain Error naming the extension id and the refusal code on the first refusal (a second call, or a route already taken).
 * The defaults before the refused one stay registered, and they are protected: the throw is a stop, not an undo.
 */
export function registerDefaults(registry: Registry<unknown>): void;
export function registerDefaults<M>(registry: Registry<M>, mountOf: (id: DefaultId) => M): void;
export function registerDefaults<M>(registry: Registry<M>, mountOf?: (id: DefaultId) => M): void {
  for (const manifest of DEFAULT_EXTENSIONS) {
    const answer = registry.register(manifest, mountOf === undefined ? (undefined as M) : mountOf(manifest.id as DefaultId));
    if (!answer.ok) throw new Error(`The default extension "${manifest.id}" was refused (${answer.refusal.code}): ${answer.refusal.message}`);
  }
}

/**
 * Registers extensions from a loaded source, one answer per input, in order. Refuses RESERVED for a manifest whose id or route is a default id or a default route,
 * and for one that says protected: true. A value that is not a manifest is BAD_MANIFEST. Never throws for a bad manifest.
 */
export function registerLoaded(registry: Registry<unknown>, manifests: readonly unknown[]): Answer<ExtensionManifest>[];
export function registerLoaded<M>(registry: Registry<M>, manifests: readonly unknown[], mountOf: (manifest: ExtensionManifest) => M): Answer<ExtensionManifest>[];
export function registerLoaded<M>(registry: Registry<M>, manifests: readonly unknown[], mountOf?: (manifest: ExtensionManifest) => M): Answer<ExtensionManifest>[] {
  return manifests.map(value => {
    const checked = checkManifest(value);
    if (!checked.ok) return checked;
    const m = checked.value;
    if (RESERVED_NAMES.has(m.id)) return refuse('RESERVED', `The name "${m.id}" belongs to the app and cannot be the id of a loaded extension.`);
    const route = m.routes.find(r => RESERVED_NAMES.has(r));
    if (route !== undefined) return refuse('RESERVED', `The route "${route}" belongs to the app and cannot be taken by a loaded extension.`);
    if (m.protected) return refuse('RESERVED', `The extension "${m.id}" is loaded from outside the app, so it cannot be protected.`);
    return registry.register(m, mountOf === undefined ? (undefined as M) : mountOf(m));
  });
}
