/**
 * Local models: which model servers run on this computer, one row each. A row shows the state (up, starting, not answering, not supported, down), the model file name, quantization, size, context size,
 * speed, requests, context use and port, and "not reported" for memory and uptime (no process is read). A figure the server did not give reads "not reported", never 0. A server that is down is a state with a sentence.
 * The screen reads again every few seconds while the page is visible, and has a Refresh button. It stores nothing. All display logic is in shared/local-models/view-model.ts.
 * Structure copied from Install history (screens/History.tsx): Screen, a hint line, then a list of rows with a tile, a name and a state dot.
 */
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { LOCAL_WORDS, isStale, viewOf } from '../../../shared/local-models/view-model.js';
import type { Row } from '../../../shared/local-models/view-model.js';
import type { LocalModelsReport } from '../../../shared/local-models/types.js';
import { useLocal } from './local.js';
import { useLocalReport } from './useLocalReport.js';
import './local-models.css';

function ModelRow({ row }: { row: Row }): ReactElement {
  const titleId = `hxl-name-${row.id}`;
  return (
    <li className="hx-row hxl-row" data-model={row.id} data-state={row.stateText} aria-labelledby={titleId}>
      <span className="hx-tile" aria-hidden="true"><HIcon name="monitor" size={20} /></span>
      <div className="hx-row-text hxl-text">
        <div className="hxl-head">
          <h2 className="hxl-name" id={titleId}>{row.name}</h2>
          <StateDot tone={row.tone} className="hx-row-state">{row.stateText}</StateDot>
        </div>
        {row.why === null ? null : <p className="hx-text hx-muted hxl-why">{row.why}</p>}
        {row.notes.map(note => <p key={note} className="hx-text hx-muted hxl-why" data-row-note="">{note}</p>)}
        <dl className="hxl-facts">
          {row.facts.map(fact => (
            <div key={fact.key} className="hxl-fact" data-fact={fact.key} data-reported={fact.reported ? '' : undefined}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  );
}

/** The screen while the extension list has not answered yet at launch. The host may not be ready for a moment, so this is a plain waiting line and never an error. */
export function LocalModelsPending(): ReactElement {
  return <Screen slot="local-models" title={LOCAL_WORDS.title}><p className="kit-hint hx-hint" role="status" data-local-pending="">{LOCAL_WORDS.loading}</p></Screen>;
}

export interface BodyProps {
  /** False when the window has no local bridge. */
  readonly available: boolean;
  readonly sample: boolean;
  readonly report: LocalModelsReport | null;
  /** True when the newest read failed. */
  readonly failed: boolean;
  /** True when the last good read is old, or the newest read failed. */
  readonly stale: boolean;
  readonly busy: boolean;
}

/** What the stage shows. Every state has words: no bridge, loading, retrying, a failed probe, no server set up, and the rows. A failed probe shows the note's sentence and never the empty state. */
export function LocalModelsBody({ available, sample, report, failed, stale, busy }: BodyProps): ReactElement {
  if (!available) return <p className="kit-hint hx-hint" role="status" data-local-state="no-bridge">{LOCAL_WORDS.noBridge}</p>;
  const view = report === null ? null : viewOf(report);
  return (
    <div className="hxl-body" aria-busy={busy}>
      {sample ? <p className="kit-hint hx-hint" data-local-sample="">{LOCAL_WORDS.sample}</p> : null}
      {view === null ? <p className="kit-hint hx-hint" role="status" data-local-state={failed ? 'retrying' : 'loading'}>{failed ? LOCAL_WORDS.failedFirst : LOCAL_WORDS.loading}</p> : null}
      {view !== null && stale ? <p className="kit-hint hx-hint" role="status" data-local-state="stale">{LOCAL_WORDS.stale}</p> : null}
      {view === null ? null : view.sentences.map(sentence => <p key={sentence} className="hx-text" data-local-note="">{sentence}</p>)}
      {view === null || view.kind !== 'empty' ? null : <p className="hx-text" data-local-state="empty">{LOCAL_WORDS.empty}</p>}
      {view === null || view.kind !== 'rows' ? null : <ul className="hxl-list" aria-label={LOCAL_WORDS.list}>{view.rows.map(row => <ModelRow key={row.id} row={row} />)}</ul>}
    </div>
  );
}

export function LocalModels(): ReactElement {
  const { bridge, sample } = useLocal();
  const state = useLocalReport(bridge);
  const view = state.report === null ? null : viewOf(state.report);
  const stale = state.report !== null && isStale(state.failed, state.at, Date.now());
  const refresh = <HButton icon="play" disabled={bridge === null || state.busy} onClick={state.refresh}>{LOCAL_WORDS.refresh}</HButton>;
  return (
    <Screen slot="local-models" title={LOCAL_WORDS.title} count={view === null || view.summary === null ? undefined : view.summary} tools={refresh}>
      <LocalModelsBody available={bridge !== null} sample={sample} report={state.report} failed={state.failed} stale={stale} busy={state.busy} />
    </Screen>
  );
}
