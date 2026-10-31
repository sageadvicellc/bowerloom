/**
 * The route of the "Choose notes" test page, in one place so the shell can wire it with one line each:
 *   in mount.tsx: `import { NOTES_HASH, NotesHarness } from './notes/route.js';`
 *   in `HomePage`: add `'notes'`; in `pageOf`: `if (hash === NOTES_HASH) return 'notes';`; in HomeRoot: `if (page === 'notes') return <NotesHarness />;`
 * The page keeps its own store and sample world, so it needs no provider from the shell.
 */
export { NotesHarness } from './NotesHarness.js';

/** The address of the test page. */
export const NOTES_HASH = '#prototype-v2/notes';
