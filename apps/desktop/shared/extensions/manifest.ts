/** The manifest check: the one place that decides whether a value is an extension manifest. Pure code. */

import { EXTENSION_KINDS } from './types.js';
import type { Answer, ExtensionManifest, Refusal } from './types.js';

/** A name for an id or a route: lowercase letters, digits and hyphens, starting with a letter or digit. Short enough to show. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TITLE_MAX = 120;
const ROUTES_MAX = 64;

/** A refusal in the engine's shape. The code is an ExtensionCode, or a loader code (main/extension-loader.ts). */
export function refuse(code: string, message: string): { readonly ok: false; readonly refusal: Refusal } {
  return { ok: false, refusal: { code, message, paths: [] } };
}

const bad = (why: string): { readonly ok: false; readonly refusal: Refusal } => refuse('BAD_MANIFEST', `This extension manifest is not valid: ${why}.`);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks a value and returns a frozen copy of the manifest, or BAD_MANIFEST. Fields beyond the five are dropped. */
export function checkManifest(value: unknown): Answer<ExtensionManifest> {
  if (!isRecord(value)) return bad('it is not an object');
  const { id, title, kind, routes } = value;
  if (typeof id !== 'string' || !NAME.test(id)) return bad('id must be lowercase letters, digits and hyphens');
  if (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_MAX) return bad('title must be a short, non-empty text');
  if (typeof kind !== 'string' || !(EXTENSION_KINDS as readonly string[]).includes(kind)) return bad('kind must be "ui"');
  if (!Array.isArray(routes) || routes.length === 0 || routes.length > ROUTES_MAX) return bad('routes must be a non-empty list');
  const seen = new Set<string>();
  for (const route of routes as unknown[]) {
    if (typeof route !== 'string' || !NAME.test(route)) return bad('each route must be a name of lowercase letters, digits and hyphens');
    if (seen.has(route)) return bad(`route "${route}" is listed twice`);
    seen.add(route);
  }
  if (typeof value.protected !== 'boolean') return bad('protected must be true or false');
  return { ok: true, value: Object.freeze({ id, title, kind: kind as ExtensionManifest['kind'], routes: Object.freeze([...seen]), protected: value.protected }) };
}
