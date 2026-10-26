/**
 * The scan of the first minute, in two questions, drawn for either of its two homes: the full page of the FIRST scan (`variant="page"`, after Welcome) and the "Find more"
 * panel in the right column of the map (`variant="panel"`). It is the same machine (shared/home/find-flow.ts) and the same words, so a person meets one thing twice, not two
 * things. First a short progress (the search looking), then ONE list of agents: a row for each agent with a checkbox, its name, its job in one line, and a flat tag for each
 * app it works in ("Claude Code", "Codex", "OpenCode", or the app's own name). There are no tiles for the apps and no counts for them. "Select all" and "Clear" are icon buttons
 * with tooltips; "Show details" opens the places the agents were found in, with their folders, and nowhere else are folders shown. "Looks right" asks the second question, "Read what
 * is inside?", and only "Yes, read them" reads anything. A short progress follows, and then `onDone` is called with the agents that were unticked: they stay off the map (they stay in
 * the world, so nothing is lost, and Find more can bring them back). An agent whose changes wait for Save stays ticked and cannot be skipped, so the changes never drop off the map.
 * A timer lights the search; under reduce motion it is shown at once and the reading ends at once.
 */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { FIND_TOOLS, findAgents, findPlaces, lockedAgents } from '../../../shared/home/find-model.js';
import type { FindAgent } from '../../../shared/home/find-model.js';
import { findReduce, readTotal, startFind } from '../../../shared/home/find-flow.js';
import type { FindState } from '../../../shared/home/find-flow.js';
import { prefersReducedMotion } from '../../motion-tokens.js';
import { Button } from '../kit/Button.js';
import { IconButton } from '../kit/IconButton.js';
import { FIND_WORDS, foundTitle, readProgress, readSummary, readingNow, unsavedAgent } from './find-words.js';
import './find.css';

/** How long the search takes to reach each step, in milliseconds, how long it rests before the list shows, and how long the whole reading takes. */
const FIRST_MS = 300, STEP_MS = 380, SETTLE_MS = 300, READ_TOTAL_MS = 1100;

export interface FindScanProps {
  variant: 'page' | 'panel';
  world: World;
  /** The saved world. Agents whose draft differs from it have changes that wait, and stay ticked until the person saves or discards. */
  committed?: World | undefined;
  /** The agents skipped the last time, so Find more starts with the same ticks. */
  skipped?: readonly string[];
  /** "Not now": the screen says it was asked; where that goes is the page's business. */
  onLeave(): void;
  /** Called once, when the reading ends, with the agents the person did not tick. */
  onDone(skipped: readonly string[]): void;
}

function Row({ agent, on, onTick }: { agent: FindAgent; on: boolean; onTick(id: string): void }): ReactElement {
  const base = useId();
  const name = `${base}-name`, job = `${base}-job`, tags = `${base}-tags`, why = `${base}-why`;
  return (
    <li className="fr-agent" data-on={on ? '' : undefined} data-agent={agent.id}>
      <label className="fr-agent-row">
        <input type="checkbox" className="fr-check" checked={on} aria-labelledby={name} aria-describedby={`${job} ${tags}${agent.unsaved ? ` ${why}` : ''}`} aria-disabled={agent.unsaved ? 'true' : undefined}
          onChange={() => { if (!agent.unsaved) onTick(agent.id); }} />
        <span className="fr-agent-text">
          <span className="fr-agent-name" id={name}>{agent.name}</span>
          <span className="fr-agent-job kit-hint" id={job}>{agent.hint}</span>
          <span className="fr-tags" id={tags} role="list" aria-label={FIND_WORDS.label.worksWith}>
            {agent.apps.map(app => <span key={app} className="fr-tag" role="listitem" data-app={app}>{app}</span>)}
          </span>
        </span>
      </label>
      {agent.unsaved ? <p className="kit-hint fr-unsaved" id={why} data-unsaved="">{unsavedAgent()}</p> : null}
    </li>
  );
}

