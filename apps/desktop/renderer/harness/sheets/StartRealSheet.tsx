/**
 * The Start sheet on the person's own folders (beta.2). Start runs nothing: the sheet shows the command to start an engine in a folder, with the instruction already in it, and
 * copies it for the person to paste into their own Terminal. No engine starts, no model is called, and no run is recorded.
 * It picks a project (a folder main knows, by its id), ticks the engines that folder's harness lists (Claude Code and Codex), and takes the instruction. "Show the command" asks main for one
 * command for each ticked engine. An engine that is not installed in the folder, or an install that stopped part way, opens the install review first (the folder install sheet) and the
 * Start sheet stays under it; when the review closes, the folder list is read again. Main builds the line, so the window never holds a folder's full path: it shows the line with `~`.
 * Copy asks main to put the same line on the clipboard with the full path. Changing any choice clears the commands shown, so what is on screen is always what Copy copies.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { Answer, EngineId, FolderInfo, StartCommandView } from '../../../shared/engine/types.js';
import { START_INSTRUCTION_LIMIT } from '../../../shared/engine/start-command.js';
import { engineStateOf, firstStartEngines, firstStartFolder, offeredEngines, startFolderLine, startSheetPhase, startStatus } from '../../../shared/harness/start-real.js';
import type { EngineState } from '../../../shared/harness/start-real.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { useEngine } from '../engine.js';
import { useUi } from '../ui.js';
import { START, commandFor, copyName, whyWords } from '../words-start.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { WORDS } from '../words.js';
import { CodeText, RefusalNote } from './engine-parts.js';
import { foldersCall, useCall } from './use-call.js';
import './engine.css';
import './start.css';
import './start-real.css';

// A recorded install is neutral, not green: the record says Bowerloom wrote the files, not that they are current.
const STATE_TONE: Readonly<Record<EngineState, 'quiet' | 'warn'>> = { ready: 'quiet', 'not-installed': 'warn', stopped: 'warn' };
const STATE_WORDS: Readonly<Record<EngineState, string>> = { ready: START.hint.ready, 'not-installed': START.hint.notInstalled, stopped: START.hint.stopped };

/** One command for each engine, in order. The first refusal stops the rest. */
async function showAll(engine: NonNullable<ReturnType<typeof useEngine>>, folder: string, engines: readonly EngineId[], instruction: string): Promise<Answer<readonly StartCommandView[]>> {
  const out: StartCommandView[] = [];
  for (const id of engines) {
    const answer = await engine.showStartCommand(folder, id, instruction);
    if (!answer.ok) return answer;
    out.push(answer.value);
  }
  return { ok: true, value: out };
}

export interface StartRealSheetProps {
  open: boolean;
  /** The folder the sheet opens on (a folder row's Start), or null. */
  folderId: string | null;
  /** True when a harness's Start opened it. A harness of the list is made from a scan and has no folder, so no folder is chosen for the person. */
  fromHarness: boolean;
  onClose(): void;
}

