/**
 * A tooltip for a button that has no words of its own (an icon-only button), or that is held back and says why. The button keeps its name in `aria-label`; the tooltip says
 * the same thing to a person who can see, and is wired to the button with `aria-describedby`. It opens after the pointer has rested on the button for 400 ms, and at once
 * when the keyboard lands on the button. Escape hides it (and nothing else: the key is marked handled before a drawer can hear it), and so does pressing the button, so a
 * tooltip never sits over the thing the person just opened. It is drawn at a fixed place on the window, 10 px clear of the button on the side asked for (`side`), so no
 * scrolling list or clipped row can cut it off, and it never covers its own button. It never takes the pointer, so it cannot trap the focus or the mouse. Its text is 14 px or
 * more. It fades in with a 4 px rise and out faster (the overlay tokens); with reduce motion it comes and goes at once. A touch press never opens it. It goes away when
 * anything scrolls, because its place would be stale.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { MOTION } from '../../motion-tokens.js';

/** Which side of the button the tooltip sits on. `below-end` lines its right edge up with the button's, for a button at the right edge of the window. */
export type TipSide = 'left' | 'right' | 'below' | 'below-end';

export interface TooltipProps {
  /** The words in the tooltip. They are the button's name, in as few words as will do. */
  text: string;
  /** The side of the button. Default: left, in the free room beside a button at the right of a bar. */
  side?: TipSide;
  /** The button. It must spread `aria` onto itself, so it is described by the tooltip. */
  children(aria: { readonly 'aria-describedby': string }): ReactElement;
}

/** The gap between a button and its tooltip, in pixels. */
export const TIP_GAP = 10;

/** Where the tooltip goes, as fixed-position offsets, from the button's box on the window. */
export function placeTip(box: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }, side: TipSide, view: { readonly w: number; readonly h: number }): CSSProperties {
  const middle = (box.top + box.bottom) / 2;
  switch (side) {
    case 'left': return { top: middle, right: view.w - box.left + TIP_GAP };
    case 'right': return { top: middle, left: box.right + TIP_GAP };
    case 'below': return { top: box.bottom + TIP_GAP, left: box.left };
    case 'below-end': return { top: box.bottom + TIP_GAP, right: view.w - box.right };
  }
}

export function Tooltip({ text, side = 'left', children }: TooltipProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<CSSProperties | undefined>(undefined);
  const wrap = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  // After a press or Escape the tooltip stays away until the pointer has left and come back, or the focus has left and come back.
  const dismissed = useRef(false);
  const stop = (): void => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  const show = (): void => {
    const button = wrap.current?.firstElementChild;
    if (button !== null && button !== undefined) {
      const r = button.getBoundingClientRect(), root = document.documentElement;
      setSpot(placeTip(r, side, { w: root.clientWidth, h: root.clientHeight }));
    }
    setOpen(true);
  };
  useEffect(() => stop, []);
  // Escape hides it. The key is heard first (capture phase) and marked handled, so a drawer under it stays open: one key, one layer.
  useEffect(() => {
    if (!open) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); dismissed.current = true; setOpen(false);
    };
    const away = (): void => setOpen(false);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', away, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('scroll', away, true); };
  }, [open]);
  return (
    <span
      className="kit-tip"
      ref={wrap}
      onPointerEnter={e => {
        if (e.pointerType === 'touch' || dismissed.current) return;
        stop();
        timer.current = window.setTimeout(() => { timer.current = null; show(); }, MOTION.home.tooltip.delayMs);
      }}
      onPointerLeave={() => { stop(); dismissed.current = false; setOpen(false); }}
      onFocus={e => { if (!dismissed.current && e.target.matches(':focus-visible')) { stop(); show(); } }}
      onBlur={() => { stop(); dismissed.current = false; setOpen(false); }}
      onClickCapture={() => { stop(); dismissed.current = true; setOpen(false); }}
    >
      {children({ 'aria-describedby': id })}
      <span className="kit-tip-text" role="tooltip" id={id} data-side={side === 'left' ? undefined : side} data-open={open ? '' : undefined} {...(spot !== undefined ? { style: spot } : {})}>{text}</span>
    </span>
  );
}
