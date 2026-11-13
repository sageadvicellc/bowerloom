/**
 * The read of the approved folders of the Memory module, held as state. It reads when the list of folders changes or when the person presses Refresh, and never writes. The steps and the rules of a cancelled or failed read
 * are in `createMemoryReader` (shared/memory/read-flow.ts), which a test drives without React. The cleanup of the effect cancels the read in flight, so the workers start no more reads after the screen left.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModulePlace, ModulesBridge } from '../../../shared/api/modules.js';
import { MEMORY_MODULE_ID, createMemoryReader } from '../../../shared/memory/read-flow.js';
import type { MemoryState } from '../../../shared/memory/read-flow.js';

const IDLE: MemoryState = { status: 'idle', places: [], code: null };

export function useMemoryRead(bridge: ModulesBridge | null, places: readonly ModulePlace[], ready: boolean): MemoryState & { refresh(): void } {
  const [state, setState] = useState<MemoryState>(IDLE);
  const [round, setRound] = useState(0);
  const key = places.map(p => p.id).join(','), lastKey = useRef('');
  useEffect(() => {
    if (bridge === null || !ready || places.length === 0) { setState(IDLE); return undefined; }
    // A Refresh keeps the folders of the last read on screen while it reads. A change of folders does not.
    const same = lastKey.current === key;
    lastKey.current = key;
    const reader = createMemoryReader({ bridge, moduleId: MEMORY_MODULE_ID, onState: next => setState(prev => (next.status === 'loading' && same ? { ...next, places: prev.places } : next)) });
    void reader.run(places);
    return () => { reader.cancel(); };
  }, [bridge, ready, key, round]);
  const refresh = useCallback((): void => { setRound(n => n + 1); }, []);
  return { ...state, refresh };
}
