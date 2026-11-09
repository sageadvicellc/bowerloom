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

/** The text of a thrown value that is only shown. It never throws. */
function reason(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); } catch { return 'unprintable'; }
}

/** The mount of one extension, or the text of why the mount could not be made. */
function mountFor<M>(make: () => M): { readonly ok: true; readonly mount: M } | { readonly ok: false; readonly why: string } {
  try { return { ok: true, mount: make() }; } catch (error) { return { ok: false, why: reason(error) }; }
}

/**
 * Registers the six default extensions. Throws a plain Error naming the extension id and the refusal code. It is all or nothing: every default is checked against the
 * registry (an id already there, a route already taken) and every mount is made before the first default is registered, so a throw leaves the registry as it was.
 * A Registry with a concrete mount type must be given mountOf.
 */
export function registerDefaults<M>(registry: Registry<M>, ...rest: unknown extends M ? [mountOf?: (id: DefaultId) => M] : [mountOf: (id: DefaultId) => M]): void {
  const mountOf = rest[0] as ((id: DefaultId) => M) | undefined;
  const taken = new Set(registry.list().map(m => m.id));
  for (const manifest of DEFAULT_EXTENSIONS) {
    if (taken.has(manifest.id)) throw new Error(`The default extension "${manifest.id}" was refused (EXTENSION_EXISTS): An extension with the id "${manifest.id}" is already registered.`);
    for (const route of manifest.routes) {
      const owner = registry.resolve(route);
      if (owner.found) throw new Error(`The default extension "${manifest.id}" was refused (ROUTE_TAKEN): The route "${route}" already belongs to the extension "${owner.id}".`);
    }
  }
  const mounts = DEFAULT_EXTENSIONS.map(manifest => {
    const made = mountFor(() => (mountOf === undefined ? (undefined as M) : mountOf(manifest.id as DefaultId)));
    if (!made.ok) throw new Error(`The default extension "${manifest.id}" was refused (MOUNT_FAILED): its mount could not be made (${made.why}).`);
    return made.mount;
  });
  DEFAULT_EXTENSIONS.forEach((manifest, i) => {
    const answer = registry.register(manifest, mounts[i] as M);
    if (!answer.ok) throw new Error(`The default extension "${manifest.id}" was refused (${answer.refusal.code}): ${answer.refusal.message}`);
  });
}

/**
 * Registers extensions from a loaded source, one answer per input, in order. Refuses RESERVED for a manifest whose id or route is a default id or a default route,
 * and for one that says protected: true. A value that is not a manifest is BAD_MANIFEST, and a mountOf that throws is MOUNT_FAILED for that manifest alone. Never throws for a bad manifest.
 */
export function registerLoaded<M>(registry: Registry<M>, manifests: readonly unknown[], ...rest: unknown extends M ? [mountOf?: (manifest: ExtensionManifest) => M] : [mountOf: (manifest: ExtensionManifest) => M]): Answer<ExtensionManifest>[] {
  const mountOf = rest[0] as ((manifest: ExtensionManifest) => M) | undefined;
  return manifests.map(value => {
    const checked = checkManifest(value);
    if (!checked.ok) return checked;
    const m = checked.value;
    if (RESERVED_NAMES.has(m.id)) return refuse('RESERVED', `The name "${m.id}" belongs to the app and cannot be the id of a loaded extension.`);
    const route = m.routes.find(r => RESERVED_NAMES.has(r));
    if (route !== undefined) return refuse('RESERVED', `The route "${route}" belongs to the app and cannot be taken by a loaded extension.`);
    if (m.protected) return refuse('RESERVED', `The extension "${m.id}" is loaded from outside the app, so it cannot be protected.`);
    const made = mountFor(() => (mountOf === undefined ? (undefined as M) : mountOf(m)));
    if (!made.ok) return refuse('MOUNT_FAILED', `The mount of the extension "${m.id}" could not be made (${made.why}).`);
    return registry.register(m, made.mount);
  });
}
