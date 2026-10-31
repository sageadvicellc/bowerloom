/**
 * The "Preview" mark at the foot of the navigation: plain words and a dot. Its popover says that this is a preview on sample data (or, on the person's own folders, that it reads them, changes none and writes nothing), that nothing is written to the disk, that the full app
 * opens the interface when you press Start, and lists what is not in this preview. Escape or a press elsewhere closes it and the focus stays on the mark.
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
      <Tooltip text={WORDS.label.preview} side="right" off={!rail}>
        {aria => (
          <button ref={trigger} type="button" className="kit-status kit-help-text" data-tone="info" data-no-drag="" data-preview-mark="" aria-label={WORDS.label.aboutPreview} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} {...aria}>
            <span className="kit-dot" aria-hidden="true" /><span>{WORDS.label.preview}</span>
          </button>
        )}
      </Tooltip>
      {shown.mounted ? (
        <div className="kit-popover hx-preview-pop" id={id} role="group" aria-label={WORDS.label.aboutPreview} data-budget="popover" data-leaving={shown.leaving ? '' : undefined}>
          <p>{real ? REAL.paragraph.previewAbout : WORDS.paragraph.previewAbout}</p>
          <p>{WORDS.paragraph.previewFull}</p>
          <h3 className="hx-pop-head">{WORDS.label.previewNot}</h3>
          <ul className="hx-pop-list" data-real={real ? '' : undefined}>{(real ? REAL.notInPreview : WORDS.notInPreview).map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
    </span>
  );
}
