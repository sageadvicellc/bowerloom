/**
 * The plain layer of the home app. The sample world (shared/proto/sample.ts) names things like "gilded-gantry", which tells a stranger nothing. This
 * file gives every sample agent, skill, tool and note a plain name and a one-line hint, keyed by the sample's own ids, so the store, the tests and the
 * old prototype keep working on the sample as it is. An id that is not listed here falls back to the item's own name (see cards.ts).
 *
 * The pairs are chosen for the seeded world the app loads (`generateWorld(1)`): each agent's skills, tools and note make sense together.
 * Rules: a name has at most 5 words, a hint at most 12, an `does` phrase at most 3 (an agent's hint is built from the phrases of its skills).
 * No brand names, no file paths, none of the banned words. `tests/home-plain.test.ts` holds every row to these rules.
 */

import type { Slice } from '../proto/types.js';
import { generateWorld } from '../proto/sample.js';
import { starterOf } from './starters.js';

/** What a card says: a name and one line under it. */
export interface Plain { readonly name: string; readonly hint: string }
/** A skill also says what it lets an agent do, as a short phrase that follows "it": "summarizes meetings". */
export interface PlainSkill extends Plain { readonly does: string }
/** An agent: its name, a hint for when it has no skill to speak of, and a rank for "Recently changed" (0 is the newest). */
export interface PlainAgent extends Plain { readonly recency: number }

type SkillRow = readonly [id: string, name: string, hint: string, does: string];
type Row = readonly [id: string, name: string, hint: string];
type AgentRow = readonly [id: string, name: string, hint: string, recency: number];

