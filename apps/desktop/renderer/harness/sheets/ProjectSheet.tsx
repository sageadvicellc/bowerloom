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
 * Merge (decision D4A) is a choice of the drift report with its own plan: the definition edit, approved by its revision and main's own dialog. Then the
 * install plan comes back with Accept AGENTS.md, which the person approves as always. A mode drift line offers Restore mode and Keep new mode (D5A), each
 * a recovery plan.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { projectCanWrite, untickedLines } from '../../../shared/engine/gates.js';
import { isPreviewEngine } from '../../../shared/engine/engines.js';
import { ENGINE_NAMES, writesFile } from '../../../shared/engine/types.js';
import type { EngineId, FolderInfo, MergeView, ModeChoice, ProjectAnswer, ProjectInput, ProjectView, Reconcile, RecoveryChoices, RecoveryView, RemovalView } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import type { EngineSheetMode } from '../ui.js';
import { ENGINE_WORDS, removeFilesWords, writeFilesWords } from '../words-engine.js';
import { Busy, FolderStep, RefusalNote, ResultStep, folderLine } from './engine-parts.js';
import { ApproveLines, DriftReport, MergeReview, PlanReview, RecoveryReview, RemovalReview } from './project-review.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';

const W = ENGINE_WORDS;
type Step = 'folder' | 'interfaces' | 'review' | 'done';
type Done =
  | { kind: 'install'; written: readonly string[]; leftBehind: readonly string[]; noop: boolean; warnings?: readonly string[] }
  | { kind: 'remove'; deleted: readonly string[]; restored: readonly string[]; leftBehind: readonly string[]; warnings?: readonly string[] }
  | { kind: 'recover'; undone: readonly string[]; kept: readonly string[]; restoredModes: readonly string[]; recordedModes: readonly string[]; leftBehind: readonly string[] };
const NO_CHOICES: RecoveryChoices = { keep: [], restoreMode: [], recordMode: [] };
const keepOnly = (keep: readonly string[]): RecoveryChoices => ({ ...NO_CHOICES, keep: [...keep] });
const BODY_NAME: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, interfaces: W.label.bodyInterfaces, review: W.label.bodyReview, done: W.label.bodyResult };

/** The interfaces a folder's install starts with: the ones its harness lists, without the preview ones unless the app may install to them. */
const installable = (f: FolderInfo | undefined): readonly EngineId[] => (f === undefined ? [] : f.engines.filter(e => f.previewEngines || !isPreviewEngine(e)));

export interface ProjectSheetProps { open: boolean; folderId: string | null; mode: EngineSheetMode; keep: readonly string[]; onClose(): void }

