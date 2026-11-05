/**
 * Bringing a card into a graph window through the view (shared by the Overview's graph and the Builder's graph). The stage is `overflow: hidden` and never scrolls (usePanZoom.ts puts
 * its scroll back at 0), so a card the keyboard reaches outside the window is shown by moving the view, clear of the buttons and the small map that sit above the stage.
 * Pure: no DOM.
 */
import type { View } from '../../../shared/harness/layout.js';

/** Window edges that the buttons, the small map and the legend cover, in pixels: a card is brought clear of them. */
export interface Insets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/** What the graph's own overlays cover: the zoom buttons at the right, the small map and the legend at the foot. */
export const OVERLAY_INSETS: Insets = Object.freeze({ top: 0, right: 64, bottom: 110, left: 0 });

/**
 * The view that brings a card fully into a window of `width` by `height`, with `pad` pixels to spare and clear of `insets`, moving as little as it can. The same view (the same object) when the card
 * is in already. A card larger than the window keeps its top left in view.
 */
export function revealView(view: View, rect: { x: number; y: number; w: number; h: number }, width: number, height: number, pad = 24, insets: Insets = NO_INSETS): View {
  const left = rect.x * view.k + view.x, top = rect.y * view.k + view.y, right = left + rect.w * view.k, bottom = top + rect.h * view.k;
  const room = { left: pad + insets.left, top: pad + insets.top, right: width - pad - insets.right, bottom: height - pad - insets.bottom };
  let dx = 0, dy = 0;
  if (right > room.right) dx = room.right - right;
  if (left + dx < room.left) dx = room.left - left;
  if (bottom > room.bottom) dy = room.bottom - bottom;
  if (top + dy < room.top) dy = room.top - top;
  return dx === 0 && dy === 0 ? view : { k: view.k, x: view.x + dx, y: view.y + dy };
}

