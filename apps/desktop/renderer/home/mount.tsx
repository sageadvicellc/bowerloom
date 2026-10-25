/**
 * Puts the 0.8 home app into the page. Called once, when the page address starts with #prototype-v2. The address picks the page: #prototype-v2 is the app,
 * #prototype-v2/kit is the kit gallery. It uses the same in-memory store and sample world as the old prototype, so nothing is written anywhere.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from '../../shared/proto/store.js';
import { ErrorBoundary } from '../proto/error-boundary.js';
import { ProtoProvider } from '../proto/session.js';
import { loadWorld } from '../proto/world.js';
import { HomeApp } from './HomeApp.js';
import { KitGallery } from './KitGallery.js';

export type HomePage = 'app' | 'kit';

/** The page an address asks for, or null for an address that is not the home app's (the skip link's #main, say), which leaves the page as it is. */
export function pageOf(hash: string): HomePage | null {
  if (hash === '#prototype-v2' || hash === '#prototype-v2/') return 'app';
  if (hash === '#prototype-v2/kit') return 'kit';
  return null;
}

/** True when the address belongs to the home app. */
export const isHomeHash = (hash: string): boolean => hash === '#prototype-v2' || hash.startsWith('#prototype-v2/');

function HomeRoot(): ReactElement {
  const [store] = useState(() => createStore(loadWorld()));
  const [page, setPage] = useState<HomePage>(() => pageOf(location.hash) ?? 'app');
  useEffect(() => {
    const change = (): void => { const next = pageOf(location.hash); if (next !== null) setPage(next); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return <ProtoProvider store={store}>{page === 'kit' ? <KitGallery /> : <HomeApp />}</ProtoProvider>;
}

export function mountHome(root: HTMLElement): void {
  createRoot(root).render(<ErrorBoundary><HomeRoot /></ErrorBoundary>);
}
