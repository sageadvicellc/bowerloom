/**
 * The sample world of the harness-first preview. Every number and name comes from the design pictures: 4 harnesses, 5 projects, 4 interfaces, and a Library of
 * 13 agents, 49 skills, 2 tools and 3 pieces of context. "Weekly report crew" holds 3 agents, 5 skills (Translate is missing), 2 tools and 2 context, 11 parts.
 * No status is written down here. Each one is computed from the install data (status.ts), so every screen says the same thing.
 * A few parts are held by a harness and are not listed in the Library tabs (`inLibrary: false`): the pictures give some harnesses more tools and context than the Library lists.
 */
import { autoLinks } from './links.js';
import type { Harness, HarnessState, HistoryEntry, Install, Interface, InterfaceId, Part, PartKind, Point, Project, Run, ScanSource, Stamp } from './types.js';

export const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ORIGIN = { caveman: 'src-caveman', claude: 'src-claude', codex: 'src-codex', hermes: 'src-hermes', notes: 'src-notes' } as const;
const BY_YOU = 'Made by you', CAVEMAN = 'Caveman plug-in', OPEN = 'Open skills library';

type Row = readonly [name: string, summary: string, description: string, source?: string, version?: string];

const PATH_OF: Readonly<Record<PartKind, (slug: string) => string>> = {
  agent: slug => `agents/${slug}.md`,
  skill: slug => `skills/${slug}/SKILL.md`,
  tool: slug => `tools/${slug}.md`,
  context: slug => `context/${slug}.md`,
};

function fileFor(kind: PartKind, slug: string, description: string, extra: readonly string[], body: string): string {
  const head = ['---', `name: ${slug}`, `description: ${description}`, ...extra, '---'];
  return `${head.join('\n')}\n\n${body}`;
}

function make(kind: PartKind, row: Row, origin: string, opts: { inLibrary?: boolean; cannotUse?: readonly InterfaceId[]; extra?: readonly string[]; body?: string } = {}): Part {
  const [name, summary, description, source = BY_YOU, version] = row;
  const slug = slugOf(name);
  const body = opts.body ?? (kind === 'agent' ? `You help with this job: ${description}` : `${description}`);
  return {
    id: `${kind}-${slug}`, kind, name, summary, description, path: PATH_OF[kind](slug), source, origin,
    ...(version === undefined ? {} : { version }),
    fileText: fileFor(kind, slug, description, opts.extra ?? (kind === 'agent' ? ['model: sonnet'] : []), body),
    cannotUse: opts.cannotUse ?? [], inLibrary: opts.inLibrary ?? true,
  };
}

const researcher: Part = {
  ...make('agent', ['Researcher', 'Finds sources.', 'Finds sources and summarizes articles.', BY_YOU], ORIGIN.claude),
  fileText: [
    '---', 'name: researcher', 'description: Finds sources and summarizes articles.', 'model: sonnet', 'tools: Read, Grep, WebSearch', 'skills: summarize-sources, check-facts', '---', '',
    'You find sources for a topic.', 'Read each source. Write a short', 'summary. Say which claims have no', 'source.',
  ].join('\n'),
};

// ---- Agents: 13 in all (4 Caveman, 6 from the Claude Code folder, 2 from the Codex folder, 1 from the Hermes profile).
const AGENTS: readonly Part[] = [
  make('agent', ['Planner', 'Splits up work.', 'Splits a job into steps and hands each one on.'], ORIGIN.claude),
  researcher,
  make('agent', ['Writer', 'Writes reports.', 'Writes the report from the notes and the checked sources.'], ORIGIN.claude),
  make('agent', ['Inbox sorter', 'Sorts mail.', 'Sorts new mail and drafts short replies.'], ORIGIN.claude),
  make('agent', ['Source checker', 'Checks sources.', 'Checks that each source says what the report says it does.'], ORIGIN.claude),
  make('agent', ['Editor', 'Tidies drafts.', 'Tidies a draft and fixes small slips.'], ORIGIN.claude),
  make('agent', ['Brief reviewer', 'Reviews short.', 'Reviews a change and keeps the reply short.', CAVEMAN], ORIGIN.caveman),
  make('agent', ['Short answerer', 'Answers short.', 'Answers a question in as few words as will do.', CAVEMAN], ORIGIN.caveman),
  make('agent', ['Plain editor', 'Plain wording.', 'Rewrites a text in plain words.', CAVEMAN], ORIGIN.caveman),
  make('agent', ['Quick fixer', 'Fixes small things.', 'Fixes a small problem and says what it did.', CAVEMAN], ORIGIN.caveman),
  make('agent', ['Translator', 'Translates text.', 'Translates a text and keeps its tone.'], ORIGIN.codex),
  make('agent', ['Scheduler', 'Plans calls.', 'Finds a time for a call and writes the invite.'], ORIGIN.codex),
  make('agent', ['Note taker', 'Takes notes.', 'Takes notes in a meeting and lists the next steps.'], ORIGIN.hermes),
];

