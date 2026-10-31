/**
 * The small world behind the Add test page (#prototype-v2/add). The sample world's generated names ("Gilded Gantry") are nonsense, so this page uses a
 * hand-made world of the same shape (the `World` type, so the same store, plan and bundle logic run on it) with real-sounding names. When the shell
 * gets a layer that turns the sample names into plain ones, it passes that layer to the drawer as `nameOf` and this world is not needed.
 * Four agents, eight skills (one of them found with two different texts), four tools and one hook, three sets of notes, and one library of
 * ready-made agents. Every path is invented and never shown.
 */
import { createEmptyWorld } from '../../common/empty-world.js';
import { hashText } from '../../../shared/world/sample.js';
import { createStore, reduceStore } from '../../../shared/world/store.js';
import type { AgentItem, FoundAt, HookTool, InterfaceId, LibraryRef, McpTool, PromptTool, SkillItem, World } from '../../../shared/world/types.js';

/** The ids the tests and the page use. */
export const DEMO = Object.freeze({
  agents: ['agent-meeting', 'agent-inbox', 'agent-research', 'agent-writing'],
  /** The agent that starts with the first skill below. */
  agentWithFirstSkill: 'agent-meeting',
  /** Owned skills first (in the order they are listed here), then the two ready-made ones. */
  skills: ['skill-summarize', 'skill-reply', 'skill-weekly', 'skill-inbox', 'skill-spelling', 'skill-email', 'skill-tasks', 'skill-explain'],
  /** The skill found with two different texts. */
  copiesSkill: 'skill-weekly',
  tools: ['tool-search', 'tool-clients', 'tool-calendar', 'tool-reminder'],
  missingKeyTool: 'tool-calendar',
  hook: 'tool-format',
  readyAgents: ['agent-ready-travel', 'agent-ready-study', 'agent-ready-proposal'],
  library: 'everyday-kit',
} as const);

/** The id of the one place the demo world keeps everything. Read from the empty world, so no screen word is spelled here. */
export const HOME_SCOPE_ID: string = createEmptyWorld().scopes[0]!.id;

const LIBRARY: LibraryRef = { library: DEMO.library, pinnedVersion: '1.0.0' };
const at = (face: InterfaceId, file: string, text: string): FoundAt => ({ interface: face, path: `/sample/files/.${face}/${file}`, contentHash: hashText(text), text });

const WEEKLY_A = ['Look at last week\'s work.', 'List what got done.', 'List what is still open.', 'Ask what to focus on next.'].join('\n');
const WEEKLY_B = ['Look at last week\'s work.', 'List what got done.', 'List what is still open and who owns it.', 'Suggest three things to focus on next.', 'Keep it under one page.'].join('\n');

function skill(id: string, name: string, description: string, text: string, library: LibraryRef | null = null): SkillItem {
  return { id, kind: 'skill', name, scopeId: HOME_SCOPE_ID, library, description, foundAt: [at('claude-code', `skills/${id}/SKILL.md`, text)] };
}
function agent(id: string, name: string, role: string, skillIds: string[], tools: AgentItem['definition']['toolAttachments'] = [], library: LibraryRef | null = null): AgentItem {
  return { id, kind: 'agent', name, scopeId: HOME_SCOPE_ID, library, foundAt: [], definition: { name, role, instructions: `Do the ${role} work well. Ask before you guess.`, skillIds, toolAttachments: tools }, extras: [] };
}
const mcp = (id: string, name: string, secret: McpTool['secret']): McpTool => ({ id, kind: 'tool', toolKind: 'mcp', name, scopeId: HOME_SCOPE_ID, library: null, foundAt: [], secret });
const prompt = (id: string, name: string, text: string): PromptTool => ({ id, kind: 'tool', toolKind: 'prompt', name, scopeId: HOME_SCOPE_ID, library: null, foundAt: [at('claude-code', `commands/${id}.md`, text)] });
const hook: HookTool = { id: DEMO.hook, kind: 'tool', toolKind: 'hook', name: 'Format check', scopeId: HOME_SCOPE_ID, library: null, foundAt: [at('claude-code', 'hooks/format.sh', 'echo check')], runsCode: true };

