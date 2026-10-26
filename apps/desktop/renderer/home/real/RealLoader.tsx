/**
 * The screens of the real-setup reader, in the order of the two questions: Find my setup (step one: places and counts), the places with ticks and "Show details",
 * "Read what is inside?" (the second consent), a progress, and then the hand-over of the world to `onWorld`. A line at the bottom says "Read-only" on every screen.
 * Everything that comes from a file (a folder name, a label) is drawn as text by React; nothing here builds markup from text. The folder paths show only behind "Show details".
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import type { RealBridge, RealPlace, RealResult } from '../../../shared/real/types.js';
import { codeOf, getBridge } from './bridge.js';
import { agentsTicked, realReduce, selectedIds, startState } from './flow.js';
import type { RealState } from './flow.js';
import { KIND_WORDS, REAL_WORDS, countsLine, couldNotReadLine, foundPlaces, readSummary, reasonWords } from './words.js';
import './real.css';

export interface RealLoaderProps {
  /** Called once, when step two has read the ticked places. The first argument is the world the home screens read; the second is the whole result (ages, other programs, notes). */
  onWorld(world: World, result: RealResult): void;
  /** For tests: a stand-in for the bridge. By default the page's own `bowerloomReal` is used. */
  bridge?: RealBridge | null;
}

function Btn({ primary = false, disabled = false, onClick, children, ...rest }: { primary?: boolean; disabled?: boolean; onClick(): void; children: string } & Record<`aria-${string}`, string | boolean | undefined>): ReactElement {
  return <button type="button" className="rl-button" data-primary={primary ? '' : undefined} disabled={disabled} onClick={onClick} {...rest}>{children}</button>;
}

function PlaceRow({ place, on, open, onTick }: { place: RealPlace; on: boolean; open: boolean; onTick(): void }): ReactElement {
  return (
    <li className="rl-place" data-on={on ? '' : undefined} data-kind={place.kind}>
      <label className="rl-place-row">
        <input type="checkbox" className="rl-check" checked={on} onChange={onTick} />
        <span className="rl-place-name" data-budget="content">{place.label}</span>
        <span className="rl-place-count">{countsLine(place.counts)}</span>
      </label>
      <p className="rl-place-kind">{KIND_WORDS[place.kind]}{place.apps.length === 0 ? '' : ' - '}<span data-budget="content">{place.appLabel === 'Notes' ? '' : place.appLabel}</span></p>
      {open ? (
        <div className="rl-details" data-details="">
          <p><code data-budget="content">{place.details.path}</code></p>
          {place.details.folders.length === 0 ? null : <p>{REAL_WORDS.hint.detailsTools}: <code data-budget="content">{place.details.folders.join(', ')}</code></p>}
          {place.details.topics.length === 0 ? null : <p>{REAL_WORDS.hint.detailsTopics}: <span data-budget="content">{place.details.topics.map(t => `${t.name} (${t.count})`).join(', ')}</span></p>}
          {place.details.notes.map(n => <p key={n}>{n}</p>)}
        </div>
      ) : null}
    </li>
  );
}

