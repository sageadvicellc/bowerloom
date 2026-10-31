/**
 * The notes step (first five minutes, section 4 step 3; spec 6.9 "Link or create"): one question, "Where do you keep your notes?", and two buttons.
 *  - "Use my notes" opens main's notes chooser. A folder with a history is ready. A folder with none gets an offer to start one, with the list of files the first
 *    record holds; "Not now" leaves it as it is, and the keeper then only reports.
 *  - "Start fresh" opens the chooser for an empty folder, shows the starter files, then one button, "Create".
 * Each write runs only after main's own dialog, for the plan shown last. The step is drawn in the first run and in the Notes panel: both reach the same
 * component, and each gets the chosen folder through `onDone`, which also keeps it for this window (notes-session.tsx).
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Answer, NotesHistoryPlanView, NotesStarterView, NotesView, Refusal } from '../../../shared/engine/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { Busy, RefusalNote } from '../sheets/engine-parts.js';
import { useCall } from '../sheets/use-call.js';
import { notesNextWords } from '../words-engine.js';
import { NOTES, hiddenWords, moreWords, pagesWords } from '../words-notes.js';
import { afterChoose } from './notes-logic.js';
import { useNotesSession } from './notes-session.js';
import './notes.css';

/** How a finished step left the notes. */
export type NotesEnd = 'ready' | 'created' | 'report-only' | 'no-commit' | 'git-missing' | 'refused' | 'unreadable';
export type NotesPhase =
  | { readonly kind: 'ask' }
  | { readonly kind: 'offer'; readonly view: NotesView; readonly plan: NotesHistoryPlanView | null }
  | { readonly kind: 'starter'; readonly view: NotesView; readonly plan: NotesStarterView | null }
  | { readonly kind: 'done'; readonly view: NotesView; readonly how: NotesEnd };

/** The most file names the history offer lists on screen. The count says how many in all. */
const LIST_LIMIT = 12;
const END_WORDS: Readonly<Record<NotesEnd, string>> = Object.freeze({
  ready: NOTES.hint.ready, created: NOTES.hint.created, 'report-only': NOTES.hint.reportOnly, 'no-commit': NOTES.hint.noCommit, 'git-missing': NOTES.hint.gitMissing,
  refused: NOTES.hint.refused, unreadable: NOTES.hint.unreadable,
});

export interface NotesStepViewProps {
  phase: NotesPhase;
  busy: string | null;
  refusal: Refusal | null;
  refusalId: number;
  held: boolean;
  onUse(): void; onFresh(): void; onStartHistory(): void; onDecline(): void; onCreate(): void; onAgain(): void;
}

/** The step as it looks in each phase. No call: the container (NotesStep) makes them. */
export function NotesStepView({ phase, busy, refusal, refusalId, held, onUse, onFresh, onStartHistory, onDecline, onCreate, onAgain }: NotesStepViewProps): ReactElement {
  // A write that stopped part way gets the advice of its own step: the history start in the offer, the starter in "Start fresh".
  const next = refusal === null ? null : notesNextWords(refusal, phase.kind === 'offer' ? 'history' : phase.kind === 'starter' ? 'starter' : null);
  const off = held || busy !== null;
  return (
    <div className="hxn-step" data-notes-step={phase.kind}>
      <p className="hxn-question">{NOTES.hint.question}</p>
      {busy === null ? null : <Busy words={busy} />}
      {refusal === null ? null : <RefusalNote refusal={refusal} focusId={refusalId}>{null}</RefusalNote>}
      {next === null ? null : <p className="hxe-text" data-next-step="">{next}</p>}
      {phase.kind === 'ask' ? (
        <div className="hxn-ways">
          <span className="hxn-way"><HButton icon="folder" variant="primary" disabled={off} data-notes-use="" onClick={onUse}>{NOTES.label.useMine}</HButton><span className="hxe-muted">{NOTES.hint.useHint}</span></span>
          <span className="hxn-way"><HButton icon="plus" disabled={off} data-notes-fresh="" onClick={onFresh}>{NOTES.label.startFresh}</HButton><span className="hxe-muted">{NOTES.hint.freshHint}</span></span>
        </div>
      ) : null}
      {phase.kind === 'offer' ? (
        <div data-notes-offer="">
          <p className="hxn-folder"><span className="hxn-folder-name">{phase.view.name}</span> <span className="hxe-muted">{pagesWords(phase.view.pages, phase.view.complete)}</span></p>
          <p className="hxe-text">{NOTES.hint.offerHistory}</p>
          {phase.plan === null ? null : (
            <>
              <p className="hxe-text hxe-muted">{NOTES.hint.historyNote}</p>
              <h4 className="hxn-tray-head">{NOTES.label.historyFiles} <span className="hxe-count">{phase.plan.count}</span></h4>
              <ul className="hxi-files">
                {phase.plan.files.slice(0, LIST_LIMIT).map(f => <li key={f.path} className="hxi-file" data-history-file={f.path}><span className="hxi-file-path">{f.path}</span></li>)}
              </ul>
              {phase.plan.count > LIST_LIMIT ? <p className="hxe-text hxe-muted">{moreWords(phase.plan.count - LIST_LIMIT)}</p> : null}
              {phase.plan.hidden === 0 ? null : <p className="hxe-text hxe-muted">{hiddenWords(phase.plan.hidden)}</p>}
            </>
          )}
          <div className="hxn-ways">
            <HButton variant="primary" disabled={off || phase.plan === null} data-start-history="" onClick={onStartHistory}>{NOTES.label.startHistory}</HButton>
            <HButton disabled={off} data-decline-history="" onClick={onDecline}>{NOTES.label.declineHistory}</HButton>
          </div>
        </div>
      ) : null}
      {phase.kind === 'starter' ? (
        <div data-notes-starter="">
          <p className="hxn-folder"><span className="hxn-folder-name">{phase.view.name}</span></p>
          <p className="hxe-text">{NOTES.hint.starterNote}</p>
          {phase.plan === null ? null : (
            <>
              <h4 className="hxn-tray-head">{NOTES.label.starterFiles} <span className="hxe-count">{phase.plan.files.length}</span></h4>
              <ul className="hxi-files">
                {phase.plan.files.map(f => <li key={f.path} className="hxi-file" data-starter-file={f.path}><span className="hxi-file-path">{f.path}</span></li>)}
              </ul>
            </>
          )}
          <div className="hxn-ways">
            <HButton variant="primary" disabled={off || phase.plan === null} data-notes-create="" onClick={onCreate}>{NOTES.label.create}</HButton>
            <HButton disabled={off} onClick={onAgain}>{NOTES.label.chooseAgain}</HButton>
          </div>
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <div data-notes-done={phase.how}>
          <p className="hxn-folder"><span className="hxn-folder-name">{phase.view.name}</span> <span className="hxe-muted">{pagesWords(phase.view.pages, phase.view.complete)}</span></p>
          <p className="hxe-text"><StateDot tone={phase.how === 'ready' || phase.how === 'created' ? 'good' : 'quiet'}>{END_WORDS[phase.how]}</StateDot></p>
          <HButton size="small" disabled={off} onClick={onAgain}>{NOTES.label.chooseAgain}</HButton>
        </div>
      ) : null}
    </div>
  );
}

