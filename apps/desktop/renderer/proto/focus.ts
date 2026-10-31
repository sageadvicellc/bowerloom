/**
 * Two small helpers that keep the keyboard from getting lost.
 *
 * `makeOthersInert(box)` makes everything on the page outside `box` inert while a dialog is open, so Tab cannot reach it and a screen reader
 * skips it. It walks from the box up to the body and marks every sibling on the way. The returned function puts each element back as it was.
 *
 * `watchFocusLoss(container, rescue)` answers one fault: the control that has the keyboard is removed from the page (a button that swaps itself
 * for a form, a Close button on a panel that goes away) and the browser leaves the keyboard on the body. When that happens inside `container`,
 * `rescue()` says where it goes instead. A click on an empty part of the container does not count: the control is still there then.
 */

/** Marks the page outside `box` inert. Elements that were already inert are left alone, and stay inert when the dialog closes. */
export function makeOthersInert(box: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  for (let node: HTMLElement | null = box; node !== null && node !== document.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (parent === null) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      touched.push(sibling);
    }
  }
  return () => { for (const el of touched) el.inert = false; };
}

/** Watches `container`. Returns the function that stops the watching. */
export function watchFocusLoss(container: HTMLElement, rescue: () => HTMLElement | null): () => void {
  let last: Element | null = null;
  const onFocusIn = (e: FocusEvent): void => { last = e.target instanceof Element ? e.target : null; };
  const check = (): void => {
    if (last === null || last.isConnected) return;
    const at = document.activeElement;
    if (at !== null && at !== document.body) return;
    last = null;
    rescue()?.focus();
  };
  const observer = new MutationObserver(check);
  container.addEventListener('focusin', onFocusIn);
  observer.observe(container, { childList: true, subtree: true });
  return () => { container.removeEventListener('focusin', onFocusIn); observer.disconnect(); };
}
