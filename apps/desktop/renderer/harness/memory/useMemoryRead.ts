/**
 * The read of the approved folders of the Memory module, held as state. It reads when the list of folders changes or when the person presses Refresh, and never writes. A read that ends after the list changed,
 * or after the screen left, is ignored. A read that fails outside every call is a failed state with a code, never a screen that says "Reading" for ever. The steps are in shared/memory/read-flow.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModulePlace, ModulesBridge } from '../../../shared/api/modules.js';
import { MEMORY_MODULE_ID, readAllMemory } from '../../../shared/memory/read-flow.js';
import type { MemoryState } from '../../../shared/memory/read-flow.js';

const IDLE: MemoryState = { status: 'idle', places: [], code: null };

export function useMemoryRead(bridge: ModulesBridge | null, places: readonly ModulePlace[], ready: boolean): MemoryState & { refresh(): void } {
  const [state, setState] = useState<MemoryState>(IDLE);
  const [round, setRound] = useState(0);
  const turn = useRef(0);
  const key = places.map(p => p.id).join(',');
  useEffect(() => {
    const mine = ++turn.current;
    if (bridge === null || !ready || places.length === 0) { setState(IDLE); return undefined; }
    setState(s => ({ status: 'loading', places: s.places, code: null }));
    readAllMemory(bridge, MEMORY_MODULE_ID, places).then(
      done => { if (turn.current === mine) setState({ status: 'ready', places: done, code: null }); },
      () => { if (turn.current === mine) setState({ status: 'failed', places: [], code: 'FAILED' }); },
    );
    return () => { turn.current += 1; };
  }, [bridge, ready, key, round]);
  const refresh = useCallback((): void => { setRound(n => n + 1); }, []);
  return { ...state, refresh };
}
