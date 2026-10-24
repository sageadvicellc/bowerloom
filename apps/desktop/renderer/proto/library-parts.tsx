/**
 * The small parts the skills and agents screens share (prototype slice S6): a menu opened by a button, a combobox that picks one item from a list,
 * the live line that says what was done or why nothing was, and the "Waiting to apply" list. They hold only what is on the screen right now
 * (which menu is open, what was typed); every change to the harness goes up through a callback.
 * Every part works with the keyboard alone: arrow keys move, Enter picks, Escape closes and gives the focus back.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { WaitingView } from '../../shared/proto/library-install.js';
import './library-manager.css';

// ------------------------------------------------------------------------------------------------------------- pointer drag

/** How far the pointer must move, in pixels, before a press becomes a drag. A click stays a click. */
const DRAG_START = 6;

/** What a drag in progress looks like to the screen: what is being dragged, its words, and the target the pointer is over (or null). */
export interface DragView { readonly id: string; readonly label: string; readonly over: string | null }

/**
 * A drag with the pointer. A press on a part that is not a control, then a move, then a release over a target. `targetOf` turns the element under the
 * pointer into a target name (or null); `onDrop` is told the dragged id and the target. Escape cancels. A small label follows the pointer.
 * Every drag has a keyboard way on the screen that uses this, so a person without a pointer loses nothing.
 */
/** What a drop that lands on nothing says. */
export const DROP_MISS_WORDS = 'Drop it on a harness chip, or use the Install to menu.';

export function usePointerDrag({ targetOf, onDrop, onMiss }: { targetOf(el: Element): string | null; onDrop(id: string, target: string): void; onMiss?(): void }): {
  drag: DragView | null; start(e: ReactPointerEvent, id: string, label: string): void; ghost: ReactElement | null;
} {
  const [drag, setDrag] = useState<DragView | null>(null);
  const live = useRef<{ id: string; label: string; x: number; y: number; active: boolean } | null>(null);
  const spot = useRef({ x: 0, y: 0 });
  const stopListening = useRef<(() => void) | null>(null);
  const latest = useRef({ targetOf, onDrop, onMiss });
  latest.current = { targetOf, onDrop, onMiss };

  const finish = useCallback((): void => { stopListening.current?.(); stopListening.current = null; live.current = null; setDrag(null); }, []);
  useEffect(() => () => { stopListening.current?.(); }, []);

  const start = useCallback((e: ReactPointerEvent, id: string, label: string): void => {
    if (e.button !== 0 || !e.isPrimary || live.current !== null) return;
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, summary, label, [role="menu"]') !== null) return;
    live.current = { id, label, x: e.clientX, y: e.clientY, active: false };
    const under = (ev: PointerEvent): string | null => { const el = document.elementFromPoint(ev.clientX, ev.clientY); return el === null ? null : latest.current.targetOf(el); };
    const move = (ev: PointerEvent): void => {
      const d = live.current;
      if (d === null) return;
      spot.current = { x: ev.clientX, y: ev.clientY };
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < DRAG_START) return;
        d.active = true;
      }
      window.getSelection()?.removeAllRanges();
      const over = under(ev);
      setDrag(prev => (prev !== null && prev.over === over ? prev : { id: d.id, label: d.label, over }));
      const g = document.querySelector<HTMLElement>('.lib-ghost');
      if (g !== null) g.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
    };
    const up = (ev: PointerEvent): void => {
      const d = live.current, target = d !== null && d.active ? under(ev) : null;
      finish();
      if (d !== null && target !== null) latest.current.onDrop(d.id, target);
      else if (d !== null && d.active) latest.current.onMiss?.();
    };
    const key = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') finish(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', finish); window.addEventListener('keydown', key);
    stopListening.current = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', key);
    };
  }, [finish]);

  const ghost = drag === null ? null : (
    <div className="lib-ghost" aria-hidden="true" ref={el => { if (el !== null) el.style.transform = `translate(${spot.current.x + 14}px, ${spot.current.y + 14}px)`; }}>{drag.label}</div>
  );
  return { drag, start, ghost };
}

// ------------------------------------------------------------------------------------------------------------- live line

/** What the live line says. `lead` is the bold start: "Done.", "Nothing changed." or "Noted.". */
export interface Note { readonly lead: 'Done.' | 'Nothing changed.' | 'Noted.'; readonly text: string }

/** A note for something that was done, something that was refused, or something that was only noted. */
export const doneNote = (text: string): Note => ({ lead: 'Done.', text });
export const refusedNote = (text: string): Note => ({ lead: 'Nothing changed.', text });
export const notedNote = (text: string): Note => ({ lead: 'Noted.', text });

