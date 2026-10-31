/**
 * The Builder of one folder's harness (0.8.0-beta.1, option C), at `builder/<folderId>`. It draws the folder's editor (FolderEditor.tsx) in the window, on the
 * folder's draft (folder-draft.tsx), which the save sheet reads too. Nothing is written until Save, and Save goes through the save sheet's review.
 * - The load is the save sheet's: `planSave(id, [])` and `listVersions(id)`. It runs on every visit and when a sheet closes; the base on screen stays until the
 *   new read arrives, and a draft stays only while the harness is the one it was made on (and says so when it is not). A folder list or a harness that cannot
 *   be read shows its refusal with the sheet's own next step: Plan again, the recovery of a stopped change, or Set aside. An id main does not know (after a
 *   new start) goes back to the folder list.
 * - Each gesture of the editor (a link drawn or dropped, a tick, Unlink, Remove, Keep, a copy, the Notes panel and the keeper) goes through `builderAction`
 *   (the editor's `act`), then onto the folder's undo stack. A refused gesture says why in a note; New harness and a harness from a scan open "From a folder" instead.
 * - Drag to link: a skill dropped on an agent links them. Any other drag moves the node; places are kept for the session, never saved.
 * - Undo and Redo step through the unsaved changes. Saved changes go back through the Save points drawer (Go back), reviewed in the save sheet.
 * - Save opens the save sheet on its review step; its Done step offers Install. "Assign to project" opens the install sheet of the folder.
 * - Leaving the folder with unsaved changes asks "Discard N changes?" (owner decision Q1A). So does Go back, which drops the draft before it opens the review.
 * Runs, Start and the interface switch stay in the sample screens; the Builder has none of them.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { FolderInfo, SetAsideView } from '../../../shared/engine/types.js';
import type { BuilderAction } from '../../../shared/harness/builder-draft.js';
import { draftStart } from '../../../shared/harness/save-draft.js';
import { Screen } from '../Screen.js';
import { go, setLeaveGuard } from '../router.js';
import { useUi } from '../ui.js';
import { useEngine } from '../engine.js';
import { EditStep, SetAsideBlock, useFolderEditor } from '../FolderEditor.js';
import type { SetAsideParts } from '../FolderEditor.js';
import { loadDropsDraft, useFolderDraft } from '../folder-draft.js';
import { HButton, HIconButton } from '../parts/controls.js';
import { Busy, RefusalNote } from '../sheets/engine-parts.js';
import { foldersCall, useCall, versionsCall } from '../sheets/use-call.js';
import { openCall } from '../sheets/SaveSheet.js';
import { BuilderDetails } from './builder/BuilderDetails.js';
import { DiscardSheet } from './builder/DiscardSheet.js';
import { SavePointsDrawer } from './builder/SavePointsDrawer.js';
import { ENGINE_WORDS, NOTES_REFUSAL_WORDS, SAVE_REFUSAL_WORDS, draftWords } from '../words-engine.js';
import { WORDS } from '../words.js';
import '../sheets/engine.css';
import '../sheets/save.css';
import '../notes/notes.css';

const W = ENGINE_WORDS;

export function Builder({ id }: { id: string }): ReactElement {
  // The folder list has its own lane, so a read of the harness never drops it (a plan's newest call wins its lane).
  const engine = useEngine(), ui = useUi(), call = useCall(), list = useCall();
  const fd = useFolderDraft(id);
  const [folders, setFolders] = useState<readonly FolderInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [aside, setAside] = useState<SetAsideView | null>(null);
  const [asideDone, setAsideDone] = useState<string | null>(null);
  // The move that waits for "Discard N changes?", or null.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const pointsButton = useRef<HTMLButtonElement>(null);
  const folder = folders?.find(f => f.id === id);
  const base = fd.entry.base, draft = fd.draft, count = fd.count;
  const sheetOpen = ui.saveSheet.open || ui.adopt.open || ui.projectSheet.open;
  const editor = useFolderEditor({
    engine, call, folder, folders: folders ?? [], onFolders: setFolders, base, draft, positions: fd.entry.positions, onPush: fd.push,
    onRefused: r => { ui.showToast(r.words); if (r.opens === 'from-folder') ui.openAdopt({}); },
    onHelp: () => ui.openSave({ folderId: id, tour: true }),
  });
  const held = call.writing, busy = call.busy !== null || editor.busy !== null;
  // The entry as it is now, for an answer that comes after a render.
  const entryNow = useRef(fd.entry);
  entryNow.current = fd.entry;
  // True until the first read of this visit, and again when a sheet opens: the base on screen is read again, because a recovery, an install or a change outside
  // the window may have changed the harness under it.
  const reread = useRef(true);

  /** The folders main knows. A read that fails shows its refusal with "Try again", and never a blank window. */
  const readFolders = (): void => {
    if (engine === null) return;
    void list.plan(W.label.planning, () => foldersCall(engine), setFolders);
  };
  // Read again when a sheet closes (a new harness made from a folder, a save, an install).
  useEffect(() => {
    if (engine === null || sheetOpen) return;
    readFolders();
  }, [engine, id, sheetOpen]);
  // An id main does not know: the folder list, with a note.
  useEffect(() => {
    if (folders !== null && folder === undefined) { ui.showToast(WORDS.hint.noFolder); go({ name: 'harnesses' }); }
  }, [folders, folder]);
  /** The folder's harness and its save points. The base on screen stays until the answer comes; a draft the new harness cannot hold is dropped, and the person is told. */
  const readBase = (): void => {
    if (engine === null) return;
    void call.plan(W.label.planning, () => openCall(engine, id), v => {
      if (loadDropsDraft(entryNow.current, v.view.definition)) ui.showToast(WORDS.hint.draftDropped);
      fd.loaded(v.view.definition, v.versions);
    });
  };
  useEffect(() => { if (sheetOpen) reread.current = true; }, [sheetOpen]);
  // Read on every visit, when a sheet closes, and after a save (which clears the base).
  const hasHarness = folder?.hasDefinition === true;
  useEffect(() => {
    if (engine === null || folder === undefined || !hasHarness || sheetOpen) return;
    if (base !== null && !reread.current) return;
    reread.current = false;
    readBase();
  }, [engine, folder?.id, hasHarness, base === null, sheetOpen]);
  // Leaving the folder with unsaved changes asks first. Another address of the same folder is not leaving.
  useEffect(() => {
    if (count === 0) return undefined;
    return setLeaveGuard((next, proceed) => {
      if (next.name === 'builder' && next.id === id) return false;
      setLeaving(() => proceed);
      return true;
    });
  }, [count, id]);
  // Cmd+Z (Ctrl+Z) undoes the last unsaved change, and Shift with it redoes. Not while a sheet holds the page or a field has the focus.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      // Not while a write runs, as the buttons are off then.
      if (held) return;
      if (document.querySelector('[aria-modal="true"]') !== null || (e.target as HTMLElement | null)?.closest('input, textarea, select') != null) return;
      e.preventDefault();
      if (e.shiftKey) fd.redo(); else fd.undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fd, held]);

  /** One gesture, through the editor's `act` (builderAction on the draft as it is now). A refused one says why in a note, and New harness or a harness from a scan opens "From a folder". */
  const act = (action: BuilderAction): boolean => editor.act(action);
  const onLinkTarget = (partId: string): void => {
    const from = linkingId;
    setLinkingId(null);
    if (from !== null) act({ kind: 'link', a: from, b: partId });
  };
  const toggleLink = (agentId: string): void => setLinkingId(current => (current === agentId ? null : agentId));
  const setAsideParts: SetAsideParts = {
    view: aside, done: asideDone,
    plan: () => {
      if (engine === null) return;
      setAsideDone(null);
      void call.plan(W.label.planning, () => engine.planSetAside(id), v => setAside(v));
    },
    run: () => {
      if (engine === null || aside === null) return;
      const rev = aside.revision;
      void call.write(W.label.writing, async () => {
        const r = await engine.runSetAside(id, rev);
        // The save points are read again after it. A read that fails is the save points' own failure: the set-aside worked, and says so.
        if (r.ok) fd.setVersions(await versionsCall(engine, id));
        return r;
      }, r => {
        setAside(null); setAsideDone(r.name);
        // A harness that could not be read before can be read now.
        if (entryNow.current.base === null) readBase();
      });
    },
  };

  // The way back from a refusal of the read: the same next steps the save sheet gives.
  const readRefusal = call.refusal;
  const nextWords = readRefusal === null ? undefined : SAVE_REFUSAL_WORDS[readRefusal.code] ?? NOTES_REFUSAL_WORDS[readRefusal.code];
  const goBack = (version: string): void => {
    setDrawer(false);
    const open = (): void => ui.openSave({ folderId: id, start: 'review', restore: version });
    // A go-back plans a save from the harness as it was saved, not from the draft, so the draft would go. Ask first.
    if (count > 0) setLeaving(() => open); else open();
  };

  const title = folder?.name ?? WORDS.label.harnesses;
  const ready = folder !== undefined && base !== null && editor.now !== null && editor.world !== null;
  const tools = ready ? (
    <>
      <div className="hx-seg" role="group" aria-label={WORDS.label.builderTools}>
        <HIconButton icon="undo" label={WORDS.label.undo} side="below" disabled={!fd.canUndo || held} data-builder-undo="" onClick={fd.undo} />
        <span className="hx-redo"><HIconButton icon="undo" label={WORDS.label.redo} side="below" disabled={!fd.canRedo || held} data-builder-redo="" onClick={fd.redo} /></span>
      </div>
      <HIconButton ref={pointsButton} icon="save-clock" label={W.label.savePoints} side="below" aria-expanded={drawer} data-builder-points="" onClick={() => setDrawer(o => !o)} />
      <HIconButton icon="folder" label={WORDS.label.assignToProject} side="below" onClick={() => ui.openProject({ folderId: id })} />
      <HButton variant="primary" data-builder-save="" disabled={count === 0 || busy} onClick={() => ui.openSave({ folderId: id, start: 'review' })}>{WORDS.label.save}</HButton>
    </>
  ) : undefined;

  return (
    <Screen slot="builder" title={title} {...(ready ? { count: draftWords(count) } : {})} tools={tools}
      details={!ready ? undefined : (
        <BuilderDetails now={editor.now!} start={draftStart(base!, draft)} draft={draft} selectedId={selectedId} linkingId={linkingId} held={held || busy}
          onSelect={setSelectedId} onAct={act}
          onLinkStart={agentId => { toggleLink(agentId); requestAnimationFrame(() => document.querySelector<HTMLElement>('.hx-node[data-candidate]')?.focus()); }} />
      )}
      drawer={!ready ? undefined : (
        <SavePointsDrawer open={drawer} versions={fd.entry.versions} held={held || busy} setAside={setAsideParts} onClose={() => setDrawer(false)} returnTo={() => pointsButton.current}
          onGoBack={goBack} />
      )}>
      <div className="hxb-body" data-builder={id} aria-busy={busy}>
        {busy ? <Busy words={call.busy ?? editor.busy!} /> : folders === null && list.busy !== null ? <Busy words={list.busy} /> : null}
        {engine === null ? <p className="hx-text" data-no-bridge="">{W.hint.noBridge}</p> : null}
        {list.refusal === null ? null : (
          <RefusalNote refusal={list.refusal} focusId={list.refusalId}>
            {folders === null ? <HButton data-try-again="" onClick={readFolders}>{W.label.tryAgain}</HButton> : null}
          </RefusalNote>
        )}
        {readRefusal === null ? null : (
          <RefusalNote refusal={readRefusal} focusId={call.refusalId}>
            <HButton data-plan-again="" onClick={readBase}>{W.label.planAgain}</HButton>
            {readRefusal.code === 'SAVE_RECOVERY_REQUIRED' ? <HButton data-recover="" onClick={() => ui.openAdopt({ folderId: id })}>{W.label.planRecovery}</HButton> : null}
          </RefusalNote>
        )}
        {nextWords === undefined ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
        <SetAsideBlock refusal={readRefusal} held={held || busy} setAside={setAsideParts} />
        {editor.refusals.map(r => <RefusalNote key={r.key} refusal={r.refusal} focusId={r.id}>{null}</RefusalNote>)}
        {folder !== undefined && !folder.hasDefinition ? (
          <div className="hx-empty" data-no-harness="">
            <h2 className="hx-empty-title">{W.hint.noHarness}</h2>
            <div className="hx-empty-actions"><HButton icon="folder" variant="primary" onClick={() => ui.openAdopt({ folderId: id })}>{W.label.fromFolder}</HButton></div>
          </div>
        ) : null}
        {ready ? (
          <EditStep base={base!} now={editor.now!} draft={draft} count={count} held={held || busy} versions={fd.entry.versions} world={editor.world!} linkingId={linkingId}
            selectedId={selectedId} savePoints={false} onAction={act} onLinkStart={toggleLink} onLinkTarget={onLinkTarget} onLinkCancel={() => setLinkingId(null)}
            onSelect={next => { setSelectedId(next); if (next === null) setLinkingId(null); }} onMove={fd.move} onGoBack={() => undefined}
            onDrop={(dragged, agent) => { act({ kind: 'link', a: dragged, b: agent }); }}
            notes={editor.notes} {...(editor.copy === undefined ? {} : { copy: editor.copy })} />
        ) : null}
      </div>
      <DiscardSheet count={leaving === null ? null : count} onKeep={() => setLeaving(null)} onDiscard={() => { const proceed = leaving; setLeaving(null); fd.discard(); proceed?.(); }} />
    </Screen>
  );
}
