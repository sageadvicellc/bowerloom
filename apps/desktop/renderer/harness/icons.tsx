/**
 * The icons of the harness-first preview: the card kit's own icons (renderer/home/kit/icons.tsx) and the few more the design draws (a robot for an agent, a folder, a play triangle,
 * a monitor, an eye, a list). They are drawn as paths, like the kit's, with no emoji and no outside icon set. They are decoration: the words beside them say the same thing.
 */
import type { ReactElement } from 'react';
import { KitIcon } from '../home/kit/icons.js';
import type { KitIconName } from '../home/kit/icons.js';
import type { PartKind } from '../../shared/harness/types.js';

export type HarnessIconName =
  | KitIconName
  | 'harness' | 'robot' | 'folder' | 'play' | 'monitor' | 'eye' | 'list' | 'zoom-in' | 'zoom-out' | 'fit' | 'columns' | 'bolt' | 'plug' | 'page' | 'warning-triangle' | 'save-clock' | 'minus-circle';

const PATHS: Readonly<Record<Exclude<HarnessIconName, KitIconName>, readonly string[]>> = {
  // Three nodes joined to one another: a harness.
  harness: ['M12 3.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', 'M6 14.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', 'M18 14.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', 'M10.9 8.1 7.1 14.9', 'M13.1 8.1l3.8 6.8', 'M8.3 17h7.4'],
  // A small robot: an agent.
  robot: ['M6 9h12v9H6z', 'M12 9V6', 'M12 4.6v.1', 'M9.5 13.2v.1', 'M14.5 13.2v.1', 'M4 12.5v2', 'M20 12.5v2', 'M9.5 16h5'],
  folder: ['M3.5 6.5h6l2 2.2h9v9.8h-17z'],
  play: ['M8 5.5v13l10.5-6.5z'],
  monitor: ['M4 5h16v10.5H4z', 'M9 19.5h6', 'M12 15.5v4'],
  eye: ['M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z', 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z'],
  list: ['M8.5 6.5H20', 'M8.5 12H20', 'M8.5 17.5H20', 'M4 6.5v.1', 'M4 12v.1', 'M4 17.5v.1'],
  'zoom-in': ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M16 16l4.5 4.5', 'M8.2 11h5.6', 'M11 8.2v5.6'],
  'zoom-out': ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M16 16l4.5 4.5', 'M8.2 11h5.6'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  columns: ['M4 5h6.5v14H4z', 'M13.5 5H20v14h-6.5z'],
  bolt: ['M13 3 5 13h6l-1 8 8-10h-6z'],
  plug: ['M9 3v5', 'M15 3v5', 'M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z', 'M12 17v4'],
  page: ['M5 4.5h10l4 4v11H5z', 'M15 4.5v4h4', 'M8.5 12h7', 'M8.5 15.5h5'],
  'warning-triangle': ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.2v.1'],
  'save-clock': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'],
  'minus-circle': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M8 12h8'],
};

const OWN = new Set<string>(Object.keys(PATHS));

/** One icon of the preview. Hidden from a screen reader, because the words beside it say the same thing. */
export function HIcon({ name, size = 20 }: { name: HarnessIconName; size?: number }): ReactElement {
  if (!OWN.has(name)) return <KitIcon name={name as KitIconName} size={size} />;
  return (
    <svg className="kit-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name as Exclude<HarnessIconName, KitIconName>].map(d => <path key={d} d={d} />)}
    </svg>
  );
}

/** The icon of a kind of part. */
export const KIND_ICON: Readonly<Record<PartKind, HarnessIconName>> = Object.freeze({ agent: 'robot', skill: 'bolt', tool: 'plug', context: 'page' });

/** A rounded square with an icon, the tile that leads a row. `size` is 28 px (a row), 36 px (a details head) or 24 px. */
export function Tile({ name, size = 'normal' }: { name: HarnessIconName; size?: 'normal' | 'large' | 'small' }): ReactElement {
  return <span className="hx-tile" data-size={size === 'normal' ? undefined : size} aria-hidden="true"><HIcon name={name} size={size === 'large' ? 24 : size === 'small' ? 16 : 20} /></span>;
}
