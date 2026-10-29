/**
 * The parts the adopt and install sheets share: the folder step, a section with a heading, a tick box with its full words and its item's name, a refusal in
 * plain words that takes the focus when it appears, a busy line, a block of code shown in full, a result list, and the result of a loss line as a dot and a
 * word. A tick box is used only for a choice the person can change (Hanna, 2026-10-27).
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode, Ref } from 'react';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { DriftLineView, FolderInfo, ModeChoice, PlaceView, Refusal, ResultWord } from '../../../shared/engine/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { DRIFT_TONE, DRIFT_WORDS, ENGINE_WORDS, MODE_CHOICE_WORDS, RESULT_TONE, RESULT_WORDS, engineList, modeActionName } from '../words-engine.js';
import './engine.css';

const W = ENGINE_WORDS;

/** What a folder card says under the name, and whether the person can pick it, for the sheet that asks. */
export function folderLine(folder: FolderInfo, sheet: 'make' | 'install'): { words: string; off: boolean } {
  if (sheet === 'make') {
    if (folder.unfinished.adoption) return { words: W.hint.stoppedHarness, off: false };
    return folder.hasDefinition ? { words: W.hint.holdsHarness, off: true } : { words: W.hint.noHarness, off: false };
  }
  if (!folder.hasDefinition) return { words: W.hint.noHarness, off: true };
  if (folder.problem !== null) return { words: folder.problem, off: true };
  if (folder.unfinished.projection) return { words: W.hint.stopped, off: false };
  if (folder.projected) return { words: W.hint.installedBefore, off: false };
  return { words: folder.engines.length === 0 ? W.hint.noEngines : engineList(folder.engines.map(e => ENGINE_NAMES[e])), off: false };
}

export interface FolderStepProps {
  sheet: 'make' | 'install';
  folders: readonly FolderInfo[];
  picked: string | null;
  sample: boolean;
  /** True when the window has no engine bridge: the chooser is held, and says why (U11). */
  noBridge: boolean;
  busy: boolean;
  introRef: Ref<HTMLParagraphElement>;
  onPick(id: string): void;
  onChoose(): void;
  /** Extra actions under the list, for the picked folder (Plan a removal, Plan a recovery). */
  extra?: ReactNode;
  /** The refusal of this step, drawn by the sheet. */
  children?: ReactNode;
}

