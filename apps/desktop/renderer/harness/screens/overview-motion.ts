/**
 * The one seam of the Overview's movement (beta.2). Everything in the grid that glides asks this module to do it, and nothing else in the Overview moves a tile.
 * Today a glide is a soft ease on the Web Animations API, with the time and the ease of the app's own layout move (motion-tokens.ts). A physics engine can replace it later by
 * calling `setOverviewMotion` with its own `OverviewMotion`; no other file changes. Beta.2 adds no engine and no dependency.
 *
 * Under "reduce motion" nothing moves: the tile is already in its new place.
 */
import { MOTION, prefersReducedMotion } from '../../motion-tokens.js';

/** A box on the page, in pixels. */
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** How far a tile has to travel to reach where it is now, seen from where it is now: the offset back to where it was. */
export interface GlideMove { readonly dx: number; readonly dy: number }

/** What the grid needs from a movement engine. */
export interface OverviewMotion {
  /** Moves `el` from `move` away to where it rests, softly. Returns nothing; a new glide on the same element replaces the old one. */
  glide(el: HTMLElement, move: GlideMove): void;
}

/** A move smaller than this, in pixels, is not worth a glide. */
const MIN_MOVE = 1;

/** The two keyframes of a glide: the old offset, then none. */
export const glideKeyframes = (move: GlideMove): Keyframe[] => [{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: 'translate(0px, 0px)' }];

/** The tiles that moved by a pixel or more between two reads, by key. A tile with no old box (new) or no new box (gone) is left out. */
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

const running = new WeakMap<object, { cancel(): void }>();

/** The soft default: the app's layout-move time and ease. Nothing under reduced motion; nothing on an element that cannot animate. */
export const softMotion: OverviewMotion = {
  glide(el, move) {
    if (prefersReducedMotion() || typeof el.animate !== 'function') return;
    if (Math.abs(move.dx) < MIN_MOVE && Math.abs(move.dy) < MIN_MOVE) return;
    running.get(el)?.cancel();
    running.set(el, el.animate(glideKeyframes(move), { duration: MOTION.map.layoutMove.ms, easing: MOTION.map.layoutMove.ease, fill: 'none' }));
  },
};

let current: OverviewMotion = softMotion;
/** The engine the grid uses now. */
export const overviewMotion = (): OverviewMotion => current;
/** Swaps the engine. The next glide uses it. */
export function setOverviewMotion(next: OverviewMotion): void { current = next; }