// ---- Skills: 49 in all (14 Caveman, 22 from the Claude Code folder, 5 from the Codex folder, 8 from the Hermes profile).
const SKILLS_CLAUDE: readonly Part[] = ([
  ['Draft outline', 'Plans sections.', 'Plans the sections of a report.', OPEN],
  ['Summarize sources', 'Sums up pages.', 'Gives the gist of a page.', CAVEMAN],
  ['Check facts', 'Flags no source.', 'Flags claims that have no source.', CAVEMAN, '1.2'],
  ['Format report', 'Formats reports.', 'Sets headings and tables.', OPEN],
  ['Answer a common question', 'Answers common questions.', 'Replies to questions that come up again and again.'],
  ['Clean up a list', 'Cleans lists.', 'Removes repeats and puts a list in order.'],
  ['Write a summary', 'Writes summaries.', 'Writes a short summary of a long text.'],
  ['Find a source', 'Finds sources.', 'Finds a page that backs up a claim.'],
  ['Compare two drafts', 'Compares drafts.', 'Shows what changed between two drafts.'],
  ['Plan a meeting', 'Plans meetings.', 'Writes an agenda for a meeting.'],
  ['Take meeting notes', 'Takes notes.', 'Turns a meeting into short notes.'],
  ['Rename files', 'Renames files.', 'Gives files clear names.'],
  ['Sort the inbox', 'Sorts mail.', 'Puts new mail into groups.'],
  ['Reply to an email', 'Drafts replies.', 'Drafts a reply in your own tone.'],
  ['Check spelling', 'Checks spelling.', 'Finds spelling slips in a text.'],
  ['Make a table', 'Makes tables.', 'Turns a list into a table.'],
  ['Pull out quotes', 'Pulls quotes.', 'Pulls the best quotes from a text.'],
  ['List open tasks', 'Lists tasks.', 'Lists the tasks that are still open.'],
  ['Explain a term', 'Explains terms.', 'Explains a hard term in plain words.'],
  ['Review a draft', 'Reviews drafts.', 'Reads a draft and gives notes.'],
  ['Write release notes', 'Writes release notes.', 'Writes the notes for a release.'],
  ['Tidy a folder', 'Tidies folders.', 'Groups the files of a folder.'],
] as readonly Row[]).map(row => make('skill', row, ORIGIN.claude));
const SKILLS_CAVEMAN: readonly Part[] = ([
  ['Cut filler words', 'Cuts filler.', 'Cuts filler words from a reply.'], ['Shorten a reply', 'Shortens replies.', 'Shortens a reply and keeps the point.'],
  ['Keep it plain', 'Keeps it plain.', 'Rewrites a reply in plain words.'], ['Drop the hedging', 'Drops hedging.', 'Takes out words that hedge.'],
  ['Trim a summary', 'Trims summaries.', 'Trims a summary to its core.'], ['Say it once', 'Says it once.', 'Removes lines that repeat.'],
  ['Short commit note', 'Short commit notes.', 'Writes a short note for a commit.'], ['Brief status', 'Brief status.', 'Writes a status in one line.'],
  ['Plain error text', 'Plain error text.', 'Explains an error in plain words.'], ['One-line answer', 'One-line answers.', 'Answers in one line.'],
  ['Cut the intro', 'Cuts the intro.', 'Removes the intro of a reply.'], ['Strip the recap', 'Strips the recap.', 'Removes the recap at the end.'],
  ['Terse review', 'Terse reviews.', 'Reviews a change in a few lines.'], ['Plain list', 'Plain lists.', 'Turns long text into a plain list.'],
] as readonly Row[]).map(([name, summary, description]) => make('skill', [name, summary, description, CAVEMAN], ORIGIN.caveman));
const SKILLS_CODEX: readonly Part[] = ([
  ['Translate', 'Translates text.', 'Translates a text and keeps its tone.'], ['Schedule a call', 'Schedules calls.', 'Finds a time that suits everyone.'],
  ['Convert a date', 'Converts dates.', 'Converts a date to another format.'], ['Count words', 'Counts words.', 'Counts the words of a text.'], ['Fix a typo', 'Fixes typos.', 'Fixes a typo and says where.'],
] as readonly Row[]).map(row => make('skill', row, ORIGIN.codex));
const SKILLS_HERMES: readonly Part[] = ([
  ['Morning brief', 'Morning brief.', 'Writes a short brief for the morning.'], ['Weather note', 'Weather note.', 'Adds the weather to a note.'], ['Read the news', 'Reads the news.', 'Reads the news and picks the top items.'],
  ['Keep a journal', 'Keeps a journal.', 'Adds a line to your journal.'], ['Set a reminder', 'Sets reminders.', 'Sets a reminder for later.'], ['Log a task', 'Logs tasks.', 'Adds a task to your list.'],
  ['Look up a word', 'Looks up words.', 'Looks up the meaning of a word.'], ['Plan a day', 'Plans a day.', 'Plans the day in blocks.'],
] as readonly Row[]).map(row => make('skill', row, ORIGIN.hermes));

