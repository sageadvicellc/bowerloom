/**
 * The line that connects a card to the agent it was just added to. It draws itself with the map's wire-draw timing (240 ms, eased out), stays about a
 * second, and fades. It is the only new motion of the Add drawer. When the person asked for less motion nothing is drawn and the plain "Added" note
 * says the same thing. It never takes a pointer event and a screen reader skips it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { LINE_HOLD_MS, connectPath } from '../../../shared/home/add-line.js';
import { MOTION, prefersReducedMotion } from '../../motion-tokens.js';
import { dropTargetFor } from './dom-helpers.js';

interface LineView { readonly key: number; readonly d: string; readonly end: { x: number; y: number }; readonly leaving: boolean }

const boxOf = (el: Element): { x: number; y: number; w: number; h: number } => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
/** True when the element takes room on the page. An element that is hidden has no box, and a line to it would end in the corner of the window. */
const shown = (el: Element): boolean => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
/** How many frames to wait for an agent card that is not on the page yet (a newly added agent). */
const WAIT_FRAMES = 12;

/**
 * `host` names the element the wire is drawn in. It must not sit inside the drawer: a slide animation makes the drawer the containing block of
 * anything fixed inside it, and the wire would be drawn relative to the drawer instead of the window. The page root (`[data-home]`) is the host.
 */
export function useConnectLine(host: () => Element | null): { show(from: Element | null, agentId: string): void; view: ReactElement | null } {
  const [line, setLine] = useState<LineView | null>(null);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const counter = useRef(0);
  const clear = useCallback((): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; if (frame.current !== 0) cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  useEffect(() => clear, [clear]);

  const show = useCallback((from: Element | null, agentId: string): void => {
    clear();
    if (prefersReducedMotion() || from === null) { setLine(null); return; }
    const draw = (left: number): void => {
      frame.current = 0;
      const target = dropTargetFor(agentId);
      if (target === null || !from.isConnected) { if (left > 0) frame.current = requestAnimationFrame(() => draw(left - 1)); return; }
      // An end that is hidden has no box, and a line to it would end in the corner of the window.
      if (!shown(from) || !shown(target)) return;
      const path = connectPath(boxOf(from), boxOf(target));
      counter.current += 1;
      setLine({ key: counter.current, d: path.d, end: path.end, leaving: false });
      const wire = MOTION.map.edgeDraw.ms, fade = MOTION.map.nodeExit.ms;
      timers.current.push(window.setTimeout(() => setLine(l => (l === null ? l : { ...l, leaving: true })), wire + LINE_HOLD_MS));
      timers.current.push(window.setTimeout(() => setLine(null), wire + LINE_HOLD_MS + fade + MOTION.map.exitGrace));
    };
    // One frame later, so the rows have settled after the change (a closed picker moves the rows under it) and a new agent card is on the page.
    frame.current = requestAnimationFrame(() => draw(WAIT_FRAMES));
  }, [clear]);

  const hostEl = line === null ? null : host();
  const view = line === null || hostEl === null ? null : createPortal(
    <svg className="add-link" key={line.key} data-leaving={line.leaving ? '' : undefined} aria-hidden="true" focusable="false" width="100%" height="100%">
      <path className="add-link-path" d={line.d} pathLength={1} />
      <circle className="add-link-end" cx={line.end.x} cy={line.end.y} r={5} />
    </svg>,
    hostEl,
  );
  return { show, view };
}
