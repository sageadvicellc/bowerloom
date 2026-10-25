/**
 * A store that can also stage a shared file. The prototype store has no action for "add what this file holds to the draft", and the 0.8 Add drawer needs
 * one. Until the store itself gets an action, this wraps it: every ordinary action goes to `reduceStore` unchanged, and `stageBundle` adds the bundle's items
 * to the draft the way any other draft change does (one step on the undo stack, nothing committed). The reducer part is pure and tested on its own.
 */
import { commitImport } from '../proto/bundle.js';
import { createStore, reduceStore } from '../proto/store.js';
import type { Store, StoreAction, StoreState } from '../proto/store.js';
import type { Bundle, World } from '../proto/types.js';

/** The most earlier drafts the undo stack keeps (the same cap as the store). */
const MAX_UNDO = 100;

/** The state after adding a bundle to the draft. The very same state comes back when the bundle adds nothing. */
export function stageBundle(state: StoreState, bundle: Bundle): StoreState {
  const draft = commitImport(bundle, state.draft);
  if (draft === state.draft) return state;
  return { ...state, draft, undoStack: [...state.undoStack, state.draft].slice(-MAX_UNDO), redoStack: [] };
}

/** A store with one more way in. It still is a `Store`, so every screen that reads the session works with it. */
export interface AddStore extends Store { stageBundle(bundle: Bundle): void }

/** Makes a store around `world`. Nothing is written anywhere. */
export function createAddStore(world: World): AddStore {
  const inner = createStore(world);
  let state: StoreState = inner.getState();
  const listeners = new Set<() => void>();
  const set = (next: StoreState): void => { if (next === state) return; state = next; for (const l of [...listeners]) l(); };
  return {
    getState: () => state,
    dispatch(action: StoreAction) { set(reduceStore(state, action)); },
    stageBundle(bundle: Bundle) { set(stageBundle(state, bundle)); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
