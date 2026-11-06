/**
 * The one seam of the Overview's movement (beta.2). Everything in the grid that glides asks this module to do it, and nothing else in the Overview moves anything.
 * Today a glide is a soft ease on the Web Animations API, with the time and the ease of the app's own tokens (motion-tokens.ts). A physics engine can replace it later by
 * calling `setOverviewMotion` with its own `OverviewMotion`; no other file changes. Beta.2 adds no engine and no dependency.
 *
 * What glides, and why:
 *  - A place opens or closes: the frames of the places below it glide to their new place, as units, so a frame and its tiles move together. Quick, with the accordion token.
 *  - The columns change (the window gets wider or narrower): the frames glide, and so do the tiles inside them whose size did not change. A tile that changed size snaps.
 *  - A press that only selects a part moves nothing.
 * Under "reduce motion" nothing moves: the element is already in its new place. A glide that throws is caught and reported once; the Overview carries on.
 */
import { MOTION, prefersReducedMotion } from '../../motion-tokens.js';
import type { Transition } from '../../motion-tokens.js';

/** A box on the page, in pixels. */
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** How far an element has to travel to reach where it is now, seen from where it is now: the offset back to where it was. */
export interface GlideMove { readonly dx: number; readonly dy: number }
/** Why an element glides: a person opened or closed a place (quick), or the columns changed (a little slower). */
export type GlideKind = 'toggle' | 'columns';

/** What the grid needs from a movement engine. */
export interface OverviewMotion {
  /** Moves `el` from `move` away to where it rests, softly. A new glide on the same element replaces the old one. */
  glide(el: HTMLElement, move: GlideMove, how: GlideKind): void;
  /** Ends any movement of `el` at once, so an engine that keeps running (a physics one) can be stopped when the Overview goes. */
  stop(el: HTMLElement): void;
}

/** A move smaller than this, in pixels, is not worth a glide. */
const MIN_MOVE = 1;

/** The time and ease of each kind of glide: a user's open or close uses the accordion token (160 ms, strong ease-out); a change of columns uses the layout move. */
const TIMING: Readonly<Record<GlideKind, Transition>> = { toggle: MOTION.home.accordion, columns: MOTION.map.layoutMove };

/** The two keyframes of a glide: the old offset, then none. */
export const glideKeyframes = (move: GlideMove): Keyframe[] => [{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: 'translate(0px, 0px)' }];

/** The elements that moved by a pixel or more between two reads, by key. One with no old box (new) or no new box (gone) is left out. */
export function movesOf(before: ReadonlyMap<string, Rect>, after: ReadonlyMap<string, Rect>): Map<string, GlideMove> {
  const moves = new Map<string, GlideMove>();
  for (const [key, now] of after) {
    const was = before.get(key);
    if (was === undefined) continue;
    const dx = was.x - now.x, dy = was.y - now.y;
    if (Math.abs(dx) >= MIN_MOVE || Math.abs(dy) >= MIN_MOVE) moves.set(key, { dx, dy });
  }
  return moves;
}

// ---- What glides after a change of the layout ---------------------------------------------------------------------------------------------------------------

/**
 * Where everything is after a layout. `frames` are the boxes of the places, from the top of the grid. `tiles` are the boxes of the tiles, from the top left of their own place, so a
 * tile's box does not change when its frame moves. Both are read without any transform (offsets), so a glide still running does not skew the read.
 */
export interface GlideSnapshot {
  readonly columns: number;
  /** The ids of the open places, in order, as one text. */
  readonly open: string;
  readonly frames: ReadonlyMap<string, Rect>;
  readonly tiles: ReadonlyMap<string, Rect>;
}
export interface GlidePlan {
  /** The places that moved, and how they glide. */
  readonly frames: ReadonlyMap<string, GlideMove>;
  readonly framesHow: GlideKind;
  /** The tiles that moved inside their place and kept their size. */
  readonly tiles: ReadonlyMap<string, GlideMove>;
}
/** A plan that moves nothing. */
export const NO_GLIDES: GlidePlan = { frames: new Map(), framesHow: 'toggle', tiles: new Map() };
const NONE = NO_GLIDES;
const sameSize = (a: Rect, b: Rect): boolean => Math.abs(a.w - b.w) < MIN_MOVE && Math.abs(a.h - b.h) < MIN_MOVE;

/**
 * What glides between two layouts. Nothing on the first layout, and nothing when neither the columns nor the open places changed (a press that selects a part, new words, a scan
 * that changed nothing in the layout). A change of the open places glides the frames, quickly. A change of columns glides the frames and the tiles that kept their size.
 */
