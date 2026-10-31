/**
 * The addresses of the harness-first preview. The page address is the router: `#sample/builder/folder-2` is the Builder, on the folder main calls `folder-2`.
 * Pure: a route is plain data, and `parseRoute` and `formatRoute` go both ways. An address that is not the preview's own (the skip link's `#main`) parses to null, which leaves the page as it is.
 */
import type { PartKind } from './types.js';
import { PART_KINDS } from './types.js';

export const BASE = '#sample';
/** The address of the launch on the person's own folders (the default launch). The page is told its mode by this address, never by whether a bridge is there. */
export const REAL_BASE = '#app';

export type Route =
  | { readonly name: 'welcome' }
  | { readonly name: 'choose' }
  | { readonly name: 'read' }
  /** The notes step of the first run: "Where do you keep your notes?" */
  | { readonly name: 'notes' }
  | { readonly name: 'harnesses'; readonly id?: string }
  /** The Builder of one folder's harness, by the id main gave the folder. An id main does not know (after a new start) shows the folder list. */
  | { readonly name: 'builder'; readonly id: string }
  | { readonly name: 'file'; readonly partId: string }
  | { readonly name: 'library'; readonly kind: PartKind; readonly partId?: string }
  | { readonly name: 'projects'; readonly id?: string }
  | { readonly name: 'runs'; readonly id?: string }
  | { readonly name: 'compare'; readonly group: string }
  | { readonly name: 'interfaces'; readonly id?: string }
  | { readonly name: 'history' }
  | { readonly name: 'help' };

export type RouteName = Route['name'];

const under = (hash: string, base: string): boolean => hash === base || hash.startsWith(`${base}/`);
/** True for an address that belongs to the preview, in either launch. */
export const isHarnessHash = (hash: string): boolean => under(hash, BASE) || under(hash, REAL_BASE);
/** True for the address of the launch on the person's own folders. */
export const isRealHash = (hash: string): boolean => under(hash, REAL_BASE);
/** The base an address was opened on: the page keeps it when it moves, so a reload opens the same launch. */
export const baseOf = (hash: string): string => (isRealHash(hash) ? REAL_BASE : BASE);

/** The screens before the app: they have no navigation. */
export const FIRST_RUN: readonly RouteName[] = Object.freeze(['welcome', 'choose', 'read', 'notes']);
export const isFirstRun = (route: Route): boolean => FIRST_RUN.includes(route.name);

const clean = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') return undefined;
  try { const text = decodeURIComponent(value); return /^[A-Za-z0-9._-]{1,120}$/.test(text) ? text : undefined; } catch { return undefined; }
};
/**
 * The ids the Builder opens: `folder-<n>` from main, and `sample-<name>` from the sample launch. Any other id (a name like `__proto__`, or one a person typed)
 * opens the folder list instead.
 */
const BUILDER_ID = /^(?:folder-[0-9]{1,6}|sample-[a-z]+(?:-[a-z]+){0,4})$/;
const isKind = (value: string | undefined): value is PartKind => value !== undefined && (PART_KINDS as readonly string[]).includes(value);

/** The route an address names, or null when the address is not the preview's own. An unknown page under the preview's address is the Harness list. */
export function parseRoute(hash: string): Route | null {
  if (!isHarnessHash(hash)) return null;
  const [name, a, b] = hash.slice(baseOf(hash).length).split('/').filter((part, i) => i > 0 || part !== '');
  const id = clean(a);
  switch (name) {
    case undefined: case '': return { name: 'welcome' };
    case 'choose': return { name: 'choose' };
    case 'read': return { name: 'read' };
    case 'notes': return { name: 'notes' };
    case 'harnesses': return id === undefined ? { name: 'harnesses' } : { name: 'harnesses', id };
    // An older address with a view after the id still opens the folder.
    case 'builder': return id === undefined || !BUILDER_ID.test(id) ? { name: 'harnesses' } : { name: 'builder', id };
    case 'file': return id === undefined ? { name: 'harnesses' } : { name: 'file', partId: id };
    case 'library': {
      const kind = isKind(a) ? a : 'skill', partId = clean(b);
      return partId === undefined ? { name: 'library', kind } : { name: 'library', kind, partId };
    }
    case 'projects': return id === undefined ? { name: 'projects' } : { name: 'projects', id };
    case 'runs': return id === undefined ? { name: 'runs' } : { name: 'runs', id };
    case 'compare': return id === undefined ? { name: 'runs' } : { name: 'compare', group: id };
    case 'interfaces': return id === undefined ? { name: 'interfaces' } : { name: 'interfaces', id };
    case 'history': return { name: 'history' };
    case 'help': return { name: 'help' };
    default: return { name: 'harnesses' };
  }
}

const seg = (value: string): string => encodeURIComponent(value);

/** The address of a route, on the base the page was opened on. */
export function formatRoute(route: Route, base: string = BASE): string {
  switch (route.name) {
    case 'welcome': return base;
    case 'choose': case 'read': case 'notes': case 'history': case 'help': return `${base}/${route.name}`;
    case 'harnesses': case 'projects': case 'runs': case 'interfaces': return route.id === undefined ? `${base}/${route.name}` : `${base}/${route.name}/${seg(route.id)}`;
    case 'builder': return `${base}/builder/${seg(route.id)}`;
    case 'file': return `${base}/file/${seg(route.partId)}`;
    case 'library': return route.partId === undefined ? `${base}/library/${route.kind}` : `${base}/library/${route.kind}/${seg(route.partId)}`;
    case 'compare': return `${base}/compare/${seg(route.group)}`;
  }
}

/** Which item of the navigation a route belongs to. The builder and the file view belong to the place they were opened from. */
export type NavKey = 'harnesses' | 'library' | 'library-agent' | 'library-skill' | 'library-tool' | 'library-context' | 'projects' | 'runs' | 'interfaces' | 'history' | 'help';
export function navKeyOf(route: Route): NavKey | null {
  switch (route.name) {
    case 'harnesses': case 'builder': return 'harnesses';
    case 'file': case 'library': return route.name === 'library' ? `library-${route.kind}` : 'library';
    case 'projects': return 'projects';
    case 'runs': case 'compare': return 'runs';
    case 'interfaces': return 'interfaces';
    case 'history': return 'history';
    case 'help': return 'help';
    default: return null;
  }
}
