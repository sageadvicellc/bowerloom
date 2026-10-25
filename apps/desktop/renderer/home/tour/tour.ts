/**
 * The guided tour engine, with no React and no DOM: a small state machine (steps, index, next, back, skip, finished, replay), the once-per-session
 * switch, and the arithmetic of where the spotlight and the popover go. The overlay (TourOverlay.tsx) only reads these and draws.
 * Nothing here is kept on disk: the "has run" flag lives in memory, in one session object.
 */

/**
 * One step: what it is called, the `data-tour` id of the thing it lights, and the one sentence it says. A step with `wait` set waits for the person to do the
 * thing it points at (a click on an agent): the screen hides its Next button, shows `hint` under the sentence, and sends the "acted" action when it happens.
 * `area` names a larger thing (by its `data-tour` id) that is lit and open to clicks while the step waits, so "any agent" is true: the target is where the
 * focus goes, and the area is what the hole is cut around.
 */
export interface TourStep {
  readonly id: string; readonly target: string; readonly text: string; readonly wait?: boolean; readonly hint?: string; readonly area?: string;
  /** A CSS selector for things the card must not cover either (step three keeps off the agent that is picked, which is what its text describes). */
  readonly avoid?: string;
  /** What the step says when the tour had to pick an agent for the person (they pressed Next without clicking one): it says so, never silently. */
  readonly pickedText?: string;
}

export type TourStatus = 'idle' | 'running' | 'skipped' | 'finished';

/** The whole state of a tour. Frozen, so a caller cannot change it by accident. */
export interface TourState { readonly steps: readonly TourStep[]; readonly index: number; readonly status: TourStatus }

const make = (steps: readonly TourStep[], index: number, status: TourStatus): TourState => Object.freeze({ steps, index, status });

/** A tour that has not started. */
export const createTour = (steps: readonly TourStep[]): TourState => make(steps, 0, 'idle');

/** Starts the tour at its first step. A tour with no steps is finished at once. */
export const startTour = (t: TourState): TourState => (t.steps.length === 0 ? make(t.steps, 0, 'finished') : make(t.steps, 0, 'running'));

/** Starts again at step one, from any state (the "Show me around" button). */
export const replayTour = startTour;

export const isFirst = (t: TourState): boolean => t.index === 0;
export const isLast = (t: TourState): boolean => t.index >= t.steps.length - 1;

/** Next step, or "Done" on the last one. Only a running tour moves. */
export function stepNext(t: TourState): TourState {
  if (t.status !== 'running') return t;
  return isLast(t) ? make(t.steps, t.index, 'finished') : make(t.steps, t.index + 1, 'running');
}
/** Previous step. The first step has none. */
export function stepBack(t: TourState): TourState {
  return t.status !== 'running' || t.index === 0 ? t : make(t.steps, t.index - 1, 'running');
}
/** Ends a running tour early. */
export function skipTour(t: TourState): TourState { return t.status === 'running' ? make(t.steps, t.index, 'skipped') : t; }

/**
 * The person did what a waiting step asked for: on to the next step. A tour that is not waiting stays as it was, so an agent clicked at any other step is
 * not taken for the step's action. (The machine's own "next" still moves a waiting tour, so a caller can skip a wait; the screen only hides the button.)
 */
export const stepActed = (t: TourState): TourState => (isWaiting(t) ? stepNext(t) : t);

/** True while the step on show is one that waits for the person. */
export function isWaiting(t: TourState): boolean { return t.status === 'running' && t.steps[t.index]?.wait === true; }

/** The short line a waiting step shows under its sentence, or null. */
export function hintOf(t: TourState): string | null { return t.status === 'running' ? (t.steps[t.index]?.hint ?? null) : null; }

/** The step on show, or null when the tour is not running. */
export function currentStep(t: TourState): TourStep | null { return t.status === 'running' ? (t.steps[t.index] ?? null) : null; }

/** "Step 2 of 6": where the person is in the tour, always in words, so a long tour never feels endless. */
export const progressText = (t: TourState): string => `Step ${t.steps.length === 0 ? 0 : t.index + 1} of ${t.steps.length}`;

/** The sentence a step says: its own, or (when the tour picked an agent because the person did not) the one that says so. */
export const sentenceOf = (step: TourStep, picked: boolean): string => (picked && step.pickedText !== undefined ? step.pickedText : step.text);

/** The things a person can do to a tour. */
export type TourAction = 'start' | 'next' | 'back' | 'skip' | 'replay' | 'acted';

/** One reducer for all of them, for a React `useReducer`. */
export function tourReduce(t: TourState, action: TourAction): TourState {
  switch (action) {
    case 'start': return t.status === 'idle' ? startTour(t) : t;
    case 'replay': return replayTour(t);
    case 'next': return stepNext(t);
    case 'back': return stepBack(t);
    case 'skip': return skipTour(t);
    case 'acted': return stepActed(t);
  }
}

/** The once-per-session switch. The first caller gets true and every later caller gets false. A new session (a new page load) is a new object. */
export interface TourSession { claimAutoStart(): boolean }
export function createTourSession(): TourSession {
  let claimed = false;
  return { claimAutoStart: () => { if (claimed) return false; claimed = true; return true; } };
}
/** The session of this page. In memory only: closing or reloading the window forgets it. */
export const tourSession: TourSession = createTourSession();
/** The same switch for the closing note after the first Save: it shows once in a session. */
export const closingNoteSession: TourSession = createTourSession();

