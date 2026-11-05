/** The header's progress: 0 at the top of the page, 1 once the page has scrolled the compact distance, and the scroll position in between. It has no memory, so the same scroll gives the same value going down or up. */
export function headerProgress(scrollY: number, distance: number): number {
  if (Number.isNaN(scrollY) || Number.isNaN(distance)) return 0;
  if (distance <= 0) return 1;
  return Math.min(1, Math.max(0, scrollY / distance));
}

type Listener = (event?: Event) => void;
export interface ProgressWindow {
  readonly scrollY: number;
  addEventListener(type: 'scroll' | 'resize', listener: Listener, options?: { passive: boolean }): void;
  removeEventListener(type: 'scroll' | 'resize', listener: Listener): void;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

/**
 * Writes the header progress through `write` once now, once on resize, and once per animation frame after a scroll. The scroll listener is passive and only asks for a frame,
 * so many scroll events in one frame cost one read. `distance` returns how far the page scrolls before the bar is compact. Returns the function that stops watching.
 */
export function watchHeaderProgress(options: { win: ProgressWindow; distance: () => number; write: (progress: number) => void }): () => void {
  const { win, distance, write } = options;
  let last = Number.NaN;
  let frame: number | null = null;
  const update = () => {
    frame = null;
    const next = headerProgress(win.scrollY, distance());
    if (next === last) return;
    last = next;
    write(next);
  };
  const onScroll: Listener = () => { if (frame === null) frame = win.requestAnimationFrame(update); };
  const onResize: Listener = () => update();
  update();
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize);
  return () => {
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('resize', onResize);
    if (frame !== null) win.cancelAnimationFrame(frame);
  };
}

/**
 * The compact distance for the page: the full header height minus the compact strip, both read from the style sheet. At that distance the photo's top edge, which
 * scrolls up with the page, reaches the bottom of the strip, so the edge never passes under a bar that is still see-through.
 */
export function compactDistance(root: HTMLElement, shell: HTMLElement): number {
  const strip = Number.parseFloat(getComputedStyle(root).getPropertyValue('--header-compact-h'));
  return shell.offsetHeight - (Number.isNaN(strip) ? 0 : strip);
}
