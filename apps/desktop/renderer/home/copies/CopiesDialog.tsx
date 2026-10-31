/**
 * The "two different copies" dialog. It opens from the badge on a card, shows the copies side by side with the lines that differ marked (by a mark, a
 * heavier weight and the words "Changed", never colour alone), and keeps the one the person picks through the store's own action, which also takes the
 * badge away. It is a modal dialog: the focus starts on its title and stays inside, the rest of the page cannot be reached, and Escape (or the scrim)
 * closes it and gives the focus back to what opened it. Render it at the top of the page, not inside a drawer or a card. No file path is drawn.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { copiesLookAlike, copiesOf, hasCopies, keepCopyAction, newerCopy } from '../../../shared/home/add-copies.js';
import type { CopyView } from '../../../shared/home/add-copies.js';
import { plainName } from '../../../shared/home/add-model.js';
import type { NameOf } from '../../../shared/home/add-model.js';
import { useWorldStore } from '../../common/session.js';
import { Button } from '../kit/Button.js';
import { IconButton } from '../kit/IconButton.js';
import { ADD_WORDS, copyNumber, foundIn, linesChanged, newerIs } from '../add/add-words.js';
import { trapTab } from '../add/dom-helpers.js';
import { useModalLayer } from '../add/modal-layer.js';
import '../add/add.css';
import { EditButton } from '../read-only.js';

const L = ADD_WORDS.label, H = ADD_WORDS.hint;

export interface CopiesDialogProps {
  /** The id of the item that has two or more different copies. */
  itemId: string;
  nameOf?: NameOf;
  /** True while the dialog fades out: it ignores the pointer and a key, and Escape goes on to the next layer. */
  leaving?: boolean;
  onClose(): void;
  /** Called after a copy was kept, before the dialog closes. */
  onKept?(copy: CopyView, itemName: string): void;
  /** Where the focus goes when the dialog closes and the badge that opened it is gone. Not used while the opener is still on the page. */
  restoreFocus?(): HTMLElement | null;
}

function Copy({ copy, onKeep }: { copy: CopyView; onKeep(): void }): ReactElement {
  const titleId = useId(), keepId = useId();
  return (
    <section className="add-copy" aria-labelledby={titleId} data-copy={copy.number}>
      <div className="add-copy-head">
        <h3 className="kit-heading" id={titleId}>{copyNumber(copy.number)}</h3>
        <p className="kit-hint" data-found="">{foundIn(copy.place, copy.daysAgo)}</p>
        <p className="kit-hint add-copy-count">{linesChanged(copy.changed)}</p>
      </div>
      <ol className="add-lines" aria-labelledby={titleId} tabIndex={0}>
        {copy.lines.map((line, i) => (
          <li key={i} className="add-line-row" data-changed={line.changed ? '' : undefined}>
            <span className="add-mark" aria-hidden="true">{line.changed ? '≠' : ''}</span>
            {line.changed ? <span className="hm-sr">{L.changedMark}: </span> : null}
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
      <EditButton variant="primary" icon="check" aria-labelledby={`${keepId} ${titleId}`} onClick={onKeep}><span id={keepId}>{L.keepThis}</span></EditButton>
    </section>
  );
}

export function CopiesDialog({ itemId, nameOf = plainName, leaving = false, onClose, onKept, restoreFocus }: CopiesDialogProps): ReactElement | null {
  const { state, dispatch } = useWorldStore();
  const item = state.draft.items.find(i => i.id === itemId);
  const titleId = useId(), tipId = useId(), replacedId = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ onClose, restoreFocus, leaving });
  latest.current = { onClose, restoreFocus, leaving };

  // Focus goes to the title and the rest of the page goes inert. When the dialog leaves, the page is reachable again and the focus goes back to the badge that opened it;
  // when the pick took the badge away, the caller names where the focus goes. A layer that replaces this one keeps the focus it took (see add/modal-layer.ts).
  useModalLayer(dialog, heading, leaving, () => latest.current.restoreFocus?.() ?? null);

  // Escape closes this dialog and nothing under it, wherever the focus is: a click on plain text inside the dialog leaves the focus on the page, and a key
  // handler on the dialog would never hear it. A listener on the window, in the capture phase, hears it first and stops it there.
  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || latest.current.leaving) return;
      e.preventDefault(); e.stopImmediatePropagation();
      latest.current.onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);

  if (item === undefined || !hasCopies(item)) return null;
  const copies = copiesOf(item), name = nameOf(item.name), newer = newerCopy(copies);
  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => { if (dialog.current !== null) trapTab(e, dialog.current); };
  const keep = (copy: CopyView): void => { dispatch(keepCopyAction(item.id, copy)); onKept?.(copy, name); onClose(); };

  return (
    <div className="add-scrim" data-leaving={leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div className="add-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${tipId} ${replacedId}`} data-copies={copies.length} ref={dialog} onKeyDown={key}>
        <header className="add-dialog-head">
          <div className="add-dialog-title">
            <h2 className="kit-heading" id={titleId} tabIndex={-1} ref={heading}>{L.differentCopies}</h2>
            <p className="add-dialog-name">{name}</p>
            <p className="kit-hint" id={tipId}>{copiesLookAlike(copies) ? H.copiesLookAlike : H.copiesTip}</p>
            {newer === null ? null : <p className="kit-hint" data-newer="">{newerIs(newer)}</p>}
            <p className="kit-hint" id={replacedId}>{H.copiesReplaced}</p>
          </div>
          <IconButton icon="close" label={L.close} onClick={onClose} />
        </header>
        <div className="add-copies">
          {copies.map(c => <Copy key={c.index} copy={c} onKeep={() => keep(c)} />)}
        </div>
      </div>
    </div>
  );
}
