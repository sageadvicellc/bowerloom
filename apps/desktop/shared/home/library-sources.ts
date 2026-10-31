/**
 * The simulated sources of the "Add from the web" sheet. The preview has no network: three sources are sample data, a link is only compared with their
 * addresses (it is never fetched, never turned into a link on the page, never used as markup), and the screen says so in plain words. Pure: no React, no DOM,
 * no clock, no random number. Names, authors and addresses are invented (example.com hosts), and every line of text obeys the word rules of the home screens.
 */
import type { LibraryNewItem, LibrarySourceInfo } from '../proto/store-library.js';
import type { ToolKind } from '../proto/types.js';
import { reachLine } from './library-model.js';
import { ACCESS_WORDS } from './plain-details.js';
import { makeText } from './library-text.js';

/** The kinds a source holds, in the order the sheet groups them. */
export type SourceKind = 'skill' | 'agent' | 'tool';
export const SOURCE_KINDS: readonly SourceKind[] = Object.freeze(['skill', 'agent', 'tool'] as const);

/** One thing a source holds. `author` and `release` are data: the tag looks like "v2.1" and is shown as it is. */
export interface SourceItem {
  readonly slug: string;
  readonly kind: SourceKind;
  readonly toolKind?: ToolKind;
  readonly name: string;
  readonly hint: string;
  readonly author: string;
  readonly release: string;
  /** The full text, as lines. */
  readonly lines: readonly string[];
  /** The host a tool reaches. */
  readonly reach?: string;
  readonly access?: 'read-only' | 'read-write';
  /** The name of the key a tool needs. */
  readonly keyName?: string;
  readonly role?: string;
}

/** One sample source. `owner` and `repo` make its address. */
export interface SampleSource {
  readonly id: string;
  readonly owner: string;
  readonly repo: string;
  readonly name: string;
  readonly blurb: string;
  readonly release: string;
  readonly items: readonly SourceItem[];
}

const s = (x: Omit<SourceItem, 'kind'> & { kind: SourceKind }): SourceItem => Object.freeze({ ...x, lines: Object.freeze([...x.lines]) });

const OFFICE: SampleSource = {
  id: 'officekit-everyday-kit', owner: 'officekit', repo: 'everyday-kit', name: 'Everyday office kit', blurb: 'Skills and tools for mail, meetings, and small office jobs.', release: 'v2.1',
  items: [
    s({ slug: 'triage-inbox', kind: 'skill', name: 'Triage my inbox', hint: 'Sorts new mail into what needs you today and what can wait.', author: 'Dana Whitfield', release: 'v2.1',
      lines: ['Read the new mail, one message at a time.', 'Put each message in one of two piles: today, or later.', 'List the pile for today first, with one line on why.'] }),
    s({ slug: 'meeting-brief', kind: 'skill', name: 'Prepare a meeting brief', hint: 'Gathers the facts you need before a meeting starts.', author: 'Dana Whitfield', release: 'v2.1',
      lines: ['Look up who is coming to the meeting.', 'Gather what was said last time and what is still open.', 'Write a short sheet that can be read in two minutes.'] }),
    s({ slug: 'summarize-meeting', kind: 'skill', name: 'Summarize a meeting', hint: 'Turns a meeting into key points and decisions.', author: 'Omar Haddad', release: 'v2.0',
      lines: ['Read the notes of the meeting.', 'Write the key points as short lines.', 'List every decision and who made it.'] }),
    s({ slug: 'mail-clerk', kind: 'agent', name: 'Mail clerk', hint: 'Reads your mail and drafts short replies for you to check.', author: 'Dana Whitfield', release: 'v2.1', role: 'mail clerk',
      lines: ['Read each message and draft a short reply.', 'Leave every reply as a draft so the person can check it first.'] }),
    s({ slug: 'thank-you', kind: 'tool', toolKind: 'prompt', name: 'Draft a thank-you', hint: 'Asks for a short thank-you note in one click.', author: 'Omar Haddad', release: 'v1.4',
      lines: ['Write a short, warm thank-you note.', 'Mention one thing the person did.'] }),
    s({ slug: 'find-contact', kind: 'tool', toolKind: 'mcp', name: 'Look up a contact', hint: 'Finds a name and an email address in your contacts.', author: 'Omar Haddad', release: 'v1.0',
      reach: 'contacts.example.com', access: 'read-only', lines: ['Connects to contacts.example.com.', 'Reads names and email addresses.', 'Never changes your contacts.'] }),
    s({ slug: 'send-chat', kind: 'tool', toolKind: 'mcp', name: 'Send a chat message', hint: 'Posts a message in a chat room for you.', author: 'Lena Brandt', release: 'v0.9',
      reach: 'chat.example.com', access: 'read-write', keyName: 'CHAT_KEY', lines: ['Connects to chat.example.com.', 'Posts messages in the rooms you choose.', 'Needs a key before it can post.'] }),
    s({ slug: 'tidy-files', kind: 'tool', toolKind: 'hook', name: 'Tidy files after saving', hint: 'Runs a small script each time you save a file.', author: 'Lena Brandt', release: 'v1.1',
      reach: 'This computer only', access: 'read-write', lines: ['Runs a small script on this computer.', 'The script renames and sorts the file you just saved.', 'It runs on its own, with no question asked.'] }),
  ],
};

