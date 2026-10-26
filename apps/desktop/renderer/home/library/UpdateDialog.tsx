/**
 * "What the update changes": the lines now and the lines after the update, side by side in the same view as the "two different copies" dialog (the lines that
 * differ are marked by a mark, a heavier weight and the word "Changed", never colour alone). "Use the update" stages one change; "Cancel", Escape and the scrim
 * stage nothing. The release tags are the item's own data.
 */
import { useId, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { UpdateInfo } from '../../../shared/home/library-model.js';
import { diffLines } from '../../../shared/proto/setup-diff.js';
import { Button } from '../kit/Button.js';
import { LibraryDialog } from './LibraryDialog.js';
import { LIBRARY_WORDS, changedLines } from './library-words.js';
import '../add/add.css';
import { EditButton } from '../read-only.js';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

export interface UpdateDialogProps {
  name: string;
  info: UpdateInfo;
  leaving: boolean;
  onClose(): void;
  onConfirm(): void;
  restoreFocus?(): HTMLElement | null;
}

/** One side of the view: its heading, the release tag, the count of lines that differ, and the lines. */
function Side({ title, tag, lines, changed }: { title: string; tag: string; lines: readonly { readonly text: string; readonly changed: boolean }[]; changed: number }): ReactElement {
  const titleId = useId();
  return (
    <section className="add-copy" aria-labelledby={titleId} data-side={title}>
      <div className="add-copy-head">
        <h3 className="kit-heading" id={titleId}>{title}</h3>
        <p className="kit-hint"><span data-budget="content">{tag}</span></p>
        <p className="kit-hint add-copy-count">{changedLines(changed)}</p>
      </div>
      <ol className="add-lines" aria-labelledby={titleId} tabIndex={0}>
        {lines.map((line, i) => (
          <li key={i} className="add-line-row" data-changed={line.changed ? '' : undefined}>
            <span className="add-mark" aria-hidden="true">{line.changed ? '≠' : ''}</span>
            {line.changed ? <span className="hm-sr">{L.changedMark}: </span> : null}
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function UpdateDialog({ name, info, leaving, onClose, onConfirm, restoreFocus }: UpdateDialogProps): ReactElement {
  const tipId = useId();
  const before = useMemo(() => diffLines(info.newLines.join('\n'), info.oldLines.join('\n')), [info]);
  const after = useMemo(() => diffLines(info.oldLines.join('\n'), info.newLines.join('\n')), [info]);
  return (
    <LibraryDialog title={L.updateTitle} name={name} leaving={leaving} size="wide" describedBy={tipId} onClose={onClose} dataDialog="update" {...(restoreFocus === undefined ? {} : { restoreFocus })}>
      <div className="lb-dialog-body">
        <p className="kit-hint" id={tipId}>{H.updateTip}</p>
        <div className="add-copies">
          <Side title={L.now} tag={info.from} lines={before.lines} changed={before.changed} />
          <Side title={L.afterUpdate} tag={info.to} lines={after.lines} changed={after.changed} />
        </div>
      </div>
      <div className="lb-dialog-foot">
        <Button onClick={onClose}>{L.cancel}</Button>
        <EditButton variant="primary" icon="check" onClick={onConfirm}>{L.useUpdate}</EditButton>
      </div>
    </LibraryDialog>
  );
}
