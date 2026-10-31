/** The bar while the folders are read. The read is one call, so the bar has no count: it moves to show work, and sits still (half full) when the person asked for less motion. */
import type { ReactElement } from 'react';
import { REAL } from './words-real.js';
import './real.css';

export function ReadProgress({ full }: { full: boolean }): ReactElement {
  return (
    <div className="hxf-progress" role="progressbar" aria-label={REAL.label.readProgress} data-reading="">
      <span className="hxf-progress-fill hxr-fill" data-moving={full ? undefined : ''} data-full={full ? '' : undefined} />
    </div>
  );
}
