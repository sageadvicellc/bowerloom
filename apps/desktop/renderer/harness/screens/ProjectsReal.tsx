/**
 * S6, Projects, on the person's own folders. A row is a project the read found, or a folder the person added: its name, whether its folder holds a harness, its folder, and a dot and
 * words for each engine (from the folder's real install, see shared/harness/real-projects.ts). The button at the right of a row follows its state and opens the sheet that does the work:
 * "Install", "Update" and "Review" open "Install a folder's harness" (Update and Review go straight to its plan), and the plus button, "Add a folder", opens the system chooser and adds the
 * folder to the list. Nothing is written here: the sheets plan first, ask for the person's approval, and write only inside the folder's `.bowerloom` folder and the engine files the plan names.
 * A folder main does not know yet is chosen first, and only the folder shown is accepted. "Assign harness" on a folder with no harness offers two ways: from the folder's own files
 * ("From a folder") or from a bundle file (the Import sheet), both with the same plan, approval and Undo. A row says "Checking" until its read-only plan has answered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { HARNESS_FILE } from '../../../shared/harness/files.js';
import { checkStatus, planInput, projectRows } from '../../../shared/harness/real-projects.js';
import type { Check, RealRow } from '../../../shared/harness/real-projects.js';
import { chipWords, stateTone, stateWords } from '../../../shared/harness/status.js';
import type { FolderInfo } from '../../../shared/engine/types.js';
import { DetailsHead, Screen } from '../Screen.js';
import { go } from '../router.js';
import { useEngine } from '../engine.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { Sheet } from '../parts/Sheet.js';
import { PathDisclosure } from '../parts/PathDisclosure.js';
import { RefusalNote } from '../sheets/engine-parts.js';
import { chooseFolderCall, chooseWanted, foldersCall, useCall } from '../sheets/use-call.js';
import { WORDS, projectsHint } from '../words.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { FLOW, actionName, addedFolderWords, rowSubject, savedAs } from '../words-flow.js';
import { OVERVIEW } from '../words-overview.js';
import './projects.css';

/** The words of a row's button. */
const BUTTON: Readonly<Record<NonNullable<RealRow['action']>, string>> = Object.freeze({ assign: FLOW.label.assignHarness, install: FLOW.label.install, update: FLOW.label.update, review: FLOW.label.review });
/** The name of a row's button: "Install harness in alpha". Assign keeps its own words. */
const buttonName = (row: RealRow): string | undefined => (row.action === null || row.action === 'assign' ? undefined : actionName(BUTTON[row.action], 'harness', row.name));

/** The reason a row needs a look, in words: why the harness does not load, which run stopped, or that its check could not be done. */
const reasonOf = (row: RealRow): string | null => row.problem ?? (row.stopped === 'install' ? ENGINE_WORDS.hint.stopped : row.stopped === 'make' ? ENGINE_WORDS.hint.stoppedChange : row.checkFailed ? row.checkReason ?? FLOW.hint.checkFailed : null);