const NOTE_NAMES: readonly string[] = ['Daily notes', 'Client notes', 'Reading list'];
const rule = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } as const;

/** A new copy of the world every time, so a test or a page that stages changes never touches another. */
export function addDemoWorld(): World {
  const base = createEmptyWorld();
  const weekly: SkillItem = { ...skill('skill-weekly', 'Weekly review', 'Look back at the week and choose what comes next.', WEEKLY_A), foundAt: [at('claude-code', 'skills/weekly/SKILL.md', WEEKLY_A), at('codex', 'skills/weekly/SKILL.md', WEEKLY_B), at('opencode', 'skills/weekly/SKILL.md', WEEKLY_A)] };
  const withoutNotes: World = {
    ...base,
    interfaces: base.interfaces.map(i => ({ ...i, installed: 'installed' as const })),
    libraries: [{ id: DEMO.library, name: 'Everyday Kit', installedVersion: '1.0.0' }],
    items: [
      agent('agent-meeting', 'Meeting note taker', 'note taker', ['skill-summarize']),
      agent('agent-inbox', 'Inbox sorter', 'sorter', []),
      agent('agent-research', 'Research assistant', 'researcher', ['skill-explain']),
      agent('agent-writing', 'Writing coach', 'coach', ['skill-email']),
      skill('skill-summarize', 'Summarize a meeting', 'Turn a long meeting into a short list of points.', 'Read the notes.\nWrite five bullet points.\nName who does what.'),
      skill('skill-reply', 'Write a reply', 'Write a kind, clear reply to a message.', 'Read the message twice.\nAnswer every question.\nKeep it short.'),
      weekly,
      skill('skill-inbox', 'Sort my inbox', 'Group new mail by what needs an answer first.', 'List the new mail.\nPut urgent mail first.\nFlag anything that waits on someone else.'),
      skill('skill-spelling', 'Check my spelling', 'Fix spelling and small slips in a draft.', 'Read the draft.\nFix spelling only.\nLeave the meaning alone.'),
      skill('skill-email', 'Draft a short email', 'Write a short email from a few notes.', 'Ask who it is for.\nWrite three short paragraphs.\nEnd with one clear ask.'),
      skill('skill-tasks', 'Turn notes into tasks', 'Pull the to-do items out of messy notes.', 'Find each promise in the notes.\nWrite it as a task.\nAdd a date when there is one.', LIBRARY),
      skill('skill-explain', 'Explain a topic simply', 'Explain a hard topic in plain words.', 'Say it in one sentence.\nGive one everyday example.\nAvoid jargon.', LIBRARY),
      mcp('tool-search', 'Search the web', null),
      mcp('tool-clients', 'Client list', { kind: 'env', name: 'CLIENT_LIST_KEY', state: 'present' }),
      mcp('tool-calendar', 'Calendar', { kind: 'env', name: 'CALENDAR_KEY', state: 'missing' }),
      prompt('tool-reminder', 'Send a reminder', 'Write a friendly reminder about {task}.'),
      hook,
      agent('agent-ready-travel', 'Travel organizer', 'organizer', ['skill-tasks'], [], LIBRARY),
      agent('agent-ready-study', 'Study buddy', 'tutor', ['skill-explain'], [], LIBRARY),
      agent('agent-ready-proposal', 'Proposal writer', 'writer', ['skill-email', 'skill-tasks'], [], LIBRARY),
    ],
  };
  // The store makes each set of notes and its item, so the ids and the shape are the store's own.
  let state = createStore(withoutNotes).getState();
  for (const name of NOTE_NAMES) state = reduceStore(state, { type: 'createSlice', name, rule });
  return state.draft;
}
