/**
 * The Notes panel, inside My agents (spec 6.9 "The dashboard"; first five minutes, section 5): each notes source with its name, its page count, its last
 * change, the agents that read it, and the latest tidy-up report. The folder and the report's place sit behind "Show details", never on the card. One line says
 * more kinds of notes are coming; there is no tile for a kind that does not exist. A calm status panel: no motion of its own.
 * "Use my notes" and "Start fresh" open the notes step in place (`step`), and with no keeper yet the panel offers the ready-made Notes keeper.
 */
import type { ReactElement, ReactNode } from 'react';
import { HButton, StateDot } from '../parts/controls.js';
import { Section } from '../sheets/engine-parts.js';
import { NOTES_REFUSAL_WORDS } from '../words-engine.js';
import { NOTES, lastChangeWords, pagesWords, reportWords, usedByWords } from '../words-notes.js';
import { ItemCard } from './cards.js';
import type { NotesCard } from './notes-logic.js';

export interface NotesPanelProps {
  cards: readonly NotesCard[];
  held: boolean;
  hasKeeper: boolean;
  onUse(): void;
  onFresh(): void;
  onAddKeeper(): void;
  /** The notes step, drawn in place of the two buttons while it is open. */
  step?: ReactNode;
}

/** The lines of one card: what Bowerloom read of the folder, or why it could not. */
function linesOf(card: NotesCard): ReactNode[] {
  const s = card.summary;
  const readers = <span data-readers="">{usedByWords(card.readers)}</span>;
  if (s === null) return [readers];
  if (!s.ok) return [<StateDot key="r" tone="warn">{NOTES.hint.noSummary}</StateDot>, NOTES_REFUSAL_WORDS[s.refusal.code] ?? s.refusal.message, readers];
  const v = s.value;
  return [
    <span data-pages={v.pages}>{pagesWords(v.pages, v.complete)}</span>,
    <span data-last-change="">{lastChangeWords(v.lastCommitAt)}</span>,
    readers,
    <span data-report="">{reportWords(v.latestReport)}</span>,
    ...(v.history === 'git' ? [] : [<StateDot key="h" tone="quiet">{v.history === 'git-missing' ? NOTES.hint.gitMissing : v.history === 'unreadable' ? NOTES.hint.unreadable : NOTES.hint.reportOnly}</StateDot>]),
    ...(card.attached ? [] : [<StateDot key="a" tone="quiet">{NOTES.hint.notAttached}</StateDot>]),
  ];
}
function detailsOf(card: NotesCard): { label: string; value: string }[] {
  const s = card.summary;
  const out: { label: string; value: string }[] = [{ label: NOTES.label.folder, value: s !== null && s.ok ? s.value.label : card.source.label }];
  if (s !== null && s.ok && s.value.latestReport !== null) out.push({ label: NOTES.label.latestReport, value: s.value.latestReport.path });
  return out;
}

export function NotesPanel({ cards, held, hasKeeper, onUse, onFresh, onAddKeeper, step }: NotesPanelProps): ReactElement {
  return (
    <Section title={NOTES.label.notes} count={String(cards.length)} slot="notes">
      {cards.length === 0 ? <p className="hxe-text hxe-muted" data-tour="notes">{NOTES.hint.noNotes}</p> : (
        <ul className="hxn-cards" aria-label={NOTES.label.notes}>
          {cards.map((card, i) => <ItemCard key={card.key} kind="notes" id={card.key} name={card.name} lines={linesOf(card)} details={detailsOf(card)} tour={i === 0 ? 'notes' : undefined} />)}
        </ul>
      )}
      <p className="hxe-text hxe-muted" data-more-kinds="">{NOTES.hint.moreKinds}</p>
      {step ?? (
        <div className="hxn-ways">
          <HButton icon="folder" disabled={held} data-notes-use="" onClick={onUse}>{NOTES.label.useMine}</HButton>
          <HButton icon="plus" disabled={held} data-notes-fresh="" onClick={onFresh}>{NOTES.label.startFresh}</HButton>
        </div>
      )}
      {hasKeeper ? null : (
        <div className="hxn-ways">
          <p className="hxe-text hxe-muted">{NOTES.hint.noKeeper}</p>
          <HButton icon="robot" disabled={held} data-add-keeper="" onClick={onAddKeeper}>{NOTES.label.addKeeper}</HButton>
        </div>
      )}
    </Section>
  );
}
