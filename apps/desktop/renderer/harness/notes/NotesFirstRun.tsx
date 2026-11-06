/**
 * The notes step of the first run (first five minutes, section 4 step 3), after Read: the same notes step the Notes panel opens, on the first-run page. When
 * the notes are ready, "Build my Notes keeper" opens the app with the edit of a folder's agents and starts the tour, which builds the keeper. "Not now" opens
 * the app as it is. The chosen folder stays for this window, so the Notes panel and the map show it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { KitIcon } from '../../home/kit/icons.js';
import { HButton } from '../parts/controls.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { useUi } from '../ui.js';
import { WORDS } from '../words.js';
import { NOTES } from '../words-notes.js';
import { NotesStep } from './NotesStep.js';
import '../screens/first-run.css';

export function NotesFirstRun(): ReactElement {
  const ui = useUi();
  const [ready, setReady] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), build = useRef<HTMLButtonElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (ready) build.current?.focus({ preventScroll: true }); }, [ready]);
  return (
    <FirstRunFrame slot="notes">
      <p className="hxf-brand"><KitIcon name="leaf" size={20} /><span>{WORDS.label.appName}</span></p>
      <h1 className="hxf-title" tabIndex={-1} ref={heading}>{NOTES.label.yourNotes}</h1>
      <NotesStep onDone={() => setReady(true)} />
      {ready ? <p className="hxf-line">{NOTES.hint.firstRunNote}</p> : null}
      <div className="hxf-actions">
        {ready ? <HButton ref={build} variant="primary" icon="robot" data-build-keeper="" onClick={() => { go({ name: 'projects' }); ui.openSave({ tour: true }); }}>{NOTES.label.buildKeeper}</HButton> : null}
        <HButton onClick={() => go({ name: 'harnesses' })}>{NOTES.label.notNow}</HButton>
      </div>
      <div id="hx-layer" />
    </FirstRunFrame>
  );
}
