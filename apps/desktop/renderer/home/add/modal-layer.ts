/**
 * The focus of a modal layer (the "two different copies" dialog, the Share sheet). On open: the control that has the focus is remembered as the opener, the rest of
 * the page goes inert, and the focus moves to the title. When the layer starts to leave (or goes in the same pass, with less motion) the page is reachable again at
 * once, so a layer that replaces this one can take the focus in the same pass, and the focus goes back to the opener only if it is still this layer's. When the
 * opener is gone, `fallback` names the next place (the card that owns it), then the main heading comes last.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { currentControl, giveBackFocus } from '../kit/focus.js';
import { inertAround } from './dom-helpers.js';

export function useModalLayer(dialog: RefObject<HTMLElement | null>, heading: RefObject<HTMLElement | null>, leaving: boolean, fallback?: () => HTMLElement | null): void {
  const opener = useRef<HTMLElement | null>(null), lift = useRef<(() => void) | null>(null), given = useRef(false);
  const latest = useRef(fallback);
  latest.current = fallback;
  const release = (): void => { lift.current?.(); lift.current = null; };
  const giveBack = (): void => {
    if (given.current) return;
    given.current = true;
    const layer = dialog.current;
    giveBackFocus(layer, [opener.current, latest.current?.()]);
  };

  // Open: remember the opener before anything moves the focus, make the page inert, focus the title.
  useLayoutEffect(() => {
    opener.current = currentControl();
    lift.current = dialog.current === null ? null : inertAround(dialog.current);
    heading.current?.focus();
    return release;
  }, []);
  // Leaving: the page is reachable again before any layer that replaces this one asks for the focus.
  useLayoutEffect(() => { if (leaving) release(); }, [leaving]);
  // Leaving, then gone: the focus goes back if it is still this layer's. After the new layer has taken its own, nothing moves.
  useEffect(() => { if (leaving) giveBack(); }, [leaving]);
  useEffect(() => giveBack, []);
}
