/**
 * One folder in the real Choose list: a tick (a choice the person can change), the folder's name, what it holds by count, and a dot with where it is and which programs it holds.
 * "Show details" adds the path (written with `~`), the tool folders, the topics and any note the reader left. Everything that comes from a file is drawn as text by React.
 */
import type { ReactElement } from 'react';
import type { RealPlace } from '../../../shared/real/types.js';
import { KIND_WORDS } from '../../home/real/words.js';
import { StateDot } from '../parts/controls.js';
import { REAL, countsLine, isPartlyNote } from './words-real.js';
import './real.css';

export function PlaceRow({ place, on, open, onTick }: { place: RealPlace; on: boolean; open: boolean; onTick(): void }): ReactElement {
  const where = [KIND_WORDS[place.kind], ...place.apps].join(' · ');
  return (
    <li className="hxf-card" data-place={place.id} data-kind={place.kind} data-off={on ? undefined : ''}>
      <label className="hxf-card-row">
        <input type="checkbox" className="hxf-check" checked={on} onChange={onTick} />
        <span className="hxf-card-text">
          <span className="hxf-card-name" data-budget="content">{place.label}</span>
          <span className="hxf-card-meta">{countsLine(place.counts)}</span>
          <StateDot tone={place.empty ? 'quiet' : 'good'} className="hxf-via"><span data-budget="content">{where}</span></StateDot>
        </span>
      </label>
      {open ? (
        <ul className="hxr-details" data-details="">
          <li><code data-budget="content">{place.details.path}</code></li>
          {place.details.folders.length === 0 ? null : <li>{REAL.label.toolFolders}: <code data-budget="content">{place.details.folders.join(', ')}</code></li>}
          {place.details.topics.length === 0 ? null : <li>{REAL.label.topics}: <span data-budget="content">{place.details.topics.map(t => `${t.name} (${t.count})`).join(', ')}</span></li>}
          {place.details.notes.map(note => <li key={note}>{note}</li>)}
          {place.kind !== 'home' && place.details.notes.some(isPartlyNote) ? <li data-next-step="">{REAL.hint.nextStep}</li> : null}
        </ul>
      ) : null}
    </li>
  );
}
