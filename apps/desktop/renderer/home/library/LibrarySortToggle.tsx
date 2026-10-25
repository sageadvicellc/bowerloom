/** The small toggle above the list: "Name" or "Recently added". Two buttons in one group, the one in use says so with `aria-pressed`; it is the map's sort toggle with the Library's words. */
import type { ReactElement } from 'react';
import type { LibrarySort } from '../../../shared/home/library-model.js';
import { LIBRARY_WORDS } from './library-words.js';
import '../map/map.css';

const CHOICES: readonly { mode: LibrarySort; label: string }[] = Object.freeze([
  { mode: 'name', label: LIBRARY_WORDS.label.byName },
  { mode: 'added', label: LIBRARY_WORDS.label.byAdded },
]);

export function LibrarySortToggle({ mode, onChange }: { mode: LibrarySort; onChange(mode: LibrarySort): void }): ReactElement {
  return (
    <div className="hm-sort">
      <span className="kit-hint" aria-hidden="true">{LIBRARY_WORDS.label.sortBy}</span>
      <div className="hm-seg" role="group" aria-label={LIBRARY_WORDS.label.sortGroup}>
        {CHOICES.map(choice => (
          <button key={choice.mode} type="button" className="hm-seg-button" aria-pressed={mode === choice.mode} data-sort={choice.mode} onClick={() => onChange(choice.mode)}>{choice.label}</button>
        ))}
      </div>
    </div>
  );
}
