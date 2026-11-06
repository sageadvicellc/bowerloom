/**
 * The sort control: one icon button (two arrows) that opens a small menu of ways to put things in order, "Name" and "Recently changed" on the map, three on the Library.
 * It replaces the row of words that sat above the list. The button is named "Sort" and says the menu is open with `aria-expanded`. The menu is a list of radio items; the one
 * in use says so with `aria-checked`, a filled tint and a 2 px accent edge, never a tick. Down Arrow or Enter opens it and puts the focus on the item in use; Up and Down
 * move, Home and End jump, Enter or Space chooses and closes, Escape closes and keeps the focus on the button (heard first and marked handled, so a drawer under it stays
 * open), Tab or a press elsewhere closes it. Choosing is not an edit of the setup: it only orders what is on show, so read only mode leaves it working.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, Ref } from 'react';
import { IconButton } from './IconButton.js';
import { roveTarget } from '../shell/shell-state.js';
import type { TipSide } from './Tooltip.js';
import './menu.css';

export interface SortChoice<T extends string> { readonly mode: T; readonly label: string }

export interface SortMenuProps<T extends string> {
  mode: T;
  choices: readonly SortChoice<T>[];
  onChange(mode: T): void;
  /** The name of the button ("Sort"). */
  label: string;
  /** The name of the menu ("Order of the agents"). */
  menuLabel: string;
  side?: TipSide;
  /** Which edge of the button the menu lines up with: its right edge (default, for a button at the right of a bar) or its left edge (a button at the left of a page). */
  align?: 'start' | 'end';
}

/** The list of the menu: one radio item for each way of ordering, the one in use `aria-checked`. Drawn on its own for the tests, and by the menu while it is open. */
export function SortList<T extends string>({ id, mode, choices, label, onPick, listRef, onKeyDown }: { id: string; mode: T; choices: readonly SortChoice<T>[]; label: string; onPick(mode: T): void; listRef?: Ref<HTMLDivElement>; onKeyDown?(e: ReactKeyboardEvent<HTMLElement>): void }): ReactElement {
  return (
    <div className="hm-menu-list" id={id} role="menu" aria-label={label} {...(listRef === undefined ? {} : { ref: listRef })} {...(onKeyDown === undefined ? {} : { onKeyDown })}>
      {choices.map(choice => (
        <button key={choice.mode} type="button" role="menuitemradio" className="hm-menu-item" aria-checked={mode === choice.mode} tabIndex={-1} data-sort={choice.mode} onClick={() => onPick(choice.mode)}>{choice.label}</button>
      ))}
    </div>
  );
}

export function SortMenu<T extends string>({ mode, choices, onChange, label, menuLabel, side = 'below-end', align = 'end' }: SortMenuProps<T>): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const items = (): HTMLButtonElement[] => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
  // Opening puts the focus on the item in use.
  useEffect(() => { if (open) (items().find(b => b.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); setOpen(false); trigger.current?.focus();
    };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open]);
  const onTrigger = (e: ReactKeyboardEvent<HTMLElement>): void => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } };
  const onMenu = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Tab') { setOpen(false); return; }
    const all = items(), at = all.findIndex(b => b === document.activeElement), to = roveTarget(e.key, Math.max(0, at), all.length);
    if (to === null) return;
    e.preventDefault(); all[to]?.focus();
  };
  return (
    <span className="hm-menu" ref={wrap} data-align={align === 'start' ? 'start' : undefined}>
      <IconButton ref={trigger} icon="sort" label={label} side={side} aria-haspopup="menu" aria-expanded={open} aria-controls={id} data-sort-button="" onKeyDown={onTrigger} onClick={() => setOpen(o => !o)} />
      {open ? <SortList id={id} mode={mode} choices={choices} label={menuLabel} listRef={list} onKeyDown={onMenu} onPick={next => { onChange(next); setOpen(false); trigger.current?.focus(); }} /> : null}
    </span>
  );
}
