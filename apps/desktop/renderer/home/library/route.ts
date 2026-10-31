/**
 * The route of the Library test page, in one place so the shell can wire it with one line each:
 *   in mount.tsx: `import { LIBRARY_HASH, LibraryHarness } from './library/route.js';`
 *   in `HomePage`: add `'library'`; in `pageOf`: `if (hash === LIBRARY_HASH) return 'library';`; in HomeRoot: `if (page === 'library') return <LibraryHarness />;`
 * To put the Library inside the app itself, render `<LibraryPage />` (below) in the shell's `hm-root`, between the top bar and the Save bar, inside
 * `WorldProvider`, and give the shell's world `withLibrarySamples` (the Library's sample pieces). `libraryChangeCount`, `libraryChangeList` and `librarySentence`
 * are the Save bar's helpers for a screen that shows the Library. The test page keeps its own store and sample world, so it needs no provider from the shell.
 */
export { LibraryHarness } from './LibraryHarness.js';
export { LibraryPage } from './LibraryPage.js';
export type { LibraryPageProps } from './LibraryPage.js';
export { withLibrarySamples } from '../../../shared/home/library-sample.js';
export { libraryChangeCount, libraryChangeList, librarySentence } from '../../../shared/home/library-changes.js';

/** The address of the test page. */
export const LIBRARY_HASH = '#prototype-v2/library';
