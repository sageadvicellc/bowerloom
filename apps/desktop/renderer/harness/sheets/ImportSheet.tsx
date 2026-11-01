/**
 * "Import a harness" (journey 4): one harness file goes into a folder that has no harness, or an empty one. 1. the file, 2. the folder, 3. the review, 4. Done.
 * - The file: main opens its own open dialog, reads the file once, checks everything and holds it under an id. The window gets the file name, the size and what it
 *   holds, never a path and never bytes. A file from another person is data: the sheet says to check what runs. A status line says the file was read.
 * - The folder: any folder main knows. A folder whose harness has parts is marked refused, and refused in the code's own words if it is planned anyway. A folder with no
 *   harness is a valid target: the one plan makes the empty harness and writes the files, and one approval covers both (decision of 2026-10-31).
 * - The review puts the risky parts first (tools and the host each reaches, values and where they go, files that can run, paths), then the notes choices (Link a folder
 *   or Leave out, left out by default), then the files it writes, then two ticks. A choice plans again and keeps the old plan on screen, dimmed, until the new one
 *   arrives; the ticks start over, a status says so, and the focus stays on the button that was pressed. The foot names what blocks the button.
 * - Done says nothing is installed and nothing has run, lists the files and the values again, and offers Install, which it never starts.
 * - A closed dialog is a calm note, never an error. A refusal takes the focus, says what to do next, and offers "Plan again".
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { CANCELLED, ENGINE_NAMES, SHARE_LIST_LIMIT } from '../../../shared/engine/types.js';
import type { Answer, BundleView, EngineBridge, FolderInfo, ImportNoteChoices, ImportNoteRow, ImportView, NotesView, SaveWritten } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { CHANGE_TONE, CHANGE_WORDS, ENGINE_WORDS, engineList } from '../words-engine.js';
import {
  SHARE, SHARE_REFUSAL_WORDS, approveImportName, approveImportWords, fileSizeWords, importBlockWords, importFilesWords, importTickWords, importedWords, makesHarnessWords, notesButtonName,
  notesChoiceName, readFileWords,
} from '../words-share.js';
import { Busy, RefusalNote, TickRow } from './engine-parts.js';
import { Capped, Full, Name, SecretsSection, ShareSection, ShareSummaryView, totalOf, useScrolls } from './share-parts.js';
import { ExportSheet } from './ExportSheet.js';
import { chooseFolderCall, foldersCall, useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import './share.css';

const W = ENGINE_WORDS;
type Step = 'file' | 'folder' | 'review' | 'done';
const BODY_NAME: Readonly<Record<Step, string>> = { file: SHARE.label.bodyFile, folder: SHARE.label.bodyFolder, review: SHARE.label.bodyReview, done: SHARE.label.bodyDone };
/** The files of the write list shown before "Show all files". */
export const WRITES_SHOWN = 10;
const noop = (): void => undefined;

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
      <p className="hxe-text" data-bundle-name={bundle.name}><span className="hxe-muted">{SHARE.label.file}</span> <Name mono>{bundle.name}</Name> <span className="hxe-muted">{fileSizeWords(bundle.bytes)}</span></p>
      <p className="hxe-text hxe-muted" data-other-person="">{SHARE.hint.otherPerson}</p>
      <ShareSummaryView summary={bundle.summary} side="import" />
    </div>
  );
}

/** What a folder card says under the name, and whether Import refuses it. */
export function importFolderLine(f: FolderInfo): { words: string; off: boolean } {
  if (f.problem !== null) return { words: f.problem, off: true };
  if (!f.hasDefinition) return { words: SHARE.hint.noHarnessYet, off: false };
  if (f.holdsParts === true) return { words: SHARE.hint.holdsParts, off: true };
  if (f.holdsParts === false) return { words: SHARE.hint.emptyHarness, off: false };
  return { words: f.engines.length === 0 ? SHARE.hint.harnessUnknown : engineList(f.engines.map(e => ENGINE_NAMES[e])), off: false };
}

