/**
 * "Edit a folder's harness" (0.8.0-beta.1, option C): one folder saves its own harness. 1. the folder, 2. the edit, 3. the review, 4. Done.
 * - The edit draws the folder's harness with the builder's own graph (shared/harness/save-draft.ts maps it onto the parts world): a link drawn from an agent
 *   to a skill, a tick in "Skills each agent uses", a removed skill and the interfaces are a draft. Nothing is sent until the review, and nothing is written
 *   until Save (spec 6.6). The draft becomes a closed list of ids; the window never sends a path or file text.
 * - The review lists each file of `.bowerloom` the save changes, and ends with one tick box that approves its revision. Main asks once more in its own
 *   dialog. Done lists each file written and the save point kept, and offers the install, which is its own sheet and its own dialog.
 * - "Save points" lists every save point, newest first. "Go back" plans a save whose target is that save point, reviewed and approved the same way. A
 *   damaged record is a refusal in words, never an empty list.
 * - A refusal takes the focus, says what to do next, and offers "Plan again", or the recovery of a stopped change.
 * - The edit is My agents for the folder (first five minutes, section 5): the map, the Notes panel with its notes step, and, once the harness holds it (or the
 *   draft adds it from the kit), the Notes keeper with its two shelves. The save bar at the foot holds the count and the one button. A Help button replays the
 *   guided tour, which also starts as the edit opens when the sheet was opened for it (`tour`). The tour adds the keeper from the kit before it lights it.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { ENGINE_IDS, isPreviewEngine } from '../../../shared/engine/engines.js';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { Answer, DefinitionView, EngineId, FolderInfo, NotesView, Refusal, RestoreView, SaveEdit, SaveView, SaveWritten, SetAsideView, VersionView } from '../../../shared/engine/types.js';
import {
  EMPTY_DRAFT, KEEPER_AGENT, KEEPER_KIT, addKit, agentPart, attachNotes, definitionWorld, draftCount, draftEdits, draftView, keeperOf, keeperSkills, linkRest, linkSkill,
  draftStart, partNotes, partSkill, removeSkill, setDraftEngines,
} from '../../../shared/harness/save-draft.js';
import type { SaveDraft } from '../../../shared/harness/save-draft.js';
import type { Point } from '../../../shared/harness/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { Graph } from '../screens/builder/Graph.js';
import { CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, SAVE_REFUSAL_WORDS, approvePlanWords, draftWords, goBackWords, saveFilesWords, savePointLine } from '../words-engine.js';
import { Busy, FolderStep, RefusalNote, ResultStep, Section, TickRow, folderLine } from './engine-parts.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import { KeeperBuild } from '../notes/KeeperBuild.js';
import { NotesPanel } from '../notes/NotesPanel.js';
import { NotesStep } from '../notes/NotesStep.js';
import { buildProgress, notesCards } from '../notes/notes-logic.js';
import type { NotesCard } from '../notes/notes-logic.js';
import { useNotesSession } from '../notes/notes-session.js';
import { TourAnnouncer, TourOverlay } from '../tour/TourOverlay.js';
import { createTour, currentStep, isWaiting, nextStepId, tourReduce } from '../tour/tour.js';
import { NOTES, TOUR_STEPS, buildHint } from '../words-notes.js';
import './save.css';
import '../notes/notes.css';

const W = ENGINE_WORDS;
type Step = 'folder' | 'edit' | 'review' | 'done';
const BODY_NAME: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, edit: W.label.bodyEdit, review: W.label.bodyReview, done: W.label.bodyResult };
const short = (revision: string): string => revision.slice(0, 8);
/** The plan on screen: a save of the draft's edits, or a go-back to one save point. */
export type Shown = { kind: 'save'; view: SaveView; edits: readonly SaveEdit[] } | { kind: 'restore'; view: RestoreView };

