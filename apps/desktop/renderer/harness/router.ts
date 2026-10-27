/**
 * The hash router of the preview. The page address is the route (shared/harness/route.ts). An address that is not the preview's own (the skip link's #main) leaves the page as it is.
 */
import { useEffect, useState } from 'react';
import { baseOf, formatRoute, parseRoute } from '../../shared/harness/route.js';
import type { Route } from '../../shared/harness/route.js';

/** Goes to a route: the address changes, and every screen that reads the route draws again. */
export function go(route: Route): void {
  // The page keeps the address it was opened on, so a reload opens the same launch (sample or real).
  const hash = formatRoute(route, baseOf(location.hash));
  if (location.hash !== hash) location.hash = hash;
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
