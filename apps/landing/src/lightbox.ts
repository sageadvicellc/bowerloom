/**
 * Where Tab should go inside the lightbox. A native modal dialog keeps the rest of the page inert, but Tab can still leave through the browser's own controls.
 * This returns the control to focus when Tab would run off an end, and `null` when the browser should move the focus as it normally does.
 */
export function tabTarget<T>(focusables: readonly T[], active: T | null, backwards: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0] as T, last = focusables[focusables.length - 1] as T;
  const index = active === null ? -1 : focusables.indexOf(active);
  if (index === -1) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}

/** A click closes the lightbox only when the press began on the backdrop and the click ended on it. A drag that began inside never closes it. */
export function closesOnBackdrop(pressBeganOnBackdrop: boolean, target: unknown, dialog: unknown): boolean {
  return pressBeganOnBackdrop && target === dialog;
}
