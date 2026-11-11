/**
 * S9, Compare, on the person's own folders (beta.2). The recorded runs of one instruction in one project, side by side, one column for each run: the engine, the status, the figures read from that
 * engine's own session log, a box for notes and a rating (Better, Same or Worse). The rating unlocks when the run is marked done. "Save rating and notes" saves in main's own file of runs.
 * It compares one task across engines: it does not compare versions of a harness. A figure the log did not hold is "Not read", never a zero.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { RUN_NOTES_LIMIT } from '../../../shared/api/runs.js';
import type { RunRating, RunView } from '../../../shared/api/runs.js';
import { REAL_RATINGS, canRateReal, engineName, realGroupById, realRateQuestion, realStatusWords, runsRefusalWords, saveReportWords, startedAtWords } from '../../../shared/harness/runs-real.js';
import { ratingWords, sameInstructionWords } from '../../../shared/harness/runs.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useUi } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { RUN_WORDS } from '../runs-words.js';
import { RUNS_REAL } from '../runs-real-words.js';
import { FigureRows } from './FigureRows.js';
import { useFigures, useRunList, useRuns } from './runs-session.js';
import type { RunListControl } from './runs-session.js';
import '../screens/compare.css';
import './runs-real.css';

interface Draft { readonly rating: RunRating | null; readonly notes: string }

interface ColumnProps { run: RunView; draft: Draft; control: RunListControl; onRating(rating: RunRating): void; onNotes(notes: string): void; onFailed(code: string): void; onSynced(id: string): void }

function Column({ run, draft, control, onRating, onNotes, onFailed, onSynced }: ColumnProps): ReactElement {
  const figures = useFigures(useRuns(), run.id);
  const name = engineName(run), open = canRateReal(run);
  const noteId = `hc-notes-${run.id}`, askId = `hc-ask-${run.id}`;
  const toggle = (): void => { void control.change(run.id, { status: run.status === 'done' ? 'recorded' : 'done' }).then(code => { if (code !== null) onFailed(code); else onSynced(run.id); }); };
  return (
    <section className="hc-col" data-run={run.id} data-status={run.status} aria-label={`${name}, ${realStatusWords(run.status)}`}>
      <header className="hc-col-head">
        <Tile name="monitor" size="large" />
        <h2 className="hc-col-title">{name}</h2>
        <StateDot tone={run.status === 'done' ? 'good' : 'quiet'}>{realStatusWords(run.status)}</StateDot>
      </header>
      <p className="hx-text">{run.projectName}</p>
      <p className="hx-text hc-muted">{`${RUNS_REAL.label.started} ${startedAtWords(run.startedAt)}.`}</p>
      <FigureRows view={figures} label={run.projectLabel} />
      <div className="hc-bring"><HButton data-toggle-done={run.id} onClick={toggle}>{run.status === 'done' ? RUNS_REAL.label.markNotDone : RUNS_REAL.label.markDone}</HButton></div>
      <label className="hc-label" htmlFor={noteId}>{RUNS_REAL.label.yourNotes}</label>
      <textarea id={noteId} className="hc-notes" maxLength={RUN_NOTES_LIMIT} value={draft.notes} onChange={e => onNotes(e.target.value)} rows={4} />
      <p className="hc-ask" id={askId}>{realRateQuestion(run)}</p>
      <div className="hc-rating" role="group" aria-labelledby={askId} data-locked={open ? undefined : ''}>
        {REAL_RATINGS.map(rating => (
          <button key={rating} type="button" className="kit-button hc-rate" data-variant="quiet" aria-pressed={draft.rating === rating} aria-disabled={open ? undefined : 'true'}
            onClick={() => { if (open) onRating(rating); }}>{ratingWords(rating)}</button>
        ))}
      </div>
    </section>
  );
}

export function CompareReal({ group }: { group: string }): ReactElement {
  const bridge = useRuns(), ui = useUi();
  const control = useRunList(bridge);
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [saved, setSaved] = useState(false);
  const close = (): void => go({ name: 'runs' });
  const closeTool = <HIconButton icon="close" label={RUN_WORDS.label.close} tip={RUN_WORDS.label.closeCompare} side="below-end" onClick={close} />;
  if (bridge === null) return <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}><p className="kit-hint hx-hint" data-compare-state="no-bridge">{RUNS_REAL.hint.noBridge}</p></Screen>;
  if (control.list.kind !== 'ready') {
    return (
      <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}>
        {control.list.kind === 'loading' ? <p className="kit-hint hx-hint" role="status">{RUNS_REAL.hint.listLoading}</p> : <p className="kit-hint hx-hint" role="alert" data-compare-state="failed">{RUNS_REAL.hint.listFailed}</p>}
      </Screen>
    );
  }
  const found = realGroupById(control.list.runs, group);
  if (found === undefined) {
    return (
      <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}>
        <p className="kit-hint hx-hint">{RUN_WORDS.hint.noGroup}</p>
        <div className="hc-foot"><HButton variant="primary" onClick={close}>{RUN_WORDS.label.closeCompare}</HButton></div>
      </Screen>
    );
  }
  const runs = found.runs;
  const draftOf = (run: RunView): Draft => drafts[run.id] ?? { rating: run.rating, notes: run.notes };
  const change = (run: RunView, next: Partial<Draft>): void => { setSaved(false); setDrafts(current => ({ ...current, [run.id]: { ...draftOf(run), ...next } })); };
  /** The draft of a run is dropped, so the box and the rating show what main answered. */
  const synced = (id: string): void => setDrafts(current => { const { [id]: _gone, ...rest } = current; return rest; });
  const save = (): void => {
    // A run that is not done keeps its notes only; a run that is done saves its rating and notes. Each run is reported on its own.
    const jobs = runs.map(run => { const d = draftOf(run); return control.change(run.id, canRateReal(run) ? { rating: d.rating, notes: d.notes } : { notes: d.notes }); });
    void Promise.all(jobs).then(codes => {
      const report = runs.map((run, at) => ({ name: engineName(run), code: codes[at] ?? null }));
      for (const [at, run] of runs.entries()) if (codes[at] === null) synced(run.id);
      const ok = report.every(r => r.code === null);
      setSaved(ok);
      ui.showToast(ok ? RUNS_REAL.hint.savedToast : saveReportWords(report));
    });
  };
  return (
    <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}>
      <div className="hc-same">
        <p className="hc-same-label">{runs.length < 2 ? RUNS_REAL.label.instruction : sameInstructionWords(runs.length)}</p>
        <p className="hc-same-text">{found.instruction}</p>
      </div>
      {found.comparable ? null : <p className="kit-hint hx-hint" data-compare-state="one">{RUNS_REAL.hint.compareNeedTwo}</p>}
      <div className="hc-cols" data-count={runs.length}>
        {runs.map(run => (
          <Column key={run.id} run={run} draft={draftOf(run)} control={control} onFailed={code => ui.showToast(runsRefusalWords(code))} onSynced={synced}
            onRating={rating => change(run, { rating: draftOf(run).rating === rating ? null : rating })} onNotes={notes => change(run, { notes })} />
        ))}
      </div>
      <div className="hc-foot">
        <p className="hc-saved" role="status" data-saved={saved ? '' : undefined}>{RUNS_REAL.hint.saved}</p>
        <div className="hc-foot-actions">
          <HButton onClick={close}>{RUN_WORDS.label.closeCompare}</HButton>
          <HButton icon="save-clock" variant="primary" data-save-compare="" onClick={save}>{RUN_WORDS.label.saveRating}</HButton>
        </div>
      </div>
    </Screen>
  );
}
