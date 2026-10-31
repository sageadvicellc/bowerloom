/**
 * "Edit a folder's harness" (0.8.0-beta.1, option C): one folder saves its own harness. 1. the folder, 2. the edit, 3. the review, 4. Done.
 * - The edit is the folder's editor (FolderEditor.tsx), the same one the Builder draws in the window, on the same draft of the folder (folder-draft.tsx): a
 *   link drawn from an agent to a skill, a tick in "Skills each agent uses", a removed skill and the interfaces are a draft. Nothing is sent until the review,
 *   and nothing is written until Save (spec 6.6). The draft becomes a closed list of ids; the window never sends a path or file text.
 * - The Builder opens the sheet on its review step (`start: 'review'`), with the plan of the folder's draft, or of a go-back to one save point (`restore`).
 * - The review lists each file of `.bowerloom` the save changes, and ends with one tick box that approves its revision. Main asks once more in its own
 *   dialog. Done lists each file written and the save point kept, and offers the install, which is its own sheet and its own dialog.
 * - "Save points" lists every save point, newest first. "Go back" plans a save whose target is that save point, reviewed and approved the same way. A
 *   damaged record is a refusal in words, never an empty list.
 * - A refusal takes the focus, says what to do next, and offers "Plan again", or the recovery of a stopped change.
 * - The edit is My agents for the folder (first five minutes, section 5): the map, the Notes panel with its notes step, and, once the harness holds it (or the
 *   draft adds it from the kit), the Notes keeper with its two shelves. The save bar at the foot holds the count and the one button. A Help button replays the
 *   guided tour, which also starts as the edit opens when the sheet was opened for it (`tour`). The tour adds the keeper from the kit before it lights it.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { Answer, DefinitionView, EngineId, FolderInfo, RestoreView, SaveEdit, SaveView, SaveWritten, SetAsideView, VersionView } from '../../../shared/engine/types.js';
import { draftEdits, keeperOf } from '../../../shared/harness/save-draft.js';
import type { SaveDraft } from '../../../shared/harness/save-draft.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { EditStep, useFolderEditor } from '../FolderEditor.js';
import type { SetAsideParts } from '../FolderEditor.js';
import { EMPTY_FOLDER, entryOf, loadDropsDraft, useFolderDraft, useFolderDrafts } from '../folder-draft.js';
import {
  CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, NOTES_REFUSAL_WORDS, SAVE_REFUSAL_WORDS, approvePlanWords, draftWords, fromWords, goBackWords, saveFilesWords, savePointLine,
} from '../words-engine.js';
import { Busy, FolderStep, RefusalNote, ResultStep, Section, TickRow, folderLine } from './engine-parts.js';
import { chooseFolderCall, foldersCall, useCall, versionsCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import { WINDOW_TOUR, startsOnItsOwn } from '../tour/seen.js';
import { TourAnnouncer, TourOverlay } from '../tour/TourOverlay.js';
import { createTour, currentStep, isWaiting, nextStepId, tourReduce } from '../tour/tour.js';
import { NOTES, TOUR_STEPS, buildHint, loseWords } from '../words-notes.js';
import { WORDS } from '../words.js';
import './save.css';
import '../notes/notes.css';

const W = ENGINE_WORDS;
type Step = 'folder' | 'edit' | 'review' | 'done';
const BODY_NAME: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, edit: W.label.bodyEdit, review: W.label.bodyReview, done: W.label.bodyResult };
const short = (revision: string): string => revision.slice(0, 8);
/** The plan on screen: a save of the draft's edits, or a go-back to one save point. */
export type Shown = { kind: 'save'; view: SaveView; edits: readonly SaveEdit[] } | { kind: 'restore'; view: RestoreView };

/** The folder's harness and its save points, as one call: a damaged save point record does not stop the edit, and is shown in its own words. */
export async function openCall(engine: NonNullable<ReturnType<typeof useEngine>>, id: string): Promise<Answer<{ view: SaveView; versions: Answer<readonly VersionView[]> }>> {
  const view = await engine.planSave(id, []);
  if (!view.ok) return view;
  return { ok: true, value: { view: view.value, versions: await versionsCall(engine, id) } };
}

