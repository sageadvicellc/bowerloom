/**
 * The plain words behind the details panel of the home app: what a skill says when it is read in full, where a skill came from, how far a tool may go, and
 * the names of the programs an item works in. The sample world's own texts are made-up word salad ("A cobalt dovetail tells you when the inkwell is ready"),
 * so a stranger could not tell what a skill does from them. This file holds, for each of the 52 sample skills, 2 to 4 short plain lines, written the way a
 * person writes instructions for a helper. It is sample content for the prototype, keyed by the sample's own ids, like plain.ts. A skill that is not listed here
 * (one the person added from a file) shows its own text instead (see details.ts).
 * Rules: plain words, no banned word (tests/home-words.test.ts scans this file like every other), at most four lines of at most about twenty words each.
 */
import type { AccessClass, InterfaceId } from '../proto/types.js';

/** Where a skill came from, in the words a card shows. */
export const SOURCE_WORDS = Object.freeze({ you: 'Made by you', open: 'Open skills library', community: 'Community skills library' });
export type SourceId = keyof typeof SOURCE_WORDS;

/** The words for how far a tool may go with an agent. The prototype's own access classes are placeholders; these are the plain words for them. */
export const ACCESS_WORDS: Readonly<Record<AccessClass, string>> = Object.freeze({ 'read-only': 'Can only read', 'read-write': 'Can change things' });

/** The programs an item can work in, as a person names them, in the order the details show them. */
export const PROGRAM_ORDER: readonly InterfaceId[] = Object.freeze(['claude-code', 'codex', 'opencode', 'hermes', 'bowerloom'] as const);
export const PROGRAM_NAMES: Readonly<Record<InterfaceId, string>> = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', bowerloom: 'Bowerloom' });

type Row = readonly [id: string, source: SourceId, ...lines: string[]];

