/** The small toggle above the list: "Name", "Recently added" or (for things an agent can use) "Most used". Buttons in one group, the one in use says so with `aria-pressed`; it is the map's sort toggle with the Library's words. */
import type { ReactElement } from 'react';
import type { LibrarySort } from '../../../shared/home/library-model.js';
import { LIBRARY_WORDS } from './library-words.js';
import '../map/map.css';

const CHOICES: readonly { mode: LibrarySort; label: string }[] = Object.freeze([
  { mode: 'name', label: LIBRARY_WORDS.label.byName },
  { mode: 'added', label: LIBRARY_WORDS.label.byAdded },
  { mode: 'used', label: LIBRARY_WORDS.label.byUsed },
]);

/** `withUsed` is false on the Agents tab: an agent is used by nothing, so "Most used" would say nothing there. */
export function LibrarySortToggle({ mode, onChange, withUsed = true }: { mode: LibrarySort; onChange(mode: LibrarySort): void; withUsed?: boolean }): ReactElement {
  return (
    <div className="hm-sort">
      <span className="kit-hint" aria-hidden="true">{LIBRARY_WORDS.label.sortBy}</span>
      <div className="hm-seg" role="group" aria-label={LIBRARY_WORDS.label.sortGroup}>
        {CHOICES.filter(choice => withUsed || choice.mode !== 'used').map(choice => (
          <button key={choice.mode} type="button" className="hm-seg-button" aria-pressed={mode === choice.mode} data-sort={choice.mode} onClick={() => onChange(choice.mode)}>{choice.label}</button>
        ))}
      </div>
    </div>
  );
}
