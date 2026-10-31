/**
 * The quiet switch beside the sort: "Not used yet 22". It keeps only the things that no agent uses, and its number is how many there are. One button with
 * `aria-pressed`, drawn as the sort toggle is (a filled segment with a 2 px accent edge when it is on, never a check mark).
 */
import type { ReactElement } from 'react';
import { LIBRARY_WORDS, notUsedLabel } from './library-words.js';
import '../map/map.css';

export interface LibraryFilterProps { on: boolean; count: number; onChange(on: boolean): void }

export function LibraryFilter({ on, count, onChange }: LibraryFilterProps): ReactElement {
  return (
    <div className="hm-seg" role="group" aria-label={LIBRARY_WORDS.label.filterGroup} data-filter="">
      <button type="button" className="hm-seg-button" aria-pressed={on} data-filter-unused="" onClick={() => onChange(!on)}>{notUsedLabel(count)}</button>
    </div>
  );
}