export interface NotesStepProps {
  /** Called with the folder when the step ends: ready, created, or left as it is. */
  onDone?(view: NotesView, how: NotesEnd): void;
  /** Opens straight on one of the two ways, as the Notes panel's buttons do. */
  start?: 'use' | 'start';
}

/** The step with its calls: main's notes chooser, the two plans and the two writes. */
export function NotesStep({ onDone, start }: NotesStepProps): ReactElement {
  const engine = useEngine(), call = useCall(), session = useNotesSession();
  const [phase, setPhase] = useState<NotesPhase>({ kind: 'ask' });
  const began = useRef(false), box = useRef<HTMLDivElement>(null);
  // Each new phase is brought into view: in the Notes panel the step opens below the map, so its files and its button stay in sight.
  useEffect(() => { if (phase.kind !== 'ask') box.current?.scrollIntoView({ block: 'start' }); }, [phase.kind]);
  const finish = (view: NotesView, how: NotesEnd): void => { session.choose(view); setPhase({ kind: 'done', view, how }); onDone?.(view, how); };
  /** main's chooser: null when the person closed it, which is no refusal. */
  const choose = async (purpose: 'use' | 'start'): Promise<Answer<NotesView | null>> => {
    const got = await engine!.chooseNotesFolder(purpose);
    return got === null ? { ok: true, value: null } : got;
  };
  const use = (): void => {
    if (engine === null) return;
    void call.plan(NOTES.label.reading, () => choose('use'), view => {
      if (view === null) return;
      const next = afterChoose(view);
      if (next === 'offer-history') {
        setPhase({ kind: 'offer', view, plan: null });
        void call.plan(NOTES.label.reading, () => engine.planNotesHistory(view.id), plan => setPhase({ kind: 'offer', view, plan }));
      } else finish(view, next);
    });
  };
  const fresh = (): void => {
    if (engine === null) return;
    void call.plan(NOTES.label.reading, () => choose('start'), view => {
      if (view === null) return;
      setPhase({ kind: 'starter', view, plan: null });
      void call.plan(NOTES.label.reading, () => engine.planCreateNotes(view.id), plan => setPhase({ kind: 'starter', view, plan }));
    });
  };
  /** After a write, the folder is read again, so the panel shows its new history. */
  const written = async (id: string, run: () => Promise<Answer<unknown>>): Promise<Answer<NotesView>> => {
    const r = await run();
    return r.ok ? engine!.notesSummary(id) : r;
  };
  const startHistory = (): void => {
    if (engine === null || phase.kind !== 'offer' || phase.plan === null) return;
    const id = phase.view.id, rev = phase.plan.revision;
    void call.write(NOTES.label.writing, () => written(id, () => engine.runNotesHistory(id, rev)), view => finish(view, 'ready'));
  };
  const create = (): void => {
    if (engine === null || phase.kind !== 'starter' || phase.plan === null) return;
    const id = phase.view.id, rev = phase.plan.revision;
    void call.write(NOTES.label.writing, () => written(id, () => engine.runCreateNotes(id, rev)), view => finish(view, 'created'));
  };
  const decline = (): void => { if (phase.kind === 'offer') finish(phase.view, 'report-only'); };
  const again = (): void => { if (call.writing) return; call.clear(); setPhase({ kind: 'ask' }); };
  useEffect(() => {
    if (began.current || start === undefined) return;
    began.current = true;
    if (start === 'use') use(); else fresh();
  }, [start]);
  return (
    <div ref={box}>
      <NotesStepView phase={phase} busy={call.busy} refusal={call.refusal} refusalId={call.refusalId} held={call.writing || engine === null}
        onUse={use} onFresh={fresh} onStartHistory={startHistory} onDecline={decline} onCreate={create} onAgain={again} />
    </div>
  );
}
