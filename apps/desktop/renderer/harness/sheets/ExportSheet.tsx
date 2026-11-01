/**
 * "Export a harness" (journey 4): one folder's saved harness goes to one file.
 * - The sheet plans first: `planExport(folderId)` reads the folder and lists what the file would hold, risky parts first (tools, values read from this computer and where
 *   they go, files that can run, paths of this computer). Nothing is written, and the window holds no path and no file bytes.
 * - The button says Export. It asks main, which opens its own save dialog, then its own write question, then writes one new file. The window gets the file name and its
 *   size back. A dialog closed without a yes is a calm note ("You did not save"), not an error: the focus stays on Export and nothing is written.
 * - When the files hold a path of this computer (`acknowledge` is not null), one tick accepts them. The button keeps the focus while it waits and says why in the foot.
 * - A refusal takes the focus, says what to do next, and offers "Plan again".
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { CANCELLED } from '../../../shared/engine/types.js';
import type { ExportView, ExportWritten } from '../../../shared/engine/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { SHARE, SHARE_REFUSAL_WORDS, exportFileWords, fileSizeWords } from '../words-share.js';
import { Busy, RefusalNote, TickRow } from './engine-parts.js';
import { Full, Name, ShareSummaryView, useScrolls } from './share-parts.js';
import { useCall } from './use-call.js';
import { useHeldFocus } from './use-held-focus.js';
import { WORDS } from '../words.js';
import './share.css';

const W = ENGINE_WORDS;

/** The plan of an export, drawn: the file, what it holds, and the one tick when the files hold a path of this computer. */
export function ExportBody({ view, acked, held, onAck, unsaved = false }: { view: ExportView; acked: boolean; held: boolean; onAck(on: boolean): void; unsaved?: boolean }): ReactElement {
  return (
    <div data-export-review="">
      <p className="hxi-sum" data-budget="paragraph">{SHARE.paragraph.exportIntro}</p>
      {unsaved ? <p className="hxe-text" data-unsaved=""><StateDot tone="warn">{SHARE.hint.unsavedNote}</StateDot></p> : null}
      <p className="hxe-text" data-export-file={view.file}>
        <span className="hxe-muted">{SHARE.label.file}</span> <Name mono>{view.file}</Name> <span className="hxe-muted">{fileSizeWords(view.bytes)}</span>
      </p>
      <ShareSummaryView summary={view.summary} side="export" />
      {view.acknowledge === null ? null : (
        <ul className="hxe-ticks hxe-approve" data-acknowledge-paths="">
          <TickRow slot="export-paths" checked={acked} disabled={held} label={SHARE.hint.tickExport} name={view.file} onChange={onAck} />
        </ul>
      )}
    </div>
  );
}

/** What an export did: the file name and its size, and what it holds. */
export function ExportDone({ written }: { written: ExportWritten }): ReactElement {
  return (
    <div data-done="">
      <p className="hxi-sum" role="status"><StateDot tone="good">{SHARE.label.exported}</StateDot> <span data-exported-file={written.name}><Full mono>{exportFileWords(written.name, written.bytes)}</Full></span></p>
      <p className="hxe-text hxe-muted">{SHARE.hint.savedWhere} {SHARE.hint.exportDone}</p>
    </div>
  );
}

export interface ExportSheetProps { open: boolean; folderId: string | null; /** True when the Builder holds changes that are not saved: the file does not hold them. */ unsaved?: boolean; onClose(): void }

