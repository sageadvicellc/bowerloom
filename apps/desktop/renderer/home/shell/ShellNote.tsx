/**
 * The one short note that the app shows above the Save bar, at the left: "Removed Write a reply. Undo", or "Saved in this preview. Your files are untouched." after the
 * first Save. It stays six seconds and then fades. It waits while the pointer or the keyboard focus is on it, so its button never leaves under a hand. It is a polite
 * live region that is always in the page, so a screen reader hears each note when it arrives. It never covers a tile or a row: it sits in the strip above the bar.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '../kit/Button.js';
import { KitIcon } from '../kit/icons.js';
import type { KitIconName } from '../kit/icons.js';
import { useLeaving } from '../kit/presence.js';

/** How long a note stays, in milliseconds, before it fades. */
export const NOTE_MS = 6000;

/** One note. `key` is new for each note, so a note that replaces another starts its six seconds again. */
export interface NoteView {
  readonly key: number;
  readonly icon: KitIconName;
  readonly text: string;
  readonly action?: { readonly label: string; run(): void };
}

export function ShellNote({ note, onGone }: { note: NoteView | null; onGone(): void }): ReactElement {
  const shown = useLeaving(note);
  const [held, setHeld] = useState(false);
  const latest = useRef(onGone);
  latest.current = onGone;
  const key = note?.key;
  useEffect(() => {
    if (key === undefined || held) return undefined;
    const timer = window.setTimeout(() => latest.current(), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [key, held]);
  const view = shown.value;
  return (
    <div className="hm-toast" role="status" data-note="" data-open={view !== null && !shown.leaving ? '' : undefined} data-leaving={shown.leaving ? '' : undefined}
      onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      {view === null ? null : (
        <>
          <KitIcon name={view.icon} size={20} />
          <span>{view.text}</span>
          {view.action === undefined ? null : <Button size="small" onClick={view.action.run}>{view.action.label}</Button>}
        </>
      )}
    </div>
  );
}