// ---- Tools (2 in the Library) and context (3 in the Library), and the two that only a harness holds.
const TOOLS: readonly Part[] = [
  make('tool', ['Spreadsheet', 'Reads sheets.', 'Reads the cells of a spreadsheet.'], ORIGIN.claude, { cannotUse: ['codex', 'opencode', 'hermes'] }),
  make('tool', ['Web search', 'Searches online.', 'Searches the web and returns the top pages.'], ORIGIN.claude),
];
const CONTEXT: readonly Part[] = [
  make('context', ['Client list', 'Client details.', 'Names and details of your clients.'], ORIGIN.notes),
  make('context', ['Style guide', 'House wording.', 'The wording rules of the house.'], ORIGIN.notes),
  make('context', ['House glossary', 'Own terms.', 'The terms the house uses, with their meaning.'], ORIGIN.notes),
];
const NOT_LISTED: readonly Part[] = [
  make('tool', ['Notes search', 'Searches notes.', 'Searches your notes by words.'], ORIGIN.notes, { inLibrary: false }),
  make('context', ['Source rules', 'Rules for sources.', 'What counts as a good source.'], ORIGIN.notes, { inLibrary: false }),
];

const PARTS: readonly Part[] = [...AGENTS, ...SKILLS_CLAUDE, ...SKILLS_CAVEMAN, ...SKILLS_CODEX, ...SKILLS_HERMES, ...TOOLS, ...CONTEXT, ...NOT_LISTED];
const id = (kind: PartKind, name: string): string => `${kind}-${slugOf(name)}`;
const ids = (kind: PartKind, names: readonly string[]): string[] => names.map(name => id(kind, name));

