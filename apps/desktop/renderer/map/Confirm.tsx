/** A plain question with two answers, in the page (not a pop-up window), for things that cannot be taken back. */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

export interface Ask { text: string; yes: string; no: string; onYes(): void }

export function Confirm({ ask, onClose }: { ask: Ask; onClose(): void }): ReactElement {
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => { no.current?.focus(); }, [ask]);
  return (
    <div className="bw-confirm" role="alertdialog" aria-label="Please confirm" aria-describedby="bw-confirm-text" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <p id="bw-confirm-text">{ask.text}</p>
      <button type="button" className="bw-btn" ref={no} onClick={onClose}>{ask.no}</button>
      <button type="button" className="bw-btn primary" onClick={() => { onClose(); ask.onYes(); }}>{ask.yes}</button>
    </div>
  );
}
