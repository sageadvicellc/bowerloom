/**
 * Choose, on the person's own folders (the default launch). It takes the place of the sample's Choose screen and has the same frame, the same steps (Look, Choose, Read) and the same list rows.
 * Question one: the folders the reader found, each with a tick and a count, "Show details", and "Add a folder" (the system chooser, through the bridge). Question two: "Read what is inside?",
 * the only way anything is opened. Then a bar while the ticked folders are read, the state is made from the answer (`realToHarnessState`), and the app goes to Read.
 * The steps are the home app's machine (it cannot skip a question). The only calls to the outside are the three of the bridge it is given.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { RealBridge, RealResult } from '../../../shared/real/types.js';
import { createSampleWorld } from '../../../shared/harness/sample.js';
import { codeOf } from '../../home/real/bridge.js';
import { selectedIds } from '../../home/real/flow.js';
import { realNow } from '../clock.js';
import { HButton } from '../parts/controls.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import { FirstHead } from '../screens/first-run-parts.js';
import '../screens/first-run.css';
import { Consent } from './Consent.js';
import { NoBridge, NothingFound, ReadFailed } from './Nothing.js';
import { PlaceRow } from './PlaceRow.js';
import { ChooseLines } from './ReadNotes.js';
import { ReadProgress } from './Progress.js';
import { runRead } from './read-run.js';
import { ReplaceConfirm } from './ReplaceConfirm.js';
import { firstState, reduceChoose } from './state.js';
import { REAL, foundPlaces } from './words-real.js';
import './real.css';

/** The Choose screen of a real launch whose bridge is missing or partial: the plain error, and no sample. */
export function NoBridgeScreen(): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return (
    <FirstRunFrame slot="choose">
      <FirstHead current={0} />
      <h1 className="hxf-title" tabIndex={-1} ref={heading}>{REAL.label.errorTitle}</h1>
      <NoBridge />
    </FirstRunFrame>
  );
}

