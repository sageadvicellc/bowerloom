/**
 * S6, Projects, on the person's own folders. A row is a project the read found, or a folder the person added: its name, whether its folder holds a harness, its folder, and a dot and
 * words for each engine (from the folder's real install, see shared/harness/real-projects.ts). The button at the right of a row follows its state and opens the sheet that does the work:
 * "Install", "Update" and "Review" open "Install a folder's harness" (Update and Review go straight to its plan), and the plus button, "Add a folder", opens the system chooser and adds the
 * folder to the list. Nothing is written here: the sheets plan first, ask for the person's approval, and write only inside the folder's `.bowerloom` folder and the engine files the plan names.
 * A folder main does not know yet is chosen first, and only the folder shown is accepted. "Assign harness" is not built yet: it says so.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { HARNESS_FILE } from '../../../shared/harness/files.js';
import { planInput, planStatus, projectRows, sameFolder } from '../../../shared/harness/real-projects.js';
import type { PlanStatus, RealRow } from '../../../shared/harness/real-projects.js';
import { chipWords, stateTone, stateWords } from '../../../shared/harness/status.js';
import type { FolderInfo } from '../../../shared/engine/types.js';
import { DetailsHead, Screen } from '../Screen.js';
import { go } from '../router.js';
import { useEngine } from '../engine.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { PathDisclosure } from '../parts/PathDisclosure.js';
import { RefusalNote } from '../sheets/engine-parts.js';
import { callRefusal, chooseFolderCall, chooseWanted, foldersCall, useCall } from '../sheets/use-call.js';
import { WORDS, projectsHint } from '../words.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { FLOW, actionName, addedFolderWords, rowSubject, savedAs } from '../words-flow.js';
import { OVERVIEW } from '../words-overview.js';
import './projects.css';

/** The words of a row's button. */
const BUTTON: Readonly<Record<NonNullable<RealRow['action']>, string>> = Object.freeze({ assign: FLOW.label.assignHarness, install: FLOW.label.install, update: FLOW.label.update, review: FLOW.label.review });
/** The name of a row's button: "Install harness in alpha". Assign keeps its own words. */
const buttonName = (row: RealRow): string | undefined => (row.action === null || row.action === 'assign' ? undefined : actionName(BUTTON[row.action], 'harness', row.name));

function RealRowView({ row, selected, onPick, onAct }: { row: RealRow; selected: boolean; onPick(): void; onAct(): void }): ReactElement {
  const label = row.action === null ? null : BUTTON[row.action], name = buttonName(row);
  return (
    <li className="hx-row hxp-row" data-selected={selected ? '' : undefined} data-project={row.id}>
      <Tile name="folder" size="large" />
      <div className="hx-row-text">
        <span className="hxp-title">
          <button type="button" className="hx-row-main" aria-pressed={selected} onClick={onPick}>{row.name}</button>
          <span className="hxp-harness">{row.hasHarness ? FLOW.label.hasHarness : FLOW.label.noHarnessYet}</span>
        </span>
        <PathDisclosure className="hxp-path" path={row.path} subject={rowSubject(row.name)} key={row.id} />
        {row.engines.length > 0 ? (
          <ul className="hxp-dots" aria-label={row.name}>
            {row.engines.map(e => <li key={e.id}><StateDot tone={stateTone(e.state)}>{chipWords(e.name, e.state)}</StateDot></li>)}
          </ul>
        ) : row.hasHarness && row.folderId === null ? <ul className="hxp-dots" aria-label={row.name}><li><StateDot tone="quiet">{FLOW.label.notChecked}</StateDot></li></ul> : null}
      </div>
      {label === null ? null : (
        <span className="hx-row-action">
          <HButton size="small" {...(name === undefined ? {} : { 'aria-label': name })} onClick={onAct}>{label}</HButton>
        </span>
      )}
    </li>
  );
}

