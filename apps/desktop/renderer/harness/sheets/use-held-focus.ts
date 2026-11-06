/**
 * Keeps the focus in the sheet while Bowerloom works (U9). When a call starts, the button the person pressed may become disabled, and a disabled button
 * drops the focus to the page. The focus then moves to the sheet's named body, so a screen reader stays in the sheet and hears the busy line.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useHeldFocus(busy: boolean, body: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!busy) return undefined;
    const frame = requestAnimationFrame(() => {
      const at = document.activeElement;
      const lost = at === null || at === document.body || ((at instanceof HTMLButtonElement || at instanceof HTMLInputElement) && at.disabled);
      if (lost) body.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, body]);
}
