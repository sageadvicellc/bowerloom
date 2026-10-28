/**
 * "New harness from a folder": adoption, in steps. 1. The folder. 2. Review: what Bowerloom found, the copies to pick between, and what it leaves out.
 * 3. Confirm: the words and the exact text of every approval and the words of every acknowledgement, each ticked by the person. 4. Done: what was written.
 * - A new folder starts clean: no picks, acknowledgements, ticks, plan, recovery or refusal of the last one (U2).
 * - A pick or an acknowledgement plans again; the old plan leaves the screen while it runs (U4). A tick names the hash of what was read, so a changed item is
 *   unticked (U3).
 * - "Write N files" sends the revision on screen and exactly the ticked approvals, in the write lane; while it runs every choice is held (U1). Main asks
 *   the person once more in its own dialog, then writes; the Done step lists each file (U5).
 * - A refusal takes the focus; a refusal of a plan offers "Plan again" (U9, U10). A folder whose earlier run stopped part way gets its recovery plan.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { adoptCanWrite, approvalsToSend, shortRevision } from '../../../shared/engine/gates.js';
import type { AdoptChoices, AdoptRecoveryView, AdoptView, FolderInfo } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, approvePlanWords, writeFilesWords } from '../words-engine.js';
import { AdoptConfirm, AdoptReview } from './adopt-review.js';
import { Busy, FolderStep, RefusalNote, ResultStep, Section, TickRow, folderLine } from './engine-parts.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';

const W = ENGINE_WORDS;
type Step = 'folder' | 'review' | 'confirm' | 'recover' | 'done';
type Done = { kind: 'made'; written: readonly string[] } | { kind: 'recover'; removed: readonly string[]; kept: readonly string[]; leftFolders: readonly string[] };
const NO_CHOICES: AdoptChoices = { picks: {}, acknowledged: [] };
const BODY_NAME: Readonly<Record<Step, string>> = { folder: W.label.bodyFolder, review: W.label.bodyReview, confirm: W.label.bodyConfirm, recover: W.label.bodyReview, done: W.label.bodyResult };

export function AdoptSheet({ open, folderId, onClose }: { open: boolean; folderId: string | null; onClose(): void }): ReactElement | null {
  const engine = useEngine(), ui = useUi(), call = useCall();
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('folder');
  const [choices, setChoices] = useState<AdoptChoices>(NO_CHOICES);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [view, setView] = useState<AdoptView | null>(null);
  const [recovery, setRecovery] = useState<AdoptRecoveryView | null>(null);
  const [recoveryOk, setRecoveryOk] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true);
  const held = call.writing;

  /** Everything that belongs to one folder goes when the folder changes (U2). */
  const resetFolderState = (): void => { setChoices(NO_CHOICES); setTicked([]); setView(null); setRecovery(null); setRecoveryOk(null); setDone(null); setLastPlan(null); call.clear(); };

  // A sheet that opens starts again, with the folders Bowerloom knows now. A list that cannot be read is a refusal, never an empty list (U11).
  useEffect(() => {
    if (!open) return;
    setStep('folder'); setFolders([]); setPicked(null); resetFolderState();
    if (engine === null) return;
    void call.plan(W.label.planning, () => foldersCall(engine), list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'make').off);
      setPicked(folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null);
    });
    // The sheet starts again only when it opens.
  }, [open, engine]);
  // A new step puts the focus at its start, so a screen reader reads it. The folder step starts on the sheet's own title.
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(call.busy !== null, body);

  const folder = folders.find(f => f.id === picked);
  const plan = (id: string, next: AdoptChoices): void => {
    if (engine === null) return;
    const run = (): void => {
      setView(null);
      void call.plan(W.label.planning, () => engine.planAdoption(id, next), v => {
        setView(v);
        // The acknowledgements that count are the plan's own: one whose entry left the plan, or changed, leaves the choices too (W5).
        setChoices(c => ({ ...c, acknowledged: v.unmapped.filter(u => u.acknowledged).map(u => ({ id: u.id, hash: u.hash })) }));
      });
    };
    setLastPlan(() => run);
    run();
  };
  const pick = (id: string): void => { if (held || id === picked) return; setPicked(id); resetFolderState(); };
  const choose = (): void => {
    if (engine === null || held) return;
    void call.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!folderLine(got.info, 'make').off) { setPicked(got.info.id); resetFolderState(); }
    });
  };
  const next = (): void => {
    if (engine === null || folder === undefined || held) return;
    setDone(null);
    if (folder.unfinished.adoption) {
      setStep('recover');
      const run = (): void => { setRecovery(null); setRecoveryOk(null); void call.plan(W.label.planning, () => engine.planAdoptionRecovery(folder.id), v => setRecovery(v)); };
      setLastPlan(() => run);
      run();
      return;
    }
    setStep('review');
    plan(folder.id, choices);
  };
  const change = (nextChoices: AdoptChoices): void => { if (held) return; setChoices(nextChoices); if (folder !== undefined) plan(folder.id, nextChoices); };
  const pickVariant = (conflict: string, variant: string): void => change({ ...choices, picks: { ...choices.picks, [conflict]: variant } });
  const acknowledge = (id: string, hash: string, on: boolean): void => change({ ...choices, acknowledged: on ? [...choices.acknowledged.filter(a => a.id !== id), { id, hash }] : choices.acknowledged.filter(a => a.id !== id) });
  const tick = (key: string, on: boolean): void => { if (!held) setTicked(t => (on ? [...new Set([...t, key])] : t.filter(x => x !== key))); };
  const back = (to: Step): void => { if (held) return; call.clear(); setStep(to); };

  const write = (): void => {
    if (engine === null || folder === undefined || view === null || !adoptCanWrite(view, ticked)) return;
    void call.write(W.label.writing, () => engine.runAdoption(folder.id, view.revision, choices, approvalsToSend(view, ticked)), r => { setDone({ kind: 'made', written: r.written }); setStep('done'); });
  };
  const recover = (): void => {
    if (engine === null || folder === undefined || recovery === null || recoveryOk !== recovery.revision) return;
    void call.write(W.label.writing, () => engine.runAdoptionRecovery(folder.id, recovery.revision), r => { setDone({ kind: 'recover', ...r }); setStep('done'); });
  };

  const stepIndex = step === 'folder' ? 0 : step === 'confirm' ? 2 : step === 'done' ? 3 : 1;
  const head = <div className="hxi-steps"><Stepper steps={[W.label.stepFolder, W.label.stepReview, W.label.stepConfirm, W.label.stepResult]} current={stepIndex} label={W.label.steps} doneWord="done" /></div>;
  const busy = call.busy !== null;
  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" disabled={folder === undefined || busy} onClick={next}>{W.label.next}</HButton></>;
  else if (step === 'review') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" disabled={view === null || busy} onClick={() => setStep('confirm')}>{W.label.next}</HButton></>;
  else if (step === 'confirm') actions = <><HButton disabled={held} onClick={() => back('review')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={view === null || busy || !adoptCanWrite(view, ticked)} onClick={write}>{writeFilesWords(view?.files.length ?? 0)}</HButton></>;
  else if (step === 'recover') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={recovery === null || recoveryOk !== recovery.revision || busy} onClick={recover}>{W.label.finish}</HButton></>;
  else actions = <>{done?.kind === 'made' && folder !== undefined ? <HButton onClick={() => { onClose(); ui.openProject({ folderId: folder.id }); }}>{W.label.installIt}</HButton> : null}<HButton variant="primary" onClick={onClose}>{W.label.close}</HButton></>;

  const refusal = call.refusal === null ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {lastPlan !== null && step !== 'folder' && step !== 'done' ? <HButton onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
    </RefusalNote>
  );

  return (
    <Sheet open={open} title={step === 'recover' ? W.label.recoverAdoptTitle : W.label.adoptTitle} onClose={() => { if (!held) onClose(); }} width={840} tall dataSlot="make-harness" head={head}
      note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      {step === 'folder' ? (
        <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME.folder}>
          <FolderStep sheet="make" folders={folders} picked={picked} sample={engine?.mode === 'sample'} noBridge={engine === null} busy={busy} introRef={intro} onPick={pick} onChoose={choose}>{refusal}</FolderStep>
        </div>
      ) : (
        <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME[step]} aria-busy={busy}>
          {busy ? <Busy words={call.busy!} /> : null}
          {refusal}
          {step === 'review' && view !== null ? <AdoptReview view={view} held={held} onPick={pickVariant} /> : null}
          {step === 'confirm' && view !== null ? <AdoptConfirm view={view} ticked={ticked} held={held} onTick={tick} onAcknowledge={acknowledge} onPick={pickVariant} /> : null}
          {step === 'recover' && recovery !== null ? (
            <>
              <p className="hxi-sum">{W.paragraph.recoverIntro}</p>
              <p className="hxe-notice"><StateDot tone={recovery.journal === 'ok' ? 'quiet' : 'bad'}><span data-journal="">{recovery.journal === 'ok' ? W.hint.journalOk : W.hint.journalDamaged}</span></StateDot></p>
              {recovery.check.length === 0 ? null : <Section title={W.label.checkByHand} count={String(recovery.check.length)} slot="check"><ul className="hxe-places">{recovery.check.map(p => <li key={p} className="hxe-mono">{p}</li>)}</ul></Section>}
              <Section title={W.label.changes} count={String(recovery.remove.length + recovery.kept.length)} slot="remove">
                <ul className="hxi-files">{recovery.remove.map(p => <li key={p} className="hxi-file" data-file={p}><span className="hxi-file-path">{p}</span><StateDot tone={CHANGE_TONE.delete}>{CHANGE_WORDS.delete}</StateDot></li>)}</ul>
                <ul className="hxi-files">{recovery.kept.map(k => <li key={k.path} className="hxi-file" data-file={k.path}><span className="hxi-file-path">{k.path}</span><StateDot tone="quiet">{k.reason === 'changed' ? W.hint.keptChanged : W.hint.keptUnsafe}</StateDot></li>)}</ul>
              </Section>
              {recovery.dirs.length === 0 ? null : <Section title={W.label.foldersRemoved} count={String(recovery.dirs.length)} slot="dirs"><ul className="hxe-places">{recovery.dirs.map(d => <li key={d} className="hxe-mono">{d}</li>)}</ul></Section>}
              <ul className="hxe-ticks hxe-approve" data-approve-plan=""><TickRow slot="revision" checked={recoveryOk === recovery.revision} disabled={held} label={approvePlanWords(shortRevision(recovery.revision))} name={W.label.recoverAdoptTitle} onChange={on => setRecoveryOk(on ? recovery.revision : null)} /></ul>
            </>
          ) : null}
          {step === 'done' && done !== null ? (
            done.kind === 'made'
              ? <ResultStep nothing={done.written.length === 0} lists={[{ title: W.label.writtenFiles, files: done.written }]} />
              : <ResultStep nothing={done.removed.length === 0} lists={[{ title: W.label.removedFiles, files: done.removed }, { title: W.label.keptFiles, files: done.kept, note: W.hint.keptWhy }, { title: W.label.leftFolders, files: done.leftFolders, note: W.hint.leftBehindWhy }]} />
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
