/**
 * "Install a folder's harness": the projection of the folder's own `.bowerloom` harness into each interface's files, and its removal and recovery.
 * Install: 1. the folder, 2. the interfaces (tick boxes), 3. the review, 4. Done. The review first lists any enforced rule that an interface carries weaker,
 * each to be ticked; then the plan, which ends with one tick box that approves its revision.
 * - A new folder, or new interfaces, start clean: no answer, ticks, approval, removal, recovery or refusal of the last ones (U2).
 * - A change of a choice (the drift report, the CLAUDE.md offer) plans again: the old plan and its approval leave the screen while it runs, and a refusal
 *   shows alone, takes the focus and offers "Plan again" (U4, U9, U10).
 * - A line key names its entry's hash, so a changed entry comes back unticked (U15).
 * - A write runs in its own lane, every choice held (U1); main asks the person once more in its own dialog; Done lists each file written, removed, put back
 *   or left behind, and says so when nothing changed (U5).
 * Remove and recover: 1. the folder, 2. the plan, approved the same way, 3. Done.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { projectCanWrite, untickedLines } from '../../../shared/engine/gates.js';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { EngineId, FolderInfo, ProjectAnswer, ProjectInput, ProjectView, Reconcile, RecoveryView, RemovalView } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import type { EngineSheetMode } from '../ui.js';
import { ENGINE_WORDS, removeFilesWords, writeFilesWords } from '../words-engine.js';
import { Busy, FolderStep, RefusalNote, ResultStep, folderLine } from './engine-parts.js';
import { ApproveLines, DriftReport, PlanReview, RecoveryReview, RemovalReview } from './project-review.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';

const W = ENGINE_WORDS;
type Step = 'folder' | 'interfaces' | 'review' | 'done';
type Done =
  | { kind: 'install'; written: readonly string[]; leftBehind: readonly string[]; noop: boolean }
  | { kind: 'remove'; deleted: readonly string[]; restored: readonly string[]; leftBehind: readonly string[] }
  | { kind: 'recover'; undone: readonly string[]; kept: readonly string[]; leftBehind: readonly string[] };
const BODY_NAME: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, interfaces: W.label.bodyInterfaces, review: W.label.bodyReview, done: W.label.bodyResult };

export interface ProjectSheetProps { open: boolean; folderId: string | null; mode: EngineSheetMode; keep: readonly string[]; onClose(): void }

export function ProjectSheet({ open, folderId, mode: openedMode, keep: openedKeep, onClose }: ProjectSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<EngineSheetMode>(openedMode);
  const [keep, setKeep] = useState<readonly string[]>(openedKeep);
  const [step, setStep] = useState<Step>('folder');
  const [engines, setEngines] = useState<readonly EngineId[]>([]);
  const [reconcile, setReconcile] = useState<Reconcile>('accept-agents');
  const [writeClaudeMd, setWriteClaudeMd] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [sent, setSent] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState<ProjectAnswer | null>(null);
  /** The plan whose drift report is on screen. It stays while a new plan is made, so the radio keeps the focus; a refusal shows alone. */
  const [driftOf, setDriftOf] = useState<ProjectView | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalView | null>(null);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing;

  /** Everything that belongs to one folder and one set of interfaces goes when they change (U2). */
  const resetPlans = (): void => { setAnswer(null); setDriftOf(null); setApproved(null); setRemoval(null); setRecovery(null); setTicked([]); setSent([]); setDone(null); setLastPlan(null); call.clear(); };
  useEffect(() => {
    if (!open) return;
    setStep('folder'); setMode(openedMode); setKeep(openedKeep); setReconcile('accept-agents'); setWriteClaudeMd(false); setFolders([]); setPicked(null); resetPlans();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'install').off);
      const id = folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null;
      setPicked(id);
      setEngines(list.find(f => f.id === id)?.engines ?? []);
      // Opened for one folder's removal or recovery (from Done, or from "Keep my versions"): the plan shows at once.
      if (id !== null && folderId === id && openedMode !== 'install') { setStep('review'); planOther(id, openedMode, openedKeep); }
    });
  }, [open, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(call.busy !== null, body);

  const folder = folders.find(f => f.id === picked);
  const input = (approve: readonly string[], r = reconcile, claude = writeClaudeMd): ProjectInput => ({ engines, reconcile: r, writeClaudeMd: claude, approve });

  function planInstall(next: ProjectInput): void {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    const run = (): void => {
      // The old plan and its approval leave the screen while the new one is made (U4).
      setAnswer(null); setApproved(null);
      void call.plan(W.label.planning, () => engine.planProjection(id, next), a => {
        setAnswer(a); setSent(next.approve); setDriftOf(a.kind === 'plan' ? a.plan : null);
        // Only the ticks of lines in the new answer stay; a changed entry has a new key and comes back unticked (U15).
        if (a.kind === 'approve') setTicked(t => [...new Set([...t, ...a.approvedSoFar])].filter(k => a.lines.some(l => l.key === k)));
      });
    };
    setLastPlan(() => run);
    run();
  }
  function planOther(id: string, m: EngineSheetMode, k: readonly string[]): void {
    if (engine === null) return;
    const run = (): void => {
      setRemoval(null); setRecovery(null); setApproved(null);
      if (m === 'remove') void call.plan(W.label.planning, () => engine.planRemoval(id), v => setRemoval(v));
      else void call.plan(W.label.planning, () => engine.planRecovery(id, k), v => setRecovery(v));
    };
    setLastPlan(() => run);
    run();
  }
  const switchTo = (m: EngineSheetMode, k: readonly string[] = []): void => {
    if (folder === undefined || held) return;
    resetPlans(); setMode(m); setKeep(k); setStep('review'); planOther(folder.id, m, k);
  };
  /** The choices of one folder: its drift action and its CLAUDE.md offer go with it (W3). */
  const resetChoices = (): void => { setReconcile('accept-agents'); setWriteClaudeMd(false); };
  const pick = (id: string): void => { if (held || id === picked) return; setPicked(id); setEngines(folders.find(f => f.id === id)?.engines ?? []); resetChoices(); resetPlans(); };
  const choose = (): void => {
    if (engine === null || held) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!folderLine(got.info, 'install').off) { setPicked(got.info.id); setEngines(got.info.engines); resetChoices(); resetPlans(); }
    });
  };
  const next = (): void => {
    if (folder === undefined || held) return;
    if (step === 'folder') { resetPlans(); setMode('install'); setStep('interfaces'); return; }
    // New interfaces start a new plan: no old answer, ticks or approvals are sent (U2, M8).
    resetPlans(); setStep('review'); planInstall(input([]));
  };
  const back = (to: Step): void => { if (held) return; call.clear(); if (to !== 'review') { setAnswer(null); setApproved(null); } setStep(to); };
  const toggleEngine = (id: EngineId): void => { if (!held) setEngines(list => (list.includes(id) ? list.filter(e => e !== id) : (folder?.engines ?? []).filter(e => e === id || list.includes(e)))); };
  const changeReconcile = (r: Reconcile): void => { if (held) return; setReconcile(r); planInstall(input(sent, r)); };
  const changeClaude = (on: boolean): void => { if (held) return; setWriteClaudeMd(on); planInstall(input(sent, reconcile, on)); };

  const write = (): void => {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    if (mode === 'install') {
      const plan = answer?.kind === 'plan' ? answer.plan : null;
      if (plan === null || !projectCanWrite(plan, approved)) return;
      void call.write(W.label.writing, () => engine.runProjection(id, plan.revision, input(sent)), r => { setDone({ kind: 'install', ...r }); setStep('done'); });
    } else if (mode === 'remove' && removal !== null && approved === removal.revision) {
      void call.write(W.label.writing, () => engine.runRemoval(id, removal.revision), r => { setDone({ kind: 'remove', ...r }); setStep('done'); });
    } else if (mode === 'recover' && recovery !== null && approved === recovery.revision) {
      const undone = recovery.steps.filter(x => x.decision === 'undo').map(x => x.path), kept = recovery.keep;
      void call.write(W.label.writing, () => engine.runRecovery(id, recovery.revision, keep), r => { setDone({ kind: 'recover', undone, kept, leftBehind: r.leftBehind }); setStep('done'); });
    }
  };

  const steps = mode === 'install' ? [W.label.stepFolder, W.label.stepInterfaces, W.label.stepReview, W.label.stepResult] : [W.label.stepFolder, W.label.stepReview, W.label.stepResult];
  const current = step === 'folder' ? 0 : step === 'interfaces' ? 1 : step === 'done' ? steps.length - 1 : steps.length - 2;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={W.label.steps} doneWord="done" /></div>;
  const busy = call.busy !== null;
  const plan = answer?.kind === 'plan' ? answer.plan : null;
  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" disabled={folder === undefined || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (step === 'interfaces') actions = <><HButton onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" disabled={engines.length === 0 || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (step === 'done') {
    actions = <>{done?.kind === 'install' && !done.noop ? <HButton onClick={() => switchTo('remove')}>{W.label.undo}</HButton> : null}<HButton variant="primary" onClick={onClose}>{W.label.close}</HButton></>;
  } else if (mode === 'install' && answer?.kind === 'approve') {
    const blocked = answer.lines.some(l => !l.approvable) || untickedLines({ ...answer, lines: answer.lines.filter(l => l.approvable) }, ticked).length > 0;
    actions = <><HButton disabled={held} onClick={() => back('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-plan-again="" disabled={busy || blocked} onClick={() => planInstall(input(answer.lines.map(l => l.key).filter(k => ticked.includes(k))))}>{W.label.planWithApprovals}</HButton></>;
  } else if (mode === 'install') {
    actions = <><HButton disabled={held} onClick={() => back('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !projectCanWrite(plan, approved)} onClick={write}>{plan === null ? W.label.writeFiles : plan.noop ? W.label.nothingToChange : writeFilesWords(plan.changes.filter(c => c.action !== 'unchanged').length)}</HButton></>;
  } else {
    const rev = mode === 'remove' ? removal?.revision : recovery?.revision;
    const empty = mode === 'remove' && removal !== null && removal.changes.length === 0;
    actions = <><HButton disabled={held} onClick={() => { back('folder'); setMode('install'); }}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || rev === undefined || approved !== rev || empty} onClick={write}>{mode === 'remove' ? (empty ? W.label.nothingToChange : removeFilesWords(removal?.changes.length ?? 0)) : W.label.finish}</HButton></>;
  }

  const refusal = call.refusal === null ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {lastPlan !== null && step === 'review' ? <HButton onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
      {folder !== undefined && call.refusal.code === 'PORTABLE_RECOVERY_REQUIRED' ? <HButton onClick={() => switchTo('recover')}>{W.label.planRecovery}</HButton> : null}
      {folder !== undefined && call.refusal.drift !== undefined && call.refusal.drift.length > 0 ? <HButton onClick={() => switchTo('recover', call.refusal!.drift!.map(d => d.path))}>{W.label.keepMine}</HButton> : null}
      {call.refusal.code === 'PORTABLE_MERGE_NOT_BUILT' ? <HButton onClick={() => changeReconcile('accept-agents')}>{W.label.acceptAgents}</HButton> : null}
    </RefusalNote>
  );
  const folderExtra = folder === undefined ? null : (
    <div className="hxe-actions">
      {folder.projected ? <HButton icon="minus-circle" disabled={busy} onClick={() => switchTo('remove')}>{W.label.planRemoval}</HButton> : null}
      {folder.unfinished.projection ? <HButton icon="clock" disabled={busy} onClick={() => switchTo('recover')}>{W.label.planRecovery}</HButton> : null}
    </div>
  );
  const title = mode === 'remove' ? W.label.removeTitle : mode === 'recover' ? W.label.recoverTitle : W.label.installTitle;

  return (
    <Sheet open={open} title={title} onClose={() => { if (!held) onClose(); }} width={880} tall dataSlot="project" head={head} note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME[step]} aria-busy={busy}>
        {step === 'folder' ? (
          <FolderStep sheet="install" folders={folders} picked={picked} sample={engine?.mode === 'sample'} noBridge={engine === null} busy={busy} introRef={intro} onPick={pick} onChoose={choose} extra={folderExtra}>{refusal}</FolderStep>
        ) : null}
        {step === 'interfaces' && folder !== undefined ? (
          <>
            <p className="hxi-intro">{folder.engines.length === 0 ? W.hint.noEngines : W.hint.pickInterface}</p>
            <ul className="hxi-list" aria-label={W.label.engineChoices}>
              {folder.engines.map(id => (
                <li key={id}>
                  <label className="hxi-card" data-on={engines.includes(id) ? '' : undefined} data-engine={id}>
                    <input type="checkbox" className="hxi-check" checked={engines.includes(id)} onChange={() => toggleEngine(id)} />
                    <Tile name="monitor" />
                    <span className="hxi-card-text"><span className="hxi-card-name">{ENGINE_NAMES[id]}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {step === 'review' || step === 'done' ? (
          <>
            {busy ? <Busy words={call.busy!} /> : null}
            {step === 'review' ? refusal : null}
            {step === 'review' && mode === 'install' && answer?.kind === 'approve' ? <ApproveLines lines={answer.lines} ticked={ticked} held={held} onTick={(key, on) => setTicked(t => (on ? [...new Set([...t, key])] : t.filter(x => x !== key)))} /> : null}
            {step === 'review' && mode === 'install' && driftOf !== null && (plan !== null || busy) ? <DriftReport plan={driftOf} reconcile={reconcile} held={held || busy} onReconcile={changeReconcile} /> : null}
            {step === 'review' && mode === 'install' && plan !== null ? (
              <PlanReview plan={plan} writeClaudeMd={writeClaudeMd} approvedRevision={approved} held={held} onWriteClaude={changeClaude} onApprove={setApproved} />
            ) : null}
            {step === 'review' && mode === 'remove' && removal !== null && folder !== undefined ? <RemovalReview plan={removal} folder={folder.label} approved={approved === removal.revision} held={held} onApprove={on => setApproved(on ? removal.revision : null)} /> : null}
            {step === 'review' && mode === 'recover' && recovery !== null && folder !== undefined ? <RecoveryReview plan={recovery} folder={folder.label} approved={approved === recovery.revision} held={held} onApprove={on => setApproved(on ? recovery.revision : null)} /> : null}
            {step === 'done' && done !== null ? <DoneStep done={done} /> : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

function DoneStep({ done }: { done: Done }): ReactElement {
  if (done.kind === 'install') return <ResultStep nothing={done.noop || done.written.length === 0} lists={[{ title: W.label.writtenFiles, files: done.written }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy }]} />;
  if (done.kind === 'remove') return <ResultStep nothing={done.deleted.length + done.restored.length === 0} lists={[{ title: W.label.removedFiles, files: done.deleted }, { title: W.label.restoredFiles, files: done.restored }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy }]} />;
  return <ResultStep nothing={done.undone.length + done.kept.length === 0} lists={[{ title: W.label.undoneFiles, files: done.undone }, { title: W.label.keptFiles, files: done.kept }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy }]} />;
}
