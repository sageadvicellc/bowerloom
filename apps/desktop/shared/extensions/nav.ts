/**
 * How a stock extension that has no route of its own in the Route union is reached (v0.9). Its address is `#app/extension/<route>`, where `<route>` is one of the routes its manifest lists.
 * The registry decides who owns the route: a route that no extension owns shows the named not-found state. Pure code: no electron, no node: module and no file.
 */
import type { ExtensionManifest } from './types.js';
import type { Route } from '../harness/route.js';

/** The route of an extension's first listed route. The navigation opens it. */
export function extensionRouteOf(manifest: ExtensionManifest): Extract<Route, { name: 'extension' }> {
  return { name: 'extension', route: manifest.routes[0]! };
}

/** The key of the navigation item of an extension route. It starts with `ext:`, so it never equals the key of a base route. */
export const extensionNavKey = (route: string): `ext:${string}` => `ext:${route}`;
