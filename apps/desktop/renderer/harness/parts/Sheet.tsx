/**
 * A sheet: a centered panel over a scrim, for a short job (install, start, fix, pick a harness). It is modal. Opening moves the focus to the title; Tab and Shift+Tab stay inside it;
 * Escape or a press on the scrim closes it and gives the focus back to the control that opened it (kit/focus.ts: only when the focus is still the sheet's, so a layer that replaced it
 * keeps the focus it took). When two sheets are open, Escape closes only the top one. It fades and rises in with the sheet motion tokens, and not at all when the person asked for less motion.
 * The body scrolls when it is taller than the window; the head and the foot stay in place.
 * While a sheet is open the page behind it is inert (and so is any sheet under the top one), so neither Tab nor a press reaches it. The Tab key of the top sheet also keeps the focus
 * inside when it was lost to the sheet's own padding or to the page, and reaches the button of a note (the toast) that is showing above the sheet.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';
import { usePresence } from '../../home/kit/presence.js';
import { currentControl, giveBackFocus } from '../../home/kit/focus.js';
import { WORDS } from '../words.js';
import { HIconButton } from './controls.js';
import { useUi } from '../ui.js';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
  /** The line at the left of the foot. */
  note?: string;
  /** The buttons at the right of the foot. */
  actions?: ReactNode;
  /** The width in pixels. The install sheet is 840, the start sheet 680. */
  width?: number;
  /** Fixes the height at about 700 px so the foot stays at the bottom while the steps change. */
  tall?: boolean;
  /** Extra content under the title, such as the steps of the install sheet. */
  head?: ReactNode;
  /** The tests and the tour find the sheet by this id. */
  dataSlot?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The sheets that are open, the last one on top. Escape and Tab belong to the top one. `scrim` is the sheet's own box in the layer. */
const stack: { readonly id: symbol; scrim(): Element | null | undefined }[] = [];

/**
 * Makes the page behind the top sheet inert: everything in the shell except the layer, and every sheet under the top one. It is done here, in the sheet's own effect, and not
 * after a render of the shell, so the page is free again before the closing sheet gives the focus back to the control that opened it.
 */
function holdPage(): void {
  const layer = document.getElementById('hx-layer'), root = layer?.parentElement;
  if (layer === null || layer === undefined || root === null || root === undefined) return;
  for (const el of root.children) if (el !== layer) el.toggleAttribute('inert', stack.length > 0);
  stack.forEach((entry, at) => entry.scrim()?.toggleAttribute('inert', at < stack.length - 1));
}

/** What Tab may reach in the top sheet: its own controls, then the button of a note that shows above it. */
const reachableControls = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(FOCUSABLE), ...document.querySelectorAll<HTMLElement>('.hx-toast-slot button')].filter(el => el.getClientRects().length > 0);

export function Sheet({ open, title, onClose, children, note, actions, width = 760, tall = false, head, dataSlot }: SheetProps): ReactElement | null {
  const titleId = useId();
  const presence = usePresence(open);
  const heading = useRef<HTMLHeadingElement>(null), panel = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null), wasOpen = useRef(false), me = useRef(Symbol('sheet'));
  const close = useRef(onClose);
  close.current = onClose;
  const { pushLayer } = useUi();
  // A sheet is drawn in the layer at the top of the shell, outside the columns: a column is a container, and a container holds a fixed box inside itself.
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setLayer(document.getElementById('hx-layer')); }, []);

  // The control that has the focus when the sheet opens is read before any effect moves the focus.
  useLayoutEffect(() => { if (open && !wasOpen.current) opener.current = currentControl(); }, [open]);
  useEffect(() => {
    if (open && !wasOpen.current) heading.current?.focus();
    if (!open && wasOpen.current) { const back = opener.current; opener.current = null; giveBackFocus(panel.current, [back]); }
    wasOpen.current = open;
  }, [open, presence.mounted]);
  /**
   * Tab and Shift+Tab stay in the sheet. They wrap at its ends. A focus that is on a part of the sheet that is not a control (the title, its padding) moves to the next or the previous control;
   * a focus that was lost to the page comes back to the first or the last control.
   */
  const keepInside = (e: KeyboardEvent): void => {
    if (panel.current === null) return;
    const items = reachableControls(panel.current);
    if (items.length === 0) { e.preventDefault(); heading.current?.focus(); return; }
    const first = items[0]!, last = items[items.length - 1]!, at = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (at !== null && items.includes(at)) {
      if (e.shiftKey ? at === first : at === last) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      return;
    }
    const near = at !== null && panel.current.contains(at)
      ? (e.shiftKey ? [...items].reverse().find(el => (at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) : items.find(el => (at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0))
      : undefined;
    e.preventDefault();
    (near ?? (e.shiftKey ? last : first)).focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const id = me.current, release = pushLayer();
    stack.push({ id, scrim: () => panel.current?.parentElement });
    holdPage();
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || stack[stack.length - 1]?.id !== id) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      else if (e.key === 'Tab') keepInside(e);
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); const at = stack.findIndex(entry => entry.id === id); if (at >= 0) stack.splice(at, 1); holdPage(); release(); };
  }, [open, pushLayer]);

  if (!presence.mounted || layer === null) return null;
  return createPortal(
    <div className="hx-scrim" data-leaving={presence.leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className="hx-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-slot={dataSlot} data-tall={tall ? '' : undefined} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        <header className="hx-sheet-head">
          <h2 className="hx-sheet-title" id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
          <HIconButton icon="close" label={WORDS.label.close} side="below-end" onClick={onClose} />
        </header>
        {head === undefined ? null : <div className="hx-sheet-sub">{head}</div>}
        <div className="hx-sheet-body">{children}</div>
        {note === undefined && actions === undefined ? null : (
          <footer className="hx-sheet-foot">
            <p className="hx-sheet-note">{note}</p>
            <div className="hx-sheet-actions">{actions}</div>
          </footer>
        )}
      </div>
    </div>,
    layer,
  );
}