function RealDetails({ row, onAct }: { row: RealRow; onAct(): void }): ReactElement {
  const label = row.action === null ? null : BUTTON[row.action], name = buttonName(row);
  return (
    <>
      <DetailsHead tile={<Tile name="folder" size="large" />} title={row.name} subtitle={FLOW.label.project} />
      <PathDisclosure path={row.path} subject={row.name} key={row.id} />
      {!row.hasHarness ? <p className="hx-text hx-muted">{FLOW.label.noHarnessYet}</p> : (
        <div className="hxp-install" data-install={row.id}>
          <section className="hx-block" aria-label={`${WORDS.label.harness} ${row.name}`}>
            <h3 className="hx-h3">{WORDS.label.harness}</h3>
            <p className="hxp-hname">{row.name}</p>
            <p className="hx-text hx-muted">{savedAs(HARNESS_FILE)}</p>
          </section>
          <section className="hx-block" aria-label={`${FLOW.label.interfacesOfInstall} ${row.name}`}>
            <h3 className="hx-h3">{FLOW.label.interfacesOfInstall}</h3>
            {row.engines.length === 0 ? <p className="hx-text hx-muted">{FLOW.hint.notCheckedYet}</p> : (
              <ul className="hxp-ifaces">
                {row.engines.map(e => (
                  <li key={e.id} className="hxp-iface" data-interface={e.id}>
                    <span className="hxp-iface-text">
                      <span className="hxp-iface-name">{e.name}</span>
                      <StateDot tone={stateTone(e.state)}>{stateWords(e.state)}</StateDot>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {label === null ? null : (
        <div className="hxp-wide">
          <HButton icon="harness" {...(name === undefined ? {} : { 'aria-label': name })} onClick={onAct}>{label}</HButton>
        </div>
      )}
    </>
  );
}

export function RealProjects({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), engine = useEngine(), ui = useUi();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [plans, setPlans] = useState<ReadonlyMap<string, PlanStatus>>(() => new Map());
  const list = useCall(), choosing = useCall();
  const sheetOpen = ui.adopt.open || ui.projectSheet.open || ui.saveSheet.open || ui.exportSheet.open || ui.importSheet.open;
  // The folders main knows, read when the screen opens and when a sheet closes (a sheet may have written or removed an install).
  useEffect(() => { if (engine !== null && !sheetOpen) void list.plan(ENGINE_WORDS.label.planning, () => foldersCall(engine), setFolders); }, [engine, sheetOpen, list.plan]);
  // The status of each installed folder, from one read-only plan. A plan that cannot be made is a "Review": its sheet shows the refusal in words.
  useEffect(() => {
    if (engine === null) return;
    let stop = false;
    // A status from before the folders were read again may be stale (a sheet may have just written), so none is shown until the new plan answers.
    setPlans(new Map());
    void (async () => {
      const next = new Map<string, PlanStatus>();
      for (const f of folders) {
        const input = planInput(f);
        if (!f.projected || input === null || f.problem !== null || f.unfinished.projection || f.unfinished.adoption) continue;
        let status: PlanStatus;
        try { status = planStatus(await engine.planProjection(f.id, input)); } catch (error) { status = planStatus({ ok: false, refusal: callRefusal(error) }); }
        if (stop) return;
        next.set(f.id, status);
      }
      if (!stop) setPlans(next);
    })();
    return () => { stop = true; };
  }, [engine, folders]);
  // Leaving the screen drops a call still in flight, so a chooser that closes later does not move a person who has gone elsewhere.
  useEffect(() => () => { list.clear(); choosing.clear(); }, [list.clear, choosing.clear]);

  const rows = useMemo(() => projectRows(state, folders, plans), [state, folders, plans]);
  const selected = rows.find(r => r.id === id) ?? (id === null ? rows[0] : undefined);

  /** Opens the sheet a row's button names, for a folder main knows. */
  const open = (row: RealRow, folderId: string): void => {
    if (row.opens === 'make') ui.openAdopt({ folderId });
    else ui.openProject({ folderId, mode: row.opens === 'recover' ? 'recover' : 'install', start: row.action === 'update' || row.action === 'review' ? 'review' : 'folder' });
  };
  const act = (row: RealRow): void => {
    // Assign harness is not built: it keeps the note of every control that is not in this beta.
    if (row.action === 'assign') { ui.openInstall({ projectId: row.id, harnessId: null, step: 'project' }); return; }
    if (engine === null) { ui.showToast(ENGINE_WORDS.hint.noBridge); return; }
    if (row.folderId !== null) { open(row, row.folderId); return; }
    // The window holds no path, so main's own chooser opens, and only the folder shown is accepted. A closed chooser is no answer.
    void choosing.plan(ENGINE_WORDS.label.chooseFolder, () => chooseWanted(engine, row.path, () => ui.showToast(OVERVIEW.hint.wrongFolder)), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!sameFolder(row.path, got.info.label)) { ui.showToast(OVERVIEW.hint.wrongFolder); return; }
      open(row, got.info.id);
    });
  };
  const addFolder = (): void => {
    if (engine === null) { ui.showToast(ENGINE_WORDS.hint.noBridge); return; }
    void choosing.plan(ENGINE_WORDS.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      const listed = folders.some(f => f.id === got.info.id) || state.projects.some(p => sameFolder(p.path, got.info.label));
      const match = state.projects.find(p => sameFolder(p.path, got.info.label));
      setFolders(got.list);
      ui.showToast(listed ? FLOW.hint.alreadyListed : addedFolderWords(got.info.name));
      go({ name: 'projects', id: match?.id ?? got.info.id });
    });
  };

  if (id !== null && selected === undefined) {
    return (
      <Screen slot="projects" title={WORDS.label.projects}>
        <p className="kit-hint hx-hint">{FLOW.hint.noProject}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'projects' })}>{WORDS.label.projects}</HButton></div>
      </Screen>
    );
  }
  return (
    <Screen slot="projects" title={WORDS.label.projects}
      tools={<>
        <HButton icon="folder" data-open-adopt="" onClick={() => ui.openAdopt()}>{ENGINE_WORDS.label.fromFolder}</HButton>
        <HButton icon="harness" data-open-project="" onClick={() => ui.openProject()}>{ENGINE_WORDS.label.installFolder}</HButton>
        <HButton icon="save-clock" data-open-save="" onClick={() => ui.openSave()}>{ENGINE_WORDS.label.editFolder}</HButton>
        <HIconButton icon="plus" label={FLOW.label.addFolder} side="below-end" data-add-folder="" disabled={choosing.busy !== null} onClick={addFolder} />
      </>}
      details={selected === undefined ? undefined : <RealDetails row={selected} onAct={() => act(selected)} />}>
      <p className="kit-hint hx-hint">{projectsHint(rows.length)}</p>
      {list.refusal === null ? null : <RefusalNote refusal={list.refusal} focusId={list.refusalId}>{null}</RefusalNote>}
      {choosing.refusal === null ? null : <RefusalNote refusal={choosing.refusal} focusId={choosing.refusalId}>{null}</RefusalNote>}
      <ul className="hxp-rows" aria-label={FLOW.label.projectRows}>
        {rows.map(r => <RealRowView key={r.id} row={r} selected={selected?.id === r.id} onPick={() => go({ name: 'projects', id: r.id })} onAct={() => act(r)} />)}
      </ul>
    </Screen>
  );
}