/** The screens, drawn from a state. No call is made here. */
export function RealView({ state, details, busyPick, onAction }: { state: RealState; details: boolean; busyPick: boolean; onAction: (name: 'find' | 'looksRight' | 'yes' | 'notNow' | 'back' | 'retry' | 'details' | 'pick' | { toggle: string }) => void }): ReactElement {
  const title = state.step === 'start' ? REAL_WORDS.label.foundTitle : state.step === 'looking' ? REAL_WORDS.label.lookingTitle
    : state.step === 'places' ? (state.places.length === 0 ? REAL_WORDS.label.nothingTitle : foundPlaces(state.places.length)) : state.step === 'confirm' ? REAL_WORDS.label.readTitle
      : state.step === 'error' ? REAL_WORDS.label.nothingTitle : REAL_WORDS.label.readingTitle;
  return (
    <div className="rl-root" data-real="" data-step={state.step}>
      <main id="main" className="rl-main">
        <h1 className="rl-title" tabIndex={-1} data-focus="">{title}</h1>
        <p className="rl-readonly" data-readonly="">{REAL_WORDS.hint.readOnlyNote}</p>
        <p className="rl-readonly" data-temp="">{REAL_WORDS.hint.tempNote}</p>
        {state.step === 'start' ? (
          <section className="rl-section">
            <p className="rl-hint">{REAL_WORDS.hint.intro}</p>
            <div className="rl-actions"><Btn primary onClick={() => onAction('find')}>{REAL_WORDS.label.findMySetup}</Btn></div>
          </section>
        ) : null}
        {state.step === 'looking' ? <section className="rl-section" aria-live="polite"><div className="rl-progress" role="progressbar" aria-label={REAL_WORDS.label.progress}><span className="rl-progress-fill" data-moving="" /></div></section> : null}
        {state.step === 'places' ? (
          <section className="rl-section" aria-labelledby="rl-places-title">
            <h2 className="rl-heading" id="rl-places-title">{REAL_WORDS.label.whereILooked}</h2>
            {state.places.length === 0 ? <p className="rl-hint">{REAL_WORDS.hint.nothingHint}</p> : <p className="rl-hint">{REAL_WORDS.hint.placesHint}</p>}
            <ul className="rl-places" id="rl-places-list" aria-label={REAL_WORDS.label.places}>
              {state.places.map(p => <PlaceRow key={p.id} place={p} on={state.ticked.includes(p.id)} open={details} onTick={() => onAction({ toggle: p.id })} />)}
            </ul>
            {state.couldNotRead > 0 ? <p className="rl-hint" data-could-not="">{couldNotReadLine(state.couldNotRead)}</p> : null}
            {state.stoppedEarly ? <p className="rl-hint" data-stopped="">{REAL_WORDS.hint.stoppedEarly}</p> : null}
            {state.pickedNothing ? <p className="rl-hint">{REAL_WORDS.hint.pickedNothing}</p> : null}
            <div className="rl-actions" data-pinned="">
              <Btn primary disabled={state.ticked.length === 0} onClick={() => onAction('looksRight')}>{REAL_WORDS.label.looksRight}</Btn>
              <Btn disabled={busyPick} onClick={() => onAction('pick')}>{REAL_WORDS.label.addFolder}</Btn>
              {state.places.length === 0 ? null : <Btn aria-expanded={details} aria-controls="rl-places-list" onClick={() => onAction('details')}>{details ? REAL_WORDS.label.hideDetails : REAL_WORDS.label.showDetails}</Btn>}
              {state.ticked.length === 0 && state.places.length > 0 ? <p className="rl-hint">{REAL_WORDS.hint.pickOne}</p> : null}
            </div>
          </section>
        ) : null}
        {state.step === 'confirm' ? (
          <section className="rl-section" aria-label={REAL_WORDS.label.readTitle}>
            <p className="rl-summary">{readSummary(state.ticked.length, agentsTicked(state))}</p>
            <p className="rl-hint">{REAL_WORDS.hint.readOnly}</p>
            <p className="rl-hint">{REAL_WORDS.hint.readSafe}</p>
            <div className="rl-actions" data-pinned="">
              <Btn primary onClick={() => onAction('yes')}>{REAL_WORDS.label.yesRead}</Btn>
              <Btn onClick={() => onAction('notNow')}>{REAL_WORDS.label.notNow}</Btn>
              <Btn onClick={() => onAction('back')}>{REAL_WORDS.label.back}</Btn>
            </div>
          </section>
        ) : null}
        {state.step === 'reading' || state.step === 'done' ? <section className="rl-section" aria-live="polite"><div className="rl-progress" role="progressbar" aria-label={REAL_WORDS.label.progress}><span className="rl-progress-fill" data-moving={state.step === 'reading' ? '' : undefined} data-full={state.step === 'done' ? '' : undefined} /></div></section> : null}
        {state.step === 'error' ? (
          <section className="rl-section" role="alert">
            <p className="rl-hint" data-error={state.error}>{reasonWords(state.error)}</p>
            <div className="rl-actions"><Btn primary onClick={() => onAction('retry')}>{REAL_WORDS.label.tryAgain}</Btn></div>
          </section>
        ) : null}
      </main>
      <footer className="rl-footer"><span className="rl-badge">{REAL_WORDS.label.readOnly}</span></footer>
    </div>
  );
}

export function RealLoader({ onWorld, bridge }: RealLoaderProps): ReactElement {
  const [state, send] = useReducer(realReduce, undefined, startState);
  const [details, setDetails] = useState(false);
  const [busyPick, setBusyPick] = useState(false);
  const live = useRef(true);
  const told = useRef(false);
  const calls = bridge === undefined ? getBridge() : bridge;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // A new question puts the focus on its title, so the keyboard needs no search.
  useEffect(() => { document.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true }); }, [state.step]);

  // Step one runs when the person asked to find the setup.
  useEffect(() => {
    if (state.step !== 'looking') return;
    if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
    calls.discoverPlaces().then(found => { if (live.current) send({ type: 'found', found }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); });
  }, [state.step, calls]);

  // Step two runs only after "Yes, read them".
  useEffect(() => {
    if (state.step !== 'reading' || told.current) return;
    if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
    told.current = true;
    calls.readSelected(selectedIds(state)).then(result => { if (!live.current) return; send({ type: 'done' }); onWorld(result.world, result); }, (error: unknown) => { told.current = false; if (live.current) send({ type: 'fail', code: codeOf(error) }); });
  }, [state, calls, onWorld]);

  const act = (name: Parameters<Parameters<typeof RealView>[0]['onAction']>[0]): void => {
    if (typeof name === 'object') { send({ type: 'toggle', id: name.toggle }); return; }
    if (name === 'details') { setDetails(d => !d); return; }
    if (name === 'pick') {
      if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
      setBusyPick(true);
      calls.pickFolder().then(found => { if (live.current) send({ type: 'picked', found, cancelled: found.cancelled }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); }).finally(() => { if (live.current) setBusyPick(false); });
      return;
    }
    send({ type: name });
  };
  return <RealView state={state} details={details} busyPick={busyPick} onAction={act} />;
}