export function StartRealSheet({ open, folderId, fromHarness, onClose }: StartRealSheetProps): ReactElement | null {
  const engine = useEngine(), ui = useUi(), call = useCall();
  const [folders, setFolders] = useState<readonly FolderInfo[] | null>(null);
  const [folder, setFolder] = useState('');
  const [ticks, setTicks] = useState<readonly EngineId[]>([]);
  const [instruction, setInstruction] = useState('');
  const [shown, setShown] = useState<readonly StartCommandView[] | null>(null);
  const [copied, setCopied] = useState<EngineId | null>(null);
  /** The refusal the person has already moved past: a change hides it, so an old refusal never lingers beside a good choice. */
  const [passed, setPassed] = useState(0);
  const results = useRef<HTMLHeadingElement>(null);
  /** Counts the choices made, so an answer that comes back after the person changed one is dropped, never shown. */
  const stamp = useRef(0);
  const folderRef = useRef('');
  folderRef.current = folder;
  const reviewOpen = ui.projectSheet.open;

  // Each time the sheet opens it starts again: the folder list is read, and the folder is the one asked for, or none.
  useEffect(() => {
    if (!open) return;
    setFolders(null); setFolder(''); setTicks([]); setInstruction(''); setShown(null); setCopied(null); call.clear();
    readFolders();
  }, [open, folderId, engine]);

  // The first read of the folder list. Try again runs it once more when it was refused.
  const readFolders = (): void => {
    if (engine === null) return;
    void call.plan(START.hint.loading, () => foldersCall(engine), list => {
      const first = firstStartFolder(list, folderId);
      setFolders(list); setFolder(first); setTicks(firstStartEngines(list.find(f => f.id === first)));
    });
  };

  // When the install review closes, the folder list is read again, so the engine lines show what the install did. The choices stay, unless the folder can no longer start.
  const wasReview = useRef(false);
  useEffect(() => {
    const was = wasReview.current;
    wasReview.current = reviewOpen;
    if (!open || engine === null || !was || reviewOpen) return;
    void call.plan(START.hint.loading, () => foldersCall(engine), list => {
      stamp.current += 1;
      setFolders(list); setShown(null); setCopied(null);
      const kept = list.find(f => f.id === folderRef.current);
      if (kept === undefined || offeredEngines(kept).length === 0) { setFolder(''); setTicks([]); }
    });
  }, [reviewOpen, open, engine]);

  // The commands come into view with the focus on their heading, so the person reads them first.
  useEffect(() => { if (shown === null) return; results.current?.focus({ preventScroll: true }); results.current?.scrollIntoView({ block: 'start' }); }, [shown]);

  const current = folders?.find(f => f.id === folder);
  const status = startStatus(current, ticks, instruction);
  const why = status.kind === 'no-harness' && current !== undefined ? startFolderLine(current).words : whyWords(status);
  const offered = offeredEngines(current);
  const phase = startSheetPhase(folders, call.refusal !== null);
  const changed = (): void => { stamp.current += 1; setShown(null); setCopied(null); setPassed(call.refusalId); };
  const pickFolder = (id: string): void => { setFolder(id); setTicks(firstStartEngines(folders?.find(f => f.id === id))); changed(); };
  const tick = (id: EngineId): void => { setTicks(now => (now.includes(id) ? now.filter(x => x !== id) : [...now, id])); changed(); };
  const press = (): void => {
    if (status.kind === 'needs-install') { ui.openProject({ folderId: folder, mode: 'install' }); return; }
    if (status.kind !== 'ready' || engine === null) return;
    const engines = status.engines;
    setCopied(null);
    stamp.current += 1;
    const mine = stamp.current;
    void call.plan(START.label.working, () => showAll(engine, folder, engines, instruction), list => { if (stamp.current === mine) setShown(list); });
  };
  const copy = (id: EngineId): void => {
    if (engine === null || call.writing) return;
    setCopied(null);
    void call.write(START.label.copying, () => engine.startCommandToClipboard(folder, id, instruction), () => setCopied(id));
  };
  // While Bowerloom works on a call, the choices are held: an answer (or a refusal) that comes back is always for the choices on screen.
  const held = call.writing || call.busy !== null;
  const refusal = call.refusal !== null && call.refusalId !== passed ? call.refusal : null;

  return (
    <Sheet open={open} title={START.label.title} onClose={onClose} width={680} dataSlot="start" note={START.paragraph.note}
      actions={<><HButton onClick={onClose}>{WORDS.label.close}</HButton><HButton icon="play" variant="primary" disabled={status.kind !== 'ready' && status.kind !== 'needs-install'} aria-describedby={why === null || phase !== 'ready' ? undefined : 'hs-why'} onClick={press}>{START.label.show}</HButton></>}>
      {engine === null ? <p className="hxe-text hxe-muted">{START.hint.noBridge}</p> : (
        <>
          {refusal === null ? null : (
            <RefusalNote refusal={refusal} focusId={call.refusalId}>
              {folders === null ? <HButton data-try-again="" onClick={readFolders}>{ENGINE_WORDS.label.tryAgain}</HButton> : null}
            </RefusalNote>
          )}
          {fromHarness && folder === '' ? <p className="hs-compare" role="status" data-start-harness=""><HIcon name="info" size={20} /><span>{START.paragraph.noFolderForHarness}</span></p> : null}
          {phase === 'failed' ? null : folders === null ? <p className="hxe-text hxe-muted" role="status">{START.hint.loading}</p> : phase === 'none-can-start' ? (
            <div data-start-empty="">
              {folders.some(f => f.hasDefinition) ? (
                <>
                  <p className="hxe-text hxe-muted">{START.hint.noneCanStart}</p>
                  <ul className="hxe-rows" aria-label={START.label.project}>{folders.map(f => <li key={f.id} className="hxe-text" data-start-reason={f.id}><span className="hxe-name">{f.name}</span>{`: ${startFolderLine(f).words}`}</li>)}</ul>
                </>
              ) : <p className="hxe-text hxe-muted">{START.hint.noFolders}</p>}
            </div>
          ) : (
            <>
              <div className="hs-field">
                <label className="hs-label" htmlFor="hs-project">{START.label.project}</label>
                <div className="hs-select">
                  <span className="hs-select-icon" aria-hidden="true"><HIcon name="folder" size={18} /></span>
                  <select id="hs-project" value={folder} disabled={held} onChange={e => pickFolder(e.target.value)}>
                    <option value="">{START.hint.chooseProject}</option>
                    {folders.map(f => { const line = startFolderLine(f); return <option key={f.id} value={f.id} disabled={line.off && f.id !== folder}>{line.off ? `${f.name} (${line.words})` : f.name}</option>; })}
                  </select>
                  <span className="hs-select-icon" aria-hidden="true"><HIcon name="chevron" size={18} /></span>
                </div>
                {current === undefined ? null : <p className="hxe-text hxe-muted hs-where" data-start-where="">{current.label}</p>}
              </div>
              {current === undefined ? null : (
              <div className="hs-field">
                <h3 className="hs-label" id="hs-ifaces">{START.label.engines}</h3>
                <ul className="hs-ifaces" aria-labelledby="hs-ifaces">
                  {offered.map(id => {
                    const state = engineStateOf(current, id);
                    return (
                      <li key={id} className="hs-iface-item" data-engine={id} data-state={state}>
                        <label className="hs-iface" data-checked={ticks.includes(id) ? '' : undefined}>
                          <input type="checkbox" className="hs-check" checked={ticks.includes(id)} disabled={held} onChange={() => tick(id)} />
                          <span className="hs-iface-text"><span className="hs-iface-name">{ENGINE_NAMES[id]}</span><StateDot tone={STATE_TONE[state]}>{STATE_WORDS[state]}</StateDot></span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {!offered.some(id => engineStateOf(current, id) === 'ready') ? null : <p className="hxe-text hxe-muted" data-start-notchecked="">{START.hint.notChecked}</p>}
              </div>
              )}
              <div className="hs-field">
                <label className="hs-label" htmlFor="hs-instruction">{START.label.instruction}</label>
                <textarea id="hs-instruction" className="hs-text" rows={4} value={instruction} placeholder={START.hint.placeholder} disabled={held}
                  onChange={e => { setInstruction(e.target.value); changed(); }} aria-describedby="hs-limit" />
                <p className="hxe-text hxe-muted" id="hs-limit" data-over={instruction.length > START_INSTRUCTION_LIMIT ? '' : undefined}>{START.hint.limit}</p>
              </div>
              {why === null ? null : <p className="hs-compare" id="hs-why" role="status" data-start-why=""><HIcon name={status.kind === 'needs-install' ? 'info' : 'warning'} size={20} /><span>{why}</span></p>}
              {call.busy === null ? null : <p className="hxe-busy" role="status"><span className="hxe-busy-dot" aria-hidden="true" />{call.busy}</p>}
              {shown === null ? null : (
                <section className="hxe-section hs-results" aria-labelledby="hs-results" data-start-results="">
                  <h3 className="hxe-head" id="hs-results" tabIndex={-1} ref={results}>{START.label.commands}</h3>
                  <p className="hxe-text" data-start-norun="">{START.paragraph.noRun}</p>
                  {shown.map(view => (
                    <div key={view.engine} className="hxe-engine hs-result" data-command-for={view.engine}>
                      <p className="hxe-engine-head"><span>{view.engineName}</span>
                        <HButton size="small" icon="copy" aria-label={copyName(view.engine)} aria-disabled={call.writing ? true : undefined} data-copy={view.engine} onClick={() => copy(view.engine)}>{START.label.copy}</HButton>
                      </p>
                      <CodeText text={view.command} label={commandFor(view.engine)} />
                      {copied === view.engine ? <p className="hxe-text hs-copied" aria-hidden="true" data-copied="">{START.hint.copiedLine}</p> : null}
                    </div>
                  ))}
                  {shown.some(v => v.differs) ? <p className="hxe-text hxe-muted" data-start-differs="">{START.paragraph.differs}</p> : null}
                </section>
              )}
              <p className="hm-sr" role="status" aria-live="polite" data-copy-live="">{copied === null ? '' : `${START.label.copied}: ${commandFor(copied)}. ${START.hint.copiedLine}`}</p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
