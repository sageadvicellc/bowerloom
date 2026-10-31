/**
 * S9, the list of runs. Runs of one instruction that were started together sit in one group with "Open compare". Each row has a dot and words for its status (Running, Done, Closed), computed from
 * the store, so it agrees with Compare and the details. Picking a row fills the details column: the instruction, the harness and project, the start time, "Bring window to the front" and "Open compare".
 * "Bring window to the front" does nothing in the preview, because the preview opens no window; its tooltip says what the full app does. The app does not read or keep the chat, and the screen says so.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { runById, runGroups, runMeta, runName, runStatusWords, runTitle, runTone, runWhere, compareGroupOf, runsHint } from '../../../shared/harness/runs.js';
import type { RunGroup } from '../../../shared/harness/runs.js';
import { stampAtWords } from '../../../shared/harness/time.js';
import type { HarnessState, Run } from '../../../shared/harness/types.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import type { Ui } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { HIcon, Tile } from '../icons.js';
import { RUN_WORDS, bringName, compareTitle, firstSentence } from '../runs-words.js';
import { WORDS } from '../words.js';
import './runs.css';

/** The preview opens no window: it says what the full app would do. */
const bringToFront = (ui: Ui): void => ui.showToast(RUN_WORDS.hint.bringToast);

function RunRow({ state, run, selected, ui }: { state: HarnessState; run: Run; selected: boolean; ui: Ui }): ReactElement {
  return (
    <li className="hx-row hr-row" data-selected={selected ? '' : undefined} data-run={run.id} data-status={run.status}>
      <Tile name="play" size="large" />
      <div className="hx-row-text">
        <button type="button" className="hx-row-main" aria-pressed={selected} onClick={() => go({ name: 'runs', id: run.id })}>{runName(state, run)}</button>
        <span className="hx-row-meta">{runMeta(state, run)}</span>
      </div>
      <StateDot tone={runTone(run.status)} className="hx-row-state">{runStatusWords(run.status)}</StateDot>
      <span className="hx-row-action"><HIconButton icon="fit" label={bringName(runName(state, run))} tip={RUN_WORDS.hint.bringTip} side="below-end" onClick={() => bringToFront(ui)} /></span>
    </li>
  );
}

function Group({ state, group, selectedId, ui }: { state: HarnessState; group: RunGroup; selectedId: string | null; ui: Ui }): ReactElement {
  const rows = group.runs.map(run => <RunRow key={run.id} state={state} run={run} selected={run.id === selectedId} ui={ui} />);
  if (!group.comparable || group.id === null) return <>{rows}</>;
  const groupId = group.id;
  return (
    <li className="hr-group" data-group={groupId}>
      <div className="hr-group-head">
        <span className="hr-group-icon" aria-hidden="true"><HIcon name="columns" size={20} /></span>
        <h2 className="hr-group-title">{compareTitle(firstSentence(group.instruction))}</h2>
        <HButton icon="columns" onClick={() => go({ name: 'compare', group: groupId })}>{RUN_WORDS.label.openCompare}</HButton>
      </div>
      <ul className="hx-rows hr-group-rows" aria-label={compareTitle(firstSentence(group.instruction))}>{rows}</ul>
    </li>
  );
}

function Details({ state, run, ui }: { state: HarnessState; run: Run; ui: Ui }): ReactElement {
  const group = compareGroupOf(state, run);
  return (
    <>
      <div className="hx-dhead">
        <Tile name="play" size="large" />
        <div className="hx-dhead-text">
          <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{runTitle(state, run)}</h2>
          <StateDot tone={runTone(run.status)} className="hr-dstate">{runStatusWords(run.status)}</StateDot>
        </div>
      </div>
      <section className="hx-block" aria-labelledby="hr-d-instruction">
        <h3 className="hx-h3" id="hr-d-instruction">{RUN_WORDS.label.instruction}</h3>
        <p className="hx-text">{run.instruction}</p>
      </section>
      <section className="hx-block" aria-labelledby="hr-d-where">
        <h3 className="hx-h3" id="hr-d-where">{RUN_WORDS.label.harnessAndProject}</h3>
        <p className="hx-text">{runWhere(state, run)}</p>
      </section>
      <section className="hx-block" aria-labelledby="hr-d-started">
        <h3 className="hx-h3" id="hr-d-started">{RUN_WORDS.label.started}</h3>
        <p className="hx-text">{stampAtWords(run.started)}</p>
      </section>
      <div className="hx-actions">
        <HButton icon="fit" variant="primary" onClick={() => bringToFront(ui)}>{RUN_WORDS.label.bringFront}</HButton>
        {group === null ? null : <HButton icon="columns" onClick={() => go({ name: 'compare', group })}>{RUN_WORDS.label.openCompare}</HButton>}
      </div>
      <p className="hx-text hx-muted">{RUN_WORDS.paragraph.chatNote}</p>
    </>
  );
}

export function Runs({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), ui = useUi();
  const [query, setQuery] = useState<string | null>(null);
  const picked = id === null ? undefined : runById(state, id);
  const selected = picked ?? (id === null ? state.runs[0] : undefined);
  const needle = (query ?? '').trim().toLowerCase();
  const shown = needle === '' ? state.runs : state.runs.filter(r => runName(state, r).toLowerCase().includes(needle) || r.instruction.toLowerCase().includes(needle));
  const groups = runGroups({ ...state, runs: shown });
  if (id !== null && picked === undefined) {
    return (
      <Screen slot="runs" title={WORDS.label.runs}>
        <p className="kit-hint hx-hint">{RUN_WORDS.hint.noRun}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'runs' })}>{WORDS.label.runs}</HButton></div>
      </Screen>
    );
  }
  return (
    <Screen slot="runs" title={WORDS.label.runs} details={selected === undefined ? undefined : <Details state={state} run={selected} ui={ui} />}
      tools={<HIconButton icon="search" label={WORDS.label.search} side="below" aria-pressed={query !== null} onClick={() => setQuery(q => (q === null ? '' : null))} />}>
      <p className="kit-hint hx-hint">{runsHint(state.runs.length)}</p>
      {query === null ? null : (
        <label className="hx-search">
          <HIcon name="search" size={18} />
          <input type="search" value={query} autoFocus placeholder={WORDS.label.search} aria-label={WORDS.label.search} onChange={e => setQuery(e.target.value)} />
        </label>
      )}
      {state.runs.length === 0 ? <p className="kit-hint hx-hint">{RUN_WORDS.hint.noRuns}</p> : null}
      {state.runs.length > 0 && shown.length === 0 ? <p className="kit-hint hx-hint">{WORDS.hint.noMatch}</p> : null}
      {shown.length === 0 ? null : (
        <ul className="hx-rows hr-list" aria-label={RUN_WORDS.label.runsList}>
          {groups.map(group => <Group key={group.id ?? group.runs[0]!.id} state={state} group={group} selectedId={selected?.id ?? null} ui={ui} />)}
        </ul>
      )}
    </Screen>
  );
}
