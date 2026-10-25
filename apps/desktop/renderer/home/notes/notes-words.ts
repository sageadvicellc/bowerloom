/**
 * Every word a person reads in "Choose notes" and on its test page, in one frozen table of the same shape as `WORDS` (renderer/home/words.ts): a label has
 * at most 5 words, a hint at most 12, and no banned word appears. `tests/home-notes-words.test.ts` holds this table, the builders at the bottom and the
 * markup of every part to those rules. A screen takes its words from here and nowhere else. Words the shell already has (Notes, Show more, Close) come
 * from `WORDS`, so each stays one word in one place. No word here says "slice", "token" or "folder": a person picks notes, and notes sit in topics.
 */
import type { SizeBand } from '../../../shared/home/notes-model.js';
import { joinWords } from '../../../shared/proto/words.js';
import { countWords } from '../../../shared/home/textbudget.js';
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
    pickByHand: 'Choose one by one',
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
/**
 * What a selection already includes, in one line of at most 12 words: "Already included: Clients (86), Company (18) and 2 picked by hand." The numbers are the parts
 * of the preview's total, so they add up to it. When the full list is too long, the smallest topics are counted together ("3 other topics (200)"), then every topic
 * ("5 topics (300)"), and last of all the whole total, so the line always fits and its numbers always add up.
 */
export function alreadyLine(topics: readonly { readonly name: string; readonly count: number }[], before: number, hand = 0): string {
  const tail = [...(hand > 0 ? [pickedByHand(hand)] : []), ...(before > 0 ? [`${before} from before`] : [])];
  const say = (names: readonly string[]): string => `Already included: ${joinWords([...names, ...tail])}.`;
  const named = topics.map(t => `${t.name} (${t.count})`);
  const options: string[] = [say(named)];
  // The smallest topics merge first: keep the biggest ones by name and count the rest together.
  const bySize = [...topics].sort((a, b) => b.count - a.count);
  for (let keep = Math.min(bySize.length - 1, 3); keep >= 1; keep -= 1) {
    const rest = bySize.slice(keep), kept = new Set(bySize.slice(0, keep));
    const listed = topics.filter(t => kept.has(t)).map(t => `${t.name} (${t.count})`);
    options.push(say([...listed, `${rest.length} other ${rest.length === 1 ? 'topic' : 'topics'} (${rest.reduce((n, t) => n + t.count, 0)})`]));
  }
  if (topics.length > 1) options.push(say([`${topics.length} topics (${topics.reduce((n, t) => n + t.count, 0)})`]));
  options.push(`Already included: ${notesCount(topics.reduce((n, t) => n + t.count, hand + before))} in all.`);
  return options.find(text => countWords(text) <= 12) ?? options[options.length - 1]!;
}
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