/** The folder cards of step two. A folder Import refuses is marked and cannot be picked. */
export function FolderList({ folders, picked, busy, onPick }: { folders: readonly FolderInfo[]; picked: string | null; busy: boolean; onPick(id: string): void }): ReactElement {
  return (
    <ul className="hxi-list hxe-folders" aria-label={W.label.folders}>
      {folders.map(f => {
        const { words, off } = importFolderLine(f), on = f.id === picked;
        return (
          <li key={f.id}>
            <button type="button" className="hxi-card" aria-pressed={on} aria-disabled={off || busy ? true : undefined} data-off={off ? '' : undefined} data-folder={f.id} onClick={() => { if (!off && !busy) onPick(f.id); }}>
              <Tile name="folder" />
              <span className="hxi-card-text">
                <span className="hxi-card-name">{f.name}</span>
                <span className="hxi-card-sub">{f.label}</span>
                <span className="hxi-card-sub">{words}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One notes name of the plan, with its two choices. Leave out is the default. Both buttons are described by the line that says what is chosen. */
function NoteChoice({ row, held, onLink, onLeave }: { row: ImportNoteRow; held: boolean; onLink(name: string): void; onLeave(name: string): void }): ReactElement {
  const state = useId(), linked = row.choice === 'link';
  return (
    <li className="hxsh-row" data-note-choice={row.name} data-choice={row.choice}>
      <span className="hxsh-row-head"><Name>{row.name}</Name>{row.readBy.length === 0 ? null : <span className="hxe-muted">{SHARE.label.readBy}: <Full>{row.readBy.join(', ')}</Full></span>}</span>
      <div className="hxsh-choice" role="group" aria-label={notesChoiceName(row.name)}>
        <HButton size="small" disabled={held} aria-pressed={linked} aria-describedby={state} aria-label={notesButtonName(linked ? SHARE.label.change : SHARE.label.link, row.name)} data-note-link={row.name} onClick={() => onLink(row.name)}>{linked ? SHARE.label.change : SHARE.label.link}</HButton>
        <HButton size="small" disabled={held} aria-pressed={!linked} aria-describedby={state} aria-label={notesButtonName(SHARE.label.leave, row.name)} data-note-leave={row.name} onClick={() => onLeave(row.name)}>{SHARE.label.leave}</HButton>
      </div>
      <span className="hxsh-line hxe-muted" id={state} data-note-state="">{linked && row.label !== null ? <>{SHARE.label.linkedTo} <Full mono>{row.label}</Full></> : SHARE.hint.leaveDefault}</span>
    </li>
  );
}

/** The notes choices: open for five names or fewer, folded for more, with one button that leaves them all out. */
function NotesChoices({ notes, held, onLink, onLeave, onLeaveAll }: { notes: readonly ImportNoteRow[]; held: boolean; onLink(name: string): void; onLeave(name: string): void; onLeaveAll(): void }): ReactElement {
  const [open, setOpen] = useState(notes.length <= 5);
  const anyLinked = notes.some(n => n.choice === 'link');
  return (
    <>
      <details className="hxsh-notes" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
        <summary>{SHARE.label.notesChoice} <span className="hxe-count">{notes.length}</span></summary>
        <ul className="hxsh-list" aria-label={SHARE.label.notesChoice}>
          {notes.map(row => <NoteChoice key={row.name} row={row} held={held} onLink={onLink} onLeave={onLeave} />)}
        </ul>
      </details>
      <p className="hxe-text hxe-muted">{SHARE.hint.notesImport}</p>
      {notes.length < 2 ? null : <div className="hxe-actions"><HButton size="small" data-leave-all="" disabled={held} aria-disabled={anyLinked ? undefined : true} onClick={() => { if (anyLinked) onLeaveAll(); }}>{SHARE.label.leaveAll}</HButton></div>}
    </>
  );
}

/** The files the import writes: the ones that can run first, ten shown, and a button for the rest. */
function WritesList({ view }: { view: ImportView }): ReactElement {
  const [all, setAll] = useState(false), id = useId();
  const rows = [...view.changes.filter(c => c.executable === true), ...view.changes.filter(c => c.executable !== true)];
  return (
    <>
      <div id={id}>
        <Capped list={{ rows, more: 0 }} label={SHARE.label.writesHead} empty={W.hint.sameAsNow} limit={all ? SHARE_LIST_LIMIT : WRITES_SHOWN}
          render={c => (
            <li key={c.path} className="hxi-file" data-file={c.path} data-action={c.action} data-executable={c.executable === true ? '' : undefined}>
              <span className="hxi-file-path">{c.path}</span>
              <span className="hxsh-marks">
                <StateDot tone={CHANGE_TONE[c.action]}>{CHANGE_WORDS[c.action]}</StateDot>
                {c.executable === true ? <StateDot tone="warn">{W.hint.canRun}</StateDot> : null}
              </span>
            </li>
          )} />
      </div>
      {rows.length <= WRITES_SHOWN ? null : <div className="hxe-actions"><HButton size="small" data-show-all-files="" aria-expanded={all} aria-controls={id} onClick={() => setAll(a => !a)}>{all ? SHARE.label.showFewer : SHARE.label.showAllFiles}</HButton></div>}
    </>
  );
}

export interface ImportReviewProps {
  view: ImportView;
  approved: boolean;
  acknowledged: boolean;
  held: boolean;
  /** True while a new plan is on its way after a choice: the plan shown is the old one, dimmed, and the ticks wait. */
  stale?: boolean;
  onApprove(on: boolean): void;
  onAcknowledge(on: boolean): void;
  onLink(name: string): void;
  onLeave(name: string): void;
  onLeaveAll?(): void;
}

/**
 * The plan of an import: the folder it writes into, what the file holds with the risky parts first (tools that run code, the host each one reaches, values and where they
 * go, files that can run, paths of another computer), the notes choices, the files it writes, and the ticks. Import waits for both ticks.
 */
export function ImportReview({ view, approved, acknowledged, held, stale = false, onApprove, onAcknowledge, onLink, onLeave, onLeaveAll = noop }: ImportReviewProps): ReactElement {
  const locked = held || stale;
  return (
    <div className={stale ? 'hxsh-stale' : undefined} data-import-review="" aria-busy={stale}>
      <p className="hxi-sum" data-budget="paragraph">{SHARE.paragraph.reviewIntro}</p>
      <p className="hxe-text hxe-muted" data-other-person="">{SHARE.hint.otherPerson}</p>
      <p className="hxe-text hxsh-target" data-target={view.folder}><span className="hxe-muted">{SHARE.label.into}</span> <Name mono>{view.folder}</Name></p>
      {view.makesHarness === true ? <p className="hxe-text" data-makes-harness=""><StateDot tone="warn">{makesHarnessWords(view.changes.length)}</StateDot></p> : null}
      <ShareSummaryView summary={view.summary} side="import" notes={false} />
      {view.notes.length === 0 ? null : (
        <ShareSection id={`${view.bundleId}-notes`} title={SHARE.label.notesHead} count={String(view.notes.length)} slot="import-notes">
          <NotesChoices notes={view.notes} held={held} onLink={onLink} onLeave={onLeave} onLeaveAll={onLeaveAll} />
        </ShareSection>
      )}
      <ShareSection id={`${view.bundleId}-writes`} title={SHARE.label.writesHead} count={String(view.changes.length)} slot="import-writes">
        <WritesList view={view} />
      </ShareSection>
      {view.acknowledge === null ? null : (
        <ul className="hxe-ticks" data-acknowledge-import="">
          <TickRow slot="import-read" checked={acknowledged} disabled={locked} label={importTickWords(view.summary)} name={approveImportName(view.summary.harness)} onChange={onAcknowledge} />
        </ul>
      )}
      {view.noop ? null : (
        <ul className="hxe-ticks hxe-approve" data-approve-plan="">
          <TickRow slot="revision" checked={approved} disabled={locked} label={approveImportWords(view.changes.length, view.folder, view.makesHarness === true)} name={view.folder} onChange={onApprove} />
        </ul>
      )}
    </div>
  );
}

export interface ImportSheetProps { open: boolean; onClose(): void }

export function ImportSheet({ open, onClose }: ImportSheetProps): ReactElement | null {
  const engine = useEngine(), ui = useUi(), call = useCall(), list = useCall(), blockId = useId(), fileId = useId(), folderId = useId();
  const [step, setStep] = useState<Step>('file');
  const [bundle, setBundle] = useState<BundleView | null>(null);
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [links, setLinks] = useState<ReadonlyMap<string, string>>(new Map());
  const [shown, setShown] = useState<ImportView | null>(null);
  const [stale, setStale] = useState(false);
  const [approved, setApproved] = useState<string | null>(null);
  const [acked, setAcked] = useState<string | null>(null);
  const [done, setDone] = useState<{ view: ImportView; written: SaveWritten } | null>(null);
  const [lastPlan, setLastPlan] = useState<(() => void) | null>(null);
  const [announce, setAnnounce] = useState('');
  const intro = useRef<HTMLParagraphElement>(null), body = useRef<HTMLDivElement>(null), writeButton = useRef<HTMLButtonElement>(null);
  const heldId = useRef<string | null>(null), openRef = useRef(false), epoch = useRef(0), engineRef = useRef<EngineBridge | null>(null), focusStep = useRef(false), refocus = useRef<{ kind: 'link' | 'leave'; name: string } | null>(null);
  const held = call.writing, planning = call.busy !== null || list.busy !== null;
  const scrolls = useScrolls(body, shown ?? done ?? bundle ?? step);

  useEffect(() => { engineRef.current = engine; });

  /** Lets main drop the bundle it holds. A failure here changes nothing the person sees. */
  const drop = (): void => {
    const id = heldId.current;
    heldId.current = null;
    if (id !== null && engineRef.current !== null) void Promise.resolve(engineRef.current.discardBundle(id)).catch(noop);
  };
  const readFolders = (): void => { if (engine !== null) void list.plan(W.label.planning, () => foldersCall(engine), setFolders); };
  const resetPlan = (): void => { setShown(null); setStale(false); setApproved(null); setAcked(null); setLastPlan(null); setAnnounce(''); };
  /** Moves to a step and, once it is drawn, puts the focus on its start. */
  const go = (to: Step): void => { focusStep.current = true; setStep(to); };

  useEffect(() => {
    openRef.current = open;
    epoch.current += 1;
    if (!open) { drop(); call.clear(); list.clear(); return; }
    heldId.current = null;
    setStep('file'); setBundle(null); setPicked(null); setLinks(new Map()); setDone(null); resetPlan(); call.clear(); list.clear();
    readFolders();
  }, [open, engine]);
  // A bundle still held when the sheet goes away is dropped.
  useEffect(() => () => { openRef.current = false; drop(); }, []);
  useEffect(() => {
    if (!open || !focusStep.current) return;
    focusStep.current = false;
    (step === 'file' || step === 'folder' ? intro.current : body.current)?.focus({ preventScroll: true });
  }, [step, open]);
  // After a notes choice plans again, the focus goes back to the button that was pressed.
  useEffect(() => {
    const want = refocus.current;
    if (want === null || shown === null || stale) return;
    refocus.current = null;
    const attr = want.kind === 'link' ? 'data-note-link' : 'data-note-leave';
    [...(body.current?.querySelectorAll<HTMLElement>(`[${attr}]`) ?? [])].find(el => el.getAttribute(attr) === want.name)?.focus({ preventScroll: true });
  }, [shown, stale]);
  // A closed save dialog is a choice, not a fault: the focus goes back to Import.
  const cancelled = call.refusal?.code === CANCELLED;
  useEffect(() => { if (cancelled) writeButton.current?.focus({ preventScroll: true }); }, [cancelled, call.refusalId]);
  useHeldFocus(planning && !cancelled, body);

  /**
   * Plans the import of the bundle into the picked folder, with the notes choices as they are. The newest plan wins. With `keep`, the plan on screen stays, dimmed, until the
   * new one arrives, and the ticks start over.
   */
  const planWith = (next: ReadonlyMap<string, string> = links, id: string | null = picked, keep = false): void => {
    if (engine === null || bundle === null || id === null) return;
    const bundleId = bundle.bundleId, choices = choicesOf(bundle.summary.notes.rows.map(n => n.name), next);
    const run = (): void => {
      if (keep) { setApproved(null); setAcked(null); setStale(true); setAnnounce(''); } else resetPlan();
      setLastPlan(() => run);
      void call.plan(W.label.planning, () => engine.planImport(id, bundleId, choices), v => {
        setShown(v); setStale(false);
        if (keep) setAnnounce(SHARE.hint.approvalCleared); else go('review');
      });
    };
    run();
  };

  const chooseFile = (): void => {
    if (engine === null || held) return;
    const mine = epoch.current;
    // A file that arrives after the sheet closed (or closed and opened again) is dropped the moment it arrives, even when the lane has dropped the answer, so main never holds
    // a bundle nobody can see.
    const call_ = (): Promise<Answer<BundleView | null>> => chooseBundleCall(engine).then(a => {
      if (a.ok && a.value !== null && epoch.current !== mine) void Promise.resolve(engine.discardBundle(a.value.bundleId)).catch(noop);
      return a;
    });
    void call.plan(SHARE.label.openingFile, call_, got => {
      if (got === null) return;
      drop();
      heldId.current = got.bundleId;
      setBundle(got); setLinks(new Map()); resetPlan();
    });
  };
  const chooseFolder = (): void => {
    if (engine === null || held) return;
    void list.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => {
      if (got === null) return;
      setFolders(got.list);
      if (!importFolderLine(got.info).off) { setPicked(got.info.id); resetPlan(); }
    });
  };
  const onLink = (name: string): void => {
    if (engine === null || held) return;
    refocus.current = { kind: 'link', name };
    void call.plan(W.label.chooseFolder, () => chooseNotesCall(engine), got => {
      if (got === null) { refocus.current = null; return; }
      const next = new Map(links);
      next.set(name, got.id);
      setLinks(next);
      planWith(next, picked, true);
    });
  };
  const onLeave = (name: string): void => {
    if (held || !links.has(name)) return;
    refocus.current = { kind: 'leave', name };
    const next = new Map(links);
    next.delete(name);
    setLinks(next);
    planWith(next, picked, true);
  };
  const onLeaveAll = (): void => {
    if (held || links.size === 0) return;
    refocus.current = { kind: 'leave', name: [...links.keys()][0]! };
    const next = new Map<string, string>();
    setLinks(next);
    planWith(next, picked, true);
  };

  /** True when the shown plan may be written: it is the new one, its revision is approved, and the tools, files and values are acknowledged when it asks. */
  const needsRead = shown !== null && shown.acknowledge !== null && acked !== shown.acknowledge;
  const writable = shown !== null && !stale && !shown.noop && approved === shown.revision && !needsRead;
  const write = (): void => {
    if (engine === null || picked === null || bundle === null || shown === null || !writable || planning) return;
    const id = picked, view = shown, bundleId = bundle.bundleId, choices = choicesOf(bundle.summary.notes.rows.map(n => n.name), links), ack = view.acknowledge === null ? null : acked;
    void call.write(W.label.writing, () => engine.runImport(id, view.revision, bundleId, choices, ack), written => { setDone({ view, written }); go('done'); });
  };
  const back = (to: Step): void => {
    if (held) return;
    call.clear(); resetPlan();
    go(to);
  };
  const close = (): void => { if (!held) onClose(); };

  const blockText = step !== 'review' || shown === null ? '' : importBlockWords({ planning: stale || planning, needsRead, approved: approved === shown.revision });
  const footNote = step === 'file' ? SHARE.hint.fileFoot : step === 'folder' ? SHARE.hint.folderFoot : step === 'done' ? SHARE.hint.doneFoot : blockText === '' ? SHARE.hint.folderFoot : blockText;
  const pickedInfo = folders.find(f => f.id === picked);
  const folderOk = pickedInfo !== undefined && !importFolderLine(pickedInfo).off;

  const steps = [SHARE.label.stepFile, SHARE.label.stepFolder, SHARE.label.stepReview, SHARE.label.stepDone];
  const current = step === 'file' ? 0 : step === 'folder' ? 1 : step === 'review' ? 2 : 3;
  const head = <div className="hxi-steps"><Stepper steps={steps} current={current} label={SHARE.label.steps} doneWord="done" /></div>;

  let actions: ReactElement;
  if (step === 'file') actions = <><HButton onClick={close}>{W.label.cancel}</HButton><HButton variant="primary" data-import-next="" aria-disabled={bundle === null || planning ? true : undefined} aria-describedby={fileId} onClick={() => { if (bundle !== null && !planning) go('folder'); }}>{W.label.next}</HButton></>;
  else if (step === 'folder') actions = <><HButton disabled={held} onClick={() => back('file')}>{W.label.back}</HButton><HButton variant="primary" data-import-plan="" aria-disabled={!folderOk || planning ? true : undefined} aria-describedby={folderId} onClick={() => { if (folderOk && !planning) planWith(); }}>{W.label.next}</HButton></>;
  else if (step === 'review') actions = <><HButton disabled={held} onClick={() => back('folder')}>{W.label.back}</HButton><HButton ref={writeButton} variant="primary" data-import-write="" aria-disabled={!writable || planning ? true : undefined} aria-describedby={blockId} onClick={write}>{importFilesWords(shown === null ? null : shown.changes.length)}</HButton></>;
  else {
    actions = <>
      {done !== null && done.written.written.length > 0 && picked !== null ? <HButton data-install-next="" onClick={() => { const id = picked; onClose(); ui.openProject({ folderId: id }); }}>{W.label.installIt}</HButton> : null}
      <HButton variant="primary" onClick={onClose}>{W.label.close}</HButton>
    </>;
  }

  const code = call.refusal?.code ?? list.refusal?.code;
  const nextWords = code === undefined || cancelled ? undefined : SHARE_REFUSAL_WORDS[code];
  const refusal = call.refusal === null || cancelled ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {lastPlan !== null ? <HButton data-plan-again="" onClick={lastPlan}>{W.label.planAgain}</HButton> : null}
    </RefusalNote>
  );
  const listRefusal = list.refusal === null ? null : <RefusalNote refusal={list.refusal} focusId={list.refusalId}>{null}</RefusalNote>;

  return (
    <Sheet open={open} title={SHARE.label.importTitle} onClose={close} width={880} tall dataSlot="import" head={head} note={footNote} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={scrolls ? 0 : -1} aria-label={BODY_NAME[step]} aria-busy={planning}>
        <p className="hxsh-sr" role="status" id={blockId}>{blockText}</p>
        <p className="hxsh-sr" role="status" data-announce="">{announce}</p>
        {step === 'file' ? (
          <>
            <p className="hxi-intro" tabIndex={-1} ref={intro} data-budget="paragraph">{SHARE.paragraph.importIntro}</p>
            <div className="hxe-actions"><HButton icon="page" data-choose-file="" disabled={planning || held || engine === null} onClick={chooseFile}>{bundle === null ? SHARE.label.chooseFile : SHARE.label.chooseAnother}</HButton></div>
            <p className="hxe-text hxe-muted" role="status" id={fileId} data-file-status="">{bundle === null ? SHARE.hint.noFile : readFileWords(bundle.name, bundle.summary.counts.files, totalOf(bundle.summary.tools))}</p>
            {engine === null ? <p className="hxe-text" data-no-bridge="">{W.hint.noBridge}</p> : null}
          </>
        ) : null}
        {step === 'folder' ? (
          <>
            <p className="hxi-intro" tabIndex={-1} ref={intro} data-budget="paragraph">{SHARE.paragraph.folderIntro}</p>
            <p className="hxi-intro">{folders.length === 0 ? SHARE.hint.noFolders : SHARE.hint.chooseFolderHint}</p>
            {folders.length === 0 ? null : <FolderList folders={folders} picked={picked} busy={planning || held} onPick={id => { setPicked(id); resetPlan(); call.clear(); }} />}
            {engine?.mode === 'sample' ? null : <div className="hxe-actions"><HButton icon="plus" data-choose-folder="" disabled={planning || held || engine === null} onClick={chooseFolder}>{W.label.chooseFolder}</HButton></div>}
            <p className="hxe-text hxe-muted" role="status" id={folderId} data-folder-status="">{folderOk ? '' : SHARE.hint.noFolderPicked}</p>
            {listRefusal}
          </>
        ) : null}
        {planning ? <Busy words={call.busy ?? list.busy!} /> : null}
        {cancelled ? <p className="hxe-text" role="status" data-cancelled="">{SHARE.hint.cancelledImport}</p> : null}
        {refusal}
        {nextWords === undefined ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
        {step === 'file' && bundle !== null ? <BundleBody bundle={bundle} /> : null}
        {step === 'review' && shown !== null ? (
          <ImportReview view={shown} stale={stale} approved={approved === shown.revision} acknowledged={shown.acknowledge !== null && acked === shown.acknowledge} held={held}
            onApprove={on => setApproved(on ? shown.revision : null)} onAcknowledge={on => setAcked(on ? shown.acknowledge : null)} onLink={onLink} onLeave={onLeave} onLeaveAll={onLeaveAll} />
        ) : null}
        {step === 'done' && done !== null ? (
          <div data-done="">
            <p className="hxi-sum" role="status" data-done-status="">{SHARE.hint.notInstalled}</p>
            <p className="hxe-text" data-imported=""><StateDot tone="good">{importedWords(done.written.written.length, done.view.folder)}</StateDot></p>
            {done.written.written.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.nothingChanged}</p> : (
              <ShareSection id={`${done.view.bundleId}-done`} title={W.label.writtenFiles} count={String(done.written.written.length)} slot="result-written">
                <Capped list={{ rows: done.written.written, more: 0 }} label={W.label.writtenFiles} empty=""
                  render={f => <li key={f} className="hxi-file"><span className="hxi-file-path">{f}</span></li>} />
              </ShareSection>
            )}
            {done.written.version === null ? null : <p className="hxe-text" data-version-kept={done.written.version}><StateDot tone="good">{W.hint.pointKept}</StateDot> {done.written.version}</p>}
            {(done.written.warnings ?? []).map(w => <p key={w} className="hxe-text" role="status" data-warning="">{w}</p>)}
            {totalOf(done.view.summary.secrets) === 0 ? null : <SecretsSection summary={done.view.summary} side="import" id={`${done.view.bundleId}-secrets`} />}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Both share sheets, mounted once beside the other sheets. Each opens from the shared state (ui.tsx). */
export function ShareSheets(): ReactElement {
  const ui = useUi();
  return (
    <>
      <ExportSheet open={ui.exportSheet.open} folderId={ui.exportSheet.folderId} unsaved={ui.exportSheet.unsaved} onClose={ui.closeExport} />
      <ImportSheet open={ui.importSheet.open} onClose={ui.closeImport} />
    </>
  );
}