/** The dots of a row: one for each engine, or "Checking" / "Not checked" while nothing is known, and the reason when the row needs a look. */
function RowState({ row }: { row: RealRow }): ReactElement | null {
  const reason = reasonOf(row);
  const quiet = row.status === 'checking' ? FLOW.label.checking : row.status === 'not-checked' ? FLOW.label.notChecked : null;
  if (row.engines.length === 0 && quiet === null && reason === null) return null;
  return (
    <ul className="hxp-dots" aria-label={row.name} data-row-state={row.status}>
      {quiet === null ? null : <li><StateDot tone="quiet">{quiet}</StateDot></li>}
      {row.engines.map(e => <li key={e.id}><StateDot tone={stateTone(e.state)}>{chipWords(e.name, e.state)}</StateDot></li>)}
      {reason === null ? null : <li data-reason=""><StateDot tone={row.problem === null ? 'warn' : 'bad'}>{reason}</StateDot></li>}
    </ul>
  );
}

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
        <RowState row={row} />
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
            {row.engines.length === 0 ? <p className="hx-text hx-muted" data-engines-note="">{row.status === 'checking' ? FLOW.label.checking : row.folderId === null ? FLOW.hint.notCheckedYet : reasonOf(row) ?? FLOW.label.notChecked}</p> : (
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
            {row.engines.length > 0 && reasonOf(row) !== null ? <p className="hx-text hx-muted" data-reason="">{reasonOf(row)}</p> : null}
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

/** The two ways to give a folder with no harness one: from the files it already has, or from a bundle file. */
function AssignSheet({ row, onClose, onFolder, onFile }: { row: RealRow | null; onClose(): void; onFolder(): void; onFile(): void }): ReactElement {
  return (
    <Sheet open={row !== null} title={FLOW.label.assignTitle} onClose={onClose} width={560} dataSlot="assign" actions={<HButton onClick={onClose}>{WORDS.label.cancel}</HButton>}>
      <div className="hxp-assign">
        <section className="hx-block">
          <HButton icon="folder" variant="primary" data-assign="folder" onClick={onFolder}>{FLOW.label.assignFromFolder}</HButton>
          <p className="hx-text hx-muted">{FLOW.hint.assignFolderHint}</p>
        </section>
        <section className="hx-block">
          <HButton icon="page" data-assign="file" onClick={onFile}>{FLOW.label.assignFromFile}</HButton>
          <p className="hx-text hx-muted">{FLOW.hint.assignFileHint}</p>
        </section>
      </div>
    </Sheet>
  );
}

export function RealProjects({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), engine = useEngine(), ui = useUi();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [plans, setPlans] = useState<ReadonlyMap<string, Check>>(() => new Map());
  // True from a refused read of the folder list until a read succeeds: what the rows hold may be old, so they claim nothing.
  const [stale, setStale] = useState(false);
  const [assigning, setAssigning] = useState<RealRow | null>(null);
  const list = useCall(), choosing = useCall();
  const sheetOpen = ui.adopt.open || ui.projectSheet.open || ui.saveSheet.open || ui.exportSheet.open || ui.importSheet.open;
  const sheetRef = useRef(sheetOpen);
  sheetRef.current = sheetOpen;
  // The folders main knows, read when the screen opens and when a sheet closes (a sheet may have written or removed an install).
  useEffect(() => {
    if (engine !== null && !sheetOpen) void list.plan(ENGINE_WORDS.label.planning, () => foldersCall(engine), got => { setFolders(got); setStale(false); });
  }, [engine, sheetOpen, list.plan]);
  useEffect(() => { if (list.refusalId > 0) setStale(true); }, [list.refusalId]);
  // The status of each installed folder, from one read-only plan, set as each answer comes. A plan that fails or takes too long is a "Review": its sheet shows what it can.
  // None starts while a sheet is open, so a status plan never replaces the plan the person is reading. The checks run once for each read of the list that ends (in new folders or in a
  // refusal), not for each sheet that closes.
  useEffect(() => {
    if (engine === null || sheetRef.current || list.refusal !== null) return;
    let stop = false;
    // Statuses from before the folders were read again may be stale (a sheet may have just written), so each row says "Checking" until its new plan answers.
    setPlans(new Map());
    void (async () => {
      for (const f of folders) {
        const input = planInput(f);
        if (!f.projected || input === null || f.problem !== null || f.unfinished.projection || f.unfinished.adoption) continue;
        if (stop || sheetRef.current) return;
        const check = await checkStatus(() => engine.planProjection(f.id, input));
        if (stop) return;
        setPlans(current => new Map(current).set(f.id, check));
      }
    })();
    return () => { stop = true; };
  }, [engine, folders, list.refusalId]);
  // Leaving the screen drops a call still in flight, so a chooser that closes later does not move a person who has gone elsewhere.
  useEffect(() => () => { list.clear(); choosing.clear(); }, [list.clear, choosing.clear]);

  const rows = useMemo(() => projectRows(state, folders, plans, stale), [state, folders, plans, stale]);
  const selected = rows.find(r => r.id === id) ?? (id === null ? rows[0] : undefined);

  /** Runs `then` with the id main gave a row's folder. A folder main does not know yet is chosen first, and only the folder shown is taken. */
  const withFolder = (row: RealRow, then: (folderId: string) => void): void => {
    if (engine === null) { ui.showToast(ENGINE_WORDS.hint.noBridge); return; }
    if (row.folderId !== null) { then(row.folderId); return; }
    // The window holds no path, so main's own chooser opens. Main refuses another folder before it registers it. A closed chooser is no answer.
    void choosing.plan(ENGINE_WORDS.label.chooseFolder, () => chooseWanted(engine, row.path, () => ui.showToast(OVERVIEW.hint.wrongFolder)), got => {
      if (got === null) return;
      // Main already took only the folder shown (it was sent the label), so the window does not compare the two forms of a name again.
      setFolders(got.list); setStale(false);
      then(got.info.id);
    });
  };
  const act = (row: RealRow): void => {
    if (row.action === 'assign') { if (engine === null) ui.showToast(ENGINE_WORDS.hint.noBridge); else setAssigning(row); return; }
    withFolder(row, folderId => {
      if (row.opens === 'make') ui.openAdopt({ folderId });
      else ui.openProject({ folderId, mode: row.opens === 'recover' ? 'recover' : 'install', start: row.action === 'update' || row.action === 'review' ? 'review' : 'folder' });
    });
  };
  const assignTo = (how: 'folder' | 'file'): void => {
    const row = assigning;
    setAssigning(null);
    if (row === null) return;
    withFolder(row, folderId => { if (how === 'folder') ui.openAdopt({ folderId }); else ui.openImport({ folderId }); });
  };
  const addFolder = (): void => {
    if (engine === null) { ui.showToast(ENGINE_WORDS.hint.noBridge); return; }
    void choosing.plan(ENGINE_WORDS.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      // The row the folder now belongs to: a project's row when the folder is that project, else a row of its own.
      const hit = projectRows(state, got.list, plans, false).find(r => r.folderId === got.info.id);
      const listed = folders.some(f => f.id === got.info.id) || (hit !== undefined && state.projects.some(p => p.id === hit.id));
      setFolders(got.list); setStale(false);
      ui.showToast(listed ? FLOW.hint.alreadyListed : addedFolderWords(got.info.name));
      go({ name: 'projects', id: hit?.id ?? got.info.id });
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
      {!stale ? null : <p className="kit-hint hx-hint" data-list-stale="">{FLOW.hint.listStale}</p>}
      {list.refusal === null ? null : <RefusalNote refusal={list.refusal} focusId={list.refusalId}>{null}</RefusalNote>}
      {choosing.refusal === null ? null : <RefusalNote refusal={choosing.refusal} focusId={choosing.refusalId}>{null}</RefusalNote>}
      <ul className="hxp-rows" aria-label={FLOW.label.projectRows} aria-busy={choosing.busy !== null}>
        {rows.map(r => <RealRowView key={r.id} row={r} selected={selected?.id === r.id} onPick={() => go({ name: 'projects', id: r.id })} onAct={() => act(r)} />)}
      </ul>
      <AssignSheet row={assigning} onClose={() => setAssigning(null)} onFolder={() => assignTo('folder')} onFile={() => assignTo('file')} />
    </Screen>
  );
}

