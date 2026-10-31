/**
 * How many columns the grid of agent tiles has right now. The grid is `repeat(auto-fill, var(--hm-tile-w))`, so the browser decides; this reads the answer from the
 * computed list of tracks (one size for each column) and follows the width of the grid. The page needs it to put a tray after the last tile of a row.
 */
import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** The number of tracks in a computed `grid-template-columns` ("232px 232px 232px" is 3; "none" or "" is 1). */
export function trackCount(computed: string): number {
  const tracks = computed.trim().split(/\s+/).filter(t => t !== '' && t !== 'none');
  return Math.max(1, tracks.length);
}

/** `place` names where the grid is drawn: it changes when the grid is made again (the app moved to another page and back), so the width is read again. */
export function useColumns(ref: RefObject<HTMLElement | null>, initial = 3, place?: unknown): number {
  const [columns, setColumns] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const read = (): void => { const n = trackCount(getComputedStyle(el).gridTemplateColumns); setColumns(current => (current === n ? current : n)); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, place]);
  return columns;
}

/** The tiles of one grid row, and where the tray of that row goes: after the last tile of each row (or of the list). */
export function rowOf(index: number, count: number, columns: number): { start: number; end: number; last: boolean } {
  const start = index - (index % columns), end = Math.min(count - 1, start + columns - 1);
  return { start, end, last: index === end };
}
