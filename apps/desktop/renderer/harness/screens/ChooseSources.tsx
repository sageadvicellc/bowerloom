/**
 * S1.2, Choose sources. A short pretend look first (about a second, a bar that fills; at once when the person asked for less motion), then the four sources the sample world holds,
 * each with a tick: a tick is right here, because the person can change it. "Looks right" keeps the ticked ones (`store.chooseSources`) and goes to Read sources. "Show details" lists the names
 * of the parts of each source in plain words. "Add a folder" reads no folder in this preview, and says so. Nothing is read from this computer.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { prefersReducedMotion } from '../../motion-tokens.js';
import { HButton } from '../parts/controls.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { FLOW, foundSources } from '../words-flow.js';
import { FirstHead, SourceVia, sourceCountsWords, sourceNames } from './first-run-parts.js';
import './first-run.css';

/** The bar fills in this many steps, one every `STEP_MS`: about a second in all. */
export const LOOK_STEPS = 5, STEP_MS = 200;

export function ChooseSources(): ReactElement {
  const state = useHarnessState(), store = useHarnessStore();
  const [lit, setLit] = useState(() => (prefersReducedMotion() ? LOOK_STEPS : 0));
  const [ticked, setTicked] = useState<readonly string[]>(() => (state.chosenSourceIds.length === 0 ? state.sources.map(s => s.id) : state.chosenSourceIds));
  const [details, setDetails] = useState(false), [said, setSaid] = useState(false);
  const primary = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const looking = lit < LOOK_STEPS;

  useEffect(() => {
    if (!looking) return undefined;
    const timer = window.setTimeout(() => setLit(n => n + 1), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [looking, lit]);
  // When the list shows, the way on has the focus, so Enter goes on. While it looks, the title has it.
  useEffect(() => { if (looking) heading.current?.focus({ preventScroll: true }); else primary.current?.focus({ preventScroll: true }); }, [looking]);

  const toggle = (id: string): void => setTicked(now => (now.includes(id) ? now.filter(x => x !== id) : [...now, id]));
  const keep = (): void => { store.chooseSources(ticked); go({ name: 'read' }); };
  return (
    <FirstRunFrame slot="choose">
      <FirstHead current={looking ? 0 : 1} />
      <h1 className="hxf-title" tabIndex={-1} ref={heading}>{looking ? FLOW.label.lookingTitle : foundSources(state.sources.length)}</h1>
      {looking ? (
        <div className="hxf-progress" role="progressbar" aria-label={FLOW.label.searchProgress} aria-valuemin={0} aria-valuemax={LOOK_STEPS} aria-valuenow={lit} data-searching="">
          <span className="hxf-progress-fill" style={{ transform: `scaleX(${Math.min(1, lit / LOOK_STEPS)})` }} />
        </div>
      ) : (
        <>
          <p className="hxf-line">{FLOW.paragraph.chooseLine}</p>
          <ul className="hxf-cards" aria-label={FLOW.label.sources}>
            {state.sources.map(source => {
              const on = ticked.includes(source.id);
              return (
                <li key={source.id} className="hxf-card" data-source={source.id} data-off={on ? undefined : ''}>
                  <label className="hxf-card-row">
                    <input type="checkbox" className="hxf-check" checked={on} onChange={() => toggle(source.id)} />
                    <span className="hxf-card-text">
                      <span className="hxf-card-name">{source.name}</span>
                      <span className="hxf-card-meta">{sourceCountsWords(state, source)}</span>
                      <SourceVia source={source} />
                    </span>
                  </label>
                  {details ? <p className="hxf-card-names" aria-label={FLOW.label.partsInSource}>{sourceNames(state, source)}</p> : null}
                </li>
              );
            })}
          </ul>
          <div className="hxf-actions">
            <HButton ref={primary} variant="primary" disabled={ticked.length === 0} onClick={keep}>{FLOW.label.looksRight}</HButton>
            <HButton aria-expanded={details} onClick={() => setDetails(d => !d)}>{details ? FLOW.label.hideDetails : FLOW.label.showDetails}</HButton>
            <HButton icon="folder" onClick={() => setSaid(true)}>{FLOW.label.addFolder}</HButton>
          </div>
          <p className="hxf-status" role="status">{ticked.length === 0 ? FLOW.hint.tickOne : said ? FLOW.hint.notInPreview : ''}</p>
        </>
      )}
    </FirstRunFrame>
  );
}
