/**
 * Puts the 0.8 home app into the page. Called once, when the page address starts with #prototype-v2. The address picks the page: #prototype-v2 is the app (Welcome first), #prototype-v2/map is the map alone, #prototype-v2/map/tour is the map with the tour,
 * #prototype-v2/kit is the kit gallery, #prototype-v2/add is the Add test page, #prototype-v2/notes is the Choose notes test page. It uses the same in-memory store and seeded sample world as the old prototype (plus one skill with a second copy, see sample-copies.ts), so nothing is written anywhere.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from '../../shared/proto/store.js';
import { withStartPoint } from '../../shared/home/savebar.js';
import { withSampleCopies } from '../../shared/home/sample-copies.js';
import { ErrorBoundary } from '../proto/error-boundary.js';
import { ProtoProvider } from '../proto/session.js';
import { loadWorld } from '../proto/world.js';
import { AddHarness } from './add/AddHarness.js';
import { isAppHash } from '../../shared/home/route.js';
import { HomeFlow } from './HomeFlow.js';
import { KitGallery } from './KitGallery.js';
import { NOTES_HASH, NotesHarness } from './notes/route.js';

export type HomePage = 'app' | 'kit' | 'add' | 'notes';

/** The page an address asks for, or null for an address that is not the home app's (the skip link's #main, say), which leaves the page as it is. */
export function pageOf(hash: string): HomePage | null {
  if (isAppHash(hash)) return 'app';
  if (hash === '#prototype-v2/kit') return 'kit';
  if (hash === '#prototype-v2/add') return 'add';
  if (hash === NOTES_HASH) return 'notes';
  return null;
}

/** True when the address belongs to the home app. */
export const isHomeHash = (hash: string): boolean => hash === '#prototype-v2' || hash.startsWith('#prototype-v2/');

function HomeRoot(): ReactElement {
  const [store] = useState(() => createStore(withStartPoint(withSampleCopies(loadWorld()))));
  const [page, setPage] = useState<HomePage>(() => pageOf(location.hash) ?? 'app');
  useEffect(() => {
    const change = (): void => { const next = pageOf(location.hash); if (next !== null) setPage(next); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (page === 'add') return <AddHarness />;
  if (page === 'notes') return <NotesHarness />;
  return <ProtoProvider store={store}>{page === 'kit' ? <KitGallery /> : <HomeFlow />}</ProtoProvider>;
}

export function mountHome(root: HTMLElement): void {
  createRoot(root).render(<ErrorBoundary><HomeRoot /></ErrorBoundary>);
}
