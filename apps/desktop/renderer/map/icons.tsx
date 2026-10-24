/** Small outline icons for the kinds of thing on the map. Drawn here: no emoji, no outside icon set. */
import type { ReactElement } from 'react';
import type { MapKind } from '../../shared/mapmodel.js';

const PATHS: Record<MapKind, readonly string[]> = {
  machine: ['M4 5h16v10H4z', 'M9 19h6', 'M12 15v4'],
  workspace: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', 'M3.5 11h17'],
  project: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  'context-store': ['M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7'],
  team: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 19c0-3 2.7-5 6-5s6 2 6 5', 'M16 11a2.5 2.5 0 1 0 0-5', 'M17.5 14.2c2 .5 3.5 2 3.5 4.8'],
  agent: ['M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M9.5 5.2h-.01', 'M14.5 5.2h-.01'],
  skill: ['M13 3 5 13h6l-1 8 8-10h-6z'],
  prompt: ['M4 5h16v11H9l-5 4z', 'M8 9h8', 'M8 12.5h5'],
  'reading-list': ['M5 4h14v16H5z', 'M8.5 8h7', 'M8.5 12h7', 'M8.5 16h4'],
  'knowledge-folder': ['M4 5h6l2 2h8v12H4z', 'M8 12h8', 'M8 15.5h5'],
};

export function KindIcon({ kind, size = 18 }: { kind: MapKind; size?: number }): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[kind].map(d => <path key={d} d={d} />)}</svg>;
}
