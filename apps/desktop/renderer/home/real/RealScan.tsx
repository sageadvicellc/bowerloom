/**
 * The first two questions of the real-setup reader, drawn in the shell: the same screens as the sample's Find (the same classes, the same rows with a checkbox, a name and flat tags),
 * for either of its two homes, the full page after Welcome (`variant="page"`) or the "Find more" panel in the right column of the map (`variant="panel"`).
 * Question one: where the reader looked, with a count of agents, skills and tools in each place, a tick for each place, "Show details" (the folders, written with `~` for the home
 * folder) and "Add a folder" (the system chooser, through the bridge). Question two: "Read what is inside?", which is the only way anything is opened. Then a short progress, and
 * `onWorld` gets the result. The steps are the machine of flow.ts, which cannot skip a question. The only things this file asks of the outside are the three calls of the bridge.
 * Everything that comes from a file (a folder name, a label) is drawn as text by React, and is marked `data-budget="content"` because it is the person's own word.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { RealBridge, RealPlace, RealResult } from '../../../shared/real/types.js';
import { Button } from '../kit/Button.js';
import { IconButton } from '../kit/IconButton.js';
import { FIND_WORDS } from '../first-run/find-words.js';
import { codeOf, getBridge } from './bridge.js';
import { agentsTicked, realReduce, selectedIds, startState } from './flow.js';
import { KIND_WORDS, REAL_WORDS, countsLine, couldNotReadLine, foundPlaces, readSummary, reasonWords } from './words.js';
import './real-scan.css';

export interface RealScanProps {
  variant: 'page' | 'panel';
  /** Called once, when step two has read the ticked places. */
  onWorld(result: RealResult): void;
  /** "Not now": the person does not want the setup read. Where that goes is the page's business. */
  onLeave(): void;
  /** For tests: a stand-in for the bridge. By default the page's own `bowerloomReal` is used. */
  bridge?: RealBridge | null;
}