export function RealChoose({ bridge }: { bridge: RealBridge }): ReactElement {
  const ui = useUi(), world = useHarnessState();
  // A person who has made harnesses is not at a first run: a read, or the sample, would replace them, so it asks first and every step has a way out.
  const holds = world.harnesses.length > 0;
  const [asking, setAsking] = useState(false);
  const [state, send] = useReducer(reduceChoose, undefined, () => reduceChoose(firstState(), { type: 'find' }));
  const [details, setDetails] = useState(false), [busy, setBusy] = useState(false);
  const live = useRef(true), latest = useRef(state), uiNow = useRef(ui), heading = useRef<HTMLHeadingElement>(null), primary = useRef<HTMLDivElement>(null);
  latest.current = state;
  uiNow.current = ui;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // "Try again" from the first question starts it again.
  useEffect(() => { if (state.step === 'start') send({ type: 'find' }); }, [state.step]);
  // Question one runs when the screen shows.
  useEffect(() => {
    if (state.step !== 'looking') return;
    bridge.discoverPlaces().then(found => { if (live.current) send({ type: 'found', found }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); });
  }, [state.step, bridge]);
  // Question two runs only after "Yes, read them", and only for the ticked folders.
  useEffect(() => {
    if (state.step !== 'reading') return;
    const now = latest.current, ids = selectedIds(now), chosen = now.places.filter(p => ids.includes(p.id));
    // A call that throws at once, not by a rejected promise, ends on the error screen too.
    void runRead(new Promise<RealResult>(resolve => resolve(bridge.readSelected(ids))), chosen, {
      apply: next => uiNow.current.replaceWorld(next), send, leave: () => go({ name: 'read' }), isLive: () => live.current,
    });
  }, [state.step, bridge]);
  // A new step puts the focus on its main button (Enter goes on) when it has a list, and on its title otherwise. It runs again only when the step or the list appears or goes:
  // "Add a folder" adds rows to a list that is there, and must not move the focus away from where the person is.
  const hasList = state.step === 'places' && state.places.length > 0 && !state.nothingRead;
  useEffect(() => {
    if (hasList) primary.current?.querySelector<HTMLElement>('button[data-variant="primary"]:not([disabled])')?.focus({ preventScroll: true });
    else if (state.step === 'looking' || state.step === 'reading' || state.step === 'start' || state.step === 'confirm') heading.current?.focus({ preventScroll: true });
  }, [state.step, hasList]);

  const pick = (): void => {
    setBusy(true);
    bridge.pickFolder().then(found => { if (live.current) send({ type: 'picked', found, cancelled: found.cancelled }); }, (error: unknown) => { if (live.current) send({ type: 'fail', code: codeOf(error) }); }).finally(() => { if (live.current) setBusy(false); });
  };
  const leave = (): void => go({ name: 'harnesses' });
  const useSampleNow = (): void => { setAsking(false); ui.replaceWorld(createSampleWorld(realNow())); go({ name: 'read' }); };
  const useSample = (): void => { if (holds) setAsking(true); else useSampleNow(); };
  const sureSample = <ReplaceConfirm yes={REAL.label.useSample} onYes={useSampleNow} onCancel={() => setAsking(false)} />;

  const empty = state.step === 'places' && (state.places.length === 0 || state.nothingRead);
  const ticked = state.places.filter(p => state.ticked.includes(p.id));
  const title = state.step === 'start' || state.step === 'looking' ? REAL.label.lookingTitle
    : state.step === 'places' ? (empty ? REAL.label.nothingTitle : foundPlaces(state.places.length))
      : state.step === 'confirm' ? REAL.label.consentTitle : state.step === 'error' ? REAL.label.errorTitle : REAL.label.readingTitle;
  const working = state.step === 'start' || state.step === 'looking';
  return (
    <FirstRunFrame slot="choose">
      <FirstHead current={working ? 0 : 1} />
      <h1 className="hxf-title" tabIndex={-1} ref={heading}>{title}</h1>
      {working ? <div className="hxf-progress" role="progressbar" aria-label={REAL.label.lookingTitle} data-searching=""><span className="hxf-progress-fill hxr-fill" data-moving="" /></div> : null}
      {state.step === 'reading' || state.step === 'done' ? <ReadProgress full={state.step === 'done'} /> : null}
      {empty ? (asking ? sureSample : <NothingFound nothingRead={state.nothingRead} readNotes={state.readNotes} busy={busy} onAdd={pick} onSample={useSample} onLeave={holds ? leave : undefined} />) : null}
      {state.step === 'places' && !empty ? (
        <>
          <p className="hxf-line">{REAL.paragraph.chooseLine}</p>
          <ul className="hxf-cards hxr-scroll" aria-label={REAL.label.places}>
            {state.places.map(p => <PlaceRow key={p.id} place={p} on={state.ticked.includes(p.id)} open={details} onTick={() => send({ type: 'toggle', id: p.id })} />)}
          </ul>
          <div className="hxf-actions" ref={primary}>
            <HButton variant="primary" disabled={state.ticked.length === 0} onClick={() => send({ type: 'looksRight' })}>{REAL.label.looksRight}</HButton>
            <HButton aria-expanded={details} onClick={() => setDetails(d => !d)}>{details ? REAL.label.hideDetails : REAL.label.showDetails}</HButton>
            <HButton icon="folder" disabled={busy} onClick={pick}>{REAL.label.addFolder}</HButton>
            {holds ? <HButton onClick={leave}>{REAL.label.notNow}</HButton> : null}
          </div>
        </>
      ) : null}
      {state.step === 'places' ? (
        <div className="hxr-notes-row">
          <p className="hxf-status" role="status">{state.ticked.length === 0 && !empty ? REAL.hint.pickOne : state.alreadyListed ? REAL.hint.alreadyListed : state.addedAway ? REAL.hint.addedAway : state.pickedNothing ? REAL.hint.pickedNothing : ''}</p>
          <ChooseLines couldNotRead={state.couldNotRead} stoppedEarly={state.stoppedEarly} notes={state.notes} />
        </div>
      ) : null}
      {state.step === 'confirm' ? <Consent places={ticked} replaces={holds} onYes={() => send({ type: 'yes' })} onBack={holds ? leave : () => send({ type: 'notNow' })} /> : null}
      {state.step === 'error' ? (asking ? sureSample : <ReadFailed code={state.error} onRetry={() => send({ type: 'retry' })} onSample={useSample} onLeave={holds ? leave : undefined} />) : null}
    </FirstRunFrame>
  );
}
