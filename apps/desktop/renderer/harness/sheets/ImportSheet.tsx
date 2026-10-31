/**
 * "Import a harness" (journey 4): one harness file goes into a folder that has no harness, or an empty one. 1. the file, 2. the folder, 3. the review, 4. Done.
 * - The file: main opens its own open dialog, reads the file once, checks everything and holds it under an id. The window gets the file name, the size and what it
 *   holds, never a path and never bytes. A file from another person is data: the sheet says to read the files that run.
 * - The folder: any folder main knows. A folder with a harness that has parts is refused in the code's own words, and a folder with no harness offers
 *   "New harness from a folder" first. The plan is made when the person goes on.
 * - The review lists every file the import writes, every tool that can run code and the host each one reaches, every file that can run, each `${NAME}` reference with
 *   the tool and host its value goes to, and each notes name with "Link a folder" or "Leave out" (leave out by default). One tick says the person read the tools, files
 *   and values; one tick approves the plan's revision. Main asks once more in its own dialog.
 * - Done lists the files written, the save point kept, and the values the file reads, again. Install is offered and never started.
 * - A refusal takes the focus, says what to do next, and offers "Plan again".
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { Answer, BundleView, EngineBridge, FolderInfo, ImportNoteChoices, ImportNoteRow, ImportView, NotesView, SaveWritten } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, approvePlanWords, engineList } from '../words-engine.js';
import { SHARE, SHARE_REFUSAL_WORDS, approveImportName, fileSizeWords, importFilesWords, notesButtonName, notesChoiceName } from '../words-share.js';
import { Busy, RefusalNote, ResultStep, Section, TickRow } from './engine-parts.js';
import { Capped, Cut, SecretsSection, ShareSummaryView, totalOf } from './share-parts.js';
import { ExportSheet } from './ExportSheet.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import './share.css';

const W = ENGINE_WORDS;
type Step = 'file' | 'folder' | 'review' | 'done';
const BODY_NAME: Readonly<Record<Step, string>> = { file: SHARE.label.bodyFile, folder: SHARE.label.bodyFolder, review: SHARE.label.bodyReview, done: SHARE.label.bodyDone };
const short = (revision: string): string => revision.slice(0, 8);

/** The open dialog and the new bundle as one call: a closed dialog is a value of null, not a refusal. */
export async function chooseBundleCall(engine: EngineBridge): Promise<Answer<BundleView | null>> {
  const answer = await engine.chooseBundle();
  return answer === null ? { ok: true, value: null } : answer.ok ? { ok: true, value: answer.value } : answer;
}
/** The notes chooser as one call: a closed chooser is a value of null. */
async function chooseNotesCall(engine: EngineBridge): Promise<Answer<NotesView | null>> {
  const answer = await engine.chooseNotesFolder('use');
  return answer === null ? { ok: true, value: null } : answer.ok ? { ok: true, value: answer.value } : answer;
}

/**
 * The choices the window sends: each linked name maps to the notes folder id main gave out, and every other name the bundle holds is listed as left out. A name is an
 * untrusted key, so the map is built with `Object.fromEntries`, which makes an own property even for `__proto__`.
 */
export function choicesOf(names: readonly string[], links: ReadonlyMap<string, string>): ImportNoteChoices {
  return { link: Object.fromEntries(links), leave: names.filter(name => !links.has(name)) };
}

/** What the file step shows: the file, and what it holds. */
export function BundleBody({ bundle }: { bundle: BundleView }): ReactElement {
  return (
    <div data-bundle={bundle.bundleId}>
      <p className="hxe-text" data-bundle-name={bundle.name}><span className="hxe-muted">{SHARE.label.file}</span> <Cut mono>{bundle.name}</Cut> <span className="hxe-muted">{fileSizeWords(bundle.bytes)}</span></p>
      <p className="hxe-text hxe-muted" data-other-person="">{SHARE.hint.otherPerson}</p>
      <ShareSummaryView summary={bundle.summary} side="import" />
    </div>
  );
}

