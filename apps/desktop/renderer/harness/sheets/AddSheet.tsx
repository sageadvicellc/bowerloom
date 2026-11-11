/**
 * "Add" in the Library (issue 148, variant C): a small form for the tab the person is in, on their own folders. 1. the folder that gets the part, 2. the part, 3. the review, 4. Done.
 *  - Skills: copy a skill from another folder's harness (`add-skill`).
 *  - Agents: the Notes keeper from the ready-made kit (`add-from-kit`), and nothing else.
 *  - Context: attach a notes folder the person chooses, or starts here (`set-source`). The notes step is the one the Builder uses, with its own questions.
 *  - Link (`link`, from the empty Context tab's "Link a notes folder"): the same attach, with the notes first. Main's chooser opens at once; then the sheet picks the folder of those notes when it holds
 *    a harness, or starts one with the New harness sheet and its own approval. Nothing is written before that approval, as in every other form.
 * The sheet always asks which folder. It lists only the folders that hold a harness, because the engine refuses any other (SAVE_NO_DEFINITION), and it says why each other folder is left out.
 * The write is the save step's own, reused as it is: a plan, the list of files, one tick that approves its revision, main's own question, then the write. The window sends ids only, never file text.
 * After the write the only way back is Save points, then Go back, with the same approval (SaveSheet); this sheet adds no undo of its own.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import type { Answer, DefinitionView, FolderInfo, SaveEdit, SaveWritten } from '../../../shared/engine/types.js';
import { KEEPER_EDITS, NOTES_START, folderStepLines, linkTarget, listAfter, notesTone, copySources, keeperHeld, notesDone, notesEdits, notesRestart, skillEdits, skillHeld, targetsFor } from '../../../shared/harness/library-add.js';
import type { ListState, NotesChoice } from '../../../shared/harness/library-add.js';
import type { PartKind } from '../../../shared/harness/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { NotesStep } from '../notes/NotesStep.js';
import { useSavedScan } from '../real/saved-scan.js';
import { REAL } from '../real/words-real.js';
import { ENGINE_WORDS, NOTES_REFUSAL_WORDS, SAVE_REFUSAL_WORDS, saveFilesWords } from '../words-engine.js';
import { NOTES } from '../words-notes.js';
import { WORDS } from '../words.js';
import { Busy, RefusalNote, ResultStep } from './engine-parts.js';
import { SaveReview } from './SaveSheet.js';
import type { Shown } from './SaveSheet.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import './save.css';
import './engine.css';

const W = ENGINE_WORDS;
type Step = 'notes' | 'folder' | 'choose' | 'review' | 'done';
type Skills = DefinitionView['skills'];

const TITLE: Readonly<Record<PartKind, string>> = { skill: WORDS.label.addSkillTitle, agent: WORDS.label.addAgentTitle, context: WORDS.label.addNotesTitle, tool: WORDS.label.add };
const INTRO: Readonly<Record<PartKind, string>> = { skill: WORDS.paragraph.addSkillIntro, agent: WORDS.paragraph.addAgentIntro, context: WORDS.paragraph.addNotesIntro, tool: '' };
const BODY: Readonly<Record<Step, string>> = { notes: WORDS.label.stepNotes, folder: W.label.bodyFolder, choose: WORDS.label.stepChoose, review: W.label.bodyReview, done: W.label.bodyResult };

export interface AddSheetProps { open: boolean; kind: PartKind; /** The Context form that starts with the notes (the empty tab's "Link a notes folder"). */ link?: boolean; onClose(): void }