export function glidePlanOf(before: GlideSnapshot | null, after: GlideSnapshot): GlidePlan {
  if (before === null) return NONE;
  const opened = before.open !== after.open, columns = before.columns !== after.columns;
  if (!opened && !columns) return NONE;
  const frames = movesOf(before.frames, after.frames);
  const tiles = new Map<string, GlideMove>();
  if (columns) {
    const kept = new Map<string, Rect>();
    for (const [key, now] of after.tiles) { const was = before.tiles.get(key); if (was !== undefined && sameSize(was, now)) kept.set(key, now); }
    for (const [key, move] of movesOf(before.tiles, kept)) tiles.set(key, move);
  }
  return { frames, framesHow: opened ? 'toggle' : 'columns', tiles };
}

// ---- The engines ---------------------------------------------------------------------------------------------------------------------------------------------

const running = new WeakMap<object, { cancel(): void }>();

/** The translate of a computed transform (`matrix(a, b, c, d, tx, ty)` or `matrix3d(...)`), or none. Read with no DOM class, so it also runs where there is no DOM. */
export function translateOf(transform: string | undefined): { x: number; y: number } {
  const found = /^matrix(3d)?\(([^)]*)\)$/.exec((transform ?? '').trim());
  if (found === null) return { x: 0, y: 0 };
  const n = found[2]!.split(',').map(v => Number.parseFloat(v));
  const [x, y] = found[1] === undefined ? [n[4], n[5]] : [n[12], n[13]];
  return { x: Number.isFinite(x) ? x! : 0, y: Number.isFinite(y) ? y! : 0 };
}
/** Where a glide still running has the element now, as an offset from its resting place. Nothing running, or nothing readable: no offset. */
function currentOffset(el: HTMLElement): { x: number; y: number } {
  if (!running.has(el) || typeof getComputedStyle !== 'function') return { x: 0, y: 0 };
  try { return translateOf(getComputedStyle(el).transform); } catch { return { x: 0, y: 0 }; }
}

/** The soft default. Nothing under reduced motion; nothing on an element that cannot animate. */
export const softMotion: OverviewMotion = {
  glide(el, move, how) {
    if (prefersReducedMotion() || typeof el.animate !== 'function') return;
    if (Math.abs(move.dx) < MIN_MOVE && Math.abs(move.dy) < MIN_MOVE) return;
    // A glide still running is taken over from where it is, so a second change within its time does not jump.
    const at = currentOffset(el);
    running.get(el)?.cancel();
    running.set(el, el.animate(glideKeyframes({ dx: move.dx + at.x, dy: move.dy + at.y }), { duration: TIMING[how].ms, easing: TIMING[how].ease, fill: 'none' }));
  },
  stop(el) { running.get(el)?.cancel(); running.delete(el); },
};

let current: OverviewMotion = softMotion;
/** The engine the grid uses now. */
export const overviewMotion = (): OverviewMotion => current;
/** Swaps the engine. The next glide uses it. */
export function setOverviewMotion(next: OverviewMotion): void { current = next; }

// ---- Running a plan, safely ----------------------------------------------------------------------------------------------------------------------------------

/** The steps that can fail: reading the layout, deciding the plan, a glide, and a stop. */
export type MotionStep = 'snapshot' | 'plan' | 'glide' | 'stop';
const reported = new Set<MotionStep>();
/** Forgets what was reported. For tests. */
export function resetOverviewMotionReport(): void { reported.clear(); }
/** One line on the console the first time a step fails, naming the step and only the class of the error (never a path or a message from a file). Then silence for that step. */
function report(step: MotionStep, error: unknown): void {
  if (reported.has(step)) return;
  reported.add(step);
  const name = error instanceof Error ? error.constructor.name : typeof error;
  console.error(`Overview motion failed at ${step} (${name}). The Overview goes on without it.`);
}

/** Runs one step of the movement. A failure is reported once for the step and gives `fallback`: movement is cosmetic and must never take the Overview down. */
export function guarded<T>(step: MotionStep, fallback: T, run: () => T): T {
  try { return run(); } catch (error) { report(step, error); return fallback; }
}

/**
 * Runs a plan: each element is found by `find` (`place` or `tile`, then its key) and glides. Under "reduce motion" no engine is asked to move anything, whichever engine is set.
 * A failure of one glide is reported once and never reaches the screen.
 */
export function applyGlides(plan: GlidePlan, find: (layer: 'place' | 'tile', key: string) => HTMLElement | null): void {
  if (prefersReducedMotion()) return;
  const run = (layer: 'place' | 'tile', moves: ReadonlyMap<string, GlideMove>, how: GlideKind): void => {
    for (const [key, move] of moves) guarded('glide', undefined, () => { const el = find(layer, key); if (el !== null) overviewMotion().glide(el, move, how); });
  };
  run('place', plan.frames, plan.framesHow);
  run('tile', plan.tiles, 'columns');
}

/** Ends the movement of each element, for when the Overview goes. A failure is reported once. */
export function stopGlides(elements: Iterable<HTMLElement>): void {
  for (const el of elements) guarded('stop', undefined, () => overviewMotion().stop(el));
}
