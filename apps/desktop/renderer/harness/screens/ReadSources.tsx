/**
 * S1.3, Read sources. The sources that were kept, each with "Make a harness from this", and three buttons under the list: "Make all 4", "Set up my notes"
 * (the notes step, first five minutes section 4 step 3) and "Not now". Making a harness (`store.createHarnessFromSource`)
 * opens the app on it. "Make all 4" makes one from each. "Not now" opens the app on the sample. Nothing is read or written: the harness is made from the sample world, in memory.
 * On the person's own folders (the state holds `real`) the list can be long: a count line and the reader's notes come first, and the list scrolls in its own box.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { HButton } from '../parts/controls.js';
import { Toast } from '../parts/Toast.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { FLOW, makeAll, readTitle } from '../words-flow.js';
import { NOTES } from '../words-notes.js';
import { FirstHead, SourceVia, sourceCountsWords } from './first-run-parts.js';
import { makeOnce, makeSources } from './read-make.js';
import { ReadNotes } from '../real/ReadNotes.js';
import { readCountLine } from '../real/words-real.js';
import './first-run.css';

export function ReadSources(): ReactElement {
  const state = useHarnessState(), store = useHarnessStore();
  const kept = state.sources.filter(s => state.chosenSourceIds.includes(s.id));
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { primary.current?.focus({ preventScroll: true }); }, []);
  const ui = useUi(), making = useRef(false);
  // A second press while the first is still going does nothing; a make that gave nothing says so and leaves the screen as it is.
  const made = (id: string): void => go({ name: 'harnesses', id });
  const none = (): void => ui.showToast(FLOW.hint.nothingMade);
  const makeOne = (id: string): void => makeOnce(making, () => makeSources(store, [id]), made, none);
  const makeEvery = (): void => makeOnce(making, () => makeSources(store, kept.map(s => s.id)), made, none);
  return (
    <FirstRunFrame slot="read">
      <FirstHead current={2} />
      <h1 className="hxf-title" tabIndex={-1}>{readTitle(kept.length)}</h1>
      <p className="hxf-line">{FLOW.paragraph.readLine}</p>
      {state.real === undefined ? null : <p className="hxr-count" data-count="">{readCountLine(kept.length, kept.reduce((n, s) => n + s.partIds.length, 0))}</p>}
      {state.real === undefined ? null : <ReadNotes real={state.real} />}
      <ul className={state.real === undefined ? 'hxf-cards' : 'hxf-cards hxr-scroll'} aria-label={FLOW.label.sources}>
        {kept.map(source => (
          <li key={source.id} className="hxf-card" data-source={source.id}>
            <div className="hxf-card-row">
              <span className="hxf-card-text">
                <span className="hxf-card-name" id={`hxf-name-${source.id}`}>{source.name}</span>
                <span className="hxf-card-meta">{sourceCountsWords(state, source)}</span>
                <SourceVia source={source} />
              </span>
              <span className="hxf-card-go"><HButton icon="harness" aria-describedby={`hxf-name-${source.id}`} onClick={() => makeOne(source.id)}>{FLOW.label.makeFromThis}</HButton></span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hxf-actions">
        {kept.length === 0 ? null : <HButton ref={primary} variant="primary" onClick={makeEvery}>{makeAll(kept.length)}</HButton>}
        <HButton icon="page" data-set-up-notes="" onClick={() => go({ name: 'notes' })}>{NOTES.label.setUpNotes}</HButton>
        <HButton onClick={() => go({ name: 'harnesses' })}>{FLOW.label.notNow}</HButton>
      </div>
      {/* The first screens have no shell, so this one holds its own layer for "Nothing was made." */}
      <div id="hx-layer" />
      <Toast />
    </FirstRunFrame>
  );
}
