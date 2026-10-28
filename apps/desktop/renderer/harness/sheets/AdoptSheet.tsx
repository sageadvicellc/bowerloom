/**
 * "New harness from a folder": adoption, in three steps. 1. The folder. 2. Review: what Bowerloom found, the copies to pick between, and what it leaves out.
 * 3. Confirm: the words of every approval and every acknowledgement, each ticked by the person. Every change of a pick or an acknowledgement plans again, so the
 * plan on screen is the plan that will be written. "Write N files" sends the revision on screen and exactly the approvals the person ticked; the main process
 * plans again and writes only when nothing changed. A folder whose earlier run stopped part way gets its recovery plan instead.
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
import { CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, approvePlanWords, writeFilesWords, wroteAdoption } from '../words-engine.js';
import { AdoptConfirm, AdoptReview } from './adopt-review.js';
import { Busy, FolderStep, RefusalNote, Section, TickRow, folderLine } from './engine-parts.js';
import { chooseFolderCall, useCall } from './use-call.js';

const W = ENGINE_WORDS;
type Step = 'folder' | 'review' | 'confirm' | 'recover';
const NO_CHOICES: AdoptChoices = { picks: {}, acknowledged: [] };

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
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null);

  // A sheet that opens starts again, with the folders Bowerloom knows now.
  useEffect(() => {
    if (!open || engine === null) return;
    setStep('folder'); setChoices(NO_CHOICES); setTicked([]); setView(null); setRecovery(null); setRecoveryOk(null); call.clear();
    void engine.folders().then(list => {
      setFolders(list);
      const usable = list.filter(f => !folderLine(f, 'make').off);
      setPicked(folderId !== null && usable.some(f => f.id === folderId) ? folderId : usable[0]?.id ?? null);
    }, () => setFolders([]));
  }, [open, engine, folderId, call.clear]);
  // A new step puts the focus at its start, so a screen reader reads it. The folder step starts on the sheet's own title.
  const first = useRef(true);
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    (step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);

  const folder = folders.find(f => f.id === picked);
  const plan = async (id: string, next: AdoptChoices): Promise<void> => {
    if (engine === null) return;
    await call.run(W.label.planning, () => engine.planAdoption(id, next), v => setView(v));
  };
  const choose = async (): Promise<void> => {
    if (engine === null) return;
    await call.run(W.label.chooseFolder, () => chooseFolderCall(engine), async info => {
      if (info === null) return;
      setFolders(await engine.folders());
      if (!folderLine(info, 'make').off) setPicked(info.id);
    });
  };
  const next = async (): Promise<void> => {
    if (engine === null || folder === undefined) return;
    if (folder.unfinished.adoption) {
      setStep('recover');
      await call.run(W.label.planning, () => engine.planAdoptionRecovery(folder.id), v => setRecovery(v));
      return;
    }
    setStep('review');
    await plan(folder.id, choices);
  };
  const change = (nextChoices: AdoptChoices): void => { setChoices(nextChoices); if (folder !== undefined) void plan(folder.id, nextChoices); };
  const pick = (conflict: string, variant: string): void => change({ ...choices, picks: { ...choices.picks, [conflict]: variant } });
  const acknowledge = (id: string, on: boolean): void => change({ ...choices, acknowledged: on ? [...new Set([...choices.acknowledged, id])] : choices.acknowledged.filter(x => x !== id) });
  const tick = (key: string, on: boolean): void => setTicked(t => (on ? [...new Set([...t, key])] : t.filter(x => x !== key)));

  const write = async (): Promise<void> => {
    if (engine === null || folder === undefined || view === null || !adoptCanWrite(view, ticked)) return;
    await call.run(W.label.writing, () => engine.runAdoption(folder.id, view.revision, choices, approvalsToSend(view, ticked)), done => {
      onClose();
      ui.showToast(wroteAdoption(done.written.length), { label: W.label.installIt, run: () => ui.openProject({ folderId: folder.id }) });
    });
  };
  const recover = async (): Promise<void> => {
    if (engine === null || folder === undefined || recovery === null || recoveryOk !== recovery.revision) return;
    await call.run(W.label.writing, () => engine.runAdoptionRecovery(folder.id, recovery.revision), () => { onClose(); ui.showToast(W.label.recoverAdoptTitle); });
  };

  const stepIndex = step === 'folder' ? 0 : step === 'confirm' ? 2 : 1;
  const head = <div className="hxi-steps"><Stepper steps={[W.label.stepFolder, W.label.stepReview, W.label.stepConfirm]} current={stepIndex} label={W.label.steps} doneWord="done" /></div>;
  let actions: ReactElement;
  if (step === 'folder') actions = <><HButton onClick={onClose}>{W.label.cancel}</HButton><HButton variant="primary" disabled={folder === undefined || call.busy !== null} onClick={() => void next()}>{W.label.next}</HButton></>;
  else if (step === 'review') actions = <><HButton onClick={() => setStep('folder')}>{W.label.back}</HButton><HButton variant="primary" disabled={view === null || call.busy !== null} onClick={() => setStep('confirm')}>{W.label.next}</HButton></>;
  else if (step === 'confirm') actions = <><HButton onClick={() => setStep('review')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={view === null || call.busy !== null || !adoptCanWrite(view, ticked)} onClick={() => void write()}>{writeFilesWords(view?.files.length ?? 0)}</HButton></>;
  else actions = <><HButton onClick={() => setStep('folder')}>{W.label.back}</HButton><HButton variant="primary" data-write="" disabled={recovery === null || recoveryOk !== recovery.revision || call.busy !== null} onClick={() => void recover()}>{W.label.finish}</HButton></>;

  return (
    <Sheet open={open} title={step === 'recover' ? W.label.recoverAdoptTitle : W.label.adoptTitle} onClose={onClose} width={840} tall dataSlot="make-harness" head={head}
      note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
      {engine === null ? <RefusalNote refusal={{ code: 'NO_BRIDGE', message: W.hint.noBridge, paths: [] }} /> : null}
      {step === 'folder' ? (
        <FolderStep sheet="make" folders={folders} picked={picked} sample={engine?.mode === 'sample'} busy={call.busy !== null} refusal={call.refusal} introRef={intro} onPick={setPicked} onChoose={() => void choose()} />
      ) : (
        <div className="hxe-body" ref={body} tabIndex={-1} aria-busy={call.busy !== null}>
          {call.busy === null ? null : <Busy words={call.busy} />}
          {call.refusal === null ? null : <RefusalNote refusal={call.refusal} />}
          {step === 'review' && view !== null ? <AdoptReview view={view} onPick={pick} /> : null}
          {step === 'confirm' && view !== null ? <AdoptConfirm view={view} ticked={ticked} onTick={tick} onAcknowledge={acknowledge} /> : null}
          {step === 'recover' && recovery !== null ? (
            <>
              <p className="hxi-sum">{W.paragraph.recoverIntro}</p>
              {recovery.journal === 'damaged' ? <Section title={W.label.problems} slot="check"><ul className="hxe-places">{recovery.check.map(p => <li key={p} className="hxe-mono">{p}</li>)}</ul></Section> : null}
              <Section title={W.label.changes} count={String(recovery.remove.length)} slot="remove">
                <ul className="hxi-files">{recovery.remove.map(p => <li key={p} className="hxi-file"><span className="hxi-file-path">{p}</span><StateDot tone={CHANGE_TONE.delete}>{CHANGE_WORDS.delete}</StateDot></li>)}</ul>
                <ul className="hxi-files">{recovery.kept.map(k => <li key={k.path} className="hxi-file"><span className="hxi-file-path">{k.path}</span><StateDot tone="quiet">{k.reason === 'changed' ? W.hint.keptChanged : W.hint.keptUnsafe}</StateDot></li>)}</ul>
              </Section>
              <ul className="hxe-ticks"><TickRow slot="revision" checked={recoveryOk === recovery.revision} name={approvePlanWords(shortRevision(recovery.revision))} onChange={on => setRecoveryOk(on ? recovery.revision : null)} /></ul>
            </>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
