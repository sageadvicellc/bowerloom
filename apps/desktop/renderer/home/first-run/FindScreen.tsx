/**
 * The Find screen of the FIRST scan, as a full page: the logo and the scan (FindScan.tsx) in a column in the middle of the window. Welcome leads to it, and the map (and the tour)
 * follows it. It is the only full-page Find: after it, "Find more" is a panel in the right column of the map (FindPanel.tsx), so the page never comes back.
 * `onLeave` is "Not now" (back to Welcome); `onDone` is called once, when the reading ends, with the agents the person did not tick: they stay off the map.
 */
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { KitIcon } from '../kit/icons.js';
import { WORDS } from '../words.js';
import { RealFind } from '../real/RealFind.js';
import { useRealFlow } from '../real/RealFlow.js';
import { FindScan } from './FindScan.js';
import './find.css';

export interface FindScreenProps {
  world: World;
  /** The saved world. Agents whose draft differs from it have changes that wait, and stay ticked until the person saves or discards. */
  committed?: World | undefined;
  /** "Not now": the screen says it was asked; where that goes is the page's business. */
  onLeave(): void;
  /** Called once, when the reading ends, with the agents the person did not tick. */
  onDone(skipped: readonly string[]): void;
  /** The agents skipped before, so the ticks start where the person left them. */
  skipped?: readonly string[];
}

export function FindScreen({ world, committed, onLeave, onDone, skipped = [] }: FindScreenProps): ReactElement {
  // In real mode (the person's own setup) the scan is the reader's: two questions, then the same list.
  const real = useRealFlow() !== null;
  return (
    <div className="fr-root" data-home="" data-screen="find">
      <main id="main" className="fr-find">
        <div className="fr-brand fr-brand-small"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        {real ? <RealFind variant="page" world={world} committed={committed} skipped={skipped} onLeave={onLeave} onDone={onDone} /> : <FindScan variant="page" world={world} committed={committed} skipped={skipped} onLeave={onLeave} onDone={onDone} />}
      </main>
    </div>
  );
}