// ---- Weekly report crew: placed as in the design (graph units, 1 unit is 1 px at zoom 1).
const WEEKLY_POSITIONS: Readonly<Record<string, Point>> = {
  'agent-planner': { x: 48, y: 70 }, 'agent-researcher': { x: 48, y: 298 }, 'agent-writer': { x: 48, y: 462 },
  'skill-draft-outline': { x: 440, y: 40 }, 'tool-spreadsheet': { x: 440, y: 116 }, 'tool-web-search': { x: 440, y: 192 }, 'skill-summarize-sources': { x: 440, y: 268 },
  'skill-check-facts': { x: 440, y: 344 }, 'context-client-list': { x: 440, y: 420 }, 'skill-format-report': { x: 440, y: 496 }, 'context-style-guide': { x: 440, y: 572 },
  'missing-translate': { x: 440, y: 648 },
};
const WEEKLY: Harness = {
  id: 'harness-weekly-report-crew', name: 'Weekly report crew', summary: 'Turns notes and sources into a weekly report.',
  partIds: [
    ...ids('agent', ['Planner', 'Researcher', 'Writer']),
    ...[['skill', 'Draft outline'], ['tool', 'Spreadsheet'], ['tool', 'Web search'], ['skill', 'Summarize sources'], ['skill', 'Check facts'], ['context', 'Client list'], ['skill', 'Format report'], ['context', 'Style guide']]
      .map(([kind, name]) => id(kind as PartKind, name!)),
  ],
  links: [
    { from: 'agent-planner', to: 'skill-draft-outline' }, { from: 'agent-planner', to: 'tool-spreadsheet' },
    { from: 'agent-researcher', to: 'skill-summarize-sources' }, { from: 'agent-researcher', to: 'tool-web-search' }, { from: 'agent-researcher', to: 'skill-check-facts' }, { from: 'agent-researcher', to: 'context-client-list' },
    { from: 'agent-writer', to: 'skill-draft-outline' }, { from: 'agent-writer', to: 'skill-format-report' }, { from: 'agent-writer', to: 'context-style-guide' }, { from: 'agent-writer', to: 'missing-translate' },
  ],
  positions: WEEKLY_POSITIONS,
  missing: [{ id: 'missing-translate', kind: 'skill', name: 'Translate' }],
  newPartIds: ['tool-spreadsheet'],
};

function otherHarness(idText: string, name: string, summary: string, agents: readonly string[], rest: readonly (readonly [PartKind, string])[]): Harness {
  const agentIds = ids('agent', agents), otherIds = rest.map(([kind, partName]) => id(kind, partName));
  return { id: idText, name, summary, partIds: [...agentIds, ...otherIds], links: autoLinks(agentIds, otherIds), positions: {}, missing: [], newPartIds: [] };
}

const CAVEMAN_PACK = otherHarness('harness-caveman-pack', 'Caveman pack', 'Keeps every reply short and plain.', ['Brief reviewer', 'Short answerer', 'Plain editor', 'Quick fixer'], SKILLS_CAVEMAN.map(p => ['skill', p.name] as const));
const INBOX_HELPER = otherHarness('harness-inbox-helper', 'Inbox helper', 'Sorts the inbox and drafts replies.', ['Inbox sorter'],
  [['skill', 'Answer a common question'], ['skill', 'Sort the inbox'], ['skill', 'Reply to an email'], ['tool', 'Web search']]);
const RESEARCH_DESK = otherHarness('harness-research-desk', 'Research desk', 'Finds sources and checks the facts.', ['Researcher', 'Source checker'], [
  ['skill', 'Check facts'], ['skill', 'Draft outline'], ['skill', 'Find a source'], ['skill', 'Pull out quotes'], ['skill', 'Write a summary'], ['skill', 'Compare two drafts'],
  ['tool', 'Spreadsheet'], ['tool', 'Web search'], ['tool', 'Notes search'], ['context', 'Client list'], ['context', 'Style guide'], ['context', 'House glossary'], ['context', 'Source rules'],
]);

const PROJECTS: readonly Project[] = [
  { id: 'project-bowerloom', name: 'bowerloom', path: '~/Sage Advice/code/internal-tools/bowerloom' },
  { id: 'project-site-redesign', name: 'site-redesign', path: '~/Projects/site-redesign' },
  { id: 'project-notes', name: 'notes', path: '~/Documents/notes' },
  { id: 'project-garden', name: 'garden', path: '~/Sage Advice/code/internal-tools/garden' },
  { id: 'project-archive', name: 'archive', path: '~/Documents/archive' },
];

