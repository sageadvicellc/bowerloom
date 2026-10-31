/**
 * The guided tour on screen. It dims the page, cuts a lit hole around the element marked `data-tour="<id>"`, and shows one small popover next to it
 * with one sentence, "Skip tour", a quiet "Back", "Next" ("Done" on the last step), and a compact stepper (a circle for each step; the current one is larger and says "Step 2 of 7"). "Next" is always the same button in the same place at the right
 * edge, on every step, also on the one that waits for a click: pressing it there only moves on without the click. Escape skips. The focus moves into the popover and
 * goes back to what had it when the tour ends. The popover never covers its target. A target that is not on the page leaves a centered popover and the
 * tour carries on. It follows the target when the window is resized or scrolled. All the arithmetic is in tour.ts.
 * A step that waits for the person (step 2, "Click an agent") shows its hint under the sentence, and the click (or Enter on the agent) is what moves on. The lit target is then a real hole in the layer, so
 * a real click reaches it: four blocks surround the hole and the rest of the layer lets the click through. The focus goes to the target, and Tab cycles between
 * the target and the popover's buttons.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { WORDS, stepAnnouncement } from '../words.js';
import { Button } from '../kit/Button.js';
import { Stepper } from '../kit/Stepper.js';
import { currentControl, focusFirst, mainHeading } from '../kit/focus.js';
import { currentStep, hintOf, isFirst, isLast, isWaiting, placePopover, progressText, sentenceOf, spotlightBox } from './tour.js';
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

/**
 * Where a target is on the screen: its box, cut to what its scrolling parents show. A grid that is taller than the stage it scrolls in would otherwise be
 * lit past the stage, over the bar below it.
 */
const rectOf = (el: Element): Box | null => {
  const r = el.getBoundingClientRect();
  let box: Box | null = r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  for (let parent = el.parentElement; parent !== null && box !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const q = parent.getBoundingClientRect();
    box = inside(box, { x: q.left, y: q.top, w: q.width, h: q.height });
  }
  return box;
};
/** The part of a box that is on the screen. */
function onScreen(b: Box, vw: number, vh: number): Box | null {
  const x = Math.max(0, b.x), y = Math.max(0, b.y), right = Math.min(vw, b.x + b.w), bottom = Math.min(vh, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

/** The short name of each step of the tour, for the stepper. A step with no name here is called by its number. */
const TOUR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  map: WORDS.label.tourMap, agent: WORDS.label.tourAgent, details: WORDS.label.tourDetails, add: WORDS.label.tourAdd, save: WORDS.label.tourSave, share: WORDS.label.tourShare, help: WORDS.label.tourHelp,
});
const tourLabel = (id: string): string => TOUR_LABELS[id] ?? id;

/** The narrowest the popover may be made, in pixels, to fit beside a very large target. */
const MIN_WIDTH = 256;

/** What a screen reader hears at each step. It stays on the page, so a change is spoken. */
export function TourAnnouncer({ state, picked = false }: { state: TourState; picked?: boolean }): ReactElement {
  const step = currentStep(state);
  return (
    <div className="hm-sr" role="status" aria-live="polite">
      {step === null ? null : <><span>{stepAnnouncement(state.index + 1, state.steps.length)}</span> <span>{sentenceOf(step, picked)}</span></>}
    </div>
  );
}

export interface TourOverlayProps { state: TourState; onNext(): void; onBack(): void; onSkip(): void; /** True when the tour picked an agent for the person: the step that shows it says so. */ picked?: boolean }

