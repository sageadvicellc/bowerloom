/**
 * What the reader says about the read, on the Read screen: how many things it could not read, how many texts it cut, that it stopped early, and the plain notes it left. Drawn only when there is
 * something to say. The lines are ours (or made by the reader's own mapping), drawn as text.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RealNotes } from '../../../shared/harness/types.js';
import { HButton } from '../parts/controls.js';
import { REAL, couldNotReadLine, moreNotes, textsCutLine } from './words-real.js';
import './real.css';

/** The most notes shown before "and 4 more notes." */
export const NOTES_SHOWN = 6;

export const hasNotes = (real: RealNotes): boolean => real.couldNotRead > 0 || real.stoppedEarly || real.textsCut > 0 || real.notes.length > 0;

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

export function ReadNotes({ real }: { real: RealNotes }): ReactElement | null {
  if (!hasNotes(real)) return null;
  return (
    <section className="hxr-notes" aria-label={REAL.label.aboutRead} data-read-notes="">
      <ul>
        {real.couldNotRead > 0 ? <li data-could-not="">{couldNotReadLine(real.couldNotRead)}</li> : null}
        {real.textsCut > 0 ? <li data-texts-cut="">{textsCutLine(real.textsCut)}</li> : null}
        {real.stoppedEarly ? <li data-stopped="">{REAL.hint.stoppedEarly}</li> : null}
        <NoteItems notes={real.notes} />
      </ul>
    </section>
  );
}
