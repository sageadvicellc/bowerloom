/**
 * The Find screen, in two questions. First the program tiles light one by one, each with a count of agents found ("Not found" when the program is not on
 * the computer), and then "Where I looked" lists the places in plain words, each with a count and a tick. "Looks right" asks the second question,
 * "Read what is inside?", and only "Yes, read them" reads anything. A short progress follows, and then the map. An unticked place is skipped: its agents
 * stay off the map. The real folders sit behind "Show details" and nowhere else. The flow is a pure machine (shared/home/find-flow.ts); this file only
 * draws it and keeps the time: a timer lights each tile, and under reduce motion every tile is lit at once and the reading ends at once.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { FIND_TOOLS, findPlaces, multiProgramAgents, skippedAgents, toolTiles } from '../../../shared/home/find-model.js';
import type { FindPlace, ToolTile } from '../../../shared/home/find-model.js';
import { findReduce, readTotal, startFind } from '../../../shared/home/find-flow.js';
import type { FindState } from '../../../shared/home/find-flow.js';
import { prefersReducedMotion } from '../../motion-tokens.js';
import { Button } from '../kit/Button.js';
import { Glyph } from '../kit/Glyph.js';
import { KitIcon } from '../kit/icons.js';
import { WORDS, agentsCount } from '../words.js';
import { FIND_WORDS, foundTitle, multiAppLine, readProgress, readSummary, readingNow, unsavedHere } from './find-words.js';
import './find.css';

/** How long the search takes to reach each tile, in milliseconds, and how long it rests on the last tile before the places show. */
const FIRST_MS = 350, STEP_MS = 560, SETTLE_MS = 420, READ_MS = 420;

export interface FindScreenProps {
  world: World;
  /** The saved world. Agents whose draft differs from it have changes that wait, and their place stays ticked until the person saves or discards. */
  committed?: World;
  /** Where "Not now" goes back to is the page's business; this screen only says it was asked. */
  onLeave(): void;
  /** Called once, when the reading ends, with the agents of the places the person did not tick. */
  onDone(skipped: readonly string[]): void;
  /** The agents skipped the last time, so Find more starts with the same ticks. */
  skipped?: readonly string[];
}

function Tile({ tile, lit }: { tile: ToolTile; lit: boolean }): ReactElement {
  const state = !lit ? 'waiting' : tile.found ? 'found' : 'missing';
  return (
    <li className="fr-tile" data-state={state} data-tool={tile.id}>
      <Glyph name="program" size="large" />
      <span className="fr-tile-name">{tile.name}</span>
      <span className="fr-tile-status">
        {state === 'waiting' ? FIND_WORDS.label.looking : state === 'missing' ? FIND_WORDS.label.notFound : <><strong className="fr-count">{tile.agents}</strong> {tile.agents === 1 ? 'agent' : 'agents'}</>}
      </span>
    </li>
  );
}

function Tiles({ tiles, lit }: { tiles: readonly ToolTile[]; lit: number }): ReactElement {
  return <ul className="fr-tiles" aria-label={FIND_WORDS.label.toolsFound}>{tiles.map((t, i) => <Tile key={t.id} tile={t} lit={i < lit} />)}</ul>;
}

interface PlacesProps { places: readonly FindPlace[]; state: FindState; open: boolean; onTick(id: string): void; onDetails(): void; onLooksRight(): void }

