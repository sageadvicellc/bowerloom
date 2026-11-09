/**
 * The extension mechanism of v0.9, as plain data. An extension is a manifest plus a mount, and the registry (registry.ts) is the only route table.
 * This folder is pure code: it imports no electron, no node: module and no file. Answers use the engine's Answer and Refusal shapes.
 */

import type { Answer, Refusal } from '../engine/types.js';
export type { Answer, Refusal };

/** The only kind of extension there is. A UI extension owns routes. */
export const EXTENSION_KINDS = Object.freeze(['ui'] as const);
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** What an extension says about itself. `routes` are the route names it owns. A protected extension cannot be uninstalled. */
export interface ExtensionManifest {
  readonly id: string;
  readonly title: string;
  readonly kind: ExtensionKind;
  readonly routes: readonly string[];
  readonly protected: boolean;
}

/** The refusal codes of the extension mechanism. */
export const EXTENSION_CODES = Object.freeze(['PROTECTED', 'UNKNOWN_EXTENSION', 'BAD_MANIFEST', 'ROUTE_TAKEN', 'EXTENSION_EXISTS', 'RESERVED', 'MOUNT_FAILED'] as const);
export type ExtensionCode = (typeof EXTENSION_CODES)[number];

/** The answer of resolve when a route has an owner: the mount it registered. */
export interface RouteFound<M> { readonly found: true; readonly id: string; readonly mount: M }
/** The answer of resolve when nothing owns the route. A named result, never an error and never blank. */
export interface RouteNotFound { readonly found: false; readonly code: 'ROUTE_NOT_FOUND'; readonly route: string }
export type RouteResolution<M> = RouteFound<M> | RouteNotFound;
