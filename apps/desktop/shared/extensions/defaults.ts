/**
 * The default extensions: the six work areas of v0.9. Each is protected, and together they own the 15 base routes of the harness app, one owner each.
 * This file mounts no screen. A later change registers a mount for each id.
 */

import type { RouteName } from '../harness/route.js';
import { checkManifest } from './manifest.js';
import type { ExtensionManifest } from './types.js';

/** The 15 base routes of the harness app (RouteName in shared/harness/route.ts). */
export const BASE_ROUTES: readonly RouteName[] = Object.freeze(['welcome', 'choose', 'read', 'notes', 'overview', 'harnesses', 'builder', 'file', 'library', 'projects', 'runs', 'compare', 'interfaces', 'history', 'help'] as const);

/** The ids of the six work areas, in the order the app shows them. */
export const DEFAULT_IDS = Object.freeze(['overview', 'harnesses', 'library', 'projects', 'interfaces-history-help', 'first-run'] as const);
export type DefaultId = (typeof DEFAULT_IDS)[number];

const AREAS: readonly { readonly id: DefaultId; readonly title: string; readonly routes: readonly RouteName[] }[] = [
  { id: 'overview', title: 'Overview', routes: ['overview'] },
  { id: 'harnesses', title: 'Harnesses', routes: ['harnesses', 'builder', 'file'] },
  { id: 'library', title: 'Library', routes: ['library'] },
  { id: 'projects', title: 'Projects', routes: ['projects', 'runs', 'compare'] },
  { id: 'interfaces-history-help', title: 'Interfaces, history and help', routes: ['interfaces', 'history', 'help'] },
  { id: 'first-run', title: 'First run', routes: ['welcome', 'choose', 'read', 'notes'] },
];

/** The six default manifests, each checked and frozen. */
export const DEFAULT_EXTENSIONS: readonly ExtensionManifest[] = Object.freeze(AREAS.map(area => {
  const checked = checkManifest({ ...area, kind: 'ui', protected: true });
  if (!checked.ok) throw new Error(`The default extension "${area.id}" is not valid: ${checked.refusal.message}`);
  return checked.value;
}));