/** The one live region of a screen. It is always on the page, so a screen reader hears each new sentence. Two lines of room are kept, so the page does not jump. */
export function LiveNote({ note }: { note: Note | null }): ReactElement {
  return (
    <p className={`lib-note${note?.lead === 'Nothing changed.' ? ' is-refused' : ''}`} role="status" aria-live="polite">
      {note === null ? '' : <><strong>{note.lead}</strong> {note.text}</>}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------------------- waiting list

/**
 * The list of what waits to be applied: the change bar's own line, and one short line for each interface. It sticks to the bottom of the screen,
 * and the live line sits inside it, so a person sees what just happened wherever the page is scrolled. The count is not a live region; the live line says it.
 */
export function WaitingPanel({ view, note }: { view: WaitingView; note: Note | null }): ReactElement {
  const headingId = useId();
  return (
    <section className={`lib-waiting${view.dirty ? ' is-dirty' : ''}`} aria-labelledby={headingId}>
      <LiveNote note={note} />
      <div className="lib-waiting-row">
        <h2 id={headingId} className="sr">Waiting to apply</h2>
        <p className="lib-waiting-count"><strong>{view.headline}</strong>{note !== null && note.lead === 'Done.' ? null : <> <span className="lib-waiting-where small muted">Apply on the Harness screen.</span></>}</p>
        {view.lines.length === 0 ? null : <ul className="lib-waiting-lines">{view.lines.map(l => <li key={l}>{l}</li>)}</ul>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------- menu

/** One line of a menu. A disabled line is still read and can be chosen to hear why; the screen then says the reason and changes nothing. */
export interface MenuEntry { readonly id: string; readonly label: string; readonly note?: string; readonly disabled?: boolean }

/** A button that opens a menu. `entries` is asked for each time the menu opens, so the lines are never out of date. */
export function MenuButton({ label, menuLabel, entries, onPick, buttonClass = 'btn secondary' }: {
  label: string; menuLabel: string; entries: () => readonly MenuEntry[]; onPick(id: string): void; buttonClass?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<readonly MenuEntry[]>([]);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null), button = useRef<HTMLButtonElement>(null), items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const show = (at: number): void => {
    const list = entries();
    const rect = button.current?.getBoundingClientRect();
    setUp(rect !== undefined && window.innerHeight - rect.bottom < list.length * 44 + 110 && rect.top > window.innerHeight - rect.bottom);
    setLines(list); setActive(Math.min(at, Math.max(0, list.length - 1))); setOpen(true);
  };
  const close = (refocus: boolean): void => { setOpen(false); if (refocus) button.current?.focus(); };

  useEffect(() => { if (open) items.current[active]?.focus(); }, [open, active]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onButtonKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); show(0); } else if (e.key === 'ArrowUp') { e.preventDefault(); show(Number.MAX_SAFE_INTEGER); }
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const last = lines.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a >= last ? 0 : a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a <= 0 ? last : a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <span className={`lib-menuwrap${open ? ' is-open' : ''}`} ref={wrap}>
      <button ref={button} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show(0))} onKeyDown={onButtonKey}>
        {label}<svg className="lib-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {!open ? null : (
        <div id={menuId} role="menu" aria-label={menuLabel} className={`lib-menu${up ? ' is-up' : ''}`} onKeyDown={onMenuKey}>
          {lines.map((line, i) => (
            <button key={line.id} ref={el => { items.current[i] = el; }} type="button" role="menuitem" tabIndex={i === active ? 0 : -1}
              aria-disabled={line.disabled === true ? true : undefined} className={`lib-menuitem${line.disabled === true ? ' is-off' : ''}`}
              onClick={() => { close(true); onPick(line.id); }} onMouseEnter={() => setActive(i)}>
              <span>{line.label}</span>{line.note === undefined ? null : <span className="lib-menunote">{line.note}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------------------- combobox

/** One choice of a combobox. `hint` is a short line under the name. */
export interface ComboOption { readonly id: string; readonly label: string; readonly hint?: string }

/** How many choices the list shows at a time. The rest are reached by typing. */
const COMBO_ROWS = 10;

/**
 * A text box that picks one thing from a list (a combobox with a list below it). Typing narrows the list, the arrow keys move through it,
 * Enter picks, and Escape closes it. After a pick the box is empty and keeps the focus, so several things can be picked in turn.
 */
export function Combobox({ label, placeholder, options, onPick, emptyText }: {
  label: string; placeholder: string; options: readonly ComboOption[]; onPick(id: string): void; emptyText: string;
}): ReactElement {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const base = useId(), listId = `${base}-list`, optionId = (i: number): string => `${base}-opt-${i}`;
  const words = text.toLowerCase().split(/\s+/).filter(w => w !== '');
  const found = options.filter(o => words.every(w => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(w)));
  const shown = found.slice(0, COMBO_ROWS);
  const at = Math.min(active, Math.max(0, shown.length - 1));

  const pick = (id: string): void => { setText(''); setOpen(false); setActive(0); onPick(id); };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); } else setActive(a => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && shown[at] !== undefined) { e.preventDefault(); pick(shown[at]!.id); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } else if (text !== '') { e.preventDefault(); setText(''); } }
  };
  return (
    <div className="lib-combo">
      <label className="lib-field" htmlFor={`${base}-input`}><span>{label}</span></label>
      <input id={`${base}-input`} type="text" role="combobox" autoComplete="off" placeholder={placeholder} value={text}
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && shown.length > 0 ? optionId(at) : undefined}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)} />
      <ul id={listId} role="listbox" aria-label={label} className="lib-listbox" hidden={!open}>
        {shown.map((o, i) => (
          <li key={o.id} id={optionId(i)} role="option" aria-selected={i === at} className={i === at ? 'is-active' : ''}
            onMouseDown={e => { e.preventDefault(); pick(o.id); }} onMouseEnter={() => setActive(i)}>
            <span>{o.label}</span>{o.hint === undefined ? null : <span className="lib-optionhint">{o.hint}</span>}
          </li>
        ))}
        {shown.length === 0 ? <li role="presentation" className="lib-listempty">{options.length === 0 ? emptyText : 'Nothing matches. Try a shorter word.'}</li> : null}
        {found.length > shown.length ? <li role="presentation" className="lib-listempty">{found.length - shown.length} more. Keep typing to narrow the list.</li> : null}
      </ul>
    </div>
  );
}
