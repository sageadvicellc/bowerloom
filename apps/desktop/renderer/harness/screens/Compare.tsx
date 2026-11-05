/**
 * S9, Compare. The runs of one instruction side by side, under the shared instruction. Each column has the interface, the status (a dot and words), where it runs, how long its window has been open,
 * "Bring window to the front" (it does nothing in the preview), a box for notes and a rating: Better, Same or Worse. The rating is locked until that run is done, and the words next to it say why.
 * "Save rating and notes" saves in memory (store.rateRun) and the line at the foot says where it saved. Statuses come from the store, so they agree with the Runs list.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { RATINGS, canRate, compareStartedLine, ratingWords, rateQuestion, runStatusWords, runTone, runWhere, runsOfGroup, sameInstructionWords } from '../../../shared/harness/runs.js';
import { interfaceById } from '../../../shared/harness/status.js';
import type { HarnessState, Rating, Run } from '../../../shared/harness/types.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { useNow } from '../useNow.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { RUN_WORDS, bringToastWords, stillRunning } from '../runs-words.js';
import './compare.css';

interface Draft { readonly rating: Rating | null; readonly notes: string }

interface ColumnProps {
  state: HarnessState; run: Run; draft: Draft; now: ReturnType<typeof useNow>;
  onRating(rating: Rating): void; onNotes(notes: string): void; onBring(): void;
}

function Column({ state, run, draft, now, onRating, onNotes, onBring }: ColumnProps): ReactElement {
  const name = interfaceById(state, run.interfaceId)?.name ?? run.interfaceId;
  const open = canRate(run);
  const noteId = `hc-notes-${run.id}`, askId = `hc-ask-${run.id}`;
  return (
    <section className="hc-col" data-run={run.id} data-status={run.status} aria-label={`${name}, ${runStatusWords(run.status)}`}>
      <header className="hc-col-head">
        <Tile name="monitor" size="large" />
        <h2 className="hc-col-title">{name}</h2>
        <StateDot tone={runTone(run.status)}>{runStatusWords(run.status)}</StateDot>
      </header>
      <p className="hx-text">{runWhere(state, run)}</p>
      <p className="hx-text hc-muted">{compareStartedLine(run, now)}</p>
      <div className="hc-bring"><HButton icon="fit" onClick={onBring}>{RUN_WORDS.label.bringFront}</HButton></div>
      <label className="hc-label" htmlFor={noteId}>{RUN_WORDS.label.yourNotes}</label>
      <textarea id={noteId} className="hc-notes" value={draft.notes} onChange={e => onNotes(e.target.value)} rows={4} />
      <p className="hc-ask" id={askId}>{rateQuestion(run)}</p>
      <div className="hc-rating" role="group" aria-labelledby={askId} data-locked={open ? undefined : ''}>
        {RATINGS.map(rating => (
          <button key={rating} type="button" className="kit-button hc-rate" data-variant="quiet" aria-pressed={draft.rating === rating} aria-disabled={open ? undefined : 'true'}
            onClick={() => { if (open) onRating(rating); }}>{ratingWords(rating)}</button>
        ))}
      </div>
    </section>
  );
}

export function Compare({ group }: { group: string }): ReactElement {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi(), now = useNow();
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [saved, setSaved] = useState(false);
  const runs = runsOfGroup(state, group);
  const close = (): void => go({ name: 'runs' });
  const closeTool = <HIconButton icon="close" label={RUN_WORDS.label.close} tip={RUN_WORDS.label.closeCompare} side="below-end" onClick={close} />;
  if (runs.length === 0) {
    return (
      <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}>
        <p className="kit-hint hx-hint">{RUN_WORDS.hint.noGroup}</p>
        <div className="hc-foot"><HButton variant="primary" onClick={close}>{RUN_WORDS.label.closeCompare}</HButton></div>
      </Screen>
    );
  }
  const draftOf = (run: Run): Draft => drafts[run.id] ?? { rating: run.rating, notes: run.notes };
  const change = (run: Run, next: Partial<Draft>): void => { setSaved(false); setDrafts(current => ({ ...current, [run.id]: { ...draftOf(run), ...next } })); };
  const nameOf = (run: Run): string => interfaceById(state, run.interfaceId)?.name ?? run.interfaceId;
  const save = (): void => {
    // A run that is still running keeps what it had, so its notes wait in the box until it is done.
    const waiting = runs.filter(r => !canRate(r) && (draftOf(r).notes !== r.notes));
    for (const run of runs) if (canRate(run)) { const d = draftOf(run); store.rateRun(run.id, d.rating, d.notes); }
    setSaved(true);
    ui.showToast(waiting.length === 0 ? RUN_WORDS.hint.savedToast : stillRunning(waiting.map(nameOf)));
  };
  return (
    <Screen slot="compare" title={RUN_WORDS.label.compare} tools={closeTool}>
      <div className="hc-same">
        <p className="hc-same-label">{sameInstructionWords(runs.length)}</p>
        <p className="hc-same-text">{runs[0]!.instruction}</p>
      </div>
      <div className="hc-cols" data-count={runs.length}>
        {runs.map(run => (
          <Column key={run.id} state={state} run={run} draft={draftOf(run)} now={now}
            onRating={rating => change(run, { rating: draftOf(run).rating === rating ? null : rating })} onNotes={notes => change(run, { notes })}
            onBring={() => ui.showToast(bringToastWords(state.real !== undefined))} />
        ))}
      </div>
      <div className="hc-foot">
        <p className="hc-saved" role="status" data-saved={saved ? '' : undefined}>{RUN_WORDS.hint.saved}</p>
        <div className="hc-foot-actions">
          <HButton onClick={close}>{RUN_WORDS.label.closeCompare}</HButton>
          <HButton icon="save-clock" variant="primary" onClick={save}>{RUN_WORDS.label.saveRating}</HButton>
        </div>
      </div>
    </Screen>
  );
}