/** The folder cards of step two. */
function FolderList({ folders, picked, busy, onPick }: { folders: readonly FolderInfo[]; picked: string | null; busy: boolean; onPick(id: string): void }): ReactElement {
  return (
    <ul className="hxi-list hxe-folders" aria-label={W.label.folders}>
      {folders.map(f => {
        const off = f.problem !== null, on = f.id === picked;
        const line = f.problem ?? (f.hasDefinition ? (f.engines.length === 0 ? SHARE.hint.holdsParts : engineList(f.engines.map(e => ENGINE_NAMES[e]))) : W.hint.noHarness);
        return (
          <li key={f.id}>
            <button type="button" className="hxi-card" aria-pressed={on} aria-disabled={off || busy ? true : undefined} data-off={off ? '' : undefined} data-folder={f.id} onClick={() => { if (!off && !busy) onPick(f.id); }}>
              <Tile name="folder" />
              <span className="hxi-card-text">
                <span className="hxi-card-name">{f.name}</span>
                <span className="hxi-card-sub">{f.label}</span>
                <span className="hxi-card-sub">{line}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One notes name of the plan, with its two choices. Leave out is the default. */
function NoteChoice({ row, held, onLink, onLeave }: { row: ImportNoteRow; held: boolean; onLink(name: string): void; onLeave(name: string): void }): ReactElement {
  const linked = row.choice === 'link';
  return (
    <li className="hxsh-row" data-note-choice={row.name} data-choice={row.choice}>
      <span className="hxsh-row-head"><Cut>{row.name}</Cut>{row.readBy.length === 0 ? null : <span className="hxe-muted">{SHARE.label.readBy}: <Cut>{row.readBy.join(', ')}</Cut></span>}</span>
      <div className="hxsh-choice" role="group" aria-label={notesChoiceName(row.name)}>
        <HButton size="small" disabled={held} aria-pressed={linked} aria-label={notesButtonName(SHARE.label.link, row.name)} data-note-link={row.name} onClick={() => onLink(row.name)}>{SHARE.label.link}</HButton>
        <HButton size="small" disabled={held} aria-pressed={!linked} aria-label={notesButtonName(SHARE.label.leave, row.name)} data-note-leave={row.name} onClick={() => onLeave(row.name)}>{SHARE.label.leave}</HButton>
      </div>
      <span className="hxsh-line hxe-muted" data-note-state="">{linked && row.label !== null ? <>{SHARE.label.linkedTo} <Cut mono>{row.label}</Cut></> : SHARE.hint.leaveDefault}</span>
    </li>
  );
}

export interface ImportReviewProps {
  view: ImportView;
  approved: boolean;
  acknowledged: boolean;
  held: boolean;
  onApprove(on: boolean): void;
  onAcknowledge(on: boolean): void;
  onLink(name: string): void;
  onLeave(name: string): void;
}

/**
 * The plan of an import: what the file holds first (tools that run code, the host each one reaches, files that can run, values passed from this computer, paths of
 * another one), then the notes choices, then every file it writes, then the ticks, so the long list of files never hides what can run. Import waits for both ticks.
 */
export function ImportReview({ view, approved, acknowledged, held, onApprove, onAcknowledge, onLink, onLeave }: ImportReviewProps): ReactElement {
  const changes = { rows: view.changes, more: 0 };
  return (
    <div data-import-review="">
      <p className="hxi-sum" data-budget="paragraph">{SHARE.paragraph.reviewIntro}</p>
      <p className="hxe-text hxe-muted" data-other-person="">{SHARE.hint.otherPerson}</p>
      <ShareSummaryView summary={view.summary} side="import" notes={false} />
      <Section title={SHARE.label.notesChoice} count={String(view.notes.length)} slot="import-notes">
        {view.notes.length === 0 ? <p className="hxe-text hxe-muted" data-empty="">{SHARE.hint.noNotes}</p> : (
          <>
            <ul className="hxsh-list" aria-label={SHARE.label.notesChoice}>
              {view.notes.map(row => <NoteChoice key={row.name} row={row} held={held} onLink={onLink} onLeave={onLeave} />)}
            </ul>
            <p className="hxe-text hxe-muted">{SHARE.hint.notesImport}</p>
          </>
        )}
      </Section>
      <Section title={SHARE.label.writesHead} count={String(view.changes.length)} slot="import-writes">
        <Capped list={changes} label={SHARE.label.writesHead} empty={W.hint.sameAsNow}
          render={c => (
            <li key={c.path} className="hxi-file" data-file={c.path} data-action={c.action} data-executable={c.executable === true ? '' : undefined}>
              <span className="hxi-file-path">{c.path}</span>
              <span className="hxsh-marks">
                <StateDot tone={CHANGE_TONE[c.action]}>{CHANGE_WORDS[c.action]}</StateDot>
                {c.executable === true ? <StateDot tone="warn">{W.hint.canRun}</StateDot> : null}
              </span>
            </li>
          )} />
      </Section>
      {view.acknowledge === null ? null : (
        <ul className="hxe-ticks" data-acknowledge-import="">
          <TickRow slot="import-read" checked={acknowledged} disabled={held} label={SHARE.hint.tickImport} name={approveImportName(view.summary.harness)} onChange={onAcknowledge} />
        </ul>
      )}
      {view.noop ? null : (
        <ul className="hxe-ticks hxe-approve" data-approve-plan="">
          <TickRow slot="revision" checked={approved} disabled={held} label={approvePlanWords(short(view.revision))} name={SHARE.label.importTitle} onChange={onApprove} />
        </ul>
      )}
    </div>
  );
}

export interface ImportSheetProps { open: boolean; onClose(): void }

export function ImportSheet({ open, onClose }: ImportSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall(), list = useCall(), ui = useUi();
  const [step, setStep] = useState<Step>('file');
  const [bundle, setBundle] = useState<BundleView | null>(null);
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [links, setLinks] = useState<ReadonlyMap<string, string>>(new Map());
  const [shown, setShown] = useState<ImportView | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  const [acked, setAcked] = useState<string | null>(null);
  const [done, setDone] = useState<{ view: ImportView; written: SaveWritten } | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), first = useRef(true), heldId = useRef<string | null>(null), wasAdopt = useRef(false);
  const held = call.writing, busy = call.busy !== null || list.busy !== null;
  const folder = folders.find(f => f.id === picked);
  heldId.current = bundle?.bundleId ?? null;

  /** Lets main drop the bundle it holds. A failure here changes nothing the person sees. */
  const drop = (): void => {
    const id = heldId.current;
    heldId.current = null;
    if (id !== null && engine !== null) void engine.discardBundle(id).catch(() => undefined);
  };
  const readFolders = (): void => { if (engine !== null) void list.plan(W.label.planning, () => foldersCall(engine), setFolders); };
  const resetPlan = (): void => { setShown(null); setApproved(null); setAcked(null); setLastPlan(null); };

  useEffect(() => {
    if (!open) { first.current = true; drop(); return; }
    setStep('file'); setBundle(null); setPicked(null); setLinks(new Map()); setDone(null); resetPlan(); call.clear(); list.clear();
    readFolders();
  }, [open, engine]);
  useEffect(() => {
    if (!open) return;
    if (first.current) { first.current = false; return; }
    (step === 'file' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  useHeldFocus(busy, body);

  /** Plans the import of the bundle into the picked folder, with the notes choices as they are. The newest plan wins. */
  const planWith = (next: ReadonlyMap<string, string> = links, id: string | null = picked): void => {
    if (engine === null || bundle === null || id === null) return;
    const bundleId = bundle.bundleId, choices = choicesOf(bundle.summary.notes.rows.map(n => n.name), next);
    const run = (): void => {
      resetPlan();
      void call.plan(W.label.planning, () => engine.planImport(id, bundleId, choices), v => { setShown(v); setStep('review'); });
    };
    setLastPlan(() => run);
    run();
  };
  // A harness made from a folder while this sheet is open: the folders are read again, and a plan that waited for it is made again.
  useEffect(() => {
    if (wasAdopt.current && !ui.adopt.open && open) {
      readFolders();
      if (picked !== null && call.refusal?.code === 'SAVE_NO_DEFINITION') planWith();
    }
    wasAdopt.current = ui.adopt.open;
  }, [ui.adopt.open]);

  const chooseFile = (): void => {
    if (engine === null || held) return;
    void call.plan(SHARE.label.openingFile, () => chooseBundleCall(engine), got => {
      if (got === null) return;
      drop();
      setBundle(got); heldId.current = got.bundleId; setLinks(new Map()); resetPlan();
    });
  };
  const chooseFolder = (): void => {
    if (engine === null || held) return;
    void list.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (got.info.problem === null) { setPicked(got.info.id); resetPlan(); }
    });
  };
  const onLink = (name: string): void => {
    if (engine === null || held) return;
    void call.plan(W.label.chooseFolder, () => chooseNotesCall(engine), got => {
      if (got === null) return;
      const next = new Map(links);
      next.set(name, got.id);
      setLinks(next);
      planWith(next);
    });
  };
  const onLeave = (name: string): void => {
    if (held || !links.has(name)) return;
    const next = new Map(links);
    next.delete(name);
    setLinks(next);
    planWith(next);
  };

  /** True when the shown plan may be written: its revision approved, and the tools, files and values acknowledged, when it asks. */
  const writable = shown !== null && !shown.noop && approved === shown.revision && (shown.acknowledge === null || acked === shown.acknowledge);
  const write = (): void => {
    if (engine === null || picked === null || bundle === null || shown === null || !writable) return;
    const id = picked, view = shown, bundleId = bundle.bundleId, choices = choicesOf(bundle.summary.notes.rows.map(n => n.name), links), ack = view.acknowledge === null ? null : acked;
    void call.write(W.label.writing, () => engine.runImport(id, view.revision, bundleId, choices, ack), written => { setDone({ view, written }); setStep('done'); });
  };
  const back = (to: Step): void => {
    if (held) return;
    call.clear(); resetPlan();
    setStep(to);
  };
  const close = (): void => { if (!held) onClose(); };

  const steps = [SHARE.label.stepFile, SHARE.label.stepFolder, SHARE.label.stepReview, SHARE.label.stepDone];
  const current = step === 'file' ? 0 : step === 'folder' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={SHARE.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'file') actions = <><HButton onClick={close}>{W.label.cancel}</HButton><HButton variant="primary" data-import-next="" disabled={bundle === null || busy} onClick={() => setStep('folder')}>{W.label.next}</HButton></>;
  else if (step === 'folder') actions = <><HButton disabled={held} onClick={() => back('file')}>{W.label.back}</HButton><HButton variant="primary" data-import-plan="" disabled={picked === null || busy} onClick={() => planWith()}>{W.label.next}</HButton></>;
  else if (step === 'review') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><HButton variant="primary" data-import-write="" disabled={busy || !writable} onClick={write}>{importFilesWords(shown?.changes.length ?? 0)}</HButton></>;
  else {
    actions = <>
      {done !== null && done.written.written.length > 0 && picked !== null ? <HButton data-install-next="" onClick={() => { const id = picked; onClose(); ui.openProject({ folderId: id }); }}>{W.label.installIt}</HButton> : null}
      <HButton variant="primary" onClick={onClose}>{W.label.close}</HButton>
    </>;
  }

  const code = call.refusal?.code ?? list.refusal?.code;
  const nextWords = code === undefined ? undefined : SHARE_REFUSAL_WORDS[code];
  const refusal = call.refusal === null ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {lastPlan !== null && step === 'review' ? <HButton data-plan-again="" onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
      {picked !== null && call.refusal.code === 'SAVE_NO_DEFINITION' ? <HButton data-make-harness="" onClick={() => ui.openAdopt({ folderId: picked })}>{W.label.adoptTitle}</HButton> : null}
    </RefusalNote>
  );
  const listRefusal = list.refusal === null ? null : <RefusalNote refusal={list.refusal} focusId={list.refusalId}>{null}</RefusalNote>;

  return (
    <>
      <Sheet open={open} title={SHARE.label.importTitle} onClose={close} width={880} tall dataSlot="import" head={head}
        note={engine?.mode === 'sample' ? W.hint.sampleNote : W.hint.readOnly} actions={actions}>
        <div className="hxe-body" role="region" ref={body} tabIndex={-1} aria-label={BODY_NAME[step]} aria-busy={busy}>
          {step === 'file' ? (
            <>
              <p className="hxi-intro" tabIndex={-1} ref={intro} data-budget="paragraph">{SHARE.paragraph.importIntro}</p>
              <div className="hxe-actions"><HButton icon="page" data-choose-file="" disabled={busy || held || engine === null} onClick={chooseFile}>{bundle === null ? SHARE.label.chooseFile : SHARE.label.chooseAnother}</HButton></div>
              {engine === null ? <p className="hxe-text" data-no-bridge="">{W.hint.noBridge}</p> : null}
            </>
          ) : null}
          {step === 'folder' ? (
            <>
              <p className="hxi-intro" tabIndex={-1} ref={intro} data-budget="paragraph">{SHARE.paragraph.folderIntro}</p>
              <p className="hxi-intro">{folders.length === 0 ? SHARE.hint.noFolders : SHARE.hint.chooseFolderHint}</p>
              {folders.length === 0 ? null : <FolderList folders={folders} picked={picked} busy={busy || held} onPick={id => { setPicked(id); resetPlan(); call.clear(); }} />}
              {engine?.mode === 'sample' ? null : <div className="hxe-actions"><HButton icon="plus" data-choose-folder="" disabled={busy || held || engine === null} onClick={chooseFolder}>{W.label.chooseFolder}</HButton></div>}
              {listRefusal}
            </>
          ) : null}
          {busy ? <Busy words={call.busy ?? list.busy!} /> : null}
          {refusal}
          {nextWords === undefined ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
          {step === 'file' && bundle !== null ? <BundleBody bundle={bundle} /> : null}
          {step === 'folder' && folder !== undefined && !folder.hasDefinition ? <p className="hxe-text hxe-muted" data-folder-note="">{SHARE.hint.makeFirst}</p> : null}
          {step === 'folder' && folder !== undefined && folder.hasDefinition ? <p className="hxe-text hxe-muted" data-folder-note="">{SHARE.hint.mustBeEmpty}</p> : null}
          {step === 'review' && shown !== null ? (
            <ImportReview view={shown} approved={approved === shown.revision} acknowledged={shown.acknowledge !== null && acked === shown.acknowledge} held={held}
              onApprove={on => setApproved(on ? shown.revision : null)} onAcknowledge={on => setAcked(on ? shown.acknowledge : null)} onLink={onLink} onLeave={onLeave} />
          ) : null}
          {step === 'done' && done !== null ? (
            <ResultStep nothing={done.written.written.length === 0} warnings={done.written.warnings ?? []} lists={[{ title: W.label.writtenFiles, files: done.written.written }]}>
              {done.written.version === null ? null : <p className="hxe-text" data-version-kept={done.written.version}><StateDot tone="good">{W.hint.pointKept}</StateDot> {done.written.version}</p>}
              {totalOf(done.view.summary.secrets) === 0 ? null : <SecretsSection summary={done.view.summary} side="import" />}
              {done.written.written.length === 0 ? null : <p className="hxe-text hxe-muted">{SHARE.hint.notInstalled}</p>}
            </ResultStep>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

/** Both share sheets, mounted once beside the other sheets. Each opens from the shared state (ui.tsx). */
export function ShareSheets(): ReactElement {
  const ui = useUi();
  return (
    <>
      <ExportSheet open={ui.exportSheet.open} folderId={ui.exportSheet.folderId} onClose={ui.closeExport} />
      <ImportSheet open={ui.importSheet.open} onClose={ui.closeImport} />
    </>
  );
}