// ------------------------------------------------------------------------------------------------------------- where things go

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Size { readonly w: number; readonly h: number }
export interface Placement { readonly x: number; readonly y: number; /** Set when the popover had to be made narrower to fit beside a large target. */ readonly w?: number; readonly side: 'bottom' | 'top' | 'right' | 'left' | 'corner' | 'center' | 'overlap' }

/** True when the two boxes share some area. Edges that only touch do not count. */
export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const overlapArea = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, Math.max(low, high)));

/** The lit area: the target grown by `pad` on every side and cut to the screen. */
export function spotlightBox(target: Box, viewport: Size, pad = 6): Box {
  const x = Math.max(0, target.x - pad), y = Math.max(0, target.y - pad);
  const right = Math.min(viewport.w, target.x + target.w + pad), bottom = Math.min(viewport.h, target.y + target.h + pad);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Where the popover goes. Below the target (its left edges lined up) when there is room, else above, to the right, to the left. With boxes to `avoid` (things the card
 * must not cover but that are not the target), a place beside the target also tries the heights that clear those boxes. When the target is so large that none of those
 * fits (the map can fill the stage), a free corner of the screen, and failing that the strip beside it with a narrower popover (`minW`). With no target it is centered. It always stays inside the screen, and it covers the
 * target only when the target leaves no free place at all (then the place that covers least).
 */
export function placePopover(target: Box | null, pop: Size, viewport: Size, gap = 12, margin = 12, minW?: number, avoid: readonly Box[] = []): Placement {
  const centered: Placement = { x: Math.round((viewport.w - pop.w) / 2), y: Math.round((viewport.h - pop.h) / 2), side: 'center' };
  if (target === null) return centered;
  const maxX = viewport.w - margin - pop.w, maxY = viewport.h - margin - pop.h;
  const across = clamp(target.x, margin, maxX), down = clamp(target.y + target.h / 2 - pop.h / 2, margin, maxY);
  const candidates: Placement[] = [
    { x: across, y: target.y + target.h + gap, side: 'bottom' },
    { x: across, y: target.y - gap - pop.h, side: 'top' },
    { x: target.x + target.w + gap, y: down, side: 'right' },
    { x: target.x - gap - pop.w, y: down, side: 'left' },
  ];
  // Beside the target but higher or lower: level with its top or its bottom, or just above or below each box that is to be left uncovered.
  const heights = avoid.length === 0 ? [] : [target.y, target.y + target.h - pop.h, down, ...avoid.flatMap(a => [a.y + a.h + gap, a.y - gap - pop.h])].map(y => clamp(y, margin, maxY));
  for (const side of ['left', 'right'] as const) for (const y of heights) candidates.push({ x: side === 'left' ? target.x - gap - pop.w : target.x + target.w + gap, y, side });
  const fits = (p: Placement): boolean => {
    const box = { x: p.x, y: p.y, w: pop.w, h: pop.h };
    return p.x >= margin && p.y >= margin && p.x <= maxX && p.y <= maxY && !intersects(box, target) && !avoid.some(a => intersects(box, a));
  };
  const free = candidates.find(fits);
  if (free !== undefined) return { ...free, x: Math.round(free.x), y: Math.round(free.y) };
  // Beside the target, but narrower: the widest popover that still clears every box to avoid (the picked agent sits between the target and the edge of the screen).
  if (minW !== undefined && avoid.length > 0) {
    for (const side of ['left', 'right'] as const) for (const y of heights) {
      const edge = side === 'left' ? target.x - gap : target.x + target.w + gap;
      let low = margin, high = viewport.w - margin;
      for (const a of avoid) {
        if (!(a.y < y + pop.h && y < a.y + a.h)) continue;
        if (a.x + a.w <= edge && side === 'left') low = Math.max(low, a.x + a.w + gap);
        if (a.x >= edge && side === 'right') high = Math.min(high, a.x - gap);
      }
      const width = Math.floor(side === 'left' ? edge - low : high - edge);
      if (width >= minW && width < pop.w) {
        const x = side === 'left' ? edge - width : edge;
        return { x: Math.round(x), y: Math.round(y), w: width, side };
      }
    }
  }
  // A very large target (the map beside a side panel on a small window) leaves a strip that is too narrow for the full popover: use the strip.
  if (minW !== undefined) {
    const right = viewport.w - margin - (target.x + target.w + gap), left = target.x - gap - margin;
    if (right >= minW && right >= left) return { x: Math.round(target.x + target.w + gap), y: Math.round(down), w: Math.floor(Math.min(pop.w, right)), side: 'right' };
    if (left >= minW) return { x: Math.round(target.x - gap - Math.min(pop.w, left)), y: Math.round(down), w: Math.floor(Math.min(pop.w, left)), side: 'left' };
  }
  const corners: Placement[] = [{ x: maxX, y: maxY, side: 'corner' }, { x: margin, y: maxY, side: 'corner' }, { x: maxX, y: margin, side: 'corner' }, { x: margin, y: margin, side: 'corner' }];
  const corner = corners.find(fits);
  if (corner !== undefined) return corner;
  // Nothing is free: take the place that covers the least, kept inside the screen.
  let best: Placement = centered, least = Infinity;
  for (const c of [...candidates, ...corners, centered]) {
    const placed = { x: clamp(c.x, margin, maxX), y: clamp(c.y, margin, maxY) };
    const area = overlapArea({ ...placed, w: pop.w, h: pop.h }, target);
    if (area < least) { least = area; best = { ...placed, side: 'overlap' }; }
  }
  return { ...best, x: Math.round(best.x), y: Math.round(best.y) };
}
