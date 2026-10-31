/**
 * The screens that are not a list: nothing found, a call that failed, and a window with no bridge. Both say what happened in plain words and offer a way on. "Use the sample" opens the sample instead,
 * so the person can still look around the app. The reason for a failure is a short sentence made from the bridge's code (reasonWords), never a path or a stack.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { RealNotes } from '../../../shared/harness/types.js';
import { reasonWords } from '../../home/real/words.js';
import { HButton } from '../parts/controls.js';
import { ReadNotes, hasNotes } from './ReadNotes.js';
import { REAL, nothingReadLine } from './words-real.js';
import './real.css';

export function NothingFound({ nothingRead, readNotes = null, busy, onAdd, onSample, onLeave }: { nothingRead: boolean; readNotes?: RealNotes | null; busy: boolean; onAdd(): void; onSample(): void; onLeave?: (() => void) | undefined }): ReactElement {
  const add = useRef<HTMLButtonElement>(null);
  useEffect(() => { add.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="hxr-nothing" data-nothing="">
      <p className="hxf-line">{nothingRead ? nothingReadLine(readNotes) : REAL.hint.noFolders}</p>
      {nothingRead && readNotes !== null && hasNotes(readNotes) ? <ReadNotes real={readNotes} /> : null}
      {nothingRead ? <p className="hxf-line">{REAL.hint.nothingChoice}</p> : null}
      <div className="hxf-actions">
        <HButton ref={add} variant="primary" icon="folder" disabled={busy} onClick={onAdd}>{REAL.label.addFolder}</HButton>
        <HButton onClick={onSample}>{REAL.label.useSample}</HButton>
        {onLeave === undefined ? null : <HButton onClick={onLeave}>{REAL.label.notNow}</HButton>}
      </div>
    </div>
  );
}

export function ReadFailed({ code, onRetry, onSample, onLeave }: { code: string; onRetry(): void; onSample(): void; onLeave?: (() => void) | undefined }): ReactElement {
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => { retry.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="hxr-nothing" role="alert" data-error={code}>
      <p className="hxf-line">{reasonWords(code)}</p>
      <div className="hxf-actions">
        <HButton ref={retry} variant="primary" onClick={onRetry}>{REAL.label.tryAgain}</HButton>
        <HButton onClick={onSample}>{REAL.label.useSample}</HButton>
        {onLeave === undefined ? null : <HButton onClick={onLeave}>{REAL.label.notNow}</HButton>}
      </div>
    </div>
  );
}

/** A real launch whose bridge is missing or partial. It says so in plain words and offers no way on: the sample is not a stand-in for the person's own folders. */
export function NoBridge(): ReactElement {
  return (
    <div className="hxr-nothing" role="alert" data-error="NO_BRIDGE">
      <p className="hxf-line">{reasonWords('NO_BRIDGE')}</p>
    </div>
  );
}
