/**
 * The second question: "Read what is inside?". It names the folders that will be read and says what is read and what is not changed. No text is read before "Yes, read them".
 * The title takes the focus when the step opens, as on every other step, so a screen reader starts at the question. Escape or the second button goes back: to the list of folders,
 * or, when reading again would replace harnesses the person already made, out of this screen to the Harnesses list ("Cancel").
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { RealPlace } from '../../../shared/real/types.js';
import { HButton } from '../parts/controls.js';
import { REAL, foldersLine } from './words-real.js';
import './real.css';

/**
 * What is read in a place, written with `~`: the place's own folder for notes pages (a home place has none, so its tool folders instead), then the tool folders in it, then the words for
 * what is taken from notes pages. The tool folders are all a home place opens; a work folder or a picked folder is walked whole for notes pages.
 */
export const openedIn = (place: RealPlace): string => {
  const root = place.details.path.replace(/\/$/, ''), tools = place.details.folders.map(f => `${root}/${f}`);
  const paths = place.kind === 'home' ? (tools.length === 0 ? [place.details.path] : tools) : [place.details.path, ...tools];
  return `${paths.join(', ')} (${REAL.label.notesFirstLines})`;
};

export function Consent({ places, replaces = false, onYes, onBack }: { places: readonly RealPlace[]; replaces?: boolean; onYes(): void; onBack(): void }): ReactElement {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); back.current(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <section className="hxr-consent" aria-label={REAL.label.consentTitle} data-consent="">
      <p className="hxf-line">{foldersLine(places.length)}</p>
      <ul className="hxr-folders hxr-scroll" aria-label={REAL.label.foldersToRead}>
        {places.map(place => (
          <li key={place.id} data-place={place.id}>
            <span className="hxr-folder-name" data-budget="content">{place.label}</span>
            <code className="hxr-folder-path" data-budget="content">{openedIn(place)}</code>
          </li>
        ))}
      </ul>
      <ul className="hxr-promises">
        <li>{REAL.hint.consentOne}</li>
        <li>{REAL.hint.consentTwo}</li>
        <li>{REAL.paragraph.consentNotes}</li>
        <li>{REAL.hint.consentLinks}</li>
        <li>{REAL.hint.consentThree}</li>
        <li>{REAL.hint.consentFour}</li>
      </ul>
      {replaces ? <p className="hxf-line" data-replace="">{REAL.hint.replaceLine}</p> : null}
      <div className="hxf-actions">
        <HButton variant="primary" onClick={onYes}>{REAL.label.yesRead}</HButton>
        <HButton onClick={onBack}>{replaces ? REAL.label.cancel : REAL.label.notNow}</HButton>
      </div>
    </section>
  );
}