const INSTALLS: readonly Install[] = [
  { projectId: 'project-bowerloom', harnessId: WEEKLY.id, states: { 'claude-code': 'installed', codex: 'out-of-date', opencode: 'not-installed' } },
  { projectId: 'project-site-redesign', harnessId: WEEKLY.id, states: { 'claude-code': 'installed', codex: 'installed' } },
  { projectId: 'project-notes', harnessId: RESEARCH_DESK.id, states: { 'claude-code': 'installed', codex: 'conflict' } },
  { projectId: 'project-garden', harnessId: CAVEMAN_PACK.id, states: { 'claude-code': 'out-of-date' } },
];

const INTERFACES: readonly Interface[] = [
  { id: 'claude-code', name: 'Claude Code', foundAt: 'Found at ~/.claude', health: 'ready', healthWords: 'Ready', on: true, writes: ['.claude/agents/<name>.md', '.claude/skills/<name>/SKILL.md'], cannotUseNote: 'Nothing. It uses every kind of part.' },
  { id: 'codex', name: 'Codex', foundAt: 'Found at ~/.codex and ~/.agents', health: 'ready', healthWords: 'Ready', on: true, writes: ['.codex/agents/<name>.toml', '.agents/skills/<name>/SKILL.md'], cannotUseNote: 'Tools that only Claude Code supports. The install sheet names each one.' },
  { id: 'opencode', name: 'OpenCode', foundAt: 'Found at ~/.config/opencode', health: 'problem', healthWords: 'Config file has a problem', on: false, writes: ['.opencode/agents/<name>.md', '.opencode/skills/<name>/SKILL.md'], cannotUseNote: 'Tools that only Claude Code supports. The install sheet names each one.' },
  { id: 'hermes', name: 'Hermes', foundAt: 'Not found on this computer', health: 'not-found', healthWords: 'Not found', on: false, writes: ['.hermes/agents/<name>.md', '.hermes/skills/<name>/SKILL.md'], cannotUseNote: 'Tools that only Claude Code supports. The install sheet names each one.' },
];

export const SAMPLE_INSTRUCTION = 'Write a weekly report from the notes in Meetings. Check that every claim has a source.';
const T = (daysAgo: number, time: string): Stamp => ({ daysAgo, time });

/** The clock of the sample when no page hands one over: the design's own, 10:54 on the day of the sample, so a run that started 12 minutes ago started at 10:42. */
export const SAMPLE_NOW: Stamp = Object.freeze({ daysAgo: 0, time: '10:54' });

const clockMinutes = (time: string): number => { const [h, m] = time.split(':'); return Number(h) * 60 + Number(m); };
const two = (n: number): string => String(n).padStart(2, '0');

/** The stamp `minutes` before `now`. It crosses midnight into the day before. */
export function minutesBefore(now: Stamp, minutes: number): Stamp {
  const total = clockMinutes(now.time) - minutes, days = Math.max(0, Math.ceil(-total / 1440));
  const at = total + days * 1440;
  return { daysAgo: now.daysAgo + days, time: `${two(Math.floor(at / 60))}:${two(at % 60)}` };
}

function sampleRuns(now: Stamp): readonly Run[] {
  // The two runs of one instruction started 12 minutes ago, so Compare says "Open for 12 minutes" the moment the preview opens.
  const started = minutesBefore(now, 12);
  return [
    { id: 'run-1', harnessId: WEEKLY.id, projectId: 'project-bowerloom', interfaceId: 'claude-code', instruction: SAMPLE_INSTRUCTION, started, status: 'running', groupId: 'group-1', rating: null, notes: 'Found all three sources. Report is clean.' },
    { id: 'run-2', harnessId: WEEKLY.id, projectId: 'project-bowerloom', interfaceId: 'codex', instruction: SAMPLE_INSTRUCTION, started, status: 'done', groupId: 'group-1', rating: 'worse', notes: 'Skipped the fact check on section 2.' },
    { id: 'run-3', harnessId: RESEARCH_DESK.id, projectId: 'project-notes', interfaceId: 'claude-code', instruction: 'Find three sources for the note on pricing.', started: T(now.daysAgo + 1, '16:05'), status: 'closed', groupId: null, rating: null, notes: '' },
  ];
}

