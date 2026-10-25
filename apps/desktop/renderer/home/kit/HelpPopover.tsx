/**
 * A button that opens a small popover with one sentence. This is where a technical term may be explained (the text is marked `data-budget="popover"`).
 * Escape or a click elsewhere closes it, and the focus stays on the button. An optional action sits under the sentence, such as "Show me around".
 * The button is a round "?" by default. With `pill` it is a small pill with those words and an info mark (the "Preview" mark of the top bar), so one control
 * both says what it is and explains itself, and a window never carries two question marks for the same thing.
 * The popover fades in with a 4 px rise and fades out faster than it came (the overlay tokens); under reduce motion it comes and goes at once.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from './Button.js';
import { KitIcon } from './icons.js';
import { usePresence } from './presence.js';

export interface HelpPopoverProps {
  /** What the button is called, for a screen reader. At most 5 words. */
  label: string;
  /** The one sentence. */
  text: string;
  action?: { label: string; onAction(): void };
  defaultOpen?: boolean;
  /** The tour finds the button by this id. */
  dataTour?: string;
  /** Which way the popover opens from the button. */
  align?: 'start' | 'end';
  size?: 'normal' | 'small';
  /** The words of a pill button (at most 5). Without them the button is a round "?". */
  pill?: string;
}

export function HelpPopover({ label, text, action, defaultOpen = false, dataTour, align = 'start', size = 'normal', pill }: HelpPopoverProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
  // The popover stays in the page for the length of its exit, so it can fade out.
  const shown = usePresence(open);
  useEffect(() => {
    if (!open) return undefined;
    // Escape closes the popover and nothing under it: it is heard first (capture phase) and marked handled, so a drawer under it stays open.
    // A key that a layer above already handled is left alone.
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); setOpen(false); trigger.current?.focus();
    };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open]);
  return (
    <span className="kit-help" ref={wrap} data-align={align}>
      {pill === undefined
        ? <Button ref={trigger} round size={size} aria-label={label} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={() => setOpen(o => !o)}>?</Button>
        : <button ref={trigger} type="button" className="kit-badge kit-pill" data-tone="info" data-no-drag="" aria-label={label} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={() => setOpen(o => !o)}><KitIcon name="info" size={16} /><span>{pill}</span></button>}
      {shown.mounted ? (
        <div className="kit-popover" id={id} role="group" aria-label={label} data-budget="popover" data-leaving={shown.leaving ? '' : undefined}>
          <p>{text}</p>
          {action === undefined ? null : <Button variant="primary" onClick={() => { setOpen(false); trigger.current?.focus(); action.onAction(); }}>{action.label}</Button>}
        </div>
      ) : null}
    </span>
  );
}
