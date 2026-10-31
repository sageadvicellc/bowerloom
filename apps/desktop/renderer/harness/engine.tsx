/**
 * The engine calls, handed down the tree. The sample launch gets the in-memory sample (shared/engine/sample.ts); the launch on the person's own folders gets
 * the bridge of its preload, or null when the window has none, and the sheets then say so instead of falling back to the sample.
 */
import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { EngineBridge } from '../../shared/engine/types.js';

const Context = createContext<EngineBridge | null>(null);

export function EngineProvider({ engine, children }: { engine: EngineBridge | null; children?: ReactNode }): ReactElement {
  return <Context value={engine}>{children}</Context>;
}

/** The engine calls, or null when this window has none. */
export function useEngine(): EngineBridge | null {
  return useContext(Context);
}