const RESEARCH: SampleSource = {
  id: 'scholarbench-research-habits', owner: 'scholarbench', repo: 'research-habits', name: 'Research habits', blurb: 'Careful ways to find, read, and check sources.', release: 'v1.3',
  items: [
    s({ slug: 'check-source', kind: 'skill', name: 'Check a source', hint: 'Checks who wrote a page and whether it holds up.', author: 'Ines Moreau', release: 'v1.3',
      lines: ['Find out who wrote the page and when.', 'Look for a second source that says the same.', 'Say how far the page can be trusted, and why.'] }),
    s({ slug: 'read-paper', kind: 'skill', name: 'Read a paper closely', hint: 'Walks through a long paper one section at a time.', author: 'Ines Moreau', release: 'v1.3',
      lines: ['Read the summary first, then the closing section.', 'Go through the rest one section at a time.', 'Write one line for each section.'] }),
    s({ slug: 'fix-spelling', kind: 'skill', name: 'Fix spelling and grammar', hint: 'Corrects mistakes and leaves your wording alone.', author: 'Ines Moreau', release: 'v1.0',
      lines: ['Fix spelling, commas, and grammar mistakes.', 'Do not change my wording or my style.', 'List what you changed at the end.'] }),
    s({ slug: 'library-scout', kind: 'agent', name: 'Library scout', hint: 'Finds papers on a topic and reports what they say.', author: 'Ines Moreau', release: 'v1.3', role: 'library scout',
      lines: ['Find papers on the topic you are given.', 'Report what each one says in a few lines.'] }),
    s({ slug: 'search-papers', kind: 'tool', toolKind: 'mcp', name: 'Search papers', hint: 'Looks up papers by topic and by author.', author: 'Tomas Eriksen', release: 'v1.2',
      reach: 'papers.example.com', access: 'read-only', lines: ['Connects to papers.example.com.', 'Searches by topic and by author.', 'Only reads. It never changes anything.'] }),
    s({ slug: 'cite-source', kind: 'tool', toolKind: 'prompt', name: 'Write a citation', hint: 'Asks for a clean citation of one source.', author: 'Tomas Eriksen', release: 'v1.0',
      lines: ['Write a clean citation for the source.', 'Give the author, the year, and the title.'] }),
  ],
};

const MONEY: SampleSource = {
  id: 'homeledger-money-tools', owner: 'homeledger', repo: 'money-tools', name: 'Home and money tools', blurb: 'Keep track of bills, shared costs, and monthly spending.', release: 'v0.9',
  items: [
    s({ slug: 'track-bill', kind: 'skill', name: 'Track a bill', hint: 'Notes what is due, when, and how much.', author: 'Grace Mwangi', release: 'v0.9',
      lines: ['Ask what the bill is for and who sent it.', 'Write down the amount and the date it is due.', 'Remind me two days before.'] }),
    s({ slug: 'split-cost', kind: 'skill', name: 'Split a shared cost', hint: 'Works out who owes what on a shared cost.', author: 'Grace Mwangi', release: 'v0.9',
      lines: ['Ask who shared the cost and how much it was.', 'Work out what each person owes.', 'Show the sums so they can be checked.'] }),
    s({ slug: 'explain-charge', kind: 'tool', toolKind: 'prompt', name: 'Explain a charge', hint: 'Asks for a plain explanation of one charge.', author: 'Grace Mwangi', release: 'v0.8',
      lines: ['Explain the charge in plain words.', 'Say whether it looks normal.'] }),
    s({ slug: 'read-statement', kind: 'tool', toolKind: 'mcp', name: 'Read my bank file', hint: 'Reads the rows of a statement you saved.', author: 'Lena Brandt', release: 'v0.9',
      reach: 'files.example.com', access: 'read-only', keyName: 'STATEMENT_KEY', lines: ['Connects to files.example.com.', 'Reads the rows of a saved statement.', 'Needs a key before it can read.'] }),
    s({ slug: 'back-up', kind: 'tool', toolKind: 'hook', name: 'Back up each night', hint: 'Copies your money files to a safe place at night.', author: 'Lena Brandt', release: 'v0.7',
      reach: 'This computer only', access: 'read-write', lines: ['Runs a small script on this computer every night.', 'The script copies your money files to a backup folder.', 'It runs on its own, with no question asked.'] }),
  ],
};

