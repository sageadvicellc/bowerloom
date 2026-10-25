/**
 * The list of the Library: one card of the kit for each thing, and under it a line with a grey dot: "Used by N agents" or "Not used yet", and where the thing came from. One row is in the Tab order (the chosen one,
 * else the one last used, else the first), and the arrows (and Home and End) move between rows, so a list of fifty is one stop for the keyboard, not fifty.
 * Pressing a row chooses it; pressing it again puts it down. The badge of a row with different copies opens the copies dialog.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { LIBRARY_MODEL_WORDS } from '../../../shared/home/library-model.js';
import type { LibraryKind, LibraryRow } from '../../../shared/home/library-model.js';
import { ItemCard } from '../kit/ItemCard.js';
import type { CardKind } from '../kit/ItemCard.js';
import './library.css';

const CARD: Readonly<Record<LibraryKind, CardKind>> = Object.freeze({ skill: 'skill', agent: 'agent', tool: 'tool', note: 'note' });

export interface LibraryListProps {
  kind: LibraryKind;
  rows: readonly LibraryRow[];
  selectedId: string | null;
  onSelect(id: string): void;
  onBadgePress(id: string): void;
  /** The text behind the list for a screen reader. */
  label: string;
  /** What the list says when it has no rows. */
  empty: string;
}

export function LibraryList({ kind, rows, selectedId, onSelect, onBadgePress, label, empty }: LibraryListProps): ReactElement {
  const list = useRef<HTMLUListElement>(null);
  const [last, setLast] = useState<string | null>(null);
  const active = rows.some(r => r.id === selectedId) ? selectedId : rows.some(r => r.id === last) ? last : rows[0]?.id ?? null;

  // The row in the Tab order is the active one; every other row's button is reachable by the arrows only.
  useEffect(() => {
    for (const li of list.current?.querySelectorAll<HTMLElement>('li[data-row-id]') ?? []) {
      li.querySelector<HTMLElement>('.kit-card-main')?.setAttribute('tabindex', li.getAttribute('data-row-id') === active ? '0' : '-1');
    }
  });

  const key = (e: ReactKeyboardEvent<HTMLUListElement>): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('kit-card-main')) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('li[data-row-id] .kit-card-main') ?? [])];
    const at = buttons.indexOf(target);
    const go = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null;
    if (go === null || at < 0) return;
    e.preventDefault();
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, go))];
    if (next === undefined) return;
    setLast(next.closest('li')?.getAttribute('data-row-id') ?? null);
    next.focus();
  };

  if (rows.length === 0) return <p className="kit-hint lb-empty" role="status">{empty}</p>;
  return (
    <ul className="lb-list" aria-label={label} data-kind={kind} ref={list} onKeyDown={key} onFocus={e => { const id = (e.target as HTMLElement).closest('li')?.getAttribute('data-row-id'); if (id !== null && id !== undefined) setLast(id); }}>
      {rows.map(row => (
        <li key={row.id} className="lb-row" data-row-id={row.id}>
          <ItemCard kind={CARD[kind]} name={row.name} hint={row.hint} selected={row.id === selectedId} onSelect={() => onSelect(row.id)}
            {...(row.status === null || row.status.tone === 'info' ? {} : { badge: row.status })}
            {...(row.status !== null && row.status.tone === 'warn' && row.status.label.endsWith(LIBRARY_MODEL_WORDS.copiesSuffix) ? { onBadgePress: () => onBadgePress(row.id) } : {})} />
          {/* The line under every card: a grey dot and what uses it, and where it came from. It is always there, so every row has the same height. */}
          <p className="kit-hint lb-used" data-used="">
            <span className="lb-used-note"><span className="kit-dot lb-dot" aria-hidden="true" /><span>{row.note}</span></span>
            <span className="lb-used-source" data-budget="content">{row.source}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

