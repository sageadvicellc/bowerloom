/**
 * Engines and usage (v0.9 lane 5): one card for each engine Bowerloom detects, with its config and its usage. The config is what the reader of the person's folders found (counts, names, the folders read, and
 * the connections with a flag when one holds a secret: only "Secret: set", never a name or a value). The usage is summed from the session logs of the runs the person recorded, through the two read calls of the
 * runs bridge. A figure that no log held reads "Not read", never 0. All display logic is in shared/engines-usage (the model and the reader), which a terminal view could reuse.
 * Structure copied from Local models (local-models/LocalModels.tsx): Screen, a hint line, then a list of rows with a tile, a name, a state dot and a list of facts.
 * The page reaches the run record through `useRuns`, which hands it the runs bridge from the engine API client. It names no bridge and calls nothing that writes.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { useHarnessState } from '../session.js';
import { useRuns } from '../runs-real/runs-session.js';
import { ENGINES_WORDS, enginesView } from '../../../shared/engines-usage/model.js';
import type { ConnectionView, EngineRowView, EnginesView, Fact, UsageSource } from '../../../shared/engines-usage/model.js';
import { initialSource, readUsage } from '../../../shared/engines-usage/read.js';
import type { Tone } from '../../../shared/harness/status.js';
import './engines-usage.css';

const TONE: Readonly<Record<EngineRowView['state'], Tone>> = Object.freeze({ ready: 'good', problem: 'warn', 'not-found': 'quiet' });

/** A list of facts. A gap is drawn without the `data-reported` mark, so it reads quietly. */
function Facts({ facts, group }: { facts: readonly Fact[]; group: 'config' | 'usage' }): ReactElement | null {
  if (facts.length === 0) return null;
  return (
    <dl className="hxu-facts" data-group={group}>
      {facts.map(f => (
        <div key={f.key} className="hxu-fact" data-fact={f.key} data-reported={f.reported ? '' : undefined}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Connection({ connection }: { connection: ConnectionView }): ReactElement {
  return (
    <li className="hxu-connection" data-connection={connection.name} data-secret={connection.secretSet ? 'set' : undefined}>
      <span className="hxu-connection-name">{connection.name}</span>
      {connection.summary === '' ? null : <span className="hx-muted hxu-connection-line">{connection.summary}</span>}
      {connection.secretSet ? <span className="hxu-secret">{ENGINES_WORDS.secretSet}</span> : null}
    </li>
  );
}

/** One card. The rows of a view are rebuilt for each view, so a card is drawn again only when its own row is a new object. */
const EngineCard = memo(function EngineCard({ row }: { row: EngineRowView }): ReactElement {
  const titleId = `hxu-name-${row.id}`;
  return (
    <li className="hx-row hxu-row" data-engine={row.id} data-state={row.state} aria-labelledby={titleId}>
      <span className="hx-tile" aria-hidden="true"><HIcon name="monitor" size={20} /></span>
      <div className="hx-row-text hxu-text">
        <div className="hxu-head">
          <h2 className="hxu-name" id={titleId}>{row.name}</h2>
          <StateDot tone={TONE[row.state]} className="hx-row-state">{row.stateWords}</StateDot>
        </div>
        <section className="hxu-section" data-section="config">
          <h3 className="hxu-h3">{ENGINES_WORDS.configTitle}</h3>
          <Facts facts={row.config} group="config" />
          {row.configNotes.map(note => <p key={note} className="hx-text hx-muted" data-config-note="">{note}</p>)}
          {row.places.length === 0 ? null : (
            <>
              <h4 className="hxu-h4">{ENGINES_WORDS.foldersTitle}</h4>
              <ul className="hxu-places" aria-label={ENGINES_WORDS.foldersTitle}>
                {row.places.map(place => <li key={place} className="hxu-place">{place}</li>)}
                {row.morePlaces > 0 ? <li className="hxu-place hx-muted">{ENGINES_WORDS.more(row.morePlaces)}</li> : null}
              </ul>
            </>
          )}
          {row.connections.length === 0 ? null : (
            <>
              <h4 className="hxu-h4">{ENGINES_WORDS.connectionsTitle}</h4>
              <ul className="hxu-connections" aria-label={ENGINES_WORDS.connectionsTitle}>
                {row.connections.map((c, i) => <Connection key={`${i}-${c.name}`} connection={c} />)}
                {row.moreConnections > 0 ? <li className="hxu-connection hx-muted">{ENGINES_WORDS.more(row.moreConnections)}</li> : null}
              </ul>
            </>
          )}
        </section>
        <section className="hxu-section" data-section="usage">
          <h3 className="hxu-h3">{ENGINES_WORDS.usageTitle}</h3>
          <Facts facts={row.usage} group="usage" />
          {row.usageNotes.map(note => <p key={note} className="hx-text hx-muted" data-usage-note="">{note}</p>)}
        </section>
      </div>
    </li>
  );
});

/** What the stage shows for a view: the hint, the notes of the whole view, and the cards, or a line when no engine was found. */
export function EnginesUsageBody({ view }: { view: EnginesView }): ReactElement {
  return (
    <div className="hxu-body" data-engines-usage="">
      <p className="kit-hint hx-hint" data-engines-hint="">{ENGINES_WORDS.hint}</p>
      {view.notes.map(note => <p key={note} className="kit-hint hx-hint" data-engines-note="">{note}</p>)}
      {view.rows.length === 0
        ? <p className="hx-text" role="status" data-engines-state="empty">{ENGINES_WORDS.none}</p>
        : <ul className="hxu-list" aria-label={ENGINES_WORDS.listLabel}>{view.rows.map(row => <EngineCard key={row.id} row={row} />)}</ul>}
    </div>
  );
}

/**
 * The state of the screen: the config from the state the page holds, and the usage read through the runs bridge. The sample launch has no logs and says so. The read starts when the screen opens and when the person
 * presses Read again; it ends when the screen goes away. The figures of an earlier read stay on screen while a new read runs.
 */
function useEnginesUsage() {
  const state = useHarnessState(), runs = useRuns();
  const sample = state.real === undefined;
  const [source, setSource] = useState<UsageSource>(() => initialSource(sample, runs));
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sample || runs === null) { setSource(initialSource(sample, runs)); setBusy(false); return undefined; }
    let live = true;
    setBusy(true);
    void readUsage(runs, () => live).then(next => {
      if (!live) return;
      setBusy(false);
      if (next.kind !== 'stopped') setSource(next);
    });
    return () => { live = false; };
  }, [sample, runs, round]);
  const view = useMemo(() => enginesView(state, source), [state, source]);
  const found = view.rows.filter(r => r.state !== 'not-found').length;
  const count = view.rows.length === 0 ? '' : `${found} found`;
  // The button stays enabled while a read runs, so keyboard focus is never dropped. A press while a read runs does nothing.
  const refresh = <HButton icon="play" disabled={sample || runs === null} onClick={() => { if (!busy) setRound(n => n + 1); }}>{busy ? ENGINES_WORDS.reading : ENGINES_WORDS.readAgain}</HButton>;
  return { view, count, refresh };
}

export function EnginesUsage(): ReactElement {
  const s = useEnginesUsage();
  return <Screen slot="engines-usage" title={ENGINES_WORDS.title} count={s.count === '' ? undefined : s.count} tools={s.refresh}><EnginesUsageBody view={s.view} /></Screen>;
}

/**
 * The module inside the Modules view. It reads the same state and draws the same stage. The frame is the view's, not this screen's: the count and the button sit in a row above the stage, and the page has no
 * second heading of the same level.
 */
export function EnginesUsageEmbedded(): ReactElement {
  const s = useEnginesUsage();
  return (
    <div className="hxu-embedded" data-module-screen="engines-usage">
      <div className="hxu-embedded-bar">
        <span className="hx-count">{s.count}</span>
        {s.refresh}
      </div>
      <EnginesUsageBody view={s.view} />
    </div>
  );
}
