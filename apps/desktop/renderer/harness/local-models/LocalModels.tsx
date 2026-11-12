/**
 * Local models: which model servers run on this computer, one card each. The title is the model name and the port. A card shows the state (up, starting, not answering, not supported, down), the model file name, quantization, size, context size,
 * speed, requests and context use, and "not reported" for memory and uptime (no process is read). A figure the server did not give reads "not reported", never 0. A server that is down, not answering or starting is a compact card: the title, the state and a sentence.
 * The screen reads again every few seconds while the page is visible, and has a Refresh button. It stores nothing. All display logic is in shared/local-models/view-model.ts.
 * Structure copied from Install history (screens/History.tsx): Screen, a hint line, then a list of rows with a tile, a name and a state dot.
 */
import { memo, useMemo } from 'react';
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { LOCAL_WORDS, viewOf } from '../../../shared/local-models/view-model.js';
import type { Row } from '../../../shared/local-models/view-model.js';
import type { LocalModelsReport, SkippedExtension } from '../../../shared/local-models/types.js';
import { useLocal, useSkipped } from './local.js';
import { useLocalReport } from './useLocalReport.js';
import type { Announce } from './useLocalReport.js';
import type { ReportView } from '../../../shared/local-models/view-model.js';
import './local-models.css';

/** One card. The rows of a view are the same objects while the figures are the same, so a read of the same figures draws no card again. */
const ModelRow = memo(function ModelRow({ row }: { row: Row }): ReactElement {
  const titleId = `hxl-name-${row.id}`;
  return (
    <li className="hx-row hxl-row" data-model={row.id} data-state={row.stateText} data-compact={row.compact ? '' : undefined} aria-labelledby={titleId}>
      <span className="hx-tile" aria-hidden="true"><HIcon name="monitor" size={20} /></span>
      <div className="hx-row-text hxl-text">
        <div className="hxl-head">
          <h2 className="hxl-name" id={titleId}>{row.name}</h2>
          <StateDot tone={row.tone} className="hx-row-state">{row.stateText}</StateDot>
        </div>
        {row.why === null ? null : <p className="hx-text hx-muted hxl-why">{row.why}</p>}
        {row.notes.map((note, i) => <p key={`${i}-${note}`} className="hx-text hx-muted hxl-why" data-row-note="">{note}</p>)}
        {row.facts.length === 0 ? null : (
          <dl className="hxl-facts">
            {row.facts.map(fact => (
              <div key={fact.key} className="hxl-fact" data-fact={fact.key} data-reported={fact.reported ? '' : undefined}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
});

export const HOST_WORDS = Object.freeze({ notStarted: 'The extension host has not started yet. Trying again.', skipped: 'These extensions could not be loaded.', unavailable: 'The Local models extension did not load.' });

export interface PendingProps {
  /** The short code of the failure of the extension list, once it has failed a few times. */
  readonly problem?: string | null;
  /** The extensions main could not load, with the short code of each. */
  readonly skipped?: readonly SkippedExtension[];
  /** False once the list has answered and this extension is still not there: the waiting line is then not true. */
  readonly loading?: boolean;
}

/**
 * The screen while the extension list has not answered yet at launch. The host may not be ready for a moment, so it starts as a plain waiting line and never an error. After a few failed tries it says
 * that the extension host has not started, with the code, and the tries go on. Extensions that main skipped are listed with the code of each.
 */
export function LocalModelsPending(props: PendingProps = {}): ReactElement {
  return <Screen slot="local-models" title={LOCAL_WORDS.title}><PendingBody {...props} /></Screen>;
}

/** The lines of the waiting screen, without the screen around them. */
export function PendingBody({ problem = null, skipped = [], loading = true }: PendingProps): ReactElement {
  return (
    <>
      {problem === null
        ? <p className="kit-hint hx-hint" role="status" data-local-pending="">{loading ? LOCAL_WORDS.loading : HOST_WORDS.unavailable}</p>
        : <p className="kit-hint hx-hint" role="status" data-local-pending="" data-local-problem={problem}>{HOST_WORDS.notStarted} Code: {problem}.</p>}
      <SkippedNotice skipped={skipped} />
    </>
  );
}

/** The extensions main skipped: names and short codes only. Nothing when none was skipped. */
export function SkippedNotice({ skipped = [] }: { skipped?: readonly SkippedExtension[] }): ReactElement | null {
  if (skipped.length === 0) return null;
  return (
    <div data-local-skipped="">
      <p className="hx-text">{HOST_WORDS.skipped}</p>
      <ul>{skipped.map((x, i) => <li key={`${i}-${x.name}`} data-skipped={x.name}>{x.name}. Code: {x.code}.</li>)}</ul>
    </div>
  );
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
  /** The short code of the newest failed read, shown beside the words of the failure. */
  readonly code?: string | null;
  /** The view of the report, when the caller has made it already (the screen does), so it is made once. A body drawn alone makes its own. */
  readonly view?: ReportView | null;
}

/** A status line that only a screen reader hears. It is always on the page, so that a change in it is read out. */
export function ReadAnnouncer({ announce }: { announce: Announce }): ReactElement {
  return <p className="hxl-sr-only" role="status" data-local-announce="">{announce === 'reading' ? LOCAL_WORDS.refreshing : announce === 'updated' ? LOCAL_WORDS.updated : announce === 'failed' ? LOCAL_WORDS.readFailed : ''}</p>;
}

/** What the stage shows. Every state has words: no bridge, loading, retrying, a failed probe, no server set up, and the rows. A failed probe shows the note's sentence and never the empty state. */
export function LocalModelsBody({ available, sample, report, failed, stale, busy, code = null, view: given }: BodyProps): ReactElement {
  // Every hook runs before the early return, so the bridge can come and go without a change in the order of hooks.
  const own = useMemo(() => (given !== undefined || report === null ? null : viewOf(report)), [given, report]);
  const view = given !== undefined ? given : own;
  if (!available) return <p className="kit-hint hx-hint" role="status" data-local-state="no-bridge">{LOCAL_WORDS.noBridge}</p>;
  const codeLine = code === null ? null : ` Code: ${code}.`;
  return (
    <div className="hxl-body" aria-busy={busy}>
      {sample ? <p className="kit-hint hx-hint" data-local-sample="">{LOCAL_WORDS.sample}</p> : null}
      {view === null ? <p className="kit-hint hx-hint" role="status" data-local-state={failed ? 'retrying' : 'loading'}>{failed ? `${LOCAL_WORDS.failedFirst}${codeLine ?? ''}` : LOCAL_WORDS.loading}</p> : null}
      {view !== null && stale ? <p className="kit-hint hx-hint" role="status" data-local-state="stale">{LOCAL_WORDS.stale}{failed ? codeLine : null}</p> : null}
      {view === null ? null : view.sentences.map((sentence, i) => <p key={view.sentenceKeys[i]} className="hx-text" data-local-note="">{sentence}</p>)}
      {view === null || view.kind !== 'empty' ? null : <p className="hx-text" data-local-state="empty">{LOCAL_WORDS.empty}</p>}
      {view === null || view.kind !== 'rows' ? null : <ul className="hxl-list" aria-label={LOCAL_WORDS.list}>{view.rows.map(row => <ModelRow key={row.id} row={row} />)}</ul>}
    </div>
  );
}

export function LocalModels(): ReactElement {
  const s = useLocalScreen();
  const { view } = s;
  return (
    <Screen slot="local-models" title={LOCAL_WORDS.title} count={view === null || view.summary === null ? undefined : view.summary} tools={s.refresh}>
      <LocalStage s={s} />
    </Screen>
  );
}

/** The state of the screen: the bridge, the report and what the Refresh button does. The same hooks serve the page of its own and the copy inside the Modules view. */
function useLocalScreen() {
  const { bridge, sample } = useLocal();
  const skipped = useSkipped();
  const state = useLocalReport(bridge);
  const view = useMemo(() => (state.report === null ? null : viewOf(state.report)), [state.report]);
  // Refresh stays enabled while a read runs, so keyboard focus is never dropped. The hook ignores a click while a read runs.
  const refresh = <HButton icon="play" disabled={bridge === null} onClick={state.refresh}>{LOCAL_WORDS.refresh}</HButton>;
  return { bridge, sample, skipped, state, view, refresh };
}
type LocalScreen = ReturnType<typeof useLocalScreen>;

/** What the stage shows, with its announcer and the skipped notice. The page of its own and the copy inside the Modules view draw the same stage. */
function LocalStage({ s }: { s: LocalScreen }): ReactElement {
  return (
    <>
      <ReadAnnouncer announce={s.state.announce} />
      <SkippedNotice skipped={s.skipped} />
      <LocalModelsBody available={s.bridge !== null} sample={s.sample} report={s.state.report} view={s.view} failed={s.state.failed} stale={s.state.report !== null && s.state.stale} busy={s.state.busy} code={s.state.code} />
    </>
  );
}

/**
 * Local models as a module inside the Modules view. It reads the same report through the same hook and draws the same stage (the cards, the notes, the sample line, the skipped notice). The frame is the view's, not
 * this screen's: the count and the Refresh button sit in a row above the stage, and the page has no second heading of the same level.
 */
export function LocalModelsEmbedded(): ReactElement {
  const s = useLocalScreen();
  return (
    <div className="hxl-embedded" data-module-screen="local-models">
      <div className="hxl-embedded-bar">
        <span className="hx-count">{s.view === null || s.view.summary === null ? '' : s.view.summary}</span>
        {s.refresh}
      </div>
      <LocalStage s={s} />
    </div>
  );
}
