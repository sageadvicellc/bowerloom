/**
 * Every word a person reads in "Choose notes" and on its test page, in one frozen table of the same shape as `WORDS` (renderer/home/words.ts): a label has
 * at most 5 words, a hint at most 12, and no banned word appears. `tests/home-notes-words.test.ts` holds this table, the builders at the bottom and the
 * markup of every part to those rules. A screen takes its words from here and nowhere else. Words the shell already has (Notes, Show more, Close) come
 * from `WORDS`, so each stays one word in one place. No word here says "slice", "token" or "folder": a person picks notes, and notes sit in topics.
 */
import type { SizeBand } from '../../../shared/home/notes-model.js';
import { WORDS } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const NOTES_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    title: 'Choose notes',
    choose: 'Choose notes',
    notes: WORDS.label.notes,
    topics: 'Topics',
    pickByHand: 'Pick by hand',
    allTopics: 'All topics',
    pickTopic: 'Pick a topic',
    leaveOut: 'Leave out',
    keptBefore: 'Kept from before',
    preview: 'Preview',
    included: 'What is included',
    someNotes: 'Some of these notes',
    shareBar: 'Share of all notes',
    search: 'Search notes',
    clearTicks: 'Clear my ticks',
    donePicking: 'Done picking',
    cancel: 'Cancel',
    use: 'Use these notes',
    showMore: WORDS.label.showMore,
    showLess: WORDS.label.showLess,
    close: WORDS.label.close,
    // The test page.
    pageTitle: 'Choose notes test page',
    yourAgents: WORDS.label.yourAgents,
    changes: 'Changes waiting',
  },
  /** One line under a label: at most 12 words. */
  hint: {
    intro: 'Pick the notes this agent can read.',
    topics: 'Turn a topic on to include its notes.',
    byHand: 'Open a topic, then tick single notes.',
    noMatch: 'No notes match your search.',
    alreadyIn: 'Already included by its topic.',
    nothingPicked: 'Nothing is picked yet.',
    unchanged: 'Nothing has changed yet.',
    needOne: 'Pick at least one note first.',
    ready: 'Ready. Press Use these notes.',
    emptyShelf: WORDS.hint.emptyShelf,
    pageTip: 'Pick an agent, then press Choose notes.',
    noAgent: 'Pick an agent to see its notes.',
  },
  popover: {},
});

const noun = (n: number): string => (n === 1 ? 'note' : 'notes');

/** "86 notes" or "1 note". */
export const notesCount = (n: number): string => `${n} ${noun(n)}`;
/** "263 notes chosen another way", the hint of the card for notes kept from before. */
export const keptHint = (n: number): string => `${notesCount(n)} chosen another way`;
/** "52 of 86 notes", for a topic with parts left out. */
export const partOfTopic = (n: number, all: number): string => `${n} of ${all} ${noun(all)}`;
/** The first line of the big sentence: "This agent will read". The number follows, then `ofTotal`. */
export const READ_LEAD = 'This agent will read';
/** "of 700 notes". */
export const ofTotal = (total: number): string => `of ${total} ${noun(total)}`;
/** The whole sentence, as a screen reader hears it: "This agent will read 214 of 700 notes". */
export const willRead = (n: number, total: number): string => `${READ_LEAD} ${n} ${ofTotal(total)}`;
/** The plain label under the bar: how big the choice is next to all the notes. It follows the count, and it names no figure that cannot be checked. */
export const SIZE_LINE: Readonly<Record<SizeBand, string>> = Object.freeze({ none: 'No notes yet', small: 'A small set', medium: 'A medium set', big: 'A big set', all: 'Every note you have' });
export const sizeLine = (band: SizeBand): string => SIZE_LINE[band];
/** "Clients added. 86 more notes." */
export const topicAdded = (name: string, adds: number): string => `${name} added. ${adds} more ${noun(adds)}.`;
/** "Clients removed." */
export const topicRemoved = (name: string): string => `${name} removed.`;
/** "Archived left out." */
export const partLeftOut = (name: string): string => `${name} left out.`;
/** "Archived is back in." */
export const partBackIn = (name: string): string => `${name} is back in.`;
/** "2 picked by hand". */
export const pickedByHand = (n: number): string => `${n} picked by hand`;
/** The name of the buttons that leave a part out: "Leave out Archived". */
export const leaveOutOf = (part: string): string => `Leave out ${part}`;
/** The name of the group of those buttons: "Leave out of Clients". */
export const leaveOutGroup = (topic: string): string => `Leave out of ${topic}`;
/** The name of one tick box: the title of the note. */
export const tickNote = (title: string): string => title;
/** The tab for a topic in the hand step: "Clients" or "Clients, 2 picked". */
export const topicTab = (name: string, picked: number): string => (picked === 0 ? name : `${name}, ${picked} picked`);
