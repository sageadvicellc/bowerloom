/**
 * The prototype session: one in-memory store, shared by every screen through React context. A screen reads the state and sends actions here
 * and nowhere else. Nothing leaves memory: a restart builds a fresh store from the sample world.
 */
import { createContext, createElement, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Store, StoreAction, StoreState } from '../../shared/proto/store.js';

const StoreContext = createContext<Store | null>(null);

/** Gives every screen below it the same store. */
export function ProtoProvider({ store, children }: { store: Store; children?: ReactNode }) {
  return createElement(StoreContext.Provider, { value: store }, children);
}

/** What a screen sees of the session: the current state and the way to change it. */
export interface ProtoSession { readonly state: StoreState; dispatch(action: StoreAction): void }

/** The words of the error `useProtoStore` throws when there is no provider. */
export const MISSING_SESSION_MESSAGE = 'This screen needs the prototype session. Wrap it in ProtoProvider.';

/** True for that error and no other. A caller that wants to carry on without a session catches this one only. */
export const isMissingSession = (error: unknown): boolean => error instanceof Error && error.message === MISSING_SESSION_MESSAGE;

/** The state of the store, kept up to date as it changes, plus `dispatch`. Throws in plain words when there is no provider. */
export function useProtoStore(): ProtoSession {
  const store = useContext(StoreContext);
  if (store === null) throw new Error(MISSING_SESSION_MESSAGE);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { state, dispatch: store.dispatch };
}
