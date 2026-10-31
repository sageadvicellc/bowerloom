/**
 * Puts a line of text on the clipboard, in the two ways a window can, and says whether it worked. The first is the clipboard of the page (`navigator.clipboard`); the
 * preview's window may refuse it (it grants the page no permissions), so the second is the old way: a hidden field that holds the text, selected and copied by the page's
 * own command. Neither writes to storage, and a refusal is an answer, never an error that stops the page: the caller then shows the text selected and says so.
 * The focus stays where it was.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* The page may not use the clipboard here: the next way is tried. */ }
  if (typeof document === 'undefined') return false;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.className = 'hm-sr';
  document.body.appendChild(field);
  let copied = false;
  try { field.select(); copied = document.execCommand('copy'); } catch { copied = false; }
  field.remove();
  before?.focus({ preventScroll: true });
  return copied;
}

/** Selects all the text of an element, so a person can copy it by hand when the page may not. */
export function selectText(el: Element): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}