const ROWS: readonly Row[] = [
  ['skill-042', 'you', 'Read the notes or the transcript of the meeting.', 'List the three to five points that matter most.', 'Say who decided what, and keep it short.'],
  ['skill-022', 'you', 'Read the message I am replying to.', 'Write a reply that sounds like my earlier ones.', 'Leave it as a draft so I can check it first.'],
  ['skill-009', 'open', 'Go through the notes line by line.', 'List each task, who owns it, and the date it is due.', 'Leave out anything nobody agreed to do.'],
  ['skill-024', 'open', 'Look for trusted pages, papers, and articles on the topic.', 'Prefer sources that name their authors and dates.', 'List each source with one line on why it helps.'],
  ['skill-029', 'you', 'Read the whole article before writing anything.', 'Write the main points in five lines or fewer.', 'Keep the author\'s meaning. Do not add opinions.'],
  ['skill-010', 'open', 'Put the two options side by side.', 'List the good and the bad of each, in the same order.', 'End with a short note on which one fits better, and why.'],
  ['skill-041', 'you', 'Read the draft and mark what is unclear.', 'Rewrite those parts in simpler words.', 'Keep my meaning and my order.'],
  ['skill-012', 'open', 'Fix spelling, commas, and grammar mistakes.', 'Do not change my wording or my style.', 'List what you changed at the end.'],
  ['skill-025', 'you', 'Read a few things I wrote before.', 'Notice how I greet people, how long my sentences run, and which words I like.', 'Write new text that sounds like me.'],
  ['skill-016', 'you', 'Cut the text to about half its length.', 'Keep the main point and any numbers or dates.', 'Remove repeats and filler words.'],
  ['skill-036', 'open', 'Give the gist in two or three lines.', 'Start with the most important thing.', 'Use plain words a stranger would understand.'],
  ['skill-014', 'you', 'Read the new mail and group it by topic.', 'Give each group a short, clear name.', 'Show each group with one line about every message.'],
  ['skill-006', 'you', 'Look for mail that asks a question or names a date.', 'Mark the ones that need an answer today.', 'List them first, with one line on why each is urgent.'],
  ['skill-007', 'you', 'Find the figures the report needs in my files.', 'Write each figure down with where it came from.', 'Say so when a figure is missing. Do not guess.'],
  ['skill-032', 'you', 'Gather this week\'s results into one report.', 'Start with a short summary, then the details.', 'Mark anything that changed a lot since last week.'],
  ['skill-021', 'open', 'Add up each column of numbers again.', 'Compare your result with the total on the page.', 'Warn me when the two differ, and show both.'],
  ['skill-027', 'community', 'Look at the table and pick the chart that fits it.', 'Label both axes and give the chart a title.', 'Keep it plain. Use no more than four colors.'],
  ['skill-023', 'you', 'Read the report and pick the three things worth reading first.', 'Write one line for each.', 'Put the most surprising one at the top.'],
  ['skill-017', 'you', 'Check whether the question has been asked before.', 'If so, reuse the best earlier answer.', 'Keep a friendly tone, and keep it short.'],
  ['skill-040', 'you', 'Ask for the order number if it is not given.', 'Find the order and say where it stands.', 'Give the date it should arrive, if there is one.'],
  ['skill-030', 'open', 'Start with the one thing the reader must know.', 'Keep it to a few short sentences.', 'End with what you need from them, if anything.'],
  ['skill-034', 'you', 'Ask what the reminder is for and when it is due.', 'Set the reminder for a day before the date.', 'Say it back to me so I can check it.'],
  ['skill-033', 'open', 'Look at everyone\'s calendar for the week.', 'Find times when all of them are free.', 'Offer the three best times, earliest first.'],
  ['skill-031', 'you', 'Move the meeting to the time I name.', 'Check that nobody has another meeting then.', 'Write a short note to tell the people involved.'],
  ['skill-028', 'you', 'Read the conversation from start to end.', 'Pick the lines that say something clear or surprising.', 'Write each quote exactly, and name who said it.'],
  ['skill-035', 'open', 'Look at each expense in the list.', 'Put it under the right heading, such as travel or food.', 'Ask me when you cannot tell where it belongs.'],
  ['skill-020', 'you', 'Look through the charges for anything new or too high.', 'Compare each one with the month before.', 'List the odd ones, with the amounts side by side.'],
  ['skill-037', 'community', 'Lay out the trip one day at a time.', 'Give each day a morning, an afternoon, and an evening.', 'Add travel times so the days are realistic.'],
  ['skill-018', 'you', 'Look up the price in several shops.', 'Put the prices side by side with the date you checked.', 'Point to the best price and say what it includes.'],
  ['skill-triple', 'you', 'Read my notes from this week.', 'Sum up what got done, what is still open, and what comes next.', 'Keep it to one page.'],
  ['skill-hidden', 'you', 'Ask who the note is for and what they did.', 'Write a warm, short thank-you in my voice.', 'Keep it to three or four lines.'],
  ['skill-003', 'community', 'Read the text in its own language.', 'Write it again in the language I ask for.', 'Keep names, numbers, and the tone as they are.'],
  ['skill-004', 'open', 'Read the letter slowly, one paragraph at a time.', 'Mark spelling slips, wrong names, and missing words.', 'Do not change what it says.'],
  ['skill-005', 'you', 'Search the files for the words I give you.', 'Look inside the files, not only at their names.', 'List the best matches with a line from each.'],
  ['skill-008', 'community', 'Look at the names of the files I choose.', 'Give each one a clear name that says what is inside.', 'Show me the new names before changing anything.'],
  ['skill-011', 'you', 'Remove entries that appear twice.', 'Put the list in order, from A to Z.', 'Tell me how many entries you removed.'],
  ['skill-013', 'you', 'Ask for the person\'s name, job, and one thing they are proud of.', 'Write three or four lines about them.', 'Use the third person and a friendly tone.'],
  ['skill-015', 'open', 'Take the hard word I give you.', 'Explain it in one or two plain sentences.', 'Add a small example from daily life.'],
  ['skill-019', 'community', 'Open the link and look at the page it leads to.', 'Check that it is the page it claims to be.', 'Tell me if it is broken or goes somewhere else.'],
  ['skill-026', 'you', 'Read my loose notes.', 'Turn each task into one line that starts with a verb.', 'Group the lines by day or by topic.'],
  ['skill-038', 'open', 'Look up the people I will talk to.', 'Gather what we said last time and what is still open.', 'Write a short sheet I can read in two minutes.'],
  ['skill-039', 'community', 'Ask what the job is and what the person will do.', 'Write a first draft with a short intro and a list of duties.', 'Use plain words and leave out buzzwords.'],
  ['skill-043', 'you', 'Read the rough notes.', 'Turn them into numbered steps, in the order they happen.', 'Start each step with an action word.'],
  ['skill-044', 'open', 'Say what changed since the last update.', 'Say what is done, what is stuck, and what comes next.', 'Keep it under one hundred words.'],
  ['skill-proj-1', 'you', 'Find the details I already gave you.', 'Fill in each field of the form with them.', 'Leave a field empty when you do not know. Do not guess.'],
  ['skill-proj-2', 'community', 'Read the review and decide what the customer wants.', 'Write a kind, honest answer in a few lines.', 'Offer a fix when something went wrong.'],
  ['skill-proj-3', 'you', 'Read the details of the product.', 'Write two lines that say what it is and why it helps.', 'Use plain words and no big claims.'],
  ['skill-proj-4', 'open', 'Go through the price list row by row.', 'Look for gaps, repeats, and typing slips.', 'List each problem with its row number.'],
  ['skill-proj-5', 'you', 'Read the invoice and what it is for.', 'Write one short, clear note for it.', 'Mention the due date and how to pay.'],
  ['skill-proj-6', 'community', 'Line up the columns of the table.', 'Use the same format for dates, numbers, and money.', 'Do not change any of the values.'],
  ['skill-proj-7', 'you', 'Check which payment is late and by how many days.', 'Write a polite, short email about it.', 'Say how to pay, and thank them.'],
  ['skill-proj-8', 'open', 'Gather what is new this week.', 'Write a short post that opens with the best news.', 'Finish with one link or one thing to do.'],
];

/** What a skill is, as the details panel reads it. */
export interface SkillText { readonly source: string; readonly lines: readonly string[] }

const TABLE: ReadonlyMap<string, SkillText> = new Map(ROWS.map(([id, source, ...lines]) => [id, Object.freeze({ source: SOURCE_WORDS[source], lines: Object.freeze(lines) })] as const));

/** The ids of the skills this file writes plain text for. */
export const DETAIL_SKILL_IDS: readonly string[] = Object.freeze(ROWS.map(r => r[0]));

/** The plain text and the source of one sample skill by its id, or null when the id is not in the sample. */
export function skillTextOf(id: string): SkillText | null {
  return TABLE.get(id) ?? null;
}
