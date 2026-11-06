/**
 * "Add" in the Library (issue 148, variant C): a small form for the tab the person is in, on their own folders. 1. the folder that gets the part, 2. the part, 3. the review, 4. Done.
 *  - Skills: copy a skill from another folder's harness (`add-skill`).
 *  - Agents: the Notes keeper from the ready-made kit (`add-from-kit`), and nothing else.
 *  - Context: attach a notes folder the person chooses, or starts here (`set-source`). The notes step is the one the Builder uses, with its own questions.
 * The sheet always asks which folder. It lists only the folders that hold a harness, because the engine refuses any other (SAVE_NO_DEFINITION), and it says why each other folder is left out.
 * The write is the save step's own, reused as it is: a plan, the list of files, one tick that approves its revision, main's own question, then the write. The window sends ids only, never file text.
 * After the write the only way back is Save points, then Go back, with the same approval (SaveSheet); this sheet adds no undo of its own.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import type { Answer, DefinitionView, FolderInfo, SaveEdit, SaveWritten } from '../../../shared/engine/types.js';
import { KEEPER_EDITS, NOTES_START, copySources, keeperHeld, notesDone, notesEdits, notesRestart, skillEdits, skillHeld, targetsFor } from '../../../shared/harness/library-add.js';
import type { NotesChoice } from '../../../shared/harness/library-add.js';
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
type Step = 'folder' | 'choose' | 'review' | 'done';
type Skills = DefinitionView['skills'];

const TITLE: Readonly<Record<PartKind, string>> = { skill: WORDS.label.addSkillTitle, agent: WORDS.label.addAgentTitle, context: WORDS.label.addNotesTitle, tool: WORDS.label.add };
const INTRO: Readonly<Record<PartKind, string>> = { skill: WORDS.paragraph.addSkillIntro, agent: WORDS.paragraph.addAgentIntro, context: WORDS.paragraph.addNotesIntro, tool: '' };
const BODY: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, choose: WORDS.label.stepChoose, review: W.label.bodyReview, done: W.label.bodyResult };

export interface AddSheetProps { open: boolean; kind: PartKind; onClose(): void }

export function AddSheet({ open, kind, onClose }: AddSheetProps): ReactElement | null {
  const engine = useEngine(), ui = useUi(), scan = useSavedScan();
  // A plan's newest call wins its lane, so the reads of the choose step each have a lane of their own.
  const call = useCall(), targetCall = useCall(), sourceCall = useCall();
  const [step, setStep] = useState<Step>('folder');
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
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
  const held = call.writing;
  const busyWords = call.busy ?? targetCall.busy ?? sourceCall.busy, busy = busyWords !== null;
  const { usable, left } = targetsFor(folders);
  const folder = usable.find(f => f.id === picked);

  const reset = (): void => {
    setTarget(null); setSource(null); setSkills(null); setSkill(null); setChoice(notesRestart); setShown(null); setApproved(null); setAcked(null); setDone(null); setLastPlan(null);
    call.clear(); targetCall.clear(); sourceCall.clear();
  };
  // Opened, or opened for another tab: everything starts again, and the folders are listed anew.
  useEffect(() => {
    if (!open) return;
    setStep('folder'); setFolders([]); setPicked(null); reset();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => { setFolders(list); const ready = targetsFor(list).usable; if (ready.length === 1) setPicked(ready[0]!.id); });
  }, [open, kind, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(busy, body);

  const pick = (id: string): void => { if (busy || id === picked) return; setPicked(id); reset(); };
  const choose = (): void => {
    if (engine === null || busy) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (targetsFor(got.list).usable.some(f => f.id === got.info.id)) { setPicked(got.info.id); reset(); }
    });
  };
  /** Next: reads the folder's harness (a plan with no edits, which writes nothing) so the form knows what it holds already. */
  const next = (): void => {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    void targetCall.plan(W.label.planning, () => engine.planSave(id, []), v => { setTarget(v.definition); setStep('choose'); });
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
    void call.write(W.label.writing, run, r => { setDone(r); setStep('done'); });
  };
  const back = (to: Step): void => { if (held) return; setChoice(notesRestart); call.clear(); setShown(null); setApproved(null); setAcked(null); setStep(to); };

  const keeperIn = target !== null && keeperHeld(target), skillIn = target !== null && skill !== null && skillHeld(target, skill);
  const canReview = !busy && (kind === 'agent' ? !keeperIn : kind === 'skill' ? skill !== null && !skillIn : notes !== null);
  const others = folder === undefined ? [] : copySources(folders, folder.id);

  const current = step === 'folder' ? 0 : step === 'choose' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={[W.label.stepFolder, WORDS.label.stepChoose, W.label.stepReview, W.label.stepResult]} current={current} label={W.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" data-add-next="" disabled={folder === undefined || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (step === 'choose') actions = <><HButton disabled={busy} onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" data-add-review="" disabled={!canReview} onClick={planReview}>{WORDS.label.reviewChange}</HButton></>;
  else if (step === 'review') {
    const n = shown?.view.changes.length ?? 0, noop = shown?.view.noop ?? true;
    const words = shown === null ? W.label.saved : noop ? W.label.nothingToChange : saveFilesWords(n);
    actions = <><HButton disabled={held} onClick={() => back('choose')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !writable} onClick={write}>{words}</HButton></>;
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
    <Sheet open={open} title={TITLE[kind]} onClose={() => { if (!held) onClose(); }} width={760} dataSlot="add" head={head} note={W.hint.readOnly} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY[step]} aria-busy={busy}>
        {busy ? <Busy words={busyWords!} /> : null}
        {refusalNote}
        {step === 'folder' ? (
          <>
            <p className="hxi-intro" tabIndex={-1} ref={intro}>{INTRO[kind]}</p>
            <p className="hxi-intro" data-add-rule="">{engine === null ? W.hint.noBridge : `${WORDS.hint.harnessMeans} ${WORDS.hint.onlyWithHarness}`}</p>
            <h3 className="hxe-head">{WORDS.label.whichFolder}</h3>
            {usable.length === 0 ? (busy || engine === null ? null : <p className="hxe-text" data-add-no-targets="">{WORDS.hint.noTargets}</p>) : (
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
                {source === null ? null : (
                  <section className="hxe-section" aria-label={WORDS.label.whichSkill} data-section="add-skills">
                    <h3 className="hxe-head">{WORDS.label.whichSkill}</h3>
                    {skills === null ? null : skills.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.copyNoSkills}</p> : (
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
                <NotesStep key={choice.gen} onDone={(view, how) => setChoice(c => notesDone(c, choice.gen, view, how))} onReset={() => setChoice(c => ({ ...c, view: null }))} />
                {notes === null ? <p className="hxe-text hxe-muted">{WORDS.hint.pickNotes}</p> : (
                  <p className="hxe-text" data-notes-chosen={notes.id}><StateDot tone="good">{WORDS.hint.notesReady}</StateDot> <span className="hxe-mono">{notes.name}</span> <span className="hxe-muted">{NOTES.label.notes}</span></p>
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
