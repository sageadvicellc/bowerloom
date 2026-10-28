/**
 * "Install a folder's harness": the projection of the folder's own `.bowerloom` harness into each interface's files, and its removal and recovery.
 * Install: 1. the folder, 2. the interfaces (tick boxes), 3. the review. The review first lists any enforced rule that an interface carries weaker, each to be
 * ticked; then the plan, which ends with one tick box that approves its revision. A change of a choice (the drift report, the CLAUDE.md offer) plans again and
 * needs a new approval. "Write N files" sends the approved revision; the main process plans again under the project lock and writes only when it is the same.
 * Remove and recover: 1. the folder, 2. the plan, approved the same way. A refusal is shown in its own words, with the step that helps (plan a recovery, keep
 * my versions) beside it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { projectCanWrite, untickedLines } from '../../../shared/engine/gates.js';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { EngineId, FolderInfo, ProjectAnswer, ProjectInput, Reconcile, RecoveryView, RemovalView } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import type { EngineSheetMode } from '../ui.js';
import { WORDS } from '../words.js';
import { ENGINE_WORDS, removeFilesWords, removedWords, writeFilesWords, wroteInstall } from '../words-engine.js';
import { Busy, FolderStep, RefusalNote, folderLine } from './engine-parts.js';
import { ApproveLines, PlanReview, RecoveryReview, RemovalReview } from './project-review.js';
import { chooseFolderCall, useCall } from './use-call.js';

const W = ENGINE_WORDS;
type Step = 'folder' | 'interfaces' | 'review';

export interface ProjectSheetProps { open: boolean; folderId: string | null; mode: EngineSheetMode; keep: readonly string[]; onClose(): void }

export function ProjectSheet({ open, folderId, mode: openedMode, keep: openedKeep, onClose }: ProjectSheetProps): ReactElement | null {
  const engine = useEngine(), ui = useUi(), call = useCall();
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
  const [approved, setApproved] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalView | null>(null);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);

  const reset = (): void => { setAnswer(null); setApproved(null); setRemoval(null); setRecovery(null); setTicked([]); setSent([]); call.clear(); };
  useEffect(() => {
    if (!open || engine === null) return;
    setStep('folder'); setMode(openedMode); setKeep(openedKeep); setReconcile('accept-agents'); setWriteClaudeMd(false); reset();
    void engine.folders().then(list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'install').off);
      const id = folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null;
      setPicked(id);
      setEngines(list.find(f => f.id === id)?.engines ?? []);
      // Opened for one folder's removal or recovery (from a note, or from "Keep my versions"): the plan shows at once.
      if (id !== null && folderId === id && openedMode !== 'install') { setStep('review'); void planOther(id, openedMode, openedKeep); }
    }, () => setFolders([]));
    // The sheet starts again only when it opens.
  }, [open, engine]);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);

  const folder = folders.find(f => f.id === picked);
  const input = (approve: readonly string[], r = reconcile, claude = writeClaudeMd, list = engines): ProjectInput => ({ engines: list, reconcile: r, writeClaudeMd: claude, approve });

  async function planInstall(next: ProjectInput): Promise<void> {
    if (engine === null || folder === undefined) return;
    await call.run(W.label.planning, () => engine.planProjection(folder.id, next), a => {
      setAnswer(a); setSent(next.approve);
      if (a.kind === 'approve') setTicked(t => [...new Set([...t, ...a.approvedSoFar])]);
    });
  }
  async function planOther(id: string, m: EngineSheetMode, k: readonly string[]): Promise<void> {
    if (engine === null) return;
    if (m === 'remove') await call.run(W.label.planning, () => engine.planRemoval(id), v => setRemoval(v));
    else await call.run(W.label.planning, () => engine.planRecovery(id, k), v => setRecovery(v));
  }
  const switchTo = (m: EngineSheetMode, k: readonly string[] = []): void => {
    if (folder === undefined) return;
    reset(); setMode(m); setKeep(k); setStep('review'); void planOther(folder.id, m, k);
  };
  const pick = (id: string): void => { setPicked(id); setEngines(folders.find(f => f.id === id)?.engines ?? []); reset(); };
  const choose = async (): Promise<void> => {
    if (engine === null) return;
    await call.run(W.label.chooseFolder, () => chooseFolderCall(engine), async info => {
      if (info === null) return;
      setFolders(await engine.folders());
      if (!folderLine(info, 'install').off) { setPicked(info.id); setEngines(info.engines); reset(); }
    });
  };
  const next = (): void => {
    if (folder === undefined) return;
    if (step === 'folder') { setMode('install'); setStep('interfaces'); return; }
    setStep('review'); setApproved(null); void planInstall(input(sent));
  };
  const toggleEngine = (id: EngineId): void => setEngines(list => (list.includes(id) ? list.filter(e => e !== id) : (folder?.engines ?? []).filter(e => e === id || list.includes(e))));
  const changeReconcile = (r: Reconcile): void => { setReconcile(r); void planInstall(input(sent, r)); };
  const changeClaude = (on: boolean): void => { setWriteClaudeMd(on); void planInstall(input(sent, reconcile, on)); };

  const write = async (): Promise<void> => {
    if (engine === null || folder === undefined) return;
    if (mode === 'install') {
      const plan = answer?.kind === 'plan' ? answer.plan : null;
      if (plan === null || !projectCanWrite(plan, approved)) return;
      await call.run(W.label.writing, () => engine.runProjection(folder.id, plan.revision, input(sent)), done => {
        onClose();
        ui.showToast(wroteInstall(done.written.length), { label: WORDS.label.undo, run: () => ui.openProject({ folderId: folder.id, mode: 'remove' }) });
      });
    } else if (mode === 'remove' && removal !== null && approved === removal.revision) {
      await call.run(W.label.writing, () => engine.runRemoval(folder.id, removal.revision), done => { onClose(); ui.showToast(removedWords(done.deleted.length, done.restored.length)); });
    } else if (mode === 'recover' && recovery !== null && approved === recovery.revision) {
      await call.run(W.label.writing, () => engine.runRecovery(folder.id, recovery.revision, keep), () => { onClose(); ui.showToast(W.label.recoverTitle); });
    }
  };

  const steps = mode === 'install' ? [W.label.stepFolder, W.label.stepInterfaces, W.label.stepReview] : [W.label.stepFolder, W.label.stepReview];
  const current = step === 'folder' ? 0 : step === 'interfaces' ? 1 : steps.length - 1;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={W.label.steps} doneWord="done" /></div>;
  const busy = call.busy !== null;
  const plan = answer?.kind === 'plan' ? answer.plan : null;
  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" disabled={folder === undefined || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (step === 'interfaces') actions = <><HButton onClick={() => setStep('folder')}>{W.label.back}</HButton><HButton variant="primary" disabled={engines.length === 0 || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (mode === 'install' && answer?.kind === 'approve') {
    actions = <><HButton onClick={() => setStep('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-plan-again="" disabled={busy || untickedLines(answer, ticked).length > 0} onClick={() => void planInstall(input(answer.lines.map(l => l.key).filter(k => ticked.includes(k))))}>{W.label.planWithApprovals}</HButton></>;
  } else if (mode === 'install') {
    actions = <><HButton onClick={() => setStep('interfaces')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || !projectCanWrite(plan, approved)} onClick={() => void write()}>{plan?.noop === true ? W.label.nothingToChange : writeFilesWords(plan?.changes.filter(c => c.action !== 'unchanged').length ?? 0)}</HButton></>;
  } else {
    const rev = mode === 'remove' ? removal?.revision : recovery?.revision;
    actions = <><HButton onClick={() => { reset(); setMode('install'); setStep('folder'); }}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={busy || rev === undefined || approved !== rev} onClick={() => void write()}>{mode === 'remove' ? removeFilesWords(removal?.changes.length ?? 0) : W.label.finish}</HButton></>;
  }

  const helpers = call.refusal === null || folder === undefined ? null : (
    <div className="hxe-actions">
      {call.refusal.code === 'PORTABLE_RECOVERY_REQUIRED' ? <HButton onClick={() => switchTo('recover')}>{W.label.planRecovery}</HButton> : null}
      {call.refusal.drift !== undefined && call.refusal.drift.length > 0 ? <HButton onClick={() => switchTo('recover', call.refusal!.drift!.map(d => d.path))}>{W.label.keepMine}</HButton> : null}
      {call.refusal.code === 'PORTABLE_MERGE_NOT_BUILT' ? <HButton onClick={() => changeReconcile('accept-agents')}>{W.label.acceptAgents}</HButton> : null}
    </div>
  );
  const folderExtra = folder === undefined ? null : (
    <div className="hxe-actions">
      {folder.projected ? <HButton icon="minus-circle" onClick={() => switchTo('remove')}>{W.label.planRemoval}</HButton> : null}
      {folder.unfinished.projection ? <HButton icon="clock" onClick={() => switchTo('recover')}>{W.label.planRecovery}</HButton> : null}
    </div>
  );
  const title = mode === 'remove' ? W.label.removeTitle : mode === 'recover' ? W.label.recoverTitle : W.label.installTitle;

  return (
    <Sheet open={open} title={title} onClose={onClose} width={880} tall dataSlot="project" head={head} note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      {engine === null ? <RefusalNote refusal={{ code: 'NO_BRIDGE', message: W.hint.noBridge, paths: [] }} /> : null}
      {step === 'folder' ? (
        <FolderStep sheet="install" folders={folders} picked={picked} sample={engine?.mode === 'sample'} busy={busy} refusal={call.refusal} introRef={intro} onPick={pick} onChoose={() => void choose()} extra={folderExtra} />
      ) : null}
      {step === 'interfaces' && folder !== undefined ? (
        <div className="hxe-body" ref={body} tabIndex={-1}>
          <p className="hxi-intro">{W.hint.pickInterface}</p>
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
        </div>
      ) : null}
      {step === 'review' ? (
        <div className="hxe-body" ref={body} tabIndex={-1} aria-busy={busy}>
          {busy ? <Busy words={call.busy!} /> : null}
          {call.refusal === null ? null : <RefusalNote refusal={call.refusal}>{helpers}</RefusalNote>}
          {mode === 'install' && answer?.kind === 'approve' ? <ApproveLines lines={answer.lines} ticked={ticked} onTick={(key, on) => setTicked(t => (on ? [...new Set([...t, key])] : t.filter(x => x !== key)))} /> : null}
          {mode === 'install' && plan !== null ? (
            <PlanReview plan={plan} reconcile={plan.reconcile ?? reconcile} writeClaudeMd={writeClaudeMd} approvedRevision={approved} onReconcile={changeReconcile} onWriteClaude={changeClaude} onApprove={setApproved} />
          ) : null}
          {mode === 'remove' && removal !== null && folder !== undefined ? <RemovalReview plan={removal} folder={folder.label} approved={approved === removal.revision} onApprove={on => setApproved(on ? removal.revision : null)} /> : null}
          {mode === 'recover' && recovery !== null ? <RecoveryReview plan={recovery} approved={approved === recovery.revision} onApprove={on => setApproved(on ? recovery.revision : null)} /> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
