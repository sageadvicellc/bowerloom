/**
 * The live preview: how many notes the agent will read out of all of them, a plain bar, one plain label for how big the choice is (a small, medium or big set), the choice in plain
 * words, and the first eight note titles with "Show more". It only shows. Nothing here changes the choice.
 */
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { Preview } from '../../../shared/home/notes-model.js';
import { Button } from '../kit/Button.js';
import { NOTES_WORDS, READ_LEAD, ofTotal, sizeLine } from './notes-words.js';
import { IconButton } from '../kit/IconButton.js';

const L = NOTES_WORDS.label, H = NOTES_WORDS.hint;
/** How many titles show before "Show more". */
export const FIRST_TITLES = 8;

export function PreviewPanel({ preview, lines }: { preview: Preview; lines: readonly string[] }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const shown = expanded ? preview.notes : preview.notes.slice(0, FIRST_TITLES);
  return (
    <section className="nt-preview" aria-label={L.preview}>
      <div className="nt-headline">
        <p className="nt-big" role="status" data-count={preview.count} data-total={preview.total}>
        <span className="nt-big-lead">{READ_LEAD}</span>{' '}
        <span className="nt-big-line"><span className="nt-num">{preview.count}</span>{' '}<span className="nt-of">{ofTotal(preview.total)}</span></span>
        </p>
        <meter className="nt-share" aria-label={L.shareBar} min={0} max={Math.max(1, preview.total)} value={preview.count} />
        <p className="kit-hint nt-cost">{sizeLine(preview.size)}</p>
      </div>
      <div className="nt-details">
        <h3 className="kit-heading nt-sub">{L.included}</h3>
        {lines.length === 0 ? <p className="kit-hint">{H.nothingPicked}</p> : <ul className="nt-lines">{lines.map(line => <li key={line}>{line}</li>)}</ul>}
        {preview.notes.length === 0 ? null : (
        <>
        <h3 className="kit-heading nt-sub">{L.someNotes}</h3>
        <ul className="nt-titles" id={listId} data-expanded={expanded ? '' : undefined}>{shown.map(n => <li key={n.id}>{n.title}</li>)}</ul>
        {preview.notes.length > FIRST_TITLES ? <IconButton icon={expanded ? 'chevron-up' : 'chevron'} label={expanded ? L.showLess : L.showMore} side="right" aria-expanded={expanded} aria-controls={listId} data-more="" onClick={() => setExpanded(e => !e)} /> : null}
        </>
        )}
      </div>
    </section>
  );
}
