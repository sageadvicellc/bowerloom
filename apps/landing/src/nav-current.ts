/** The section anchors the navigation can mark as current, in page order. Docs and Articles are other pages, so they never appear here. */
export const navSections = ['how-it-works', 'app', 'command-line', 'install'] as const;
export type NavSection = typeof navSections[number];

/** The first section, in page order, that is in the reading band. `null` while none is (the hero, the FAQ, the footer). */
export function currentSection(inBand: Readonly<Record<string, boolean>>, order: readonly string[] = navSections): string | null {
  return order.find(id => inBand[id] === true) ?? null;
}

/**
 * Watches the section anchors and calls `onChange` with the current one. A section is current while it crosses a thin band 40% to 45% down the screen, so exactly
 * one section is current at a time and the mark does not flicker while a section scrolls past an edge. Returns the function that stops watching.
 */
export function watchSections(
  find: (id: string) => Element | null,
  onChange: (id: string | null) => void,
  make: (callback: IntersectionObserverCallback, options: IntersectionObserverInit) => Pick<IntersectionObserver, 'observe' | 'disconnect'> =
    (callback, options) => new IntersectionObserver(callback, options),
  order: readonly string[] = navSections,
): () => void {
  const inBand: Record<string, boolean> = {};
  const byElement = new Map<Element, string>();
  const observer = make(entries => {
    for (const entry of entries) {
      const id = byElement.get(entry.target);
      if (id !== undefined) inBand[id] = entry.isIntersecting;
    }
    onChange(currentSection(inBand, order));
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
  for (const id of order) {
    const element = find(id);
    if (element !== null) { byElement.set(element, id); observer.observe(element); }
  }
  return () => observer.disconnect();
}
