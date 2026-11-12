/**
 * S2, the Harness list. Each harness is a row: its counts, its status (the worst state over its projects, computed from the install data), and a play button.
 * Picking a row goes to the address of that harness (`#harnesses/<id>`), so the address and the details column agree; the details show: where it runs, where it is installed, and three buttons.
 * "Start" and the play button open the start sheet for the harness of their row (the sample's sheet: it starts runs in memory), "Assign to project" opens the install sheet at its first step (in the sample; on the person's own folders it says the harness is not on disk and opens "From a folder").
 * On the person's own folders, each folder row that holds a harness has its own "Start": it opens the real Start sheet, which shows a command to paste into a Terminal and runs nothing.
 * "Open in builder" on such a harness is refused in words: the Builder edits one folder's harness, so it opens "From a folder", which makes one.
 * Under the rows, "Folders": each folder main knows, with "Open in builder" for one that holds a harness and "From a folder" for one that does not, and
 * "Choose a folder". This is the folder list the Builder goes back to when its folder is not open (after a new start).
 * An address that names no harness shows "That harness is not here", not the first harness.
 */
import { useEffect, useId, useState } from 'react';
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
import { useEngine } from '../engine.js';
import { startFolderLine } from '../../../shared/harness/start-real.js';
import { BUILDER_REFUSALS } from '../../../shared/harness/builder-draft.js';
import type { FolderInfo } from '../../../shared/engine/types.js';
import { RefusalNote, folderLine } from '../sheets/engine-parts.js';
import { chooseFolderCall, foldersCall, useCall } from '../sheets/use-call.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { openFolderName } from '../words.js';
import { SHARE } from '../words-share.js';
import { PartsOfHarness } from '../parts/PartsOfHarness.js';

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
  // On the person's own folders a harness made from a scan is not on disk: a folder holds its own harness, so the note says so and "From a folder" opens to make one (as Open in builder does).
  const assign = (h: Harness): void => {
    if (state.real === undefined) { ui.openInstall({ harnessId: h.id, projectId: null, step: 'project' }); return; }
    ui.showToast(WORDS.hint.notOnDisk);
    ui.openAdopt({});
  };
  return (
    <>
      <DetailsHead tile={<Tile name="harness" size="large" />} title={harness.name} subtitle={WORDS.label.harness} />
      <p className="hx-text">{harness.summary}</p>
      <PartsOfHarness state={state} harness={harness} />
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
        <HButton icon="harness" onClick={() => { ui.showToast(BUILDER_REFUSALS['harness-from-scan']); ui.openAdopt({}); }}>{WORDS.label.openInBuilder}</HButton>
        <HButton icon="folder" onClick={() => assign(harness)}>{WORDS.label.assignToProject}</HButton>
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
      {state.harnesses.length === 0 ? <div className="hx-actions" data-empty-import=""><ImportEntry /></div> : null}
      <Folders empty={state.harnesses.length === 0} />
    </Screen>
  );
}

/**
 * "Import from a file": opens the Import sheet. With no engine bridge (the window cannot reach Bowerloom) it stays, held, and says why, so the entry never vanishes without
 * a reason. It is in the Folders block and in the empty state of the list.
 */
function ImportEntry(): ReactElement {
  const engine = useEngine(), ui = useUi(), why = useId();
  return (
    <>
      <HButton icon="page" data-import-file="" aria-disabled={engine === null ? true : undefined} aria-describedby={engine === null ? why : undefined} onClick={() => { if (engine !== null) ui.openImport(); }}>{SHARE.label.importFromFile}</HButton>
      {engine === null ? <p className="hx-text hx-muted" id={why} data-import-why="">{ENGINE_WORDS.hint.noBridge}</p> : null}
    </>
  );
}

/**
 * "Folders": each folder main knows, by its name and its line (the interfaces its harness lists, or "No harness here yet"), with the way into the Builder.
 * A folder that holds no harness opens "From a folder", which makes one. "Choose a folder" opens the system chooser.
 */
function Folders({ empty }: { empty: boolean }): ReactElement | null {
  const engine = useEngine(), ui = useUi(), call = useCall(), real = useHarnessState().real !== undefined;
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const sheetOpen = ui.adopt.open || ui.saveSheet.open || ui.projectSheet.open || ui.importSheet.open;
  useEffect(() => { if (engine !== null && !sheetOpen) void call.plan(ENGINE_WORDS.label.planning, () => foldersCall(engine), setFolders); }, [engine, sheetOpen]);
  if (engine === null) {
    return (
      <section className="hx-block hx-folders" aria-labelledby="hx-folders" data-section="folders">
        <h2 className="hx-h3" id="hx-folders">{ENGINE_WORDS.label.folders}</h2>
        {empty ? null : <ImportEntry />}
      </section>
    );
  }
  const choose = (): void => { void call.plan(ENGINE_WORDS.label.chooseFolder, () => chooseFolderCall(engine), got => { if (got !== null) setFolders(got.list); }); };
  return (
    <section className="hx-block hx-folders" aria-labelledby="hx-folders" data-section="folders">
      <h2 className="hx-h3" id="hx-folders">{ENGINE_WORDS.label.folders}</h2>
      {call.refusal === null ? null : <RefusalNote refusal={call.refusal} focusId={call.refusalId}>{null}</RefusalNote>}
      {folders.length === 0 ? <p className="kit-hint hx-hint">{ENGINE_WORDS.hint.noFolders}</p> : (
        <ul className="hx-rows" aria-label={ENGINE_WORDS.label.folders}>
          {folders.map(f => (
            <li key={f.id} className="hx-row hx-row-folder" data-folder-row={f.id}>
              <Tile name="folder" size="large" />
              <div className="hx-row-text">
                <span className="hx-row-main">{f.name}</span>
                <span className="hx-row-meta">{folderLine(f, 'save').words}</span>
              </div>
              <span className="hx-row-action">
                {real && !startFolderLine(f).off ? <HButton icon="play" size="small" aria-label={startName(f.name)} data-start-folder={f.id} onClick={() => ui.openStart({ harnessId: null, folderId: f.id })}>{WORDS.label.start}</HButton> : null}
                {f.hasDefinition
                  ? <HButton icon="harness" size="small" aria-label={openFolderName(f.name)} data-open-builder={f.id} onClick={() => go({ name: 'builder', id: f.id })}>{WORDS.label.openInBuilder}</HButton>
                  : <HButton icon="folder" size="small" data-from-folder={f.id} onClick={() => ui.openAdopt({ folderId: f.id })}>{ENGINE_WORDS.label.fromFolder}</HButton>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="hx-actions">
        <HButton icon="folder" data-choose-folder="" disabled={call.busy !== null} onClick={choose}>{ENGINE_WORDS.label.chooseFolder}</HButton>
        {empty ? null : <ImportEntry />}
      </div>
    </section>
  );
}
