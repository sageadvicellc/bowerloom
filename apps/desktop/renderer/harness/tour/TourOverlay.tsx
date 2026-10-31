/**
 * The guided tour of the harness-first window on screen, ported from the home window's overlay (renderer/home/tour/TourOverlay.tsx). It dims the window, cuts a
 * lit hole around the element marked `data-tour="<id>"`, and shows one small card next to it with one sentence, "Skip tour", a quiet "Back", "Next" ("Done" on
 * the last step), and a compact stepper that says "Step 2 of 7". A step with no target ("What next") sits in the middle with its short list and closing line.
 *
 * It is drawn in the window's layer (`#hx-layer`), over a sheet that is open, so the sheet's inert page never holds it. Its keys are taken first (capture):
 * Escape skips the tour, and Tab stays in the card (and, while a step waits, the lit area), so the sheet's own Tab trap never pulls the focus away.
 * A step that waits (building the keeper) cuts a real hole: four blocks surround it and the rest of the layer lets the pointer through, so a drag inside the lit
 * area works. The focus goes back to what had it when the tour ends, or to the Help button. With "reduce motion" on, nothing slides.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { Button } from '../../home/kit/Button.js';
import { Stepper } from '../../home/kit/Stepper.js';
import { currentControl, focusFirst } from '../../home/kit/focus.js';
import { NOTES, TOUR_LABELS } from '../words-notes.js';
import { currentStep, isFirst, isLast, isWaiting, placePopover, progressText, spotlightBox } from './tour.js';
import type { Box, TourState } from './tour.js';
import './tour.css';

/** The element a step lights, or null. `~=` lets an element carry more than one id. */
export function findTarget(id: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-tour~="${id.replace(/[^a-z0-9_-]/gi, '')}"]`);
}

/** The part of box `a` that lies inside box `b`, or null when they do not meet. */
function inside(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}
/** Where a target is on the screen: its box, cut to what its scrolling parents show (the sheet's body scrolls). */
function rectOf(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  let box: Box | null = r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  for (let parent = el.parentElement; parent !== null && box !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const q = parent.getBoundingClientRect();
    box = inside(box, { x: q.left, y: q.top, w: q.width, h: q.height });
  }
  return box;
}

/** The narrowest the card may be made, in pixels, to fit beside a very large target. */
const MIN_WIDTH = 256;
const label = (id: string): string => TOUR_LABELS[id] ?? id;

export interface TourOverlayProps {
  state: TourState;
  /** The line under the sentence of a waiting step: what the person does next. */
  hint?: string | null;
  onNext(): void; onBack(): void; onSkip(): void;
}

/** What a screen reader hears at each step. It stays on the page, so a change is spoken. */
export function TourAnnouncer({ state }: { state: TourState }): ReactElement {
  const step = currentStep(state);
  return <div className="hm-sr" role="status" aria-live="polite">{step === null ? null : `${progressText(state)}. ${step.text}`}</div>;
}

export function TourOverlay(props: TourOverlayProps): ReactElement | null {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setLayer(document.getElementById('hx-layer')); }, []);
  const card = <TourCard {...props} />;
  return layer === null ? card : createPortal(card, layer);
}

/** The layer and the card. Exported for the markup tests, which draw it with no layer. */
export function TourCard({ state, hint = null, onNext, onBack, onSkip }: TourOverlayProps): ReactElement | null {
  const step = currentStep(state);
  const layer = useRef<HTMLDivElement>(null), spot = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const edges = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  const waiting = isWaiting(state);
  const callbacks = useRef({ onSkip });
  callbacks.current = { onSkip };
  /** The thing the hole is cut around: the step's area while it waits, else its target. */
  const litId = (waiting ? step?.area : undefined) ?? step?.target ?? null;
  const mode = useRef({ waiting, litId });
  mode.current = { waiting, litId };
  const stepId = step?.id ?? null;

  // Place the spotlight and the card now, and again whenever the window or the target moves.
  useLayoutEffect(() => {
    if (stepId === null) return undefined;
    const target = litId === null ? null : findTarget(litId);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let frame = 0;
    const place = (): void => {
      frame = 0;
      const layerEl = layer.current, spotEl = spot.current, popEl = pop.current;
      if (layerEl === null || spotEl === null || popEl === null) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const found = target !== null && target.isConnected ? rectOf(target) : null;
      const visible = found === null ? null : inside(found, { x: 0, y: 0, w: vw, h: vh });
      const lit = visible === null ? null : spotlightBox(visible, { w: vw, h: vh });
      if (lit === null) layerEl.setAttribute('data-missing', ''); else layerEl.removeAttribute('data-missing');
      const hole: Box = lit ?? { x: 0, y: 0, w: 0, h: 0 };
      const around: Box[] = lit === null ? [{ x: 0, y: 0, w: vw, h: vh }, hole, hole, hole]
        : [{ x: 0, y: 0, w: vw, h: hole.y }, { x: 0, y: hole.y, w: hole.x, h: hole.h }, { x: hole.x + hole.w, y: hole.y, w: Math.max(0, vw - hole.x - hole.w), h: hole.h }, { x: 0, y: hole.y + hole.h, w: vw, h: Math.max(0, vh - hole.y - hole.h) }];
      around.forEach((b, i) => { const el = edges.current[i]; if (el) { el.style.left = `${b.x}px`; el.style.top = `${b.y}px`; el.style.width = `${b.w}px`; el.style.height = `${b.h}px`; } });
      if (lit !== null) { spotEl.style.left = `${lit.x}px`; spotEl.style.top = `${lit.y}px`; spotEl.style.width = `${lit.w}px`; spotEl.style.height = `${lit.h}px`; }
      popEl.style.width = '';
      let at = placePopover(lit, { w: popEl.offsetWidth, h: popEl.offsetHeight }, { w: vw, h: vh }, 12, 12, MIN_WIDTH);
      if (at.w !== undefined) {
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
    if (pop.current !== null) watcher?.observe(pop.current);
    watcher?.observe(document.documentElement);
    const settled = requestAnimationFrame(() => layer.current?.removeAttribute('data-first'));
    return () => {
      window.removeEventListener('resize', soon); window.removeEventListener('scroll', soon, true);
      watcher?.disconnect(); if (frame !== 0) cancelAnimationFrame(frame); cancelAnimationFrame(settled);
    };
  }, [stepId, litId]);

  // Focus: into the card now, back to where it was when the tour ends. Escape skips; Tab stays in the card, and in the lit area while a step waits.
  useEffect(() => {
    const before = currentControl();
    next.current?.focus();
    const stops = (): HTMLElement[] => {
      const area = mode.current.waiting && mode.current.litId !== null ? findTarget(mode.current.litId) : null;
      const own = [...(area?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [draggable="true"]') ?? [])].filter(el => el.closest('[inert]') === null && el.getClientRects().length > 0);
      return [...own, ...(pop.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); callbacks.current.onSkip(); return; }
      if (e.key !== 'Tab') return;
      const list = stops();
      e.preventDefault(); e.stopImmediatePropagation();
      if (list.length === 0) return;
      const at = list.findIndex(el => el === document.activeElement);
      list[at < 0 ? 0 : (at + (e.shiftKey ? list.length - 1 : 1)) % list.length]!.focus();
    };
    const focusin = (e: FocusEvent): void => {
      if (pop.current === null || !(e.target instanceof Node) || pop.current.contains(e.target)) return;
      const area = mode.current.waiting && mode.current.litId !== null ? findTarget(mode.current.litId) : null;
      // A press in the lit area on something that takes no focus gives it to a box around the area (the sheet's body): that press is the person's, and a
      // focus moved away now would stop the drag it starts.
      if (area !== null && (area.contains(e.target) || e.target.contains(area))) return;
      (next.current ?? pop.current.querySelector<HTMLElement>('button'))?.focus();
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focusin);
      focusFirst([findTarget('help')?.querySelector<HTMLElement>('button') ?? findTarget('help'), before]);
    };
  }, []);

  // A new step that waits puts the focus on the first control of the lit area; any other step keeps the focus in the card.
  useEffect(() => {
    if (stepId === null) return;
    const inCard = pop.current !== null && document.activeElement instanceof Node && pop.current.contains(document.activeElement);
    if (waiting) {
      const area = findTarget(litId ?? '');
      (area?.querySelector<HTMLElement>('button:not([disabled])') ?? next.current)?.focus({ preventScroll: true });
    } else if (!inCard) next.current?.focus();
  }, [stepId, waiting, litId]);

  if (step === null) return null;
  const keep = (e: ReactKeyboardEvent<HTMLDivElement>): void => { if (e.key === 'Enter' && e.target === pop.current) onNext(); };
  const last = isLast(state);
  return (
    <div className="hxt-layer" ref={layer} data-first="" data-missing="" data-wait={waiting ? '' : undefined} data-tour-layer="" data-tour-step={step.id}>
      <div className="hxt-block" aria-hidden="true" />
      {waiting ? [0, 1, 2, 3].map(i => <div key={i} className="hxt-edge" ref={el => { edges.current[i] = el; }} aria-hidden="true" />) : null}
      <div className="hxt-dim" aria-hidden="true" />
      <div className="hxt-spot" ref={spot} aria-hidden="true" />
      <div className="hxt-pop" ref={pop} role="dialog" aria-label={NOTES.label.tour} data-centered={step.target === null ? '' : undefined} onKeyDown={keep}>
        <p className="hxt-text">{step.text}</p>
        {waiting && hint !== null ? <p className="hxt-hint" data-tour-hint="">{hint}</p> : null}
        {step.list === undefined ? null : <ul className="hxt-list" data-tour-list="">{step.list.map(item => <li key={item}>{item}</li>)}</ul>}
        {step.foot === undefined ? null : <p className="hxt-foot">{step.foot}</p>}
        <div className="hxt-meta">
          <Stepper compact steps={state.steps.map(s => label(s.id))} current={state.index} label={NOTES.label.tourSteps} currentText={progressText(state)} />
        </div>
        <div className="hxt-actions">
          <span className="hxt-skip"><Button onClick={onSkip}>{NOTES.label.tourSkip}</Button></span>
          {isFirst(state) ? null : <Button variant="text" onClick={onBack}>{NOTES.label.tourBack}</Button>}
          <Button variant="primary" ref={next} data-tour-next="" onClick={onNext}>{last ? NOTES.label.tourDone : NOTES.label.tourNext}</Button>
        </div>
      </div>
    </div>
  );
}
