/**
 * Where the person put the nodes of the harness graph, kept for the life of the session. The canvas keeps places only while it is on the screen
 * (and a new scope builds a new canvas), so the screen hands them back through `positions`. One list per scope. The key is the session's own
 * `dispatch` function, which is the same function for as long as the session (the store) lasts, so a restart starts with no places.
 */
import type { Positions } from '../../shared/proto/harnesslayout.js';

const kept = new WeakMap<object, Map<string, Positions>>();
const NONE: Positions = Object.freeze({});

/** The places kept for a scope. The same object comes back until the places change, so the canvas does not lay out again. */
export function positionsFor(session: object, scopeId: string): Positions {
  return kept.get(session)?.get(scopeId) ?? NONE;
}

/** Keeps the places of a scope. */
export function keepPositions(session: object, scopeId: string, places: Positions): void {
  let byScope = kept.get(session);
  if (byScope === undefined) { byScope = new Map(); kept.set(session, byScope); }
  byScope.set(scopeId, places);
}
