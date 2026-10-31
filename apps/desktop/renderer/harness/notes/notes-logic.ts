/**
 * The logic behind the notes step and the Notes panel (spec 6.9), with no React and no call: what a chosen folder needs next, the notes cards the panel and the
 * map draw, and how far the keeper build is. A card is named by the folder's own name when Bowerloom read it, else by the source's name: a path never names it.
 */
import type { Answer, DefinitionView, NotesView, NotesWritten, SourceView } from '../../../shared/engine/types.js';
import { KEEPER_FIRST_SKILL, keeperOf, sourceFor } from '../../../shared/harness/save-draft.js';
import type { BuildProgress } from '../words-notes.js';

/**
 * What a chosen notes folder needs next: nothing (it keeps a history, its own or a larger repository's), an offer to start its history, or words that the
 * keeper only reports. A folder inside a larger repository (`parent`) is ready and never gets the offer: its history is that repository's. A `.git` with no
 * first commit (a history start that stopped part way, or a repository git cannot read) is never ready: Bowerloom does not finish it, and says so in words.
 */
export type AfterChoose = 'ready' | 'parent' | 'offer-history' | 'no-commit' | 'git-missing' | 'refused' | 'unreadable';
export function afterChoose(view: NotesView): AfterChoose {
  switch (view.history) {
    case 'git': return 'ready';
    case 'parent': return 'parent';
    case 'none': return 'offer-history';
    case 'no-commit': return 'no-commit';
    case 'git-missing': return 'git-missing';
    case 'refused': return 'refused';
    case 'unreadable': return 'unreadable';
  }
}

/** One notes card: the source it is (or would be when attached), its name, whether the harness holds it, who reads it, and Bowerloom's read of it. */
export interface NotesCard {
  readonly key: string;
  readonly source: SourceView;
  readonly name: string;
  readonly attached: boolean;
  readonly readers: readonly string[];
  /** The read of the folder, or null before one is made. A refusal is shown in words. */
  readonly summary: Answer<NotesView> | null;
}

/**
 * The cards: each source of the harness (as the draft draws it) in its own order, then each folder the person chose that is not one of them. `summaries` holds
 * the reads made so far, by notes id; a chosen folder carries its own.
 */
export function notesCards(now: DefinitionView, chosen: readonly NotesView[], summaries: Readonly<Record<string, Answer<NotesView>>>): NotesCard[] {
  const readers = (name: string): string[] => now.agents.filter(a => a.notes.includes(name)).map(a => a.name);
  const nameOf = (summary: Answer<NotesView> | null, fallback: string): string => (summary !== null && summary.ok ? summary.value.name : fallback);
  const out: NotesCard[] = now.sources.map(s => {
    // A folder chosen in this window carries the newest read (after its history starts, say); else the panel's own read, once made.
    const own = chosen.find(c => c.id === s.notesId);
    const summary: Answer<NotesView> | null = own !== undefined ? { ok: true, value: own } : summaries[s.notesId] ?? null;
    return { key: s.notesId, source: s, name: nameOf(summary, s.name), attached: true, readers: readers(s.name), summary };
  });
  for (const c of chosen) {
    if (out.some(card => card.key === c.id)) continue;
    const summary: Answer<NotesView> = summaries[c.id] ?? { ok: true, value: c };
    out.push({ key: c.id, source: sourceFor(now, c), name: nameOf(summary, c.name), attached: false, readers: [], summary });
  }
  return out;
}

/** How far the keeper build is, for the tour's waiting step: the first skill, the rest of the offered skills, and notes on its shelf. */
export function buildProgress(now: DefinitionView, offered: readonly string[], cards: readonly NotesCard[]): BuildProgress & { readonly done: boolean } {
  const keeper = keeperOf(now);
  const first = offered.includes(KEEPER_FIRST_SKILL) ? KEEPER_FIRST_SKILL : offered[0] ?? KEEPER_FIRST_SKILL;
  if (keeper === null) return { first, firstDone: false, restDone: false, notesDone: false, hasNotes: cards.length > 0, done: false };
  const firstDone = keeper.skills.includes(first), restDone = offered.every(s => keeper.skills.includes(s)), notesDone = keeper.notes.length > 0, hasNotes = cards.length > 0;
  return { first, firstDone, restDone, notesDone, hasNotes, done: firstDone && restDone && (notesDone || !hasNotes) };
}

/**
 * The notes ids the Notes panel reads now: every source of the harness that no read has started for since the sheet opened, a folder chosen in this window
 * too, so a sheet opened again reads each one again.
 */
export function notesToRead(now: DefinitionView, reading: ReadonlySet<string>): string[] {
  return now.sources.map(s => s.notesId).filter((id, i, all) => !reading.has(id) && all.indexOf(id) === i);
}
/** The chosen folder a fresh read replaces: the read itself, when it came and is of a folder chosen in this window; else null. */
export function readReplaces(chosen: readonly NotesView[], id: string, read: Answer<NotesView>): NotesView | null {
  return read.ok && read.value.id === id && chosen.some(c => c.id === id) ? read.value : null;
}

/**
 * Adds the keeper and then moves the tour on, only when both held: the plan answered (`plan` resolves true), and its answer put the keeper in the draft
 * (`take` returns true). A refused or superseded plan leaves the tour on its step, so the refusal keeps the focus.
 */
export async function addThenNext(plan: (onValue: (view: DefinitionView) => void) => Promise<boolean>, take: (view: DefinitionView) => boolean, then: () => void): Promise<void> {
  let added = false;
  const ok = await plan(view => { added = take(view); });
  if (ok && added) then();
}

/**
 * The folder as a finished write leaves it: the fresh read when it came, else the read from before with the history the write made. A re-read that fails
 * never hides a write that worked.
 */
export function writtenView(before: NotesView, written: NotesWritten, reread: Answer<NotesView> | null): NotesView {
  return reread !== null && reread.ok ? reread.value : { ...before, history: 'git', lastCommitAt: written.committedAt };
}
