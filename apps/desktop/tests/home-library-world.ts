// The world the Library tests (and the Library page) start from: the home app's sample world plus the Library's own sample pieces.
import { generateWorld } from '../shared/world/sample.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { withStarterAgents } from '../shared/home/starters.js';
import { withLibrarySamples } from '../shared/home/library-sample.js';
import { createStore } from '../shared/world/store.js';
import { withStartPoint } from '../shared/home/savebar.js';
import type { StoreState } from '../shared/world/store.js';
import type { World } from '../shared/world/types.js';

export const libraryWorld = (): World => withLibrarySamples(withStarterAgents(withSampleCopies(generateWorld(1))));
export const libraryStore = () => createStore(withStartPoint(libraryWorld()));
export const stateOf = (world: World = libraryWorld()): StoreState => libraryStore().getState().committed === world ? libraryStore().getState() : { committed: world, draft: world, undoStack: [], redoStack: [], headVersionId: null };
