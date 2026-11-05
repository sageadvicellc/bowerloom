/**
 * A file path behind "Show details". A path is for a person who goes looking for the file, so it is out of sight until asked for. The button is a real button: Enter and Space press it,
 * `aria-expanded` says whether the path is shown, and `aria-controls` names the path's element, which is always in the page (hidden while closed) so the name always points at something.
 * The button's name adds what it opens ("Show details for Writer"), so a screen reader that lists buttons can tell one from another, and the shown words stay "Show details".
 * The path is the person's own text: React draws it as plain text. No motion: the path appears and goes at once, so reduced motion needs no case of its own.
 */
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { WORDS, detailsName } from '../words.js';
import { HButton } from './controls.js';

export function PathDisclosure({ path, subject, className }: { path: string; subject: string; className?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className === undefined ? 'hx-disclosure' : `hx-disclosure ${className}`} data-path-disclosure="" data-open={open ? '' : undefined}>
      <HButton variant="text" size="small" aria-expanded={open} aria-controls={id} aria-label={detailsName(open, subject)} onClick={() => setOpen(o => !o)}>{open ? WORDS.label.hideDetails : WORDS.label.showDetails}</HButton>
      <p className="hx-disclosure-path" id={id} hidden={!open} data-path="">{path}</p>
    </div>
  );
}
