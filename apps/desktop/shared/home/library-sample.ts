/**
 * Sample facts for the Library page: what each sample tool reaches and can do, who made the skills that came from outside, the dates things were added, and
 * the one item that has an update waiting. Like plain.ts and plain-details.ts this is invented content for the prototype, keyed by the sample's own ids. An
 * item that is not listed here falls back to what its own text says (library-text.ts), or to "Made by you".
 * `withLibrarySamples` puts the pieces into the home app's world: plain names for the three hooks, one source with an update waiting, and the item that has it.
 * Pure: no React, no DOM, no clock, no random number.
 */
import type { AgentItem, HarnessItem, World } from '../world/types.js';
import { globalScope } from '../world/common.js';
import { hashText } from '../world/sample.js';
import { makeText } from './library-text.js';
import { plainOf } from './plain.js';

/** What the Library says about one sample tool. A name and a hint are given only where the plain layer (plain.ts) has none. */
export interface ToolFacts {
  readonly name?: string;
  readonly hint?: string;
  /** The host the tool reaches; absent for a saved prompt. */
  readonly reach?: string;
  readonly access: 'read-only' | 'read-write';
  readonly lines: readonly string[];
}

const T = (x: ToolFacts): ToolFacts => Object.freeze({ ...x, lines: Object.freeze([...x.lines]) });

/** The plain facts of the 14 sample tools, by id. */
export const TOOL_FACTS: Readonly<Record<string, ToolFacts>> = Object.freeze({
  'tool-mcp-missing': T({ reach: 'calendar.example.com', access: 'read-only', lines: ['Connects to calendar.example.com.', 'Reads your events and finds the free times.', 'Only reads. It never changes your calendar.', 'Needs a key before it works.'] }),
  'tool-mcp-present': T({ reach: 'search.example.com', access: 'read-only', lines: ['Connects to search.example.com.', 'Looks things up and brings back the results.', 'Only reads. It never changes anything.'] }),
  'tool-mcp-01': T({ reach: 'files.example.com', access: 'read-only', lines: ['Connects to files.example.com.', 'Opens one spending sheet and reads its rows.', 'Only reads. It never changes the sheet.'] }),
  'tool-mcp-02': T({ reach: 'docs.example.com', access: 'read-only', lines: ['Connects to docs.example.com.', 'Reads the documents your colleagues share with you.', 'Only reads. It never changes them.'] }),
  'tool-mcp-03': T({ reach: 'sheets.example.com', access: 'read-only', lines: ['Connects to sheets.example.com.', 'Reads the rows and columns of a spreadsheet.', 'Only reads. It never changes the sheet.'] }),
  'tool-prompt-01': T({ access: 'read-only', lines: ['Ask for a polite, courteous message.', 'Keep it short and kind.'] }),
  'tool-prompt-02': T({ access: 'read-only', lines: ['Ask for an agenda for the next meeting.', 'List each topic with the time it needs.'] }),
  'tool-prompt-03': T({ access: 'read-only', lines: ['Ask for the answer in plain words.', 'Use short sentences and no hard terms.'] }),
  'tool-prompt-04': T({ access: 'read-only', lines: ['Ask for three ideas for a title.', 'Make each one different from the others.'] }),
  'tool-prompt-05': T({ access: 'read-only', lines: ['Ask for a short post for your followers.', 'Keep it friendly and under fifty words.'] }),
  'tool-prompt-06': T({ access: 'read-only', lines: ['Ask for the outline of a report.', 'Give each part a heading and one line.'] }),
  'tool-hook-guard': T({ name: 'Run a check after editing', hint: 'Runs a small check each time a file is edited.', reach: 'This computer only', access: 'read-write',
    lines: ['Runs a small script on this computer.', 'The script checks the file you just edited.', 'It runs on its own, with no question asked.'] }),
  'tool-hook-02': T({ name: 'Tidy notes after editing', hint: 'Cleans up a note each time you edit it.', reach: 'This computer only', access: 'read-write',
    lines: ['Runs a small script on this computer.', 'The script tidies the note you just edited.', 'It runs on its own, with no question asked.'] }),
  'tool-hook-03': T({ name: 'Save a copy after editing', hint: 'Keeps a copy of each file you edit.', reach: 'This computer only', access: 'read-write',
    lines: ['Runs a small script on this computer.', 'The script saves a copy of the file you just edited.', 'It runs on its own, with no question asked.'] }),
});

const AUTHORS: Readonly<Record<'open' | 'community', readonly string[]>> = Object.freeze({
  open: Object.freeze(['Priya Raman', 'Tomas Eriksen', 'Grace Mwangi']),
  community: Object.freeze(['@quiet-fern', '@marsh-owl', '@paper-lark']),
});

