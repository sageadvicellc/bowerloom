/** How far the page scrolls, in pixels, before the header shrinks to the thin bar. */
export const COMPACT_AFTER = 48;
/** The bar grows back only when the page is closer to the top than this. The gap between the two numbers stops the bar from flickering at the boundary. */
export const EXPAND_BELOW = 16;

type Watcher = Pick<IntersectionObserver, 'observe' | 'disconnect'>;

/**
 * Two sentinels at the top of the page: `enter` is `COMPACT_AFTER` tall and `leave` is `EXPAND_BELOW` tall. The bar turns compact when `enter` scrolls out of view
 * and turns expanded again when `leave` is back in view, so between 16 px and 48 px it keeps whatever state it has. An IntersectionObserver reports both, so no code
 * runs on every scroll frame. Returns the function that stops watching.
 */
export function watchCompact(
  enter: Element,
  leave: Element,
  onChange: (compact: boolean) => void,
  make: (callback: IntersectionObserverCallback) => Watcher = callback => new IntersectionObserver(callback, { threshold: 0 }),
): () => void {
  const enterWatcher = make(entries => {
    const latest = entries[entries.length - 1];
    if (latest !== undefined && !latest.isIntersecting) onChange(true);
  });
  const leaveWatcher = make(entries => {
    const latest = entries[entries.length - 1];
    if (latest !== undefined && latest.isIntersecting) onChange(false);
  });
  enterWatcher.observe(enter);
  leaveWatcher.observe(leave);
  return () => { enterWatcher.disconnect(); leaveWatcher.disconnect(); };
}