export function ProjectSheet({ open, folderId, mode: openedMode, keep: openedKeep, onClose }: ProjectSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<EngineSheetMode>(openedMode);
  const [choices, setChoices] = useState<RecoveryChoices>(keepOnly(openedKeep));
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
  /** The Merge plan on screen, while Merge is the choice of the drift report; and whether a Merge was written in this sheet. */
  const [merge, setMerge] = useState<MergeView | null>(null);
  const [merged, setMerged] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing;

  /** Everything that belongs to one folder and one set of interfaces goes when they change (U2). */
  const resetPlans = (): void => { setAnswer(null); setDriftOf(null); setApproved(null); setRemoval(null); setRecovery(null); setMerge(null); setMerged(false); setTicked([]); setSent([]); setDone(null); setLastPlan(null); call.clear(); };
  useEffect(() => {
    if (!open) return;
    setStep('folder'); setMode(openedMode); setChoices(keepOnly(openedKeep)); setReconcile('accept-agents'); setWriteClaudeMd(false); setFolders([]); setPicked(null); resetPlans();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'install').off);
      const id = folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null;
      setPicked(id);
      setEngines(installable(list.find(f => f.id === id)));
      // Opened for one folder's removal or recovery (from Done, or from "Keep my versions"): the plan shows at once.
      if (id !== null && folderId === id && openedMode !== 'install') { setStep('review'); planOther(id, openedMode, keepOnly(openedKeep)); }
    });
  }, [open, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(call.busy !== null, body);

  const folder = folders.find(f => f.id === picked);
  // Merge is never sent to the install plan: it is its own plan, and the install after it accepts AGENTS.md (D4A).
  const input = (approve: readonly string[], r = reconcile, claude = writeClaudeMd): ProjectInput => ({ engines, reconcile: r === 'merge' ? 'accept-agents' : r, writeClaudeMd: claude, approve });

  function planInstall(next: ProjectInput): void {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    const run = (): void => {
      // The old plan and its approval leave the screen while the new one is made (U4).
      setAnswer(null); setApproved(null); setMerge(null);
      void call.plan(W.label.planning, () => engine.planProjection(id, next), a => {
        setAnswer(a); setSent(next.approve); setDriftOf(a.kind === 'plan' ? a.plan : null);
        // Only the ticks of lines in the new answer stay; a changed entry has a new key and comes back unticked (U15).
        if (a.kind === 'approve') setTicked(t => [...new Set([...t, ...a.approvedSoFar])].filter(k => a.lines.some(l => l.key === k)));
      });
    };
    setLastPlan(() => run);
    run();
  }
  /** The Merge plan. The install plan and its approval leave the screen; the drift report stays, with Merge picked. */
  function planMerge(): void {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    const run = (): void => {
      setAnswer(null); setApproved(null); setMerge(null);
      void call.plan(W.label.planning, () => engine.planMerge(id), v => setMerge(v));
    };
    setLastPlan(() => run);
    run();
  }
  function planOther(id: string, m: EngineSheetMode, c: RecoveryChoices): void {
    if (engine === null) return;
    const run = (): void => {
      setRemoval(null); setRecovery(null); setApproved(null);
      if (m === 'remove') void call.plan(W.label.planning, () => engine.planRemoval(id), v => setRemoval(v));
      else void call.plan(W.label.planning, () => engine.planRecovery(id, c), v => setRecovery(v));
    };
    setLastPlan(() => run);
    run();
  }
  const switchTo = (m: EngineSheetMode, c: RecoveryChoices = NO_CHOICES): void => {
    if (folder === undefined || held) return;
    resetPlans(); setMode(m); setChoices(c); setStep('review'); planOther(folder.id, m, c);
  };
  /** One action of a mode drift line: a recovery plan for that path alone (D5A). */
  const settleMode = (path: string, choice: ModeChoice): void => switchTo('recover', { ...NO_CHOICES, [choice]: [path] });
  /** The choices of one folder: its drift action and its CLAUDE.md offer go with it (W3). */
  const resetChoices = (): void => { setReconcile('accept-agents'); setWriteClaudeMd(false); };
  const pick = (id: string): void => { if (held || id === picked) return; setPicked(id); setEngines(installable(folders.find(f => f.id === id))); resetChoices(); resetPlans(); };
  const choose = (): void => {
    if (engine === null || held) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!folderLine(got.info, 'install').off) { setPicked(got.info.id); setEngines(installable(got.info)); resetChoices(); resetPlans(); }
    });
  };
  const next = (): void => {
    if (folder === undefined || held) return;
    if (step === 'folder') { resetPlans(); setMode('install'); setStep('interfaces'); return; }
    // New interfaces start a new plan: no old answer, ticks or approvals are sent (U2, M8).
    resetPlans(); setStep('review'); planInstall(input([]));
  };
  const back = (to: Step): void => {
    if (held) return;
    call.clear();
    if (to !== 'review') { setAnswer(null); setApproved(null); setMerge(null); if (reconcile === 'merge') setReconcile('accept-agents'); }
    setStep(to);
  };
  const toggleEngine = (id: EngineId): void => { if (!held && installable(folder).includes(id)) setEngines(list => (list.includes(id) ? list.filter(e => e !== id) : (folder?.engines ?? []).filter(e => e === id || list.includes(e)))); };
  const changeReconcile = (r: Reconcile): void => { if (held) return; setReconcile(r); if (r === 'merge') planMerge(); else planInstall(input(sent, r)); };
  const changeClaude = (on: boolean): void => { if (held) return; setWriteClaudeMd(on); planInstall(input(sent, reconcile, on)); };

  const write = (): void => {
    if (engine === null || folder === undefined) return;
    const id = folder.id;
    if (mode === 'install' && reconcile === 'merge') {
      if (merge === null || approved !== merge.revision) return;
      // After the definition edit, the install plans again with Accept AGENTS.md and the approvals already sent; it waits for its own approval.
      void call.write(W.label.writing, () => engine.runMerge(id, merge.revision), () => { setMerged(true); setReconcile('accept-agents'); planInstall(input(sent, 'accept-agents')); });
    } else if (mode === 'install') {
      const plan = answer?.kind === 'plan' ? answer.plan : null;
      if (plan === null || !projectCanWrite(plan, approved)) return;
      void call.write(W.label.writing, () => engine.runProjection(id, plan.revision, input(sent)), r => { setDone({ kind: 'install', ...r }); setStep('done'); });
    } else if (mode === 'remove' && removal !== null && approved === removal.revision) {
      void call.write(W.label.writing, () => engine.runRemoval(id, removal.revision), r => { setDone({ kind: 'remove', ...r }); setStep('done'); });
    } else if (mode === 'recover' && recovery !== null && approved === recovery.revision) {
      const undone = recovery.steps.filter(x => x.decision === 'undo').map(x => x.path), kept = recovery.keep;
      const restoredModes = recovery.modes.filter(m => m.choice === 'restoreMode').map(m => m.path), recordedModes = recovery.modes.filter(m => m.choice === 'recordMode').map(m => m.path);
      void call.write(W.label.writing, () => engine.runRecovery(id, recovery.revision, choices), r => { setDone({ kind: 'recover', undone, kept, restoredModes, recordedModes, leftBehind: r.leftBehind }); setStep('done'); });
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
  } else if (mode === 'install' && reconcile === 'merge') {
    actions = <><HButton disabled={held} onClick={() => back('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || merge === null || approved !== merge.revision} onClick={write}>{W.label.mergeIt}</HButton></>;
  } else if (mode === 'install') {
    actions = <><HButton disabled={held} onClick={() => back('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !projectCanWrite(plan, approved)} onClick={write}>{plan === null ? W.label.writeFiles : plan.noop ? W.label.nothingToChange : writeFilesWords(plan.changes.filter(writesFile).length)}</HButton></>;
  } else {
    const rev = mode === 'remove' ? removal?.revision : recovery?.revision;
    const empty = mode === 'remove' && removal !== null && removal.changes.length === 0;
    actions = <><HButton disabled={held} onClick={() => { back('folder'); setMode('install'); }}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || rev === undefined || approved !== rev || empty} onClick={write}>{mode === 'remove' ? (empty ? W.label.nothingToChange : removeFilesWords(removal?.changes.length ?? 0)) : W.label.finish}</HButton></>;
  }

  const refusal = call.refusal === null ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId} onMode={folder === undefined ? undefined : settleMode}>
      {lastPlan !== null && step === 'review' ? <HButton onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
      {folder !== undefined && call.refusal.code === 'PORTABLE_RECOVERY_REQUIRED' ? <HButton onClick={() => switchTo('recover')}>{W.label.planRecovery}</HButton> : null}
      {folder !== undefined && call.refusal.drift !== undefined && call.refusal.drift.length > 0 ? <HButton onClick={() => switchTo('recover', keepOnly(call.refusal!.drift!.map(d => d.path)))}>{W.label.keepMine}</HButton> : null}
      {step === 'review' && mode === 'install' && (reconcile === 'merge' || call.refusal.code === 'PORTABLE_MERGE_NOT_BUILT') ? <HButton onClick={() => changeReconcile('accept-agents')}>{W.label.acceptAgents}</HButton> : null}
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
            <p className="hxi-intro">{folder.engines.length === 0 ? W.hint.noEngines : installable(folder).length === 0 ? W.hint.previewOnly : W.hint.pickInterface}</p>
            <ul className="hxi-list" aria-label={W.label.engineChoices}>
              {folder.engines.map(id => {
                const preview = isPreviewEngine(id), locked = preview && !folder.previewEngines;
                return (
                <li key={id}>
                  <label className="hxi-card" data-on={engines.includes(id) ? '' : undefined} data-off={locked ? '' : undefined} data-preview={preview ? '' : undefined} data-engine={id}>
                    <input type="checkbox" className="hxi-check" checked={engines.includes(id)} disabled={locked} onChange={() => toggleEngine(id)} />
                    <Tile name="monitor" />
                    <span className="hxi-card-text">
                      <span className="hxi-card-name">{ENGINE_NAMES[id]}</span>
                      {preview ? <span className="hxi-card-note" data-slot="preview-note"><StateDot tone="quiet">{W.hint.previewTag}</StateDot>{locked ? <span className="hxe-muted" data-slot="preview-why"> {folder.installedEngines.includes(id) ? W.hint.previewKept : W.hint.previewOff}</span> : null}</span> : null}
                    </span>
                  </label>
                </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {step === 'review' || step === 'done' ? (
          <>
            {busy ? <Busy words={call.busy!} /> : null}
            {step === 'review' ? refusal : null}
            {step === 'review' && mode === 'install' && answer?.kind === 'approve' ? <ApproveLines lines={answer.lines} ticked={ticked} held={held} onTick={(key, on) => setTicked(t => (on ? [...new Set([...t, key])] : t.filter(x => x !== key)))} /> : null}
            {step === 'review' && mode === 'install' && merged ? <p className="hxe-notice" data-merged=""><StateDot tone="good">{W.hint.merged}</StateDot></p> : null}
            {step === 'review' && mode === 'install' && driftOf !== null && (plan !== null || merge !== null || busy) ? <DriftReport plan={driftOf} reconcile={reconcile} held={held || busy} onReconcile={changeReconcile} /> : null}
            {step === 'review' && mode === 'install' && reconcile === 'merge' && merge !== null ? (
              <MergeReview plan={merge} approved={approved === merge.revision} held={held} onApprove={on => setApproved(on ? merge.revision : null)} />
            ) : null}
            {step === 'review' && mode === 'install' && plan !== null ? (
              <PlanReview plan={plan} writeClaudeMd={writeClaudeMd} approvedRevision={approved} held={held} onWriteClaude={changeClaude} onApprove={setApproved} onMode={settleMode} />
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
  if (done.kind === 'install') return <ResultStep nothing={done.noop || done.written.length === 0} warnings={done.warnings ?? []} lists={[{ title: W.label.writtenFiles, files: done.written }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy }]} />;
  if (done.kind === 'remove') return <ResultStep nothing={done.deleted.length + done.restored.length === 0} warnings={done.warnings ?? []} lists={[{ title: W.label.removedFiles, files: done.deleted }, { title: W.label.restoredFiles, files: done.restored }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy }]} />;
  return (
    <ResultStep nothing={done.undone.length + done.kept.length + done.restoredModes.length + done.recordedModes.length === 0} lists={[
      { title: W.label.undoneFiles, files: done.undone }, { title: W.label.keptFiles, files: done.kept }, { title: W.label.modeRestored, files: done.restoredModes },
      { title: W.label.modeRecorded, files: done.recordedModes }, { title: W.label.leftBehind, files: done.leftBehind, note: W.hint.leftBehindWhy },
    ]} />
  );
}
