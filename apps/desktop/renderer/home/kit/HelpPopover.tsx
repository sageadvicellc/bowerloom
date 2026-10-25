/**
 * A "?" button that opens a small popover with one sentence. This is where a technical term may be explained (the text is marked `data-budget="popover"`).
 * Escape or a click elsewhere closes it, and the focus stays on the button. An optional action sits under the sentence, such as "Show me around".
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from './Button.js';

export interface HelpPopoverProps {
  /** What the "?" button is called, for a screen reader. At most 5 words. */
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
}

export function HelpPopover({ label, text, action, defaultOpen = false, dataTour, align = 'start', size = 'normal' }: HelpPopoverProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
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
      <Button ref={trigger} round size={size} aria-label={label} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={() => setOpen(o => !o)}>?</Button>
      {open ? (
        <div className="kit-popover" id={id} role="group" aria-label={label} data-budget="popover">
          <p>{text}</p>
          {action === undefined ? null : <Button variant="primary" onClick={() => { setOpen(false); trigger.current?.focus(); action.onAction(); }}>{action.label}</Button>}
        </div>
      ) : null}
    </span>
  );
}
