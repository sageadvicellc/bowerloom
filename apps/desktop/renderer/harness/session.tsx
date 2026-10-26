/**
 * The store of the preview, handed down the tree. The store lives as long as the window: a new launch starts from the sample again, and nothing is kept anywhere.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { HarnessStore } from '../../shared/harness/store.js';
import type { HarnessState } from '../../shared/harness/types.js';

const Context = createContext<HarnessStore | null>(null);

export function HarnessProvider({ store, children }: { store: HarnessStore; children?: ReactNode }): ReactElement {
  return <Context value={store}>{children}</Context>;
}

/** The store, for a screen that changes something. */
export function useHarnessStore(): HarnessStore {
  const store = useContext(Context);
  if (store === null) throw new Error('The harness store is missing. Draw the screen inside HarnessProvider.');
  return store;
}

/** The current world. The screen draws again when it changes. */
export function useHarnessState(): HarnessState {
  const store = useHarnessStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
