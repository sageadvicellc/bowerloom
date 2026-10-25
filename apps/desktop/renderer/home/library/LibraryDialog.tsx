/**
 * The shell of the Library's two dialogs (the remove question and the update view). It is a modal dialog like the "two different copies" dialog: the focus starts on
 * its title and stays inside, the rest of the page cannot be reached, Escape or a press on the scrim closes it, and the focus goes back to the button that opened it
 * (or, when that button is gone, to the place the page names). Render it at the top of the page.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react';
import { Button } from '../kit/Button.js';
import { trapTab } from '../add/dom-helpers.js';
import { useModalLayer } from '../add/modal-layer.js';
import { LIBRARY_WORDS } from './library-words.js';
import '../add/add.css';
import './library.css';

export interface LibraryDialogProps {
  title: string;
  /** The name of the thing the dialog is about, under the title. */
  name: string;
  /** True while the dialog fades out: it ignores the pointer and a key, and Escape goes on to the next layer. */
  leaving: boolean;
  /** The size: small for a question, wide for two columns. */
  size: 'small' | 'wide';
  /** The id of the line that describes the dialog, for a screen reader. */
  describedBy?: string;
  onClose(): void;
  /** Where the focus goes when the dialog closes and the button that opened it is gone. */
  restoreFocus?(): HTMLElement | null;
  children: ReactNode;
  dataDialog: string;
}

export function LibraryDialog({ title, name, leaving, size, describedBy, onClose, restoreFocus, children, dataDialog }: LibraryDialogProps): ReactElement {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ onClose, restoreFocus, leaving });
  latest.current = { onClose, restoreFocus, leaving };

  useModalLayer(dialog, heading, leaving, () => latest.current.restoreFocus?.() ?? null);

  // Escape closes this dialog and nothing under it, wherever the focus is: a window listener in the capture phase hears it first and stops it there.
  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || latest.current.leaving) return;
      e.preventDefault(); e.stopImmediatePropagation();
      latest.current.onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);

  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => { if (dialog.current !== null) trapTab(e, dialog.current); };
  return (
    <div className="add-scrim" data-leaving={leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div className={size === 'small' ? 'add-dialog lb-dialog-small' : 'add-dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} data-dialog={dataDialog} data-copies={size === 'wide' ? 2 : undefined} ref={dialog} onKeyDown={key}>
        <header className="add-dialog-head">
          <div className="add-dialog-title">
            <h2 className="kit-heading" id={titleId} tabIndex={-1} ref={heading}>{title}</h2>
            <p className="add-dialog-name">{name}</p>
          </div>
          <Button round icon="close" aria-label={LIBRARY_WORDS.label.close} onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