/** The three sample sources, in the order the sheet lists them. */
export const SAMPLE_SOURCES: readonly SampleSource[] = Object.freeze([OFFICE, RESEARCH, MONEY]);

/** What "Starter sources" says about a source: how many of each kind it holds. */
export function kindCounts(source: SampleSource): Readonly<Record<SourceKind, number>> {
  return { skill: source.items.filter(i => i.kind === 'skill').length, agent: source.items.filter(i => i.kind === 'agent').length, tool: source.items.filter(i => i.kind === 'tool').length };
}

/** The items of a source, in the sheet's order: skills, agents, then tools. */
export function groupedItems(source: SampleSource): readonly { readonly kind: SourceKind; readonly items: readonly SourceItem[] }[] {
  return SOURCE_KINDS.map(kind => ({ kind, items: source.items.filter(i => i.kind === kind) })).filter(g => g.items.length > 0);
}

/** What a tool of a source reaches, in words; null for anything that is not a tool. */
export const reachOfItem = (item: SourceItem): string | null => (item.kind === 'tool' && item.toolKind !== undefined ? reachLine(item.toolKind, item.reach) : null);
/** How far a tool of a source can go, in words ("Can only read"); null for anything that is not a tool. */
export const abilityOfItem = (item: SourceItem): string | null => (item.kind === 'tool' ? ACCESS_WORDS[item.access ?? 'read-only'] : null);

/** True when the item runs code on its own. Such an item starts unticked. */
export const runsCodeOf = (item: SourceItem): boolean => item.toolKind === 'hook';
/** True when the item needs a key before it works. */
export const needsKeyOf = (item: SourceItem): boolean => item.keyName !== undefined;

/** The slugs ticked when a source opens: everything that does not run code. */
export function defaultTicked(source: SampleSource): readonly string[] {
  return source.items.filter(i => !runsCodeOf(i)).map(i => i.slug);
}

// ---------------------------------------------------------------------------------------------------- links

/** What a pasted link turned out to be. */
export type LinkResult =
  | { readonly kind: 'empty' }
  | { readonly kind: 'bad' }
  | { readonly kind: 'unknown'; readonly owner: string; readonly repo: string }
  | { readonly kind: 'source'; readonly source: SampleSource };

const LINK = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/?$/i;

/**
 * Reads a pasted link without fetching anything. Only `https://github.com/<owner>/<repo>` (one optional slash at the end) is a link to a collection. A
 * well-formed link is then compared, letter case aside, with the addresses of the sample sources.
 */
export function openLink(input: string): LinkResult {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  const match = LINK.exec(text);
  if (match === null) return { kind: 'bad' };
  const owner = match[1]!, repo = match[2]!;
  if (repo === '.' || repo === '..' || repo.endsWith('.git')) return { kind: 'bad' };
  const found = SAMPLE_SOURCES.find(src => src.owner.toLowerCase() === owner.toLowerCase() && src.repo.toLowerCase() === repo.toLowerCase());
  return found === undefined ? { kind: 'unknown', owner, repo } : { kind: 'source', source: found };
}

/** The address of a sample source, as text. */
export const addressOf = (source: SampleSource): string => `https://github.com/${source.owner}/${source.repo}`;

// ---------------------------------------------------------------------------------------------------- from a source to the store

/** The whole text of a source item, the way a file holds it. */
export function textOfItem(item: SourceItem): string {
  return makeText({ description: item.hint, author: item.author, release: item.release, ...(item.reach === undefined ? {} : { reach: item.reach }), ...(item.access === undefined ? {} : { access: item.access }) }, item.lines);
}

/** The store's description of a source. */
export const infoOf = (source: SampleSource): LibrarySourceInfo => ({ id: source.id, name: source.name, release: source.release });

/** One source item as the store's `addToLibrary` takes it. `matchItemId` is set by the planner when a person-readable name already matches an item. */
export function newItemOf(item: SourceItem, matchItemId?: string): LibraryNewItem {
  return {
    key: item.slug, kind: item.kind, ...(item.toolKind === undefined ? {} : { toolKind: item.toolKind }), name: item.name, description: item.hint, text: textOfItem(item), release: item.release,
    ...(item.keyName === undefined ? {} : { secret: { kind: 'env' as const, name: item.keyName } }),
    ...(item.role === undefined ? {} : { role: item.role, instructions: item.lines.join(' ') }),
    ...(matchItemId === undefined ? {} : { matchItemId }),
  };
}

/** The sample source with this id, or undefined. */
export const sourceById = (id: string): SampleSource | undefined => SAMPLE_SOURCES.find(src => src.id === id);
