/**
 * Where the keyboard focus goes when a layer (a drawer, a dialog, the Choose notes sheet, the tour) closes. One rule, kept in one place: a layer gives the focus back
 * only if the focus is still its own (inside it, or lost to the page), and it gives it to the first control on a list that can really take it. A layer that was
 * replaced by another one finds the focus already inside the new layer and leaves it there, so a hand-over never throws the focus up to the top of the page,
 * where the next Tab would start from the first control again. No words and no style here.
 */

/** A control inside one of these cannot take the focus: an inert part of the page, a layer that is fading out, a drawer that is sliding out. */
const OUT_OF_REACH = '[inert], [data-leaving], [data-phase="closing"]';

/** True when `el` is on the page, drawn, and not inside a layer that is inert or on its way out. */
export function reachable(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.closest(OUT_OF_REACH) === null && el.getClientRects().length > 0;
}

/** True when the focus has been lost to the page (the next Tab would start at the top), or is inside `layer`, which is about to give it back. */
export function focusIsLost(layer: Element | null | undefined = null): boolean {
  const at = document.activeElement;
  return at === null || at === document.body || at === document.documentElement || (layer !== null && layer !== undefined && layer.contains(at));
}

/** The heading of the main window: the last stable place for the focus. In the shell it is the title in the top row of the middle column; a screen with a main place of its own has it there. */
export function mainHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.hm-topbar h1, main h1');
}

/** Puts the focus on the first control of the list that can take it, and returns it, or null when none can. */
export function focusFirst(list: readonly (HTMLElement | null | undefined)[]): HTMLElement | null {
  for (const el of list) {
    if (!reachable(el)) continue;
    el.focus();
    if (document.activeElement === el) return el;
  }
  return null;
}

/**
 * A layer is closing. If the focus is still the layer's (inside `layer`, or lost to the page), it goes to the first of `candidates` that can take it (the control that
 * opened the layer first), else to the main heading. If the focus is somewhere else, because another layer took it, it stays there.
 */
export function giveBackFocus(layer: Element | null | undefined, candidates: readonly (HTMLElement | null | undefined)[]): void {
  if (!focusIsLost(layer)) return;
  focusFirst([...candidates, mainHeading()]);
}

/** The control that has the focus now, if it is a real control and not the page itself. */
export function currentControl(): HTMLElement | null {
  const at = document.activeElement;
  return at instanceof HTMLElement && at !== document.body && at !== document.documentElement ? at : null;
}
