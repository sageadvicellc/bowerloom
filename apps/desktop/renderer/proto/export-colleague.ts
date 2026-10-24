/**
 * The second Bowerloom that journey 4 imports into (spec section 11, "Prototype rules"): its own in-memory store, built from an empty world.
 * It shares nothing with the session's store. The shell test keeps `createEmptyWorld` out of the screen files, so the screen asks for it here.
 */
import { createStore } from '../../shared/proto/store.js';
import type { Store } from '../../shared/proto/store.js';
import { createEmptyWorld } from './fakeApi.js';

/** A new colleague's Bowerloom: three interfaces, one global place, nothing else. */
export function newColleagueStore(): Store {
  return createStore(createEmptyWorld());
}
