/**
 * Puts the 0.8 home app into the page. Called once, when the page address starts with #prototype-v2. The address picks the page: #prototype-v2 is the app (Welcome first), #prototype-v2/map is the map alone, #prototype-v2/map/tour is the map with the tour, #prototype-v2/readonly and #prototype-v2/map/readonly are the same two pages in read-only mode,
 * #prototype-v2/real is the app on the person's own setup (read only, see real/RealRoot.tsx: it needs the real launch command and never builds the sample world), #prototype-v2/real-harness is the bare list that the reader's own test drives,
 * #prototype-v2/kit is the kit gallery, #prototype-v2/add is the Add test page, #prototype-v2/notes is the Choose notes test page, #prototype-v2/library is the Library test page (the app itself also holds the Library, behind the switch in its top bar). It uses the same in-memory store and seeded sample world as the old prototype (plus one skill with a second copy, see sample-copies.ts, and six starter agents in place of the generated ready-made ones, see starters.ts), so nothing is written anywhere.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from '../../shared/world/store.js';
import { withStartPoint } from '../../shared/home/savebar.js';
import { withLibrarySamples } from '../../shared/home/library-sample.js';
import { withSampleCopies } from '../../shared/home/sample-copies.js';
import { withStarterAgents } from '../../shared/home/starters.js';
import { ErrorBoundary } from '../common/error-boundary.js';
import { ProtoProvider } from '../common/session.js';
import { ReadOnlyScope } from './read-only.js';
import { startOf } from '../../shared/home/route.js';
import { loadWorld } from '../common/world.js';
import { AddHarness } from './add/AddHarness.js';
import { isAppHash } from '../../shared/home/route.js';
import { HomeFlow } from './HomeFlow.js';
import { KitGallery } from './KitGallery.js';
import { NOTES_HASH, NotesHarness } from './notes/route.js';
import { LIBRARY_HASH, LibraryHarness } from './library/route.js';
import { latchRealPage, realPageOf, wireSkipLink } from './route-latch.js';
import { RealHarness } from './real/RealHarness.js';
import { RealRoot } from './real/RealRoot.js';

export type HomePage = 'app' | 'kit' | 'add' | 'notes' | 'library';

/** The page an address asks for, or null for an address that is not the home app's (the skip link's #main, say), which leaves the page as it is. */
export function pageOf(hash: string): HomePage | null {
  if (isAppHash(hash)) return 'app';
  if (hash === '#prototype-v2/kit') return 'kit';
  if (hash === '#prototype-v2/add') return 'add';
  if (hash === NOTES_HASH) return 'notes';
  if (hash === LIBRARY_HASH) return 'library';
  return null;
}

/** True when the address belongs to the home app. */
export const isHomeHash = (hash: string): boolean => hash === '#prototype-v2' || hash.startsWith('#prototype-v2/');

function HomeRoot(): ReactElement {
  const [real, setReal] = useState(() => realPageOf(location.hash));
  useEffect(() => {
    // Once the window is on a real page it stays in real mode: an address that is not a real page (the skip link's #main) changes nothing.
    const change = (): void => setReal(current => latchRealPage(current, location.hash));
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  // Real mode never reaches the sample: the sample world is built only inside SampleRoot.
  if (real === 'real') return <RealRoot />;
  if (real === 'bare') return <RealHarness />;
  return <SampleRoot />;
}

function SampleRoot(): ReactElement {
  const [store] = useState(() => createStore(withStartPoint(withLibrarySamples(withStarterAgents(withSampleCopies(loadWorld()))))));
  const [page, setPage] = useState<HomePage>(() => pageOf(location.hash) ?? 'app');
  // The address can ask for read only (#prototype-v2/readonly, #prototype-v2/map/readonly): the scope holds back every control that would change the setup.
  const [readOnly] = useState(() => startOf(location.hash).readOnly);
  useEffect(() => {
    const change = (): void => { const next = pageOf(location.hash); if (next !== null) setPage(next); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (page === 'add') return <AddHarness />;
  if (page === 'notes') return <NotesHarness />;
  if (page === 'library') return <LibraryHarness />;
  if (page === 'kit') return <ProtoProvider store={store}><KitGallery /></ProtoProvider>;
  return <ReadOnlyScope readOnly={readOnly} store={store}><HomeFlow /></ReadOnlyScope>;
}

export function mountHome(root: HTMLElement): void {
  wireSkipLink(document);
  createRoot(root).render(<ErrorBoundary><HomeRoot /></ErrorBoundary>);
}
