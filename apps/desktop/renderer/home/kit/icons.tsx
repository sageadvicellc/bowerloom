/** The small outline icons of the card kit, drawn here as paths: no emoji, no outside icon set. They are decoration; the words beside them say the same thing. */
import type { ReactElement } from 'react';

export type KitIconName = 'agent' | 'skill' | 'tool' | 'note' | 'plus' | 'clock' | 'check' | 'warning' | 'sparkle' | 'key' | 'info' | 'close' | 'leaf' | 'chevron';

const PATHS: Readonly<Record<KitIconName, readonly string[]>> = {
  // Head and shoulders: a person.
  agent: ['M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6'],
  // A bolt: a quick, reusable move.
  skill: ['M13 3 5 13h6l-1 8 8-10h-6z'],
  // A plug: something an agent can use.
  tool: ['M9 3v5', 'M15 3v5', 'M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z', 'M12 17v4'],
  // A page with a folded corner: notes to read.
  note: ['M5 4.5h10l4 4v11H5z', 'M15 4.5v4h4', 'M8.5 12h7', 'M8.5 15.5h5'],
  plus: ['M12 5v14', 'M5 12h14'],
  // A clock face: a point in time.
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  warning: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.2v.1'],
  // A four-point star: something new.
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  key: ['M8.5 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 11h9', 'M18 11v3', 'M15.5 11v2'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 11v5', 'M12 7.8v.1'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  // The sage leaf of the practice.
  leaf: ['M5 19c0-8 5-13 14-14 0 9-5 14-13 14', 'M5 19c3-5 6-8 10-10'],
  chevron: ['M7 10l5 5 5-5'],
};

export const KIT_ICON_NAMES: readonly KitIconName[] = Object.keys(PATHS) as KitIconName[];

/** One icon. Hidden from a screen reader, because the words next to it say the same thing. */
export function KitIcon({ name, size = 20 }: { name: KitIconName; size?: number }): ReactElement {
  return (
    <svg className="kit-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map(d => <path key={d} d={d} />)}
    </svg>
  );
}
