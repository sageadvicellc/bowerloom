/**
 * "Show where it lives": a quiet disclosure (a text button, closed until it is pressed, with `aria-expanded`) in the details of an agent, a skill and a tool. Open, it
 * lists one sample path for each program that holds the thing, each with "Copy path". The paths are sample content (`data-budget="content"`): the invented folders of the
 * sample world, never the real machine's. "Copy path" puts the path on the clipboard and says "Copied"; if the window will not let the page copy, the path is selected
 * and the line says so ("Copying is blocked here. Select the path and copy it."), and a path can always be selected by hand. Nothing is written to storage.
 */
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Place } from '../../../shared/home/where-it-lives.js';
import { Button } from '../kit/Button.js';
import { copyText, selectText } from '../kit/clipboard.js';
import { WORDS } from '../words.js';
import './details.css';
import { IconButton } from '../kit/IconButton.js';

const L = WORDS.label, H = WORDS.hint;

/** How long "Copied" stays, in milliseconds. */
export const COPIED_MS = 3000;

/** A path with a place to break the line before each slash, so a long one wraps between folders and not in the middle of a name. The text itself does not change. */
function breakable(path: string): ReactNode {
  return path.split('/').map((part, i) => (i === 0 ? part : <Fragment key={i}><wbr />{`/${part}`}</Fragment>));
}

export function WhereItLives({ places }: { places: readonly Place[] }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ readonly path: string; readonly ok: boolean } | null>(null);
  const listId = useId();
  const timer = useRef<number | undefined>(undefined);
  const paths = useRef(new Map<string, HTMLElement>());
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (places.length === 0) return null;
  const copy = async (place: Place): Promise<void> => {
    window.clearTimeout(timer.current);
    const ok = await copyText(place.path);
    if (!ok) { const el = paths.current.get(place.path); if (el !== undefined) selectText(el); }
    setDone({ path: place.path, ok });
    if (ok) timer.current = window.setTimeout(() => setDone(null), COPIED_MS);
  };
  return (
    <div className="dt-lives" data-lives="">
      <Button variant="text" aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(o => !o); setDone(null); }}>{open ? L.hideWhere : L.showWhere}</Button>
      {open ? (
        <ul className="dt-places" id={listId} data-places="">
          {places.map(place => (
            <li key={`${place.app}:${place.path}`} className="dt-place" data-app={place.app}>
              <p className="kit-hint dt-place-app">{place.app}</p>
              <code className="dt-path" data-budget="content" tabIndex={0} ref={el => { if (el === null) paths.current.delete(place.path); else paths.current.set(place.path, el); }}>{breakable(place.path)}</code>
              <div className="dt-place-actions">
                <IconButton icon="copy" label={`${L.copyPath}, ${place.app}`} tip={L.copyPath} side="left" data-copy="" onClick={() => { void copy(place); }} />
                <span className="dt-copied" role="status">{done !== null && done.path === place.path && done.ok ? L.copied : ''}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {open && done !== null && !done.ok ? <p className="kit-hint dt-blocked" role="status" data-blocked="">{H.copyBlocked}</p> : null}
    </div>
  );
}