export function TourOverlay({ state, onNext, onBack, onSkip, picked = false }: TourOverlayProps): ReactElement | null {
  const step = currentStep(state);
  const layer = useRef<HTMLDivElement>(null), spot = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const edges = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  const waiting = isWaiting(state);
  const hint = hintOf(state);
  const callbacks = useRef({ onSkip });
  callbacks.current = { onSkip };
  const targetId = step?.target ?? null;
  const avoidSel = step?.avoid ?? null;
  /** The thing the hole is cut around: the step's area while it waits (every agent is lit), else its target. */
  const litId = (waiting ? step?.area : undefined) ?? targetId;
  // What the window-level key handler and the focus guard need to know right now.
  const mode = useRef({ waiting, targetId });
  mode.current = { waiting, targetId: litId };

  // Place the spotlight and the popover now, and again whenever the window or the target moves.
  useLayoutEffect(() => {
    if (litId === null) return undefined;
    const target = findTarget(litId);
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
      // The four blocks around the hole (used only by a waiting step): above, left, right, below. With no hole the top one covers the whole screen.
      const hole: Box = lit ?? { x: 0, y: 0, w: 0, h: 0 };
      const around: Box[] = lit === null ? [{ x: 0, y: 0, w: vw, h: vh }, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }]
        : [{ x: 0, y: 0, w: vw, h: hole.y }, { x: 0, y: hole.y, w: hole.x, h: hole.h }, { x: hole.x + hole.w, y: hole.y, w: Math.max(0, vw - hole.x - hole.w), h: hole.h }, { x: 0, y: hole.y + hole.h, w: vw, h: Math.max(0, vh - hole.y - hole.h) }];
      around.forEach((b, i) => { const el = edges.current[i]; if (el) { el.style.left = `${b.x}px`; el.style.top = `${b.y}px`; el.style.width = `${b.w}px`; el.style.height = `${b.h}px`; } });
      if (lit !== null) { spotEl.style.left = `${lit.x}px`; spotEl.style.top = `${lit.y}px`; spotEl.style.width = `${lit.w}px`; spotEl.style.height = `${lit.h}px`; }
      popEl.style.width = '';
      // Things the card must also keep off (the agent that is picked, at the step that describes it), as boxes cut to the screen.
      const avoid = avoidSel === null ? [] : [...document.querySelectorAll(avoidSel)].map(el => rectOf(el)).filter((b): b is Box => b !== null).map(b => onScreen(b, vw, vh)).filter((b): b is Box => b !== null);
      let at = placePopover(lit, { w: popEl.offsetWidth, h: popEl.offsetHeight }, { w: vw, h: vh }, 12, 12, MIN_WIDTH, avoid);
      if (at.w !== undefined) {
        // Narrower popover: set the width, then place again with the height it now has.
        popEl.style.width = `${at.w}px`;
        at = placePopover(lit, { w: at.w, h: popEl.offsetHeight }, { w: vw, h: vh }, 12, 12, undefined, avoid);
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
  }, [litId, avoidSel]);

  // Focus: into the popover now, back to where it was when the tour ends. Escape skips; Tab stays inside.
  useEffect(() => {
    const before = currentControl();
    next.current?.focus();
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && mode.current.waiting) { cycle(e); return; }
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      callbacks.current.onSkip();
    };
    // While a step waits, Tab visits the lit target first and then the popover's buttons, and comes round again. The page behind the dim is not reached.
    const cycle = (e: KeyboardEvent): void => {
      const target = mode.current.targetId === null ? null : findTarget(mode.current.targetId);
      // A button in a closed list of an agent card (the list is inert) cannot take the focus, so it is not a stop.
      const list = [...[...(target?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])].filter(el => el.closest('[inert]') === null), ...(pop.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (list.length === 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const at = list.findIndex(el => el === document.activeElement);
      const to = at < 0 ? 0 : (at + (e.shiftKey ? list.length - 1 : 1)) % list.length;
      list[to]!.focus();
    };
    const focusin = (e: FocusEvent): void => {
      if (pop.current === null || !(e.target instanceof Node) || pop.current.contains(e.target)) return;
      const target = mode.current.waiting && mode.current.targetId !== null ? findTarget(mode.current.targetId) : null;
      if (target !== null && target.contains(e.target)) return;
      (next.current ?? pop.current.querySelector<HTMLElement>('button'))?.focus();
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focusin);
      // Back to what had the focus. If that is gone (a drawer or a sheet the tour closed, a popover that closed), to the Help button the tour is started from, unless it
      // started by itself with nothing to go back to: then to the main heading (the last place of kit/focus.ts).
      focusFirst([before, before === null ? null : findTarget('help'), mainHeading()]);
    };
  }, []);

  // A new step: a waiting one puts the focus on the lit target, so Enter picks it; any other step keeps the focus in the popover (on Next when it was lost).
  const stepId = step?.id ?? null;
  useEffect(() => {
    if (stepId === null) return;
    const inside = pop.current !== null && document.activeElement instanceof Node && pop.current.contains(document.activeElement);
    if (waiting) {
      const target = findTarget(targetId ?? '');
      (target?.querySelector<HTMLElement>('button:not([disabled])') ?? target)?.focus({ preventScroll: true });
    } else if (!inside) next.current?.focus();
  }, [stepId, waiting, targetId]);

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
    <div className="tour-layer" ref={layer} data-first="" data-missing="" data-wait={waiting ? '' : undefined} data-tour-layer="">
      <div className="tour-block" aria-hidden="true" />
      {waiting ? [0, 1, 2, 3].map(i => <div key={i} className="tour-edge" ref={el => { edges.current[i] = el; }} aria-hidden="true" />) : null}
      <div className="tour-dim" aria-hidden="true" />
      <div className="tour-spot" ref={spot} aria-hidden="true" />
      <div className="tour-pop" ref={pop} role="dialog" aria-label={WORDS.label.tour} onKeyDown={keep}>
        <p className="tour-text">{sentenceOf(step, picked)}</p>
        {hint === null ? null : <p className="tour-hint">{hint}</p>}
        <div className="tour-meta">
          <Stepper compact steps={state.steps.map(s => tourLabel(s.id))} current={state.index} label={WORDS.label.tourSteps} currentText={progressText(state)} />
        </div>
        <div className="tour-actions">
          <span className="tour-skip"><Button onClick={onSkip}>{WORDS.label.tourSkip}</Button></span>
          {isFirst(state) ? null : <Button variant="text" onClick={onBack}>{WORDS.label.tourBack}</Button>}
          <Button variant="primary" ref={next} onClick={onNext}>{last ? WORDS.label.tourDone : WORDS.label.tourNext}</Button>
        </div>
      </div>
    </div>
  );
}
