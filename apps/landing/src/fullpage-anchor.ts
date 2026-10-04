export const INITIAL_ANCHOR_EVENT = "bowerloom:initial-anchor";

/** The browser can resolve a URL fragment before React creates its target. */
export function scheduleInitialAnchor(
  hash: string,
  lookup: (id: string) => { scrollIntoView: (options: ScrollIntoViewOptions) => void } | null,
  frames: { request: (callback: () => void) => number; cancel: (id: number) => void },
  positioned: () => void = () => {},
) {
  let id: string;
  try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { return () => {}; }
  if (!id) return () => {};
  let pending: number | null = frames.request(() => {
    pending = null;
    const target = lookup(id);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "instant" });
      positioned();
    }
  });
  return () => {
    if (pending !== null) frames.cancel(pending);
    pending = null;
  };
}
