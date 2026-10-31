/**
 * Keeps a small layer in the page for the length of its exit, so it can fade out instead of vanishing. A layer that is open is shown at once. When it closes it stays
 * `leaving` for the overlay's exit time (100 ms) and then goes. With reduce motion the exit time is 0, and it goes in the same pass. Two small hooks: one for a layer
 * that is either there or not (`usePresence`), one for a layer that is made from a value that goes away with it (`useLeaving`).
 */
import { useEffect, useState } from 'react';
import { MOTION, ms } from '../../motion-tokens.js';

export interface Presence { /** True from the moment the layer opens until its exit has ended. */ readonly mounted: boolean; /** True while it fades out. */ readonly leaving: boolean }

/** The exit time right now: 0 when the person asked for less motion. */
const exitMs = (): number => ms(MOTION.home.overlay.out.ms);

export function usePresence(open: boolean): Presence {
  const [kept, setKept] = useState(open);
  useEffect(() => {
    if (open) { setKept(true); return undefined; }
    const wait = exitMs();
    if (wait === 0) { setKept(false); return undefined; }
    const timer = window.setTimeout(() => setKept(false), wait);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (open) return { mounted: true, leaving: false };
  const holds = kept && exitMs() > 0;
  return { mounted: holds, leaving: holds };
}

/** The value of a layer that goes away with it (the item a dialog is about), held for the exit. `value` is null while the layer is closed. */
export function useLeaving<T>(value: T | null): { readonly value: T | null; readonly leaving: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setKept(value); return undefined; }
    const wait = exitMs();
    if (wait === 0) { setKept(null); return undefined; }
    const timer = window.setTimeout(() => setKept(null), wait);
    return () => window.clearTimeout(timer);
  }, [value]);
  if (value !== null) return { value, leaving: false };
  const holds = exitMs() > 0 ? kept : null;
  return { value: holds, leaving: holds !== null };
}
