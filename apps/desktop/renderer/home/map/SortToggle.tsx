/** The small toggle above the map: "Name" or "Recently changed". Two buttons in one group; the one in use says so with `aria-pressed` and a check, never colour alone. */
import type { ReactElement } from 'react';
import type { SortMode } from '../../../shared/home/order.js';
import { KitIcon } from '../kit/icons.js';
import { WORDS } from '../words.js';
import './map.css';

const CHOICES: readonly { mode: SortMode; label: string }[] = Object.freeze([
  { mode: 'name', label: WORDS.label.byName },
  { mode: 'recent', label: WORDS.label.byRecent },
]);

export function SortToggle({ mode, onChange }: { mode: SortMode; onChange(mode: SortMode): void }): ReactElement {
  return (
    <div className="hm-sort">
      <span className="kit-hint" aria-hidden="true">{WORDS.label.sortBy}</span>
      <div className="hm-seg" role="group" aria-label={WORDS.label.sortGroup}>
        {CHOICES.map(choice => (
          <button key={choice.mode} type="button" className="hm-seg-button" aria-pressed={mode === choice.mode} data-sort={choice.mode} onClick={() => onChange(choice.mode)}>
            {mode === choice.mode ? <KitIcon name="check" size={16} /> : null}
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