export function FindScan({ variant, world, committed, onLeave, onDone, skipped = [] }: FindScanProps): ReactElement {
  const agents = useMemo(() => findAgents(world, committed), [world, committed]);
  const places = useMemo(() => findPlaces(world, committed), [world, committed]);
  const locked = useMemo(() => lockedAgents(agents), [agents]);
  const ids = useMemo(() => agents.map(a => a.id), [agents]);
  // An agent with changes that wait starts ticked, whatever was skipped before, and stays ticked: the changes must not drop off the map.
  const [state, send] = useReducer(findReduce, undefined, () => startFind(FIND_TOOLS.length, ids, ids.filter(id => locked.includes(id) || !skipped.includes(id))));
  const [details, setDetails] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), primary = useRef<HTMLDivElement>(null);
  const listId = useId();
  const reduce = prefersReducedMotion();
  const keptAgents = state.ticked.length;
  const readMs = Math.max(40, Math.round(READ_TOTAL_MS / Math.max(1, readTotal(state))));

  // The search lights step by step; under reduce motion it is shown at once.
  useEffect(() => {
    if (state.step !== 'looking') return undefined;
    if (reduce) { send({ type: 'lightAll' }); return undefined; }
    const timer = window.setTimeout(() => send(state.lit < state.tiles ? { type: 'light' } : { type: 'settle' }), state.lit === 0 ? FIRST_MS : state.lit < state.tiles ? STEP_MS : SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [state.step, state.lit, state.tiles, reduce]);
  // The reading goes agent by agent, briefly; under reduce motion it ends at once.
  useEffect(() => {
    if (state.step !== 'reading') return undefined;
    if (reduce) { send({ type: 'readAll' }); return undefined; }
    const timer = window.setTimeout(() => send({ type: 'read' }), readMs);
    return () => window.clearTimeout(timer);
  }, [state.step, state.read, reduce, readMs]);
  // The flow ends in one of two ways, and the page is told once.
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    if (state.step === 'left') { told.current = true; onLeave(); }
    if (state.step === 'done') { told.current = true; onDone(ids.filter(id => !state.ticked.includes(id))); }
  }, [state.step, state.ticked, ids, onLeave, onDone]);
  // A new question puts the focus on its main button, so Enter goes on and the keyboard needs no search.
  useEffect(() => {
    // The main button of the question (the primary one), not the first control in it: the Back arrow comes first.
    if (state.step === 'places' || state.step === 'confirm') (primary.current?.querySelector<HTMLElement>('button[data-variant="primary"]:not([disabled])') ?? primary.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus({ preventScroll: true });
    if (state.step === 'reading') heading.current?.focus({ preventScroll: true });
  }, [state.step]);

  const title = state.step === 'looking' ? FIND_WORDS.label.lookingTitle
    : state.step === 'places' ? (agents.length === 0 ? FIND_WORDS.label.nothingTitle : foundTitle(agents.length))
    : state.step === 'confirm' ? FIND_WORDS.label.readTitle : FIND_WORDS.label.readingTitle;
  const current = agents.filter(a => state.ticked.includes(a.id))[Math.min(state.read, Math.max(0, readTotal(state) - 1))];
  const Title = variant === 'page' ? 'h1' : 'h3', Sub = variant === 'page' ? 'h2' : 'h4';
  const body = (
    <>
      <Title className={variant === 'page' ? 'fr-title' : 'kit-heading fr-title'} tabIndex={-1} ref={heading}>{title}</Title>
      <p className="hm-sr" role="status">{title}</p>
      {state.step === 'looking' ? (
        <div className="fr-progress" role="progressbar" aria-label={FIND_WORDS.label.searching} aria-valuemin={0} aria-valuemax={state.tiles} aria-valuenow={state.lit} data-searching="">
          <span className="fr-progress-fill" style={{ transform: `scaleX(${state.tiles === 0 ? 1 : Math.min(1, state.lit / state.tiles)})` }} />
        </div>
      ) : null}
      {state.step === 'places' ? (
        agents.length === 0 ? (
          <section className="fr-section">
            <p className="kit-hint">{FIND_WORDS.hint.nothingHint}</p>
            <div className="fr-actions" ref={primary}><Button variant="primary" onClick={() => send({ type: 'notNow' })}>{FIND_WORDS.label.close}</Button></div>
          </section>
        ) : (
          <div className="fr-section">
            <div className="fr-list-head">
              <p className="kit-hint">{FIND_WORDS.hint.pickAgents}</p>
              <span className="fr-bulk">
                <IconButton icon="select-all" label={FIND_WORDS.label.selectAll} side="below-end" data-select-all="" onClick={() => send({ type: 'selectAll' })} />
                <IconButton icon="clear" label={FIND_WORDS.label.clearAll} side="below-end" data-clear="" onClick={() => send({ type: 'clear', keep: locked })} />
              </span>
            </div>
            <ul className="fr-agents" aria-label={FIND_WORDS.label.agentsFound}>
              {agents.map(a => <Row key={a.id} agent={a} on={state.ticked.includes(a.id)} onTick={id => send({ type: 'toggle', id })} />)}
            </ul>
            {details ? (
              <section className="fr-where" id={listId} aria-label={FIND_WORDS.label.whereILooked}>
                <Sub className="kit-heading">{FIND_WORDS.label.whereILooked}</Sub>
                <ul className="fr-places" data-places="">
                  {places.map(p => (
                    <li key={p.id} className="fr-place">
                      <p className="fr-place-line"><span className="fr-place-name">{p.name}</span><span className="fr-place-count">{readSummary(p.agents)}</span></p>
                      <ul className="fr-paths" data-details="">{p.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="fr-actions" data-pinned="" ref={primary}>
              <Button variant="primary" disabled={state.ticked.length === 0} onClick={() => send({ type: 'looksRight' })}>{FIND_WORDS.label.looksRight}</Button>
              <Button aria-expanded={details} aria-controls={listId} onClick={() => setDetails(d => !d)}>{details ? FIND_WORDS.label.hideDetails : FIND_WORDS.label.showDetails}</Button>
              {state.ticked.length === 0 ? <p className="kit-hint">{FIND_WORDS.hint.pickOne}</p> : null}
            </div>
          </div>
        )
      ) : null}
      {state.step === 'confirm' ? (
        <section className="fr-section fr-confirm" aria-label={FIND_WORDS.label.readTitle}>
          <p className="fr-summary">{readSummary(keptAgents)}</p>
          <p className="kit-hint">{FIND_WORDS.hint.readOnly}</p>
          <p className="kit-hint">{FIND_WORDS.hint.readSafe}</p>
          <div className="fr-actions" ref={primary}>
            <IconButton icon="back" label={FIND_WORDS.label.back} side="below" onClick={() => send({ type: 'back' })} />
            <Button variant="primary" onClick={() => send({ type: 'yes' })}>{FIND_WORDS.label.yesRead}</Button>
            <Button onClick={() => send({ type: 'notNow' })}>{FIND_WORDS.label.notNow}</Button>
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
    </>
  );
  return <div className="fr-flow" data-variant={variant} data-step={state.step as FindState['step']}>{body}</div>;
}