export function ExportSheet({ open, folderId, unsaved = false, onClose }: ExportSheetProps): ReactElement | null {
  const engine = useEngine(), call = useCall(), blockId = useId();
  const [view, setView] = useState<ExportView | null>(null);
  const [acked, setAcked] = useState<string | null>(null);
  const [done, setDone] = useState<ExportWritten | null>(null);
  const body = useRef<HTMLDivElement>(null), first = useRef(true), button = useRef<HTMLButtonElement>(null);
  const [nudge, setNudge] = useState(0);
  const held = call.writing, busy = call.busy !== null;
  const scrolls = useScrolls(body, view ?? done);

  /** Reads the folder and lists what the file would hold. The newest plan wins. */
  const plan = (): void => {
    if (engine === null || folderId === null) return;
    setView(null); setAcked(null); setDone(null);
    void call.plan(W.label.planning, () => engine.planExport(folderId), setView);
  };
  useEffect(() => {
    if (!open) { call.clear(); return; }
    call.clear(); setView(null); setAcked(null); setDone(null);
    plan();
  }, [open, engine, folderId]);
  // The result takes the focus, so a screen reader hears it.
  useEffect(() => {
    if (!open) { first.current = true; return; }
    if (first.current) { first.current = false; return; }
    if (done !== null) body.current?.focus({ preventScroll: true });
  }, [done, open]);
  // A closed save dialog is a choice, not a fault: the focus goes back to Export.
  const cancelled = call.refusal?.code === CANCELLED;
  useEffect(() => { if (cancelled) button.current?.focus({ preventScroll: true }); }, [cancelled, call.refusalId]);
  useHeldFocus(busy && !cancelled, body);

  /** True when the plan on screen may be written: the tick is given when the files hold a path of this computer. */
  const writable = view !== null && (view.acknowledge === null || acked === view.acknowledge);
  const blocked = view === null ? null : writable ? null : SHARE.hint.blockExport;
  const write = (): void => {
    // A press on a blocked button shows why: the focus goes to the first box that is not ticked; with none, it stays on the button and the live line is said again.
    if (!writable || busy) {
      const box = body.current?.querySelector<HTMLElement>('[data-tick] input:not(:checked)');
      if (box !== null && box !== undefined) box.focus(); else setNudge(n => n + 1);
      return;
    }
    if (engine === null || folderId === null || view === null) return;
    const revision = view.revision, ack = view.acknowledge === null ? null : acked;
    void call.write(W.label.writing, () => engine.runExport(folderId, revision, ack), setDone);
  };

  const nextWords = call.refusal === null || cancelled ? undefined : SHARE_REFUSAL_WORDS[call.refusal.code];
  const refusal = call.refusal === null || cancelled ? null : (
    <RefusalNote refusal={call.refusal} focusId={call.refusalId}>
      {folderId !== null && engine !== null ? <HButton data-plan-again="" disabled={held} onClick={plan}>{W.label.planAgain}</HButton> : null}
    </RefusalNote>
  );
  const actions = done !== null
    ? <HButton variant="primary" onClick={onClose}>{W.label.close}</HButton>
    : <><HButton onClick={onClose} disabled={held}>{W.label.cancel}</HButton><HButton ref={button} variant="primary" icon="share" data-export-write="" aria-disabled={busy || !writable ? true : undefined} aria-describedby={blockId} onClick={write}>{SHARE.label.export}</HButton></>;
  const foot = done !== null ? '' : cancelled ? SHARE.hint.cancelledExport : blocked ?? (engine?.mode === 'sample' ? W.hint.sampleNote : SHARE.hint.exportWrites);

  return (
    <Sheet open={open} title={SHARE.label.exportTitle} onClose={() => { if (!held) onClose(); }} width={880} tall dataSlot="export" note={foot} actions={actions}>
      <div className="hxe-body" role="region" ref={body} tabIndex={scrolls ? 0 : -1} aria-label={done === null ? SHARE.label.bodyExport : SHARE.label.bodyExported} aria-busy={busy}>
        <p className="hxsh-sr" role="status" id={blockId} key={nudge}>{blocked ?? ''}</p>
        {engine === null ? <p className="hxe-text" data-no-bridge="">{W.hint.noBridge}</p> : null}
        {engine !== null && folderId === null ? <p className="hxe-text" data-no-folder="">{WORDS.hint.noFolder}</p> : null}
        {busy ? <Busy words={call.busy!} /> : null}
        {cancelled ? <p className="hxe-text" role="status" data-cancelled="">{SHARE.hint.cancelledExport}</p> : null}
        {refusal}
        {nextWords === undefined ? null : <p className="hxe-text" data-next-step="">{nextWords}</p>}
        {view !== null && done === null ? <ExportBody view={view} unsaved={unsaved} acked={view.acknowledge !== null && acked === view.acknowledge} held={held} onAck={on => { if (cancelled) call.clear(); setAcked(on ? view.acknowledge : null); }} /> : null}
        {done !== null ? <ExportDone written={done} /> : null}
      </div>
    </Sheet>
  );
}
