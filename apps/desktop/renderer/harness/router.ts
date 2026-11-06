/**
 * The hash router of the preview. The page address is the route (shared/harness/route.ts). An address that is not the preview's own (the skip link's #main) leaves the page as it is.
 */
import { useEffect, useState } from 'react';
import { baseOf, formatRoute, parseRoute } from '../../shared/harness/route.js';
import type { Route } from '../../shared/harness/route.js';

/**
 * A screen that must ask before the person leaves it (the Builder, with unsaved changes: "Discard N changes?"). Given the route `go` was asked for and the
 * move itself, it answers true when it holds the move (and runs `proceed` later, if the person agrees), or false to let it go now. One screen holds it at a time.
 */
export type LeaveGuard = (next: Route, proceed: () => void) => boolean;
let guard: LeaveGuard | null = null;
/** Sets the guard, and gives back the call that takes it away again (only while it is still this guard). */
export function setLeaveGuard(next: LeaveGuard): () => void {
  guard = next;
  return () => { if (guard === next) guard = null; };
}

/** Goes to a route: the address changes, and every screen that reads the route draws again. A screen's leave guard may hold the move first. */
export function go(route: Route): void {
  // The page keeps the address it was opened on, so a reload opens the same launch (sample or real).
  const proceed = (): void => {
    const hash = formatRoute(route, baseOf(location.hash));
    if (location.hash !== hash) location.hash = hash;
  };
  if (guard !== null && guard(route, proceed)) return;
  proceed();
}

/** The route the address names now. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash) ?? { name: 'welcome' });
  useEffect(() => {
    const change = (): void => setRoute(current => parseRoute(location.hash) ?? current);
    window.addEventListener('hashchange', change);
    change();
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}