/** The folder's harness and its save points, as one call: a damaged save point record does not stop the edit, and is shown in its own words. */
async function openCall(engine: NonNullable<ReturnType<typeof useEngine>>, id: string): Promise<Answer<{ view: SaveView; versions: Answer<readonly VersionView[]> }>> {
  const view = await engine.planSave(id, []);
  if (!view.ok) return view;
  return { ok: true, value: { view: view.value, versions: await engine.listVersions(id) } };
}

export interface SaveSheetProps { open: boolean; folderId: string | null; /** Starts the guided tour as the edit opens. */ tour?: boolean; onClose(): void }

export function SaveSheet({ open, folderId, tour: tourAsked = false, onClose }: SaveSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall(), ui = useUi(), session = useNotesSession();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('folder');
  const [base, setBase] = useState<DefinitionView | null>(null);
  const [draft, setDraft] = useState<SaveDraft>(EMPTY_DRAFT);
  const [versions, setVersions] = useState<Answer<readonly VersionView[]> | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: Shown['kind']; written: SaveWritten } | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Readonly<Record<string, Point>>>({});
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const [aside, setAside] = useState<SetAsideView | null>(null);
  const [asideDone, setAsideDone] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Readonly<Record<string, Answer<NotesView>>>>({});
  const [notesWay, setNotesWay] = useState<'use' | 'start' | null>(null);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const tourWanted = useRef(false), reading = useRef(new Set<string>()), wasBuilt = useRef(false);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing, busy = call.busy !== null;

  /** Everything of one folder goes when the folder changes: the harness read, the draft, the plan, its approval and the result. */
  const resetFolder = (): void => { setBase(null); setDraft(EMPTY_DRAFT); setVersions(null); setShown(null); setApproved(null); setDone(null); setLinkingId(null); setSelectedId(null); setPositions({}); setLastPlan(null); setAside(null); setAsideDone(null); setNotesWay(null); call.clear(); };
  useEffect(() => {
    if (!open) return;
    tourWanted.current = tourAsked;
    setStep('folder'); setFolders([]); setPicked(null); resetFolder();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'save').off);
      setPicked(folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null);
    });
  }, [open, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(busy, body);

  const folder = folders.find(f => f.id === picked);
  const now = useMemo(() => (base === null ? null : draftView(base, draft)), [base, draft]);
  const cards = useMemo(() => (now === null ? [] : notesCards(now, session.chosen, summaries)), [now, session.chosen, summaries]);
  const world = useMemo(() => {
    if (now === null) return null;
    const w = definitionWorld(now, cards.filter(c => !c.attached).map(c => c.source));
    return { state: w.state, harness: { ...w.harness, positions } };
  }, [now, cards, positions]);
  const count = base === null ? 0 : draftCount(base, draft);
  const offeredIds = base === null ? [] : keeperSkills(base, draft);
  const keeper = now === null ? null : keeperOf(now);
  const progress = now === null ? null : buildProgress(now, offeredIds, cards);

  // The Notes panel reads each source the harness holds once: names and counts only. A chosen folder carries its own read.
  useEffect(() => {
    if (engine === null || now === null) return;
    for (const s of now.sources) {
      if (reading.current.has(s.notesId) || session.chosen.some(c => c.id === s.notesId)) continue;
      reading.current.add(s.notesId);
      const id = s.notesId;
      const failed: Answer<NotesView> = { ok: false, refusal: { code: 'FAILED', message: NOTES.hint.noSummary, paths: [] } };
      void engine.notesSummary(id).catch(() => failed).then(a => setSummaries(m => ({ ...m, [id]: a })));
    }
  }, [engine, now, session.chosen]);
  // The tour: it starts as the edit opens when the sheet was opened for it, and ends when the edit goes.
  useEffect(() => {
    if (step === 'edit' && base !== null && tourWanted.current) { tourWanted.current = false; tourDo('replay'); }
    if ((step !== 'edit' || !open) && currentStep(tour) !== null) tourDo('skip');
  }, [step, base, open]);
  // The step that builds the keeper moves on when the keeper is built while it waits, not when it was built before.
  useEffect(() => {
    const built = progress?.done ?? false;
    if (built && !wasBuilt.current && isWaiting(tour)) tourDo('acted');
    wasBuilt.current = built;
  }, [progress?.done, tour]);

  /** Reads the folder's harness and its save points, and opens the edit with an empty draft. */
  function load(id: string): void {
    if (engine === null) return;
    const run = (): void => {
      void call.plan(W.label.planning, () => openCall(engine, id), v => { setBase(v.view.definition); setVersions(v.versions); setDraft(EMPTY_DRAFT); setShown(null); setApproved(null); setStep('edit'); });
    };
    setLastPlan(() => run);
    run();
  }
  function planSave(): void {
    if (engine === null || folder === undefined || base === null) return;
    const id = folder.id, edits = draftEdits(base, draft);
    const run = (): void => {
      setShown(null); setApproved(null);
      void call.plan(W.label.planning, () => engine.planSave(id, edits), v => { setShown({ kind: 'save', view: v, edits }); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  }
  function planRestore(version: string): void {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    const run = (): void => {
      setShown(null); setApproved(null);
      void call.plan(W.label.planning, () => engine.planRestore(id, version), v => { setShown({ kind: 'restore', view: v }); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  }
  const write = (): void => {
    if (engine === null || folder === undefined || shown === null || approved !== shown.view.revision) return;
    const id = folder.id, s = shown;
    const run = (): Promise<Answer<SaveWritten>> => (s.kind === 'save' ? engine.runSave(id, s.view.revision, s.edits) : engine.runRestore(id, s.view.revision, s.view.version.id));
    void call.write(W.label.writing, run, r => { setDone({ kind: s.kind, written: r }); setDraft(EMPTY_DRAFT); setStep('done'); });
  };

  /**
   * "Set old save points aside": plans it, then writes it after main's own dialog. The record is renamed in Bowerloom's private folder and nothing is deleted;
   * the save points are read again after it.
   */
  const setAsideParts = {
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
        if (r.ok) setVersions(await engine.listVersions(id));
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
    call.clear(); setShown(null); setApproved(null);
    if (to === 'folder') resetFolder();
    setStep(to);
  };
  /** A link drawn on the graph: from an agent to a skill, or to a notes card, as a draft. */
  const onLinkTarget = (partId: string): void => {
    const agent = linkingId === null ? null : agentPart(linkingId), skill = partSkill(partId), notes = partNotes(partId);
    setLinkingId(null);
    if (base === null || agent === null) return;
    if (skill !== null) setDraft(d => linkSkill(base, d, agent, skill, true));
    const card = notes === null ? undefined : cards.find(c => c.source.name === notes);
    if (card !== undefined) setDraft(d => attachNotes(base, d, agent, card.source, true));
  };
  /**
   * Adds the Notes keeper from the kit as a draft: main plans the harness with the kit added (reads only), and the draft keeps that answer to draw the keeper
   * and its skills. Nothing is written until Save. `then` runs after the answer, whether or not it came.
   */
  const addKeeper = (then?: () => void): void => {
    if (engine === null || folder === undefined || base === null || keeper !== null) { then?.(); return; }
    const id = folder.id, from = base;
    void call.plan(W.label.planning, () => engine.planSave(id, [{ kind: 'add-from-kit', kit: KEEPER_KIT }]), v => setDraft(d => addKit(from, d, v.definition))).then(() => then?.());
  };
  const notesParts: EditNotes = {
    cards, keeper, offered: offeredIds.map(id => now?.skills.find(s => s.id === id) ?? { id, name: id, description: '' }), fromKit: draft.kit !== null,
    way: notesWay, onWay: setNotesWay, onAddKeeper: () => addKeeper(),
    onLink: (skill, on) => { if (base !== null) setDraft(d => linkSkill(base, d, KEEPER_AGENT, skill, on)); },
    onLinkRest: () => { if (base !== null) setDraft(d => linkRest(base, d, KEEPER_AGENT, offeredIds)); },
    onAttach: (agent, card, on) => { if (base !== null) setDraft(d => attachNotes(base, d, agent, card.source, on)); },
    onHelp: () => tourDo('replay'),
  };
  /** Next on the tour: before the keeper step, the keeper is added from the kit, so the step lights it. */
  const tourNext = (): void => { if (nextStepId(tour) === 'keeper' && keeper === null) addKeeper(() => tourDo('next')); else tourDo('next'); };

  const steps = [W.label.stepFolder, W.label.stepEdit, W.label.stepReview, W.label.stepResult];
  const current = step === 'folder' ? 0 : step === 'edit' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={W.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" data-open-edit="" disabled={folder === undefined || busy} onClick={() => folder !== undefined && load(folder.id)}>{W.label.next}</HButton></>;
  else if (step === 'edit') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><SaveBar count={count}><HButton variant="primary" data-plan-save="" disabled={busy || count === 0} onClick={planSave}>{W.label.reviewSave}</HButton></SaveBar></>;
  else if (step === 'review') {
    const n = shown?.view.changes.length ?? 0, noop = shown?.view.noop ?? true;
    const words = shown === null ? W.label.saved : noop ? W.label.nothingToChange : shown.kind === 'restore' ? goBackWords(shown.view.version.id) : saveFilesWords(n);
    actions = <><HButton disabled={held} onClick={() => back('edit')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || shown === null || noop || approved !== shown.view.revision} onClick={write}>{words}</HButton></>;
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
  const nextWords = call.refusal === null ? null : SAVE_REFUSAL_WORDS[call.refusal.code];

  return (
    <Sheet open={open} title={W.label.saveTitle} onClose={() => { if (!held) onClose(); }} width={880} tall dataSlot="save" head={head}
      note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME[step]} aria-busy={busy}>
        {step === 'folder' ? (
          <FolderStep sheet="save" folders={folders} picked={picked} sample={engine?.mode === 'sample'} noBridge={engine === null} busy={busy} introRef={intro} onPick={pick} onChoose={choose}>
            {refusal}{nextWords === undefined || nextWords === null ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
          </FolderStep>
        ) : null}
        {step !== 'folder' ? (
          <>
            {busy ? <Busy words={call.busy!} /> : null}
            {refusal}
            {nextWords === undefined || nextWords === null ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
          </>
        ) : null}
        {step === 'edit' && base !== null && now !== null && world !== null ? (
          <EditStep base={base} now={now} draft={draft} count={count} held={held || busy} versions={versions} world={world} linkingId={linkingId} selectedId={selectedId}
            onDraft={setDraft} onLinkStart={id => setLinkingId(c => (c === id ? null : id))} onLinkTarget={onLinkTarget} onLinkCancel={() => setLinkingId(null)} onSelect={setSelectedId}
            onMove={(id, at) => setPositions(p => ({ ...p, [id]: at }))} onGoBack={planRestore} setAside={setAsideParts} notes={notesParts} />
        ) : null}
        {step === 'review' && shown !== null ? <SaveReview shown={shown} approved={approved === shown.view.revision} held={held} onApprove={on => setApproved(on ? shown.view.revision : null)} /> : null}
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

/** What the edit needs to draw notes and the keeper, and to change them. Left out (a markup test of the skills alone), the edit draws neither. */
export interface EditNotes {
  readonly cards: readonly NotesCard[];
  readonly keeper: DefinitionView['agents'][number] | null;
  readonly offered: DefinitionView['skills'];
  readonly fromKit: boolean;
  /** The notes step open in the Notes panel, by the way the person chose, or null. */
  readonly way: 'use' | 'start' | null;
  onWay(way: 'use' | 'start' | null): void;
  onAddKeeper(): void;
  onLink(skill: string, on: boolean): void;
  onLinkRest(): void;
  onAttach(agent: string, card: NotesCard, on: boolean): void;
  onHelp(): void;
}

export interface EditStepProps {
  base: DefinitionView; now: DefinitionView; draft: SaveDraft; count: number; held: boolean; versions: Answer<readonly VersionView[]> | null;
  world: NonNullable<ReturnType<typeof definitionWorld>>; linkingId: string | null; selectedId: string | null;
  onDraft(next: (d: SaveDraft) => SaveDraft): void; onLinkStart(id: string): void; onLinkTarget(id: string): void; onLinkCancel(): void; onSelect(id: string | null): void;
  onMove(id: string, at: Point): void; onGoBack(version: string): void;
  setAside?: SetAsideParts;
  notes?: EditNotes;
}

/** The draft of one folder's harness: the graph, the skills of each agent, the skills, the interfaces, and the save points. */
export function EditStep({ base, now, draft, count, held, versions, world, linkingId, selectedId, onDraft, onLinkStart, onLinkTarget, onLinkCancel, onSelect, onMove, onGoBack, setAside, notes }: EditStepProps): ReactElement {
  const engines = ENGINE_IDS.filter(e => base.engines.includes(e) || !isPreviewEngine(e));
  const sum = <p className="hxi-sum" data-draft={count}><StateDot tone={count === 0 ? 'quiet' : 'warn'}>{draftWords(count)}</StateDot> <span className="hxe-muted">{W.hint.draftNote}</span></p>;
  return (
    <>
      {notes === undefined ? sum : (
        <div className="hxn-top">
          {sum}
          <span data-tour="help"><HButton icon="help" size="small" data-help="" aria-label={NOTES.label.replay} disabled={held} onClick={notes.onHelp}>{NOTES.label.help}</HButton></span>
        </div>
      )}
      <Section title={W.label.agentsAndSkills} slot="graph">
        <p className="hxe-text hxe-muted">{now.agents.length === 0 ? W.hint.noAgentsHere : W.hint.linkHint}</p>
        <div className="hxs-graph" data-tour="map">
          <Graph state={world.state} harness={world.harness} selectedId={selectedId} linkingId={linkingId} matchIds={null} onSelect={onSelect} onMove={onMove}
            onLinkStart={onLinkStart} onLinkTarget={onLinkTarget} onLinkCancel={onLinkCancel} onFix={() => undefined} />
        </div>
      </Section>
      {notes === undefined || notes.keeper === null ? null : (
        <KeeperBuild keeper={notes.keeper} offered={notes.offered} cards={notes.cards} held={held} fromKit={notes.fromKit}
          onLink={notes.onLink} onLinkRest={notes.onLinkRest} onAttach={(card, on) => notes.onAttach(KEEPER_AGENT, card, on)} />
      )}
      {notes === undefined ? null : (
        <NotesPanel cards={notes.cards} held={held} hasKeeper={notes.keeper !== null} onUse={() => notes.onWay('use')} onFresh={() => notes.onWay('start')} onAddKeeper={notes.onAddKeeper}
          step={notes.way === null ? undefined : <NotesStep key={notes.way} start={notes.way} onDone={() => notes.onWay(null)} />} />
      )}
      {now.agents.length === 0 ? null : (
        <Section title={W.label.agentSkills} count={String(now.agents.length)} slot="agent-skills">
          {now.agents.map(a => (
            <fieldset key={a.id} className="hxs-agent" data-agent={a.id}>
              <legend className="hxs-agent-name">{a.name}</legend>
              {now.skills.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.nothingFound}</p> : (
                <ul className="hxs-ticks">
                  {now.skills.map(s => (
                    <li key={s.id}>
                      <label className="hxs-tick" data-skill={s.id}>
                        <input type="checkbox" className="hxi-check" disabled={held} checked={a.skills.includes(s.id)} aria-label={`${s.name}: ${a.name}`}
                          onChange={e => { const on = e.currentTarget.checked; onDraft(d => linkSkill(base, d, a.id, s.id, on)); }} />
                        <span>{s.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          ))}
        </Section>
      )}
      {notes === undefined || notes.cards.length === 0 || now.agents.length === 0 ? null : (
        <Section title={NOTES.label.notesEachAgent} count={String(now.agents.length)} slot="agent-notes">
          {now.agents.map(a => (
            <fieldset key={a.id} className="hxs-agent" data-agent-notes={a.id}>
              <legend className="hxs-agent-name">{a.name}</legend>
              <ul className="hxs-ticks">
                {notes.cards.map(c => (
                  <li key={c.key}>
                    <label className="hxs-tick" data-notes={c.key}>
                      <input type="checkbox" className="hxi-check" disabled={held} checked={a.notes.includes(c.source.name)} aria-label={`${c.name}: ${a.name}`}
                        onChange={e => notes.onAttach(a.id, c, e.currentTarget.checked)} />
                      <span>{c.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </Section>
      )}
      <Section title={W.label.skillsHere} count={String(draftStart(base, draft).skills.length)} slot="skills">
        <ul className="hxi-files">
          {draftStart(base, draft).skills.map(s => {
            const gone = draft.removed.includes(s.id);
            return (
              <li key={s.id} className="hxi-file" data-skill-row={s.id} data-removed={gone ? '' : undefined}>
                <span className="hxi-file-path">{s.name}</span>
                {gone ? <StateDot tone="warn">{W.hint.removedMark}</StateDot> : <span className="hxe-muted hxs-desc" title={s.description}>{s.description}</span>}
                <HButton size="small" disabled={held} aria-label={`${gone ? W.label.keepSkill : W.label.removeSkill}: ${s.name}`} onClick={() => onDraft(d => removeSkill(base, d, s.id, !gone))}>{gone ? W.label.keepSkill : W.label.removeSkill}</HButton>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={W.label.interfacesHere} slot="engines">
        <ul className="hxs-ticks">
          {engines.map(e => (
            <li key={e}>
              <label className="hxs-tick" data-engine={e}>
                <input type="checkbox" className="hxi-check" disabled={held} checked={now.engines.includes(e)}
                  onChange={ev => { const on = ev.currentTarget.checked; onDraft(d => setDraftEngines(base, d, on ? [...now.engines, e] : now.engines.filter(x => x !== e))); }} />
                <span>{ENGINE_NAMES[e]}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
      <SavePoints versions={versions} held={held} onGoBack={onGoBack} {...(setAside === undefined ? {} : { setAside })} />
    </>
  );
}

/** "Set old save points aside": the plan shown (or null), the dated name of the last one done (or null), and the two calls. */
export interface SetAsideParts { readonly view: SetAsideView | null; readonly done: string | null; plan(): void; run(): void }
/**
 * The refusals of a save point record that set-aside can clear: an index that is not whole, and one the state layer will not read (open to others, a second
 * link, or past its bound). The set-aside plan in main checks again and renames the record without opening it.
 */
const SET_ASIDE_CODES: ReadonlySet<string> = new Set(['VERSION_CORRUPT', 'PORTABLE_STATE_UNSAFE']);

/**
 * The save points, newest first, each with "Go back". A damaged record shows its refusal; it is never drawn as "no save point yet", and it offers to set the
 * old save points aside, planned first and written after main's own dialog, so a person is never locked out.
 */
export function SavePoints({ versions, held, onGoBack, setAside }: { versions: Answer<readonly VersionView[]> | null; held: boolean; onGoBack(version: string): void; setAside?: SetAsideParts }): ReactElement {
  const refusal: Refusal | null = versions !== null && !versions.ok ? versions.refusal : null;
  const list = versions !== null && versions.ok ? versions.value : [];
  return (
    <Section title={W.label.savePoints} {...(versions !== null && versions.ok ? { count: String(list.length) } : {})} slot="save-points">
      {refusal !== null ? <RefusalNote refusal={refusal}>{null}</RefusalNote> : null}
      {refusal !== null && SAVE_REFUSAL_WORDS[refusal.code] !== undefined ? <p className="hxe-text" data-next-step="">{SAVE_REFUSAL_WORDS[refusal.code]}</p> : null}
      {setAside !== undefined && refusal !== null && SET_ASIDE_CODES.has(refusal.code) && setAside.view === null ?<HButton size="small" disabled={held} data-set-aside="" onClick={setAside.plan}>{W.label.planSetAside}</HButton> : null}
      {setAside !== undefined && setAside.view !== null ? (
        <div data-set-aside-plan={setAside.view.revision.slice(0, 8)}>
          <p className="hxe-text">{W.hint.setAsideNote}</p>
          <HButton size="small" variant="primary" disabled={held} data-run-set-aside="" onClick={setAside.run}>{W.label.setAside}</HButton>
        </div>
      ) : null}
      {setAside?.done != null ? <p className="hxe-text" data-set-aside-done={setAside.done}><StateDot tone="good">{W.hint.setAsideDone}</StateDot> {setAside.done}</p> : null}
      {versions !== null && versions.ok && list.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.noSavePoints}</p> : null}
      {list.length === 0 ? null : (
        <ul className="hxi-files" aria-label={W.label.savePoints}>
          {list.map(v => (
            <li key={v.id} className="hxi-file hxs-point" data-version={v.id} data-current={v.current ? '' : undefined}>
              <span className="hxs-point-text">
                <span className="hxi-file-path">{v.id} · {v.label}</span>
                <span className="hxe-muted">{savePointLine(v.created, v.files)}</span>
              </span>
              {v.current ? <StateDot tone="good">{W.label.nowMark}</StateDot> : <HButton size="small" disabled={held} aria-label={goBackWords(v.id)} data-go-back={v.id} onClick={() => onGoBack(v.id)}>{W.label.goBack}</HButton>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The plan of a save or a go-back: each file of `.bowerloom` it changes, the harness as it will be, and the one tick that approves its revision. */
export function SaveReview({ shown, approved, held, onApprove }: { shown: Shown; approved: boolean; held: boolean; onApprove(on: boolean): void }): ReactElement {
  const v = shown.view;
  return (
    <div data-save-review={shown.kind}>
      <p className="hxi-sum">{shown.kind === 'restore' ? W.paragraph.goBackIntro : W.paragraph.saveIntro}</p>
      {shown.kind === 'restore' ? <p className="hxe-text" data-going-back={shown.view.version.id}>{shown.view.version.id} · {shown.view.version.label} · {savePointLine(shown.view.version.created, shown.view.version.files)}</p> : null}
      <Section title={W.label.changes} count={String(v.changes.length)} slot="save-changes">
        {v.noop ? <p className="hxe-text hxe-muted">{W.hint.sameAsNow}</p> : (
          <ul className="hxi-files">
            {v.changes.map(c => <li key={c.path} className="hxi-file" data-file={c.path} data-action={c.action}><span className="hxi-file-path">{c.path}</span><StateDot tone={CHANGE_TONE[c.action]}>{CHANGE_WORDS[c.action]}</StateDot></li>)}
          </ul>
        )}
      </Section>
      <Section title={W.label.agentSkills} count={String(v.definition.agents.length)} slot="save-agents">
        {v.definition.agents.length === 0 ? <p className="hxe-text hxe-muted">{W.label.noAgents}</p> : (
          <ul className="hxe-places">{v.definition.agents.map(a => <li key={a.id} data-agent-after={a.id}><span className="hxe-mono">{a.name}</span> <span className="hxe-muted">{a.skills.length === 0 ? W.label.noSkills : a.skills.join(', ')}</span>{a.notes.length === 0 ? null : <span className="hxe-muted" data-agent-notes-after={a.id}> · {NOTES.label.notes}: {a.notes.join(', ')}</span>}</li>)}</ul>
        )}
        <p className="hxe-text hxe-muted">{W.label.interfacesHere}: {v.definition.engines.map((e: EngineId) => ENGINE_NAMES[e]).join(', ')}</p>
      </Section>
      {v.noop ? null : (
        <ul className="hxe-ticks hxe-approve" data-approve-plan="">
          <TickRow slot="revision" checked={approved} disabled={held} label={approvePlanWords(short(v.revision))} name={shown.kind === 'restore' ? W.label.goBackTitle : W.label.saveTitle} onChange={onApprove} />
        </ul>
      )}
    </div>
  );
}
