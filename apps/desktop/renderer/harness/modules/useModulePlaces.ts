/**
 * The approved folders of one module, read through the modules bridge. It reads when the module changes, and after an approval or a removal. It stores nothing: the record is main's.
 * The steps are in shared/modules/places-flow.ts; this hook only holds their state. A step that ends after the module changed, or after the screen left, is ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModulesBridge } from '../../../shared/api/modules.js';
import { MODULE_WORDS } from '../../../shared/modules/view-model.js';
import { approveFlow, firstPlaces, loadPlaces, removeFlow } from '../../../shared/modules/places-flow.js';
import type { PlacesPatch, PlacesView } from '../../../shared/modules/places-flow.js';

export interface PlacesState extends PlacesView {
  approve(): void;
  remove(placeId: string): void;
}

export function useModulePlaces(bridge: ModulesBridge | null, moduleId: string | null): PlacesState {
  const [state, setState] = useState<PlacesView>(() => firstPlaces(bridge));
  const turn = useRef(0);
  const lay = useCallback((mine: number, patch: PlacesPatch): void => { if (turn.current === mine) setState(s => ({ ...s, ...patch })); }, []);
  useEffect(() => {
    const mine = ++turn.current;
    setState(firstPlaces(bridge));
    if (bridge !== null && moduleId !== null) void loadPlaces(bridge, moduleId).then(patch => lay(mine, patch));
    return () => { turn.current += 1; };
  }, [bridge, moduleId, lay]);

  const approve = useCallback((): void => {
    if (bridge === null || moduleId === null) return;
    const mine = turn.current;
    setState(s => ({ ...s, busy: true, notice: MODULE_WORDS.approving }));
    void approveFlow(bridge, moduleId).then(patch => lay(mine, patch));
  }, [bridge, moduleId, lay]);

  const remove = useCallback((placeId: string): void => {
    if (bridge === null || moduleId === null) return;
    const mine = turn.current;
    setState(s => ({ ...s, busy: true, notice: null }));
    void removeFlow(bridge, moduleId, placeId).then(patch => lay(mine, patch));
  }, [bridge, moduleId, lay]);

  return { ...state, approve, remove };
}
