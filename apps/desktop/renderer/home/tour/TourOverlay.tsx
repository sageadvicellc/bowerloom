/**
 * The guided tour on screen. It dims the page, cuts a lit hole around the element marked `data-tour="<id>"`, and shows one small popover next to it
 * with one sentence, "Back", "Next" ("Done" on the last step), "Skip tour", and the step dots with "2 of 6". Escape skips. The focus moves into the popover and
 * goes back to what had it when the tour ends. The popover never covers its target. A target that is not on the page leaves a centered popover and the
 * tour carries on. It follows the target when the window is resized or scrolled. All the arithmetic is in tour.ts.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { WORDS, stepAnnouncement } from '../words.js';
import { Button } from '../kit/Button.js';
import { currentStep, isFirst, isLast, placePopover, progressText, spotlightBox } from './tour.js';
import type { Box, TourState } from './tour.js';
import './tour.css';

/** The element a step lights, or null. `~=` lets an element carry more than one id. */
export function findTarget(id: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-tour~="${id.replace(/[^a-z0-9_-]/gi, '')}"]`);
}

const rectOf = (el: Element): Box | null => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};
/** The part of a box that is on the screen. */
function onScreen(b: Box, vw: number, vh: number): Box | null {
  const x = Math.max(0, b.x), y = Math.max(0, b.y), right = Math.min(vw, b.x + b.w), bottom = Math.min(vh, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

/** The narrowest the popover may be made, in pixels, to fit beside a very large target. */
const MIN_WIDTH = 280;

/** What a screen reader hears at each step. It stays on the page, so a change is spoken. */
export function TourAnnouncer({ state }: { state: TourState }): ReactElement {
  const step = currentStep(state);
  return (
    <div className="hm-sr" role="status" aria-live="polite">
      {step === null ? null : <><span>{stepAnnouncement(state.index + 1, state.steps.length)}</span> <span>{step.text}</span></>}
    </div>
  );
}

export interface TourOverlayProps { state: TourState; onNext(): void; onBack(): void; onSkip(): void }

export function TourOverlay({ state, onNext, onBack, onSkip }: TourOverlayProps): ReactElement | null {
  const step = currentStep(state);
  const layer = useRef<HTMLDivElement>(null), spot = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onSkip });
  callbacks.current = { onSkip };
  const targetId = step?.target ?? null;

  // Place the spotlight and the popover now, and again whenever the window or the target moves.
  useLayoutEffect(() => {
    if (targetId === null) return undefined;
    const target = findTarget(targetId);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let frame = 0;
    const place = (): void => {
      frame = 0;
      const layerEl = layer.current, spotEl = spot.current, popEl = pop.current;
      if (layerEl === null || spotEl === null || popEl === null) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const found = target !== null && target.isConnected ? rectOf(target) : null;
      const visible = found === null ? null : onScreen(found, vw, vh);
      const lit = visible === null ? null : spotlightBox(visible, { w: vw, h: vh });
      if (lit === null) layerEl.setAttribute('data-missing', ''); else layerEl.removeAttribute('data-missing');
      if (lit !== null) { spotEl.style.left = `${lit.x}px`; spotEl.style.top = `${lit.y}px`; spotEl.style.width = `${lit.w}px`; spotEl.style.height = `${lit.h}px`; }
      popEl.style.width = '';
      let at = placePopover(lit, { w: popEl.offsetWidth, h: popEl.offsetHeight }, { w: vw, h: vh }, 12, 12, MIN_WIDTH);
      if (at.w !== undefined) {
        // Narrower popover: set the width, then place again with the height it now has.
        popEl.style.width = `${at.w}px`;
        at = placePopover(lit, { w: at.w, h: popEl.offsetHeight }, { w: vw, h: vh }, 12, 12);
      }
      popEl.style.left = `${at.x}px`; popEl.style.top = `${at.y}px`;
      popEl.setAttribute('data-side', at.side);
    };
    const soon = (): void => { if (frame === 0) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    if (target !== null) watcher?.observe(target);
    watcher?.observe(document.documentElement);
    // The first placement does not slide in from the corner.
    const settled = requestAnimationFrame(() => layer.current?.removeAttribute('data-first'));
    return () => {
      window.removeEventListener('resize', soon); window.removeEventListener('scroll', soon, true);
      watcher?.disconnect(); if (frame !== 0) cancelAnimationFrame(frame); cancelAnimationFrame(settled);
    };
  }, [targetId]);

  // Focus: into the popover now, back to where it was when the tour ends. Escape skips; Tab stays inside.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    next.current?.focus();
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      callbacks.current.onSkip();
    };
    const focusin = (e: FocusEvent): void => { if (pop.current !== null && e.target instanceof Node && !pop.current.contains(e.target)) next.current?.focus(); };
    window.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focusin);
      const back = before !== null && before.isConnected ? before : document.querySelector<HTMLElement>('main h1');
      back?.focus();
    };
  }, []);

  if (step === null) return null;
  const keep = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab' || pop.current === null) return;
    const buttons = [...pop.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const last = isLast(state);
  return (
    <div className="tour-layer" ref={layer} data-first="" data-missing="" data-tour-layer="">
      <div className="tour-block" aria-hidden="true" />
      <div className="tour-dim" aria-hidden="true" />
      <div className="tour-spot" ref={spot} aria-hidden="true" />
      <div className="tour-pop" ref={pop} role="dialog" aria-label={WORDS.label.tour} onKeyDown={keep}>
        <p className="tour-text">{step.text}</p>
        <div className="tour-meta">
          <span className="tour-dots" aria-hidden="true">
            {state.steps.map((s, i) => <span key={s.id} className="tour-dot" data-state={i < state.index ? 'done' : i === state.index ? 'now' : 'next'} />)}
          </span>
          <span className="kit-hint">{progressText(state)}</span>
        </div>
        <div className="tour-actions">
          <span className="tour-skip"><Button onClick={onSkip}>{WORDS.label.tourSkip}</Button></span>
          {isFirst(state) ? null : <Button onClick={onBack}>{WORDS.label.tourBack}</Button>}
          <Button variant="primary" ref={next} onClick={onNext}>{last ? WORDS.label.tourDone : WORDS.label.tourNext}</Button>
        </div>
      </div>
    </div>
  );
}
