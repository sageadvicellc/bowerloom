/**
 * What the screens of the shell need to know about real mode, without props through every layer: whether the setup on show is the person's own (`useRealFlow` is not null),
 * and the one way a result gets in (`addResult`: the root merges it into the world and tells the plain layer). In sample mode there is no provider, and every screen behaves as it
 * always has.
 */
import { createContext, useContext } from 'react';
import type { RealResult } from '../../../shared/real/types.js';

export interface RealFlowValue {
  /** A read of some places came back: put its world beside what is already there. */
  addResult(result: RealResult): void;
}

const RealFlowContext = createContext<RealFlowValue | null>(null);

export const RealFlowProvider = RealFlowContext.Provider;

/** The real-mode helpers, or null when the shell shows the made-up sample. */
export const useRealFlow = (): RealFlowValue | null => useContext(RealFlowContext);
