/**
 * The read of the approved folders of the Memory module, held as state. It reads when the list of folders changes, and never writes. A read that ends after the list changed, or after the screen left, is ignored.
 * The steps are in shared/memory/read-flow.ts; this hook only holds their state.
 */
import { useEffect, useRef, useState } from 'react';
import type { ModulePlace, ModulesBridge } from '../../../shared/api/modules.js';
import { MEMORY_MODULE_ID, readAllMemory } from '../../../shared/memory/read-flow.js';
import type { MemoryState } from '../../../shared/memory/read-flow.js';

const IDLE: MemoryState = { status: 'idle', places: [] };

export function useMemoryRead(bridge: ModulesBridge | null, places: readonly ModulePlace[], ready: boolean): MemoryState {
  const [state, setState] = useState<MemoryState>(IDLE);
  const turn = useRef(0);
  const key = places.map(p => p.id).join(',');
  useEffect(() => {
    const mine = ++turn.current;
    if (bridge === null || !ready || places.length === 0) { setState(IDLE); return undefined; }
    setState(s => ({ status: 'loading', places: s.places }));
    void readAllMemory(bridge, MEMORY_MODULE_ID, places).then(done => { if (turn.current === mine) setState({ status: 'ready', places: done }); });
    return () => { turn.current += 1; };
    // The folders are the key: a new object with the same ids is the same read.
  }, [bridge, ready, key]);
  return state;
}
