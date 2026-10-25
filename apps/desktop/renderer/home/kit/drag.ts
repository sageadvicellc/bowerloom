/**
 * A drag with the pointer, as a small pure state machine plus one hook. A press on a card, then a move of at least 6 pixels, then a release over a
 * target. A press and release without that move is a click, and the card's own click runs. Escape cancels. Every drag has a keyboard way on the
 * screen that uses it (a later wave), so a person without a pointer loses nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** How far the pointer must move, in pixels, before a press becomes a drag. */
export const DRAG_START = 6;

export interface DragModel { readonly phase: 'idle' | 'pressed' | 'dragging'; readonly id: string; readonly label: string; readonly startX: number; readonly startY: number; readonly x: number; readonly y: number; readonly over: string | null }

export const idleDrag: DragModel = Object.freeze({ phase: 'idle', id: '', label: '', startX: 0, startY: 0, x: 0, y: 0, over: null });

export const dragPress = (id: string, label: string, x: number, y: number): DragModel => ({ phase: 'pressed', id, label, startX: x, startY: y, x, y, over: null });

/** The pointer moved to (x, y), over `over` (a target name, or null). */
export function dragMove(m: DragModel, x: number, y: number, over: string | null): DragModel {
  if (m.phase === 'idle') return m;
  if (m.phase === 'pressed' && Math.hypot(x - m.startX, y - m.startY) < DRAG_START) return m;
  return { ...m, phase: 'dragging', x, y, over };
}

export interface DragRelease { readonly model: DragModel; readonly drop: { readonly id: string; readonly target: string } | null; readonly missed: boolean; readonly wasDrag: boolean }

/** The pointer was let go over `target`. */
export function dragRelease(m: DragModel, target: string | null): DragRelease {
  const wasDrag = m.phase === 'dragging';
  return { model: idleDrag, drop: wasDrag && target !== null ? { id: m.id, target } : null, missed: wasDrag && target === null, wasDrag };
}

export const dragCancel = (_m: DragModel): DragModel => idleDrag;

/** What a drag in progress looks like to the screen. */
export interface DragView { readonly id: string; readonly label: string; readonly over: string | null }

/**
 * The hook. `start` goes on a card's pointer-down. `targetOf` turns the element under the pointer into a target name (or null). The follower is a small
 * label that moves with the pointer (see DragFollower); it is hidden from a screen reader.
 */
export function useCardDrag({ targetOf, onDrop, onMiss }: { targetOf(el: Element): string | null; onDrop(id: string, target: string): void; onMiss?(): void }): {
  drag: DragView | null; start(e: ReactPointerEvent, id: string, label: string): void; followRef(el: HTMLElement | null): void; suppressClick(): boolean;
} {
  const [view, setView] = useState<DragView | null>(null);
  const model = useRef<DragModel>(idleDrag);
  const stop = useRef<(() => void) | null>(null);
  const spot = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);
  const latest = useRef({ targetOf, onDrop, onMiss });
  latest.current = { targetOf, onDrop, onMiss };

  const finish = useCallback((): void => { stop.current?.(); stop.current = null; model.current = idleDrag; setView(null); }, []);
  useEffect(() => () => { stop.current?.(); }, []);

  const start = useCallback((e: ReactPointerEvent, id: string, label: string): void => {
    if (e.button !== 0 || !e.isPrimary || model.current.phase !== 'idle') return;
    if (e.target instanceof Element && e.target.closest('[data-no-drag]') !== null) return;
    model.current = dragPress(id, label, e.clientX, e.clientY);
    dragged.current = false;
    const under = (ev: PointerEvent): string | null => { const el = document.elementFromPoint(ev.clientX, ev.clientY); return el === null ? null : latest.current.targetOf(el); };
    const move = (ev: PointerEvent): void => {
      const next = dragMove(model.current, ev.clientX, ev.clientY, model.current.phase === 'idle' ? null : under(ev));
      if (next === model.current) return;
      model.current = next; spot.current = { x: ev.clientX, y: ev.clientY };
      window.getSelection()?.removeAllRanges();
      setView(prev => (prev !== null && prev.over === next.over ? prev : { id: next.id, label: next.label, over: next.over }));
      const g = document.querySelector<HTMLElement>('[data-follow]');
      if (g !== null) g.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
    };
    const up = (ev: PointerEvent): void => {
      const released = dragRelease(model.current, model.current.phase === 'dragging' ? under(ev) : null);
      dragged.current = released.wasDrag;
      finish();
      if (released.drop !== null) latest.current.onDrop(released.drop.id, released.drop.target);
      else if (released.missed) latest.current.onMiss?.();
    };
    const key = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { model.current = dragCancel(model.current); finish(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', finish); window.addEventListener('keydown', key);
    stop.current = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', key); };
  }, [finish]);

  const followRef = useCallback((el: HTMLElement | null): void => { if (el !== null) el.style.transform = `translate(${spot.current.x + 14}px, ${spot.current.y + 14}px)`; }, []);
  /** True once, right after a drag ended: the click that follows a drag must not select the card. */
  const suppressClick = useCallback((): boolean => { const was = dragged.current; dragged.current = false; return was; }, []);
  return { drag: view, start, followRef, suppressClick };
}