export interface SaveSheetProps {
  open: boolean; folderId: string | null;
  /** Starts the guided tour as the edit opens. */ tour?: boolean;
  /** The step the sheet opens on. `review` (the Builder's Save) plans the folder's draft at once, or the go-back to `restore` when one is named. */
  start?: 'folder' | 'review';
  restore?: string | null;
  onClose(): void;
}

export function SaveSheet({ open, folderId, tour: tourAsked = false, start = 'folder', restore = null, onClose }: SaveSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall(), ui = useUi();
  const all = useFolderDrafts();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('folder');
  const fd = useFolderDraft(picked);
  const base = fd.entry.base, draft = fd.draft, versions = fd.entry.versions;
  const [shown, setShown] = useState<Shown | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  // The acknowledgement of the files that can run that the shown plan copies from another folder: the plan's own hash, once ticked.
  const [acked, setAcked] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: Shown['kind']; written: SaveWritten } | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const [aside, setAside] = useState<SetAsideView | null>(null);
  const [asideDone, setAsideDone] = useState<string | null>(null);
  // What the last gesture or the last read said in words: a gesture the draft refused, or a draft dropped because the harness changed.
  const [note, setNote] = useState<string | null>(null);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const tourWanted = useRef(false), wasBuilt = useRef(false);
  // The drafts as they are now, for the plan the sheet makes as it opens on its review step.
  const drafts = useRef(all.drafts);
  drafts.current = all.drafts;
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing;
  const folder = folders.find(f => f.id === picked);
  const editor = useFolderEditor({
    engine, call, folder, folders, onFolders: setFolders, base, draft, positions: fd.entry.positions, onPush: d => { setNote(null); fd.push(d); },
    onRefused: r => setNote(r.words), onHelp: () => tourDo('replay'),
  });

  const { now, world, count, keeper, progress } = editor;
  // The editor's own reads (the keeper, a skill from another folder) hold the sheet too, so Review save never plans past one that is still running.
  const busyWords = call.busy ?? editor.busy, busy = busyWords !== null;

  /**
   * Everything of the sheet's own goes when the folder changes: the plan, its approval and the result, and the reads of the editor. The draft is the folder's,
   * not the sheet's: it stays, and the Builder shows it too.
   */
  const resetFolder = (): void => {
    setShown(null); setApproved(null); setAcked(null); setDone(null); setLinkingId(null); setSelectedId(null); setLastPlan(null);
    setAside(null); setAsideDone(null); setNote(null); call.clear(); editor.reset();
  };
  useEffect(() => {
    if (!open) return;
    tourWanted.current = tourAsked;
    setStep('folder'); setFolders([]); setPicked(null); resetFolder();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'save').off);
      // A folder asked for that cannot be saved picks nothing, and says why: the sheet never saves a folder other than the one the person asked for.
      const asked = folderId === null ? undefined : list.find(f => f.id === folderId);
      const id = folderId === null ? usable[0]?.id ?? null : usable.some(f => f.id === folderId) ? folderId : null;
      setPicked(id);
      if (folderId !== null && id === null) setNote(asked === undefined ? WORDS.hint.noFolder : `${asked.name}: ${folderLine(asked, 'save').words}`);
      // Opened by the Builder's Save or Go back: the plan of that folder at once, from the draft the Builder drew.
      const entry = id === null ? undefined : entryOf(drafts.current, id);
      if (start !== 'review' || id === null || id !== folderId || entry === undefined || entry.base === null) return;
      if (restore !== null) planRestoreOf(id, restore); else planSaveOf(id, entry.base, entry.stack.present);
    });
  }, [open, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(busy, body);

  // The tour: it starts as the edit opens when the sheet was opened for it, or on its own at first use (no keeper saved, and not seen yet: tour/seen.ts),
  // and ends when the edit goes. Once started, it is seen, so it never starts on its own again; Help replays it.
  useEffect(() => {
    if (step === 'edit' && base !== null && (tourWanted.current || startsOnItsOwn({ step, base, seen: WINDOW_TOUR.seen() }))) { tourWanted.current = false; WINDOW_TOUR.mark(); tourDo('replay'); }
    if ((step !== 'edit' || !open) && currentStep(tour) !== null) tourDo('skip');
  }, [step, base, open]);
  // The step that builds the keeper moves on when the keeper is built while it waits, not when it was built before.
  useEffect(() => {
    const built = progress?.done ?? false;
    if (built && !wasBuilt.current && isWaiting(tour)) tourDo('acted');
    wasBuilt.current = built;
  }, [progress?.done, tour]);

  /** Reads the folder's harness and its save points, and opens the edit. The folder's draft stays while the harness is the one it was made on. */
  function load(id: string): void {
    if (engine === null) return;
    const run = (): void => {
      void call.plan(W.label.planning, () => openCall(engine, id), v => {
        // A draft made on another harness cannot stay on this one: say so.
        setNote(loadDropsDraft(entryOf(drafts.current, id) ?? EMPTY_FOLDER, v.view.definition) ? WORDS.hint.draftDropped : null);
        all.dispatch({ kind: 'loaded', folder: id, base: v.view.definition, versions: v.versions }); setShown(null); setApproved(null); setStep('edit');
      });
    };
    setLastPlan(() => run);
    run();
  }
  function planSaveOf(id: string, from: DefinitionView, d: SaveDraft): void {
    if (engine === null) return;
    const edits = draftEdits(from, d);
    const run = (): void => {
      setShown(null); setApproved(null); setAcked(null);
      void call.plan(W.label.planning, () => engine.planSave(id, edits), v => { setShown({ kind: 'save', view: v, edits }); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  }
  function planRestoreOf(id: string, version: string): void {
    if (engine === null) return;
    const run = (): void => {
      setShown(null); setApproved(null); setAcked(null);
      void call.plan(W.label.planning, () => engine.planRestore(id, version), v => { setShown({ kind: 'restore', view: v }); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  }
  const planSave = (): void => { if (folder !== undefined && base !== null) planSaveOf(folder.id, base, draft); };
  const planRestore = (version: string): void => { if (folder !== undefined) planRestoreOf(folder.id, version); };
  /** True when the shown plan may be written: its revision approved, and the files that can run it copies acknowledged, when there are any. */
  const writable = shown !== null && !shown.view.noop && approved === shown.view.revision && (shown.view.acknowledge === null || acked === shown.view.acknowledge);
  const write = (): void => {
    if (engine === null || folder === undefined || shown === null || !writable) return;
    const id = folder.id, s = shown;
    // A plan that copies files that can run sends the acknowledgement with its edits; main writes it only with that.
    const run = (): Promise<Answer<SaveWritten>> => (s.kind === 'save'
      ? engine.runSave(id, s.view.revision, s.view.acknowledge === null ? s.edits : { edits: s.edits, acknowledged: acked })
      : engine.runRestore(id, s.view.revision, s.view.version.id));
    // Written: the draft starts again, and the harness is read again by whoever draws it next.
    void call.write(W.label.writing, run, r => { setDone({ kind: s.kind, written: r }); all.dispatch({ kind: 'saved', folder: id }); setStep('done'); });
  };

  /**
   * "Set old save points aside": plans it, then writes it after main's own dialog. The record is renamed in Bowerloom's private folder and nothing is deleted;
   * the save points are read again after it.
   */
  const setAsideParts: SetAsideParts = {
    view: aside, done: asideDone,
    plan: (): void => {
      if (engine === null || folder === undefined) return;
      const id = folder.id;
      setAsideDone(null);
      void call.plan(W.label.planning, () => engine.planSetAside(id), v => setAside(v));
    },
    run: (): void => {
      if (engine === null || folder === undefined || aside === null) return;
      const id = folder.id, rev = aside.revision;
      void call.write(W.label.writing, async () => {
        const r = await engine.runSetAside(id, rev);
        // The save points are read again after it. A read that fails is the save points' own failure: the set-aside worked, and says so.
        if (r.ok) all.dispatch({ kind: 'versions', folder: id, versions: await versionsCall(engine, id) });
        return r;
      }, r => { setAside(null); setAsideDone(r.name); });
    },
  };

  const pick = (id: string): void => { if (held || id === picked) return; setPicked(id); resetFolder(); };
  const choose = (): void => {
    if (engine === null || held) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!folderLine(got.info, 'save').off) { setPicked(got.info.id); resetFolder(); }
    });
  };
  const back = (to: Step): void => {
    if (held) return;
    call.clear(); setShown(null); setApproved(null); setAcked(null);
    if (to === 'folder') resetFolder();
    setStep(to);
  };
  /** A link drawn on the graph: from an agent to a skill, or to a notes card, as a draft. */
  const onLinkTarget = (partId: string): void => {
    const from = linkingId;
    setLinkingId(null);
    if (from !== null) editor.act({ kind: 'link', a: from, b: partId });
  };
  /** Next on the tour: before the keeper step, the keeper is added from the kit, so the step lights it. */
  const tourNext = (): void => { if (nextStepId(tour) === 'keeper' && keeper === null) editor.addKeeper(() => tourDo('next')); else tourDo('next'); };

  const steps = [W.label.stepFolder, W.label.stepEdit, W.label.stepReview, W.label.stepResult];
  const current = step === 'folder' ? 0 : step === 'edit' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={W.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" data-open-edit="" disabled={folder === undefined || busy} onClick={() => folder !== undefined && load(folder.id)}>{W.label.next}</HButton></>;
  else if (step === 'edit') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><SaveBar count={count}><HButton variant="primary" data-plan-save="" disabled={busy || count === 0} onClick={planSave}>{W.label.reviewSave}</HButton></SaveBar></>;
  else if (step === 'review') {
    const n = shown?.view.changes.length ?? 0, noop = shown?.view.noop ?? true;
    const words = shown === null ? W.label.saved : noop ? W.label.nothingToChange : shown.kind === 'restore' ? goBackWords(shown.view.version.id) : saveFilesWords(n);
    actions = <><HButton disabled={held} onClick={() => back('edit')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !writable} onClick={write}>{words}</HButton></>;
  } else {
    actions = <>
      {done !== null && done.written.written.length > 0 && folder !== undefined ? <HButton data-install-next="" onClick={() => { onClose(); ui.openProject({ folderId: folder.id }); }}>{W.label.installIt}</HButton> : null}
      {folder !== undefined ? <HButton onClick={() => load(folder.id)}>{W.label.stepEdit}</HButton> : null}
      <HButton variant="primary" onClick={onClose}>{W.label.close}</HButton>
    </>;
  }

  const refusal = call.refusal === null ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {lastPlan !== null && step !== 'folder' ? <HButton onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
      {folder !== undefined && call.refusal.code === 'SAVE_RECOVERY_REQUIRED' ? <HButton onClick={() => { onClose(); ui.openAdopt({ folderId: folder.id }); }}>{W.label.planRecovery}</HButton> : null}
      {folder !== undefined && call.refusal.code === 'VERSION_CORRUPT' && step !== 'edit' ? <HButton data-set-aside="" onClick={() => { back('edit'); setAsideParts.plan(); }}>{W.label.planSetAside}</HButton> : null}
    </RefusalNote>
  );
  const nextWords = call.refusal === null ? null : SAVE_REFUSAL_WORDS[call.refusal.code] ?? NOTES_REFUSAL_WORDS[call.refusal.code];

  return (
    <Sheet open={open} title={W.label.saveTitle} onClose={() => { if (!held) onClose(); }} width={880} tall dataSlot="save" head={head}
      note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME[step]} aria-busy={busy}>
        {step === 'folder' ? (
          <FolderStep sheet="save" folders={folders} picked={picked} sample={engine?.mode === 'sample'} noBridge={engine === null} busy={busy} introRef={intro} onPick={pick} onChoose={choose}>
            {refusal}{nextWords === undefined || nextWords === null ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
            {note === null ? null : <p className="hxe-text" role="status" data-folder-note="">{note}</p>}
          </FolderStep>
        ) : null}
        {step !== 'folder' ? (
          <>
            {busy ? <Busy words={busyWords!} /> : null}
            {refusal}
            {nextWords === undefined || nextWords === null ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
          </>
        ) : null}
        {step === 'edit' && base !== null && now !== null && world !== null ? (
          <EditStep base={base} now={now} draft={draft} count={count} held={held || busy} versions={versions} world={world} linkingId={linkingId} selectedId={selectedId}
            onAction={editor.act} onLinkStart={id => setLinkingId(c => (c === id ? null : id))} onLinkTarget={onLinkTarget} onLinkCancel={() => setLinkingId(null)} onSelect={setSelectedId}
            onMove={fd.move} onGoBack={planRestore} setAside={setAsideParts} notes={editor.notes} {...(editor.copy === undefined ? {} : { copy: editor.copy })} />
        ) : null}
        {step === 'edit' && note !== null ? <p className="hxe-text" role="status" data-gesture-note="">{note}</p> : null}
        {step === 'edit' ? editor.refusals.map(r => <RefusalNote key={r.key} refusal={r.refusal} focusId={r.id}>{null}</RefusalNote>) : null}
        {step === 'edit' && editor.opened !== null ? <p className="hxe-text" data-report-opened={editor.opened}><StateDot tone="good">{NOTES.hint.reportOpened}</StateDot></p> : null}
        {step === 'review' && shown !== null ? (
          <SaveReview shown={shown} approved={approved === shown.view.revision} held={held} onApprove={on => setApproved(on ? shown.view.revision : null)}
            acknowledged={shown.view.acknowledge !== null && acked === shown.view.acknowledge} onAcknowledge={on => setAcked(on ? shown.view.acknowledge : null)} />
        ) : null}
        {step === 'done' && done !== null ? (
          <ResultStep nothing={done.written.written.length === 0} warnings={done.written.warnings ?? []} lists={[{ title: W.label.writtenFiles, files: done.written.written }]}>
            {done.written.version === null ? null : <p className="hxe-text" data-version-kept={done.written.version}><StateDot tone="good">{W.hint.pointKept}</StateDot> {done.written.version}</p>}
            {done.written.written.length === 0 ? null : <p className="hxe-text hxe-muted">{W.hint.savedNote} {W.hint.installNext}</p>}
          </ResultStep>
        ) : null}
      </div>
      {open && step === 'edit' && currentStep(tour) !== null ? <TourOverlay state={tour} hint={progress === null ? null : buildHint(progress)} onNext={tourNext} onBack={() => tourDo('back')} onSkip={() => tourDo('skip')} /> : null}
      {open && step === 'edit' ? <TourAnnouncer state={tour} /> : null}
    </Sheet>
  );
}

/** The save bar at the foot of the edit: the number of changes and the one button (first five minutes, section 4 step 7). The tour lights it. */
export function SaveBar({ count, children }: { count: number; children?: ReactNode }): ReactElement {
  return <span className="hxn-savebar" data-tour="save"><span className="hxn-savebar-count" data-savebar-count={count}>{draftWords(count)}</span>{children}</span>;
}

/**
 * The plan of a save or a go-back: each file of `.bowerloom` it changes, with a mark for a file that can run, the folder a copied file comes from, and a change
 * of the execute bit alone; the notes it stops using and the agents that lose them; the harness as it will be; the one tick that approves its revision; and,
 * when it copies files that can run from another folder, the tick that says the person read them. Save waits for both.
 */
export function SaveReview({ shown, approved, held, onApprove, acknowledged = false, onAcknowledge }: { shown: Shown; approved: boolean; held: boolean; onApprove(on: boolean): void; acknowledged?: boolean; onAcknowledge?(on: boolean): void }): ReactElement {
  const v = shown.view;
  const removed = v.removedSources ?? [], copied = v.copiedExecutables ?? [];
  const onlyModes = v.changes.length > 0 && v.changes.every(c => c.modeOnly === true);
  return (
    <div data-save-review={shown.kind}>
      <p className="hxi-sum">{shown.kind === 'restore' ? W.paragraph.goBackIntro : W.paragraph.saveIntro}</p>
      {shown.kind === 'restore' ? <p className="hxe-text" data-going-back={shown.view.version.id}>{shown.view.version.id} · {shown.view.version.label} · {savePointLine(shown.view.version.created, shown.view.version.files)}</p> : null}
      {onlyModes ? <p className="hxe-text" data-mode-only-plan=""><StateDot tone="warn">{W.hint.onlyModes}</StateDot></p> : null}
      <Section title={W.label.changes} count={String(v.changes.length)} slot="save-changes">
        {v.noop ? <p className="hxe-text hxe-muted">{W.hint.sameAsNow}</p> : (
          <ul className="hxi-files">
            {v.changes.map(c => (
              <li key={c.path} className="hxi-file" data-file={c.path} data-action={c.action} data-executable={c.executable === true ? '' : undefined} data-mode-only={c.modeOnly === true ? '' : undefined} data-from={c.from}>
                <span className="hxi-file-path">{c.path}</span>
                <StateDot tone={CHANGE_TONE[c.action]}>{CHANGE_WORDS[c.action]}</StateDot>
                {c.executable === true ? <StateDot tone="warn">{W.hint.canRun}</StateDot> : null}
                {c.modeOnly === true ? <span className="hxe-muted">{W.hint.modeOnly}</span> : null}
                {c.from === undefined ? null : <span className="hxe-muted">{fromWords(c.from)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {removed.length === 0 ? null : (
        <Section title={NOTES.label.stoppedNotes} count={String(removed.length)} slot="save-stopped-notes">
          <ul className="hxe-places">
            {removed.map(r => <li key={r.name} data-stopped-notes={r.name}><span className="hxe-mono">{r.name}</span> <span className="hxe-muted">{r.label}</span> <span>{loseWords(r.agents)}</span></li>)}
          </ul>
          <p className="hxe-text hxe-muted">{NOTES.hint.folderStays}</p>
        </Section>
      )}
      <Section title={W.label.agentSkills} count={String(v.definition.agents.length)} slot="save-agents">
        {v.definition.agents.length === 0 ? <p className="hxe-text hxe-muted">{W.label.noAgents}</p> : (
          <ul className="hxe-places">{v.definition.agents.map(a => <li key={a.id} data-agent-after={a.id}><span className="hxe-mono">{a.name}</span> <span className="hxe-muted">{a.skills.length === 0 ? W.label.noSkills : a.skills.join(', ')}</span>{a.notes.length === 0 ? null : <span className="hxe-muted" data-agent-notes-after={a.id}> · {NOTES.label.notes}: {a.notes.join(', ')}</span>}</li>)}</ul>
        )}
        {keeperOf(v.definition)?.skills.length === 0 ? <p className="hxe-text" data-keeper-no-skills=""><StateDot tone="warn">{NOTES.hint.keeperNoSkills}</StateDot></p> : null}
        <p className="hxe-text hxe-muted">{W.label.interfacesHere}: {v.definition.engines.map((e: EngineId) => ENGINE_NAMES[e]).join(', ')}</p>
      </Section>
      {v.noop || v.acknowledge === null || v.acknowledge === undefined || copied.length === 0 ? null : (
        <ul className="hxe-ticks" data-acknowledge-executables="">
          <TickRow slot="executables" checked={acknowledged} disabled={held} label={W.hint.ackExecutables} name={copied.map(c => c.path).join(', ')} onChange={on => onAcknowledge?.(on)} />
        </ul>
      )}
      {v.noop ? null : (
        <ul className="hxe-ticks hxe-approve" data-approve-plan="">
          <TickRow slot="revision" checked={approved} disabled={held} label={approvePlanWords(short(v.revision))} name={shown.kind === 'restore' ? W.label.goBackTitle : W.label.saveTitle} onChange={onApprove} />
        </ul>
      )}
    </div>
  );
}