const SKILL_ROWS: readonly SkillRow[] = [
  ['skill-042', 'Summarize a meeting', 'Turns a long meeting into a few clear points.', 'summarizes meetings'],
  ['skill-022', 'Write a reply', 'Drafts a reply in your voice for you to check.', 'writes replies'],
  ['skill-009', 'List action items', 'Pulls out who must do what, and by when.', 'lists action items'],
  ['skill-024', 'Find good sources', 'Looks for trusted pages and papers on a topic.', 'finds sources'],
  ['skill-029', 'Summarize an article', 'Boils a long article down to its main points.', 'summarizes articles'],
  ['skill-010', 'Compare two options', 'Puts two choices side by side with pros and cons.', 'compares options'],
  ['skill-041', 'Improve a draft', 'Makes your writing clearer and easier to read.', 'improves drafts'],
  ['skill-012', 'Fix spelling and grammar', 'Corrects mistakes and leaves your wording alone.', 'fixes spelling'],
  ['skill-025', 'Match my tone', 'Keeps new writing close to how you sound.', 'matches your tone'],
  ['skill-016', 'Shorten a text', 'Cuts a text down and keeps the main point.', 'shortens texts'],
  ['skill-036', 'Write a short summary', 'Gives the gist of anything in two or three lines.', 'writes short summaries'],
  ['skill-014', 'Sort mail by topic', 'Groups new mail by topic so you can skim it.', 'sorts mail'],
  ['skill-006', 'Flag urgent mail', 'Marks the mail that needs an answer today.', 'flags urgent mail'],
  ['skill-007', 'Collect the numbers', 'Gathers the figures a report needs from your files.', 'collects numbers'],
  ['skill-032', 'Build a weekly report', 'Puts the week\'s results into one tidy report.', 'builds weekly reports'],
  ['skill-021', 'Check the totals', 'Adds things up again and warns you if they differ.', 'checks totals'],
  ['skill-027', 'Make a simple chart', 'Turns a table of numbers into a clear chart.', 'makes charts'],
  ['skill-023', 'Write the highlights', 'Picks the three things worth reading first.', 'writes highlights'],
  ['skill-017', 'Answer a common question', 'Replies to questions that come up again and again.', 'answers questions'],
  ['skill-040', 'Look up an order', 'Finds an order and tells you where it stands.', 'looks up orders'],
  ['skill-030', 'Write a clear message', 'Writes a short message that gets to the point.', 'writes clear messages'],
  ['skill-034', 'Set a reminder', 'Reminds you before something is due.', 'sets reminders'],
  ['skill-033', 'Find a free time', 'Finds a time slot that works for everyone.', 'finds free times'],
  ['skill-031', 'Move a meeting', 'Moves a meeting and tells the people involved.', 'moves meetings'],
  ['skill-028', 'Pick out quotes', 'Pulls the best lines from a conversation.', 'picks out quotes'],
  ['skill-035', 'Sort expenses', 'Puts each expense under the right heading.', 'sorts expenses'],
  ['skill-020', 'Spot unusual charges', 'Points out charges that look new or too high.', 'spots odd charges'],
  ['skill-037', 'Outline each day', 'Lays out a trip day by day, with times.', 'outlines trips'],
  ['skill-018', 'Find a good price', 'Compares prices and points to the best one.', 'finds good prices'],
  // Skills that no sample agent holds yet. A person adds them from the Add drawer.
  ['skill-triple', 'Write a weekly summary', 'Sums up your week from the notes you took.', 'summarizes the week'],
  ['skill-hidden', 'Write a thank-you note', 'Writes a warm, short thank-you.', 'writes thank-you notes'],
  ['skill-003', 'Translate a text', 'Turns a text into another language.', 'translates texts'],
  ['skill-004', 'Proofread a letter', 'Reads a letter for slips before it goes out.', 'proofreads letters'],
  ['skill-005', 'Find a file', 'Looks for a file by what is inside it.', 'finds files'],
  ['skill-008', 'Rename my files', 'Gives your files clear names in one go.', 'renames files'],
  ['skill-011', 'Clean up a list', 'Removes repeats and puts a list in order.', 'cleans up lists'],
  ['skill-013', 'Write a short bio', 'Writes a few lines about a person.', 'writes short bios'],
  ['skill-015', 'Explain a term', 'Explains a hard word in plain language.', 'explains terms'],
  ['skill-019', 'Check a link', 'Checks that a link opens the right page.', 'checks links'],
  ['skill-026', 'Make a to-do list', 'Turns loose notes into a clear to-do list.', 'makes to-do lists'],
  ['skill-038', 'Prepare for a call', 'Gathers what you need to know before a call.', 'prepares calls'],
  ['skill-039', 'Draft a job post', 'Writes a first draft of a job post.', 'drafts job posts'],
  ['skill-043', 'Turn notes into steps', 'Turns rough notes into numbered steps.', 'writes steps'],
  ['skill-044', 'Write a status update', 'Writes a short update on how things stand.', 'writes status updates'],
  ['skill-proj-1', 'Fill in a form', 'Fills in a form from details you already have.', 'fills in forms'],
  ['skill-proj-2', 'Reply to a review', 'Drafts a kind answer to a customer review.', 'replies to reviews'],
  ['skill-proj-3', 'Write a product blurb', 'Writes two lines that describe a product.', 'writes product blurbs'],
  ['skill-proj-4', 'Check a price list', 'Checks a price list for gaps and typos.', 'checks price lists'],
  ['skill-proj-5', 'Write an invoice note', 'Adds a short, clear note to an invoice.', 'writes invoice notes'],
  ['skill-proj-6', 'Tidy a table', 'Lines up columns and fixes the formatting.', 'tidies tables'],
  ['skill-proj-7', 'Send a reminder email', 'Drafts a polite nudge about something late.', 'sends reminders'],
  ['skill-proj-8', 'Write a news post', 'Drafts a short post about what is new.', 'writes news posts'],
];

const TOOL_ROWS: readonly Row[] = [
  ['tool-mcp-missing', 'Read my calendar', 'Looks at your calendar to find the right times.'],
  ['tool-mcp-present', 'Search the web', 'Looks things up on the web for you.'],
  ['tool-mcp-01', 'Read my spending file', 'Opens your spending sheet and reads the rows.'],
  ['tool-mcp-02', 'Open shared documents', 'Reads the documents your colleagues share with you.'],
  ['tool-mcp-03', 'Read a spreadsheet', 'Reads the rows and columns of a spreadsheet.'],
  ['tool-prompt-01', 'Draft a polite message', 'Asks for a courteous message in one click.'],
  ['tool-prompt-02', 'Write a meeting agenda', 'Asks for an agenda for your next meeting in one click.'],
  ['tool-prompt-03', 'Explain it simply', 'Asks for an answer in plain words in one click.'],
  ['tool-prompt-04', 'Suggest three titles', 'Asks for three title ideas in one click.'],
  ['tool-prompt-05', 'Draft a social post', 'Asks for a short post for your followers in one click.'],
  ['tool-prompt-06', 'Start a report outline', 'Asks for the outline of a report in one click.'],
];

