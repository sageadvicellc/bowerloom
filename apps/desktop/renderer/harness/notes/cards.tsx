/**
 * The one card of the harness-first window for a skill, a tool or notes (first five minutes, section 7: one card, one layout), and the shelf of an agent that
 * takes a card by a drag. A card that can be dragged also has a button that does the same, so every drag has a keyboard path. A path is never on a card: the
 * card's details ("Show details") are where one may sit.
 *
 * A drag carries its kind in its type (`application/x-bowerloom-skill` or `-notes`), so a shelf knows while the card is over it whether it takes it, and a
 * Skills shelf never takes notes. A card that just landed rises in with the existing arrive token, and not at all when the person asked for less motion.
 */
import { useId, useState } from 'react';
import type { DragEvent, ReactElement, ReactNode } from 'react';
import { Tile } from '../icons.js';
import type { HarnessIconName } from '../icons.js';
import { HButton } from '../parts/controls.js';
import { NOTES } from '../words-notes.js';
import './notes.css';

export type CardKind = 'skill' | 'tool' | 'notes';
const ICON: Readonly<Record<CardKind, HarnessIconName>> = Object.freeze({ skill: 'bolt', tool: 'plug', notes: 'page' });
const TYPE = (kind: CardKind): string => `application/x-bowerloom-${kind}`;

export interface ItemCardProps {
  kind: CardKind;
  /** The id the card stands for: a skill id, or a notes id. */
  id: string;
  name: string;
  lines?: readonly ReactNode[];
  /** True when the card can be dragged onto a shelf. */
  draggable?: boolean;
  /** The button that does what the drag does, or any other action. */
  action?: ReactNode;
  /** Rows shown under "Show details": a path may sit here, never on the card itself. */
  details?: readonly { readonly label: string; readonly value: string }[];
  tour?: string | undefined;
  /** True for a notes card the draft stops using: it stays on the panel, marked, until the person saves or keeps it. */
  stopped?: boolean;
}

export function ItemCard({ kind, id, name, lines = [], draggable = false, action, details = [], tour, stopped = false }: ItemCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const start = (e: DragEvent<HTMLLIElement>): void => { e.dataTransfer.setData(TYPE(kind), id); e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'copy'; };
  return (
    <li className="hxn-card" data-card={id} data-kind={kind} draggable={draggable ? true : undefined} data-tour={tour} data-stopped={stopped ? '' : undefined} onDragStart={draggable ? start : undefined}>
      <div className="hxn-card-row">
        <Tile name={ICON[kind]} />
        <span className="hxn-card-text">
          <span className="hxn-card-name">{name}</span>
          {lines.map((line, i) => <span key={i} className="hxn-card-sub">{line}</span>)}
        </span>
        {action === undefined ? null : <span className="hxn-card-action">{action}</span>}
      </div>
      {details.length === 0 ? null : (
        <>
          <HButton variant="text" size="small" aria-expanded={open} aria-controls={detailsId} data-show-details={id} onClick={() => setOpen(o => !o)}>{open ? NOTES.label.hideDetails : NOTES.label.showDetails}</HButton>
          {open ? (
            <dl className="hxn-details" id={detailsId}>
              {details.map(d => <div key={d.label}><dt>{d.label}</dt><dd className="hxe-mono">{d.value}</dd></div>)}
            </dl>
          ) : null}
        </>
      )}
    </li>
  );
}

export interface ShelfProps {
  /** `skills` takes skill cards; `notes` takes notes cards. */
  shelf: 'skills' | 'notes';
  title: string;
  items: readonly { readonly id: string; readonly name: string }[];
  empty: string;
  held: boolean;
  /** The ids that just landed, which rise in. */
  arrived?: readonly string[];
  onDrop(id: string): void;
  onTakeOff(id: string): void;
  takeOffName(name: string): string;
}

/** A shelf of an agent: a drop place for one kind of card, with what is on it and a button to take each one off. */
export function Shelf({ shelf, title, items, empty, held, arrived = [], onDrop, onTakeOff, takeOffName }: ShelfProps): ReactElement {
  const [over, setOver] = useState(false);
  const type = TYPE(shelf === 'skills' ? 'skill' : 'notes');
  const headId = useId();
  const takes = (e: DragEvent<HTMLElement>): boolean => !held && [...e.dataTransfer.types].includes(type);
  return (
    <section className="hxn-shelf" data-shelf={shelf} data-over={over ? '' : undefined} aria-labelledby={headId}
      onDragOver={e => { if (!takes(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { setOver(false); if (!takes(e)) return; e.preventDefault(); const id = e.dataTransfer.getData(type); if (id !== '') onDrop(id); }}>
      <h4 className="hxn-shelf-head" id={headId}><span>{title}</span><span className="hxe-count">{items.length}</span></h4>
      {items.length === 0 ? <p className="hxn-shelf-empty">{empty}</p> : (
        <ul className="hxn-chips">
          {items.map(item => (
            <li key={item.id} className="hxn-chip" data-on-shelf={item.id} data-arrived={arrived.includes(item.id) ? '' : undefined}>
              <span className="hxn-chip-name">{item.name}</span>
              <HButton size="small" variant="text" disabled={held} aria-label={takeOffName(item.name)} onClick={() => onTakeOff(item.id)}>{NOTES.label.takeOff}</HButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