/** Step one of both sheets: the folders the person chose before (or the sample's), and "Choose a folder" for the system chooser. */
export function FolderStep({ sheet, folders, picked, sample, noBridge, busy, introRef, onPick, onChoose, extra, children }: FolderStepProps): ReactElement {
  const why = useId();
  return (
    <>
      <p className="hxi-intro" tabIndex={-1} ref={introRef}>{sheet === 'make' ? W.paragraph.adoptIntro : W.paragraph.installIntro}</p>
      {/* With a refusal and no folders, the refusal says what happened; "No folder yet" would say the list is empty when it could not be read (U11). */}
      {folders.length === 0 && children !== undefined && children !== null && !noBridge ? null : <p className="hxi-intro">{noBridge ? W.hint.noBridge : sample ? W.hint.samplePick : folders.length === 0 ? W.hint.noFolders : W.hint.pickFolder}</p>}
      {folders.length === 0 ? null : (
        <ul className="hxi-list hxe-folders" aria-label={W.label.folders}>
          {folders.map(f => {
            const line = folderLine(f, sheet), on = f.id === picked;
            return (
              <li key={f.id}>
                <button type="button" className="hxi-card" aria-pressed={on} aria-disabled={line.off || busy ? true : undefined} data-off={line.off ? '' : undefined} data-folder={f.id}
                  onClick={() => { if (!line.off && !busy) onPick(f.id); }}>
                  <Tile name="folder" />
                  <span className="hxi-card-text">
                    <span className="hxi-card-name">{f.name}</span>
                    <span className="hxi-card-sub">{f.label}</span>
                    <span className="hxi-card-sub">{line.words}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sample ? null : <HButton icon="plus" disabled={busy || noBridge} aria-describedby={noBridge ? why : undefined} onClick={onChoose}>{W.label.chooseFolder}</HButton>}
      {noBridge ? <p className="hxe-text hxe-muted" id={why}>{W.hint.noBridge}</p> : null}
      {extra}
      {children}
    </>
  );
}

/** A section of a review, with its heading and an optional count. */
export function Section({ title, count, children, slot }: { title: string; count?: string; children?: ReactNode; slot: string }): ReactElement {
  const id = useId();
  return (
    <section className="hxe-section" aria-labelledby={id} data-section={slot}>
      <h3 className="hxe-head" id={id}><span>{title}</span>{count === undefined ? null : <span className="hxe-count">{count}</span>}</h3>
      {children}
    </section>
  );
}

/**
 * A tick box with the whole of what the person agrees to beside it. The words above the box are the item. The box's name is its visible words and then
 * the item (`name`), so no two boxes sound the same and the visible words are part of the name (U8).
 */
export function TickRow({ checked, name, label, onChange, children, slot, disabled = false }: { checked: boolean; name: string; label: string; onChange(on: boolean): void; children?: ReactNode; slot: string; disabled?: boolean }): ReactElement {
  const id = useId();
  return (
    <li className="hxe-tick" data-tick={slot} data-on={checked ? '' : undefined}>
      <div className="hxe-tick-body">{children}</div>
      <label className="hxe-tick-label" htmlFor={id}>
        <input id={id} type="checkbox" className="hxi-check" checked={checked} disabled={disabled} aria-label={`${label.replace(/\.$/, '')}: ${name}`} onChange={e => onChange(e.currentTarget.checked)} />
        <span>{label}</span>
      </label>
    </li>
  );
}

/**
 * A refusal of Bowerloom, in its own words: what stopped it and the paths it names. Never just "Something went wrong". When a new one appears (`focusId`
 * changes), it takes the focus and scrolls into view, so a person who pressed a button at the foot hears and sees it (U9).
 */
/**
 * The files Bowerloom wrote that changed since, each with why. A line where only the mode changed offers its two actions, Restore mode and Keep new mode
 * (decision D5A), when the sheet can plan them (`onMode`); each one plans a recovery that the person approves like any other.
 */
export function DriftLines({ lines, label, onMode, held = false }: { lines: readonly DriftLineView[]; label?: string; onMode?: ((path: string, choice: ModeChoice) => void) | undefined; held?: boolean }): ReactElement {
  return (
    <ul className="hxe-paths" aria-label={label}>
      {lines.map(d => (
        <li key={d.path} className="hxe-drift-line" data-drift-line={d.path} data-reason={d.reason}>
          <span><StateDot tone={DRIFT_TONE[d.reason]}>{DRIFT_WORDS[d.reason]}</StateDot> <span className="hxe-mono">{d.path}</span></span>
          {d.reason !== 'mode' || onMode === undefined ? null : (
            <span className="hxe-line-actions">
              {(['restoreMode', 'recordMode'] as const).map(choice => (
                <HButton key={choice} size="small" disabled={held} aria-label={modeActionName(choice, d.path)} data-mode-action={choice} onClick={() => onMode(d.path, choice)}>{MODE_CHOICE_WORDS[choice]}</HButton>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RefusalNote({ refusal, focusId = 0, children, onMode }: { refusal: Refusal; focusId?: number; children?: ReactNode; onMode?: ((path: string, choice: ModeChoice) => void) | undefined }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusId === 0 || box.current === null) return;
    box.current.focus({ preventScroll: true });
    box.current.scrollIntoView({ block: 'nearest' });
  }, [focusId]);
  return (
    <div ref={box} className="hxe-refusal" role="alert" tabIndex={-1} data-refusal={refusal.code}>
      <p className="hxe-refusal-title"><StateDot tone="bad">{W.label.refusal}</StateDot><span className="hxe-code">{refusal.code}</span></p>
      <p className="hxe-text">{refusal.message}</p>
      {refusal.paths.length === 0 ? null : <ul className="hxe-paths">{refusal.paths.map(p => <li key={p} className="hxe-mono">{p}</li>)}</ul>}
      {refusal.drift === undefined || refusal.drift.length === 0 ? null : <DriftLines lines={refusal.drift} label={W.label.driftLines} onMode={onMode} />}
      {children === undefined || children === null ? null : <div className="hxe-actions">{children}</div>}
    </div>
  );
}

/** A line that says the sheet is waiting on Bowerloom. A screen reader hears it once. */
export function Busy({ words }: { words: string }): ReactElement {
  return <p className="hxe-busy" role="status"><span className="hxe-busy-dot" aria-hidden="true" />{words}</p>;
}

/** A command or a file of code, in full, with its own scroll. Never cut. */
export function CodeText({ text, label }: { text: string; label: string }): ReactElement {
  return <pre className="hxe-code-block" role="region" tabIndex={0} aria-label={label}>{text}</pre>;
}

export function ResultDot({ result }: { result: ResultWord }): ReactElement {
  return <StateDot tone={RESULT_TONE[result]} className="hxe-result">{RESULT_WORDS[result]}</StateDot>;
}

/** Where an item was found: the path and pointer, the interfaces that read it, and the file form it was read as (U6). */
export function Places({ places }: { places: readonly PlaceView[] }): ReactElement {
  const where = (p: PlaceView): string => (p.pointer === null ? p.path : `${p.path}#${p.pointer}`);
  return (
    <ul className="hxe-places" aria-label={W.label.foundIn}>
      {places.map(p => (
        <li key={where(p)}>
          <span className="hxe-mono">{where(p)}</span> <span className="hxe-muted">{engineList(p.engines.map(e => ENGINE_NAMES[e]))} · {W.label.shape} {p.shape}{p.shapeVersion === null ? '' : ` ${p.shapeVersion}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** The result of a write, a removal or a recovery: each list of files with its heading, and plain words when nothing changed (U5). */
export function ResultStep({ lists, nothing, warnings = [], children }: { lists: readonly { title: string; files: readonly string[]; note?: string }[]; nothing: boolean; warnings?: readonly string[]; children?: ReactNode }): ReactElement {
  const shown = lists.filter(l => l.files.length > 0);
  return (
    <div data-done="">
      <p className="hxi-sum">{nothing || shown.length === 0 ? W.hint.nothingChanged : W.paragraph.resultIntro}</p>
      {shown.map(l => (
        <Section key={l.title} title={l.title} count={String(l.files.length)} slot={`result-${l.title}`}>
          {l.note === undefined ? null : <p className="hxe-text hxe-muted">{l.note}</p>}
          <ul className="hxi-files">{l.files.map(f => <li key={f} className="hxi-file"><span className="hxi-file-path">{f}</span></li>)}</ul>
        </Section>
      ))}
      {warnings.map(w => <p key={w} className="hxe-text" role="status" data-warning="">{w}</p>)}
      {children}
    </div>
  );
}
