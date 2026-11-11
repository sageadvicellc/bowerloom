/**
 * The local calls, handed down the tree like the engine calls (renderer/harness/engine.tsx). The sample launch gets the in-memory sample bridge (shared/local-models/sample.ts) and says so on the screen;
 * the launch on the person's own folders gets the bridge of its preload, or null when the window has none. The page reaches the engine only through this bridge, from renderer/api/client.ts.
 */
import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { LocalBridge } from '../../../shared/api/local.js';

export interface LocalValue { readonly bridge: LocalBridge | null; readonly sample: boolean }
const Context = createContext<LocalValue>({ bridge: null, sample: false });

export function LocalProvider({ bridge, sample, children }: { bridge: LocalBridge | null; sample: boolean; children?: ReactNode }): ReactElement {
  return <Context value={{ bridge, sample }}>{children}</Context>;
}

export const useLocal = (): LocalValue => useContext(Context);
