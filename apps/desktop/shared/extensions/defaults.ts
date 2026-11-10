/**
 * The default extensions: the six work areas of v0.9. Each is protected, and together they own the 15 base routes of the harness app, one owner each.
 * This file mounts no screen. The harness app registers a screen mount for each id (renderer/harness/extension-mounts.tsx).
 */

import type { RouteName } from '../harness/route.js';
import { checkManifest } from './manifest.js';
import type { ExtensionManifest } from './types.js';

/** The ids of the six work areas, in the order the app shows them. */
export const DEFAULT_IDS = Object.freeze(['overview', 'harnesses', 'library', 'projects', 'interfaces-history-help', 'first-run'] as const);
export type DefaultId = (typeof DEFAULT_IDS)[number];

/**
 * The owner of every route. The type is Record<RouteName, DefaultId>, so a new member of the Route union (shared/harness/route.ts) is a type error here
 * until it has an owner. An extra key that is not a route is not a type error: tests/extensions-registry.test.ts catches it by comparing BASE_ROUTES with the 15 expected routes.
 * The key order is the order of the base routes.
 */
export const ROUTE_OWNERS: Readonly<Record<RouteName, DefaultId>> = Object.freeze({
  welcome: 'first-run',
  choose: 'first-run',
  read: 'first-run',
  notes: 'first-run',
  overview: 'overview',
  harnesses: 'harnesses',
  builder: 'harnesses',
  file: 'harnesses',
  library: 'library',
  projects: 'projects',
  runs: 'projects',
  compare: 'projects',
  interfaces: 'interfaces-history-help',
  history: 'interfaces-history-help',
  help: 'interfaces-history-help',
});

/** The 15 base routes of the harness app (RouteName in shared/harness/route.ts), taken from the owner table. */
export const BASE_ROUTES: readonly RouteName[] = Object.freeze(Object.keys(ROUTE_OWNERS) as RouteName[]);

const TITLES: Readonly<Record<DefaultId, string>> = Object.freeze({
  overview: 'Overview',
  harnesses: 'Harnesses',
  library: 'Library',
  projects: 'Projects',
  'interfaces-history-help': 'Interfaces, history and help',
  'first-run': 'First run',
});

/** The six default manifests, each checked and frozen. The routes of each come from the owner table. */
export const DEFAULT_EXTENSIONS: readonly ExtensionManifest[] = Object.freeze(DEFAULT_IDS.map(id => {
  const checked = checkManifest({ id, title: TITLES[id], kind: 'ui', routes: BASE_ROUTES.filter(route => ROUTE_OWNERS[route] === id), protected: true });
  if (!checked.ok) throw new Error(`The default extension "${id}" is not valid: ${checked.refusal.message}`);
  return checked.value;
}));
