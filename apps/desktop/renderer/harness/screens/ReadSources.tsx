/**
 * S1.3, Read sources. The sources that were kept, each with "Make a harness from this", and two buttons under the list: "Make all 4" and "Not now". Making a harness (`store.createHarnessFromSource`)
 * opens the app on it. "Make all 4" makes one from each. "Not now" opens the app on the sample. Nothing is read or written: the harness is made from the sample world, in memory.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { HButton } from '../parts/controls.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { FLOW, makeAll, readTitle } from '../words-flow.js';
import { FirstHead, SourceVia, sourceCountsWords } from './first-run-parts.js';
import './first-run.css';

export function ReadSources(): ReactElement {
  const state = useHarnessState(), store = useHarnessStore();
  const kept = state.sources.filter(s => state.chosenSourceIds.includes(s.id));
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { primary.current?.focus({ preventScroll: true }); }, []);
  const makeOne = (id: string): void => { const made = store.createHarnessFromSource(id); go(made === null ? { name: 'harnesses' } : { name: 'harnesses', id: made }); };
  const makeEvery = (): void => {
    let first: string | null = null;
    for (const source of kept) { const made = store.createHarnessFromSource(source.id); if (first === null) first = made; }
    go(first === null ? { name: 'harnesses' } : { name: 'harnesses', id: first });
  };
  return (
    <FirstRunFrame slot="read">
      <FirstHead current={2} />
      <h1 className="hxf-title" tabIndex={-1}>{readTitle(kept.length)}</h1>
      <p className="hxf-line">{FLOW.paragraph.readLine}</p>
      <ul className="hxf-cards" aria-label={FLOW.label.sources}>
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
        <HButton onClick={() => go({ name: 'harnesses' })}>{FLOW.label.notNow}</HButton>
      </div>
    </FirstRunFrame>
  );
}