const entry = (n: number, text: string, stamp: Stamp, filesWritten: number, manifest: HistoryEntry['manifest'], undo: HistoryEntry['undo']): HistoryEntry =>
  ({ id: `history-${n}`, text, stamp, person: 'Hanna', computer: 'this Mac', filesWritten, manifest, undo, undone: false });

function sampleHistory(now: Stamp): readonly HistoryEntry[] {
  // The newest two are minutes old and the older two are from the day before, so the order is right at any hour.
  return [
    entry(4, 'Installed Weekly report crew in bowerloom', minutesBefore(now, 14), 10, null, [{ op: 'restore-install', projectId: 'project-bowerloom', harnessId: WEEKLY.id, before: { projectId: 'project-bowerloom', harnessId: WEEKLY.id, states: { 'claude-code': 'out-of-date', codex: 'out-of-date', opencode: 'not-installed' } } }]),
    entry(3, 'Added Spreadsheet to Weekly report crew', minutesBefore(now, 42), 0, 'changed', [{ op: 'remove-part', harnessId: WEEKLY.id, partId: 'tool-spreadsheet' }]),
    entry(2, 'Linked Writer to Translate in Weekly report crew', T(now.daysAgo + 1, '16:30'), 0, 'changed', [{ op: 'remove-link', harnessId: WEEKLY.id, link: { from: 'agent-writer', to: 'missing-translate' } }]),
    entry(1, 'Made Weekly report crew from a scan', T(now.daysAgo + 1, '16:02'), 0, 'created', [{ op: 'delete-harness', harnessId: WEEKLY.id }]),
  ];
}

const SOURCES: readonly ScanSource[] = [
  { id: ORIGIN.caveman, name: 'Caveman (plug-in)', interfaceName: 'Claude Code', harnessName: 'Caveman plug-in', partIds: PARTS.filter(p => p.origin === ORIGIN.caveman).map(p => p.id) },
  { id: ORIGIN.claude, name: 'Your Claude Code folder', interfaceName: 'Claude Code', harnessName: 'Claude Code folder', partIds: PARTS.filter(p => p.origin === ORIGIN.claude).map(p => p.id) },
  { id: ORIGIN.codex, name: 'Your Codex folder', interfaceName: 'Codex', harnessName: 'Codex folder', partIds: PARTS.filter(p => p.origin === ORIGIN.codex).map(p => p.id) },
  { id: ORIGIN.hermes, name: 'Hermes profile: pixel', interfaceName: 'Hermes', harnessName: 'Hermes pixel', partIds: PARTS.filter(p => p.origin === ORIGIN.hermes).map(p => p.id) },
];

/**
 * A fresh copy of the sample world. Nothing in it is shared between two calls that can be changed (the data is frozen by use, not by `Object.freeze`).
 * `now` is the clock at the start: the sample's runs and newest changes are dated from it, so the order and "Open for 12 minutes" are right on any day.
 */
export function createSampleWorld(now: Stamp = SAMPLE_NOW): HarnessState {
  return {
    parts: PARTS, harnesses: [WEEKLY, CAVEMAN_PACK, INBOX_HELPER, RESEARCH_DESK], projects: PROJECTS, installs: INSTALLS, interfaces: INTERFACES, runs: sampleRuns(now),
    history: sampleHistory(now), sources: SOURCES, chosenSourceIds: SOURCES.map(s => s.id),
    // The sample's own ids are numbered below 100 (run-1, history-4), so the ids of new things start above them.
    nextId: 100,
  };
}

/** The ids of the sample's own things, for the tests and the e2e specs. */
export const SAMPLE_IDS = Object.freeze({
  weekly: WEEKLY.id, caveman: CAVEMAN_PACK.id, inbox: INBOX_HELPER.id, research: RESEARCH_DESK.id,
  bowerloom: 'project-bowerloom', siteRedesign: 'project-site-redesign', notes: 'project-notes', garden: 'project-garden', archive: 'project-archive',
});
