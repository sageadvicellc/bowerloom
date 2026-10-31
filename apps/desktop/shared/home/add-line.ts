/**
 * The line that joins a card to the agent it was added to. Pure geometry: two boxes in, one curved path out. The line leaves the card on the side that
 * faces the agent and arrives on the side that faces the card, so it never crosses either one. No React, no DOM.
 */

export interface LineBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface LinePoint { readonly x: number; readonly y: number }

/** How long the line stays after it is drawn, in milliseconds. The drawing itself uses the map's wire-draw token (240 ms, eased out). */
export const LINE_HOLD_MS = 1100;

const round = (n: number): number => Math.round(n * 10) / 10;

/** The path (an SVG `d` string) from `from` to `to`, and the point where it ends. */
export function connectPath(from: LineBox, to: LineBox): { d: string; start: LinePoint; end: LinePoint } {
  const fromRight = from.x + from.w, toRight = to.x + to.w;
  let start: LinePoint, end: LinePoint, horizontal = true;
  if (toRight <= from.x) { start = { x: from.x, y: from.y + from.h / 2 }; end = { x: toRight, y: to.y + to.h / 2 }; }
  else if (to.x >= fromRight) { start = { x: fromRight, y: from.y + from.h / 2 }; end = { x: to.x, y: to.y + to.h / 2 }; }
  else {
    horizontal = false;
    const above = to.y + to.h / 2 < from.y + from.h / 2;
    start = { x: from.x + from.w / 2, y: above ? from.y : from.y + from.h };
    end = { x: to.x + to.w / 2, y: above ? to.y + to.h : to.y };
  }
  const pull = Math.max(24, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) / 2);
  const dirX = Math.sign(end.x - start.x) || -1, dirY = Math.sign(end.y - start.y) || 1;
  const c1 = horizontal ? { x: start.x + dirX * pull, y: start.y } : { x: start.x, y: start.y + dirY * pull };
  const c2 = horizontal ? { x: end.x - dirX * pull, y: end.y } : { x: end.x, y: end.y - dirY * pull };
  const p = (pt: LinePoint): string => `${round(pt.x)} ${round(pt.y)}`;
  return { d: `M ${p(start)} C ${p(c1)}, ${p(c2)}, ${p(end)}`, start, end };
}
