/**
 * "Find more", after the first scan: the same scan as the first one (FindScan.tsx), drawn as the right column of the map and titled "Find more", not as a full page. It is
 * a column of the shell, so the rest of the app stays in reach: the navigation, the map, the Save bar and the drawers keep working while it is open. A person ends it with the
 * Close icon at its top right, with Escape, or with "Not now"; the page (HomeApp) takes it away and puts the focus back on the "Find more" item of the navigation. When the
 * reading ends it calls `onDone` with the agents that were unticked, and the page keeps them off the map. The focus goes to its heading when it opens.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { IconButton } from '../kit/IconButton.js';
import { WORDS } from '../words.js';
import { FindScan } from './FindScan.js';
import { FIND_WORDS } from './find-words.js';
import './find.css';

export interface FindPanelProps {
  world: World;
  committed?: World | undefined;
  /** The agents skipped so far, so the ticks start where the person left them. */
  skipped: readonly string[];
  onClose(): void;
  onDone(skipped: readonly string[]): void;
}

export function FindPanel({ world, committed, skipped, onClose, onDone }: FindPanelProps): ReactElement {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  return (
    <aside className="hm-panel" id="hm-panel" data-find="" aria-labelledby="fr-panel-title">
      <div className="fr-panel-head">
        <h2 className="kit-heading" id="fr-panel-title" tabIndex={-1} ref={title}>{FIND_WORDS.label.findMore}</h2>
        <IconButton icon="close" label={WORDS.label.close} side="left" data-find-close="" onClick={onClose} />
      </div>
      <FindScan variant="panel" world={world} committed={committed} skipped={skipped} onLeave={onClose} onDone={onDone} />
    </aside>
  );
}
