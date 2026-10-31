/**
 * The Notes panel, inside My agents (spec 6.9 "The dashboard"; first five minutes, section 5): each notes source with its name, its page count, its last
 * change, the agents that read it, and the latest tidy-up report. The folder and the report's place sit behind "Show details", never on the card. One line says
 * more kinds of notes are coming; there is no tile for a kind that does not exist. A calm status panel: no motion of its own.
 * "Use my notes" and "Start fresh" open the notes step in place (`step`), and with no keeper yet the panel offers the ready-made Notes keeper.
 */
import type { ReactElement, ReactNode } from 'react';
import type { NotesView } from '../../../shared/engine/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Section } from '../sheets/engine-parts.js';
import { NOTES_REFUSAL_WORDS } from '../words-engine.js';
import { NOTES, keepName, lastChangeWords, loseWords, openReportName, pagesWords, reportWords, stopName, usedByWords } from '../words-notes.js';
import { ItemCard } from './cards.js';
import type { NotesCard } from './notes-logic.js';

export interface NotesPanelProps {
  cards: readonly NotesCard[];
  held: boolean;
  hasKeeper: boolean;
  onUse(): void;
  onFresh(): void;
  onAddKeeper(): void;
  /** "Stop using these notes" on a saved source (`on`), or "Keep using these notes" on one the draft stops using. Left out, neither is offered. */
  onStop?(card: NotesCard, on: boolean): void;
  /** Opens the newest tidy-up report of a card's folder, through main. Left out, the report line stays words. */
  onOpenReport?(card: NotesCard): void;
  /** The notes step, drawn in place of the two buttons while it is open. */
  step?: ReactNode;
}

/** Where a folder's history comes from when it is not its own repository, or why it is not ready, in words. */
const HISTORY_WORDS: Readonly<Record<Exclude<NotesView['history'], 'git'>, string>> = Object.freeze({
  parent: NOTES.hint.parentHistory, none: NOTES.hint.reportOnly, 'no-commit': NOTES.hint.noCommit, 'git-missing': NOTES.hint.gitMissing, refused: NOTES.hint.refused, unreadable: NOTES.hint.unreadable,
});

/**
 * The lines of one card: what Bowerloom read of the folder, or why it could not. The report line is a button that opens the report when there is one and
 * the panel can open it; a path never shows. A card the draft stops using says so, and names who loses it.
 */
function linesOf(card: NotesCard, held: boolean, onOpenReport?: (card: NotesCard) => void): ReactNode[] {
  const s = card.summary;
  const readers = card.stopped === true
    ? <span data-readers="" data-stops=""><StateDot tone="warn">{NOTES.hint.stopsOnSave}</StateDot> {loseWords(card.readers)}</span>
    : <span data-readers="">{usedByWords(card.readers)}</span>;
  if (s === null) return [readers];
  if (!s.ok) return [<StateDot key="r" tone="warn">{NOTES.hint.noSummary}</StateDot>, NOTES_REFUSAL_WORDS[s.refusal.code] ?? s.refusal.message, readers];
  const v = s.value;
  const report = reportWords(v.latestReport, v.reportsComplete);
  return [
    <span data-pages={v.pages}>{pagesWords(v.pages, v.complete)}</span>,
    <span data-last-change="">{lastChangeWords(v.lastCommitAt)}</span>,
    readers,
    v.latestReport !== null && onOpenReport !== undefined
      ? <HButton variant="text" size="small" data-open-report={card.key} disabled={held} aria-label={openReportName(v.latestReport.date)} onClick={() => onOpenReport(card)}>{report}</HButton>
      : <span data-report="">{report}</span>,
    ...(v.history === 'git' ? [] : [<span key="h" data-history={v.history}><StateDot tone={v.history === 'none' || v.history === 'parent' ? 'quiet' : 'warn'}>{HISTORY_WORDS[v.history]}</StateDot></span>]),
    ...(card.attached ? [] : [<StateDot key="a" tone="quiet">{NOTES.hint.notAttached}</StateDot>]),
  ];
}
function detailsOf(card: NotesCard): { label: string; value: string }[] {
  const s = card.summary;
  const out: { label: string; value: string }[] = [{ label: NOTES.label.folder, value: s !== null && s.ok ? s.value.label : card.source.label }];
  if (s !== null && s.ok && s.value.latestReport !== null) out.push({ label: NOTES.label.latestReport, value: s.value.latestReport.path });
  return out;
}

/** The card's one action: stop using a saved source, or keep using one the draft stops using. A source the draft only adds has none. */
function actionOf(card: NotesCard, held: boolean, onStop?: (card: NotesCard, on: boolean) => void): ReactNode {
  if (onStop === undefined || card.saved !== true) return undefined;
  return card.stopped === true
    ? <HButton size="small" disabled={held} data-keep-notes={card.key} aria-label={keepName(card.name)} onClick={() => onStop(card, false)}>{NOTES.label.keepUsing}</HButton>
    : <HButton size="small" disabled={held} data-stop-notes={card.key} aria-label={stopName(card.name)} onClick={() => onStop(card, true)}>{NOTES.label.stopUsing}</HButton>;
}

export function NotesPanel({ cards, held, hasKeeper, onUse, onFresh, onAddKeeper, onStop, onOpenReport, step }: NotesPanelProps): ReactElement {
  return (
    <Section title={NOTES.label.notes} count={String(cards.length)} slot="notes">
      {cards.length === 0 ? <p className="hxe-text hxe-muted" data-tour="notes">{NOTES.hint.noNotes}</p> : (
        <ul className="hxn-cards" aria-label={NOTES.label.notes}>
          {cards.map((card, i) => (
            <ItemCard key={card.key} kind="notes" id={card.key} name={card.name} lines={linesOf(card, held, onOpenReport)} details={detailsOf(card)} tour={i === 0 ? 'notes' : undefined}
              action={actionOf(card, held, onStop)} stopped={card.stopped === true} />
          ))}
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
