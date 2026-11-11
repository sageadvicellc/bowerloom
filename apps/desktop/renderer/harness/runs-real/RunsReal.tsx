/**
 * S9, Runs, on the person's own folders (beta.2). A run here is a note the person keeps after they start an engine in their own Terminal: Bowerloom starts nothing and cannot see a process, so a run is
 * "Recorded" or "Done", and the person sets which. The list is main's saved file of runs (the bowerloomRuns bridge). Runs of one instruction in one project sit in one group with "Open compare".
 * "Add a run" opens a form for a run that was not recorded from Start. The details column shows the figures read from the engine's own session log, and says in words when there is no log or it could
 * not be read. The screen reaches main only through the runs bridge of the client; it never holds a path or a line of a chat.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RunView } from '../../../shared/api/runs.js';
import { engineName, realCompareGroupOf, realGroups, realRunById, realRunName, realStatusWords, startedAtWords } from '../../../shared/harness/runs-real.js';
import type { RealGroup } from '../../../shared/harness/runs-real.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useUi } from '../ui.js';
import type { Ui } from '../ui.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon, Tile } from '../icons.js';
import { RUN_WORDS, compareTitle, firstSentence } from '../runs-words.js';
import { RUNS_REAL, runsHintReal } from '../runs-real-words.js';
import { WORDS } from '../words.js';
import { FigureRows } from './FigureRows.js';
import { AddRunSheet } from './AddRunSheet.js';
import { useFigures, useRunList, useRuns } from './runs-session.js';
import type { RunListControl } from './runs-session.js';
import '../screens/runs.css';
import '../screens/compare.css';
import './runs-real.css';

const tone = (run: RunView): 'good' | 'quiet' => (run.status === 'done' ? 'good' : 'quiet');

function Row({ run, selected }: { run: RunView; selected: boolean }): ReactElement {
  return (
    <li className="hx-row hr-row" data-selected={selected ? '' : undefined} data-run={run.id} data-status={run.status}>
      <Tile name="play" size="large" />
      <div className="hx-row-text">
        <button type="button" className="hx-row-main" aria-pressed={selected} onClick={() => go({ name: 'runs', id: run.id })}>{realRunName(run)}</button>
        <span className="hx-row-meta">{`${run.projectName} · started ${startedAtWords(run.startedAt)}`}</span>
      </div>
      <StateDot tone={tone(run)} className="hx-row-state">{realStatusWords(run.status)}</StateDot>
    </li>
  );
}

function Group({ group, selectedId }: { group: RealGroup; selectedId: string | null }): ReactElement {
  const rows = group.runs.map(run => <Row key={run.id} run={run} selected={run.id === selectedId} />);
  if (!group.comparable) return <>{rows}</>;
  return (
    <li className="hr-group" data-group={group.id}>
      <div className="hr-group-head">
        <span className="hr-group-icon" aria-hidden="true"><HIcon name="columns" size={20} /></span>
        <h2 className="hr-group-title">{compareTitle(firstSentence(group.instruction))}</h2>
        <HButton icon="columns" onClick={() => go({ name: 'compare', group: group.id })}>{RUN_WORDS.label.openCompare}</HButton>
      </div>
      <ul className="hx-rows hr-group-rows" aria-label={compareTitle(firstSentence(group.instruction))}>{rows}</ul>
    </li>
  );
}

function Details({ run, runs, control, ui }: { run: RunView; runs: readonly RunView[]; control: RunListControl; ui: Ui }): ReactElement {
  const figures = useFigures(useRuns(), run.id);
  const group = realCompareGroupOf(runs, run);
  const [busy, setBusy] = useState(false);
  const toggle = (): void => {
    const done = run.status !== 'done';
    setBusy(true);
    void control.change(run.id, { status: done ? 'done' : 'recorded' }).then(code => { setBusy(false); ui.showToast(code === null ? (done ? RUNS_REAL.hint.doneToast : RUNS_REAL.hint.notDoneToast) : RUNS_REAL.hint.saveFailed); });
  };
  return (
    <>
      <div className="hx-dhead">
        <Tile name="play" size="large" />
        <div className="hx-dhead-text">
          <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{`${engineName(run)} run`}</h2>
          <StateDot tone={tone(run)} className="hr-dstate">{realStatusWords(run.status)}</StateDot>
        </div>
      </div>
      <section className="hx-block" aria-labelledby="hr-d-instruction">
        <h3 className="hx-h3" id="hr-d-instruction">{RUNS_REAL.label.instruction}</h3>
        <p className="hx-text">{run.instruction}</p>
      </section>
      <section className="hx-block" aria-labelledby="hr-d-where">
        <h3 className="hx-h3" id="hr-d-where">{RUNS_REAL.label.project}</h3>
        <p className="hx-text">{run.projectName}</p>
        <p className="hx-text hx-muted">{run.projectLabel}</p>
      </section>
      <section className="hx-block" aria-labelledby="hr-d-started">
        <h3 className="hx-h3" id="hr-d-started">{RUNS_REAL.label.started}</h3>
        <p className="hx-text">{startedAtWords(run.startedAt)}</p>
      </section>
      <section className="hx-block" aria-labelledby="hr-d-figures">
        <h3 className="hx-h3" id="hr-d-figures">{RUNS_REAL.label.figures}</h3>
        <FigureRows view={figures} />
      </section>
      <div className="hx-actions">
        <HButton variant="primary" disabled={busy} onClick={toggle} data-toggle-done="">{run.status === 'done' ? RUNS_REAL.label.markNotDone : RUNS_REAL.label.markDone}</HButton>
        {group === null ? null : <HButton icon="columns" onClick={() => go({ name: 'compare', group })}>{RUN_WORDS.label.openCompare}</HButton>}
      </div>
      <p className="hx-text hx-muted">{RUNS_REAL.paragraph.chatNote}</p>
    </>
  );
}

export function RunsReal({ id }: { id: string | null }): ReactElement {
  const bridge = useRuns(), ui = useUi();
  const control = useRunList(bridge);
  const [adding, setAdding] = useState(false);
  const runs = control.list.kind === 'ready' ? control.list.runs : [];
  const picked = id === null ? undefined : realRunById(runs, id);
  const selected = picked ?? (id === null ? runs[0] : undefined);
  const addButton = <HButton data-add-run="" variant="primary" disabled={bridge === null} onClick={() => setAdding(true)}>{RUNS_REAL.label.addRun}</HButton>;
  const sheet = <AddRunSheet open={adding} onClose={() => setAdding(false)} onRecorded={run => { control.replace(run); setAdding(false); go({ name: 'runs', id: run.id }); ui.showToast(RUNS_REAL.hint.recordedToast); }} />;
  if (bridge === null) {
    return <Screen slot="runs" title={WORDS.label.runs}><p className="kit-hint hx-hint" data-runs-state="no-bridge">{RUNS_REAL.hint.noBridge}</p></Screen>;
  }
  if (control.list.kind !== 'ready') {
    return (
      <Screen slot="runs" title={WORDS.label.runs} tools={addButton}>
        {control.list.kind === 'loading' ? <p className="kit-hint hx-hint" role="status" data-runs-state="loading">{RUNS_REAL.hint.listLoading}</p> : (
          <><p className="kit-hint hx-hint" role="alert" data-runs-state="failed">{RUNS_REAL.hint.listFailed}</p><div className="hx-actions"><HButton onClick={control.reload}>{RUNS_REAL.label.tryAgain}</HButton></div></>
        )}
        {sheet}
      </Screen>
    );
  }
  if (id !== null && picked === undefined) {
    return (
      <Screen slot="runs" title={WORDS.label.runs} tools={addButton}>
        <p className="kit-hint hx-hint">{RUN_WORDS.hint.noRun}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'runs' })}>{WORDS.label.runs}</HButton></div>
        {sheet}
      </Screen>
    );
  }
  return (
    <Screen slot="runs" title={WORDS.label.runs} tools={addButton} details={selected === undefined ? undefined : <Details key={selected.id} run={selected} runs={runs} control={control} ui={ui} />}>
      <p className="kit-hint hx-hint">{runsHintReal(runs.length)}</p>
      {runs.length === 0 ? <p className="kit-hint hx-hint" data-runs-state="empty">{RUN_WORDS.hint.noRunsReal}</p> : (
        <ul className="hx-rows hr-list" aria-label={RUN_WORDS.label.runsList}>
          {realGroups(runs).map(group => <Group key={group.id} group={group} selectedId={selected?.id ?? null} />)}
        </ul>
      )}
      {sheet}
    </Screen>
  );
}
