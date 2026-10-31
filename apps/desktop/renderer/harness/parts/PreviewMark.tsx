/**
 * The "Preview" mark at the foot of the navigation: plain words and a dot. On the sample it says "Preview" and that this is sample data and nothing is written to the disk. On the person's own folders it says "Beta", that Bowerloom reads
 * their folders and writes only after they approve, and lists what is not in beta.1. Escape or a press elsewhere closes it and the focus stays on the mark.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { usePresence } from '../../home/kit/presence.js';
import { Tooltip } from '../../home/kit/Tooltip.js';
import { useHarnessState } from '../session.js';
import { REAL } from '../real/words-real.js';
import { WORDS } from '../words.js';

export function PreviewMark({ rail }: { rail: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  // On the person's own folders the state holds what the reader said; the sample (and the sample opened from real mode) holds nothing there.
  const real = useHarnessState().real !== undefined;
  const id = useId();
  // On the person's own folders the app is a beta. Only the sample is a preview.
  const markName = real ? REAL.label.beta : WORDS.label.preview, aboutName = real ? REAL.label.aboutBeta : WORDS.label.aboutPreview;
  const wrap = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const shown = usePresence(open);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); setOpen(false); trigger.current?.focus();
    };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open]);
  return (
    <span className="kit-help hx-preview" ref={wrap} data-place="above">
      <Tooltip text={markName} side="right" off={!rail}>
        {aria => (
          <button ref={trigger} type="button" className="kit-status kit-help-text" data-tone="info" data-no-drag="" data-preview-mark="" aria-label={aboutName} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} {...aria}>
            <span className="kit-dot" aria-hidden="true" /><span>{markName}</span>
          </button>
        )}
      </Tooltip>
      {shown.mounted ? (
        <div className="kit-popover hx-preview-pop" id={id} role="group" aria-label={aboutName} data-budget="popover" data-leaving={shown.leaving ? '' : undefined}>
          <p>{real ? REAL.paragraph.betaAbout : WORDS.paragraph.previewAbout}</p>
          {real ? null : <p>{WORDS.paragraph.previewFull}</p>}
          <h3 className="hx-pop-head">{real ? REAL.label.notInBeta : WORDS.label.previewNot}</h3>
          <ul className="hx-pop-list" data-real={real ? '' : undefined}>{(real ? REAL.notInBeta : WORDS.notInPreview).map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
    </span>
  );
}