function Places({ places, state, open, onTick, onDetails, onLooksRight }: PlacesProps): ReactElement {
  return (
    <section className="fr-section" aria-labelledby="fr-places-title">
      <div className="fr-section-head">
        <h2 className="kit-heading" id="fr-places-title">{FIND_WORDS.label.whereILooked}</h2>
        <p className="kit-hint">{FIND_WORDS.hint.placesHint}</p>
      </div>
      <ul className="fr-places" id="fr-places-list" aria-label={FIND_WORDS.label.places}>
        {places.map(p => {
          const on = state.ticked.includes(p.id);
          return (
            <li key={p.id} className="fr-place" data-on={on ? '' : undefined}>
              <label className="fr-place-row">
                <input type="checkbox" className="fr-check" checked={on} aria-disabled={p.unsaved > 0 ? 'true' : undefined} aria-describedby={p.unsaved > 0 ? `fr-unsaved-${p.id}` : undefined} onChange={() => { if (p.unsaved === 0) onTick(p.id); }} />
                <span className="fr-place-name">{p.name}</span>
                <span className="fr-place-count">{agentsCount(p.agents)}</span>
              </label>
              {p.unsaved > 0 ? <p className="kit-hint fr-unsaved" id={`fr-unsaved-${p.id}`} data-unsaved="">{unsavedHere(p.unsaved)}</p> : null}
              {open ? <ul className="fr-paths" data-details="">{p.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul> : null}
            </li>
          );
        })}
      </ul>
      <div className="fr-actions" data-pinned="">
        <Button variant="primary" disabled={state.ticked.length === 0} onClick={onLooksRight}>{FIND_WORDS.label.looksRight}</Button>
        <Button aria-expanded={open} aria-controls="fr-places-list" onClick={onDetails}>{open ? FIND_WORDS.label.hideDetails : FIND_WORDS.label.showDetails}</Button>
        {state.ticked.length === 0 ? <p className="kit-hint">{FIND_WORDS.hint.pickOne}</p> : null}
      </div>
    </section>
  );
}

export function FindScreen({ world, committed, onLeave, onDone, skipped = [] }: FindScreenProps): ReactElement {
  const tiles = useMemo(() => toolTiles(world), [world]);
  const places = useMemo(() => findPlaces(world, committed), [world, committed]);
  const multi = useMemo(() => multiProgramAgents(world), [world]);
  // A place whose agents have unsaved changes starts ticked, whatever was skipped before, and stays ticked: the changes must not drop off the map.
  const [state, send] = useReducer(findReduce, undefined, () => startFind(FIND_TOOLS.length, places.map(p => p.id), places.filter(p => p.unsaved > 0 || !p.agentIds.some(id => skipped.includes(id))).map(p => p.id)));
  const [details, setDetails] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), primary = useRef<HTMLDivElement>(null);
  const reduce = prefersReducedMotion();
  const total = places.reduce((n, p) => n + p.agents, 0);
  const keptAgents = places.filter(p => state.ticked.includes(p.id)).reduce((n, p) => n + p.agents, 0);

  // The tiles light one by one; under reduce motion they are all lit at once.
  useEffect(() => {
    if (state.step !== 'looking') return undefined;
    if (reduce) { send({ type: 'lightAll' }); return undefined; }
    const timer = window.setTimeout(() => send(state.lit < state.tiles ? { type: 'light' } : { type: 'settle' }), state.lit === 0 ? FIRST_MS : state.lit < state.tiles ? STEP_MS : SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [state.step, state.lit, state.tiles, reduce]);
  // The reading goes place by place, briefly; under reduce motion it ends at once.
  useEffect(() => {
    if (state.step !== 'reading') return undefined;
    if (reduce) { send({ type: 'readAll' }); return undefined; }
    const timer = window.setTimeout(() => send({ type: 'read' }), READ_MS);
    return () => window.clearTimeout(timer);
  }, [state.step, state.read, reduce]);
  // The flow ends in one of two ways, and the page is told once.
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    if (state.step === 'left') { told.current = true; onLeave(); }
    if (state.step === 'done') { told.current = true; onDone(skippedAgents(places, state.ticked)); }
  }, [state.step, state.ticked, places, onLeave, onDone]);
  // A new question puts the focus on its main button, so Enter goes on and the keyboard needs no search.
  useEffect(() => {
    if (state.step === 'places' || state.step === 'confirm') primary.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    if (state.step === 'reading') heading.current?.focus({ preventScroll: true });
  }, [state.step]);

  const title = state.step === 'looking' ? FIND_WORDS.label.lookingTitle
    : state.step === 'places' ? (places.length === 0 ? FIND_WORDS.label.nothingTitle : foundTitle(total))
    : state.step === 'confirm' ? FIND_WORDS.label.readTitle : FIND_WORDS.label.readingTitle;
  const current = places.filter(p => state.ticked.includes(p.id))[Math.min(state.read, Math.max(0, readTotal(state) - 1))];

  return (
    <div className="fr-root" data-home="" data-screen="find" data-step={state.step}>
      <main id="main" className="fr-find">
        <div className="fr-brand fr-brand-small"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        <h1 className="fr-title" tabIndex={-1} ref={heading}>{title}</h1>
        {state.step === 'places' && multi > 0 && places.length > 0 ? <p className="fr-multi" data-multi="">{multiAppLine(multi)}</p> : null}
        <p className="hm-sr" role="status">{state.step === 'places' && multi > 0 && places.length > 0 ? `${title}. ${multiAppLine(multi)}` : title}</p>
        <p className="kit-hint fr-apps">{FIND_WORDS.hint.appsNote}</p>
        <Tiles tiles={tiles} lit={state.lit} />
        {state.step === 'places' ? (
          places.length === 0 ? (
            <section className="fr-section">
              <p className="kit-hint">{FIND_WORDS.hint.nothingHint}</p>
              <div className="fr-actions" ref={primary}><Button variant="primary" onClick={() => send({ type: 'notNow' })}>{FIND_WORDS.label.close}</Button></div>
            </section>
          ) : (
            <div ref={primary}>
              <Places places={places} state={state} open={details} onLooksRight={() => send({ type: 'looksRight' })} onTick={id => send({ type: 'toggle', id })} onDetails={() => setDetails(d => !d)} />
            </div>
          )
        ) : null}
        {state.step === 'confirm' ? (
          <section className="fr-section fr-confirm" aria-label={FIND_WORDS.label.readTitle}>
            <p className="fr-summary">{readSummary(state.ticked.length, keptAgents)}</p>
            <p className="kit-hint">{FIND_WORDS.hint.readOnly}</p>
            <p className="kit-hint">{FIND_WORDS.hint.readSafe}</p>
            <div className="fr-actions" ref={primary}>
              <Button variant="primary" onClick={() => send({ type: 'yes' })}>{FIND_WORDS.label.yesRead}</Button>
              <Button onClick={() => send({ type: 'notNow' })}>{FIND_WORDS.label.notNow}</Button>
              <Button onClick={() => send({ type: 'back' })}>{FIND_WORDS.label.back}</Button>
            </div>
          </section>
        ) : null}
        {state.step === 'reading' || state.step === 'done' ? (
          <section className="fr-section" aria-live="polite">
            <div className="fr-progress" role="progressbar" aria-label={FIND_WORDS.label.progress} aria-valuemin={0} aria-valuemax={readTotal(state)} aria-valuenow={state.read}>
              <span className="fr-progress-fill" style={{ transform: `scaleX(${readTotal(state) === 0 ? 0 : Math.min(1, state.read / readTotal(state))})` }} />
            </div>
            <p className="kit-hint">{current === undefined ? '' : readingNow(current.name)} <span className="fr-of">{readProgress(Math.min(state.read + 1, readTotal(state)), readTotal(state))}</span></p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
