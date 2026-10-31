/**
 * Small DOM helpers for the Add drawer and the copies dialog: the elements a Tab key may reach, a Tab that stays inside a dialog, and marking the rest of
 * the page inert while a dialog is open so a screen reader and the keyboard cannot reach behind it. No words and no style here.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that the Tab key reaches, in order, leaving out anything hidden or inert. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0 && el.closest('[inert]') === null);
}

/** Keeps a Tab or Shift+Tab inside `root`: from the last element it goes to the first, and the other way round. Returns true when it handled the key. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement): boolean {
  if (e.key !== 'Tab') return false;
  const list = focusablesIn(root);
  if (list.length === 0) { e.preventDefault(); return true; }
  const first = list[0]!, last = list[list.length - 1]!, active = document.activeElement;
  const outside = !(active instanceof HTMLElement) || !root.contains(active) || active === root;
  if (e.shiftKey && (outside || active === first)) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && (outside || active === last)) { e.preventDefault(); first.focus(); return true; }
  return false;
}

/**
 * Marks every element beside `el`, and beside each of its parents, as inert, so only the dialog can be reached. Returns the function that puts them back.
 * An element that was inert already is left alone, so closing a dialog never makes something reachable that was not.
 */
export function inertAround(el: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (let here: HTMLElement | null = el; here !== null && here.parentElement !== null; here = here.parentElement) {
    for (const sibling of here.parentElement.children) {
      if (sibling !== here && sibling instanceof HTMLElement && !sibling.hasAttribute('inert') && sibling.tagName !== 'SCRIPT') { sibling.setAttribute('inert', ''); changed.push(sibling); }
    }
  }
  return () => { for (const c of changed) c.removeAttribute('inert'); };
}

/** The attribute an agent card carries so a dragged card can be dropped on it. */
export const DROP_ATTRIBUTE = 'data-drop-agent';

/** The agent id of the drop target at or above `el`, or null. */
export function dropAgentOf(el: Element): string | null {
  const target = el.closest(`[${DROP_ATTRIBUTE}]`);
  const id = target?.getAttribute(DROP_ATTRIBUTE);
  return id === undefined || id === null || id === '' ? null : id;
}

/** The drop target element for an agent id, or null when that agent is not on the page. */
export function dropTargetFor(id: string, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${DROP_ATTRIBUTE}]`)) if (el.getAttribute(DROP_ATTRIBUTE) === id) return el;
  return null;
}
