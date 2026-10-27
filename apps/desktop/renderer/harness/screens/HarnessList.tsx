/**
 * S2, the Harness list. Each harness is a row: its counts, its status (the worst state over its projects, computed from the install data), and a play button.
 * Picking a row goes to the address of that harness (`#harnesses/<id>`), so the address and the details column agree; the details show: where it runs, where it is installed, and three buttons.
 * "Start" and the play button open the start sheet for the harness of their row, "Open in builder" opens the builder, "Assign to project" opens the install sheet at its first step.
 * An address that names no harness shows "That harness is not here", not the first harness.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { harnessCountsWords, harnessStatus, installLine, installsOfHarness, projectById, runsIn } from '../../../shared/harness/status.js';
import type { Harness, HarnessState } from '../../../shared/harness/types.js';
import { DetailsHead, Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { HIcon, Tile } from '../icons.js';
import { WORDS, harnessListHint, startName } from '../words.js';
import { NotChecked } from '../real/NotChecked.js';

function Row({ harness, state, selected, onPick, onStart }: { harness: Harness; state: HarnessState; selected: boolean; onPick(): void; onStart(): void }): ReactElement {
  const status = harnessStatus(state, harness.id);
  return (
    <li className="hx-row hx-row-harness" data-selected={selected ? '' : undefined} data-harness={harness.id}>
      <Tile name="harness" size="large" />
      <div className="hx-row-text">
        <button type="button" className="hx-row-main" aria-pressed={selected} onClick={onPick}>{harness.name}</button>
        <span className="hx-row-meta">{harnessCountsWords(state, harness)}</span>
      </div>
      <StateDot tone={status.tone} className="hx-row-state">{status.words}</StateDot>
      <span className="hx-row-action"><HIconButton icon="play" label={startName(harness.name)} tip={WORDS.label.start} side="below-end" onClick={onStart} /></span>
    </li>
  );
}

function Details({ harness, state }: { harness: Harness; state: HarnessState }): ReactElement {
  const ui = useUi();
  const installs = installsOfHarness(state, harness.id);
  return (
    <>
      <DetailsHead tile={<Tile name="harness" size="large" />} title={harness.name} subtitle={WORDS.label.harness} />
      <p className="hx-text">{harness.summary}</p>
      <section className="hx-block" aria-labelledby="hx-runs-in">
        <h3 className="hx-h3" id="hx-runs-in">{WORDS.label.runsIn}</h3>
        {state.real === undefined ? <ul className="hx-inline-list">{runsIn(state).map(i => <li key={i.id}><StateDot tone="good">{i.name}</StateDot></li>)}</ul> : <NotChecked />}
      </section>
      <section className="hx-block" aria-labelledby="hx-installed-in">
        <h3 className="hx-h3" id="hx-installed-in">{WORDS.label.installedIn}</h3>
        {installs.length === 0 ? <p className="hx-text hx-muted">{WORDS.hint.notInstalledYet}</p> : (
          <ul className="hx-box-list">
            {installs.map(install => {
              const line = installLine(state, install);
              return <li key={install.projectId} className="hx-box"><span className="hx-box-name">{projectById(state, install.projectId)?.name ?? install.projectId}</span><StateDot tone={line.tone}>{line.words}</StateDot></li>;
            })}
          </ul>
        )}
      </section>
      <div className="hx-actions">
        <HButton icon="play" variant="primary" onClick={() => ui.openStart({ harnessId: harness.id })}>{WORDS.label.start}</HButton>
        <HButton icon="harness" onClick={() => go({ name: 'builder', id: harness.id, view: 'graph' })}>{WORDS.label.openInBuilder}</HButton>
        <HButton icon="folder" onClick={() => ui.openInstall({ harnessId: harness.id, projectId: null, step: 'project' })}>{WORDS.label.assignToProject}</HButton>
      </div>
    </>
  );
}

/** The harness list at the address of a row: the details follow the address. */
const pick = (id: string): void => go({ name: 'harnesses', id });

export function HarnessList({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), ui = useUi();
  const [query, setQuery] = useState<string | null>(null);
  const picked = id ?? ui.pickedHarnessId;
  const selected = state.harnesses.find(h => h.id === picked) ?? (id === null ? state.harnesses[0] : undefined);
  if (id !== null && selected === undefined) {
    return (
      <Screen slot="harnesses" title={WORDS.label.harnesses}>
        <p className="kit-hint hx-hint">{WORDS.hint.noHarness}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'harnesses' })}>{WORDS.label.harnesses}</HButton></div>
      </Screen>
    );
  }
  const needle = (query ?? '').trim().toLowerCase();
  const rows = needle === '' ? state.harnesses : state.harnesses.filter(h => h.name.toLowerCase().includes(needle));
  return (
    <Screen slot="harnesses" title={WORDS.label.harnesses}
      tools={<HIconButton icon="search" label={WORDS.label.search} side="below" aria-pressed={query !== null} onClick={() => setQuery(q => (q === null ? '' : null))} />}
      details={selected === undefined ? undefined : <Details harness={selected} state={state} />}>
      <p className="kit-hint hx-hint">{harnessListHint(state.harnesses.length)}</p>
      {query === null ? null : (
        <label className="hx-search">
          <HIcon name="search" size={18} />
          <input type="search" value={query} autoFocus placeholder={WORDS.label.search} aria-label={WORDS.label.search} onChange={e => setQuery(e.target.value)} />
        </label>
      )}
      <ul className="hx-rows" aria-label={WORDS.label.harnesses}>
        {rows.map(h => <Row key={h.id} harness={h} state={state} selected={selected?.id === h.id} onPick={() => pick(h.id)} onStart={() => { pick(h.id); ui.openStart({ harnessId: h.id }); }} />)}
      </ul>
      {rows.length === 0 ? <p className="kit-hint hx-hint">{WORDS.hint.noMatch}</p> : null}
    </Screen>
  );
}