function PlaceRow({ place, on, open, onTick }: { place: RealPlace; on: boolean; open: boolean; onTick(): void }): ReactElement {
  return (
    <li className="fr-agent rs-place" data-on={on ? '' : undefined} data-place={place.id} data-kind={place.kind}>
      <label className="fr-agent-row">
        <input type="checkbox" className="fr-check" checked={on} onChange={onTick} />
        <span className="fr-agent-text">
          <span className="fr-agent-name" data-budget="content">{place.label}</span>
          <span className="fr-agent-job kit-hint">{countsLine(place.counts)}</span>
          <span className="fr-agent-job kit-hint">{KIND_WORDS[place.kind]}</span>
          {place.apps.length === 0 ? null : (
            <span className="fr-tags" role="list" aria-label={FIND_WORDS.label.worksWith}>
              {place.apps.map(app => <span key={app} className="fr-tag" role="listitem" data-budget="content">{app}</span>)}
            </span>
          )}
        </span>
      </label>
      {open ? (
        <ul className="fr-paths" data-details="">
          <li><code data-budget="content">{place.details.path}</code></li>
          {place.details.folders.length === 0 ? null : <li className="kit-hint">{REAL_WORDS.hint.detailsTools}: <code data-budget="content">{place.details.folders.join(', ')}</code></li>}
          {place.details.topics.length === 0 ? null : <li className="kit-hint">{REAL_WORDS.hint.detailsTopics}: <span data-budget="content">{place.details.topics.map(t => `${t.name} (${t.count})`).join(', ')}</span></li>}
          {place.details.notes.map(n => <li key={n} className="kit-hint">{n}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

export function RealScan({ variant, onWorld, onLeave, bridge }: RealScanProps): ReactElement {
  // The scan starts as soon as the screen shows: the person already pressed "Find my agents" (or "Find more").
  const [state, send] = useReducer(realReduce, undefined, () => realReduce(startState(), { type: 'find' }));
  const [details, setDetails] = useState(false);
  const [busyPick, setBusyPick] = useState(false);
  const live = useRef(true);
  const told = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), primary = useRef<HTMLDivElement>(null);
  const calls = bridge === undefined ? getBridge() : bridge;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // "Try again" from the first question starts it again.
  useEffect(() => { if (state.step === 'start') send({ type: 'find' }); }, [state.step]);
  // Question one runs when the scan starts.
  useEffect(() => {
    if (state.step !== 'looking') return;
    if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
    calls.discoverPlaces().then(found => { if (live.current) send({ type: 'found', found }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); });
  }, [state.step, calls]);
  // Question two runs only after "Yes, read them".
  useEffect(() => {
    if (state.step !== 'reading' || told.current) return;
    if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
    told.current = true;
    calls.readSelected(selectedIds(state)).then(result => { told.current = false; if (!live.current) return; send({ type: 'done' }); onWorld(result); }, (error: unknown) => { told.current = false; if (live.current) send({ type: 'fail', code: codeOf(error) }); });
  }, [state, calls, onWorld]);
  // A new question puts the focus on its main button, so Enter goes on and the keyboard needs no search.
  useEffect(() => {
    if (state.step === 'places' || state.step === 'confirm' || state.step === 'error') (primary.current?.querySelector<HTMLElement>('button[data-variant="primary"]:not([disabled])') ?? primary.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }, [state.step]);

  const pick = (): void => {
    if (calls === null) { send({ type: 'fail', code: 'NO_BRIDGE' }); return; }
    setBusyPick(true);
    calls.pickFolder().then(found => { if (live.current) send({ type: 'picked', found, cancelled: found.cancelled }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); }).finally(() => { if (live.current) setBusyPick(false); });
  };

  const title = state.step === 'start' || state.step === 'looking' ? REAL_WORDS.label.lookingTitle
    : state.step === 'places' ? (state.places.length === 0 ? REAL_WORDS.label.nothingTitle : foundPlaces(state.places.length))
      : state.step === 'confirm' ? REAL_WORDS.label.readTitle : state.step === 'error' ? REAL_WORDS.label.errorTitle : REAL_WORDS.label.readingTitle;
  const Title = variant === 'page' ? 'h1' : 'h3';
  const moving = state.step === 'looking' || state.step === 'start' || state.step === 'reading';
  return (
    <div className="fr-flow rs-flow" data-variant={variant} data-step={state.step} data-real-scan="">
      <Title className={variant === 'page' ? 'fr-title' : 'kit-heading fr-title'} tabIndex={-1} ref={heading}>{title}</Title>
      <p className="hm-sr" role="status">{title}</p>
      <p className="kit-hint" data-readonly="">{REAL_WORDS.hint.readOnlyNote}</p>
      {moving || state.step === 'done' ? (
        <div className="fr-progress" role="progressbar" aria-label={state.step === 'reading' || state.step === 'done' ? REAL_WORDS.label.progress : FIND_WORDS.label.searching} data-searching="">
          <span className="fr-progress-fill rs-fill" data-moving={moving ? '' : undefined} data-full={state.step === 'done' ? '' : undefined} />
        </div>
      ) : null}
      {state.step === 'places' ? (
        <div className="fr-section">
          <p className="kit-hint">{state.places.length === 0 ? REAL_WORDS.hint.nothingHint : REAL_WORDS.hint.placesHint}</p>
          {state.places.length === 0 ? null : (
            <ul className="fr-agents rs-places" aria-label={REAL_WORDS.label.places}>
              {state.places.map(p => <PlaceRow key={p.id} place={p} on={state.ticked.includes(p.id)} open={details} onTick={() => send({ type: 'toggle', id: p.id })} />)}
            </ul>
          )}
          {state.couldNotRead > 0 ? <p className="kit-hint" data-could-not="">{couldNotReadLine(state.couldNotRead)}</p> : null}
          {state.stoppedEarly ? <p className="kit-hint" data-stopped="">{REAL_WORDS.hint.stoppedEarly}</p> : null}
          {state.pickedNothing ? <p className="kit-hint" data-picked-nothing="">{REAL_WORDS.hint.pickedNothing}</p> : null}
          <div className="fr-actions" data-pinned="" ref={primary}>
            {state.places.length === 0
              ? <Button variant="primary" disabled={busyPick} onClick={pick}>{REAL_WORDS.label.addFolder}</Button>
              : <Button variant="primary" disabled={state.ticked.length === 0} onClick={() => send({ type: 'looksRight' })}>{REAL_WORDS.label.looksRight}</Button>}
            {state.places.length === 0 ? null : <Button disabled={busyPick} onClick={pick}>{REAL_WORDS.label.addFolder}</Button>}
            {state.places.length === 0 ? null : <Button aria-expanded={details} onClick={() => setDetails(d => !d)}>{details ? REAL_WORDS.label.hideDetails : REAL_WORDS.label.showDetails}</Button>}
            {state.places.length === 0 ? <Button onClick={onLeave}>{REAL_WORDS.label.notNow}</Button> : null}
            {state.ticked.length === 0 && state.places.length > 0 ? <p className="kit-hint">{REAL_WORDS.hint.pickOne}</p> : null}
          </div>
        </div>
      ) : null}
      {state.step === 'confirm' ? (
        <section className="fr-section fr-confirm" aria-label={REAL_WORDS.label.readTitle}>
          <p className="fr-summary">{readSummary(state.ticked.length, agentsTicked(state))}</p>
          <p className="kit-hint">{REAL_WORDS.hint.readOnly}</p>
          <p className="kit-hint">{REAL_WORDS.hint.readText}</p>
          <p className="kit-hint">{REAL_WORDS.hint.readHidden}</p>
          <div className="fr-actions" ref={primary}>
            <IconButton icon="back" label={REAL_WORDS.label.back} side="below" onClick={() => send({ type: 'back' })} />
            <Button variant="primary" onClick={() => send({ type: 'yes' })}>{REAL_WORDS.label.yesRead}</Button>
            <Button onClick={onLeave}>{REAL_WORDS.label.notNow}</Button>
          </div>
        </section>
      ) : null}
      {state.step === 'error' ? (
        <section className="fr-section" role="alert">
          <p className="kit-hint" data-error={state.error}>{reasonWords(state.error)}</p>
          <div className="fr-actions" ref={primary}>
            <Button variant="primary" onClick={() => send({ type: 'retry' })}>{REAL_WORDS.label.tryAgain}</Button>
            <Button onClick={onLeave}>{REAL_WORDS.label.notNow}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