export function AddSheet({ open, kind, link = false, onClose }: AddSheetProps): ReactElement | null {
  const linking = link && kind === 'context';
  const engine = useEngine(), ui = useUi(), scan = useSavedScan();
  // A plan's newest call wins its lane, so the reads of the choose step each have a lane of their own.
  const call = useCall(), targetCall = useCall(), sourceCall = useCall();
  const [step, setStep] = useState<Step>(linking ? 'notes' : 'folder');
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  // Whether the folder list was read. A list that could not be read is not an empty list, and stays failed until a read works.
  const [list, setList] = useState<ListState>('unread');
  // The notes step runs writes of its own (a history, a starter): while one runs, the sheet cannot be left.
  const [notesWriting, setNotesWriting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<DefinitionView | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skills | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  // The notes the form would attach, and the number of the notes step they came from (see `notesDone`).
  const [choice, setChoice] = useState<NotesChoice>(NOTES_START);
  const notes = choice.view;
  const [shown, setShown] = useState<Shown | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  const [acked, setAcked] = useState<string | null>(null);
  const [done, setDone] = useState<SaveWritten | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing || notesWriting;
  const busyWords = call.busy ?? targetCall.busy ?? sourceCall.busy, busy = busyWords !== null;
  const { usable, left } = targetsFor(folders);
  const lines = folderStepLines({ list, usable: usable.length, busy, bridge: engine !== null });
  const folder = usable.find(f => f.id === picked);
  // The folder that holds the chosen notes: it gets the link when its harness loads, and starts one when it has none.
  const target0 = linking && choice.view !== null ? linkTarget(folders, choice.view) : null;

  const reset = (): void => {
    setTarget(null); setSource(null); setSkills(null); setSkill(null); setChoice(notesRestart); setShown(null); setApproved(null); setAcked(null); setDone(null); setLastPlan(null);
    call.clear(); targetCall.clear(); sourceCall.clear();
  };
  // Opened, or opened for another tab: everything starts again, and the folders are listed anew.
  useEffect(() => {
    if (!open) return;
    setStep(linking ? 'notes' : 'folder'); setFolders([]); setList('unread'); setPicked(null); reset();
    readFolders();
  }, [open, kind, engine, linking]);
  // The link form picks the folder of the chosen notes for the person once it is a folder that can take them. The form still shows it.
  useEffect(() => {
    if (target0 !== null && target0.kind === 'ready' && step === 'folder') setPicked(target0.folder.id);
  }, [target0?.kind, target0?.folder?.id, step]);
  // The New harness sheet closed: the folders are read again, so a harness it made is there.
  const adoptWas = useRef(false);
  useEffect(() => {
    const was = adoptWas.current; adoptWas.current = ui.adopt.open;
    if (open && linking && was && !ui.adopt.open) readFolders();
  }, [ui.adopt.open]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' || step === 'notes' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(busy, body);

  /** Reads the list of folders. The folder is picked for the person only when exactly one can take the part; the form still shows it and asks. */
  function readFolders(): void {
    if (engine === null) return;
    // A read that fails stays failed on screen even after its refusal goes (the next plan clears it), so Try again does not depend on the refusal.
    const read = async (): ReturnType<typeof foldersCall> => { try { return await foldersCall(engine); } catch (error) { setList(l => listAfter(l, 'failed')); throw error; } };
    void call.plan(W.label.planning, read, got => { setFolders(got); setList(l => listAfter(l, 'ok')); const ready = targetsFor(got).usable; if (ready.length === 1) setPicked(ready[0]!.id); });
  }
  const pick = (id: string): void => { if (busy || id === picked) return; setPicked(id); reset(); };
  const choose = (): void => {
    if (engine === null || busy) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      // A closed chooser changes nothing: the earlier message and Try again stay. A pick returns the whole list, so it counts as a read.
      if (got === null) return;
      setFolders(got.list); setList(l => listAfter(l, 'picked'));
      if (targetsFor(got.list).usable.some(f => f.id === got.info.id)) { setPicked(got.info.id); reset(); }
    });
  };
  /** Next: reads the folder's harness (a plan with no edits, which writes nothing) so the form knows what it holds already. */
  const next = (): void => {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    void targetCall.plan(W.label.planning, () => engine.planSave(id, []), v => { setTarget(v.definition); if (linking) planReview(); else setStep('choose'); });
  };
  /** The link form's "Start a harness": the New harness sheet for the folder of the notes, which has none. Its own approval comes before any write. */
  const startHarness = (): void => {
    if (engine === null || busy || target0 === null || target0.kind !== 'needs-harness' || target0.folder === null) return;
    ui.openAdopt({ folderId: target0.folder.id });
  };

  /** The skills of another folder's harness, by id, name and description. */
  const pickSource = (id: string): void => {
    if (engine === null) return;
    setSource(id); setSkills(null); setSkill(null);
    void sourceCall.plan(W.label.planning, () => engine.planSave(id, []), v => setSkills(v.definition.skills));
  };

  const edits = (): SaveEdit[] | null => {
    if (kind === 'skill') return skill === null || source === null ? null : skillEdits(skill, source);
    if (kind === 'agent') return [...KEEPER_EDITS];
    if (kind === 'context') return notes === null ? null : notesEdits(notes);
    return null;
  };
  const planReview = (): void => {
    const list = edits();
    if (engine === null || folder === undefined || list === null) return;
    const id = folder.id;
    const run = (): void => {
      setShown(null); setApproved(null); setAcked(null);
      void call.plan(W.label.planning, () => engine.planSave(id, list), v => { setShown({ kind: 'save', view: v, edits: list }); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  };
  const writable = shown !== null && !shown.view.noop && approved === shown.view.revision && (shown.view.acknowledge === null || acked === shown.view.acknowledge);
  const write = (): void => {
    if (engine === null || folder === undefined || shown === null || shown.kind !== 'save' || !writable) return;
    const id = folder.id, s = shown;
    const run = (): Promise<Answer<SaveWritten>> => engine.runSave(id, s.view.revision, s.view.acknowledge === null ? s.edits : { edits: s.edits, acknowledged: acked });
    void call.write(W.label.writing, run, r => { setDone(r); setStep('done'); if (r.written.length > 0) scan.markWrote(); });
  };
  const back = (to: Step): void => { if (held) return; if (to !== 'folder' || !linking) setChoice(notesRestart); call.clear(); targetCall.clear(); sourceCall.clear(); setShown(null); setApproved(null); setAcked(null); setStep(to); };

  const keeperIn = target !== null && keeperHeld(target), skillIn = target !== null && skill !== null && skillHeld(target, skill);
  const canReview = !busy && !held && (kind === 'agent' ? !keeperIn : kind === 'skill' ? skill !== null && !skillIn : notes !== null);
  const others = folder === undefined ? [] : copySources(folders, folder.id);

  const current = step === 'folder' ? (linking ? 1 : 0) : step === 'notes' ? 0 : step === 'choose' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={linking ? [WORDS.label.stepNotes, W.label.stepFolder, W.label.stepReview, W.label.stepResult] : [W.label.stepFolder, WORDS.label.stepChoose, W.label.stepReview, W.label.stepResult]} current={current} label={W.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'notes') actions = <><HButton onClick={onClose} disabled={held}>{W.label.cancel}</HButton><HButton variant="primary" data-add-next="" disabled={notes === null || busy || held} onClick={() => setStep('folder')}>{W.label.next}</HButton></>;
  else if (step === 'folder') actions = <>{linking ? <HButton disabled={busy || held} onClick={() => back('notes')}>{W.label.back}</HButton> : <HButton onClick={onClose}>{W.label.cancel}</HButton>}<HButton variant="primary" data-add-next="" disabled={folder === undefined || busy} onClick={next}>{linking ? WORDS.label.reviewChange : W.label.next}</HButton></>;
  else if (step === 'choose') actions = <><HButton disabled={busy || held} onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" data-add-review="" disabled={!canReview} onClick={planReview}>{WORDS.label.reviewChange}</HButton></>;
  else if (step === 'review') {
    const n = shown?.view.changes.length ?? 0, noop = shown?.view.noop ?? true;
    const words = shown === null ? W.label.saved : noop ? W.label.nothingToChange : saveFilesWords(n);
    actions = <><HButton disabled={held} onClick={() => back(linking ? 'folder' : 'choose')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !writable} onClick={write}>{words}</HButton></>;
  } else {
    const wrote = done !== null && done.written.length > 0;
    actions = <>
      {wrote ? <HButton data-add-read-again="" onClick={() => { onClose(); scan.readAgain(); }}>{REAL.label.readAgain}</HButton> : null}
      {folder !== undefined && wrote ? <HButton data-add-save-points="" onClick={() => { onClose(); ui.openSave({ folderId: folder.id }); }}>{WORDS.label.openSavePoints}</HButton> : null}
      <HButton variant="primary" onClick={onClose}>{W.label.close}</HButton>
    </>;
  }

  const refusal = call.refusal ?? targetCall.refusal ?? sourceCall.refusal;
  const refusalId = call.refusal !== null ? call.refusalId : targetCall.refusal !== null ? targetCall.refusalId : sourceCall.refusalId;
  const nextWords = refusal === null ? null : SAVE_REFUSAL_WORDS[refusal.code] ?? NOTES_REFUSAL_WORDS[refusal.code];
  const refusalNote = refusal === null ? null : (
    <>
      <RefusalNote refusal={refusal} focusId={refusalId}>{lastPlan !== null && step !== 'folder' && step !== 'choose' ? <HButton onClick={lastPlan}>{W.label.planAgain}</HButton> : null}</RefusalNote>
      {nextWords === undefined || nextWords === null ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
    </>
  );

  return (
    <Sheet open={open} title={linking ? WORDS.label.linkNotesTitle : TITLE[kind]} onClose={() => { if (!held) onClose(); }} width={760} dataSlot="add" head={head} note={W.hint.readOnly} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY[step]} aria-busy={busy}>
        {busy ? <Busy words={busyWords!} /> : null}
        {refusalNote}
        {step === 'notes' ? (
          <>
            <p className="hxi-intro" tabIndex={-1} ref={intro}>{WORDS.hint.linkIntro}</p>
            <section className="hxe-section" aria-label={WORDS.label.notesChosen} data-section="link-notes">
              <NotesStep key={choice.gen} start={choice.view === null ? 'use' : undefined} onBusy={setNotesWriting} onDone={(view, how) => setChoice(c => notesDone(c, choice.gen, view, how))} onReset={() => setChoice(c => ({ ...c, view: null }))} />
              {notes === null ? null : (
                <p className="hxe-text" data-notes-chosen={notes.id}><StateDot tone={notesTone(choice.how)}>{notesTone(choice.how) === 'good' ? WORDS.hint.notesReady : WORDS.hint.notesReportOnly}</StateDot> <span className="hxe-mono">{notes.name}</span> <span className="hxe-muted">{NOTES.label.notes}</span></p>
              )}
            </section>
          </>
        ) : null}
        {step === 'folder' ? (
          <>
            <p className="hxi-intro" tabIndex={-1} ref={intro}>{linking ? WORDS.hint.linkWhich : INTRO[kind]}</p>
            <p className="hxi-intro" data-add-rule="">{engine === null ? W.hint.noBridge : `${WORDS.hint.harnessMeans} ${WORDS.hint.onlyWithHarness}`}</p>
            <h3 className="hxe-head">{WORDS.label.whichFolder}</h3>
            {usable.length === 0 ? (lines.noTargets ? <p className="hxe-text" data-add-no-targets="">{WORDS.hint.noTargets}</p> : null) : (
              <ul className="hxi-list hxe-folders" aria-label={W.label.folders}>
                {usable.map(f => (
                  <li key={f.id}>
                    <button type="button" className="hxi-card" aria-pressed={f.id === picked} aria-disabled={busy ? true : undefined} data-folder={f.id} onClick={() => pick(f.id)}>
                      <Tile name="folder" />
                      <span className="hxi-card-text"><span className="hxi-card-name">{f.name}</span><span className="hxi-card-sub">{f.label}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {lines.tryAgain ? <p className="hxe-text" data-list-failed="">{WORDS.hint.listFailed}</p> : null}
            {lines.tryAgain ? <HButton data-try-again="" onClick={readFolders}>{W.label.tryAgain}</HButton> : null}
            {target0 === null || target0.kind === 'ready' ? null : (
              <p className="hxe-text" data-link-needs-harness="">{target0.kind === 'blocked' ? target0.why : target0.folder === null ? WORDS.hint.chooseAgain : WORDS.hint.needsHarness}</p>
            )}
            {target0 === null || target0.kind !== 'needs-harness' || target0.folder === null ? null : <HButton icon="plus" variant="primary" data-link-start-harness="" disabled={busy || engine === null} onClick={startHarness}>{WORDS.label.startHarness}</HButton>}
            <HButton icon="plus" disabled={busy || engine === null} onClick={choose}>{W.label.chooseFolder}</HButton>
            {left.length === 0 ? null : (
              <section className="hxe-section" aria-label={WORDS.label.leftOut} data-section="add-left-out">
                <h3 className="hxe-head"><span>{WORDS.label.leftOut}</span><span className="hxe-count">{left.length}</span></h3>
                <ul className="hxe-places">
                  {left.map(l => <li key={l.folder.id} data-left-out={l.folder.id}><span className="hxe-mono">{l.folder.name}</span> <span className="hxe-muted">{l.why}</span></li>)}
                </ul>
              </section>
            )}
          </>
        ) : null}
        {step === 'choose' && folder !== undefined ? (
          <>
            <p className="hxe-text" data-add-into=""><span className="hxe-mono">{folder.name}</span> <span className="hxe-muted">{folder.label}</span></p>
            {kind === 'skill' ? (
              <>
                <h3 className="hxe-head">{WORDS.label.copyFromWhich}</h3>
                {others.length === 0 ? <p className="hxe-text hxe-muted" data-add-no-sources="">{WORDS.hint.noSources}</p> : (
                  <ul className="hxi-list hxe-folders" aria-label={W.label.folders}>
                    {others.map(f => (
                      <li key={f.id}>
                        <button type="button" className="hxi-card" aria-pressed={f.id === source} data-source={f.id} disabled={busy} onClick={() => pickSource(f.id)}>
                          <Tile name="folder" />
                          <span className="hxi-card-text"><span className="hxi-card-name">{f.name}</span><span className="hxi-card-sub">{f.label}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {source === null || skills === null ? null : (
                  <section className="hxe-section" aria-label={WORDS.label.whichSkill} data-section="add-skills">
                    <h3 className="hxe-head">{WORDS.label.whichSkill}</h3>
                    { skills.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.copyNoSkills}</p> : (
                      <>
                        <p className="hxe-text hxe-muted">{WORDS.hint.pickSkill}</p>
                        <ul className="hxs-ticks">
                          {skills.map(s => {
                            const has = target !== null && skillHeld(target, s.id);
                            return (
                              <li key={s.id}>
                                <label className="hxs-tick" data-skill={s.id}>
                                  <input type="radio" name="add-skill" className="hxi-check" disabled={has || busy} checked={skill === s.id} onChange={() => setSkill(s.id)} aria-label={s.name} />
                                  <span>{s.name}</span>
                                  {has ? <span className="hxe-muted">{WORDS.hint.skillHeld}</span> : <span className="hxe-muted hxs-desc">{s.description}</span>}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </section>
                )}
              </>
            ) : null}
            {kind === 'agent' ? (
              <section className="hxe-section" aria-label={WORDS.label.theKeeper} data-section="add-keeper">
                <h3 className="hxe-head">{WORDS.label.theKeeper}</h3>
                <p className="hxe-text">{keeperIn ? WORDS.hint.keeperHeld : WORDS.paragraph.addAgentIntro}</p>
              </section>
            ) : null}
            {kind === 'context' ? (
              <section className="hxe-section" aria-label={WORDS.label.notesChosen} data-section="add-notes">
                <h3 className="hxe-head">{WORDS.label.notesChosen}</h3>
                <NotesStep key={choice.gen} onBusy={setNotesWriting} onDone={(view, how) => setChoice(c => notesDone(c, choice.gen, view, how))} onReset={() => setChoice(c => ({ ...c, view: null }))} />
                {notes === null ? <p className="hxe-text hxe-muted">{WORDS.hint.pickNotes}</p> : (
                  <p className="hxe-text" data-notes-chosen={notes.id}><StateDot tone={notesTone(choice.how)}>{notesTone(choice.how) === 'good' ? WORDS.hint.notesReady : WORDS.hint.notesReportOnly}</StateDot> <span className="hxe-mono">{notes.name}</span> <span className="hxe-muted">{NOTES.label.notes}</span></p>
                )}
              </section>
            ) : null}
          </>
        ) : null}
        {step === 'review' && shown !== null ? (
          <SaveReview shown={shown} approved={approved === shown.view.revision} held={held} onApprove={on => setApproved(on ? shown.view.revision : null)}
            acknowledged={shown.view.acknowledge !== null && acked === shown.view.acknowledge} onAcknowledge={on => setAcked(on ? shown.view.acknowledge : null)} />
        ) : null}
        {step === 'done' && done !== null ? (
          <ResultStep nothing={done.written.length === 0} warnings={done.warnings ?? []} lists={[{ title: W.label.writtenFiles, files: done.written }]}>
            {done.version === null ? null : <p className="hxe-text" data-version-kept={done.version}><StateDot tone="good">{W.hint.pointKept}</StateDot> {done.version}</p>}
            {done.written.length === 0 ? null : <p className="hxe-text hxe-muted" data-add-after="">{WORDS.hint.undoNote} {WORDS.hint.readAgainNote}</p>}
          </ResultStep>
        ) : null}
      </div>
    </Sheet>
  );
}