/** A small, fixed number from an id, so a sample item always gets the same author, release and date. */
export function spread(id: string): number {
  return parseInt(hashText(id).slice(0, 6), 16);
}

/** The author of a sample skill that came from outside, by the source it came from. */
export function sampleAuthor(id: string, source: 'open' | 'community'): string {
  const list = AUTHORS[source];
  return list[spread(id) % list.length]!;
}

/** The release tag of a sample skill that came from outside: "v1.0" to "v1.4". */
export function sampleRelease(id: string): string {
  return `v1.${spread(`${id}:release`) % 5}`;
}

/** The authors of the ready-made agents. */
export const READY_MADE_AUTHOR = 'Evergreen Kit authors';

// ---------------------------------------------------------------------------------------------------- dates

const MONTHS: readonly (readonly [string, number])[] = Object.freeze([['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30], ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]]);
/** The last day a sample item can have been added: the day before the preview's own "today", which is the 25th of October 2026. */
const LAST_DAY_OF_YEAR = 297;

/** "12 March 2026" for a day of 2026 counted back from the 24th of October, 0 being that day. The days stay inside the year. */
export function dayText(daysBack: number): string {
  let day = LAST_DAY_OF_YEAR - Math.max(0, Math.min(LAST_DAY_OF_YEAR - 1, Math.floor(daysBack)));
  for (const [name, length] of MONTHS) {
    if (day <= length) return `${day} ${name} 2026`;
    day -= length;
  }
  return '1 January 2026';
}

/** How many days back from the 24th of October a sample item was added, from 2 to 280. */
export function sampleDaysBack(id: string): number {
  return 2 + (spread(`${id}:added`) % 279);
}

// ---------------------------------------------------------------------------------------------------- the item with an update waiting

/** The source the pre-installed item came from, and the item. */
export const OPEN_SOURCE = Object.freeze({ id: 'open-skills', name: 'Open skills library', installed: 'v1.2', newer: 'v1.3' });
export const UPDATE_ITEM_ID = 'web-open-skills-tidy-notes';
const UPDATE_HINT = 'Cleans up rough meeting notes into short, clear points.';
const UPDATE_AUTHOR = 'Priya Raman';
const OLD_LINES: readonly string[] = Object.freeze(['Read the rough notes from the meeting.', 'Fix the spelling and remove the repeats.', 'Write the main points as short lines.']);
const NEW_LINES: readonly string[] = Object.freeze(['Read the rough notes from the meeting.', 'Fix the spelling and remove the repeats.', 'Write the main points as short lines, newest first.', 'Add a line on what is still open.']);

/** The update that is waiting for each item, by item id: the release it brings, its new hint and its new lines. */
export interface UpdateText { readonly release: string; readonly author: string; readonly hint: string; readonly lines: readonly string[] }
export const UPDATES: Readonly<Record<string, UpdateText>> = Object.freeze({
  [UPDATE_ITEM_ID]: Object.freeze({ release: OPEN_SOURCE.newer, author: UPDATE_AUTHOR, hint: 'Cleans up rough meeting notes into clear points and open questions.', lines: NEW_LINES }),
});

/** The facts of a tool or the waiting update of an item, by its id. An id is only ever a key of the table when the table holds it, so an id such as constructor answers nothing. */
export const toolFactsOf = (id: string): ToolFacts | undefined => (Object.hasOwn(TOOL_FACTS, id) ? TOOL_FACTS[id] : undefined);
export const updateTextOf = (id: string): UpdateText | undefined => (Object.hasOwn(UPDATES, id) ? UPDATES[id] : undefined);

/** The days back at which the pre-installed item was added (a sample date, early in the year). */
export const UPDATE_ITEM_DAYS_BACK = 190;
/** The agents that hold the item with the update waiting. */
const UPDATE_HOLDERS: readonly string[] = Object.freeze(['agent-01', 'agent-08']);

/** The names of the keys of the sample servers, in plain words: the generated ones read like passwords ("QUIET_TOKEN"). They are names only, never a value. The two servers of the workspace share one key, which is how a person adds it once. */
export const PLAIN_KEY_NAMES: Readonly<Record<string, string>> = Object.freeze({ 'tool-mcp-missing': 'CALENDAR_KEY', 'tool-mcp-present': 'SEARCH_KEY', 'tool-mcp-02': 'WORKSPACE_KEY', 'tool-mcp-03': 'WORKSPACE_KEY' });

/**
 * The world with plain names for the keys of the sample servers. The name is also in the text of the server's file, so the text changes with it. A server that
 * has no key, or whose key already has the plain name, is left as it is; a world that has none of the servers comes back as it is.
 */
export function withPlainKeys(world: World): World {
  if (!world.items.some(i => i.kind === 'tool' && i.toolKind === 'mcp' && i.secret !== null && Object.hasOwn(PLAIN_KEY_NAMES, i.id) && i.secret.name !== PLAIN_KEY_NAMES[i.id])) return world;
  const items = world.items.map((i): HarnessItem => {
    if (i.kind !== 'tool' || i.toolKind !== 'mcp' || i.secret === null || !Object.hasOwn(PLAIN_KEY_NAMES, i.id) || i.secret.name === PLAIN_KEY_NAMES[i.id]) return i;
    const was = i.secret.name, name = PLAIN_KEY_NAMES[i.id]!;
    const foundAt = i.foundAt.map(f => { const text = f.text.split(`"${was}"`).join(`"${name}"`); return { ...f, text, contentHash: hashText(text) }; });
    return { ...i, secret: { ...i.secret, name }, foundAt };
  });
  return { ...world, items };
}

/** The first words that say a tool only reads. A tool whose plain name starts with one of them can only read, wherever its access is shown. */
export const READ_VERBS: readonly string[] = Object.freeze(['Read', 'Search', 'Look', 'Check']);
const readsOnly = (name: string): boolean => READ_VERBS.some(verb => name === verb || name.startsWith(`${verb} `));

/**
 * The world with the access of every tool that says it only reads set to "can only read" on every agent that holds it. The sample gives each attachment a random access
 * class, so "Read my calendar" could say it changes things for one agent; a name and its access must agree, so this puts them in line. The plain name is the one a person reads.
 */
export function withReadingTools(world: World): World {
  const reading = new Set(world.items.flatMap(i => (i.kind === 'tool' && readsOnly(toolFactsOf(i.id)?.name ?? plainOf('tool', i.id)?.name ?? '') ? [i.id] : [])));
  let changed = false;
  const items = world.items.map((i): HarnessItem => {
    if (i.kind !== 'agent' || !i.definition.toolAttachments.some(t => reading.has(t.toolId) && t.access !== 'read-only')) return i;
    changed = true;
    return { ...i, definition: { ...i.definition, toolAttachments: i.definition.toolAttachments.map(t => (reading.has(t.toolId) ? { ...t, access: 'read-only' as const } : t)) } };
  });
  return changed ? { ...world, items } : world;
}

/**
 * The home app's world with the Library's sample pieces: plain names for the three hooks, the "Open skills library" with a newer release waiting, and one
 * skill from it that two agents hold. A world that has no global harness, or that already has the item, comes back as it is.
 */
export function withLibrarySamples(world: World): World {
  const home = globalScope(world);
  if (home === undefined || world.items.some(i => i.id === UPDATE_ITEM_ID)) return world;
  world = withReadingTools(withPlainKeys(world));
  const text = makeText({ description: UPDATE_HINT, author: UPDATE_AUTHOR, release: OPEN_SOURCE.installed }, OLD_LINES);
  const item: HarnessItem = {
    id: UPDATE_ITEM_ID, kind: 'skill', name: 'Tidy my meeting notes', scopeId: home.id, description: UPDATE_HINT,
    library: { library: OPEN_SOURCE.id, pinnedVersion: OPEN_SOURCE.installed, newerVersion: OPEN_SOURCE.newer },
    foundAt: [{ interface: 'claude-code', path: 'web/open-skills/claude-code/tidy-notes.md', contentHash: hashText(text), text }],
  };
  const items = world.items.map((i): HarnessItem => {
    if (i.kind === 'tool' && i.toolKind === 'hook' && toolFactsOf(i.id)?.name !== undefined) return { ...i, name: toolFactsOf(i.id)!.name! };
    if (i.kind === 'agent' && UPDATE_HOLDERS.includes(i.id) && i.library === null) {
      const agent: AgentItem = { ...i, definition: { ...i.definition, skillIds: [...i.definition.skillIds, UPDATE_ITEM_ID] } };
      return agent;
    }
    return i;
  });
  const libraries = world.libraries.some(l => l.id === OPEN_SOURCE.id) ? world.libraries : [...world.libraries, { id: OPEN_SOURCE.id, name: OPEN_SOURCE.name, installedVersion: OPEN_SOURCE.installed, newerVersion: OPEN_SOURCE.newer }];
  return { ...world, items: [...items, item], libraries };
}
