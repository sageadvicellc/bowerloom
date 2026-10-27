/**
 * What the reader says about the read, on the Read screen: a short calm summary (what could not be opened, what was cut, that it stopped early, the reader's limits when a folder was only partly read),
 * "Show details" with each place's own notes, and the plain notes it left. Drawn only when there is something to say. The lines are ours (or made by the reader's own mapping), drawn as text.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RealNotes } from '../../../shared/harness/types.js';
import { HButton } from '../parts/controls.js';
import { REAL, isPartlyNote, limitsLine, moreNotes, skippedLine, textsCutLine } from './words-real.js';
import './real.css';

/** The most notes shown before "and 4 more notes." */
export const NOTES_SHOWN = 6;

export const hasNotes = (real: RealNotes): boolean => real.couldNotRead > 0 || real.stoppedEarly || real.textsCut > 0 || real.onlyPartRead === true || real.notes.length > 0;

/** The notes that are drawn: the first few, or all of them once the person asked. */
export const visibleNotes = (notes: readonly string[], all: boolean): readonly string[] => (all ? notes : notes.slice(0, NOTES_SHOWN));

/** The note lines of a list, with "and 4 more notes." and a button for the rest. */
export function NoteItems({ notes }: { notes: readonly string[] }): ReactElement {
  const [all, setAll] = useState(false);
  const shown = visibleNotes(notes, all), more = notes.length - shown.length;
  return (
    <>
      {shown.map(note => <li key={note} data-note="">{note}</li>)}
      {more > 0 ? <li>{moreNotes(more)}</li> : null}
      {notes.length > NOTES_SHOWN ? <li className="hxr-notes-more"><HButton aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? REAL.label.showFewerNotes : REAL.label.showAllNotes}</HButton></li> : null}
    </>
  );
}

/** Each place with the reader's notes about it, and one plain next step under a place that was only partly read. */
export function PlaceNotes({ places }: { places: readonly { readonly name: string; readonly notes: readonly string[] }[] }): ReactElement {
  return (
    <div className="hxr-place-notes" data-place-details="">
      <p>{REAL.hint.detailsFrom}</p>
      <ul>
        {places.map(p => (
          <li key={p.name}>
            <span className="hxr-place-name" data-budget="content">{p.name}</span>
            <ul>
              {p.notes.map(note => <li key={note}>{note}</li>)}
              {p.notes.some(isPartlyNote) ? <li data-next-step="">{REAL.hint.nextStep}</li> : null}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Choose screen's lines about the folders: the same calm wording, and the reader's own notes after them (a note about a big folder is the limits line). */
export function ChooseLines({ couldNotRead, stoppedEarly, notes }: { couldNotRead: number; stoppedEarly: boolean; notes: readonly string[] }): ReactElement {
  const partly = notes.some(isPartlyNote), rest = notes.filter(n => !isPartlyNote(n));
  return (
    <>
      {couldNotRead > 0 ? <p className="hxf-status" data-could-not="">{skippedLine(couldNotRead, false)}</p> : null}
      {partly ? <p className="hxf-status" data-partly="">{limitsLine()}</p> : null}
      {stoppedEarly ? <p className="hxf-status" data-stopped="">{REAL.hint.stoppedEarly}</p> : null}
      {rest.length > 0 ? <section className="hxr-notes" aria-label={REAL.label.aboutFolders} data-place-notes=""><ul><NoteItems notes={rest} /></ul></section> : null}
    </>
  );
}

export function ReadNotes({ real }: { real: RealNotes }): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!hasNotes(real)) return null;
  const whole = real.onlyPartRead !== true && !real.stoppedEarly, places = real.places ?? [];
  return (
    <section className="hxr-notes" aria-label={REAL.label.aboutRead} data-read-notes="">
      <ul>
        {real.couldNotRead > 0 ? <li data-could-not="">{skippedLine(real.couldNotRead, whole)}</li> : null}
        {real.onlyPartRead === true ? <li data-partly="">{limitsLine()}</li> : null}
        {real.textsCut > 0 ? <li data-texts-cut="">{textsCutLine(real.textsCut)}</li> : null}
        {real.stoppedEarly ? <li data-stopped="">{REAL.hint.stoppedEarly}</li> : null}
        <NoteItems notes={real.notes} />
        {places.length > 0 ? <li className="hxr-notes-more"><HButton aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? REAL.label.hideDetails : REAL.label.showDetails}</HButton></li> : null}
      </ul>
      {open && places.length > 0 ? <PlaceNotes places={places} /> : null}
    </section>
  );
}
