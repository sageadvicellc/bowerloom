/**
 * The note at the foot of the window: a few words and one action, such as "Installed." and "Undo". It is a status, so a screen reader hears it without the focus moving.
 * The time stops while the pointer or the focus is on it, and starts again from the full time when both leave. It is drawn in the layer of the shell, with the sheets, so a note that
 * comes while a sheet is open is above the sheet and is not held back by the page behind it. The Tab key of an open sheet reaches its button too (parts/Sheet.tsx).
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../home/kit/Button.js';
import { useUi } from '../ui.js';
import type { ToastState } from '../ui.js';

/** One note. It is keyed by its id, so a new note starts with no hover and no focus. */
function Note({ toast }: { toast: ToastState }): ReactElement {
  const { hideToast, holdToast } = useUi();
  const [hover, setHover] = useState(false), [focus, setFocus] = useState(false);
  useEffect(() => { holdToast(hover || focus); }, [hover, focus, holdToast]);
  useEffect(() => () => holdToast(false), [holdToast]);
  return (
    <div className="hx-toast" data-toast="" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
      <span>{toast.text}</span>
      {toast.action === null ? null : <Button variant="text" onClick={() => { toast.action?.run(); hideToast(); }}>{toast.action.label}</Button>}
    </div>
  );
}

export function Toast(): ReactElement | null {
  const { toast } = useUi();
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setLayer(document.getElementById('hx-layer')); }, []);
  if (layer === null) return null;
  return createPortal(
    <div className="hx-toast-slot" role="status" aria-live="polite">{toast === null ? null : <Note key={toast.id} toast={toast} />}</div>,
    layer,
  );
}