const NOTE_ROWS: readonly Row[] = [
  ['slice-folders', 'Client list', 'Names and details of your clients.'],
  ['slice-kinds', 'Reading list', 'Articles and guides you saved to read later.'],
  ['slice-seeds', 'Style guide', 'How you like your writing to sound and look.'],
];

const AGENT_ROWS: readonly AgentRow[] = [
  ['agent-01', 'Meeting assistant', 'Sits in on your meetings and writes them up.', 3],
  ['agent-02', 'Research assistant', 'Finds sources and reports back what they say.', 1],
  ['agent-03', 'Writing coach', 'Helps you write clearly and sound like you.', 6],
  ['agent-04', 'Inbox sorter', 'Sorts your mail and answers the simple ones.', 0],
  ['agent-05', 'Report builder', 'Turns your numbers into a weekly report.', 8],
  ['agent-06', 'Support writer', 'Answers customers and keeps track of their orders.', 4],
  ['agent-07', 'Schedule keeper', 'Keeps your calendar tidy and your deadlines in sight.', 7],
  ['agent-08', 'Interview notetaker', 'Writes up interviews and picks out the best lines.', 9],
  ['agent-09', 'Money tracker', 'Sorts your spending and flags what looks odd.', 2],
  ['agent-10', 'Trip organizer', 'Maps out a trip and hunts for good prices.', 5],
];

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const byId = <R extends readonly [string, ...unknown[]], V>(rows: readonly R[], make: (row: R) => V): Readonly<Record<string, V>> =>
  freeze(Object.fromEntries(rows.map(row => [row[0], freeze(make(row) as object) as V])));

export const PLAIN_SKILLS: Readonly<Record<string, PlainSkill>> = byId(SKILL_ROWS, ([, name, hint, does]) => ({ name, hint, does }));
export const PLAIN_TOOLS: Readonly<Record<string, Plain>> = byId(TOOL_ROWS, ([, name, hint]) => ({ name, hint }));
/** Notes are keyed by the id of the saved choice of pages that the agent reads. */
export const PLAIN_NOTES: Readonly<Record<string, Plain>> = byId(NOTE_ROWS, ([, name, hint]) => ({ name, hint }));
export const PLAIN_AGENTS: Readonly<Record<string, PlainAgent>> = byId(AGENT_ROWS, ([, name, hint, recency]) => ({ name, hint, recency }));

export type PlainKind = 'agent' | 'skill' | 'tool' | 'note';

let sampleNotes: ReadonlyMap<string, string> | undefined;
/** The rule and the seed pages of each sample set of notes, as text, made once from the sample world. */
function sampleNoteShapes(): ReadonlyMap<string, string> {
  sampleNotes ??= new Map(generateWorld(1).slices.map(s => [s.id, JSON.stringify([s.rule, s.seeds, s.pinned])] as const));
  return sampleNotes;
}

/**
 * True when a set of notes is still the sample's own choice of pages. "Use these notes" changes a set that one agent reads in place, with the same id and
 * name, so the plain name and hint of the sample no longer tell the truth once its rule or its seed pages differ.
 */
export function isSampleNote(slice: Slice): boolean {
  return sampleNoteShapes().get(slice.id) === JSON.stringify([slice.rule, slice.seeds, slice.pinned]);
}

/** The plain name and hint of one thing by its sample id (or a starter agent's), or null when the id is not known. */
export function plainOf(kind: PlainKind, id: string): Plain | null {
  const table = kind === 'agent' ? PLAIN_AGENTS : kind === 'skill' ? PLAIN_SKILLS : kind === 'tool' ? PLAIN_TOOLS : PLAIN_NOTES;
  if (Object.hasOwn(table, id)) return table[id]!;
  // A starter agent of the Add drawer, or a copy of one the person added, has the starter's name and job.
  const starter = kind === 'agent' ? starterOf(id) : undefined;
  return starter === undefined ? null : { name: starter.name, hint: starter.job };
}

/** What a skill lets an agent do, as a short phrase ("summarizes meetings"), or null for a skill that is not in the sample. */
export function skillDoes(id: string): string | null {
  return Object.hasOwn(PLAIN_SKILLS, id) ? PLAIN_SKILLS[id]!.does : null;
}

/** The "Recently changed" rank of a sample agent (0 is newest). An agent that is not in the sample comes last. */
export function agentRecency(id: string): number {
  return Object.hasOwn(PLAIN_AGENTS, id) ? PLAIN_AGENTS[id]!.recency : Number.MAX_SAFE_INTEGER;
}
